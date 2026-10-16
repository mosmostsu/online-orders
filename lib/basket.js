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
    models: models.map(({ model_id, tier_index, sku, price, stock }) => ({ model_id, tier_index, sku, price, stock })),
    sizeTier: -1, codes: {}, prefix: null, st: [], suggest: { colors: [], sizes: [] },
  };
  if (!out.hasModel) return out;
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

  // ตัวเลือกใหม่: ไม่ว่าง ไม่ยาวเกิน ไม่ซ้ำของเดิม/กันเอง
  const rawNew = tiers.map((t, ti) => (add[ti] || []).map((x) => (x && typeof x === 'object' ? x : { text: x })));
  const newOpts = rawNew.map((l) => l.map((x) => String(x.text ?? '').trim()));
  const newImg = (rawNew[0] || []).map((x) => (x.image_id ? String(x.image_id) : null));
  const withImg = needImage(tiers);
  newImg.forEach((img, i) => {
    if (withImg && !img) throw new BasketError(`เลือกรูปให้ "${newOpts[0][i]}" ก่อน — ตัวเลือกเดิมใน "${tiers[0].name}" มีรูปทุกตัว Shopee บังคับให้ตัวใหม่มีด้วย`);
    if (!withImg && img) throw new BasketError(`ตัวเลือกเดิมใน "${tiers[0].name}" ไม่มีรูป — ตัวใหม่ใส่รูปไม่ได้ (Shopee บังคับมีทุกตัวหรือไม่มีเลย)`);
    if (img && !/^[\w-]{6,80}$/.test(img)) throw new BasketError('รหัสรูปไม่ถูกต้อง');
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
    const price = Math.round(Number(m.price));
    const stock = Number(m.stock);
    const sku = String(m.sku ?? '').trim();
    if (!(price > 0)) throw new BasketError(`${label}: ราคาไม่ถูกต้อง`);
    // กันพิมพ์ผิด (เช่น 6980 แทน 698) — ต้องอยู่ในช่วงราคาตัวเลือกเดิม ×0.3 ถึง ×3
    if (prices.length && (price < pMin * 0.3 || price > pMax * 3)) throw new BasketError(`${label}: ราคา ${price} ห่างจากราคาตัวเลือกเดิม (${pMin}–${pMax}) มากเกินไป — ตรวจอีกครั้ง`);
    if (!(Number.isInteger(stock) && stock >= 0 && stock <= 99999)) throw new BasketError(`${label}: คลังไม่ถูกต้อง`);
    if (sku.length > SKU_MAX) throw new BasketError(`${label}: SKU ยาวเกิน`);
    if (sku && skuSeen.has(up(sku))) throw new BasketError(`${label}: SKU ${sku} ซ้ำกับตัวอื่นในตะกร้า`);
    if (sku) skuSeen.add(up(sku));
    return { tier_index, original_price: price, seller_stock: [{ stock }], ...(sku ? { model_sku: sku } : {}), label, sku };
  });

  // ตัวเลือกใหม่ทุกตัวต้องมี SKU ครบทุกคู่ (Shopee/ลูกค้าเลือกคู่ที่ไม่มีไม่ได้ — ไม่อยากขายให้ใส่คลัง 0)
  const combos = (ti, acc) => (ti === tiers.length ? [acc] : target[ti].flatMap((_, i) => combos(ti + 1, [...acc, i])));
  const need = combos(0, []).filter((ix) => ix.some((i, ti) => i >= oldLen[ti]));
  const missing = need.filter((ix) => !existing.has(ix.join(',')));
  if (missing.length) throw new BasketError(`ขาด SKU ${missing.length} คู่ เช่น ${missing[0].map((i, ti) => target[ti][i]).join(' / ')} — ไม่อยากขายให้ใส่คลัง 0`);
  if (!todo.length) throw new BasketError('ไม่มีอะไรให้บันทึก');

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
