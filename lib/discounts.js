// โปรส่วนลด — ตัวกลางของหน้า /discount (อ่าน + แก้ราคาโปรของตะกร้าที่ผู้ใช้กดบันทึกเอง)
// ใช้โทเคนใน DB ตรงๆ ไม่ต่ออายุเอง (ดู storedToken ใน lib/tokens.js)
import { unstable_cache } from 'next/cache';
import { listDiscounts, getDiscount, discountRows, addDiscountItems, updateDiscountItems, deleteDiscountItem, getItemPromotion, getItemBaseInfo, getModelList } from './shopee.js';
import { searchActivities, getActivity, getProduct, updateActivityProducts, removeActivityProducts } from './tiktok.js';
import { listShops, storedToken } from './tokens.js';
import { db } from './supabase.js';
import { getProductItem, callPost as lazadaCallPost, normalizeListing as lazadaNormalize } from './lazada.js';
import { saveListings } from './listings.js';
import { fmtTimeTH } from './fmt.js';

// Shopee ให้เวลาเป็นวินาที (unix) — โชว์ "26 พ.ย. 15:00 2569"
export const fmtSec = (s) => {
  if (!s) return '—';
  const ms = Number(s) * 1000;
  return `${fmtTimeTH(new Date(ms).toISOString())} ${new Date(ms + 7 * 3600000).getUTCFullYear() + 543}`;
};
export const endsSoon = (s) => s && Number(s) * 1000 > Date.now() && Number(s) * 1000 - Date.now() < 3 * 86400000;
// หน้าโปรในหลังร้าน (ต้องล็อกอินร้านนั้นไว้) — ⚠ ยังไม่ได้ยืนยันกับ URL จริง ถ้าเปิดแล้วไม่ตรงให้แก้ที่นี่
// TikTok / Lazada ไม่รู้ URL หน้าโปรเดียว → เปิดหน้ารวมโปร / รายการสินค้าแทน
export function sellerDiscountUrl(platform, id) {
  const x = encodeURIComponent(String(id));
  if (platform === 'shopee') return `https://seller.shopee.co.th/portal/marketing/discount/${x}`;
  if (platform === 'tiktok') return `https://seller-th.tiktok.com/promotion`;
  if (platform === 'lazada') return 'https://sellercenter.lazada.co.th/apps/product/list';
  return null;
}
export const STATUS_LABEL = { ongoing: 'กำลังดำเนินการ', upcoming: 'เร็วๆ นี้', expired: 'หมดอายุ' };

export async function shopeeShops() {
  return (await listShops('shopee')).map((r) => r.shop).sort();
}

export async function shopeeAuth(shop) {
  const row = (await listShops('shopee')).find((r) => r.shop === shop);
  if (!row) throw new Error(`ไม่พบโทเคนของร้าน Shopee ${shop}`);
  const tok = storedToken(row);
  return { accessToken: tok.access_token, shopId: tok.shop_id, partner: tok };
}

export async function shopeeDiscountList(shop, status, maxPages) {
  return listDiscounts({ ...(await shopeeAuth(shop)), status, maxPages });
}

// โปรหนึ่งโปร: หัวโปร + รายตัวเลือก เติมเลข SKU ร้าน/ชื่อ/รูปตะกร้าจากที่เก็บไว้ (Shopee ไม่ส่งมาในก้อนโปร)
export async function shopeeDiscountDetail(shop, discountId) {
  const d = await getDiscount({ ...(await shopeeAuth(shop)), discountId });
  const rows = discountRows(d);
  const itemIds = [...new Set(rows.map((r) => r.item_id))];
  const skuOf = new Map();
  const listingOf = new Map();
  for (let i = 0; i < itemIds.length; i += 200) {
    const ids = itemIds.slice(i, i + 200);
    const [s, l] = await Promise.all([
      db().from('os_listing_skus').select('product_id, sku_id, seller_sku')
        .eq('platform', 'shopee').eq('shop', shop).in('product_id', ids),
      db().from('os_listings').select('product_id, thumb_url, item_sku')
        .eq('platform', 'shopee').eq('shop', shop).in('product_id', ids),
    ]);
    if (s.error) throw new Error(s.error.message);
    if (l.error) throw new Error(l.error.message);
    for (const x of s.data || []) skuOf.set(`${x.product_id}:${x.sku_id}`, x.seller_sku);
    for (const x of l.data || []) listingOf.set(String(x.product_id), x);
  }
  for (const r of rows) r.seller_sku = skuOf.get(`${r.item_id}:${r.sku_id}`) || null;
  const { item_list: _drop, ...head } = d;
  return { head, rows, listings: Object.fromEntries(listingOf) };
}

// โปรที่ใส่ตะกร้าเพิ่มได้ (กำลังดำเนินการ / เร็วๆ นี้) — ใช้ร่วมทุกตะกร้าของร้าน จำไว้ 2 นาที
const discountOptions = unstable_cache(async (shop) => {
  const auth = await shopeeAuth(shop);
  const [ongoing, upcoming] = await Promise.all([
    listDiscounts({ ...auth, status: 'ongoing', maxPages: 3 }),
    listDiscounts({ ...auth, status: 'upcoming', maxPages: 3 }),
  ]);
  return [...ongoing, ...upcoming].map((d) => ({ discount_id: String(d.discount_id), name: d.discount_name, start_time: d.start_time, end_time: d.end_time, status: d.status }));
}, ['shopee-discount-options'], { revalidate: 120, tags: ['discounts'] });

// ตะกร้าเดียวในหน้าสินค้า: อยู่โปรส่วนลดไหน (รายตัวเลือก) + โปรที่ใส่เพิ่มได้
// in: [{ discount_id, name, start_time, end_time, staging, models: { [model_id]: promoPrice } }]
// others: โปรประเภทอื่น (Flash Sale ฯลฯ) โชว์เฉยๆ · options: [{ discount_id, name, start_time, end_time, status }]
// จำกัดการซื้อไม่ได้อ่านตอนเปิดหน้า (หนัก) — ตอนบันทึกเซิร์ฟเวอร์อ่านค่าจริงจากโปรเอง (shopeeSaveBasket)
export async function shopeeItemPromo(shop, itemId) {
  const auth = await shopeeAuth(shop);
  const [promos, options] = await Promise.all([
    getItemPromotion({ ...auth, itemIds: [itemId] }).then((m) => m.get(String(itemId)) || []),
    discountOptions(shop),
  ]);
  const nameOf = new Map(options.map((o) => [o.discount_id, o.name]));
  const byId = new Map();
  const others = [];
  for (const p of promos) {
    if (!/discount/i.test(p.type)) { others.push(p); continue; }
    if (!byId.has(p.promotion_id)) {
      byId.set(p.promotion_id, { discount_id: p.promotion_id, name: nameOf.get(p.promotion_id) || null, start_time: p.start_time, end_time: p.end_time, staging: p.staging, models: {} });
    }
    byId.get(p.promotion_id).models[p.model_id] = p.price;
  }
  return { in: [...byId.values()], others, options };
}

// ── แก้โปรของตะกร้าเดียว (ปุ่มบันทึกในหน้าโปร / หน้าสินค้า) ──────────────
// ⚠ เขียนลงร้านจริง — เชื่อข้อมูลจาก Shopee เท่านั้น ไม่เชื่อว่าเบราว์เซอร์คิดว่าตัวไหนอยู่ในโปร (หน้าอาจค้างนาน
//   หรือมีคนแก้จากหลังร้าน/BigSeller ไปแล้ว) · บทเรียนจากการทดสอบจริงกับตะกร้า [TEST] (2026-10-16):
//   - ไม่ส่ง purchase_limit = Shopee ตั้งเป็น 0 ทับค่าเดิม → ส่งค่าเดิมที่อ่านจากโปรเสมอ
//   - บางตัวเลือกได้ error_server แบบสุ่มใน error_list ทั้งที่คำขอสำเร็จ → อ่านโปรใหม่ก่อนส่งซ้ำ
//     (ตัวที่เข้าไปแล้วด้วยราคาที่ต้องการนับว่าสำเร็จ ไม่ add ซ้ำ)
//   - Shopee อัปเดตไม่ทันที อ่านทันทีอาจได้ค่าเก่า
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = /not_found|error_server|error_busy|Something wrong/i;
const GONE = /discount_item_not_exist|not in this discount/i;
export const MAX_OFF = 90;   // Shopee ลดได้ไม่เกิน ~90% — เช็คซ้ำที่เซิร์ฟเวอร์ (ไม่เชื่อหน้าเว็บอย่างเดียว)
const cents = (x) => Math.round(Number(x) * 100);   // เทียบราคาเป็นสตางค์ — ทศนิยม/Shopee ปัดเองจะได้ไม่ส่งซ้ำผิดๆ

// ข้อมูลที่ส่งมาผิด (ราคา/ตัวเลือก) — API ตอบ 400 ไม่ใช่ 500
export class ValidationError extends Error {}

