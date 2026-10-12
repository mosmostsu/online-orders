// โคลน TikTok → Lazada (ร้านเดียวกันในกลุ่ม เช่น TikTok SOLID → Lazada SOLID)
//
// กฎ (ดู memory never-recreate-baskets): สร้างเฉพาะตะกร้าที่ Lazada "ยังไม่มี SKU ไหนเลย" — ไม่แตะตะกร้าที่มีอยู่แล้ว
// ตรวจซ้ำทุกครั้งก่อนสร้าง + กันกดซ้ำด้วย os_clone_log · ขั้นใดพังหลังสร้างแล้ว → ลบเฉพาะ SKU ที่เราเพิ่งสร้าง
//
// ข้อมูลที่ Lazada บังคับแต่ TikTok ไม่มีตรงๆ ใช้แผนที่ที่เรียนจากตะกร้าที่ลงทั้งสองร้านแล้ว
// (lib/cloneMaps/tiktok-lazada-<ร้าน>.json สร้างด้วย scripts/learn_clone_map_lazada.py — อ่านอย่างเดียว):
//   หมวด (โหวตจากคู่จริง) · แอตทริบิวต์บังคับของหมวด → ค่าที่ร้านใช้บ่อย · แบรนด์ที่ร้านเคยใช้
// Lazada: รูปต้องย้ายเข้าคลังของ Lazada ก่อน (/image/migrate) · ตัวเลือกแบบ variation ตั้งชื่อเองได้ (customize)
//   SellerSku ห้ามว่างและห้ามซ้ำ (ซ้ำ/ว่าง → ไม่โคลน บอกเหตุผล ไม่แต่งรหัสเอง เพราะรหัสคือคีย์จับคู่ Seniorsoft)
// ทดสอบ (test: true): ชื่อขึ้นต้น [TEST] · SellerSku ต่อท้าย -TEST · จำนวน 0 → ลบด้วย deleteTestItem
import { db } from './supabase.js';
import * as tiktok from './tiktok.js';
import * as lazada from './lazada.js';
import { saveListings } from './listings.js';
import { shopGroup } from './shopGroups.js';
import { fromTikTok, htmlToText, cleanTitle, shortenValues } from './productModel.js';
import { low, norm, pool, shopToken, skuSet, candidates, blockedIds, stCounts, titleKey, titleTwins, twinMsg } from './cloneCommon.js';
import MAP_SOLID from './cloneMaps/tiktok-lazada-solid.json';

const MAPS = { SOLID: MAP_SOLID };
const keyOf = (shop) => `tiktok:${shop}>lazada:${shop}`;
const MAX_IMAGES = 8;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toHtml = (text) => text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');

function pickBrand(model, map) {
  const byName = model.brand ? map.brands[norm(model.brand)] : null;
  if (byName) return byName;
  const t = norm(model.title);
  const hit = Object.entries(map.brands).find(([k]) => k.length >= 3 && t.includes(k));
  return hit ? hit[1] : 'No Brand';
}

// ปัญหาที่ทำให้โคลนไม่ได้ (ตรวจได้ก่อนลงมือ) — คืนข้อความ หรือ null
// pick = { cat: { lazada }, need } เมื่อผู้ใช้เลือกหมวดเอง
function blocker(m, map, pick = null) {
  const cat = pick?.cat || map.categories[m.categoryLeafId];
  if (!cat) return 'ไม่รู้หมวดของ Lazada (ยังไม่มีตะกร้าหมวดนี้ที่ลงทั้งสองร้าน) — เลือกหมวดเองได้';
  const need = pick?.need || map.mandatory[String(cat.lazada)] || {};
  const missing = Object.entries(need).filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length) return `หมวดนี้บังคับแอตทริบิวต์ ${missing.join(', ')} แต่ร้านยังไม่เคยกรอก`;
  const skus = m.variants.map((v) => v.sku);
  if (skus.some((s) => !s)) return 'มีตัวเลือกที่ไม่มีรหัส SKU (Lazada บังคับ)';
  const dup = skus.filter((s, i) => skus.findIndex((x) => low(x) === low(s)) !== i);
  if (dup.length) return `รหัส SKU ซ้ำกันในตะกร้า (${[...new Set(dup)].slice(0, 3).join(', ')}) — Lazada ไม่รับ แก้รหัสใน TikTok ก่อน`;
  if (m.variants.some((v) => !(v.price > 0))) return 'มีตัวเลือกที่ราคาเป็น 0';
  if (!m.images.length) return 'ไม่มีรูปสินค้า';
  return null;
}

