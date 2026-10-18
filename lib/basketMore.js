// หน้าแก้ไขสินค้า ส่วน "การขายและจัดส่ง" + "ยี่ห้อและคุณสมบัติ" (app/product/BasketMore.js) — Shopee / TikTok / Lazada
//   moreInfo   อ่านสด: สถานะเปิด/ปิดขาย · น้ำหนัก/ขนาดพัสดุ · ตารางไซส์ · ยี่ห้อ · แอตทริบิวต์ของหมวด (ค่าปัจจุบัน + ตัวเลือก)
//   brandSearch ค้นยี่ห้อที่ใช้ได้ในหมวดของตะกร้า
//   setStatus  เปิด/ปิดการขาย
//   setMore    น้ำหนัก/ขนาด · ตารางไซส์ · ยี่ห้อ · แอตทริบิวต์ — ส่งเฉพาะที่เปลี่ยน
//
// แต่ละแพลตฟอร์ม:
//   Shopee  สถานะ unlist_item · ที่เหลือ update_item (weight kg, dimension cm, size_chart_info, brand, attribute_list ทั้งชุด)
//   TikTok  สถานะ products/activate|deactivate · ที่เหลือ partial_edit (ต้องรอตรวจ) package_weight/package_dimensions/size_chart/brand_id/product_attributes ทั้งชุด
//   Lazada  สถานะ + พัสดุ ระดับ SKU ผ่าน /product/update (ทุก SKU ค่าเดียวกัน เรียงตามลำดับตัวเลือก — ดู byOptionOrder) · ยี่ห้อ/แอตทริบิวต์ใน Attributes
//           ไม่มีตารางไซส์ใน API
import * as shopee from './shopee.js';
import * as tiktok from './tiktok.js';
import * as lazada from './lazada.js';
import { shopeeAuth } from './discounts.js';
import { db } from './supabase.js';
import { saveListings } from './listings.js';
import { shopGroup } from './shopGroups.js';
import { markCompareStale } from './compareSnap.js';
import { BasketError } from './basket.js';
import { ttAuth, auditing, partialEdit, readItem as ttRead } from './basketTiktok.js';
import { lzAuth, retry, byOptionOrder, readItem as lzRead } from './basketLazada.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const r2 = (x) => Math.round(x * 100) / 100;

// ── ตรวจค่าที่ส่งมา (ทุกแพลตฟอร์ม) ──
function checkPkg(pkg) {
  const w = num(pkg?.weight), l = num(pkg?.l), wd = num(pkg?.w), h = num(pkg?.h);
  if (!(w > 0 && w <= 100)) throw new BasketError('น้ำหนักต้องมากกว่า 0 และไม่เกิน 100 กก.');
  for (const [k, v] of [['ยาว', l], ['กว้าง', wd], ['สูง', h]]) if (!(v > 0 && v <= 300)) throw new BasketError(`${k}ต้องมากกว่า 0 และไม่เกิน 300 ซม.`);
  return { weight: r2(w), l: r2(l), w: r2(wd), h: r2(h) };
}
// attrs: [{ id, values: [{ id?, name }] }] — ค่าว่าง = เอาออก (ถ้าไม่บังคับ)
function checkAttrs(attrs, defs) {
  if (!Array.isArray(attrs)) throw new BasketError('แอตทริบิวต์ไม่ถูกต้อง');
  const byId = new Map(defs.map((d) => [String(d.id), d]));
  return attrs.map((a) => {
    const d = byId.get(String(a?.id));
    if (!d) throw new BasketError(`ไม่รู้จักแอตทริบิวต์ ${a?.id} ในหมวดนี้`);
    const values = (Array.isArray(a.values) ? a.values : []).map((v) => ({ id: v?.id ? String(v.id) : null, name: String(v?.name ?? '').trim().slice(0, 200) })).filter((v) => v.id || v.name);
    if (d.required && !values.length) throw new BasketError(`"${d.name}" บังคับต้องมีค่า`);
    if (!d.multi && values.length > 1) throw new BasketError(`"${d.name}" เลือกได้ค่าเดียว`);
    for (const v of values) {
      if (v.id && d.options.length && !d.options.some((o) => String(o.id) === v.id)) throw new BasketError(`ค่าของ "${d.name}" ไม่อยู่ในตัวเลือก`);
      if (!v.id && d.options.length && !d.custom) throw new BasketError(`"${d.name}" ต้องเลือกจากตัวเลือก พิมพ์เองไม่ได้`);
    }
    return { id: String(d.id), values, def: d };
  });
}