async function withRetry(fn, tries = 3) {
  for (let i = 1; ; i += 1) {
    try { return await fn(); } catch (e) {
      if (i >= tries || !TRANSIENT.test(String(e.message))) throw e;
      await sleep(1500 * i);
    }
  }
}

// สถานะจริงของตะกร้าในโปร: current = Map(model_id → ราคาโปร) · limit = จำกัดการซื้อ (null = ไม่อยู่ในโปร)
// อ่านไม่ครบ (โปรใหญ่เกินเพดาน) แล้วหาไม่เจอ → หยุด ห้ามสรุปว่า "ไม่อยู่" (จะส่ง limit 0 ทับค่าจริง)
async function itemInDiscount(auth, discountId, itemId) {
  const d = await withRetry(() => getDiscount({ ...auth, discountId, maxPages: 30 }));
  const it = (d.item_list || []).find((i) => String(i.item_id) === String(itemId));
  if (!it && d.truncated) throw new Error('โปรนี้มีสินค้าเยอะเกินกว่าที่อ่านได้ครบ — ไม่บันทึก กันค่าจำกัดการซื้อถูกทับ (แก้ในหลังร้าน Shopee)');
  const current = new Map();
  if (it) {
    const ms = it.model_list || [];
    if (ms.length) for (const m of ms) current.set(String(Number(m.model_id) ? m.model_id : 0), Number(m.model_promotion_price));
    else current.set('0', Number(it.item_promotion_price));
  }
  return { limit: it ? Number(it.purchase_limit || 0) : null, current, status: d.status || null, name: d.discount_name || null };
}

// ราคาโปรตอนนี้ของตะกร้านี้ในโปรนี้ — ใช้ตอนอ่านซ้ำก่อนส่งซ้ำ (เรียกครั้งเดียว ไม่ต้องอ่านโปรทั้งก้อน กันหมดเวลา 60 วิ)
async function promoNow(auth, discountId, itemId) {
  const m = await withRetry(() => getItemPromotion({ ...auth, itemIds: [itemId] }));
  const out = new Map();
  for (const p of m.get(String(itemId)) || []) {
    if (p.promotion_id === String(discountId)) out.set(String(Number(p.model_id) ? p.model_id : 0), Number(p.price));
  }
  return out;
}

// ราคาปกติจริงของทุกตัวเลือก (จากตัวสินค้า) — ตรวจราคา และตรวจว่า model_id เป็นของตะกร้านี้จริง
async function itemOriginalPrices(auth, itemId) {
  const [base] = await withRetry(() => getItemBaseInfo({ ...auth, itemIds: [String(itemId)] }));
  if (!base) throw new Error('ไม่พบตะกร้านี้ใน Shopee');
  const out = new Map();
  if (base.has_model) {
    const r = await withRetry(() => getModelList({ ...auth, itemId }));
    for (const m of r.model || []) out.set(String(m.model_id), Number(m.price_info?.[0]?.original_price));
  } else {
    out.set('0', Number(base.price_info?.[0]?.original_price));
  }
  return out;
}

// set: [{ model_id, price }] ให้อยู่ในโปรที่ราคานี้ (model_id 0 = ตะกร้าไม่มีตัวเลือก) — อยู่แล้ว = update · ยังไม่อยู่ = add
// remove: [model_id] เอาออก · purchaseLimit: ตัวเลขเมื่อผู้ใช้ตั้งใหม่ · null/undefined = ใช้ค่าเดิมในโปร (ยังไม่อยู่ = 0)
// meta: { ip, ua } เก็บลงประวัติ · คืน [{ model_id, action: update|add|remove|noop, error }] (noop = สั่งเอาออกแต่ไม่อยู่ในโปรอยู่แล้ว)
export async function shopeeSaveBasket({ shop, discountId, itemId, purchaseLimit, set = [], remove = [], meta = {} }) {
  const auth = await shopeeAuth(shop);
  const [st, orig] = await Promise.all([itemInDiscount(auth, discountId, itemId), itemOriginalPrices(auth, itemId)]);
  if (st.status === 'expired') throw new ValidationError('โปรนี้หมดอายุแล้ว แก้ไม่ได้');

  // ตรวจซ้ำที่เซิร์ฟเวอร์ — ยิง API ตรงๆ ก็ตั้งราคาผิดไม่ได้
  const inSet = new Set(set.map((m) => String(m.model_id)));
  for (const x of remove) if (inSet.has(String(x))) throw new ValidationError(`ตัวเลือก ${x} อยู่ทั้งในรายการแก้และรายการเอาออก`);
  for (const m of set) {
    const o = orig.get(String(m.model_id));
    if (o === undefined) throw new ValidationError(`ตัวเลือก ${m.model_id} ไม่ใช่ของตะกร้านี้`);
    if (!(m.price > 0 && m.price < o)) throw new ValidationError(`ตัวเลือก ${m.model_id}: ราคาโปร ${m.price} ต้องต่ำกว่าราคาปกติ ${o}`);
    // เพดานแข็ง: ราคาโปรต้องไม่ต่ำกว่า 10% ของราคาปกติ (ไม่ปัด % — ลด 90.4% ก็ไม่ผ่าน)
    if (m.price < o * (1 - MAX_OFF / 100)) throw new ValidationError(`ตัวเลือก ${m.model_id}: ลดเกิน ${MAX_OFF}%`);
  }
  for (const x of remove) if (!orig.has(String(x))) throw new ValidationError(`ตัวเลือก ${x} ไม่ใช่ของตะกร้านี้`);

  const limit = purchaseLimit === null || purchaseLimit === undefined ? (st.limit ?? 0) : purchaseLimit;
  const results = [];
  const done = (model_id, action, error = null) => results.push({ model_id: String(model_id), action, error });
  // บันทึกประวัติทันทีหลังเขียนแต่ละครั้ง — ถ้าฟังก์ชันหมดเวลากลางทาง ส่วนที่เขียนลงร้านไปแล้วยังมีประวัติ
  let logged = 0;
  const flush = async () => {
    const fresh = results.slice(logged);
    logged = results.length;
    await writeLog({ shop, discountId, itemId, st, limit, set, results: fresh, meta });
  };

  let todo = set.map((m) => ({ model_id: String(m.model_id), price: Number(m.price) }));
  let cur = st.current;
  for (let round = 1; todo.length && round <= 3; round += 1) {
    if (round > 1) {
      // อ่านราคาโปรใหม่ก่อนส่งซ้ำ — ตัวที่เข้าไปแล้วด้วยราคาที่ต้องการ = สำเร็จ (ไม่ add ซ้ำ)
      await sleep(1500);
      cur = await promoNow(auth, discountId, itemId);
      todo = todo.filter((m) => {
        if (cur.has(m.model_id) && cents(cur.get(m.model_id)) === cents(m.price)) { done(m.model_id, st.current.has(m.model_id) ? 'update' : 'add'); return false; }
        return true;
      });
      await flush();
      if (!todo.length) break;
    }
    const next = [];
    for (const [action, list] of [['update', todo.filter((m) => cur.has(m.model_id))], ['add', todo.filter((m) => !cur.has(m.model_id))]]) {
      if (!list.length) continue;
      const fn = action === 'add' ? addDiscountItems : updateDiscountItems;
      let r;
      try {
        r = await fn({ ...auth, discountId, items: [{ item_id: itemId, purchase_limit: limit, models: list }] });
      } catch (e) {
        if (TRANSIENT.test(String(e.message)) && round < 3) next.push(...list);
        else for (const m of list) done(m.model_id, action, String(e.message || e));
        await flush();
        continue;
      }
      const failed = new Map(r.errors.map((e) => [String(e.model_id || 0), e]));
      for (const m of list) {
        const f = failed.get(m.model_id);
        if (!f) done(m.model_id, action);
        else if (TRANSIENT.test(String(f.fail_error || f.fail_message)) && round < 3) next.push(m);
        else done(m.model_id, action, f.fail_message || f.fail_error || 'ไม่ทราบสาเหตุ');
      }
      await flush();
    }
    todo = next;
  }

  for (const x of remove.map(String)) {
    if (!st.current.has(x)) { done(x, 'noop'); continue; }   // ไม่อยู่ในโปรอยู่แล้ว — ไม่ได้ยิงอะไร
    try {
      const r = await withRetry(() => deleteDiscountItem({ ...auth, discountId, itemId, modelId: x }));
      const f = r.errors[0];
      done(x, 'remove', f && !GONE.test(String(f.fail_error || f.fail_message)) ? (f.fail_message || f.fail_error) : null);
    } catch (e) {
      // ส่งซ้ำหลังลบสำเร็จไปแล้ว → "ไม่อยู่ในโปร" = สำเร็จ
      done(x, 'remove', GONE.test(String(e.message)) ? null : String(e.message || e));
    }
    await flush();
  }

  await flush();
  return results;
}

