// โคลน Shopee → TikTok (ร้านเดียวกันในกลุ่ม เช่น Shopee SOLID → TikTok SOLID หรือข้ามร้าน Shopee REAL → TikTok SOLID)
// src = ร้าน Shopee ต้นทาง (ไม่ใส่ = ชื่อเดียวกับร้าน TikTok) · แผนที่ใช้ของร้าน TikTok ปลายทาง (หมวด Shopee เป็นรหัสกลางของแพลตฟอร์ม ใช้ข้ามร้านได้)
//
// กฎ (ดู memory never-recreate-baskets): สร้างเฉพาะตะกร้าที่ TikTok "ยังไม่มี SKU ไหนเลย" — ไม่แตะตะกร้าที่มีอยู่แล้ว
// ตรวจซ้ำทุกครั้งก่อนสร้าง + กันกดซ้ำด้วย os_clone_log · ขั้นใดพังหลังสร้างแล้ว → ลบเฉพาะตะกร้าที่เราเพิ่งสร้าง
//
// ข้อมูลที่ TikTok บังคับแต่ Shopee ไม่มีตรงๆ ใช้แผนที่ที่เรียนจากตะกร้าที่ลงทั้งสองร้านแล้ว
// (lib/cloneMaps/shopee-tiktok-<ร้าน>.json สร้างด้วย scripts/learn_clone_map_shopee_tiktok.py — อ่านอย่างเดียว):
//   หมวด (โหวตจากคู่จริง) · แบรนด์ · แอตทริบิวต์บังคับ → ค่าที่ร้านใช้บ่อย · ตารางไซส์ของแบรนด์นั้นในหมวดนั้น · คลังหลัก
// TikTok: ร้านเป็น all-region ต้องส่ง category_version 'v2' · รูปต้องอัปโหลดเข้าคลังของ TikTok ก่อน
//   ตัวเลือกตั้งชื่อเองได้ ไม่ต้องครบทุกคู่สี×ไซส์ · ตะกร้าใหม่ต้องรอ TikTok ตรวจ (PENDING) ก่อนขึ้นขาย
// ทดสอบ (test: true): บันทึกเป็นแบบร่าง (DRAFT) · ชื่อขึ้นต้น [TEST] · SKU ต่อท้าย -TEST · จำนวน 0 → ลบด้วย deleteTestProduct
import { db } from './supabase.js';
import * as tiktok from './tiktok.js';
import * as shopee from './shopee.js';
import { saveListings } from './listings.js';
import { shopGroup } from './shopGroups.js';
import { markCompareStale } from './compareSnap.js';
import { fromShopee, htmlToText, cleanTitle, shortenValues } from './productModel.js';
import { low, norm, chunks, pool, shopToken, skuSet, candidates, blockedIds, stCounts, fetchImageBytes, titleKey, titleTwins, twinMsg } from './cloneCommon.js';
import MAP_SOLID from './cloneMaps/shopee-tiktok-solid.json';

const MAPS = { SOLID: MAP_SOLID };
const keyOf = (shop, src = shop) => `shopee:${src}>tiktok:${shop}`;
export const SOURCES = { SOLID: ['SOLID', 'REAL'] };   // ร้าน TikTok → ร้าน Shopee ที่โคลนมาได้
const MAX_IMAGES = 9;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toHtml = (text) => text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');

async function shopeeAuth(shop) {
  const t = await shopToken('shopee', shop);
  return { accessToken: t.access_token, shopId: t.shop_id, partner: t };
}
async function tiktokAuth(shop) {
  const t = await shopToken('tiktok', shop);
  return { accessToken: t.access_token, shopCipher: t.shop_cipher };
}

// อ่านตะกร้า Shopee เข้าโมเดลกลาง (ทีละไม่เกิน 50)
async function readShopee(sa, ids, shop) {
  const out = new Map();
  for (const c of chunks(ids, 50)) {
    const bases = await shopee.getItemBaseInfo({ ...sa, itemIds: c });
    await pool(bases, 6, async (b) => {
      const models = b.has_model ? await shopee.getModelList({ ...sa, itemId: b.item_id }) : null;
      // รูปตารางไซส์ของตะกร้า Shopee (รหัสรูป) — ใช้แทนเมื่อร้าน TikTok ยังไม่มีตารางไซส์ของแบรนด์นี้ในหมวดนี้
      // (ตารางไซส์แบบเทมเพลตของร้าน size_chart_id คัดลอกไม่ได้)
      out.set(String(b.item_id), { ...fromShopee(b, models, shop), shopeeSizeChart: b.size_chart || null });
    });
  }
  return out;
}

