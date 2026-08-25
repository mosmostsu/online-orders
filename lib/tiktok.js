// TikTok Shop Open API (เวอร์ชัน 202309) — เซ็นคำขอ + ดึงออเดอร์ + ต่ออายุโทเคน
// เซ็นยังไง: HMAC-SHA256 คีย์ = app_secret, ข้อความ =
//   app_secret + path + (คู่ key/value ของ query เรียงตามตัวอักษร ตัด sign กับ access_token ออก) + body + app_secret
// ผลลัพธ์เป็น hex ตัวพิมพ์เล็ก ใส่กลับไปใน query ชื่อ sign
import crypto from 'crypto';

const API_BASE  = process.env.TIKTOK_API_BASE  || 'https://open-api.tiktokglobalshop.com';
const AUTH_BASE = process.env.TIKTOK_AUTH_BASE || 'https://auth.tiktok-shops.com';

export function sign(path, query, bodyString, appSecret) {
  const keys = Object.keys(query).filter((k) => k !== 'sign' && k !== 'access_token').sort();
  let base = path;
  for (const k of keys) base += k + query[k];
  if (bodyString) base += bodyString;
  base = appSecret + base + appSecret;
  return crypto.createHmac('sha256', appSecret).update(base).digest('hex');
}

// ยิง request หนึ่งครั้ง — คืน data ข้างใน หรือโยน error พร้อมข้อความจาก TikTok
export async function call(path, { method = 'GET', query = {}, body = null, accessToken, shopCipher } = {}) {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  if (!appKey || !appSecret) throw new Error('ยังไม่ได้ตั้ง TIKTOK_APP_KEY / TIKTOK_APP_SECRET');

  const q = {
    ...query,
    app_key: appKey,
    timestamp: Math.floor(Date.now() / 1000),
  };
  if (shopCipher) q.shop_cipher = shopCipher;

  const bodyString = body ? JSON.stringify(body) : '';
  q.sign = sign(path, q, bodyString, appSecret);

  const url = API_BASE + path + '?' + new URLSearchParams(q).toString();
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-tts-access-token': accessToken || '',
    },
    body: bodyString || undefined,
  });

  const json = await res.json().catch(() => ({}));
  // TikTok ตอบ HTTP 200 แม้ผิดพลาด — ต้องดู code ข้างในเสมอ
  if (!res.ok || json.code !== 0) {
    const err = new Error(`TikTok ${path} ล้มเหลว: code=${json.code} ${json.message || res.status}`);
    err.payload = json;
    throw err;
  }
  return json.data || {};
}

// ── ออเดอร์ ───────────────────────────────────────────────────────────
// TikTok แยกเป็น 2 ขั้น: search ได้มาแค่ id → ต้องยิง orders?ids= ตามเพื่อเอา line_items
// (ยืนยันจากสคริปต์ Colab ที่ร้านใช้อยู่จริง — search ไม่คืนรายการสินค้ามาให้)
export async function searchOrderIds({ accessToken, shopCipher, since, until, orderStatus, pageSize = 50, maxPages = 200 }) {
  const ids = [];
  let pageToken = '';
  for (let i = 0; i < maxPages; i++) {
    const query = { page_size: String(pageSize), sort_field: 'create_time', sort_order: 'DESC' };
    if (pageToken) query.page_token = pageToken;

    const body = {};
    if (orderStatus) body.order_status = orderStatus;
    if (since) body.update_time_ge = Math.floor(since / 1000);
    if (until) body.update_time_lt = Math.floor(until / 1000);

    const data = await call('/order/202309/orders/search', {
      method: 'POST', query, body, accessToken, shopCipher,
    });

    for (const o of data.orders || []) {
      const id = o.order_id || o.id;
      if (id) ids.push(String(id));
    }
    pageToken = data.next_page_token || '';
    if (!pageToken) break;
  }
  return ids;
}