// ประวัติการแก้โปร (supabase/061) — ย้อนดูได้ว่าแก้อะไร เมื่อไร จากเครื่องไหน · บันทึกไม่ได้ไม่ทำให้การแก้ล้ม
// "ใคร" ยังเก็บไม่ได้ (ไม่มีล็อกอิน ใช้ PIN ตัวเดียวทั้งร้าน) — เก็บ IP + เบราว์เซอร์แทน
async function writeLog({ shop, discountId, itemId, st, limit, set, results, meta }) {
  const newPrice = new Map(set.map((m) => [String(m.model_id), Number(m.price)]));
  const rows = results.map((r) => ({
    platform: 'shopee', shop, discount_id: String(discountId), discount_name: st.name, item_id: String(itemId), model_id: r.model_id,
    action: r.action, old_price: st.current.get(r.model_id) ?? null,
    new_price: r.action === 'remove' || r.action === 'noop' ? null : newPrice.get(r.model_id) ?? null,
    old_limit: st.limit, new_limit: r.action === 'remove' || r.action === 'noop' ? null : limit, ok: !r.error, error: r.error,
    ip: meta.ip || null, user_agent: meta.ua ? String(meta.ua).slice(0, 300) : null,
  }));
  if (!rows.length) return;
  try {
    const { error } = await db().from('os_discount_log').insert(rows);
    if (error) console.warn('discount log:', error.message);
  } catch (e) {
    console.warn('discount log:', String(e.message || e));
  }
}

// ── TikTok (อ่าน) ────────────────────────────────────────────────────────
// ก้อนจริง (ส่อง 2026-10-17 SOLID): หัวโปร id/title/status/begin_time/end_time(วินาที)/product_level/activity_type
//   products[].discount = % ลดทั้งตะกร้า (product_level PRODUCT) · products[].skus[].discount = % รายตัวเลือก (VARIATION)
//   activity_price มีแต่ currency (ไม่มี amount) ในโปรแบบ % — ราคาโปรคิดเองจากราคาปกติที่ซิงก์ไว้ · quantity_per_user -1 = ไม่จำกัด
//   ไม่มีชื่อ/ราคา/คลังในก้อนโปร → เติมจาก os_listings / os_listing_skus
const TT_STATUS = { ongoing: ['ONGOING'], upcoming: ['NOT_START'], expired: ['EXPIRED', 'DEACTIVATED'] };   // search รับแค่ NOT_START/ONGOING/EXPIRED/DEACTIVATED (17029001)
const ttStatus = (s) => Object.keys(TT_STATUS).find((k) => TT_STATUS[k].includes(s)) || (s ? String(s).toLowerCase() : null);
export const TT_TYPE = { DIRECT_DISCOUNT: 'ส่วนลดสินค้า', FIXED_PRICE: 'ราคาตายตัว', FLASHSALE: 'Flash Sale' };

export async function tiktokShops() {
  return (await listShops('tiktok')).map((r) => r.shop).sort();
}

async function tiktokAuth(shop) {
  const row = (await listShops('tiktok')).find((r) => r.shop === shop);
  if (!row) throw new Error(`ไม่พบโทเคนของร้าน TikTok ${shop}`);
  const tok = storedToken(row);
  return { accessToken: tok.access_token, shopCipher: tok.shop_cipher };
}

// TikTok จำกัดอัตราร่วมทั้งกลุ่มแอป (36009002 — เจอจริงตอนส่อง) → รอแล้วลองใหม่ · ไม่มีสิทธิ์ (105005) บอกวิธีแก้
// tries: ตอนบันทึกให้รอนานขึ้น (เจอ 36009002 บ่อยแม้ยิงห่าง 20–30 วิ — แอปอื่นในกลุ่ม/รอบซิงก์ใช้โควตาร่วม)
async function ttCall(fn, tries = 3) {
  for (let i = 1; ; i += 1) {
    try { return await fn(); } catch (e) {
      const m = String(e.message || e);
      if (/code=105005/.test(m)) throw new Error('แอป TikTok ของร้านนี้ยังไม่มีสิทธิ์ Promotion (105005) — เพิ่ม scope Promotion ให้แอปใน Partner Center แล้วกดอนุญาตร้านใหม่');
      if (i >= tries || !/code=36009002/.test(m)) throw e;
      await sleep(2000 * i);
    }
  }
}

const ttHead = (a) => ({
  discount_id: String(a.id || a.activity_id), discount_name: a.title || null, start_time: a.begin_time, end_time: a.end_time,
  status: ttStatus(a.status), raw_status: a.status || null, type: a.activity_type || null, level: a.product_level || null,
});

// โปรตามสถานะ · upcoming/expired รวมหลายสถานะ TikTok · maxPages ต่อสถานะ (หน้าละ 100)
export async function tiktokDiscountList(shop, status, maxPages) {
  const auth = await tiktokAuth(shop);
  const lists = [];
  for (const st of TT_STATUS[status] || []) lists.push(await ttCall(() => searchActivities({ ...auth, status: st, maxPages })));
  const out = lists.flat().map(ttHead);
  out.truncated = lists.some((l) => l.truncated);
  return out;
}

const num = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const pctPrice = (price, off) => (price === null || off === null ? null : Math.round(price * (1 - off / 100) * 100) / 100);
const perUser = (x) => (num(x) === null || Number(x) < 0 ? 0 : Number(x));   // -1 = ไม่จำกัด → 0 (แบบ Shopee)

// รายตัวเลือกในโปร → แถวรูปแบบเดียวกับ discountRows ของ Shopee (หน้าโปรใช้ร่วมกัน)
// skusOf: Map(product_id → แถว os_listing_skus) · ตัวที่ไม่เจอใน DB ยังโชว์ (มีแค่รหัส)
function ttRows(act, skusOf, titleOf) {
  const rows = [];
  for (const p of act.products || []) {
    const pid = String(p.id);
    const known = skusOf.get(pid) || [];
    const byId = new Map(known.map((k) => [String(k.sku_id), k]));
    // PRODUCT: ทั้งตะกร้าลดเท่ากัน ไม่มี skus → ทุกตัวเลือกที่ซิงก์ไว้ · VARIATION: เฉพาะตัวที่อยู่ในโปร
    // VARIATION ที่ skus ว่าง (เอาตัวเลือกสุดท้ายออกด้วย sku_ids — ตะกร้าค้างอยู่แต่ไม่มีตัวไหนลด) → ข้าม
    if (act.product_level === 'VARIATION' && !p.skus?.length) continue;
    const list = p.skus?.length ? p.skus : (known.length ? known.map((k) => ({ id: k.sku_id })) : [{ id: pid }]);
    for (const s of list) {
      const k = byId.get(String(s.id)) || {};
      const off = num(s.discount ?? p.discount);
      const fixed = num(s.activity_price?.amount ?? p.activity_price?.amount);
      const price = num(k.price);
      const qty = num(s.quantity_limit ?? p.quantity_limit);
      rows.push({
        item_id: pid, sku_id: String(s.id), item_name: titleOf.get(pid) || null, model_name: k.variant || null, seller_sku: k.seller_sku || null,
        price, promo: fixed ?? pctPrice(price, off), off: fixed === null ? off : null, stock: k.stock ?? null,
        limit: perUser(s.quantity_per_user ?? p.quantity_per_user), promo_stock: qty > 0 ? qty : null,
      });
    }
  }
  return rows;
}

// เติมชื่อ/รูป/ตัวเลือก/ราคา/คลังจากที่ซิงก์ไว้ (ทั้ง TikTok และ Lazada)
async function listingInfo(platform, shop, pids) {
  const skusOf = new Map();
  const listingOf = new Map();
  // ทีละ 25 ตะกร้า ยิงขนานทีละ 6 ชุด · Supabase ตอบได้ไม่เกิน 1000 แถวต่อคำขอ (25 ตะกร้าเกินได้ — เคยหายจริง) → อ่านต่อจนครบ
  const skusPage = async (ids) => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const r = await db().from('os_listing_skus').select('product_id, sku_id, seller_sku, variant, price, promo_price, stock, sort')
        .eq('platform', platform).eq('shop', shop).in('product_id', ids).order('product_id').order('sort').order('sku_id').range(from, from + 999);
      if (r.error) return r;
      out.push(...(r.data || []));
      if (!r.data || r.data.length < 1000) return { data: out };
    }
  };
  const parts = [];
  for (let i = 0; i < pids.length; i += 25) parts.push(pids.slice(i, i + 25));
  for (let i = 0; i < parts.length; i += 6) {
    const got = await Promise.all(parts.slice(i, i + 6).map((ids) => Promise.all([
      skusPage(ids),
      db().from('os_listings').select('product_id, title, thumb_url, item_sku, synced_at')
        .eq('platform', platform).eq('shop', shop).in('product_id', ids),
    ])));
    for (const [s, l] of got) {
      if (s.error) throw new Error(s.error.message);
      if (l.error) throw new Error(l.error.message);
      for (const x of s.data || []) {
        const k = String(x.product_id);
        if (!skusOf.has(k)) skusOf.set(k, []);
        skusOf.get(k).push(x);
      }
      for (const x of l.data || []) listingOf.set(String(x.product_id), x);
    }
  }
  return { skusOf, listingOf, titleOf: new Map([...listingOf].map(([k, v]) => [k, v.title])) };
}