function pickBrand(m, map) {
  const byName = m.brand && norm(m.brand) !== 'nobrand' ? map.brands[norm(m.brand)] : null;
  if (byName) return byName;
  const t = norm(m.title);
  const hit = Object.entries(map.brands).find(([k]) => k.length >= 3 && t.includes(k));
  return hit ? hit[1] : null;
}

// หมวด/แบรนด์/แอตทริบิวต์/ตารางไซส์ ที่จะใช้ + ปัญหาที่ทำให้โคลนไม่ได้ (ตรวจได้ก่อนลงมือ)
// pick = { leaf, req } เมื่อผู้ใช้เลือกหมวด TikTok เอง · chartUri = รูปตารางไซส์ที่ผู้ใช้อัปเองในแผง (อัปเข้า TikTok แล้ว)
// ตารางไซส์: ของร้าน TikTok (แบรนด์+หมวดเดียวกัน) → อัปเองในแผง → รูปตารางไซส์ของตะกร้า Shopee ต้นทาง
export const NO_CHART = /บังคับตารางไซส์/;
function resolve(m, map, pick = null, chartUri = null) {
  const cat = pick ? { tiktok: pick.leaf, tiktokName: '', votes: 1, of: 1 } : map.categories[m.categoryLeafId];
  const brand = pickBrand(m, map);
  const out = { cat, brand, attrs: [], sizeChart: null, problem: null };
  if (!cat) return { ...out, problem: 'ไม่รู้หมวดของ TikTok (ยังไม่มีตะกร้าหมวดนี้ที่ลงทั้งสองร้าน) — เลือกหมวดเองได้' };
  const req = pick?.req || map.required[cat.tiktok] || { attrs: {}, sizeChart: false };
  const missing = Object.values(req.attrs).filter((a) => !a.values).map((a) => a.name);
  if (missing.length) return { ...out, problem: `หมวดนี้ TikTok บังคับ ${missing.join(', ')} แต่ร้านยังไม่เคยกรอก` };
  out.attrs = Object.entries(req.attrs).map(([id, a]) => ({ id, name: a.name, values: a.values }));
  if (req.sizeChart) {
    out.sizeChart = chartUri || (brand ? map.sizeCharts[`${cat.tiktok}|${norm(brand.name)}`] || null : null);
    out.chartFrom = chartUri ? 'upload' : out.sizeChart ? 'tiktok' : null;
    if (!out.sizeChart && m.shopeeSizeChart) { out.sizeChart = { shopee: m.shopeeSizeChart }; out.chartFrom = 'shopee'; }
    if (!out.sizeChart) return { ...out, problem: `หมวดนี้ TikTok บังคับตารางไซส์ แต่ร้านยังไม่มีตารางไซส์ของแบรนด์${brand ? ` ${brand.name}` : 'นี้'}ในหมวดนี้ — อัปรูปตารางไซส์เองได้` };
  }
  const skus = m.variants.map((v) => v.sku);
  if (skus.some((s) => !s)) return { ...out, problem: 'มีตัวเลือกที่ไม่มีรหัส SKU' };
  const dup = skus.filter((s, i) => skus.findIndex((x) => low(x) === low(s)) !== i);
  if (dup.length) return { ...out, problem: `รหัส SKU ซ้ำกันในตะกร้า (${[...new Set(dup)].slice(0, 3).join(', ')}) — แก้รหัสใน Shopee ก่อน` };
  if (m.variants.some((v) => !(v.price > 0))) return { ...out, problem: 'มีตัวเลือกที่ราคาเป็น 0' };
  if (!m.images.length) return { ...out, problem: 'ไม่มีรูปสินค้า' };
  return out;
}

