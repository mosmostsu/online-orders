// โคลน TikTok → Shopee (ร้านเดียวกันในกลุ่ม เช่น TikTok SOLID → Shopee SOLID)
//
// กฎ (ดู memory never-recreate-baskets): สร้างเฉพาะตะกร้าที่ Shopee "ยังไม่มี SKU ไหนเลย" — ไม่แตะตะกร้าที่มีอยู่แล้ว
// ตรวจซ้ำทุกครั้งก่อนสร้าง + กันกดซ้ำด้วย os_clone_log
//
// ข้อมูลที่ Shopee บังคับแต่ TikTok ไม่มีตรงๆ ใช้ "แผนที่" ที่เรียนจากตะกร้าที่ลงทั้งสองร้านอยู่แล้ว
// (lib/cloneMaps/tiktok-shopee-<ร้าน>.json สร้างด้วย scripts/learn_clone_map.py — อ่านอย่างเดียว):
//   หมวด (โหวตจากคู่จริง) · แบรนด์ที่ร้านเคยใช้ · ค่าแอตทริบิวต์บังคับที่ร้านใช้บ่อย · ช่องขนส่งที่ร้านเปิด
// ขีดจำกัดของ Shopee (get_item_limit): ชื่อ 20–120 · คำอธิบาย 60–5000 · ชื่อตัวเลือก ≤14 · ค่าตัวเลือก ≤20 · รูป ≤9
// ทดสอบ (test: true): ชื่อขึ้นต้น [TEST] · ซ่อน (UNLIST) · SKU ต่อท้าย -TEST · สต็อก 0 → ลบด้วย deleteTestItem
import { db } from './supabase.js';
import * as tiktok from './tiktok.js';
import * as shopee from './shopee.js';
import { listShops, usableToken } from './tokens.js';
import { inListingTab, saveListings } from './listings.js';
import { shopGroup } from './shopGroups.js';
import { markCompareStale } from './compareSnap.js';
import { fromTikTok, htmlToText, cleanTitle, shortenValues } from './productModel.js';
import { titleKey, titleTwins, twinMsg } from './cloneCommon.js';
import MAP_SOLID from './cloneMaps/tiktok-shopee-solid.json';

const MAPS = { SOLID: MAP_SOLID };
const low = (s) => String(s || '').trim().toLowerCase();
const norm = (s) => String(s || '').toLowerCase().replace(/[(（][^)）]*[)）]/g, '').replace(/[^a-z0-9฀-๿]/g, '');
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const logKey = (shop) => `tiktok:${shop}>shopee:${shop}`;   // ใส่ในคอลัมน์ shopee_shop ของ os_clone_log (ชื่อคอลัมน์มาจากงานโคลน Shopee→ThisShop)
const PENDING_MIN = 15;

async function selectAllFast(make) {
  const first = await make(0, 999);
  if (first.error) throw first.error;
  const rows = first.data || [];
  const total = first.count || rows.length;
  const jobs = [];
  for (let from = 1000; from < total; from += 1000) jobs.push(make(from, from + 999));
  for (const r of await Promise.all(jobs)) {
    if (r.error) throw r.error;
    rows.push(...(r.data || []));
  }
  return rows;
}
async function pool(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i]); }
  }));
  return out;
}

async function tiktokAuth(shop) {
  const row = (await listShops('tiktok')).find((r) => r.shop === shop);
  if (!row) throw new Error(`ไม่พบโทเคน TikTok ${shop}`);
  const t = await usableToken(row);
  return { accessToken: t.access_token, shopCipher: t.shop_cipher };
}
async function shopeeAuth(shop) {
  const row = (await listShops('shopee')).find((r) => r.shop === shop);
  if (!row) throw new Error(`ไม่พบโทเคน Shopee ${shop}`);
  const t = await usableToken(row);
  return { accessToken: t.access_token, shopId: t.shop_id, partner: t };
}

// SKU (ตัวเล็ก) ทั้งหมดที่มีใน Shopee ร้านนั้น ทุกสถานะ
async function shopeeSkuSet(shop) {
  const rows = await selectAllFast((a, b) => db().from('os_listing_skus').select('seller_sku', { count: 'exact' })
    .eq('platform', 'shopee').eq('shop', shop).order('sku_id').range(a, b));
  return new Set(rows.map((r) => low(r.seller_sku)).filter(Boolean));
}