export async function tiktokDiscountDetail(shop, activityId) {
  const auth = await tiktokAuth(shop);
  const act = await ttCall(() => getActivity({ ...auth, activityId }));
  const pids = [...new Set((act.products || []).map((p) => String(p.id)))];
  const { skusOf, listingOf, titleOf } = await listingInfo('tiktok', shop, pids);
  return { head: ttHead(act), rows: ttRows(act, skusOf, titleOf), listings: Object.fromEntries(listingOf) };
}

// ── TikTok: แก้โปรของตะกร้าเดียว (ปุ่มบันทึกในหน้าโปร /discount/tiktok/...) ─────────
// ⚠ เขียนลงร้านจริง — อ่านโปร + ราคาปกติจาก TikTok ใหม่ทุกครั้ง ไม่เชื่อหน้าเว็บ
// ส่องจริงกับสินค้า+โปร [TEST] (2026-10-17 SOLID):
//   - PUT .../products = ใส่/แก้แบบ upsert รายตัวเลือก — ตัวที่ไม่ได้ส่งคงเดิม (ไม่ถูกลบ) · ทั้งคำขอสำเร็จ/ล้มพร้อมกัน
//   - quantity_limit / quantity_per_user ต้องส่งทุกครั้งทั้งระดับตะกร้าและตัวเลือก (36009004) → ส่งค่าเดิมที่อ่านจากโปร (-1 = ไม่จำกัด)
//     quantity_limit (สต็อกโปร) เกินคลังจริงไม่ได้ (17029018) — ไม่แตะ ส่งค่าเดิม
//   - DIRECT_DISCOUNT: discount = ข้อความเลขจำนวนเต็ม 1–99 (ทศนิยมไม่รับ 17029001)
//   - FIXED_PRICE: activity_price_amount ทศนิยมได้ (120.5 ได้ 120.5) · ลดน้อยไป 17029063 / มากไป 17029021 → TikTok ปฏิเสธเอง
//   - VARIATION ต้องมี skus อย่างน้อยหนึ่งตัว · PRODUCT ส่ง discount/ราคาที่ตัวตะกร้า ไม่มี skus
//   - DELETE .../products: product_ids = ทั้งตะกร้า · sku_ids = รายตัวเลือก — เอาตัวสุดท้ายออกด้วย sku_ids ตะกร้าค้างแบบ skus ว่าง
//     → ถ้าจะไม่เหลือตัวไหนเลย ใช้ product_ids แทน
//   - โปรที่กำลังดำเนินการ (ONGOING): แก้ %/ราคา ใส่/เอาออกได้ แต่เปลี่ยน quantity_per_user/quantity_limit ไม่ได้ (17029066)
//     → ตัวที่อยู่แล้วส่งค่าเดิม · หน้าเว็บซ่อนช่องจำกัดการซื้อ · เซิร์ฟเวอร์ปฏิเสธถ้าส่งค่าใหม่มา
//   - ตะกร้าแบบร่าง (DRAFT) ใส่โปรได้ · rate limit 36009002 ร่วมทั้งกลุ่มแอป (ttCall รอแล้วลองใหม่)
export const TT_EDITABLE = ['DIRECT_DISCOUNT', 'FIXED_PRICE'];
const TT_TRIES = 4;   // รอ rate limit สูงสุด 2+4+6 = 12 วิ ต่อคำขอ · บันทึกหนึ่งครั้งยิงไม่เกิน 4 คำขอ (route ให้เวลา 60 วิ)
// ข้อความ error ที่เจอจริงตอนส่อง → ภาษาไทย (ต่อท้ายรหัสเดิมไว้ค้นต่อ)
const TT_ERR = {
  17029063: 'ลดน้อยกว่าขั้นต่ำที่ TikTok กำหนด — ลดเพิ่ม',
  17029021: 'ลดเกินเพดานที่ TikTok กำหนด — ลดน้อยลง',
  17029018: 'สต็อกโปรเกินคลังที่มีจริง',
  17029001: 'ค่าที่ส่งอยู่นอกช่วงที่ TikTok รับ',
  17029066: 'โปรที่กำลังดำเนินการแก้จำกัดการซื้อ/สต็อกโปรไม่ได้',
  36009002: 'TikTok ให้รอสักครู่ (ยิงถี่เกิน) — ลองกดบันทึกใหม่',
};
export const ttErr = (e) => {
  const m = String(e?.message || e);
  const code = /code=(\d+)/.exec(m)?.[1];
  return code && TT_ERR[code] ? `${TT_ERR[code]} (${code})` : m;
};
const qty = (x) => (num(x) === null ? -1 : Number(x));   // ไม่มีค่า = ไม่จำกัด (-1)

// set: [{ model_id: sku_id (PRODUCT = รหัสตะกร้า), discount (%) | price (บาท) }] · remove: [sku_id] (PRODUCT = [รหัสตะกร้า])
// purchaseLimit: ตัวเลข (0 = ไม่จำกัด) เมื่อผู้ใช้ตั้งใหม่ · null = คงค่าเดิมในโปร
// คืน [{ model_id, action: update|add|remove|noop, error }] รูปแบบเดียวกับ shopeeSaveBasket
export async function tiktokSaveBasket({ shop, activityId, productId, purchaseLimit, set = [], remove = [], meta = {} }) {
  const auth = await tiktokAuth(shop);
  const act = await ttCall(() => getActivity({ ...auth, activityId }), TT_TRIES);
  if (ttStatus(act.status) === 'expired') throw new ValidationError('โปรนี้หมดอายุ/ปิดแล้ว แก้ไม่ได้');
  const type = act.activity_type;
  if (!TT_EDITABLE.includes(type)) throw new ValidationError(`โปรประเภท ${TT_TYPE[type] || type} ยังแก้จากที่นี่ไม่ได้ — แก้ในหลังร้าน TikTok`);
  const whole = act.product_level === 'PRODUCT';
  const pct = type === 'DIRECT_DISCOUNT';

  const prod = await ttCall(() => getProduct({ ...auth, productId }), TT_TRIES);
  const orig = new Map((prod.skus || []).map((s) => [String(s.id), num(s.price?.sale_price ?? s.price?.tax_exclusive_price)]));
  if (!orig.size) throw new Error('ไม่พบตะกร้านี้ใน TikTok');
  const cur = (act.products || []).find((p) => String(p.id) === String(productId)) || null;
  const curSku = new Map((cur?.skus || []).map((s) => [String(s.id), s]));
  // ตัวที่อยู่ในโปรตอนนี้ (PRODUCT = ทั้งตะกร้าเป็นหน่วยเดียว คีย์ = รหัสตะกร้า)
  const inPromo = new Set(whole ? (cur ? [String(productId)] : []) : [...curSku.keys()]);
  const valueOf = (x) => (pct ? num(x?.discount) : num(x?.activity_price?.amount));
  const oldVal = (k) => (whole ? (cur ? valueOf(cur) : null) : (curSku.has(k) ? valueOf(curSku.get(k)) : null));

  // ── ตรวจซ้ำที่เซิร์ฟเวอร์ — ยิง API ตรงๆ ก็ตั้งผิดไม่ได้ ──
  const want = set.map((m) => ({ model_id: String(m.model_id), v: num(pct ? m.discount : m.price) }));
  const inSet = new Set(want.map((m) => m.model_id));
  for (const x of remove) if (inSet.has(String(x))) throw new ValidationError(`ตัวเลือก ${x} อยู่ทั้งในรายการแก้และรายการเอาออก`);
  const own = (k) => (whole ? k === String(productId) : orig.has(k));
  for (const k of [...inSet, ...remove.map(String)]) if (!own(k)) throw new ValidationError(`ตัวเลือก ${k} ไม่ใช่ของตะกร้านี้`);
  for (const m of want) {
    if (pct) {
      if (!(Number.isInteger(m.v) && m.v >= 1 && m.v <= MAX_OFF)) throw new ValidationError(`ตัวเลือก ${m.model_id}: % ลดต้องเป็นจำนวนเต็ม 1–${MAX_OFF}`);
      continue;
    }
    // ราคาตายตัว: ต่ำกว่าราคาปกติ และไม่ต่ำกว่า 10% ของราคาปกติ (PRODUCT = ต้องผ่านทุกตัวเลือกของตะกร้า)
    const ps = whole ? [...orig.values()] : [orig.get(m.model_id)];
    if (m.v !== null) m.v = Math.round(m.v * 100) / 100;
    if (!(m.v > 0) || ps.some((o) => o === null || o === undefined)) throw new ValidationError(`ตัวเลือก ${m.model_id}: ราคาโปรไม่ถูกต้อง หรือไม่รู้ราคาปกติ`);
    if (ps.some((o) => m.v >= o)) throw new ValidationError(`ตัวเลือก ${m.model_id}: ราคาโปร ${m.v} ต้องต่ำกว่าราคาปกติ ${Math.min(...ps)}`);
    if (ps.some((o) => m.v < o * (1 - MAX_OFF / 100))) throw new ValidationError(`ตัวเลือก ${m.model_id}: ลดเกิน ${MAX_OFF}%`);
  }

  let perUserOut = purchaseLimit === null || purchaseLimit === undefined ? null : (purchaseLimit > 0 ? purchaseLimit : -1);
  if (perUserOut !== null && ttStatus(act.status) === 'ongoing') {
    if (cur && perUserOut === qty(cur.quantity_per_user)) perUserOut = null;   // ค่าเดิม = ไม่ได้เปลี่ยน
    else throw new ValidationError('โปรที่กำลังดำเนินการ TikTok ไม่ยอมให้แก้จำกัดการซื้อ — แก้ได้แค่ราคา/% และเอาเข้า/ออก');
  }
  const results = [];
  const done = (model_id, action, error = null) => results.push({ model_id: String(model_id), action, error });
  const head = { name: act.title || null, oldVal, priceOf: (k) => (whole ? null : orig.get(k) ?? null), pct, limit: cur ? perUser(cur.quantity_per_user) : null };
  const field = (v) => (pct ? { discount: String(v) } : { activity_price_amount: String(v) });

  if (want.length) {
    // สต็อกโปร (quantity_limit) ส่งค่าเดิมเสมอ · จำกัดต่อคน: ตั้งใหม่ = ทุกตัวที่ส่ง · ไม่ตั้ง = ค่าเดิมของตัวนั้น (ตัวใหม่ใช้ค่าของตะกร้า)
    const pQpu = perUserOut ?? qty(cur?.quantity_per_user);
    const p = { id: String(productId), quantity_limit: qty(cur?.quantity_limit), quantity_per_user: pQpu };
    if (whole) Object.assign(p, field(want[0].v));
    else {
      p.skus = want.map((m) => {
        const c = curSku.get(m.model_id);
        return { id: m.model_id, ...field(m.v), quantity_limit: qty(c?.quantity_limit), quantity_per_user: perUserOut ?? (c ? qty(c.quantity_per_user) : pQpu) };
      });
    }
    try {
      await ttCall(() => updateActivityProducts({ ...auth, activityId, products: [p] }), TT_TRIES);
      for (const m of want) done(m.model_id, inPromo.has(m.model_id) ? 'update' : 'add');
    } catch (e) {
      for (const m of want) done(m.model_id, inPromo.has(m.model_id) ? 'update' : 'add', ttErr(e));
    }
    await ttLog({ shop, activityId, productId, head, want, perUserOut, results: results.slice(), meta });
  }

  const rm = remove.map(String);
  for (const k of rm.filter((x) => !inPromo.has(x))) done(k, 'noop');   // ไม่อยู่ในโปรอยู่แล้ว — ไม่ได้ยิงอะไร
  const live = rm.filter((k) => inPromo.has(k));
  if (live.length) {
    const from = results.length;
    // เหลือกี่ตัวหลังเอาออก (นับตัวที่เพิ่งใส่สำเร็จด้วย) — ไม่เหลือเลย = เอาออกทั้งตะกร้า (sku_ids ตัวสุดท้ายทิ้งตะกร้าว่างค้าง)
    const left = new Set([...inPromo, ...results.filter((r) => r.action === 'add' && !r.error).map((r) => r.model_id)]);
    for (const k of live) left.delete(k);
    const byProduct = whole || !left.size;
    try {
      await ttCall(() => removeActivityProducts({ ...auth, activityId, ...(byProduct ? { productIds: [productId] } : { skuIds: live }) }), TT_TRIES);
      for (const k of live) done(k, 'remove');
    } catch (e) {
      // 17029023 = ไม่อยู่ในโปรแล้ว (มีคนเอาออกจากหลังร้านระหว่างอ่านกับลบ) → นับว่าสำเร็จ
      for (const k of live) done(k, 'remove', /code=17029023/.test(String(e.message)) ? null : ttErr(e));
    }
    await ttLog({ shop, activityId, productId, head, want, perUserOut, results: results.slice(from), meta });
  }
  return results;
}