// ═════════════ Shopee ═════════════
const SP_MULTI = /MULTIPLE/i;
const SP_CUSTOM = /COMBO_BOX|TEXT/i;
async function spBase(auth, itemId) {
  const [b] = await shopee.getItemBaseInfo({ ...auth, itemIds: [String(itemId)] });
  if (!b) throw new BasketError('ไม่พบตะกร้านี้ใน Shopee');
  return b;
}
async function spDefs(auth, base) {
  const tree = await shopee.getAttributeTree({ ...auth, categoryId: base.category_id });
  const cur = new Map((base.attribute_list || []).map((a) => [String(a.attribute_id), a.attribute_value_list || []]));
  return tree.map((a) => {
    const input = String(a.attribute_info?.input_type || a.input_type || '');
    return {
      id: String(a.attribute_id), name: a.name || a.display_attribute_name || a.original_attribute_name || String(a.attribute_id),
      required: Boolean(a.mandatory), multi: SP_MULTI.test(input), custom: SP_CUSTOM.test(input) || !(a.attribute_value_list || []).length,
      options: (a.attribute_value_list || []).map((v) => ({ id: String(v.value_id), name: v.name || v.display_value_name || v.original_value_name || String(v.value_id) })),
      value: (cur.get(String(a.attribute_id)) || []).map((v) => ({ id: v.value_id ? String(v.value_id) : null, name: v.original_value_name || '' })),
    };
  });
}
async function spInfo(shop, itemId) {
  const auth = await shopeeAuth(shop);
  const b = await spBase(auth, itemId);
  const d = b.dimension || {};
  const sc = b.size_chart_info || {};
  return {
    status: { on: b.item_status === 'NORMAL', raw: b.item_status, canToggle: ['NORMAL', 'UNLIST'].includes(b.item_status) },
    pkg: { weight: num(b.weight), l: num(d.package_length), w: num(d.package_width), h: num(d.package_height), note: null },
    sizeChart: { supported: true, image_id: sc.size_chart || null, image_url: b.size_chart || sc.size_chart_url || null, template: sc.size_chart_id || null },
    brand: { id: b.brand?.brand_id != null ? String(b.brand.brand_id) : null, name: b.brand?.original_brand_name || null, search: true },
    attrs: await spDefs(auth, b),
  };
}
async function spBrands(shop, itemId, q) {
  const auth = await shopeeAuth(shop);
  const b = await spBase(auth, itemId);
  const want = String(q || '').trim().toLowerCase();
  const out = [{ id: '0', name: 'NoBrand (ไม่มียี่ห้อ)' }];
  for (let offset = 0, i = 0; i < 15; i += 1) {
    const r = await shopee.call('/api/v2/product/get_brand_list', { ...auth, params: { category_id: b.category_id, status: 1, offset, page_size: 100, language: 'th' } });
    for (const x of r.brand_list || []) out.push({ id: String(x.brand_id), name: x.display_brand_name || x.original_brand_name });
    if (!r.has_next_page) break;
    offset = r.next_offset;
  }
  return out.filter((x) => !want || x.name.toLowerCase().includes(want)).slice(0, 50);
}
async function spAfter(auth, shop, itemId) {
  await sleep(1200);
  try {
    const [base] = await shopee.getItemBaseInfo({ ...auth, itemIds: [String(itemId)] });
    const models = base.has_model ? await shopee.getModelList({ ...auth, itemId }) : null;
    await saveListings([shopee.normalizeListing(base, models, shop)]);
    await markCompareStale(shopGroup('shopee', shop));
  } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
}
async function spStatus(shop, itemId, on) {
  const auth = await shopeeAuth(shop);
  const b = await spBase(auth, itemId);
  if (!['NORMAL', 'UNLIST'].includes(b.item_status)) throw new BasketError(`ตะกร้าสถานะ ${b.item_status} — เปิด/ปิดจากเว็บไม่ได้`);
  await shopee.setUnlisted({ ...auth, itemId, unlist: !on });
  await spAfter(auth, shop, itemId);
  return { warnings: [] };
}
async function spMore(shop, itemId, { pkg, sizeChart, brand, attrs }) {
  const auth = await shopeeAuth(shop);
  const b = await spBase(auth, itemId);
  const body = { item_id: Number(itemId) };
  if (pkg) {
    const p = checkPkg(pkg);
    body.weight = p.weight;
    body.dimension = { package_length: Math.max(1, Math.round(p.l)), package_width: Math.max(1, Math.round(p.w)), package_height: Math.max(1, Math.round(p.h)) };
  }
  if (sizeChart) {
    if (!/^[\w-]{6,80}$/.test(String(sizeChart))) throw new BasketError('รหัสรูปตารางไซส์ไม่ถูกต้อง');
    body.size_chart_info = { size_chart: String(sizeChart) };
  }
  if (brand) {
    const id = Number(brand.id);
    if (!Number.isInteger(id) || id < 0) throw new BasketError('ยี่ห้อไม่ถูกต้อง');
    body.brand = { brand_id: id, original_brand_name: id ? String(brand.name || '').slice(0, 100) : 'NoBrand' };
  }
  if (attrs) {
    const defs = await spDefs(auth, b);
    const list = checkAttrs(attrs, defs);
    const merged = new Map(defs.filter((d) => d.value.length).map((d) => [d.id, d.value]));
    for (const a of list) { if (a.values.length) merged.set(a.id, a.values); else merged.delete(a.id); }
    for (const d of defs) if (d.required && !merged.has(d.id)) throw new BasketError(`"${d.name}" บังคับต้องมีค่า`);
    body.attribute_list = [...merged].map(([id, vals]) => ({
      attribute_id: Number(id),
      attribute_value_list: vals.map((v) => ({ value_id: v.id ? Number(v.id) : 0, ...(v.name ? { original_value_name: v.name } : {}) })),
    }));
  }
  if (Object.keys(body).length === 1) throw new BasketError('ไม่มีอะไรเปลี่ยน — ไม่มีอะไรให้บันทึก');
  await shopee.call('/api/v2/product/update_item', { ...auth, method: 'POST', body });
  await spAfter(auth, shop, itemId);
  return { warnings: [] };
}