// ── วางแผน ──
export async function planTiktokToLazada(shop = 'SOLID') {
  const map = MAPS[shop];
  if (!map) throw new Error(`ยังไม่มีแผนที่โคลนของร้าน ${shop} — รัน scripts/learn_clone_map_lazada.py`);
  const cand = await candidates({ srcPlatform: 'tiktok', dstPlatform: 'lazada', shop });
  const blocked = await blockedIds(keyOf(shop), cand.map((c) => c.id));
  const tt = await shopToken('tiktok', shop);
  const auth = { accessToken: tt.access_token, shopCipher: tt.shop_cipher };
  const items = await pool(cand, 6, async (c) => {
    const base = { ...c, cloned: blocked.get(c.id) || null };
    try {
      const m = fromTikTok(await tiktok.getProduct({ ...auth, productId: c.id }), shop);
      const cat = map.categories[m.categoryLeafId];
      return {
        ...base, category: m.categoryChain.join(' / '),
        lazadaCat: cat ? { id: cat.lazada, name: cat.lazadaName || String(cat.lazada), votes: cat.votes, of: cat.of, sure: cat.votes / cat.of >= 0.6 } : null,
        attrs: cat ? map.mandatory[String(cat.lazada)] || {} : {},
        brand: pickBrand(m, map),
        problem: blocker(m, map),
      };
    } catch (e) {
      return { ...base, problem: `อ่านจาก TikTok ไม่ได้: ${String(e.message || e).slice(0, 120)}` };
    }
  });
  const twins = await titleTwins('lazada', shop);
  for (const x of items) { const t = !x.cloned && twins.get(titleKey(x.title)); if (t) x.problem = twinMsg('Lazada', t); }
  return { items: items.sort((a, b) => String(a.title).localeCompare(String(b.title), 'th')), mapBuiltAt: map.builtAt };
}

// แอตทริบิวต์บังคับของหมวดที่ผู้ใช้เลือกเอง (ไม่อยู่ในแผนที่) — ถามสด แล้วเติมด้วยค่าที่ร้านใช้กับแอตทริบิวต์ชื่อเดียวกันในหมวดอื่น
async function liveMandatory(accessToken, catId, map) {
  const SKIP = new Set(['name', 'description', 'brand', 'short_description', 'name_en', 'description_en']);
  const attrs = (await lazada.call('/category/attributes/get', { accessToken, params: { primary_category_id: catId, language_code: 'th_TH' } })).data || [];
  const known = {};
  for (const m of Object.values(map.mandatory)) for (const [k, v] of Object.entries(m)) if (v !== null && known[k] === undefined) known[k] = v;
  const out = {};
  for (const a of attrs) if (a.is_mandatory && a.attribute_type === 'normal' && !SKIP.has(a.name)) out[a.name] = known[a.name] ?? null;
  return out;
}