// ── วางแผน ──
// ids: จำกัดเฉพาะตะกร้าที่ติ๊กมา (ข้ามร้านมีตะกร้าที่ยังไม่มีเยอะ อ่านทั้งหมดจาก Shopee ไม่ทันเวลา)
export async function planShopeeToTiktok(shop = 'SOLID', { src = shop, ids = null } = {}) {
  const map = MAPS[shop];
  if (!map) throw new Error(`ยังไม่มีแผนที่โคลนของร้าน ${shop} — รัน scripts/learn_clone_map_shopee_tiktok.py`);
  if (!(SOURCES[shop] || [shop]).includes(src)) throw new Error(`ยังไม่รองรับโคลน Shopee ${src} → TikTok ${shop}`);
  let cand = await candidates({ srcPlatform: 'shopee', dstPlatform: 'tiktok', shop: src, dstShop: shop });
  if (ids) { const want = new Set(ids.map(String)); cand = cand.filter((c) => want.has(c.id)); }
  const blocked = await blockedIds(keyOf(shop, src), cand.map((c) => c.id));
  const models = cand.length ? await readShopee(await shopeeAuth(src), cand.map((c) => c.id), src) : new Map();
  const items = cand.map((c) => {
    const base = { ...c, cloned: blocked.get(c.id) || null };
    const m = models.get(c.id);
    if (!m) return { ...base, problem: 'อ่านจาก Shopee ไม่ได้' };
    const r = resolve(m, map);
    return {
      ...base,
      category: r.cat?.name || '',
      tiktokCat: r.cat ? { id: r.cat.tiktok, name: r.cat.tiktokName || r.cat.tiktok, votes: r.cat.votes, of: r.cat.of, sure: r.cat.votes / r.cat.of >= 0.6 } : null,
      attrs: Object.fromEntries([
        ...r.attrs.map((a) => [a.name, a.values.map((v) => v.name).join(', ')]),
        ...(r.sizeChart ? [['ตารางไซส์', r.chartFrom === 'shopee' ? 'รูปจากตะกร้า Shopee' : `ของ ${r.brand?.name || 'ร้าน'}`]] : []),
      ]),
      brand: r.brand?.name || '—',
      problem: r.problem,
    };
  });
  const twins = await titleTwins('tiktok', shop);
  for (const x of items) { const t = !x.cloned && twins.get(titleKey(x.title)); if (t) x.problem = twinMsg('TikTok', t); }
  return { items: items.sort((a, b) => String(a.title).localeCompare(String(b.title), 'th')), mapBuiltAt: map.builtAt };
}

// แอตทริบิวต์บังคับ + ตารางไซส์ของหมวดที่ผู้ใช้เลือกเอง (ไม่อยู่ในแผนที่) — ถามสด
// ค่าแอตทริบิวต์ใช้ค่าที่ร้านเคยใส่ให้แอตทริบิวต์ id เดียวกันในหมวดอื่น
async function liveRequired(ta, leaf, map) {
  const q = { category_version: 'v2' };
  const attrs = (await tiktok.call(`/product/202309/categories/${leaf}/attributes`, { ...ta, query: q })).attributes || [];
  const rules = await tiktok.call(`/product/202309/categories/${leaf}/rules`, { ...ta, query: q });
  const known = {};
  for (const r of Object.values(map.required)) for (const [k, a] of Object.entries(r.attrs)) if (a.values && !known[k]) known[k] = a.values;
  const need = {};
  for (const a of attrs) if (a.type === 'PRODUCT_PROPERTY' && a.is_requried) need[String(a.id)] = { name: a.name || '', values: known[String(a.id)] || null };
  return { attrs: need, sizeChart: Boolean(rules.size_chart?.is_required) };
}

// ── โคลนหนึ่งตะกร้า ──
// catPick: หมวด TikTok ที่ผู้ใช้เลือกเองในแผง (แทนหมวดที่เดาจากแผนที่)
// รูปของตะกร้า Shopee ต้นทาง (หน้าแก้รูปก่อนโคลน — app/compare/ImageEditor.js) · id = url ของรูป
export async function sourceImagesTiktok({ id, shop = 'SOLID', src = shop }) {
  if (!(SOURCES[shop] || [shop]).includes(src)) throw new Error(`ยังไม่รองรับโคลน Shopee ${src} → TikTok ${shop}`);
  id = String(id || '');
  if (!/^\d+$/.test(id)) throw new Error('เลขตะกร้า Shopee ไม่ถูกต้อง');
  const m = (await readShopee(await shopeeAuth(src), [id], src)).get(id);
  if (!m) throw new Error(`ไม่พบตะกร้านี้ใน Shopee ${src}`);
  return { src, title: m.title, images: m.images.map((u) => ({ id: u, url: u })) };
}