// ประวัติลง os_discount_log เหมือน Shopee · โปรแบบ %: เก็บ % ใน old_pct/new_pct (supabase/062) + ราคาบาทที่คิดจากราคาปกติตอนแก้
// ยังไม่รัน 062 → บันทึกซ้ำโดยไม่มีคอลัมน์ % (บันทึกไม่ได้ไม่ทำให้การแก้ล้ม)
async function ttLog({ shop, activityId, productId, head, want, perUserOut, results, meta }) {
  const newV = new Map(want.map((m) => [m.model_id, m.v]));
  const asPrice = (k, v) => (v === null || v === undefined ? null : head.pct ? pctPrice(head.priceOf(k), v) : v);
  const rows = results.filter((r) => r.action !== 'noop').map((r) => {
    const o = head.oldVal(r.model_id);
    const n = r.action === 'remove' ? null : newV.get(r.model_id) ?? null;
    return {
      platform: 'tiktok', shop, discount_id: String(activityId), discount_name: head.name, item_id: String(productId), model_id: r.model_id,
      action: r.action, old_price: asPrice(r.model_id, o), new_price: asPrice(r.model_id, n),
      old_limit: head.limit, new_limit: r.action === 'remove' ? null : (perUserOut === null ? head.limit : Math.max(0, perUserOut)),
      ok: !r.error, error: r.error, ip: meta.ip || null, user_agent: meta.ua ? String(meta.ua).slice(0, 300) : null,
      ...(head.pct ? { old_pct: o, new_pct: n } : {}),
    };
  });
  if (!rows.length) return;
  try {
    let { error } = await db().from('os_discount_log').insert(rows);
    if (error && head.pct && /old_pct|new_pct/i.test(error.message)) {
      ({ error } = await db().from('os_discount_log').insert(rows.map(({ old_pct: _o, new_pct: _n, ...x }) => x)));
    }
    if (error) console.warn('discount log:', error.message);
  } catch (e) {
    console.warn('discount log:', String(e.message || e));
  }
}

// ── TikTok: ตะกร้าเดียวอยู่โปรไหน (ช่อง "โปรส่วนลด" ในหน้าสินค้า) ───────────────
// TikTok ไม่มี API ถาม "ตะกร้านี้อยู่โปรไหน" แบบ get_item_promotion ของ Shopee → อ่านทุกโปรที่ยังไม่จบ
// (กำลังดำเนินการ + เร็วๆ นี้) ทีละโปรแล้วจำเป็นดัชนีไว้ 5 นาทีต่อร้าน (ใช้ร่วมทุกตะกร้า) · บันทึกโปรแล้ว tag discounts ล้างให้
// เก็บเฉพาะตัวเลขที่ใช้ — ก้อนเต็มของทุกโปรเกิน 2MB แล้ว unstable_cache ไม่จำ
const ttActiveIndex = unstable_cache(async (shop) => {
  const auth = await tiktokAuth(shop);
  const heads = [];
  for (const st of [...TT_STATUS.ongoing, ...TT_STATUS.upcoming]) heads.push(...await ttCall(() => searchActivities({ ...auth, status: st, maxPages: 3 })));
  const pick = (x) => ({ d: num(x.discount), a: num(x.activity_price?.amount), q: num(x.quantity_per_user) });
  const out = [];
  for (const h of heads) {
    const a = await ttCall(() => getActivity({ ...auth, activityId: h.id || h.activity_id }), TT_TRIES);
    const products = {};
    for (const p of a.products || []) {
      products[String(p.id)] = { ...pick(p), skus: p.skus?.length ? Object.fromEntries(p.skus.map((s) => [String(s.id), pick(s)])) : null };
    }
    out.push({ ...ttHead(a), discount_id: String(a.activity_id || a.id || h.id), products });
  }
  return out;
}, ['tiktok-active-index'], { revalidate: 300, tags: ['discounts'] });

// in: [{ discount_id, name, start_time, end_time, staging, type, level, product: { d, a, q, skus } }] — โปรประเภทที่แก้ได้
// others: โปรประเภทอื่น (Flash Sale ฯลฯ) ที่ตะกร้านี้อยู่ · options: โปรที่แก้ได้แต่ตะกร้านี้ยังไม่อยู่ (ใส่เข้าได้)
// d = % ลด · a = ราคาตายตัว · q = จำกัดต่อคน (-1 ไม่จำกัด) · skus null = โปรระดับตะกร้า (ทุกตัวเลือกใช้ค่าตะกร้า)
export async function tiktokItemPromo(shop, productId) {
  const idx = await ttActiveIndex(shop);
  const pid = String(productId);
  const res = { in: [], others: [], options: [] };
  for (const a of idx) {
    const base = { discount_id: a.discount_id, name: a.discount_name, start_time: a.start_time, end_time: a.end_time, staging: a.status, type: a.type, level: a.level };
    const p = a.products[pid];
    const ok = TT_EDITABLE.includes(a.type);
    // VARIATION ที่ skus ว่าง = ไม่มีตัวไหนลดแล้ว (ดู ttRows) นับว่าไม่อยู่
    const inIt = p && !(a.level === 'VARIATION' && !p.skus);
    if (!inIt) { if (ok) res.options.push(base); }
    else if (ok) res.in.push({ ...base, product: p });
    else res.others.push({ ...base, label: `${a.discount_name || a.discount_id} (${TT_TYPE[a.type] || a.type})` });
  }
  return res;
}