// ── โคลนหนึ่งตะกร้า ──
// catPick: หมวด Lazada ที่ผู้ใช้เลือกเองในแผง (แทนหมวดที่เดาจากแผนที่)
export async function cloneTiktokToLazada({ id, shop = 'SOLID', test = false, catPick = null }) {
  const map = MAPS[shop];
  if (!map) throw new Error(`ยังไม่มีแผนที่โคลนของร้าน ${shop}`);
  id = String(id || '');
  if (!/^\d+$/.test(id)) throw new Error('เลขตะกร้า TikTok ไม่ถูกต้อง');
  const sb = db();
  if (!test) {
    const b = (await blockedIds(keyOf(shop), [id])).get(id);
    if (b) throw new Error(b.status === 'ok' ? `โคลนไปแล้ว (Lazada ${b.thisshop_spu_id})` : 'กำลังโคลนตะกร้านี้อยู่');
  }

  const tt = await shopToken('tiktok', shop);
  const m = fromTikTok(await tiktok.getProduct({ accessToken: tt.access_token, shopCipher: tt.shop_cipher, productId: id }), shop);
  const lz = await shopToken('lazada', shop);
  const accessToken = lz.access_token;
  const pick = catPick ? { cat: { lazada: Number(catPick) }, need: map.mandatory[String(catPick)] || await liveMandatory(accessToken, catPick, map) } : null;
  const why = blocker(m, map, pick);
  if (why) throw new Error(why);
  const onLazada = await skuSet('lazada', shop);
  const clash = m.variants.map((v) => v.sku).filter((s) => onLazada.has(low(s)));
  if (clash.length) throw new Error(`Lazada มี SKU นี้แล้ว (${clash.slice(0, 3).join(', ')}) — ไม่โคลน`);
  const twin = (await titleTwins('lazada', shop)).get(titleKey(m.title));
  if (twin) throw new Error(twinMsg('Lazada', twin));

  const cat = pick?.cat || map.categories[m.categoryLeafId];
  const need = pick?.need || map.mandatory[String(cat.lazada)] || {};

  let logId = null;
  if (!test) {
    const { data, error } = await sb.from('os_clone_log')
      .insert({ shopee_shop: keyOf(shop), shopee_product_id: id, status: 'pending', title: m.title }).select('id').single();
    if (error) throw new Error(error.message);
    logId = data.id;
  }
  const finish = (patch) => (logId ? sb.from('os_clone_log').update(patch).eq('id', logId).then(() => null, () => null) : null);
  const skuOf = (v) => `${v.sku}${test ? '-TEST' : ''}`;
  let created = null;   // item_id ที่เพิ่งสร้าง (ไว้ลบถ้าขั้นหลังพัง)
  try {
    // รูป → คลังของ Lazada (รูปสินค้า ≤8 + รูปของตัวเลือกชั้นแรก)
    const depth = Math.min(2, Math.max(0, ...m.variants.map((v) => v.options.length)));
    const optImg = new Map();
    if (depth >= 1) for (const v of m.variants) if (v.options[0]?.image && !optImg.has(v.options[0].value)) optImg.set(v.options[0].value, v.options[0].image);
    const gallery = m.images.slice(0, MAX_IMAGES);
    const urls = [...new Set([...gallery, ...optImg.values()])];
    const moved = new Map();
    await pool(urls, 4, async (u) => {
      try { moved.set(u, await lazada.migrateImage({ accessToken, url: u })); } catch (e) { moved.set(u, e); }
    });
    const okUrl = (u) => { const v = moved.get(u); return v && !(v instanceof Error) ? v : null; };
    if (!okUrl(gallery[0])) throw new Error(`รูปหลักย้ายเข้า Lazada ไม่ได้: ${moved.get(gallery[0])?.message || ''}`);
    const warnings = [...moved.values()].filter((v) => v instanceof Error).map((e) => `ข้ามรูป: ${e.message}`);

    let name = cleanTitle(m.title) || m.title;
    if (test) name = `[TEST] ลบได้ ${name}`;
    name = name.slice(0, 255);
    const text = htmlToText(m.descriptionHtml, 20000) || name;
    const attributes = { name, description: toHtml(text), brand: pickBrand(m, map), ...need };

    const kg = Math.max(0.01, Math.round((m.weightG / 1000) * 100) / 100);
    const dims = { l: Math.max(1, Math.round(m.dims.l)), w: Math.max(1, Math.round(m.dims.w)), h: Math.max(1, Math.round(m.dims.h)) };
    const stock = await stCounts(m.variants.map((v) => v.sku));
    const qtyOf = (v) => (test ? 0 : (stock.has(low(v.sku)) ? stock.get(low(v.sku)) : Math.max(0, Math.round(v.qty || 0))));

    // ตัวเลือก: ตั้งชื่อเองตามต้นทาง (ไม่ต้องแปลงเป็น color_family/size ของ Lazada)
    const names = [String(m.optionNames[0] || 'ตัวเลือก').slice(0, 20), String(m.optionNames[1] || 'ขนาด').slice(0, 20)];
    const v1 = [...new Set(m.variants.map((v) => v.options[0]?.value ?? ''))];
    const v2 = depth >= 2 ? [...new Set(m.variants.map((v) => v.options[1]?.value ?? ''))] : [];
    const s1 = shortenValues(v1, 50);
    const s2 = shortenValues(v2, 50);
    const variation = {};
    if (depth >= 1) variation.Variation1 = { name: names[0], hasImage: optImg.size > 0, customize: true, options: { option: v1.map((a) => s1.get(a) ?? a) } };
    if (depth >= 2) variation.Variation2 = { name: names[1], hasImage: false, customize: true, options: { option: v2.map((b) => s2.get(b) ?? b) } };

    const Sku = m.variants.map((v) => {
      const a = v.options[0]?.value ?? '';
      const b = v.options[1]?.value ?? '';
      const img = depth >= 1 ? okUrl(optImg.get(a)) : null;
      return {
        SellerSku: skuOf(v),
        ...(depth ? { saleProp: { [names[0]]: s1.get(a) ?? a, ...(depth >= 2 ? { [names[1]]: s2.get(b) ?? b } : {}) } } : {}),
        quantity: String(qtyOf(v)),
        price: String(v.price),
        package_weight: String(kg),
        package_length: String(dims.l),
        package_width: String(dims.w),
        package_height: String(dims.h),
        ...(img ? { Images: { Image: [img] } } : {}),
      };
    });

    const product = {
      PrimaryCategory: String(cat.lazada),
      Images: { Image: gallery.map(okUrl).filter(Boolean) },
      Attributes: attributes,
      ...(depth ? { variation } : {}),
      Skus: { Sku },
    };
    const r = await lazada.createProduct({ accessToken, product });
    const itemId = r.item_id ? String(r.item_id) : null;
    created = itemId;
    const got = (r.sku_list || []).length;
    if (got && got !== Sku.length) warnings.push(`ตัวเลือกใน Lazada ${got} ≠ ที่ส่งไป ${Sku.length}`);

    if (!test && itemId) {
      try {
        const p = await lazada.getProductItem({ accessToken, itemId });
        if (p) await saveListings([lazada.normalizeListing(p, shop, 'PENDING')]);   // ตะกร้าใหม่รอ Lazada ตรวจ (QC)
        await sb.from('os_compare_snap').delete().eq('grp', shopGroup('lazada', shop));
      } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
    }
    await finish({ status: 'ok', thisshop_spu_id: itemId, title: name, sku_n: Sku.length });
    return { itemId, name, categoryId: cat.lazada, brand: attributes.brand, attrs: need, skus: Sku.map((s) => s.SellerSku), models: got || Sku.length, images: gallery.map(okUrl).filter(Boolean).length, warnings };
  } catch (e) {
    // สร้างไปแล้วแต่ขั้นหลังพัง → ลบเฉพาะ SKU ที่เราเพิ่งสร้าง (รหัสชุดนี้ไม่เคยมีใน Lazada มาก่อน — ตรวจแล้วข้างบน)
    if (created) { try { await removeOwn(accessToken, created, m.variants.map(skuOf)); } catch { /* ไม่เป็นไร */ } }
    await finish({ status: 'failed', error: String(e.message || e).slice(0, 500) });
    throw e;
  }
}