// ประวัติโคลนของเส้นทางนี้ที่ยังบล็อกอยู่ (สำเร็จ หรือกำลังทำไม่เกิน 15 นาที)
async function blockedIds(shop, ids) {
  const out = new Map();
  for (const c of chunks(ids, 100)) {
    const { data, error } = await db().from('os_clone_log').select('shopee_product_id, thisshop_spu_id, status, created_at')
      .eq('shopee_shop', logKey(shop)).in('shopee_product_id', c).in('status', ['ok', 'pending']);
    if (error) throw new Error(error.message);
    for (const r of data || []) {
      const stale = r.status === 'pending' && Date.now() - new Date(r.created_at).getTime() > PENDING_MIN * 60000;
      if (!stale) out.set(r.shopee_product_id, r);
    }
  }
  return out;
}

// ── วางแผน: ตะกร้า TikTok ที่ Shopee ยังไม่มี + หมวด/แบรนด์ที่จะใช้ ──
export async function planTiktokToShopee(shop = 'SOLID') {
  const map = MAPS[shop];
  if (!map) throw new Error(`ยังไม่มีแผนที่โคลนของร้าน ${shop} — รัน scripts/learn_clone_map.py`);
  const sb = db();
  const [ttList, ttSkus, onShopee] = await Promise.all([
    selectAllFast((a, b) => sb.from('os_listings').select('product_id, title, status, thumb_url', { count: 'exact' })
      .eq('platform', 'tiktok').eq('shop', shop).order('product_id').range(a, b)),
    selectAllFast((a, b) => sb.from('os_listing_skus').select('product_id, seller_sku', { count: 'exact' })
      .eq('platform', 'tiktok').eq('shop', shop).order('sku_id').range(a, b)),
    shopeeSkuSet(shop),
  ]);
  const skus = new Map();
  for (const r of ttSkus) {
    const k = low(r.seller_sku);
    if (!k) continue;
    if (!skus.has(r.product_id)) skus.set(r.product_id, new Set());
    skus.get(r.product_id).add(k);
  }
  const cand = ttList.filter((l) => inListingTab({ status: l.status }, 'live')
    && skus.get(l.product_id)?.size && ![...skus.get(l.product_id)].some((k) => onShopee.has(k)));
  const blocked = await blockedIds(shop, cand.map((c) => c.product_id));

  // หมวดของ TikTok ต้องอ่านสด (ไม่ได้เก็บในฐานข้อมูล) — ตะกร้าผู้สมัครมีไม่มาก
  const auth = await tiktokAuth(shop);
  const items = await pool(cand, 6, async (l) => {
    const base = { id: l.product_id, title: l.title, thumb: l.thumb_url, n: skus.get(l.product_id).size, cloned: blocked.get(l.product_id) || null };
    try {
      const m = fromTikTok(await tiktok.getProduct({ ...auth, productId: l.product_id }), shop);
      const leaf = m.categoryLeafId;
      const cat = leaf ? map.categories[leaf] : null;
      const brand = pickBrand(m, map);
      return {
        ...base, category: m.categoryChain.join(' / '),
        shopeeCat: cat ? { id: cat.shopee, name: cat.shopeeName || String(cat.shopee), votes: cat.votes, of: cat.of, sure: cat.votes / cat.of >= 0.6 } : null,
        brand: brand.original_brand_name,
        problem: cat ? null : 'ไม่รู้หมวดของ Shopee (ยังไม่มีตะกร้าหมวดนี้ที่ลงทั้งสองร้าน)',
      };
    } catch (e) {
      return { ...base, problem: `อ่านจาก TikTok ไม่ได้: ${String(e.message || e).slice(0, 120)}` };
    }
  });
  const twins = await titleTwins('shopee', shop);
  for (const x of items) { const t = !x.cloned && twins.get(titleKey(x.title)); if (t) x.problem = twinMsg('Shopee', t); }
  return { items: items.sort((a, b) => String(a.title).localeCompare(String(b.title), 'th')), mapBuiltAt: map.builtAt };
}

function pickBrand(model, map) {
  const byName = model.brand ? map.brands[norm(model.brand)] : null;
  if (byName) return byName;
  const t = norm(model.title);
  const hit = Object.entries(map.brands).find(([k]) => k.length >= 3 && t.includes(k));
  return hit ? hit[1] : { brand_id: 0, original_brand_name: 'NoBrand' };
}