// อัปรูปที่แก้แล้ว (data URL) เข้าคลังรูปของ TikTok → imageId = 'uri:<uri>' ไว้ส่งใน gallery
export async function uploadEditedImageTiktok({ shop = 'SOLID', data }) {
  if (!MAPS[shop]) throw new Error(`ยังไม่มีแผนที่โคลนของร้าน ${shop}`);
  const mm = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
  if (!mm) throw new Error('ไฟล์รูปไม่ถูกต้อง (ต้องเป็น JPG/PNG)');
  const bytes = Buffer.from(mm[2], 'base64');
  if (bytes.length > 4 * 1024 * 1024) throw new Error('รูปใหญ่เกิน 4MB');
  const ta = await tiktokAuth(shop);
  return { imageId: `uri:${await tiktok.uploadImage({ accessToken: ta.accessToken, bytes, contentType: mm[1], useCase: 'MAIN_IMAGE' })}` };
}

// อัปรูปตารางไซส์ (data URL) เข้า TikTok → { uri } ไว้ส่งเป็น sizeChart ตอนโคลน
export async function uploadSizeChartTiktok({ shop = 'SOLID', data }) {
  if (!MAPS[shop]) throw new Error(`ยังไม่มีแผนที่โคลนของร้าน ${shop}`);
  const mm = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
  if (!mm) throw new Error('ไฟล์รูปไม่ถูกต้อง (ต้องเป็น JPG/PNG)');
  const bytes = Buffer.from(mm[2], 'base64');
  if (bytes.length > 4 * 1024 * 1024) throw new Error('รูปใหญ่เกิน 4MB');
  const ta = await tiktokAuth(shop);
  return { uri: await tiktok.uploadImage({ accessToken: ta.accessToken, bytes, contentType: mm[1], useCase: 'SIZE_CHART_IMAGE' }) };
}