// ── TikTok: เติม "ราคาพิเศษ" (os_listing_skus.promo_price) จากโปรที่กำลังดำเนินการ ──────────
// Product API ของ TikTok ไม่มีราคาโปร (normalizeListing ใส่ null) — หน้า /product จึงไม่เคยเห็นราคาลดแบบ BigSeller
// คิดแบบเดียวกับ BigSeller: ราคาตายตัว = activity_price · % ลด = ราคาปกติ × (1 − %) ปัด 2 ตำแหน่ง (395 ลด 22% = 308.10)
// หลายโปรทับกัน → เอาราคาต่ำสุด · เขียนเฉพาะแถวที่ค่าเปลี่ยน (upsert เฉพาะคอลัมน์ราคาโปร ไม่แตะ synced_at)
// productIds: ทำเฉพาะตะกร้าเหล่านี้ (ปุ่ม ↻ ของตะกร้าเดียว) · ไม่ส่ง = ทั้งร้าน (รอบตั้งเวลา)
export async function applyTiktokPromoPrices(shop, productIds = null) {
  const idx = await ttActiveIndex(shop);
  const live = idx.filter((a) => a.status === 'ongoing');
  const only = productIds ? new Set(productIds.map(String)) : null;
  const rows = [];
  if (only) {
    const { data, error } = await db().from('os_listing_skus').select('product_id, sku_id, price, promo_price')
      .eq('platform', 'tiktok').eq('shop', shop).in('product_id', [...only]);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  } else {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db().from('os_listing_skus').select('product_id, sku_id, price, promo_price')
        .eq('platform', 'tiktok').eq('shop', shop).order('sku_id').range(from, from + 999);
      if (error) throw new Error(error.message);
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }
  const byProduct = new Map();
  for (const r of rows) {
    const k = String(r.product_id);
    if (!byProduct.has(k)) byProduct.set(k, []);
    byProduct.get(k).push(r);
  }
  const want = new Map();   // sku_id → ราคาโปร
  for (const a of live) {
    for (const [pid, p] of Object.entries(a.products)) {
      for (const k of byProduct.get(pid) || []) {
        const v = a.level === 'PRODUCT' ? p : p.skus?.[String(k.sku_id)];
        if (!v) continue;
        const price = num(k.price);
        const promo = v.a ?? pctPrice(price, v.d);
        if (promo === null || (price !== null && promo >= price)) continue;
        const cur = want.get(String(k.sku_id));
        if (cur === undefined || promo < cur) want.set(String(k.sku_id), promo);
      }
    }
  }
  const changed = rows.filter((r) => (want.get(String(r.sku_id)) ?? null) !== num(r.promo_price));
  for (let i = 0; i < changed.length; i += 500) {
    const { error } = await db().from('os_listing_skus').upsert(
      changed.slice(i, i + 500).map((r) => ({ platform: 'tiktok', shop, product_id: String(r.product_id), sku_id: String(r.sku_id), promo_price: want.get(String(r.sku_id)) ?? null })),
      { onConflict: 'platform,shop,sku_id' },
    );
    if (error) throw new Error(error.message);
  }
  // ช่วงราคาโปรของตะกร้า (promo_min/max ใน os_listings — หน้ารายการสินค้าใช้) เฉพาะตะกร้าที่มีตัวเปลี่ยน
  const pids = [...new Set(changed.map((r) => String(r.product_id)))];
  const heads = pids.map((pid) => {
    const ps = (byProduct.get(pid) || []).map((k) => want.get(String(k.sku_id))).filter((x) => x !== undefined);
    return { platform: 'tiktok', shop, product_id: pid, promo_min: ps.length ? Math.min(...ps) : null, promo_max: ps.length ? Math.max(...ps) : null };
  });
  for (let i = 0; i < heads.length; i += 500) {
    const { error } = await db().from('os_listings').upsert(heads.slice(i, i + 500), { onConflict: 'platform,shop,product_id' });
    if (error) throw new Error(error.message);
  }
  return { activities: live.length, skus: rows.length, promo: want.size, changed: changed.length, products: pids.length };
}

// รอบซิงก์ดึงตะกร้าใหม่ทั้งก้อน (ราคาโปร null เพราะ Product API ไม่มี) → คงราคาโปรเดิมไว้จนรอบเติมราคาโปรถัดไป
// ไม่งั้นตะกร้าที่ถูกแก้จะหายจากแท็บ/ช่องราคาโปรไปจนกว่า applyTiktokPromoPrices จะวิ่ง
export async function keepTiktokPromo(shop, items) {
  const ids = items.map((x) => x.listing.product_id);
  if (!ids.length) return items;
  const { data, error } = await db().from('os_listing_skus').select('sku_id, promo_price')
    .eq('platform', 'tiktok').eq('shop', shop).in('product_id', ids).not('promo_price', 'is', null);
  if (error) return items;   // อ่านไม่ได้ก็แค่ไม่มีราคาโปรชั่วคราว
  const old = new Map((data || []).map((r) => [String(r.sku_id), num(r.promo_price)]));
  for (const x of items) for (const s of x.skus) if (s.promo_price === null && old.has(String(s.sku_id))) s.promo_price = old.get(String(s.sku_id));
  return items;
}

// ── Lazada ────────────────────────────────────────────────────────────────
// Lazada ไม่มี "โปรส่วนลด" แบบ Shopee/TikTok ให้อ่านผ่าน API (ส่อง 2026-10-17: vouchers / flexicombo มีแต่ของที่จบแล้ว)
// ส่วนลดรายสินค้าคือ "ราคาพิเศษ" (special_price) ของแต่ละ SKU — ซิงก์ไว้แล้วใน os_listing_skus.promo_price
// (lib/lazada.js promoOf นับเฉพาะที่อยู่ในช่วงวันตอนซิงก์) → แสดงเป็นโปรเดียวชื่อ "ราคาพิเศษ" รหัส special
// ⚠ ตัวเลขตามรอบซิงก์สินค้าล่าสุด ไม่ใช่สดจาก Lazada · ไม่รู้วันเริ่ม/จบ (ไม่ได้เก็บ)
export const LAZADA_SPECIAL = 'special';
const LAZADA_SPECIAL_NAME = 'ราคาพิเศษ (Special Price)';

export async function lazadaShops() {
  return (await listShops('lazada')).map((r) => r.shop).sort();
}

export async function lazadaDiscountList(shop, status) {
  if (status !== 'ongoing') return [];   // ไม่รู้วันเริ่ม/จบ — มีแต่ที่ใช้อยู่ตอนซิงก์
  const { count, error } = await db().from('os_listing_skus').select('sku_id', { count: 'exact', head: true })
    .eq('platform', 'lazada').eq('shop', shop).not('promo_price', 'is', null);
  if (error) throw new Error(error.message);
  return count ? [{ discount_id: LAZADA_SPECIAL, discount_name: LAZADA_SPECIAL_NAME, start_time: null, end_time: null, status: 'ongoing', count }] : [];
}

export async function lazadaSpecialDetail(shop) {
  const pids = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('os_listing_skus').select('product_id')
      .eq('platform', 'lazada').eq('shop', shop).not('promo_price', 'is', null)
      .order('product_id').order('sku_id').range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const x of data || []) pids.add(String(x.product_id));
    if (!data || data.length < 1000) break;
  }
  const { skusOf, listingOf } = await listingInfo('lazada', shop, [...pids]);
  const rows = [];
  let syncedAt = null;
  for (const [pid, ks] of skusOf) {
    const l = listingOf.get(pid);
    if (l?.synced_at && (!syncedAt || l.synced_at < syncedAt)) syncedAt = l.synced_at;   // เก่าสุด = ตัวเลขอาจช้าถึงตรงนี้
    for (const k of ks) {
      if (k.promo_price === null) continue;
      rows.push({
        item_id: pid, sku_id: String(k.sku_id), item_name: l?.title || null, model_name: k.variant || null, seller_sku: k.seller_sku || null,
        price: num(k.price), promo: num(k.promo_price), stock: k.stock ?? null, limit: null, promo_stock: null,
      });
    }
  }
  const head = { discount_id: LAZADA_SPECIAL, discount_name: LAZADA_SPECIAL_NAME, status: 'ongoing', start_time: null, end_time: null, synced_at: syncedAt };
  return { head, rows, listings: Object.fromEntries(listingOf) };
}