// ═════════════ TikTok ═════════════
const toKg = (w) => { const v = num(w?.value); if (v === null) return null; return /GRAM/i.test(w.unit) && !/KILO/i.test(w.unit) ? v / 1000 : /POUND/i.test(w.unit) ? v * 0.4536 : v; };
const toCm = (v, unit) => { const n = num(v); if (n === null) return null; return /INCH/i.test(unit || '') ? n * 2.54 : n; };
const leafOf = (p) => (p.category_chains || []).find((c) => c.is_leaf)?.id || null;
async function ttDefs(auth, p) {
  const leaf = leafOf(p);
  if (!leaf) return [];
  const attrs = (await tiktok.call(`/product/202309/categories/${leaf}/attributes`, { ...auth, query: { category_version: 'v2' } })).attributes || [];
  const cur = new Map((p.product_attributes || []).map((a) => [String(a.id), a.values || []]));
  return attrs.filter((a) => a.type === 'PRODUCT_PROPERTY').map((a) => ({
    id: String(a.id), name: a.name || String(a.id), required: Boolean(a.is_requried ?? a.is_required),
    multi: Boolean(a.is_multiple_selection), custom: Boolean(a.is_customizable) || !(a.values || []).length,
    options: (a.values || []).map((v) => ({ id: String(v.id), name: v.name })),
    value: (cur.get(String(a.id)) || []).map((v) => ({ id: v.id ? String(v.id) : null, name: v.name || '' })),
  }));
}
async function ttInfo(shop, itemId) {
  const auth = await ttAuth(shop);
  const p = await tiktok.getProduct({ ...auth, productId: String(itemId) });
  if (!p?.id) throw new BasketError('ไม่พบตะกร้านี้ใน TikTok');
  const d = p.package_dimensions || {};
  return {
    status: { on: p.status === 'ACTIVATE', raw: p.status, canToggle: ['ACTIVATE', 'SELLER_DEACTIVATED'].includes(p.status) },
    pkg: { weight: toKg(p.package_weight), l: toCm(d.length, d.unit), w: toCm(d.width, d.unit), h: toCm(d.height, d.unit), note: 'TikTok ต้องรอตรวจ' },
    sizeChart: { supported: true, image_id: p.size_chart?.image?.uri || null, image_url: (p.size_chart?.image?.urls || [])[0] || null, template: p.size_chart?.template?.id || null },
    brand: { id: p.brand?.id ? String(p.brand.id) : null, name: p.brand?.name || null, search: true },
    attrs: await ttDefs(auth, p),
    auditing: auditing(p),
  };
}
async function ttBrands(shop, itemId, q) {
  const auth = await ttAuth(shop);
  const p = await tiktok.getProduct({ ...auth, productId: String(itemId) });
  const r = await tiktok.call('/product/202309/brands', { ...auth, query: { category_id: leafOf(p) || '', page_size: 100, category_version: 'v2', ...(q ? { brand_name: String(q).slice(0, 50) } : {}) } });
  return (r.brands || []).map((b) => ({ id: String(b.id), name: b.name })).slice(0, 50);
}
async function ttStatus(shop, itemId, on) {
  const auth = await ttAuth(shop);
  const p = await tiktok.getProduct({ ...auth, productId: String(itemId) });
  if (!['ACTIVATE', 'SELLER_DEACTIVATED'].includes(p.status)) throw new BasketError(`ตะกร้าสถานะ ${p.status} — เปิด/ปิดจากเว็บไม่ได้`);
  const r = await tiktok.call(`/product/202309/products/${on ? 'activate' : 'deactivate'}`, { ...auth, method: 'POST', body: { product_ids: [String(itemId)] } });
  const err = (r.errors || [])[0];
  if (err) throw new Error(`TikTok ${on ? 'เปิด' : 'ปิด'}การขายไม่สำเร็จ: ${err.message || err.code || 'ไม่ทราบสาเหตุ'}`);
  return { warnings: on ? ['TikTok อาจต้องตรวจก่อนกลับมาขาย'] : [] };
}
async function ttMore(shop, itemId, { pkg, sizeChart, brand, attrs }) {
  const auth = await ttAuth(shop);
  const before = await ttRead(auth, itemId);
  const { p } = before;
  if (auditing(p)) throw new BasketError('การแก้ไขครั้งก่อนของตะกร้านี้ยังรอ TikTok ตรวจ — รอผ่านก่อนค่อยแก้อีก');
  const body = {};
  if (pkg) {
    const x = checkPkg(pkg);
    body.package_weight = { value: String(x.weight), unit: 'KILOGRAM' };
    body.package_dimensions = { length: String(Math.max(1, Math.round(x.l))), width: String(Math.max(1, Math.round(x.w))), height: String(Math.max(1, Math.round(x.h))), unit: 'CENTIMETER' };
  }
  if (sizeChart) {
    if (!/^[\w.~/-]{6,400}$/.test(String(sizeChart))) throw new BasketError('รหัสรูปตารางไซส์ไม่ถูกต้อง');
    body.size_chart = { image: { uri: String(sizeChart) } };
  }
  if (brand) {
    if (!/^\d{1,30}$/.test(String(brand.id || ''))) throw new BasketError('ยี่ห้อไม่ถูกต้อง');
    body.brand_id = String(brand.id);
  }
  if (attrs) {
    const defs = await ttDefs(auth, p);
    const list = checkAttrs(attrs, defs);
    const merged = new Map(defs.filter((d) => d.value.length).map((d) => [d.id, d.value]));
    for (const a of list) { if (a.values.length) merged.set(a.id, a.values); else merged.delete(a.id); }
    for (const d of defs) if (d.required && !merged.has(d.id)) throw new BasketError(`"${d.name}" บังคับต้องมีค่า`);
    body.product_attributes = [...merged].map(([id, vals]) => ({ id, values: vals.map((v) => (v.id ? { id: v.id } : { name: v.name })) }));
  }
  if (!Object.keys(body).length) throw new BasketError('ไม่มีอะไรเปลี่ยน — ไม่มีอะไรให้บันทึก');
  const warnings = await partialEdit(auth, itemId, body, before.models.length);
  return { warnings };
}

