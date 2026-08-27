// Shopee Open Platform API v2 — เซ็นคำขอ + ดึงออเดอร์ + ต่ออายุโทเคน
// เซ็นยังไง: HMAC-SHA256 คีย์ = partner_key, ข้อความ = partner_id + path + timestamp + access_token + shop_id
// (ตอนขอโทเคนใหม่จะไม่มี access_token กับ shop_id ในข้อความ)
// ยืนยันจากสคริปต์ Colab ที่ร้านใช้อยู่จริง
import crypto from 'crypto';

const BASE = process.env.SHOPEE_API_BASE || 'https://partner.shopeemobile.com';

function sign(path, ts, accessToken = '', shopId = '') {
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const key = process.env.SHOPEE_PARTNER_KEY;
  if (!partnerId || !key) throw new Error('ยังไม่ได้ตั้ง SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY');
  const base = `${partnerId}${path}${ts}${accessToken}${shopId}`;
  return crypto.createHmac('sha256', key).update(base).digest('hex');
}

// เรียก API ของร้าน (ต้องมีโทเคนกับ shop_id เสมอ)
export async function call(path, { params = {}, accessToken, shopId, method = 'GET', body = null } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const q = new URLSearchParams({
    partner_id: process.env.SHOPEE_PARTNER_ID,
    timestamp: String(ts),
    access_token: accessToken,
    shop_id: String(shopId),
    sign: sign(path, ts, accessToken, String(shopId)),
    ...params,
  });

  const res = await fetch(`${BASE}${path}?${q}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  // Shopee ตอบ 200 พร้อม error ข้างในเสมอ ต้องเช็คฟิลด์ error
  if (json.error) {
    const err = new Error(`Shopee ${path} ล้มเหลว: ${json.error} ${json.message || ''}`);
    err.payload = json;
    throw err;
  }
  return json.response || {};
}

// ── ออเดอร์ ───────────────────────────────────────────────────────────
// เหมือน TikTok คือ 2 ขั้น: list ได้แค่เลขออเดอร์ → ต้องดึงรายละเอียดตามทีละไม่เกิน 50
const ALL_STATUS = ['UNPAID', 'READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'COMPLETED', 'IN_CANCEL', 'CANCELLED', 'TO_RETURN'];

export async function listOrderSns({ accessToken, shopId, since, until, statuses = ALL_STATUS, timeField = 'update_time' }) {
  const out = new Set();
  for (const status of statuses) {
    let cursor = '';
    for (let i = 0; i < 60; i++) {
      const data = await call('/api/v2/order/get_order_list', {
        accessToken, shopId,
        params: {
          time_range_field: timeField,
          time_from: String(Math.floor(since / 1000)),
          time_to: String(Math.floor((until || Date.now()) / 1000)),
          page_size: '100',
          order_status: status,
          response_optional_fields: 'order_status',
          ...(cursor ? { cursor } : {}),
        },
      });
      for (const o of data.order_list || []) out.add(o.order_sn);
      cursor = data.next_cursor || '';
      if (!data.more) break;
    }
  }
  return [...out];
}

// ต้องขอฟิลด์พวกนี้มาเอง ไม่งั้น Shopee ไม่ส่งมาให้
// pickup_done_time คือเวลาที่ขนส่งมารับของจริง — ตัวชี้ขาดว่าของยังอยู่ที่ร้านหรือออกไปแล้ว
const FIELDS = [
  'item_list', 'package_list', 'pay_time', 'pickup_done_time', 'ship_by_date',
  'total_amount', 'order_status', 'recipient_address', 'buyer_username',
  'cancel_by', 'cancel_reason', 'buyer_cancel_reason', 'update_time', 'create_time',
  'shipping_carrier', 'actual_shipping_fee',
].join(',');

export async function getOrderDetails({ accessToken, shopId, orderSns }) {
  const out = [];
  for (let i = 0; i < orderSns.length; i += 50) {
    const data = await call('/api/v2/order/get_order_detail', {
      accessToken, shopId,
      params: { order_sn_list: orderSns.slice(i, i + 50).join(','), response_optional_fields: FIELDS },
    });
    out.push(...(data.order_list || []));
  }
  return out;
}

export async function fetchOrders({ accessToken, shopId, since, until }) {
  const sns = await listOrderSns({ accessToken, shopId, since, until });
  if (!sns.length) return [];
  return getOrderDetails({ accessToken, shopId, orderSns: sns });
}

// ── โทเคน ─────────────────────────────────────────────────────────────
// access_token อยู่ได้ 4 ชั่วโมงเท่านั้น (สั้นกว่า TikTok มาก) · refresh_token 30 วัน
export async function refreshToken({ refreshToken: rt, shopId }) {
  const ts = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/access_token/get';
  const q = new URLSearchParams({
    partner_id: process.env.SHOPEE_PARTNER_ID,
    timestamp: String(ts),
    sign: sign(path, ts),   // ขั้นนี้ยังไม่มีโทเคน จึงเซ็นด้วย partner_id + path + ts เท่านั้น
  });
  const res = await fetch(`${BASE}${path}?${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      refresh_token: rt,
      partner_id: Number(process.env.SHOPEE_PARTNER_ID),
      shop_id: Number(shopId),
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`ต่ออายุโทเคน Shopee ไม่สำเร็จ: ${json.error} ${json.message || ''}`);
  return json;   // { access_token, refresh_token, expire_in }
}

// แลก code จากหน้าอนุญาต → โทเคนชุดแรกของร้าน
export async function exchangeCode({ code, shopId }) {
  const ts = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/token/get';
  const q = new URLSearchParams({
    partner_id: process.env.SHOPEE_PARTNER_ID,
    timestamp: String(ts),
    sign: sign(path, ts),
  });
  const res = await fetch(`${BASE}${path}?${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, partner_id: Number(process.env.SHOPEE_PARTNER_ID), shop_id: Number(shopId) }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`แลกโทเคน Shopee ไม่สำเร็จ: ${json.error} ${json.message || ''}`);
  return json;
}

// ลิงก์ให้เจ้าของร้านกดอนุญาต
export function authorizeUrl(redirectUrl) {
  const ts = Math.floor(Date.now() / 1000);
  const path = '/api/v2/shop/auth_partner';
  const q = new URLSearchParams({
    partner_id: process.env.SHOPEE_PARTNER_ID,
    timestamp: String(ts),
    sign: sign(path, ts),
    redirect: redirectUrl,
  });
  return `${BASE}${path}?${q}`;
}

// ── แปลงก้อนดิบของ Shopee → รูปแบบกลางที่ตารางเราใช้ ──────────────────
import { toStatus } from './status.js';

const ts2iso = (t) => (t ? new Date(t * 1000).toISOString() : null);

// เวลาขนส่งมารับ Shopee ให้มาตรงๆ ที่ pickup_done_time
// ส่วน "เวลากดจัดส่ง" ไม่มีฟิลด์เดียวๆ ให้ ต้องดูจากสถานะพัสดุว่าจองรถแล้วหรือยัง
const PICKED_UP = ['LOGISTICS_PICKUP_DONE', 'LOGISTICS_DELIVERY_DONE', 'LOGISTICS_DELIVERY_FAILED', 'LOGISTICS_LOST'];
const READY_TO_PICK = ['LOGISTICS_READY', 'LOGISTICS_REQUEST_CREATED', 'LOGISTICS_PICKUP_RETRY', 'LOGISTICS_PICKUP_FAILED'];

export function normalizeOrder(o, shop) {
  const lines = new Map();
  for (const it of o.item_list || []) {
    const sku = it.model_sku || it.item_sku || '';
    const key = `${it.item_id || ''}|${it.model_id || ''}`;
    if (!lines.has(key)) {
      lines.set(key, {
        line_id: key,
        sku,
        platform_sku_id: it.model_id ? String(it.model_id) : null,
        product_name: it.item_name || null,
        variant: it.model_name || null,
        image_url: it.image_info?.image_url || null,
        qty: 0,
        price: Number(it.model_discounted_price ?? it.model_original_price ?? 0),
        raw: it,
      });
    }
    // ต่างจาก TikTok — Shopee บอกจำนวนมาในบรรทัดเดียว ไม่ต้องยุบเอง
    lines.get(key).qty += Number(it.model_quantity_purchased || 1);
  }
  const items = [...lines.values()];

  const pkgs = o.package_list || [];
  const logi = pkgs.map((p) => p.logistics_status).filter(Boolean);
  const pickedUp = logi.some((s) => PICKED_UP.includes(s));
  const readyToPick = logi.some((s) => READY_TO_PICK.includes(s));
  const updated = ts2iso(o.update_time);
  const collected = ts2iso(o.pickup_done_time) || (pickedUp ? updated : null);

  const status = toStatus('shopee', o.order_status);
  return {
    order: {
      platform: 'shopee',
      shop,
      order_id: o.order_sn,
      status,
      raw_status: o.order_status || null,
      buyer: o.recipient_address?.name || o.buyer_username || null,
      total: Number(o.total_amount || 0),
      currency: o.currency || 'THB',
      item_count: items.reduce((s, i) => s + i.qty, 0),
      ordered_at: ts2iso(o.create_time),
      platform_updated_at: updated,
      paid_at: ts2iso(o.pay_time),
      // กดจัดส่งแล้ว = จองรถหรือถูกรับไปแล้ว (ไม่มีเวลาเป๊ะ ใช้เวลาที่ออเดอร์ขยับล่าสุดแทน)
      rts_at: readyToPick || collected ? updated : null,
      collected_at: collected,   // เวลาจริงจาก Shopee ถ้ามี
      cancelled_at: status === 'cancelled' ? updated : null,
      cancel_reason: o.cancel_reason || null,
      cancel_by: o.cancel_by || null,
      tracking_no: pkgs.map((p) => p.package_number).filter(Boolean).join(', ') || null,
      carrier: pkgs.map((p) => p.shipping_carrier).filter(Boolean)[0] || null,
      raw: o,
      synced_at: new Date().toISOString(),
    },
    items,
  };
}
