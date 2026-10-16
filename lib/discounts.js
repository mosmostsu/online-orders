// โปรส่วนลด — ตัวกลางของหน้า /discount (อ่าน + แก้ราคาโปรของตะกร้าที่ผู้ใช้กดบันทึกเอง)
// ใช้โทเคนใน DB ตรงๆ ไม่ต่ออายุเอง (ดู storedToken ใน lib/tokens.js)
import { listDiscounts, getDiscount, discountRows, addDiscountItems, updateDiscountItems, deleteDiscountItem, getItemPromotion } from './shopee.js';
import { listShops, storedToken } from './tokens.js';
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
export const STATUS_LABEL = {ongoing: 'กำลังดำเนินการ', upcoming: 'เร็วๆ นี้', expired: 'หมดอายุ' };

export async function shopeeShops() {
  return (await listShops('shopee')).map((r) => r.shop).sort();
}

async function shopeeAuth(shop) {
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

// ตะกร้าเดียวในหน้าสินค้า: อยู่โปรส่วนลดไหน (รายตัวเลือก) + โปรที่ใส่เพิ่มได้ (กำลังดำเนินการ / เร็วๆ นี้)
// in: [{ discount_id, name, start_time, end_time, staging, models: { [model_id]: promoPrice } }]
// others: โปรประเภทอื่น (Flash Sale ฯลฯ) โชว์เฉยๆ · options: [{ discount_id, name, start_time, end_time, status }]
export async function shopeeItemPromo(shop, itemId) {
  const auth = await shopeeAuth(shop);
  const [promos, ongoing, upcoming] = await Promise.all([
    getItemPromotion({ ...auth, itemIds: [itemId] }).then((m) => m.get(String(itemId)) || []),
    listDiscounts({ ...auth, status: 'ongoing', maxPages: 3 }),
    listDiscounts({ ...auth, status: 'upcoming', maxPages: 3 }),
  ]);
  const options = [...ongoing, ...upcoming].map((d) => ({ discount_id: String(d.discount_id), name: d.discount_name, start_time: d.start_time, end_time: d.end_time, status: d.status }));
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
  // จำกัดการซื้อ — get_item_promotion ไม่ส่งมา ต้องอ่านจากโปร ไม่งั้นตอนบันทึกจะส่ง 0 ไปทับค่าเดิม
  await Promise.all([...byId.values()].map(async (x) => {
    const d = await getDiscount({ ...auth, discountId: x.discount_id, maxPages: 10 });
    const it = (d.item_list || []).find((i) => String(i.item_id) === String(itemId));
    x.limit = it ? Number(it.purchase_limit || 0) : null;
    if (!x.name) x.name = d.discount_name || null;
  }));
  return { in: [...byId.values()], others, options };
}

// ── แก้โปรของตะกร้าเดียว (ปุ่มบันทึกในหน้าโปร / หน้าสินค้า) ──────────────
// set: ตัวเลือกที่จะให้อยู่ในโปร [{ model_id, price }] (model_id 0 = ตะกร้าไม่มีตัวเลือก)
//   ตัวที่อยู่ในโปรแล้ว → update · ยังไม่อยู่ → add
// remove: model_id ที่จะเอาออกจากโปร
// คืนผลรายตัวเลือก { model_id, action, error } — Shopee ตอบสำเร็จทั้งคำขอแม้บางตัวพัง (error_list)
// ทดสอบกับตะกร้า [TEST] แล้ว (2026-10-16): บางตัวได้ error_server แบบสุ่ม → ส่งเฉพาะตัวที่พังซ้ำอีก 2 รอบ
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = /not_found|error_server|error_busy|Something wrong/i;

async function withRetry(fn, tries = 3) {
  for (let i = 1; ; i += 1) {
    try { return await fn(); } catch (e) {
      if (i >= tries || !TRANSIENT.test(String(e.message))) throw e;
      await sleep(1500 * i);
    }
  }
}

// purchaseLimit: undefined = ไม่รู้ค่า → อ่านค่าเดิมจากโปรก่อน แล้วส่งค่านั้น
//   (Shopee ไม่มี "คงค่าเดิม" — ไม่ส่งเท่ากับตั้งเป็น 0 ทับ ทดสอบแล้ว) · ตะกร้าที่ยังไม่อยู่ในโปร = 0
export async function shopeeSaveBasket({ shop, discountId, itemId, purchaseLimit, set = [], remove = [], inPromo = [] }) {
  const auth = await shopeeAuth(shop);
  if (purchaseLimit === undefined && set.length) {
    const d = await withRetry(() => getDiscount({ ...auth, discountId, maxPages: 10 }));
    const it = (d.item_list || []).find((i) => String(i.item_id) === String(itemId));
    purchaseLimit = it ? Number(it.purchase_limit || 0) : 0;
  }
  const results = [];
  const have = new Set(inPromo.map(String));
  const groups = { update: set.filter((m) => have.has(String(m.model_id))), add: set.filter((m) => !have.has(String(m.model_id))) };

  for (const [action, models] of Object.entries(groups)) {
    let todo = models;
    for (let round = 1; todo.length && round <= 3; round += 1) {
      const fn = action === 'add' ? addDiscountItems : updateDiscountItems;
      const r = await withRetry(() => fn({ ...auth, discountId, items: [{ item_id: itemId, purchase_limit: purchaseLimit, models: todo }] }));
      const failed = new Map(r.errors.map((e) => [String(e.model_id || 0), e.fail_message || e.fail_error || 'ไม่ทราบสาเหตุ']));
      const failedErr = new Map(r.errors.map((e) => [String(e.model_id || 0), e.fail_error || '']));
      const retry = [];
      for (const m of todo) {
        const k = String(m.model_id);
        if (!failed.has(k)) results.push({ model_id: k, action, error: null });
        else if (TRANSIENT.test(failedErr.get(k)) && round < 3) retry.push(m);
        else results.push({ model_id: k, action, error: failed.get(k) });
      }
      todo = retry;
      if (todo.length) await sleep(1500 * round);
    }
  }

  for (const modelId of remove) {
    try {
      const r = await withRetry(() => deleteDiscountItem({ ...auth, discountId, itemId, modelId }));
      results.push({ model_id: String(modelId), action: 'remove', error: r.errors[0]?.fail_message || null });
    } catch (e) {
      results.push({ model_id: String(modelId), action: 'remove', error: String(e.message || e) });
    }
  }
  return results;
}