// ลบ SKU ของตะกร้าที่เราเพิ่งสร้าง — เฉพาะ SKU ที่ SellerSku อยู่ในรายการที่เราส่งไปเท่านั้น
async function removeOwn(accessToken, itemId, sellerSkus) {
  const p = await lazada.getProductItem({ accessToken, itemId });
  const want = new Set(sellerSkus.map(low));
  const ids = (p?.skus || []).filter((x) => want.has(low(x.SellerSku))).map((x) => x.SkuId).filter(Boolean);
  if (ids.length) await lazada.removeSkus({ accessToken, itemId, skuIds: ids });
  return ids.length;
}

// ลบสินค้าทดสอบ — ยอมลบเฉพาะตะกร้าที่ชื่อขึ้นต้น [TEST] และทุก SellerSku ลงท้าย -TEST
export async function deleteTestItem({ itemId, shop = 'SOLID' }) {
  const lz = await shopToken('lazada', shop);
  const p = await lazada.getProductItem({ accessToken: lz.access_token, itemId });
  if (!p) throw new Error('ไม่พบสินค้านี้');
  const name = String(p.attributes?.name || '');
  const skus = (p.skus || []).map((s) => s.SellerSku);
  if (!name.startsWith('[TEST]') || !skus.length || skus.some((s) => !s || !s.endsWith('-TEST'))) {
    throw new Error('ไม่ใช่สินค้าทดสอบ ([TEST] + SKU -TEST) — ไม่ลบ');
  }
  await lazada.removeSkus({ accessToken: lz.access_token, itemId, skuIds: p.skus.map((s) => s.SkuId) });
  return { deleted: String(itemId), skus };
}