// ดึงรายละเอียดทีละ 50 id (ขีดจำกัดของ endpoint)
export async function getOrderDetails({ accessToken, shopCipher, ids }) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await call('/order/202507/orders', {
      query: { ids: batch.join(',') }, accessToken, shopCipher,
    });
    out.push(...(data.orders || []));
  }
  return out;
}

export async function fetchOrders({ accessToken, shopCipher, since, until, orderStatus }) {
  const ids = await searchOrderIds({ accessToken, shopCipher, since, until, orderStatus });
  if (!ids.length) return [];
  return getOrderDetails({ accessToken, shopCipher, ids });
}

// ── โทเคน ─────────────────────────────────────────────────────────────
// แลก code จากหน้าอนุญาต → access_token (ครั้งแรกครั้งเดียวต่อร้าน)
export async function exchangeCode(code) {
  const url = `${AUTH_BASE}/api/v2/token/get?app_key=${process.env.TIKTOK_APP_KEY}` +
    `&app_secret=${process.env.TIKTOK_APP_SECRET}&auth_code=${encodeURIComponent(code)}&grant_type=authorized_code`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== 0) throw new Error('แลกโทเคนไม่สำเร็จ: ' + (json.message || JSON.stringify(json)));
  return json.data;
}

// ต่ออายุก่อนหมด (access_token อยู่ได้ ~7 วัน, refresh_token ~1 ปี)
export async function refreshToken(refresh) {
  const url = `${AUTH_BASE}/api/v2/token/refresh?app_key=${process.env.TIKTOK_APP_KEY}` +
    `&app_secret=${process.env.TIKTOK_APP_SECRET}&refresh_token=${encodeURIComponent(refresh)}&grant_type=refresh_token`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== 0) throw new Error('ต่ออายุโทเคนไม่สำเร็จ: ' + (json.message || JSON.stringify(json)));
  return json.data;
}

// รายชื่อร้านที่โทเคนนี้เข้าถึงได้ — เอา cipher มาใช้ต่อ (ต้องมีทุก request)
export async function getAuthorizedShops(accessToken) {
  const data = await call('/authorization/202309/shops', { query: { version: '202309' }, accessToken });
  return data.shops || [];
}

// ── แปลงก้อนดิบของ TikTok → รูปแบบกลางที่ตารางเราใช้ ──────────────────
// หมายเหตุ: TikTok แตก line_items เป็น "รายชิ้น" (1 บรรทัด = 1 ชิ้น) ต้องยุบรวมเองถึงจะได้จำนวน
import { toStatus } from './status.js';

export function normalizeOrder(o, shop) {
  const lines = new Map();
  for (const li of o.line_items || []) {
    const sku = li.seller_sku || '';
    const key = (li.sku_id || '') + '|' + sku;
    if (!lines.has(key)) {
      lines.set(key, {
        line_id: key,
        sku,
        platform_sku_id: li.sku_id || null,
        product_name: li.product_name || null,
        qty: 0,
        price: Number(li.sale_price || 0),
        raw: li,
      });
    }
    lines.get(key).qty += 1;
  }
  const items = [...lines.values()];

  return {
    order: {
      platform: 'tiktok',
      shop,
      order_id: String(o.id || o.order_id),
      status: toStatus('tiktok', o.status),
      raw_status: o.status || null,
      buyer: o.recipient_address?.name || o.buyer_email || null,
      total: Number(o.payment?.total_amount || 0),
      currency: o.payment?.currency || null,
      item_count: items.reduce((s, i) => s + i.qty, 0),
      ordered_at: o.create_time ? new Date(o.create_time * 1000).toISOString() : null,
      platform_updated_at: o.update_time ? new Date(o.update_time * 1000).toISOString() : null,
      cancelled_at: o.status === 'CANCELLED' && o.update_time ? new Date(o.update_time * 1000).toISOString() : null,
      raw: o,
      synced_at: new Date().toISOString(),
    },
    items,
  };
}