// ── Lazada: แก้ราคาพิเศษของตะกร้าเดียว (ป็อปอัพ "แก้โปร" ในหน้าสินค้า) ──────────────────
// ⚠ เขียนลงร้านจริง — อ่านตะกร้าจาก Lazada ใหม่ทุกครั้ง ไม่เชื่อหน้าเว็บ
// ส่องจริงกับสินค้า [TEST] (2026-10-17 SOLID, /product/price_quantity/update):
//   - ส่ง SalePrice + SaleStartDate + SaleEndDate ราย SKU → แตะเฉพาะ SKU ที่ส่ง ราคาปกติไม่เปลี่ยน · ทศนิยมได้ (405.5)
//   - วันที่รับ "yyyy-MM-dd HH:mm:ss" (เวลาไทย) อ่านกลับตรงตามที่ส่ง
//   - ⚠ ส่ง SalePrice อย่างเดียวไม่ส่งวันที่ → Lazada เลื่อนช่วงเวลาเดิม +1 ชม. เอง (12:30 → 13:30) จึงส่งวันที่เดิมกลับทุกครั้ง
//   - เอาราคาพิเศษออกตรงๆ ไม่ได้ (SalePrice ว่าง E501 / 0 ติดนโยบายราคา / /product/update ต้องส่ง Attributes ทั้งก้อน)
//     → ตั้งวันจบเป็นตอนนี้ (ราคาเดิม) = หมดอายุทันที หน้าเว็บนับเฉพาะที่อยู่ในช่วงวัน (promoOf)
//   - ราคาพิเศษ ≥ ราคาปกติ → SKU_PROMOTION_PRICE_OUT_OF_RATE_RANGE · ทั้งคำขอล้มพร้อมกัน
const LZ_FMT = (ms) => new Date(ms + 7 * 3600000).toISOString().slice(0, 19).replace('T', ' ');   // เวลาไทย yyyy-MM-dd HH:mm:ss
const LZ_YEAR = 365 * 86400000;   // ช่วงเวลาเริ่มต้นของราคาพิเศษใหม่: ตอนนี้ → อีก 1 ปี (ส่องแล้วรับ)
const lzTime = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + '+07:00') : null);
// Lazada แบนสั้นๆ เมื่อยิงถี่ (ApiCallLimit "ban will last 1 seconds" — เจอจริงตอนอ่านตะกร้าติดกัน) → รอแล้วลองใหม่
// คำขอที่โดนแบนไม่ถูกทำ จึงส่งซ้ำได้ปลอดภัย (รวมคำสั่งเขียน)
async function lzCall(fn, tries = 4) {
  for (let i = 1; ; i += 1) {
    try { return await fn(); } catch (e) {
      if (i >= tries || !/ApiCallLimit/.test(String(e.message))) throw e;
      await sleep(1500 * i);
    }
  }
}

async function lazadaAuth(shop) {
  const row = (await listShops('lazada')).find((r) => r.shop === shop);
  if (!row) throw new Error(`ไม่พบโทเคนของร้าน Lazada ${shop}`);
  return { accessToken: storedToken(row).access_token };
}

// สถานะราคาพิเศษของแต่ละ SKU ตอนนี้: { price, sp, from, to, active }
function lzSkuState(s) {
  const price = num(s.price);
  const sp = num(s.special_price);
  const from = s.special_from_time || s.special_from_date || null;
  const to = s.special_to_time || s.special_to_date || null;
  const now = Date.now();
  const f = lzTime(from), t = lzTime(to);
  const active = sp !== null && sp > 0 && price !== null && sp < price && !(f && f > now) && !(t && t < now);
  return { price, sp, from, to, active, upcoming: sp !== null && sp > 0 && Boolean(f && f > now) && !(t && t < now) };
}

// ป็อปอัพ: ราคาพิเศษรายตัวเลือกสดจาก Lazada · skus ใช้แสดง (ชื่อ/คลังจาก DB เติมทีหลังในหน้า)
export async function lazadaItemPromo(shop, itemId) {
  const auth = await lazadaAuth(shop);
  const it = await lzCall(() => getProductItem({ ...auth, itemId }));
  if (!it) throw new Error('ไม่พบตะกร้านี้ใน Lazada');
  const skus = {};
  for (const s of it.skus || []) skus[String(s.SkuId)] = lzSkuState(s);
  return { in: [], others: [], options: [], special: { discount_id: LAZADA_SPECIAL, name: LAZADA_SPECIAL_NAME, skus } };
}

// set: [{ model_id: SkuId, price }] ตั้ง/แก้ราคาพิเศษ · remove: [SkuId] ปิดราคาพิเศษ (วันจบ = ตอนนี้)
// ช่วงเวลา: ตัวที่ยังมีช่วงเวลาไม่หมดคงช่วงเดิม · ตัวที่ไม่มี/หมดแล้ว = ตอนนี้ → อีก 1 ปี
// คืน [{ model_id, action: update|add|remove|noop, error }]
export async function lazadaSaveSpecial({ shop, itemId, set = [], remove = [], meta = {} }) {
  const auth = await lazadaAuth(shop);
  const it = await lzCall(() => getProductItem({ ...auth, itemId }));
  if (!it) throw new Error('ไม่พบตะกร้านี้ใน Lazada');
  const st = new Map((it.skus || []).map((s) => [String(s.SkuId), lzSkuState(s)]));
  const now = Date.now();
  const inSet = new Set(set.map((m) => String(m.model_id)));
  for (const x of remove) if (inSet.has(String(x))) throw new ValidationError(`ตัวเลือก ${x} อยู่ทั้งในรายการแก้และรายการเอาออก`);
  for (const k of [...inSet, ...remove.map(String)]) if (!st.has(k)) throw new ValidationError(`ตัวเลือก ${k} ไม่ใช่ของตะกร้านี้`);
  const want = set.map((m) => ({ model_id: String(m.model_id), v: Math.round(Number(m.price) * 100) / 100 }));
  for (const m of want) {
    const o = st.get(m.model_id).price;
    if (o === null) throw new ValidationError(`ตัวเลือก ${m.model_id}: ไม่รู้ราคาปกติ`);
    if (!(m.v > 0 && m.v < o)) throw new ValidationError(`ตัวเลือก ${m.model_id}: ราคาพิเศษ ${m.v} ต้องต่ำกว่าราคาปกติ ${o}`);
    if (m.v < o * (1 - MAX_OFF / 100)) throw new ValidationError(`ตัวเลือก ${m.model_id}: ลดเกิน ${MAX_OFF}%`);
  }
  const keepWindow = (s) => s.sp !== null && lzTime(s.to) > now;   // ช่วงเวลาเดิมยังไม่หมด (กำลังใช้หรือรอเริ่ม)
  const xs = [];
  const results = [];
  const done = (model_id, action, error = null) => results.push({ model_id, action, error });
  for (const m of want) {
    const s = st.get(m.model_id);
    const [from, to] = keepWindow(s) ? [s.from, s.to] : [LZ_FMT(now - 60000), LZ_FMT(now + LZ_YEAR)];
    xs.push({ id: m.model_id, sp: m.v, from, to, action: s.active || keepWindow(s) ? 'update' : 'add' });
  }
  for (const k of remove.map(String)) {
    const s = st.get(k);
    if (!s.active && !s.upcoming) { done(k, 'noop'); continue; }   // ไม่มีราคาพิเศษที่ใช้อยู่/รอเริ่ม — ไม่ได้ยิงอะไร
    // ราคาเดิม + วันเริ่มเดิม (ถ้ายังไม่ถึงวันเริ่มให้เริ่มย้อน 1 วัน วันจบจะได้ไม่ก่อนวันเริ่ม) + วันจบ = ตอนนี้
    const f = lzTime(s.from);
    xs.push({ id: k, sp: s.sp, from: f && f < now - 60000 ? s.from : LZ_FMT(now - 86400000), to: LZ_FMT(now - 60000), action: 'remove' });
  }
  if (xs.length) {
    const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = xs.map((x) => `<Sku><ItemId>${esc(itemId)}</ItemId><SkuId>${esc(x.id)}</SkuId><SalePrice>${x.sp}</SalePrice><SaleStartDate>${esc(x.from)}</SaleStartDate><SaleEndDate>${esc(x.to)}</SaleEndDate></Sku>`).join('');
    const payload = `<?xml version="1.0" encoding="UTF-8" ?><Request><Product><Skus>${body}</Skus></Product></Request>`;
    let err = null;
    try { await lzCall(() => lazadaCallPost('/product/price_quantity/update', { ...auth, body: { payload } })); } catch (e) { err = String(e.message || e); }
    for (const x of xs) done(x.id, x.action, err);
  }
  // ประวัติ (เหมือน Shopee/TikTok) — discount_id = special
  const newV = new Map(want.map((m) => [m.model_id, m.v]));
  const rows = results.filter((r) => r.action !== 'noop').map((r) => {
    const s = st.get(r.model_id);
    return {
      platform: 'lazada', shop, discount_id: LAZADA_SPECIAL, discount_name: LAZADA_SPECIAL_NAME, item_id: String(itemId), model_id: r.model_id,
      action: r.action, old_price: s.active || s.upcoming ? s.sp : null, new_price: r.action === 'remove' ? null : newV.get(r.model_id) ?? null,
      old_limit: null, new_limit: null, ok: !r.error, error: r.error, ip: meta.ip || null, user_agent: meta.ua ? String(meta.ua).slice(0, 300) : null,
    };
  });
  if (rows.length) {
    try {
      const { error } = await db().from('os_discount_log').insert(rows);
      if (error) console.warn('discount log:', error.message);
    } catch (e) { console.warn('discount log:', String(e.message || e)); }
  }
  // ราคาพิเศษในหน้าสินค้า (os_listing_skus) ของตะกร้านี้ — อ่านกลับจาก Lazada แล้วบันทึกทั้งตะกร้า (สถานะตะกร้าใช้ค่าเดิม)
  if (results.some((r) => r.action !== 'noop' && !r.error)) {
    try {
      const after = await lzCall(() => getProductItem({ ...auth, itemId }));
      const { data: l } = await db().from('os_listings').select('status').eq('platform', 'lazada').eq('shop', shop).eq('product_id', String(itemId)).maybeSingle();
      if (after && l) await saveListings([lazadaNormalize(after, shop, l.status)]);
    } catch (e) { console.warn('lazada listing refresh:', String(e.message || e)); }
  }
  return results;
}

