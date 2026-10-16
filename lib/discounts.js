// โปรส่วนลด — ตัวกลางของหน้า /discount (อ่าน + แก้ราคาโปรของตะกร้าที่ผู้ใช้กดบันทึกเอง)
// ใช้โทเคนใน DB ตรงๆ ไม่ต่ออายุเอง (ดู readOnlyToken ใน lib/tokens.js)
import { unstable_cache } from 'next/cache';
import { listDiscounts, getDiscount, discountRows, addDiscountItems, updateDiscountItems, deleteDiscountItem, getItemPromotion, getItemBaseInfo, getModelList } from './shopee.js';
import { listShops, readOnlyToken } from './tokens.js';
import { db } from './supabase.js';
import { fmtTimeTH } from './fmt.js';

// Shopee ให้เวลาเป็นวินาที (unix) — โชว์ "26 พ.ย. 15:00 2569"
export const fmtSec = (s) => {
  if (!s) return '—';
  const ms = Number(s) * 1000;
  return `${fmtTimeTH(new Date(ms).toISOString())} ${new Date(ms + 7 * 3600000).getUTCFullYear() + 543}`;
};
export const endsSoon = (s) => s && Number(s) * 1000 > Date.now() && Number(s) * 1000 - Date.now() < 3 * 86400000;
// หน้าโปรในหลังร้าน (ต้องล็อกอินร้านนั้นไว้) — ⚠ ยังไม่ได้ยืนยันกับ URL จริง ถ้าเปิดแล้วไม่ตรงให้แก้ที่นี่
export function sellerDiscountUrl(platform, id) {
  const x = encodeURIComponent(String(id));
  if (platform === 'shopee') return `https://seller.shopee.co.th/portal/marketing/discount/${x}`;
  return null;
}
export const STATUS_LABEL = { ongoing: 'กำลังดำเนินการ', upcoming: 'เร็วๆ นี้', expired: 'หมดอายุ' };

export async function shopeeShops() {
  return (await listShops('shopee')).map((r) => r.shop).sort();
}

async function shopeeAuth(shop) {
  const row = (await listShops('shopee')).find((r) => r.shop === shop);
  if (!row) throw new Error(`ไม่พบโทเคนของร้าน Shopee ${shop}`);
  const tok = readOnlyToken(row);
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
// meta: { ip, ua } เก็บลงประวัติ · คืน [{ model_id, action, error }]
export async function shopeeSaveBasket({ shop, discountId, itemId, purchaseLimit, set = [], remove = [], meta = {} }) {
  const auth = await shopeeAuth(shop);
  const [st, orig] = await Promise.all([itemInDiscount(auth, discountId, itemId), itemOriginalPrices(auth, itemId)]);
  if (st.status === 'expired') throw new Error('โปรนี้หมดอายุแล้ว แก้ไม่ได้');

  // ตรวจซ้ำที่เซิร์ฟเวอร์ — ยิง API ตรงๆ ก็ตั้งราคาผิดไม่ได้
  for (const m of set) {
    const o = orig.get(String(m.model_id));
    if (o === undefined) throw new Error(`ตัวเลือก ${m.model_id} ไม่ใช่ของตะกร้านี้`);
    if (!(m.price > 0 && m.price < o)) throw new Error(`ตัวเลือก ${m.model_id}: ราคาโปร ${m.price} ต้องต่ำกว่าราคาปกติ ${o}`);
    if (Math.round((1 - m.price / o) * 100) > MAX_OFF) throw new Error(`ตัวเลือก ${m.model_id}: ลดเกิน ${MAX_OFF}%`);
  }
  for (const x of remove) if (!orig.has(String(x))) throw new Error(`ตัวเลือก ${x} ไม่ใช่ของตะกร้านี้`);

  const limit = purchaseLimit === null || purchaseLimit === undefined ? (st.limit ?? 0) : purchaseLimit;
  const results = [];
  const done = (model_id, action, error = null) => results.push({ model_id: String(model_id), action, error });

  let todo = set.map((m) => ({ model_id: String(m.model_id), price: Number(m.price) }));
  let cur = st.current;
  for (let round = 1; todo.length && round <= 3; round += 1) {
    if (round > 1) {
      // อ่านโปรใหม่ก่อนส่งซ้ำ — ตัวที่เข้าไปแล้วด้วยราคาที่ต้องการ = สำเร็จ (ไม่ add ซ้ำ)
      await sleep(1500 * round);
      cur = (await itemInDiscount(auth, discountId, itemId)).current;
      todo = todo.filter((m) => {
        if (cur.get(m.model_id) === m.price) { done(m.model_id, st.current.has(m.model_id) ? 'update' : 'add'); return false; }
        return true;
      });
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
        continue;
      }
      const failed = new Map(r.errors.map((e) => [String(e.model_id || 0), e]));
      for (const m of list) {
        const f = failed.get(m.model_id);
        if (!f) done(m.model_id, action);
        else if (TRANSIENT.test(String(f.fail_error || f.fail_message)) && round < 3) next.push(m);
        else done(m.model_id, action, f.fail_message || f.fail_error || 'ไม่ทราบสาเหตุ');
      }
    }
    todo = next;
  }

  for (const x of remove.map(String)) {
    if (!st.current.has(x)) { done(x, 'remove'); continue; }   // ไม่อยู่ในโปรอยู่แล้ว
    try {
      const r = await withRetry(() => deleteDiscountItem({ ...auth, discountId, itemId, modelId: x }));
      const f = r.errors[0];
      done(x, 'remove', f && !GONE.test(String(f.fail_error || f.fail_message)) ? (f.fail_message || f.fail_error) : null);
    } catch (e) {
      // ส่งซ้ำหลังลบสำเร็จไปแล้ว → "ไม่อยู่ในโปร" = สำเร็จ
      done(x, 'remove', GONE.test(String(e.message)) ? null : String(e.message || e));
    }
  }

  await writeLog({ shop, discountId, itemId, st, limit, set, results, meta });
  return results;
}

// ประวัติการแก้โปร (supabase/061) — ย้อนดูได้ว่าแก้อะไร เมื่อไร จากเครื่องไหน · บันทึกไม่ได้ไม่ทำให้การแก้ล้ม
// "ใคร" ยังเก็บไม่ได้ (ไม่มีล็อกอิน ใช้ PIN ตัวเดียวทั้งร้าน) — เก็บ IP + เบราว์เซอร์แทน
async function writeLog({ shop, discountId, itemId, st, limit, set, results, meta }) {
  const newPrice = new Map(set.map((m) => [String(m.model_id), Number(m.price)]));
  const rows = results.map((r) => ({
    platform: 'shopee', shop, discount_id: String(discountId), discount_name: st.name, item_id: String(itemId), model_id: r.model_id,
    action: r.action, old_price: st.current.get(r.model_id) ?? null, new_price: r.action === 'remove' ? null : newPrice.get(r.model_id) ?? null,
    old_limit: st.limit, new_limit: r.action === 'remove' ? null : limit, ok: !r.error, error: r.error,
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
