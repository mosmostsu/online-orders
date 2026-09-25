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
import { isExpressShipping } from './shipping.js';

const ts = (t) => (t ? new Date(t * 1000).toISOString() : null);

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
        variant: li.sku_name || null,
        image_url: li.sku_image || null,
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
      ordered_at: ts(o.create_time),
      platform_updated_at: ts(o.update_time),
      paid_at: ts(o.paid_time),
      rts_at: ts(o.rts_time),                 // ร้านกดจัดส่งเมื่อไหร่
      collected_at: ts(o.collection_time),    // ขนส่งมารับของจริงเมื่อไหร่
      cancelled_at: ts(o.cancel_time),
      // shipping_due_time = เส้นตายที่ต้องส่งของ (คู่กับ ship_by_date ของ Shopee)
      ship_by: ts(o.shipping_due_time || o.rts_sla_time),
      is_cod: o.is_cod ?? null,
      cancel_reason: o.cancel_reason || null,
      cancel_by: o.cancellation_initiator || null,
      tracking_no: o.tracking_number || null,
      carrier: o.shipping_provider || o.delivery_option_name || null,
      is_express: isExpressShipping(o.shipping_provider, o.delivery_option_name),
      raw: o,
      synced_at: new Date().toISOString(),
    },
    items,
  };
}

// ── เงินที่ได้รับจริง (Finance API) ────────────────────────────────────
//
// TikTok ปิดยอดเป็น "ใบสรุปรายวัน" (statement) วันละใบ แล้วโอนเงินทั้งก้อนตามใบนั้น
// ข้างในใบมีรายการทีละออเดอร์ ดึงได้ครั้งละ 100 รายการ
//
// ทำไมไม่ถามทีละออเดอร์: ร้านนี้ออก ~500 ใบต่อใบสรุป ถ้ายิงทีละใบต้อง 500 ครั้ง
// ซึ่ง Netlify ให้เวลาแค่ ~26 วินาทีต่อรอบ ได้แค่ ~40 ใบ ไม่มีวันไล่ทัน
// ดึงตามใบสรุปใช้แค่ 5 ครั้งต่อวัน
//
// ใช้ statement_transactions เวอร์ชัน 202501 ไม่ใช่ 202309
// เพราะ 202309 แจกแจงค่าธรรมเนียมไม่ครบ (ใบตัวอย่างโดนหัก 86.62 แต่บอกที่มาได้แค่ 48)
// 202501 แยกครบถึงสตางค์ — ตรวจกับข้อมูลจริง 100 ใบ ตรงทุกใบ

// รายการใบสรุปในช่วงเวลา (ตัวนี้ 202309 ยังใช้ได้ดี ให้ยอดรวมครบ)
export async function listStatements({ accessToken, shopCipher, since, until, pageSize = 50 }) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < 10; i++) {
    const query = {
      statement_time_ge: String(Math.floor(since / 1000)),
      statement_time_lt: String(Math.floor(until / 1000)),
      page_size: String(pageSize),
      sort_field: 'statement_time',
      sort_order: 'ASC',
    };
    if (pageToken) query.page_token = pageToken;
    const data = await call('/finance/202309/statements', { query, accessToken, shopCipher });
    out.push(...(data.statements || []));
    pageToken = data.next_page_token || '';
    if (!pageToken) break;
  }
  return out;
}

// รายการออเดอร์ในใบสรุป ทีละหน้า — คืน next_page_token ไว้ให้รอบหน้าทำต่อจากตรงนี้ได้
export async function getStatementPage({ accessToken, shopCipher, statementId, pageToken = '' }) {
  const query = { page_size: '100', sort_field: 'order_create_time', sort_order: 'ASC' };
  if (pageToken) query.page_token = pageToken;
  return call(`/finance/202501/statements/${encodeURIComponent(statementId)}/statement_transactions`, {
    query, accessToken, shopCipher,
  });
}

const num = (v) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || Number.isNaN(n) ? 0 : n;
};

export function normalizeStatement(s, shop) {
  return {
    platform: 'tiktok',
    shop,
    statement_id: String(s.id),
    statement_at: ts(s.statement_time),
    currency: s.currency || null,
    revenue: num(s.revenue_amount),
    fee: num(s.fee_amount),                 // รวมค่าส่งที่ร้านออกแล้ว
    adjustment: num(s.adjustment_amount),
    settlement: num(s.settlement_amount),
    payment_status: s.payment_status || null,
    payment_at: ts(s.payment_time),
    synced_at: new Date().toISOString(),
  };
}

// เก็บเฉพาะรายการย่อยที่ไม่เป็นศูนย์ — ก้อนดิบมี ~150 ช่องต่อใบ ส่วนใหญ่เป็นศูนย์
// ถ้าเก็บทั้งก้อน วันละ 500 ใบจะกินพื้นที่ฐานข้อมูลฟรีหมดในไม่กี่เดือน
//
// ตัด supplementary_component ทิ้ง เพราะเป็นตัวเลขซ้ำกับรายการหลัก
// (เช่นส่วนลดค่าส่งโผล่ทั้งสองที่) ถ้าเก็บทั้งคู่ หน้าเว็บจะรวมซ้ำเป็นสองเท่า
// affiliate_commission_amount_before_pit ก็ซ้ำกับ affiliate_commission_amount เหมือนกัน
const SKIP = new Set(['supplementary_component', 'affiliate_commission_amount_before_pit']);

