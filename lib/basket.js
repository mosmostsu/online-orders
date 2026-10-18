// แก้ตะกร้า Shopee ที่มีอยู่แล้ว: เพิ่มตัวเลือก (สี/ไซส์) + สร้าง SKU ใหม่ — หน้ารายละเอียดสินค้า (app/product/BasketAdd.js)
//
// ทำได้อย่างเดียวคือ "เพิ่ม" — ไม่ลบ/ไม่เปลี่ยนชื่อ/ไม่เรียงตัวเลือกเดิมใหม่ ไม่แตะราคา/คลัง/SKU ของตัวเลือกเดิม
// ไม่ลบแล้วสร้างตะกร้าใหม่ (ยอดขาย/รีวิวผูกเลขตะกร้า)
//
// ขั้นตอนตอนบันทึก (shopeeAddOptions):
//   1. อ่านตะกร้าสดจาก Shopee — ตรวจทุกอย่างกับของจริง ไม่เชื่อที่เบราว์เซอร์ส่งมา
//   2. update_tier_variation: ตัวเลือกเดิมตามลำดับเดิม + ตัวใหม่ต่อท้าย
//      ⚠ model_list ต้องส่งตัวเลือกเดิมครบทุกตัว (tier_index เดิม) — ตัวที่ไม่ส่ง Shopee ลบทิ้ง
//   3. อ่านซ้ำ — ตัวเลือกเดิมต้องอยู่ครบ ไม่งั้นหยุดทันที
//   4. add_model ทีละ 50 — พังตั้งแต่ชุดแรก (ยังไม่มี SKU ใหม่เลย) → ถอยตัวเลือกกลับเป็นแบบเดิม
//   5. อ่านซ้ำ เก็บลงฐานข้อมูลให้หน้าเว็บเห็นทันที
import * as shopee from './shopee.js';
import { shopeeAuth } from './discounts.js';
import { db } from './supabase.js';
import { saveListings } from './listings.js';
import { shopGroup } from './shopGroups.js';
import { markCompareStale } from './compareSnap.js';

export class BasketError extends Error {}   // ข้อมูลที่ส่งมาผิด → 400

const OPT_MAX = 20;          // Shopee จำกัดชื่อตัวเลือกไม่เกิน 20 ตัวอักษร
const SKU_MAX = 100;
const ST_BUFFER = 2;         // คลังเริ่มต้นของ SKU ใหม่ = ST − บัฟเฟอร์ (ผู้ใช้แก้ได้) — ดูมาตรการกันชิ้นสุดท้ายใน CLAUDE.md
const up = (s) => String(s ?? '').trim().toUpperCase();
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ไซส์ที่รู้จัก — ใช้แยกรหัส ST เป็น รหัสสี + ไซส์ (รวมกับชื่อไซส์ที่ตะกร้ามีอยู่แล้วตอนใช้งาน)
// บางกลุ่มข้าม 3L (S M L XL XXL 4L 5L) — ไม่เดาแปลงชื่อ ใช้ตามรหัสจริง
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL', '2L', '3L', '4L', '5L', '6L', '7L', 'F', 'FREE'];
const isSizeText = (t) => SIZES.includes(up(t)) || /^\d{1,3}(\.5)?$/.test(String(t).trim());

// ── อ่านตะกร้าสด ──
async function readItem(auth, itemId) {
  const [base] = await shopee.getItemBaseInfo({ ...auth, itemIds: [String(itemId)] });
  if (!base) throw new BasketError('ไม่พบตะกร้านี้ใน Shopee');
  if (!base.has_model) return { base, tiers: [], models: [] };
  const r = await shopee.getModelList({ ...auth, itemId });
  const tiers = (r.tier_variation || []).map((t) => ({
    name: t.name,
    options: (t.option_list || []).map((o) => ({ text: o.option, image_id: o.image?.image_id || null, image_url: o.image?.image_url || null })),
  }));
  const models = (r.model || []).map((m) => ({
    model_id: String(m.model_id),
    tier_index: m.tier_index || [],
    sku: m.model_sku || '',
    price: m.price_info?.[0]?.original_price ?? null,
    stock: m.stock_info_v2?.summary_info?.total_available_stock ?? null,
  }));
  return { base, tiers, models, raw: r };
}

// ชั้นไหนเป็นไซส์ — ตัวเลือกส่วนใหญ่หน้าตาเป็นไซส์ (ดูจากชั้นท้ายก่อน)
function sizeTierOf(tiers) {
  for (let t = tiers.length - 1; t >= 0; t -= 1) {
    const o = tiers[t].options;
    if (o.length && o.filter((x) => isSizeText(x.text)).length * 2 >= o.length) return t;
  }
  return -1;
}