// ── เทียบส่วนลดข้ามร้าน (หน้า /discount/compare) ─────────────────────────────
// ดัชนีราคาโปรของทั้งร้าน ราย SKU ร้าน (seller_sku ตัวเล็ก) — อ่านจากโปรที่ "กำลังดำเนินการ" บนแพลตฟอร์มจริง
//   by: { [sku]: { p: ราคาโปรต่ำสุด, n: ราคาปกติ, ids: [discount_id] } } · promos: { [id]: { name, type, end } }
//   truncated: มีโปรที่อ่านไม่ครบ (ใหญ่เกินเพดาน) — SKU ที่ไม่เจออาจอยู่ในโปรจริง
// Shopee: get_discount ทุกโปรที่กำลังดำเนินการ · TikTok: ttActiveIndex (ใช้ร่วมกับหน้าสินค้า) · Lazada / ThisShop: ราคาโปรที่ซิงก์ไว้
// เก็บเฉพาะตัวเลขที่ใช้ (unstable_cache ไม่จำก้อนเกิน 2MB) · จำไว้ 10 นาที · ล้างด้วย tag discounts (บันทึกโปร / ปุ่มดึงใหม่)
const skuKey = (s) => String(s || '').trim().toLowerCase();

// os_listing_skus ทั้งร้าน (ไล่ทีละ 1000 แถว — เพดานของ Supabase)
async function shopSkus(platform, shop, cols, onlyPromo = false) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = db().from('os_listing_skus').select(cols).eq('platform', platform).eq('shop', shop);
    if (onlyPromo) q = q.not('promo_price', 'is', null);
    const { data, error } = await q.order('sku_id').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

function addPromo(by, sellerSku, promo, price, id) {
  const k = skuKey(sellerSku);
  if (!k || promo === null || (price !== null && promo >= price)) return;
  const x = by[k];
  if (!x) { by[k] = { p: promo, n: price, ids: [id] }; return; }
  if (promo < x.p) x.p = promo;
  if (x.n === null) x.n = price;
  if (!x.ids.includes(id)) x.ids.push(id);
}

async function shopeePromoIndex(shop) {
  const auth = await shopeeAuth(shop);
  const [heads, skus] = await Promise.all([
    withRetry(() => listDiscounts({ ...auth, status: 'ongoing', maxPages: 3 })),
    shopSkus('shopee', shop, 'sku_id, seller_sku'),
  ]);
  const skuOf = new Map(skus.map((x) => [String(x.sku_id), x.seller_sku]));
  const by = {};
  const promos = {};
  let truncated = false;
  // ทีละ 4 โปรพร้อมกัน — โปรละ 1 คำขอต่อ 100 ตะกร้า
  for (let i = 0; i < heads.length; i += 4) {
    const got = await Promise.all(heads.slice(i, i + 4).map((h) => withRetry(() => getDiscount({ ...auth, discountId: h.discount_id, maxPages: 30 }))));
    got.forEach((d, j) => {
      const h = heads[i + j];
      const id = String(h.discount_id);
      if (d.truncated) truncated = true;
      promos[id] = { name: h.discount_name || null, type: null, end: h.end_time || null };
      for (const r of discountRows(d)) addPromo(by, skuOf.get(r.sku_id), num(r.promo), num(r.price), id);
    });
  }
  return { by, promos, truncated };
}

async function tiktokPromoIndex(shop) {
  const [idx, skus] = await Promise.all([ttActiveIndex(shop), shopSkus('tiktok', shop, 'product_id, sku_id, seller_sku, price')]);
  const byProduct = new Map();
  for (const r of skus) {
    const k = String(r.product_id);
    if (!byProduct.has(k)) byProduct.set(k, []);
    byProduct.get(k).push(r);
  }
  const by = {};
  const promos = {};
  // คิดราคาโปรแบบเดียวกับ applyTiktokPromoPrices: ราคาตายตัว = activity_price · % ลด = ราคาปกติ × (1 − %)
  for (const a of idx.filter((x) => x.status === 'ongoing')) {
    promos[a.discount_id] = { name: a.discount_name, type: a.type, end: a.end_time || null };
    for (const [pid, p] of Object.entries(a.products)) {
      if (a.level === 'VARIATION' && !p.skus) continue;   // ไม่มีตัวไหนลดแล้ว (ดู ttRows)
      for (const k of byProduct.get(pid) || []) {
        const v = a.level === 'PRODUCT' ? p : p.skus?.[String(k.sku_id)];
        if (!v) continue;
        const price = num(k.price);
        addPromo(by, k.seller_sku, v.a ?? pctPrice(price, v.d), price, a.discount_id);
      }
    }
  }
  return { by, promos, truncated: false };
}

// Lazada ราคาพิเศษ / ThisShop ราคาลด (ราคาขายต่ำกว่าราคาตั้ง) — ไม่มีโปรให้อ่าน ใช้ราคาโปรที่ซิงก์ไว้
async function syncedPromoIndex(platform, shop) {
  const id = platform === 'lazada' ? LAZADA_SPECIAL : 'synced';
  const name = platform === 'lazada' ? LAZADA_SPECIAL_NAME : 'ราคาลด (ตามรอบซิงก์)';
  const by = {};
  for (const k of await shopSkus(platform, shop, 'seller_sku, price, promo_price', true)) addPromo(by, k.seller_sku, num(k.promo_price), num(k.price), id);
  return { by, promos: { [id]: { name, type: null, end: null, synced: true } }, truncated: false };
}

async function rawPromoIndex(platform, shop) {
  const out = platform === 'shopee' ? await shopeePromoIndex(shop)
    : platform === 'tiktok' ? await tiktokPromoIndex(shop) : await syncedPromoIndex(platform, shop);
  return { ...out, at: new Date().toISOString() };
}
const cachedPromoIndex = unstable_cache(rawPromoIndex, ['discount-promo-index'], { revalidate: 600, tags: ['discounts'] });

// คืน null = ร้านนี้ไม่มีโปรให้อ่าน (Thaimart / Shopee MVP ไม่มี API) · error ไม่ถูกจำ — เปิดใหม่ถามซ้ำ
export async function promoIndex(platform, shop) {
  if (platform === 'thisshop') return cachedPromoIndex(platform, shop);
  if (!DISCOUNT_PLATFORMS.includes(platform)) return null;
  const shops = await discountShops[platform]().catch(() => []);
  if (!shops.includes(shop)) return null;
  return cachedPromoIndex(platform, shop);
}

// ── ตัวเลือกตามแพลตฟอร์ม (หน้า /discount ใช้) ─────────────────────────────
export const DISCOUNT_PLATFORMS = ['shopee', 'tiktok', 'lazada'];
export const PLATFORM_LABEL = { shopee: 'Shopee', tiktok: 'TikTok', lazada: 'Lazada' };
export const discountShops = { shopee: shopeeShops, tiktok: tiktokShops, lazada: lazadaShops };

// คืนรายการรูปแบบเดียวกันทุกแพลตฟอร์ม: [{ discount_id, discount_name, start_time, end_time, count? }] (.truncated = อ่านไม่ครบ)
export async function discountList(platform, shop, status, maxPages) {
  if (platform === 'tiktok') return tiktokDiscountList(shop, status, maxPages);
  if (platform === 'lazada') return lazadaDiscountList(shop, status);
  return shopeeDiscountList(shop, status, maxPages);
}

export async function discountDetail(platform, shop, id) {
  if (platform === 'tiktok') return tiktokDiscountDetail(shop, id);
  if (platform === 'lazada') return lazadaSpecialDetail(shop);
  return shopeeDiscountDetail(shop, id);
}