function nonzeroLeaves(obj, prefix, out) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (SKIP.has(k)) continue;
    if (v && typeof v === 'object') nonzeroLeaves(v, prefix + k + '.', out);
    else if (num(v) !== 0) out[prefix + k] = num(v);
  }
  return out;
}

// หนึ่งรายการในใบสรุป → หนึ่งแถวใน os_money_tx
// เครื่องหมายเก็บตามที่ TikTok ส่งมา: เงินเข้า = บวก, ถูกหัก = ลบ
// สมการที่ต้องจริงเสมอ: revenue + fee + shipping + adjustment = settlement
export function normalizeMoneyTx(t, { shop, statementId, statementAt }) {
  const rev = t.revenue_breakdown || {};
  return {
    platform: 'tiktok',
    shop,
    tx_id: String(t.id),
    statement_id: String(statementId),
    statement_at: statementAt,
    type: t.type || null,
    order_id: t.order_id ? String(t.order_id) : null,
    order_created_at: ts(t.order_create_time),
    gross: num(rev.subtotal_before_discount_amount) + num(rev.refund_subtotal_before_discount_amount),
    seller_discount: num(rev.seller_discount_amount) + num(rev.seller_discount_refund_amount),
    customer_paid: num(t.supplementary_component?.customer_payment_amount)
      + num(t.supplementary_component?.customer_refund_amount),
    revenue: num(t.revenue_amount),
    fee: num(t.fee_tax_amount),
    shipping: num(t.shipping_cost_amount),
    adjustment: num(t.adjustment_amount),
    settlement: num(t.settlement_amount),
    breakdown: {
      ...nonzeroLeaves(t.revenue_breakdown, 'rev.', {}),
      ...nonzeroLeaves(t.fee_tax_breakdown, '', {}),       // ได้ fee.xxx / tax.xxx
      ...nonzeroLeaves(t.shipping_cost_breakdown, 'ship.', {}),
    },
  };
}

// ── ข้อมูลตะกร้า (Product API) ────────────────────────────────────────
// ใช้เอารูปปกกับชื่อสินค้ามาแสดงในหน้ารายสินค้า — ข้อมูลออเดอร์มีแค่รูปของตัวเลือกสี/ไซส์
export async function getProduct({ accessToken, shopCipher, productId }) {
  return call(`/product/202309/products/${encodeURIComponent(productId)}`, { accessToken, shopCipher });
}

export function normalizeProduct(p) {
  const img = (p.main_images || [])[0] || {};
  return {
    platform: 'tiktok',
    product_id: String(p.id),
    title: p.title || null,
    cover_url: (img.urls || [])[0] || null,
    thumb_url: (img.thumb_urls || [])[0] || (img.urls || [])[0] || null,
    status: p.status || null,
    synced_at: new Date().toISOString(),
  };
}

// ── รายการสินค้าทั้งร้าน (หน้า /product) ─────────────────────────────────
// search ให้ id + เวลาแก้ไข ครั้งละ 100 — รายละเอียดเต็ม (รูป ชื่อตัวเลือก) ต้องถาม getProduct ทีละตะกร้า
export async function searchProductIds({ accessToken, shopCipher, maxPages = 100 }) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < maxPages; i++) {
    const query = { page_size: 100 };
    if (pageToken) query.page_token = pageToken;
    const data = await call('/product/202309/products/search', {
      method: 'POST', query, body: {}, accessToken, shopCipher,
    });
    out.push(...(data.products || []));
    pageToken = data.next_page_token || '';
    if (!pageToken) break;
  }
  // ตะกร้าที่ลบแล้วไม่ต้องโชว์
  return out.filter((p) => p.status !== 'DELETED');
}

// p = ก้อนจาก getProduct — TikTok ไม่มีราคาโปรใน Product API (โปรอยู่อีกระบบ) จึงไม่มีราคาพิเศษ
export function normalizeListing(p, shop) {
  const key = { platform: 'tiktok', shop, product_id: String(p.id) };
  const img = (p.main_images || [])[0] || {};
  const skus = (p.skus || []).map((s, i) => {
    const attrs = s.sales_attributes || [];
    const price = s.price?.sale_price ?? s.price?.tax_exclusive_price ?? null;
    return {
      ...key,
      sku_id: String(s.id),
      seller_sku: s.seller_sku || null,
      variant: attrs.map((a) => a.value_name).filter(Boolean).join(' / ') || null,
      price: price === null ? null : Number(price),
      promo_price: null,
      stock: (s.inventory || []).reduce((n, w) => n + (Number(w.quantity) || 0), 0),
      image_url: attrs.find((a) => a.sku_img)?.sku_img?.urls?.[0] || null,
      sort: i,
    };
  });
  return {
    listing: {
      ...key,
      title: p.title || null,
      thumb_url: (img.thumb_urls || [])[0] || (img.urls || [])[0] || null,
      status: p.status || null,
      item_sku: null,
      remote_updated_at: p.update_time ? new Date(p.update_time * 1000).toISOString() : null,
      remote_created_at: p.create_time ? new Date(p.create_time * 1000).toISOString() : null,
    },
    skus,
  };
}