// รหัสสีของตัวเลือกแต่ละตัว: SKU เดิม = รหัสสี + ไซส์ (เช่น 062541000 + S) → ตัดไซส์ท้ายออก
// คืน Map(ข้อความตัวเลือกสี → รหัส) · ตะกร้าชั้นเดียว (มีแต่ไซส์) ใช้คีย์ ''
function colorCodes(tiers, models, sizeTier) {
  const colorTier = tiers.length === 2 ? 1 - sizeTier : -1;
  const votes = new Map();
  if (sizeTier < 0) return new Map();
  for (const m of models) {
    const size = tiers[sizeTier].options[m.tier_index[sizeTier]]?.text;
    if (!m.sku || !size || !up(m.sku).endsWith(up(size)) || m.sku.length <= size.length) continue;
    const key = colorTier >= 0 ? tiers[colorTier].options[m.tier_index[colorTier]]?.text ?? '' : '';
    const code = m.sku.slice(0, m.sku.length - size.length);
    const v = votes.get(key) || new Map();
    v.set(code, (v.get(code) || 0) + 1);
    votes.set(key, v);
  }
  const out = new Map();
  for (const [k, v] of votes) out.set(k, [...v.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

// คำนำหน้าที่ใช้หารหัส ST รุ่นเดียวกัน: ส่วนที่เหมือนกันของรหัสสีทุกตัว
// มีสีเดียว → ตัดท้ายรหัสออก 4 ตัว (เหลืออย่างน้อย 4) เช่น 062541000 → 06254, b517B → b517
function stPrefix(codes) {
  const list = [...new Set(codes)].filter(Boolean);
  if (!list.length) return null;
  let p = list[0];
  if (list.length === 1) p = p.slice(0, Math.max(4, p.length - 4));
  for (const c of list.slice(1)) { let i = 0; while (i < p.length && i < c.length && up(p[i]) === up(c[i])) i += 1; p = p.slice(0, i); }
  return p.length >= 4 ? p : null;
}

// แยกรหัส ST → { code, size } โดยจับไซส์ยาวสุดก่อน (กัน XL ถูกตัดเป็น L)
function splitSt(sku, sizeTokens) {
  const u = up(sku);
  for (const s of sizeTokens) if (u.length > s.length && u.endsWith(s)) return { code: sku.slice(0, sku.length - s.length), size: s };
  return null;
}

async function stRowsByPrefix(prefixes) {
  const out = [];
  for (const p of prefixes) {
    // _ กับ % ในรหัสต้องหนีก่อนใช้ ilike
    const pat = p.replace(/[\\%_]/g, (c) => `\\${c}`) + '%';
    const { data, error } = await db().from('os_st').select('sku, name, group_name, qty, price').ilike('sku', pat).limit(400);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
  }
  return [...new Map(out.map((r) => [up(r.sku), r])).values()];
}

// ชื่อสีจาก ST: คำใน group_name ที่ไม่มีในชื่อของสีที่ตะกร้ามีอยู่แล้ว (ชื่อรุ่นเหมือนกัน ต่างกันแค่สี)
function colorNameFrom(groupName, refGroup) {
  const ref = new Set(String(refGroup || '').split(/\s+/));
  const diff = String(groupName || '').split(/\s+/).filter((w) => w && !ref.has(w));
  const t = (diff.length ? diff.join(' ') : String(groupName || '').split(/\s+/).pop() || '').trim();
  return t.slice(0, OPT_MAX);
}

const needImage = (tiers) => Boolean(tiers[0]?.options.length) && tiers[0].options.every((o) => o.image_id);
function galleryOf(base, tiers) {
  const ids = base.image?.image_id_list || [];
  const urls = base.image?.image_url_list || [];
  const out = ids.map((id, i) => ({ image_id: id, image_url: urls[i] || null }));
  for (const o of tiers[0]?.options || []) if (o.image_id) out.push({ image_id: o.image_id, image_url: o.image_url });
  return [...new Map(out.filter((x) => x.image_url).map((x) => [x.image_id, x])).values()];
}

// อัปโหลดรูปจากเครื่อง (รูปของสีใหม่) เข้าคลังสื่อ Shopee — ยังไม่ผูกกับตะกร้าจนกว่าจะกดบันทึก
export async function uploadBasketImage(shop, bytes, type) {
  if (!/^image\/(jpeg|png)$/.test(type)) throw new BasketError('รูปต้องเป็น JPG หรือ PNG');
  if (bytes.length > 4 * 1024 * 1024) throw new BasketError('รูปใหญ่เกิน 4MB');
  const auth = await shopeeAuth(shop);
  return shopee.uploadImage({ bytes, contentType: type, filename: type === 'image/png' ? 'a.png' : 'a.jpg', partner: auth.partner });
}

// ── หน้าจอเปิดมา: ตะกร้าสด + รหัสสีที่เดาได้ + ข้อเสนอจาก ST ──
export async function shopeeBasketPlan(shop, itemId) {
  const auth = await shopeeAuth(shop);
  const { base, tiers, models } = await readItem(auth, itemId);
  const out = {
    itemId: String(itemId), title: base.item_name || null, status: base.item_status || null,
    hasModel: Boolean(base.has_model), tiers: tiers.map((t) => ({ name: t.name, options: t.options.map((o) => ({ text: o.text, image_id: o.image_id, image_url: o.image_url })) })),
    // ชั้นแรกมีรูปครบทุกตัว → ตัวเลือกใหม่ในชั้นแรกต้องมีรูปด้วย (Shopee บังคับ "มีรูปทุกตัวหรือไม่มีเลย")
    needImage: needImage(tiers),
    // รูปที่ตะกร้ามีอยู่แล้ว (รูปสินค้า + รูปตัวเลือก) — เลือกใช้เป็นรูปของสีใหม่ได้โดยไม่ต้องอัปโหลด
    gallery: galleryOf(base, tiers),
    // รูปสินค้าตามลำดับจริง (แก้ได้ในส่วน "รูปสินค้า" — shopeeSetImages)
    main: (base.image?.image_id_list || []).map((id, i) => ({ image_id: id, image_url: base.image?.image_url_list?.[i] || null })),
    maxImages: 9,
    models: models.map(({ model_id, tier_index, sku, price, stock }) => ({ model_id, tier_index, sku, price, stock })),
    sizeTier: -1, codes: {}, prefix: null, st: [], suggest: { colors: [], sizes: [] }, siblings: [],
    info: await shopeeInfo(auth, base),
  };
  if (!out.hasModel) return out;
  return withSiblings(await addStPlan(out, tiers, models), 'shopee', shop, tiers, models);
}

// ── ข้อมูลสินค้า (ชื่อ / รายละเอียด / หมวด) ──
// รายการหมวดของ Shopee (เหมือนกันทุกร้าน) — เก็บในหน่วยความจำ 12 ชม.
let catCache = null;
async function shopeeCategories(auth) {
  if (catCache && Date.now() - catCache.at < 12 * 3600e3) return catCache.map;
  const r = await shopee.call('/api/v2/product/get_category', { ...auth, params: { language: 'th' } });
  const map = new Map((r.category_list || []).map((c) => [Number(c.category_id), {
    id: Number(c.category_id), parent: Number(c.parent_category_id) || 0, leaf: !c.has_children,
    name: c.display_category_name || c.original_category_name || String(c.category_id),
  }]));
  catCache = { at: Date.now(), map };
  return map;
}
const catPath = (map, id) => {
  const out = [];
  for (let c = map.get(Number(id)), n = 0; c && n < 8; c = map.get(c.parent), n += 1) out.unshift(c.name);
  return out.join(' / ');
};

// หมวดปลายทั้งหมด (เลือกหมวดใหม่ได้เฉพาะหมวดปลาย) → [{ id, path }]
export async function shopeeCategoryList(shop) {
  const map = await shopeeCategories(await shopeeAuth(shop));
  return [...map.values()].filter((c) => c.leaf).map((c) => ({ id: c.id, path: catPath(map, c.id) })).sort((a, b) => a.path.localeCompare(b.path, 'th'));
}

async function shopeeInfo(auth, base) {
  let path = null;
  try { path = catPath(await shopeeCategories(auth), base.category_id); } catch { /* ไม่มีชื่อหมวดก็แสดงเลขแทน */ }
  const extended = base.description_type === 'extended';
  return {
    title: base.item_name || '', titleMax: 120,
    // รายละเอียดแบบมีรูปแทรก (extended) แก้จากเว็บไม่ได้ — แก้ข้อความแล้วรูปที่แทรกไว้จะหาย
    description: extended ? (base.description_info?.extended_description?.field_list || []).filter((f) => f.field_type === 'text').map((f) => f.text).join('\n') : (base.description || ''),
    descEditable: !extended, descHtml: false, descMax: 3000,
    category: { id: base.category_id ?? null, path, editable: true },
  };
}

// แอตทริบิวต์บังคับของหมวดใหม่ที่ยังไม่มีค่า (ค่าเดิมของตะกร้าที่ attribute_id ตรงกันใช้ต่อได้)
// คืน [{ id, name, input, values: [{ value_id, name }] }] · input: DROP_DOWN / COMBO_BOX / TEXT_FILED ...
export async function shopeeCategoryNeeds(shop, itemId, categoryId) {
  const auth = await shopeeAuth(shop);
  const { base } = await readItem(auth, itemId);
  return catNeeds(auth, base, categoryId, {});
}
async function catNeeds(auth, base, categoryId, given) {
  const tree = await shopee.getAttributeTree({ ...auth, categoryId });
  const have = new Map((base.attribute_list || []).map((a) => [Number(a.attribute_id), a.attribute_value_list || []]));
  const list = [];
  const need = [];
  for (const a of tree.filter((x) => x.mandatory)) {
    const id = Number(a.attribute_id);
    const g = given[String(id)];
    const old = have.get(id);
    if (g) list.push({ attribute_id: id, attribute_value_list: [g] });
    else if (old?.length) list.push({ attribute_id: id, attribute_value_list: old.map((v) => ({ value_id: v.value_id, original_value_name: v.original_value_name, value_unit: v.value_unit })) });
    else {
      need.push({
        id, name: a.name || a.display_attribute_name || a.original_attribute_name || String(id),
        input: a.attribute_info?.input_type || a.input_type || null,
        values: (a.attribute_value_list || []).slice(0, 300).map((v) => ({ value_id: v.value_id, name: v.name || v.display_value_name || v.original_value_name || String(v.value_id) })),
      });
    }
  }
  return { list, need };
}

// ตรวจชื่อ/รายละเอียดที่ส่งมา — คืน { title, description } เฉพาะที่เปลี่ยน (null = ไม่แก้)
export function checkInfo(cur, { title = null, description = null }, { titleMax, descMax, label }) {
  const out = { title: null, description: null };
  if (title !== null && title !== undefined) {
    const t = String(title).replace(/\s+/g, ' ').trim();
    if (!t) throw new BasketError('ชื่อสินค้าว่างไม่ได้');
    if (t.length > titleMax) throw new BasketError(`ชื่อสินค้ายาวเกิน ${titleMax} ตัวอักษร (${label})`);
    if (t !== cur.title) out.title = t;
  }
  if (description !== null && description !== undefined) {
    if (!cur.descEditable) throw new BasketError(`รายละเอียดของตะกร้านี้แก้จากเว็บไม่ได้ — แก้ในหลังร้าน ${label}`);
    const d = String(description).replace(/\r\n/g, '\n').trim();
    if (!d) throw new BasketError('รายละเอียดสินค้าว่างไม่ได้');
    if (d.length > descMax) throw new BasketError(`รายละเอียดยาวเกิน ${descMax} ตัวอักษร (${label})`);
    if (d !== String(cur.description || '').trim()) out.description = d;
  }
  return out;
}

// Shopee: ชื่อ/รายละเอียด/หมวด = update_item ครั้งเดียว · เปลี่ยนหมวดต้องมีแอตทริบิวต์บังคับของหมวดใหม่ครบ
// category: { id, attrs: { [attribute_id]: { value_id, original_value_name } } } — attrs ขาด → 400 พร้อม payload.need
export async function shopeeSetInfo({ shop, itemId, title = null, description = null, category = null }) {
  const auth = await shopeeAuth(shop);
  const { base } = await readItem(auth, itemId);
  const cur = await shopeeInfo(auth, base);
  const { title: t, description: d } = checkInfo(cur, { title, description }, { titleMax: 120, descMax: 3000, label: 'Shopee' });
  const body = { item_id: Number(itemId) };
  if (t) body.item_name = t;
  if (d) body.description = d;
  let catChanged = false;
  if (category && Number(category.id) && Number(category.id) !== Number(base.category_id)) {
    const map = await shopeeCategories(auth);
    const c = map.get(Number(category.id));
    if (!c) throw new BasketError('ไม่รู้จักหมวดนี้');
    if (!c.leaf) throw new BasketError('ต้องเลือกหมวดย่อยสุด');
    const given = {};
    for (const [k, v] of Object.entries(category.attrs || {})) {
      if (!v || typeof v !== 'object') continue;
      const vid = Number(v.value_id) || 0;
      const name = String(v.original_value_name ?? '').trim().slice(0, 100);
      if (!vid && !name) continue;
      given[k] = { value_id: vid, ...(name ? { original_value_name: name } : {}) };
    }
    const { list, need } = await catNeeds(auth, base, c.id, given);
    if (need.length) {
      const e = new BasketError(`หมวด "${catPath(map, c.id)}" บังคับกรอก ${need.map((x) => x.name).join(', ')}`);
      e.payload = { need };
      throw e;
    }
    body.category_id = c.id;
    // ทดสอบจริง (2026-10-18): เปลี่ยนหมวดไม่ส่งยี่ห้อ → "Brand information required" — ส่งยี่ห้อเดิมของตะกร้า (0 = ไม่มียี่ห้อ)
    body.brand = { brand_id: Number(base.brand?.brand_id) || 0, original_brand_name: base.brand?.original_brand_name || 'NoBrand' };
    body.attribute_list = list;
    catChanged = true;
  }
  if (Object.keys(body).length === 1) throw new BasketError('ไม่มีอะไรเปลี่ยน — ไม่มีอะไรให้บันทึก');
  await shopee.call('/api/v2/product/update_item', { ...auth, method: 'POST', body });
  await sleep(1200);
  try {
    const after = await readItem(auth, itemId);
    await saveListings([shopee.normalizeListing(after.base, after.raw, shop)]);
    await markCompareStale(shopGroup('shopee', shop));
  } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
  return { title: Boolean(t), description: Boolean(d), category: catChanged, warnings: [] };
}

// ── โครงตัวเลือก: เรียงใหม่ / เปลี่ยนชื่อ / ลบตัวเลือก / ลบ SKU (ทุกแพลตฟอร์ม) ──
// input.tiers: [{ name, options: [{ from: ลำดับเดิม, text }] }] — ลำดับในรายการ = ลำดับใหม่ · ตัวเลือกเดิมที่ไม่อยู่ในรายการ = ลบ
//   (เพิ่มตัวเลือกใหม่ไม่ได้ที่นี่ — ใช้ "+ เพิ่มตัวเลือก" แยก) · input.del: [model_id] ลบ SKU รายตัว
// คืน { tiers: [{ name, options: [{ from, text }] }], keep: [{ m, tier_index (ใหม่) }], drop: [m], shape: โครงเปลี่ยนไหม }
// SKU ที่ใช้ตัวเลือกที่ถูกลบ = ถูกลบด้วย · ต้องเหลืออย่างน้อย 1 SKU
export function checkStructure(tiers, models, input, { label, nameMax = 20 }) {
  const want = Array.isArray(input?.tiers) ? input.tiers : null;
  if (!want || want.length !== tiers.length) throw new BasketError('จำนวนชั้นตัวเลือกไม่ตรงกับตะกร้า (อาจถูกแก้จากหลังร้าน — รีเฟรชก่อน)');
  const out = want.map((t, ti) => {
    const name = String(t?.name ?? '').trim();
    if (!name) throw new BasketError('ชื่อชั้นตัวเลือกว่างไม่ได้');
    if (name !== tiers[ti].name && name.length > nameMax) throw new BasketError(`ชื่อชั้น "${name}" ยาวเกิน ${nameMax} ตัวอักษร`);
    const opts = Array.isArray(t?.options) ? t.options : [];
    if (!opts.length) throw new BasketError(`"${name}" ต้องเหลืออย่างน้อย 1 ตัวเลือก`);
    const seenFrom = new Set();
    const seenText = new Set();
    const list = opts.map((o) => {
      const from = Number(o?.from);
      if (!Number.isInteger(from) || from < 0 || from >= tiers[ti].options.length || seenFrom.has(from)) throw new BasketError('ตัวเลือกที่ส่งมาไม่ตรงกับตะกร้า (รีเฟรชก่อน)');
      seenFrom.add(from);
      const text = String(o?.text ?? '').trim();
      if (!text) throw new BasketError(`ชื่อตัวเลือกใน "${name}" ว่างไม่ได้`);
      if (text !== tiers[ti].options[from].text && text.length > OPT_MAX) throw new BasketError(`"${text}" ยาวเกิน ${OPT_MAX} ตัวอักษร`);
      if (seenText.has(up(text))) throw new BasketError(`"${text}" ซ้ำกันใน "${name}"`);
      seenText.add(up(text));
      return { from, text };
    });
    return { name, options: list };
  });
  const del = new Set((Array.isArray(input?.del) ? input.del : []).map(String));
  for (const id of del) if (!models.some((m) => String(m.model_id) === id)) throw new BasketError(`ไม่พบ SKU ${id} ในตะกร้า (รีเฟรชก่อน)`);
  const remap = out.map((t) => new Map(t.options.map((o, i) => [o.from, i])));
  const keep = [];
  const drop = [];
  for (const m of models) {
    const ix = m.tier_index.map((i, ti) => remap[ti].get(i));
    if (del.has(String(m.model_id)) || ix.some((i) => i === undefined)) drop.push(m);
    else keep.push({ m, tier_index: ix });
  }
  if (!keep.length) throw new BasketError(`ลบหมดทุก SKU ไม่ได้ — ต้องเหลืออย่างน้อย 1 ตัว (ปิดการขายตะกร้าในหลังร้าน ${label} แทน)`);
  // ตัวเลือกที่เหลือแต่ไม่มี SKU ไหนใช้แล้ว → แพลตฟอร์มไม่ยอม ต้องลบตัวเลือกนั้นด้วย
  out.forEach((t, ti) => t.options.forEach((o, i) => {
    if (!keep.some((k) => k.tier_index[ti] === i)) throw new BasketError(`"${o.text}" จะไม่เหลือ SKU เลย — ลบตัวเลือกนี้ด้วย หรือเก็บ SKU ไว้อย่างน้อย 1 ตัว`);
  }));
  const shape = out.some((t, ti) => t.name !== tiers[ti].name || t.options.length !== tiers[ti].options.length
    || t.options.some((o, i) => o.from !== i || o.text !== tiers[ti].options[i].text));
  if (!shape && !drop.length) throw new BasketError('ไม่มีอะไรเปลี่ยน — ไม่มีอะไรให้บันทึก');
  return { tiers: out, keep, drop, shape };
}

// Shopee: ลบ SKU = delete_model ทีละตัว → โครงใหม่ = update_tier_variation (model_list = SKU ที่เหลือพร้อมลำดับใหม่)
// รูปตัวเลือกชั้นแรกติดไปกับตัวเลือกเดิม (from) · อ่านซ้ำ: SKU ที่เหลือต้องอยู่ครบและอยู่คู่ตัวเลือกเดิม
export async function shopeeSetStructure({ shop, itemId, tiers: want, del = [] }) {
  const auth = await shopeeAuth(shop);
  const before = await readItem(auth, itemId);
  if (!before.base.has_model || !before.tiers.length) throw new BasketError('ตะกร้านี้ไม่มีตัวเลือก');
  const { tiers, keep, drop, shape } = checkStructure(before.tiers, before.models, { tiers: want, del }, { label: 'Shopee', nameMax: 14 });
  const deleted = [];
  for (const m of drop) {
    try {
      await shopee.call('/api/v2/product/delete_model', { ...auth, method: 'POST', body: { item_id: Number(itemId), model_id: Number(m.model_id) } });
      deleted.push(m);
    } catch (e) {
      e.message = `ลบ SKU ${m.sku || m.model_id} ไม่สำเร็จ: ${e.message}${deleted.length ? ` (ลบไปแล้ว ${deleted.length} ตัว)` : ''} — โครงตัวเลือกยังไม่ถูกแก้`;
      throw e;
    }
  }
  const needShape = shape || tiers.some((t, ti) => t.options.length !== before.tiers[ti].options.length);
  if (needShape) {
    const tier_variation = tiers.map((t, ti) => ({
      name: t.name,
      option_list: t.options.map((o) => {
        const img = ti === 0 ? before.tiers[0].options[o.from].image_id : null;
        return { option: o.text, ...(img ? { image: { image_id: img } } : {}) };
      }),
    }));
    // ทดสอบจริง (2026-10-18 [TEST] REAL): ยิงทันทีหลัง delete_model → "The item is still being created. Please wait 5 seconds"
    // Shopee ยังประมวลผลการลบอยู่ → รอแล้วลองใหม่ (คำขอที่โดนตีกลับแบบนี้ไม่ถูกทำ ส่งซ้ำได้)
    if (deleted.length) await sleep(5000);
    try {
      for (let i = 1; ; i += 1) {
        try {
          await shopee.updateTierVariation({ ...auth, body: { item_id: Number(itemId), tier_variation, model_list: keep.map((k) => ({ model_id: Number(k.m.model_id), tier_index: k.tier_index })) } });
          break;
        } catch (e) {
          if (i >= 4 || !/wait \d+ seconds|still being/i.test(`${e.message} ${e.payload?.message || ''}`)) throw e;
          await sleep(4000);
        }
      }
    } catch (e) {
      if (deleted.length) e.message = `${e.message} (ลบ SKU ไปแล้ว ${deleted.length} ตัว แต่เรียง/เปลี่ยนชื่อตัวเลือกไม่สำเร็จ)`;
      throw e;
    }
  }
  await sleep(1500);
  const after = await readItem(auth, itemId);
  const warnings = [];
  const lost = keep.filter((k) => !after.models.some((m) => m.model_id === k.m.model_id));
  if (lost.length) warnings.push(`⚠ SKU ที่ควรเหลือหายไป ${lost.length} ตัว (${lost.slice(0, 3).map((k) => k.m.sku || k.m.model_id).join(', ')}) — ตรวจในหลังร้านด่วน`);
  const moved = keep.filter((k) => {
    const m = after.models.find((x) => x.model_id === k.m.model_id);
    return m && m.tier_index.some((i, ti) => after.tiers[ti]?.options[i]?.text !== tiers[ti].options[k.tier_index[ti]].text);
  });
  if (moved.length) warnings.push(`⚠ SKU ${moved.length} ตัวไปอยู่ผิดตัวเลือก (${moved.slice(0, 3).map((k) => k.m.sku || k.m.model_id).join(', ')}) — ตรวจในหลังร้านด่วน`);
  try {
    await saveListings([shopee.normalizeListing(after.base, after.raw, shop)]);
    await markCompareStale(shopGroup('shopee', shop));
  } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
  return { deleted: deleted.length, reshaped: needShape, warnings };
}

// เดาชั้นไซส์ + รหัสสี + ข้อเสนอสี/ไซส์ที่ ST มีแต่ตะกร้ายังไม่มี — ใช้ร่วมทุกแพลตฟอร์ม
// tiers: [{ name, options: [{ text }] }] · models: [{ tier_index, sku }] · out: plan ที่จะเติม sizeTier/codes/prefix/st/suggest
export async function addStPlan(out, tiers, models) {
  const sizeTier = sizeTierOf(tiers);
  const codes = colorCodes(tiers, models, sizeTier);
  out.sizeTier = sizeTier;
  out.codes = Object.fromEntries(codes);
  out.prefix = stPrefix([...codes.values()]);
  if (!out.prefix) return out;

  const sizeTokens = [...new Set([...SIZES, ...(sizeTier >= 0 ? tiers[sizeTier].options.map((o) => up(o.text)) : [])])].sort((a, b) => b.length - a.length);
  const rows = await stRowsByPrefix([out.prefix]);
  const known = new Set([...codes.values()].map(up));
  const haveSizes = new Set(sizeTier >= 0 ? tiers[sizeTier].options.map((o) => up(o.text)) : []);
  const refGroup = rows.find((r) => known.has(up(splitSt(r.sku, sizeTokens)?.code)))?.group_name || '';
  const newColors = new Map();
  const newSizes = new Map();
  for (const r of rows) {
    const s = splitSt(r.sku, sizeTokens);
    if (!s) continue;
    out.st.push({ sku: r.sku, code: s.code, size: s.size, qty: Math.max(0, Number(r.qty) || 0), price: r.price === null ? null : Number(r.price) });
    if (tiers.length === 2 && !known.has(up(s.code))) {
      const c = newColors.get(up(s.code)) || { code: s.code, text: colorNameFrom(r.group_name, refGroup), n: 0, qty: 0 };
      c.n += 1; c.qty += Math.max(0, Number(r.qty) || 0);
      newColors.set(up(s.code), c);
    }
    if (known.has(up(s.code)) && !haveSizes.has(s.size)) {
      const z = newSizes.get(s.size) || { text: s.size, n: 0, qty: 0 };
      z.n += 1; z.qty += Math.max(0, Number(r.qty) || 0);
      newSizes.set(s.size, z);
    }
  }
  out.suggest.colors = [...newColors.values()];
  out.suggest.sizes = sizeTier >= 0 ? [...newSizes.values()].sort((a, b) => SIZES.indexOf(a.text) - SIZES.indexOf(b.text)) : [];
  return out;
}

// ST ของรหัสสีที่ผู้ใช้พิมพ์เอง (ไม่ได้ขึ้นต้นด้วยคำนำหน้าเดิม) — คืนรายการแบบเดียวกับ plan.st
export async function stForCodes(codes) {
  const list = [...new Set(codes.map((c) => String(c || '').trim()).filter((c) => c.length >= 3))].slice(0, 10);
  if (!list.length) return [];
  const rows = await stRowsByPrefix(list);
  return rows.map((r) => {
    const code = list.find((c) => up(r.sku).startsWith(up(c)));
    return { sku: r.sku, code, size: r.sku.slice(code.length), qty: Math.max(0, Number(r.qty) || 0), price: r.price === null ? null : Number(r.price) };
  });
}

// ── ร้านอื่นมี แต่ตะกร้านี้ยังไม่มี (เทียบแบบหน้า /compare) ──
// ตะกร้าพี่น้อง = ตะกร้าในร้านอื่นของกลุ่มเดียวกัน (SOLID/REAL/MVP) ที่มีเลข SKU ร้านตรงกับตะกร้านี้ (≥ 3 ตัว หรือ ≥ ครึ่งหนึ่ง)
// SKU ของพี่น้องที่ตะกร้านี้ไม่มี → แปลงชื่อตัวเลือก ("สีดำ-ขาปล่อย / 6L/5XL") เป็นข้อความของแต่ละชั้นของตะกร้านี้
//   ส่วนที่ตรงกับตัวเลือกเดิม = ตัวเลือกเดิม · ที่เหลือ = ตัวเลือกใหม่ของชั้นที่ยังว่าง (ชั้นไซส์ถ้าดูเป็นไซส์)
// คืน [{ sku, opts: [ข้อความต่อชั้น], from: ['TikTok SOLID', ...], price }] — แปลงไม่ได้ก็ข้าม
const PLAT = { shopee: 'Shopee', tiktok: 'TikTok', lazada: 'Lazada', thaimart: 'Thaimart', thisshop: 'ThisShop' };
export async function siblingSuggest(platform, shop, productId, tiers, models) {
  const mine = new Map(models.filter((m) => m.sku).map((m) => [up(m.sku), m]));
  if (!mine.size || !tiers.length) return [];
  const group = shopGroup(platform, shop);
  const hits = [];
  const skus = [...new Set(models.map((m) => m.sku).filter(Boolean))];
  for (const c of chunks(skus, 100)) {
    const { data, error } = await db().from('os_listing_skus').select('platform, shop, product_id, seller_sku').in('seller_sku', c);
    if (error) throw new Error(error.message);
    hits.push(...(data || []));
  }
  const overlap = new Map();   // "platform|shop|product_id" → จำนวน SKU ที่ตรง
  for (const h of hits) {
    if (h.platform === platform && h.shop === shop) continue;
    if (shopGroup(h.platform, h.shop) !== group) continue;
    const k = `${h.platform}|${h.shop}|${h.product_id}`;
    overlap.set(k, (overlap.get(k) || 0) + 1);
  }
  const sibs = [...overlap].filter(([, n]) => n >= 3 || n * 2 >= mine.size).map(([k]) => k.split('|'));
  if (!sibs.length) return [];
  const rows = [];
  for (const [pf, sh, pid] of sibs.slice(0, 12)) {
    const { data, error } = await db().from('os_listing_skus').select('seller_sku, variant, price')
      .eq('platform', pf).eq('shop', sh).eq('product_id', pid);
    if (error) throw new Error(error.message);
    for (const r of data || []) rows.push({ ...r, from: `${PLAT[pf] || pf} ${sh}`, pf });
  }
  const sizeTier = sizeTierOf(tiers);
  const out = new Map();
  for (const r of rows) {
    const k = up(r.seller_sku);
    if (!r.seller_sku || mine.has(k)) continue;
    if (out.has(k)) {
      const o = out.get(k);
      if (!o.from.includes(r.from)) o.from.push(r.from);
      if (o.price === null && r.pf !== 'thaimart') o.price = r.price ?? null;   // Thaimart ตั้งราคาเอง — ใช้ร้านอื่นแทน
      continue;
    }
    const parts = String(r.variant || '').split(' / ').map((x) => x.trim()).filter(Boolean);
    if (parts.length !== tiers.length) continue;
    const opts = new Array(tiers.length).fill(null);
    const left = [];
    for (const part of parts) {
      const ti = tiers.findIndex((t, i) => opts[i] === null && t.options.some((o) => up(o.text) === up(part)));
      if (ti >= 0) opts[ti] = tiers[ti].options.find((o) => up(o.text) === up(part)).text;
      else left.push(part);
    }
    const free = opts.map((x, i) => (x === null ? i : -1)).filter((i) => i >= 0);
    if (left.length !== free.length || left.length > 1) continue;   // ใหม่ได้ทีละชั้น — ใหม่ทั้งสีและไซส์พร้อมกันเดาไม่ได้
    if (left.length) {
      const ti = free[0];
      if (sizeTier >= 0 && ti === sizeTier && !isSizeText(left[0].split('/')[0])) continue;
      if (left[0].length > OPT_MAX) continue;
      opts[ti] = left[0];
    }
    out.set(k, { sku: r.seller_sku, opts, from: [r.from], price: r.pf === 'thaimart' ? null : (r.price ?? null) });
  }
  return [...out.values()];
}

// เติม plan.siblings — พังก็แค่ไม่มีข้อเสนอ
export async function withSiblings(out, platform, shop, tiers, models) {
  try { out.siblings = await siblingSuggest(platform, shop, out.itemId, tiers, models); } catch { out.siblings = []; }
  return out;
}

export const defaultStock = (stQty) => (stQty === null || stQty === undefined ? 0 : Math.max(0, Number(stQty) - ST_BUFFER));

// ── บันทึก ──
// add: [[ตัวเลือกใหม่ชั้น 1], [ชั้น 2]] (ต่อท้ายตามลำดับนี้) — แต่ละตัวเป็นข้อความ หรือ { text, image_id } (รูปใช้ได้เฉพาะชั้นแรก)
// models: [{ opts: [ข้อความชั้น 1, ข้อความชั้น 2], sku, price, stock }] — คู่ใหม่ทุกคู่ที่มีตัวเลือกใหม่อย่างน้อย 1 ตัวต้องมีครบ
// คืน { added: [{ model_id, sku }], options: [[...], [...]], warnings: [] }
export async function shopeeAddOptions({ shop, itemId, add = [], models = [] }) {
  const auth = await shopeeAuth(shop);
  const before = await readItem(auth, itemId);
  const { tiers } = before;
  if (!before.base.has_model || !tiers.length) throw new BasketError('ตะกร้านี้ไม่มีตัวเลือก — เพิ่มตัวเลือกชั้นแรกในหลังร้าน Shopee');
  if (add.length > tiers.length) throw new BasketError('จำนวนชั้นตัวเลือกไม่ตรงกับตะกร้า');
  const { newOpts, newImg, target, oldLen, todo: plain } = checkAdd(tiers, before.models, add, models, { withImg: needImage(tiers), label: 'Shopee', imgOk: (x) => /^[\w-]{6,80}$/.test(x), round: Math.round });
  const todo = plain.map((m) => ({ tier_index: m.tier_index, original_price: m.price, seller_stock: [{ stock: m.stock }], ...(m.sku ? { model_sku: m.sku } : {}), label: m.label, sku: m.sku }));
  return shopeeWrite({ shop, itemId, auth, before, tiers, newOpts, newImg, target, oldLen, todo });
}

// ตรวจของใหม่กับตะกร้าจริง (ทุกแพลตฟอร์ม) — คืน { newOpts, newImg, target, oldLen, todo: [{ tier_index, price, stock, sku, label }] }
// withImg: ชั้นแรกมีรูปทุกตัว → ตัวใหม่ต้องมีรูป · imgOk: รูปแบบรหัสรูปของแพลตฟอร์ม · round: ปัดราคา (Shopee บาทเต็ม)
export function checkAdd(tiers, oldModels, add, models, { withImg, label, imgOk, round }) {
  const before = { models: oldModels };
  // ตัวเลือกใหม่: ไม่ว่าง ไม่ยาวเกิน ไม่ซ้ำของเดิม/กันเอง
  const rawNew = tiers.map((t, ti) => (add[ti] || []).map((x) => (x && typeof x === 'object' ? x : { text: x })));
  const newOpts = rawNew.map((l) => l.map((x) => String(x.text ?? '').trim()));
  const newImg = (rawNew[0] || []).map((x) => (x.image_id ? String(x.image_id) : null));
  newImg.forEach((img, i) => {
    if (withImg && !img) throw new BasketError(`เลือกรูปให้ "${newOpts[0][i]}" ก่อน — ตัวเลือกเดิมใน "${tiers[0].name}" มีรูปทุกตัว ${label} บังคับให้ตัวใหม่มีด้วย`);
    if (!withImg && img) throw new BasketError(`ตัวเลือกเดิมใน "${tiers[0].name}" ไม่มีรูป — ตัวใหม่ใส่รูปไม่ได้ (${label} บังคับมีทุกตัวหรือไม่มีเลย)`);
    if (img && !imgOk(img)) throw new BasketError('รหัสรูปไม่ถูกต้อง');
  });
  if (rawNew.slice(1).some((l) => l.some((x) => x.image_id))) throw new BasketError('ใส่รูปได้เฉพาะตัวเลือกชั้นแรก');
  newOpts.forEach((list, ti) => {
    const seen = new Set(tiers[ti].options.map((o) => up(o.text)));
    for (const x of list) {
      if (!x) throw new BasketError(`ตัวเลือกใหม่ใน "${tiers[ti].name}" ว่าง`);
      if (x.length > OPT_MAX) throw new BasketError(`"${x}" ยาวเกิน ${OPT_MAX} ตัวอักษร`);
      if (seen.has(up(x))) throw new BasketError(`"${x}" มีอยู่แล้วใน "${tiers[ti].name}"`);
      seen.add(up(x));
    }
  });
  const target = tiers.map((t, ti) => [...t.options.map((o) => o.text), ...newOpts[ti]]);
  const oldLen = tiers.map((t) => t.options.length);

  // SKU ใหม่: ตัวเลือกต้องมีจริง · คู่นั้นยังไม่มี · ราคา/คลัง/รหัสถูก
  const existing = new Set(before.models.map((m) => m.tier_index.join(',')));
  const skuSeen = new Set(before.models.map((m) => up(m.sku)).filter(Boolean));
  const prices = before.models.map((m) => Number(m.price)).filter((p) => p > 0);
  const pMin = Math.min(...prices), pMax = Math.max(...prices);
  const todo = models.map((m) => {
    const opts = Array.isArray(m?.opts) ? m.opts.map((x) => String(x ?? '').trim()) : [];
    if (opts.length !== tiers.length) throw new BasketError('ตัวเลือกของ SKU ใหม่ไม่ครบทุกชั้น');
    const tier_index = opts.map((x, ti) => target[ti].findIndex((o) => up(o) === up(x)));
    const label = opts.join(' / ');
    if (tier_index.some((i) => i < 0)) throw new BasketError(`${label}: ไม่มีตัวเลือกนี้ในตะกร้า`);
    const k = tier_index.join(',');
    if (existing.has(k)) throw new BasketError(`${label}: มีอยู่แล้วในตะกร้า`);
    existing.add(k);
    const price = round(Number(m.price));
    const stock = Number(m.stock);
    const sku = String(m.sku ?? '').trim();
    if (!(price > 0)) throw new BasketError(`${label}: ราคาไม่ถูกต้อง`);
    // กันพิมพ์ผิด (เช่น 6980 แทน 698) — ต้องอยู่ในช่วงราคาตัวเลือกเดิม ×0.3 ถึง ×3
    if (prices.length && (price < pMin * 0.3 || price > pMax * 3)) throw new BasketError(`${label}: ราคา ${price} ห่างจากราคาตัวเลือกเดิม (${pMin}–${pMax}) มากเกินไป — ตรวจอีกครั้ง`);
    if (!(Number.isInteger(stock) && stock >= 0 && stock <= 99999)) throw new BasketError(`${label}: คลังไม่ถูกต้อง`);
    if (sku.length > SKU_MAX) throw new BasketError(`${label}: SKU ยาวเกิน`);
    if (sku && skuSeen.has(up(sku))) throw new BasketError(`${label}: SKU ${sku} ซ้ำกับตัวอื่นในตะกร้า`);
    if (sku) skuSeen.add(up(sku));
    return { tier_index, price, stock, sku, label };
  });

  // ตัวเลือกใหม่ทุกตัวต้องมี SKU ครบทุกคู่ (ลูกค้าเลือกคู่ที่ไม่มีไม่ได้ — ไม่อยากขายให้ใส่คลัง 0)
  const combos = (ti, acc) => (ti === tiers.length ? [acc] : target[ti].flatMap((_, i) => combos(ti + 1, [...acc, i])));
  const need = combos(0, []).filter((ix) => ix.some((i, ti) => i >= oldLen[ti]));
  const missing = need.filter((ix) => !existing.has(ix.join(',')));
  if (missing.length) throw new BasketError(`ขาด SKU ${missing.length} คู่ เช่น ${missing[0].map((i, ti) => target[ti][i]).join(' / ')} — ไม่อยากขายให้ใส่คลัง 0`);
  if (!todo.length) throw new BasketError('ไม่มีอะไรให้บันทึก');
  return { newOpts, newImg, target, oldLen, todo };
}

// ── แก้รูป (ทุกแพลตฟอร์ม) ──
// main: [รหัสรูป ตามลำดับ] หรือ null = ไม่แก้ · options: { ข้อความตัวเลือกชั้นแรก: รหัสรูป } หรือ null = ไม่แก้
// คืน { mainIds: [..] | null, optImg: [รหัสรูปต่อตัวเลือกชั้นแรก ตามลำดับเดิม] | null } — null = เหมือนเดิม ไม่ต้องเขียน
// allOrNone: Shopee/TikTok บังคับรูปตัวเลือกชั้นแรก "มีทุกตัวหรือไม่มีเลย" · ลบรูปตัวเลือกไม่ได้ (เปลี่ยนได้อย่างเดียว)
export function checkImages(tiers, curMain, { main = null, options = null }, { max, label, imgOk, allOrNone = true }) {
  let mainIds = null;
  if (main !== null && main !== undefined) {
    if (!Array.isArray(main) || !main.length) throw new BasketError('ต้องมีรูปสินค้าอย่างน้อย 1 รูป');
    const ids = main.map((x) => String(x ?? '').trim());
    if (ids.length > max) throw new BasketError(`${label} ใส่รูปสินค้าได้ไม่เกิน ${max} รูป`);
    if (ids.some((x) => !x || !imgOk(x))) throw new BasketError('รหัสรูปสินค้าไม่ถูกต้อง');
    if (new Set(ids).size !== ids.length) throw new BasketError('มีรูปสินค้าซ้ำกัน');
    if (ids.join('\u0001') !== curMain.join('\u0001')) mainIds = ids;
  }
  let optImg = null;
  if (options && typeof options === 'object' && Object.keys(options).length) {
    if (!tiers.length) throw new BasketError('ตะกร้านี้ไม่มีตัวเลือก');
    const opts = tiers[0].options;
    const next = opts.map((o) => o.image_id || null);
    for (const [text, img] of Object.entries(options)) {
      const i = opts.findIndex((o) => o.text === text);
      if (i < 0) throw new BasketError(`ไม่มีตัวเลือก "${text}" ใน "${tiers[0].name}"`);
      const id = String(img ?? '').trim();
      if (!id || !imgOk(id)) throw new BasketError(`รหัสรูปของ "${text}" ไม่ถูกต้อง`);
      next[i] = id;
    }
    const n = next.filter(Boolean).length;
    if (allOrNone && n && n !== next.length) {
      const miss = opts.filter((_, i) => !next[i]).map((o) => o.text);
      throw new BasketError(`${label} บังคับรูปตัวเลือก "${tiers[0].name}" มีทุกตัวหรือไม่มีเลย — ยังขาด ${miss.slice(0, 5).join(', ')}${miss.length > 5 ? ` และอีก ${miss.length - 5}` : ''}`);
    }
    if (next.some((x, i) => x !== (opts[i].image_id || null))) optImg = next;
  }
  if (!mainIds && !optImg) throw new BasketError('รูปไม่ได้เปลี่ยน — ไม่มีอะไรให้บันทึก');
  return { mainIds, optImg };
}

// Shopee: รูปตัวเลือก = update_tier_variation (ตัวเลือก/ลำดับเดิมทุกตัว + model_list ครบ เปลี่ยนแค่รูป) · รูปสินค้า = update_item image_id_list
export async function shopeeSetImages({ shop, itemId, main = null, options = null }) {
  const auth = await shopeeAuth(shop);
  const before = await readItem(auth, itemId);
  const { base, tiers } = before;
  const { mainIds, optImg } = checkImages(tiers, base.image?.image_id_list || [], { main, options }, {
    max: 9, label: 'Shopee', imgOk: (x) => /^[\w-]{6,80}$/.test(x),
  });
  const warnings = [];
  if (optImg) {
    if (!before.base.has_model) throw new BasketError('ตะกร้านี้ไม่มีตัวเลือก');
    const tier_variation = tiers.map((t, ti) => ({
      name: t.name,
      option_list: t.options.map((o, i) => {
        const img = ti === 0 ? optImg[i] : o.image_id;
        return { option: o.text, ...(img ? { image: { image_id: img } } : {}) };
      }),
    }));
    const keepModels = before.models.map((m) => ({ model_id: Number(m.model_id), tier_index: m.tier_index }));
    await shopee.updateTierVariation({ ...auth, body: { item_id: Number(itemId), tier_variation, model_list: keepModels } });
    const chk = await readItem(auth, itemId);
    const lost = before.models.filter((m) => !chk.models.some((x) => x.model_id === m.model_id));
    if (lost.length) throw new Error(`⚠ Shopee ตัดตัวเลือกเดิมหายไป ${lost.length} ตัว (${lost.slice(0, 3).map((m) => m.sku || m.model_id).join(', ')}) — หยุดแล้ว ตรวจในหลังร้านด่วน`);
  }
  if (mainIds) {
    try {
      await shopee.call('/api/v2/product/update_item', { ...auth, method: 'POST', body: { item_id: Number(itemId), image: { image_id_list: mainIds } } });
    } catch (e) {
      if (optImg) e.message = `${e.message} (รูปตัวเลือกเปลี่ยนแล้ว แต่รูปสินค้ายังไม่เปลี่ยน)`;
      throw e;
    }
  }
  await sleep(1500);
  try {
    const after = await readItem(auth, itemId);
    await saveListings([shopee.normalizeListing(after.base, after.raw, shop)]);
    await markCompareStale(shopGroup('shopee', shop));
  } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
  return { main: Boolean(mainIds), options: optImg ? optImg.filter((x, i) => x !== (tiers[0].options[i].image_id || null)).length : 0, warnings };
}

// ── แก้รหัส SKU / ราคา ของ SKU เดิม (ทุกแพลตฟอร์ม) ──
// edits: [{ model_id, sku?, price? }] · คืนเฉพาะตัวที่เปลี่ยนจริง [{ model_id, sku: ใหม่|null, price: ใหม่|null, old }]
// ราคาต้องอยู่ในช่วงราคาเดิม ×0.3–×3 (กันพิมพ์เกิน/ขาดศูนย์) · รหัส SKU ห้ามว่าง ห้ามซ้ำตัวอื่นในตะกร้า
export function checkEdits(models, edits, { label, round, skuEditable = true }) {
  if (!Array.isArray(edits) || !edits.length) throw new BasketError('ไม่มีอะไรให้บันทึก');
  if (edits.length > 200) throw new BasketError('แก้ได้ครั้งละไม่เกิน 200 SKU');
  const byId = new Map(models.map((m) => [String(m.model_id), m]));
  const prices = models.map((m) => Number(m.price)).filter((p) => p > 0);
  const pMin = Math.min(...prices), pMax = Math.max(...prices);
  const out = [];
  for (const e of edits) {
    const m = byId.get(String(e?.model_id ?? ''));
    if (!m) throw new BasketError(`ไม่พบ SKU ${e?.model_id} ในตะกร้า (อาจถูกแก้จากหลังร้าน — รีเฟรชก่อน)`);
    const name = m.sku || m.model_id;
    let sku = null, price = null;
    if (e.sku !== undefined && e.sku !== null) {
      const s = String(e.sku).trim();
      if (s !== (m.sku || '')) {
        if (!skuEditable) throw new BasketError(`${label} เปลี่ยนรหัส SKU ของ SKU เดิมไม่ได้ — แก้ได้แค่ราคา`);
        if (!s) throw new BasketError(`${name}: รหัส SKU ว่างไม่ได้`);
        if (s.length > SKU_MAX) throw new BasketError(`${name}: รหัส SKU ยาวเกิน`);
        sku = s;
      }
    }
    if (e.price !== undefined && e.price !== null && e.price !== '') {
      const p = round(Number(e.price));
      if (!(p > 0)) throw new BasketError(`${name}: ราคาไม่ถูกต้อง`);
      if (prices.length && (p < pMin * 0.3 || p > pMax * 3)) throw new BasketError(`${name}: ราคา ${p} ห่างจากราคาเดิม (${pMin}–${pMax}) มากเกินไป — ตรวจอีกครั้ง`);
      if (p !== Number(m.price)) price = p;
    }
    if (sku !== null || price !== null) out.push({ model_id: String(m.model_id), sku, price, old: m });
  }
  const final = new Map(models.map((m) => [String(m.model_id), up(m.sku)]));
  for (const x of out) if (x.sku) final.set(x.model_id, up(x.sku));
  const seen = new Map();
  for (const [id, s] of final) {
    if (!s) continue;
    if (seen.has(s) && out.some((x) => x.model_id === id || x.model_id === seen.get(s))) throw new BasketError(`รหัส SKU ${s} ซ้ำกันในตะกร้า`);
    seen.set(s, id);
  }
  if (!out.length) throw new BasketError('ไม่มีอะไรเปลี่ยน — ไม่มีอะไรให้บันทึก');
  return out;
}

// Shopee: ราคา = update_price · รหัส SKU = update_model (แตะแค่ model_sku) — ทีละ 50
export async function shopeeEditModels({ shop, itemId, edits }) {
  const auth = await shopeeAuth(shop);
  const before = await readItem(auth, itemId);
  if (!before.base.has_model) throw new BasketError('ตะกร้านี้ไม่มีตัวเลือก — แก้ในหลังร้าน Shopee');
  const todo = checkEdits(before.models, edits, { label: 'Shopee', round: Math.round });
  const failed = [];
  const priceList = todo.filter((x) => x.price !== null);
  for (const c of chunks(priceList, 50)) {
    const r = await shopee.call('/api/v2/product/update_price', { ...auth, method: 'POST', body: { item_id: Number(itemId), price_list: c.map((x) => ({ model_id: Number(x.model_id), original_price: x.price })) } });
    for (const f of r.failure_list || []) failed.push(`ราคา ${f.model_id}: ${f.failed_reason || 'ไม่ทราบสาเหตุ'}`);
  }
  const skuList = todo.filter((x) => x.sku !== null);
  for (const c of chunks(skuList, 50)) {
    await shopee.call('/api/v2/product/update_model', { ...auth, method: 'POST', body: { item_id: Number(itemId), model: c.map((x) => ({ model_id: Number(x.model_id), model_sku: x.sku })) } });
  }
  await sleep(1500);
  try {
    const after = await readItem(auth, itemId);
    await saveListings([shopee.normalizeListing(after.base, after.raw, shop)]);
    await markCompareStale(shopGroup('shopee', shop));
  } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
  return { changed: todo.length - failed.length, warnings: failed };
}

async function shopeeWrite({ shop, itemId, auth, before, tiers, newOpts, newImg, target, oldLen, todo }) {

  const tierBody = (lists) => lists.map((list, ti) => ({
    name: tiers[ti].name,
    option_list: list.map((text, i) => {
      const img = i < oldLen[ti] ? tiers[ti].options[i].image_id : (ti === 0 ? newImg[i - oldLen[0]] : null);
      return { option: text, ...(img ? { image: { image_id: img } } : {}) };
    }),
  }));
  const keepModels = before.models.map((m) => ({ model_id: Number(m.model_id), tier_index: m.tier_index }));
  const oldIds = new Set(before.models.map((m) => m.model_id));
  const warnings = [];

  // 2. ตัวเลือกใหม่ (ถ้ามี) — เพิ่มแค่ SKU ในคู่ที่ขาด ไม่ต้องแตะตัวเลือก
  const grew = newOpts.some((l) => l.length);
  if (grew) {
    await shopee.updateTierVariation({ ...auth, body: { item_id: Number(itemId), tier_variation: tierBody(target), model_list: keepModels } });
    // 3. ตัวเลือกเดิมต้องอยู่ครบ
    const chk = await readItem(auth, itemId);
    const lost = [...oldIds].filter((id) => !chk.models.some((m) => m.model_id === id));
    if (lost.length) throw new Error(`⚠ Shopee ตัดตัวเลือกเดิมหายไป ${lost.length} ตัว (${lost.slice(0, 3).join(', ')}) — หยุดแล้ว ตรวจในหลังร้านด่วน`);
  }

  // 4. SKU ใหม่
  const added = [];
  try {
    for (const c of chunks(todo, 50)) {
      const r = await shopee.addModel({ ...auth, body: { item_id: Number(itemId), model_list: c.map(({ label: _l, sku: _s, ...m }) => m) } });
      for (const m of r.model || r.model_list || []) added.push({ model_id: String(m.model_id), sku: m.model_sku || null });
      if (!(r.model || r.model_list)) added.push(...c.map((m) => ({ model_id: null, sku: m.sku || null })));
    }
  } catch (e) {
    if (!added.length && grew) {
      // ยังไม่มี SKU ใหม่เลย → ถอยตัวเลือกกลับเป็นแบบเดิม ไม่ทิ้งตัวเลือกเปล่าไว้ในร้าน
      try {
        await shopee.updateTierVariation({ ...auth, body: { item_id: Number(itemId), tier_variation: tierBody(tiers.map((t) => t.options.map((o) => o.text))), model_list: keepModels } });
        e.message = `${e.message} (ถอยตัวเลือกกลับเป็นแบบเดิมแล้ว)`;
      } catch (e2) {
        e.message = `${e.message} · ถอยตัวเลือกกลับไม่สำเร็จ: ${e2.message} — ตรวจในหลังร้าน`;
      }
    } else if (added.length) {
      e.message = `${e.message} (สร้างไปแล้ว ${added.length} จาก ${todo.length} ตัว)`;
    }
    throw e;
  }

  // 5. อ่านซ้ำ + เก็บลงฐานข้อมูล
  await sleep(1500);
  const after = await readItem(auth, itemId);
  const got = after.models.length - before.models.length;
  if (got !== todo.length) warnings.push(`Shopee มีตัวเลือกเพิ่ม ${got} ตัว ≠ ที่ส่งไป ${todo.length} (อาจยังอัปเดตไม่ทัน — รีเฟรชดูอีกครั้ง)`);
  try {
    await saveListings([shopee.normalizeListing(after.base, after.raw, shop)]);
    await markCompareStale(shopGroup('shopee', shop));
  } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
  return { added, options: target, warnings };
}