// ช่องขนส่งที่รับน้ำหนัก/ขนาดนี้ได้ (Shopee ปฏิเสธทั้งตะกร้าถ้าเปิดช่องที่เกินขีดจำกัด)
function fitsChannel(c, kg, dims) {
  if (!c || !c.enabled) return false;
  const w = c.weight_limit || {};
  if (w.item_max_weight && !(kg >= (w.item_min_weight || 0) && kg <= w.item_max_weight)) return false;
  const m = c.item_max_dimension || {};
  const side = Math.max(m.length || 0, m.width || 0, m.height || 0);
  const sides = [dims.l, dims.w, dims.h];
  if (side && Math.max(...sides) > side) return false;
  if (m.dimension_sum && sides.reduce((a, b) => a + b, 0) > m.dimension_sum) return false;
  return true;
}

async function fetchImage(url) {
  const res = await fetch(url, { headers: { accept: 'image/jpeg,image/png' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`โหลดรูปไม่ได้ (${res.status})`);
  const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (!/jpe?g|png/.test(type)) throw new Error(`รูปเป็น ${type} Shopee ไม่รับ`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 10 * 1024 * 1024) throw new Error('รูปใหญ่เกิน 10MB');
  return { bytes, type };
}

// ── โคลนหนึ่งตะกร้า ──
// catPick: หมวด Shopee ที่ผู้ใช้เลือกเองในแผง (แทนหมวดที่เดาจากแผนที่) — แอตทริบิวต์บังคับยังต้องมีค่าที่ร้านเคยใช้
export async function cloneTiktokToShopee({ id, shop = 'SOLID', test = false, catPick = null }) {
  const map = MAPS[shop];
  if (!map) throw new Error(`ยังไม่มีแผนที่โคลนของร้าน ${shop}`);
  id = String(id || '');
  if (!/^\d+$/.test(id)) throw new Error('เลขตะกร้า TikTok ไม่ถูกต้อง');
  const sb = db();

  if (!test) {
    const blocked = await blockedIds(shop, [id]);
    if (blocked.has(id)) {
      const b = blocked.get(id);
      throw new Error(b.status === 'ok' ? `โคลนไปแล้ว (Shopee ${b.thisshop_spu_id})` : 'กำลังโคลนตะกร้านี้อยู่');
    }
  }

  const ta = await tiktokAuth(shop);
  const m = fromTikTok(await tiktok.getProduct({ ...ta, productId: id }), shop);
  // ตรวจซ้ำ: Shopee ต้องยังไม่มี SKU ไหนของตะกร้านี้เลย (ไม่แตะ/ไม่ซ้ำตะกร้าเดิม)
  const onShopee = await shopeeSkuSet(shop);
  const clash = m.variants.map((v) => v.sku).filter((s) => s && onShopee.has(low(s)));
  if (clash.length) throw new Error(`Shopee มี SKU นี้แล้ว (${clash.slice(0, 3).join(', ')}) — ไม่โคลน`);
  const twin = (await titleTwins('shopee', shop)).get(titleKey(m.title));
  if (twin) throw new Error(twinMsg('Shopee', twin));

  const cat = map.categories[m.categoryLeafId];
  if (!cat && !catPick) throw new Error(`ไม่รู้หมวดของ Shopee สำหรับ "${m.categoryChain.join(' / ')}" — เลือกหมวดเองในแผงได้`);
  const categoryId = catPick ? Number(catPick) : cat.shopee;

  let logId = null;
  if (!test) {
    const { data, error } = await sb.from('os_clone_log')
      .insert({ shopee_shop: logKey(shop), shopee_product_id: id, status: 'pending', title: m.title }).select('id').single();
    if (error) throw new Error(error.message);
    logId = data.id;
  }
  const finish = (patch) => (logId ? sb.from('os_clone_log').update(patch).eq('id', logId).then(() => null, () => null) : null);

  const sa = await shopeeAuth(shop);
  let itemId = null;
  try {
    // แอตทริบิวต์บังคับ — เติมด้วยค่าที่ร้านใช้บ่อยในหมวดนี้
    const tree = await shopee.getAttributeTree({ ...sa, categoryId });
    const defaults = map.attrDefaults[String(categoryId)] || {};
    const attribute_list = [];
    for (const a of tree.filter((x) => x.mandatory)) {
      const v = defaults[String(a.attribute_id)];
      if (!v) throw new Error(`หมวดนี้บังคับแอตทริบิวต์ "${a.name || a.attribute_id}" แต่ยังไม่มีค่าที่ร้านเคยใช้`);
      attribute_list.push({ attribute_id: a.attribute_id, attribute_value_list: [v] });
    }

    // น้ำหนัก/ขนาด → ช่องขนส่งที่รับได้
    const kg = Math.max(0.01, Math.round((m.weightG / 1000) * 1000) / 1000);
    const dims = { l: Math.max(1, Math.round(m.dims.l)), w: Math.max(1, Math.round(m.dims.w)), h: Math.max(1, Math.round(m.dims.h)) };
    const channels = new Map((await shopee.getChannelList(sa)).map((c) => [c.logistics_channel_id, c]));
    const logistic_info = map.logistics.filter((cid) => fitsChannel(channels.get(cid), kg, dims)).map((cid) => ({ logistic_id: cid, enabled: true }));
    if (!logistic_info.length) throw new Error(`ไม่มีช่องขนส่งที่รับน้ำหนัก ${kg} kg / ขนาด ${dims.l}×${dims.w}×${dims.h} cm`);

    // รูป: สินค้า ≤9 + รูปของตัวเลือกชั้นแรก
    const gallery = m.images.slice(0, 9);
    if (!gallery.length) throw new Error('ไม่มีรูปสินค้า');
    const depth = Math.min(2, Math.max(0, ...m.variants.map((v) => v.options.length)));
    const v1 = [...new Set(m.variants.map((v) => v.options[0]?.value ?? ''))];
    const optImg = new Map();
    if (depth >= 1) for (const v of m.variants) if (v.options[0]?.image && !optImg.has(v.options[0].value)) optImg.set(v.options[0].value, v.options[0].image);
    const urls = [...new Set([...gallery, ...optImg.values()])];
    const up = new Map();
    await pool(urls, 4, async (u) => {
      try {
        const { bytes, type } = await fetchImage(u);
        up.set(u, await shopee.uploadImage({ bytes, contentType: type, filename: type.includes('png') ? 'a.png' : 'a.jpg', partner: sa.partner }));
      } catch (e) { up.set(u, e); }
    });
    const okId = (u) => { const v = up.get(u); return v && !(v instanceof Error) ? v : null; };
    const image_id_list = gallery.map(okId).filter(Boolean);
    if (!okId(gallery[0])) throw new Error(`รูปหลักอัปโหลดไม่ได้: ${up.get(gallery[0])?.message || ''}`);
    const warnings = [...up.values()].filter((v) => v instanceof Error).map((e) => `ข้ามรูป: ${e.message}`);

    // ข้อความ
    let name = cleanTitle(m.title) || m.title;
    if (test) name = `[TEST] ลบได้ ${name}`;
    if (name.length < 20) name = `${name} ${m.categoryChain.slice(-1)[0] || ''}`.trim();
    name = name.slice(0, 120);
    let description = htmlToText(m.descriptionHtml, 5000);
    if (description.length < 60) description = `${description}\n${name}\n${m.categoryChain.join(' / ')}`.trim().padEnd(60, '.');
    const brand = pickBrand(m, map);

    // สต็อกจริงจาก Seniorsoft
    const forms = [...new Set(m.variants.flatMap((v) => (v.sku ? [v.sku, v.sku.toLowerCase(), v.sku.toUpperCase()] : [])))];
    const stock = new Map();
    for (const c of chunks(forms, 300)) {
      const { data, error } = await sb.from('os_st').select('sku, qty').in('sku', c);
      if (error) throw new Error(error.message);
      for (const r of data || []) stock.set(low(r.sku), Math.max(0, Number(r.qty) || 0));
    }
    const qtyOf = (v) => (test ? 0 : (stock.has(low(v.sku)) ? stock.get(low(v.sku)) : Math.max(0, Math.round(v.qty || 0))));
    const skuOf = (v) => (v.sku ? `${v.sku}${test ? '-TEST' : ''}` : '');

    const first = m.variants[0];
    const body = {
      original_price: first.price, description, weight: kg, item_name: name,
      item_status: test ? 'UNLIST' : 'NORMAL',
      dimension: { package_length: dims.l, package_width: dims.w, package_height: dims.h },
      seller_stock: [{ stock: depth ? 0 : qtyOf(first) }], logistic_info, category_id: categoryId,
      image: { image_id_list }, brand: { brand_id: brand.brand_id, original_brand_name: brand.original_brand_name },
      condition: 'NEW', attribute_list,
      ...(depth ? {} : { item_sku: skuOf(first) }),
    };
    if (m.variants.some((v) => !(v.price > 0))) throw new Error('มีตัวเลือกที่ราคาเป็น 0');
    const r = await shopee.addItem({ ...sa, body });
    itemId = r.item_id;
    if (!itemId) throw new Error('Shopee ไม่คืน item_id');

    let modelN = 1;
    if (depth) {
      const v2 = depth >= 2 ? [...new Set(m.variants.map((v) => v.options[1]?.value ?? ''))] : [];
      const s1 = shortenValues(v1);
      const s2 = shortenValues(v2);
      const names = [String(m.optionNames[0] || 'ตัวเลือก').slice(0, 14), String(m.optionNames[1] || 'ขนาด').slice(0, 14)];
      const tier_variation = [{
        name: names[0],
        option_list: v1.map((a) => ({ option: s1.get(a) ?? a, ...(okId(optImg.get(a)) ? { image: { image_id: okId(optImg.get(a)) } } : {}) })),
      }];
      if (depth >= 2) tier_variation.push({ name: names[1], option_list: v2.map((b) => ({ option: s2.get(b) ?? b })) });
      const by = new Map(m.variants.map((v) => [`${v.options[0]?.value ?? ''}\u0001${depth >= 2 ? (v.options[1]?.value ?? '') : ''}`, v]));
      const model = [];
      v1.forEach((a, i) => {
        (depth >= 2 ? v2 : ['']).forEach((b, j) => {
          const v = by.get(`${a}\u0001${b}`);
          const fallback = m.variants.find((x) => (x.options[0]?.value ?? '') === a);   // คู่ที่ไม่มีในต้นทาง — เติมให้ครบ สต็อก 0
          model.push({
            tier_index: depth >= 2 ? [i, j] : [i],
            original_price: (v || fallback).price,
            seller_stock: [{ stock: v ? qtyOf(v) : 0 }],
            ...(v && skuOf(v) ? { model_sku: skuOf(v) } : {}),
          });
        });
      });
      await shopee.initTierVariation({ ...sa, body: { item_id: itemId, tier_variation, model } });
      modelN = model.length;
      const filled = model.length - m.variants.length;
      if (filled > 0) warnings.push(`เติมคู่ตัวเลือกที่ขาด ${filled} ตัว (สต็อก 0)`);
    }

    // ตรวจหลังสร้าง + บันทึกลงฐานข้อมูลให้หน้า compare เห็นทันที
    const [base] = await shopee.getItemBaseInfo({ ...sa, itemIds: [String(itemId)] });
    const models = depth ? await shopee.getModelList({ ...sa, itemId }) : null;
    const got = depth ? (models?.model || []).length : 1;
    if (got !== modelN) warnings.push(`ตัวเลือกใน Shopee ${got} ≠ ที่ส่งไป ${modelN}`);
    if (!test && base) {
      try {
        await saveListings([shopee.normalizeListing(base, models, shop)]);
        await markCompareStale(shopGroup('shopee', shop));
      } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
    }
    await finish({ status: 'ok', thisshop_spu_id: String(itemId), title: name, sku_n: modelN });
    return { itemId: String(itemId), status: base?.item_status || null, name, categoryId, brand: brand.original_brand_name, models: got, images: image_id_list.length, warnings };
  } catch (e) {
    // สร้างตะกร้าไปแล้วแต่ขั้นถัดไปพัง → ลบตะกร้าที่ "เราเพิ่งสร้าง" ทิ้ง ไม่ปล่อยตะกร้าครึ่งๆ กลางๆ ไว้
    if (itemId) { try { await shopee.deleteItem({ ...sa, itemId }); } catch { /* ไม่เป็นไร */ } }
    await finish({ status: 'failed', error: String(e.message || e).slice(0, 500) });
    throw e;
  }
}

// ลบสินค้าทดสอบ — ยอมลบเฉพาะที่ชื่อขึ้นต้น [TEST] และซ่อนอยู่ (UNLIST) เท่านั้น
export async function deleteTestItem({ itemId, shop = 'SOLID' }) {
  const sa = await shopeeAuth(shop);
  const [it] = await shopee.getItemBaseInfo({ ...sa, itemIds: [String(itemId)] });
  if (!it) throw new Error('ไม่พบสินค้านี้');
  if (!String(it.item_name || '').startsWith('[TEST]') || it.item_status !== 'UNLIST') {
    throw new Error('ไม่ใช่สินค้าทดสอบ ([TEST] + ซ่อน) — ไม่ลบ');
  }
  await shopee.deleteItem({ ...sa, itemId });
  return { deleted: String(itemId) };
}