// gallery: รูปเรียงตามที่เลือก (url รูปเดิมของต้นทาง หรือ 'uri:<uri>' ของรูปที่แก้แล้วอัปเข้า TikTok แล้ว) · ไม่ส่ง = รูปทั้งหมดของต้นทาง
export async function cloneShopeeToTiktok({ id, shop = 'SOLID', src = shop, test = false, catPick = null, gallery: pickGallery = null, sizeChart: chartUri = null }) {
  if (chartUri != null && !/^[\w./-]{8,300}$/.test(String(chartUri))) throw new Error('รูปตารางไซส์ไม่ถูกต้อง');
  const map = MAPS[shop];
  if (!map) throw new Error(`ยังไม่มีแผนที่โคลนของร้าน ${shop}`);
  if (!(SOURCES[shop] || [shop]).includes(src)) throw new Error(`ยังไม่รองรับโคลน Shopee ${src} → TikTok ${shop}`);
  if (pickGallery != null && (!Array.isArray(pickGallery) || !pickGallery.length || pickGallery.length > MAX_IMAGES || !pickGallery.every((g) => typeof g === 'string' && g.length < 600))) {
    throw new Error(`รายการรูปไม่ถูกต้อง (ต้องมี 1–${MAX_IMAGES} รูป)`);
  }
  if (!map.warehouseId) throw new Error('ไม่รู้คลังสินค้าของร้าน TikTok');
  id = String(id || '');
  if (!/^\d+$/.test(id)) throw new Error('เลขตะกร้า Shopee ไม่ถูกต้อง');
  const sb = db();
  if (!test) {
    const b = (await blockedIds(keyOf(shop, src), [id])).get(id);
    if (b) throw new Error(b.status === 'ok' ? `โคลนไปแล้ว (TikTok ${b.thisshop_spu_id})` : 'กำลังโคลนตะกร้านี้อยู่');
  }

  const m = (await readShopee(await shopeeAuth(src), [id], src)).get(id);
  if (!m) throw new Error(`ไม่พบตะกร้านี้ใน Shopee ${src}`);
  if (pickGallery && pickGallery.some((g) => !g.startsWith('uri:') && !m.images.includes(g))) throw new Error('มีรูปที่ไม่ใช่ของตะกร้านี้');
  const ta = await tiktokAuth(shop);
  const pick = catPick ? { leaf: String(catPick), req: map.required[String(catPick)] || await liveRequired(ta, String(catPick), map) } : null;
  const r = resolve(m, map, pick, chartUri);
  if (r.problem) throw new Error(r.problem);
  const onTiktok = await skuSet('tiktok', shop);
  const clash = m.variants.map((v) => v.sku).filter((s) => onTiktok.has(low(s)));
  if (clash.length) throw new Error(`TikTok มี SKU นี้แล้ว (${clash.slice(0, 3).join(', ')}) — ไม่โคลน`);
  const twin = (await titleTwins('tiktok', shop)).get(titleKey(m.title));
  if (twin) throw new Error(twinMsg('TikTok', twin));

  let logId = null;
  if (!test) {
    const { data, error } = await sb.from('os_clone_log')
      .insert({ shopee_shop: keyOf(shop, src), shopee_product_id: id, status: 'pending', title: m.title }).select('id').single();
    if (error) throw new Error(error.message);
    logId = data.id;
  }
  const finish = (patch) => (logId ? sb.from('os_clone_log').update(patch).eq('id', logId).then(() => null, () => null) : null);
  const skuOf = (v) => `${v.sku}${test ? '-TEST' : ''}`;
  let productId = null;
  try {
    // รูป → คลังของ TikTok (รูปสินค้า ≤9 + รูปของตัวเลือกชั้นแรก)
    const depth = Math.min(2, Math.max(0, ...m.variants.map((v) => v.options.length)));
    const optImg = new Map();
    if (depth >= 1) for (const v of m.variants) if (v.options[0]?.image && !optImg.has(v.options[0].value)) optImg.set(v.options[0].value, v.options[0].image);
    const gallery = (pickGallery || m.images).slice(0, MAX_IMAGES);
    const up = new Map();
    for (const g of gallery) if (g.startsWith('uri:')) up.set(g, g.slice(4));   // รูปที่แก้แล้ว — อัปเข้า TikTok ไปแล้ว
    const jobs = [...new Set(gallery)].filter((u) => !up.has(u)).map((u) => [u, 'MAIN_IMAGE']).concat([...new Set(optImg.values())].filter((u) => !gallery.includes(u)).map((u) => [u, 'ATTRIBUTE_IMAGE']));
    await pool(jobs, 4, async ([u, useCase]) => {
      try {
        const { bytes, type } = await fetchImageBytes(u);
        up.set(u, await tiktok.uploadImage({ accessToken: ta.accessToken, bytes, contentType: type, useCase }));
      } catch (e) { up.set(u, e); }
    });
    const okUri = (u) => { const v = up.get(u); return v && !(v instanceof Error) ? v : null; };
    // ตารางไซส์จากตะกร้า Shopee → อัปเข้า TikTok (ประเภทรูปตารางไซส์)
    if (r.sizeChart?.shopee) {
      try {
        const { bytes, type } = await fetchImageBytes(`https://cf.shopee.co.th/file/${r.sizeChart.shopee}`);
        r.sizeChart = await tiktok.uploadImage({ accessToken: ta.accessToken, bytes, contentType: type, useCase: 'SIZE_CHART_IMAGE' });
      } catch (e) { throw new Error(`อัปรูปตารางไซส์จาก Shopee เข้า TikTok ไม่ได้: ${e.message} — อัปรูปตารางไซส์เองในแผงแทน`); }
    }
    if (!okUri(gallery[0])) throw new Error(`รูปหลักอัปโหลดเข้า TikTok ไม่ได้: ${up.get(gallery[0])?.message || ''}`);
    const warnings = [...up.values()].filter((v) => v instanceof Error).map((e) => `ข้ามรูป: ${e.message}`);

    let title = cleanTitle(m.title) || m.title;
    if (test) title = `[TEST] ลบได้ ${title}`;
    if (title.length < 25) title = `${title} ${r.cat.tiktokName.split(' › ').slice(-1)[0] || ''}`.trim();
    title = title.slice(0, 255);
    const text = htmlToText(m.descriptionHtml, 9000) || title;

    const kg = Math.max(0.01, Math.round((m.weightG / 1000) * 100) / 100);
    const dims = { l: Math.max(1, Math.round(m.dims.l)), w: Math.max(1, Math.round(m.dims.w)), h: Math.max(1, Math.round(m.dims.h)) };
    const stock = await stCounts(m.variants.map((v) => v.sku));
    const qtyOf = (v) => (test ? 0 : (stock.has(low(v.sku)) ? stock.get(low(v.sku)) : Math.max(0, Math.round(v.qty || 0))));

    const names = [String(m.optionNames[0] || 'ตัวเลือก').slice(0, 20), String(m.optionNames[1] || 'ขนาด').slice(0, 20)];
    const s1 = shortenValues(m.variants.map((v) => v.options[0]?.value ?? ''), 50);
    const s2 = shortenValues(m.variants.map((v) => v.options[1]?.value ?? ''), 50);
    const skus = m.variants.map((v) => {
      const a = v.options[0]?.value ?? '';
      const img = depth >= 1 ? okUri(optImg.get(a)) : null;
      const sales_attributes = [];
      if (depth >= 1) sales_attributes.push({ name: names[0], value_name: s1.get(a) ?? a, ...(img ? { sku_img: { uri: img } } : {}) });
      if (depth >= 2) sales_attributes.push({ name: names[1], value_name: s2.get(v.options[1]?.value ?? '') ?? v.options[1]?.value ?? '' });
      return {
        ...(sales_attributes.length ? { sales_attributes } : {}),
        seller_sku: skuOf(v),
        price: { amount: String(v.price), currency: 'THB' },
        inventory: [{ warehouse_id: map.warehouseId, quantity: qtyOf(v) }],
      };
    });

    const body = {
      ...(test ? { save_mode: 'AS_DRAFT' } : {}),
      category_version: 'v2',
      category_id: r.cat.tiktok,
      title,
      description: toHtml(text),
      main_images: gallery.map(okUri).filter(Boolean).map((uri) => ({ uri })),
      skus,
      package_weight: { value: String(kg), unit: 'KILOGRAM' },
      package_dimensions: { length: String(dims.l), width: String(dims.w), height: String(dims.h), unit: 'CENTIMETER' },
      ...(r.brand ? { brand_id: r.brand.id } : {}),
      ...(r.sizeChart ? { size_chart: { image: { uri: r.sizeChart } } } : {}),
      ...(r.attrs.length ? { product_attributes: r.attrs.map((a) => ({ id: a.id, values: a.values })) } : {}),
    };
    const res = await tiktok.createProduct({ ...ta, body });
    productId = res.product_id ? String(res.product_id) : null;
    if (!productId) throw new Error('TikTok ไม่คืน product_id');
    const got = (res.skus || []).length;
    if (got && got !== skus.length) warnings.push(`ตัวเลือกใน TikTok ${got} ≠ ที่ส่งไป ${skus.length}`);

    let status = test ? 'DRAFT' : null;
    if (!test) {
      try {
        const p = await tiktok.getProduct({ ...ta, productId });
        status = p.status || null;
        await saveListings([tiktok.normalizeListing(p, shop)]);
        await markCompareStale(shopGroup('tiktok', shop));
      } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
    }
    await finish({ status: 'ok', thisshop_spu_id: productId, title, sku_n: skus.length });
    return {
      itemId: productId, status, name: title, categoryId: r.cat.tiktok, brand: r.brand?.name || null, sizeChart: Boolean(r.sizeChart),
      skus: skus.map((s) => s.seller_sku), models: got || skus.length, images: body.main_images.length, warnings,
    };
  } catch (e) {
    // สร้างไปแล้วแต่ขั้นหลังพัง → ลบตะกร้าที่ "เราเพิ่งสร้าง" ทิ้ง
    if (productId) { try { await tiktok.deleteProducts({ ...ta, productIds: [productId] }); } catch { /* ไม่เป็นไร */ } }
    await finish({ status: 'failed', error: String(e.message || e).slice(0, 500) });
    throw e;
  }
}

// ลบสินค้าทดสอบ — ยอมลบเฉพาะแบบร่าง (DRAFT) ที่ชื่อขึ้นต้น [TEST] และทุก SKU ลงท้าย -TEST
export async function deleteTestProduct({ itemId, shop = 'SOLID' }) {
  const ta = await tiktokAuth(shop);
  const p = await tiktok.getProduct({ ...ta, productId: String(itemId) });
  const skus = (p.skus || []).map((s) => s.seller_sku);
  if (!String(p.title || '').startsWith('[TEST]') || p.status !== 'DRAFT' || !skus.length || skus.some((s) => !s || !s.endsWith('-TEST'))) {
    throw new Error('ไม่ใช่สินค้าทดสอบ (แบบร่าง [TEST] + SKU -TEST) — ไม่ลบ');
  }
  await tiktok.deleteProducts({ ...ta, productIds: [String(itemId)] });
  return { deleted: String(itemId), skus };
}