// ═════════════ Lazada ═════════════
const LZ_SKIP = new Set(['name', 'description', 'short_description', 'name_en', 'description_en', 'short_description_en', 'brand']);
async function lzDefs(auth, it) {
  const all = (await retry(() => lazada.call('/category/attributes/get', { ...auth, params: { primary_category_id: String(it.primary_category), language_code: 'th_TH' } }))).data || [];
  const cur = it.attributes || {};
  return all.filter((a) => a.attribute_type === 'normal' && !LZ_SKIP.has(a.name) && !/richText|img/i.test(a.input_type || '')).map((a) => {
    const multi = /multi/i.test(a.input_type || '');
    const raw = cur[a.name];
    const vals = raw === undefined || raw === null || raw === '' ? [] : (multi ? String(raw).split(',') : [String(raw)]).map((x) => x.trim()).filter(Boolean);
    return {
      id: a.name, name: a.label || a.name, required: Boolean(a.is_mandatory), multi,
      custom: !(a.options || []).length || /enumInput|text|numeric/i.test(a.input_type || ''),
      options: (a.options || []).map((o) => ({ id: o.name, name: o.name })),
      value: vals.map((v) => ({ id: (a.options || []).some((o) => o.name === v) ? v : null, name: v })),
    };
  });
}
async function lzInfo(shop, itemId) {
  const auth = await lzAuth(shop);
  const { it } = await lzRead(auth, itemId);
  const s = (it.skus || [])[0] || {};
  const sizes = new Set((it.skus || []).map((x) => [x.package_weight, x.package_length, x.package_width, x.package_height].join('|')));
  const st = (it.skus || []).map((x) => String(x.Status || '').toLowerCase());
  return {
    status: { on: st.some((x) => x === 'active'), raw: it.status, canToggle: st.length > 0 && st.every((x) => ['active', 'inactive'].includes(x)) },
    pkg: { weight: num(s.package_weight), l: num(s.package_length), w: num(s.package_width), h: num(s.package_height), note: sizes.size > 1 ? 'แต่ละ SKU ตั้งพัสดุไม่เท่ากัน — บันทึกแล้วทุก SKU จะเป็นค่าเดียวกัน' : null },
    sizeChart: { supported: false },
    brand: { id: it.attributes?.brand || null, name: it.attributes?.brand || null, search: false },
    attrs: await lzDefs(auth, it),
  };
}
// ส่ง /product/update ทั้งตะกร้า: Attributes (ชื่อเดิม + ที่แก้) + ทุก SKU เรียงตามลำดับตัวเลือก (+ ฟิลด์ระดับ SKU ที่แก้)
async function lzUpdate(auth, shop, itemId, { attributes = {}, sku = {} }) {
  const { it, models } = await lzRead(auth, itemId);
  const byId = new Map((it.skus || []).map((s) => [String(s.SkuId), s]));
  const skus = byOptionOrder(models).map((m) => byId.get(m.model_id)).filter(Boolean).map((s) => ({ ItemId: String(itemId), SkuId: String(s.SkuId), SellerSku: s.SellerSku, ...sku }));
  if (skus.length !== (it.skus || []).length) throw new Error('อ่าน SKU เดิมไม่ครบ — ไม่บันทึก');
  const product = { ItemId: String(itemId), Attributes: { name: it.attributes?.name, ...attributes }, Skus: { Sku: skus } };
  await retry(() => lazada.callPost('/product/update', { ...auth, body: { payload: JSON.stringify({ Request: { Product: product } }) } }));
  await sleep(1500);
  try {
    const after = await retry(() => lazada.getProductItem({ ...auth, itemId }));
    const { data: l } = await db().from('os_listings').select('status').eq('platform', 'lazada').eq('shop', shop).eq('product_id', String(itemId)).maybeSingle();
    if (after && l) { await saveListings([lazada.normalizeListing(after, shop, l.status)]); await markCompareStale(shopGroup('lazada', shop)); }
  } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
}
async function lzStatus(shop, itemId, on) {
  const auth = await lzAuth(shop);
  await lzUpdate(auth, shop, itemId, { sku: { Status: on ? 'active' : 'inactive' } });
  return { warnings: [] };
}
async function lzMore(shop, itemId, { pkg, sizeChart, brand, attrs }) {
  if (sizeChart) throw new BasketError('Lazada ไม่มี API ตารางไซส์ — ใส่ในหลังร้าน Lazada');
  const auth = await lzAuth(shop);
  const attributes = {};
  let sku = {};
  if (pkg) {
    const x = checkPkg(pkg);
    sku = { package_weight: String(x.weight), package_length: String(x.l), package_width: String(x.w), package_height: String(x.h) };
  }
  if (brand) {
    const name = String(brand.name || brand.id || '').trim();
    if (!name || name.length > 100) throw new BasketError('ยี่ห้อไม่ถูกต้อง');
    attributes.brand = name;
  }
  if (attrs) {
    const { it } = await lzRead(auth, itemId);
    const defs = await lzDefs(auth, it);
    for (const a of checkAttrs(attrs, defs)) attributes[a.id] = a.values.map((v) => v.id || v.name).join(',');
  }
  if (!pkg && !Object.keys(attributes).length) throw new BasketError('ไม่มีอะไรเปลี่ยน — ไม่มีอะไรให้บันทึก');
  await lzUpdate(auth, shop, itemId, { attributes, sku });
  return { warnings: [] };
}

// ═════════════ รวม ═════════════
const P = {
  shopee: { info: spInfo, brands: spBrands, status: spStatus, more: spMore },
  tiktok: { info: ttInfo, brands: ttBrands, status: ttStatus, more: ttMore },
  lazada: { info: lzInfo, brands: async () => [], status: lzStatus, more: lzMore },
};
const pf = (platform) => { const x = P[platform]; if (!x) throw new BasketError('ไม่รู้จักแพลตฟอร์มนี้'); return x; };
export const moreInfo = (platform, shop, itemId) => pf(platform).info(shop, itemId);
export const brandSearch = (platform, shop, itemId, q) => pf(platform).brands(shop, itemId, q);
export const setStatus = (platform, shop, itemId, on) => pf(platform).status(shop, itemId, Boolean(on));
export function setMore(platform, shop, itemId, body) {
  const pick = {
    pkg: body.pkg && typeof body.pkg === 'object' ? body.pkg : null,
    sizeChart: typeof body.sizeChart === 'string' && body.sizeChart ? body.sizeChart : null,
    brand: body.brand && typeof body.brand === 'object' ? body.brand : null,
    attrs: Array.isArray(body.attrs) && body.attrs.length ? body.attrs : null,
  };
  return pf(platform).more(shop, itemId, pick);
}
