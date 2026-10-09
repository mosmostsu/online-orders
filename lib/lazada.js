// Lazada Open Platform — เซ็นคำขอ + ดึงออเดอร์ + ต่ออายุโทเคน
// เซ็นยังไง: HMAC-SHA256 คีย์ = app_secret, ข้อความ = api path + (ชื่อพารามิเตอร์+ค่า เรียงตามชื่อ A-Z ต่อกัน) → hex ตัวพิมพ์ใหญ่
// ตอนขอ/ต่อโทเคนใช้ host auth.lazada.com · งานอื่นใช้ host ตามประเทศของร้าน (ไทย = api.lazada.co.th)
import crypto from 'crypto';
import { toStatus } from './status.js';
import { isExpressShipping } from './shipping.js';

const AUTH_HOST = 'https://auth.lazada.com';
const API_HOST = process.env.LAZADA_API_BASE || 'https://api.lazada.co.th';

function creds() {
  const key = process.env.LAZADA_APP_KEY;
  const secret = process.env.LAZADA_APP_SECRET;
  if (!key || !secret) throw new Error('ยังไม่ได้ตั้ง LAZADA_APP_KEY / LAZADA_APP_SECRET');
  return { key, secret };
}

function sign(path, params, secret) {
  const base = path + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha256', secret).update(base).digest('hex').toUpperCase();
}

// accessToken ว่าง = เรียกฝั่งขอโทเคน (ไม่ต้องใส่ access_token ในคำขอ)
export async function call(path, { host = API_HOST, params = {}, accessToken = '', method = 'GET' } = {}) {
  const { key, secret } = creds();
  const all = {
    app_key: key,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    ...(accessToken ? { access_token: accessToken } : {}),
    ...params,
  };
  all.sign = sign(path, all, secret);
  const q = new URLSearchParams(all);
  const res = await fetch(`${host}/rest${path}?${q}`, { method });
  const json = await res.json().catch(() => ({}));
  // Lazada ตอบ code "0" เมื่อสำเร็จ · อย่างอื่นคือ error (เช่น IllegalAccessToken, ApiCallLimit)
  if (json.code && json.code !== '0') {
    const err = new Error(`Lazada ${path} ล้มเหลว: ${json.code} ${json.message || ''}`);
    err.payload = json;
    throw err;
  }
  return json;
}

// ── โทเคน ─────────────────────────────────────────────────────────────
// access_token อยู่ราว 30 วัน · refresh_token ราว 180 วัน (ต่ออายุแล้วได้ refresh_token ใหม่ด้วย)
export function authorizeUrl(redirectUrl, state = '') {
  const { key } = creds();
  const q = new URLSearchParams({
    response_type: 'code',
    force_auth: 'true',
    redirect_uri: redirectUrl,
    client_id: key,
    ...(state ? { state } : {}),
  });
  return `${AUTH_HOST}/oauth/authorize?${q}`;
}

export async function exchangeCode(code) {
  return call('/auth/token/create', { host: AUTH_HOST, params: { code } });
}

export async function refreshToken(rt) {
  return call('/auth/token/refresh', { host: AUTH_HOST, params: { refresh_token: rt } });
}

// ── ออเดอร์ ───────────────────────────────────────────────────────────
// 2 ขั้นเหมือน TikTok/Shopee: /orders/get ได้หัวออเดอร์ → /orders/items/get ขอรายการสินค้าทีละไม่เกิน 50 ใบ
// เวลาในคำขอเป็น ISO 8601 พร้อมโซนเวลา
const iso = (ms) => new Date(ms).toISOString();

export async function listOrders({ accessToken, since, until }) {
  const out = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const j = await call('/orders/get', {
      accessToken,
      params: {
        update_after: iso(since),
        ...(until ? { update_before: iso(until) } : {}),
        sort_by: 'updated_at',
        sort_direction: 'ASC',
        offset: String(offset),
        limit: '100',
      },
    });
    const orders = j.data?.orders || [];
    out.push(...orders);
    if (orders.length < 100) break;
  }
  return out;
}

export async function getOrderItems({ accessToken, orderIds }) {
  const out = new Map();
  for (let i = 0; i < orderIds.length; i += 50) {
    const j = await call('/orders/items/get', {
      accessToken,
      params: { order_ids: JSON.stringify(orderIds.slice(i, i + 50).map(Number)) },
    });
    for (const o of j.data || []) out.set(String(o.order_id), o.order_items || []);
  }
  return out;
}

export async function fetchOrders({ accessToken, since, until }) {
  const orders = await listOrders({ accessToken, since, until });
  if (!orders.length) return [];
  const items = await getOrderItems({ accessToken, orderIds: orders.map((o) => o.order_id) });
  return orders.map((o) => ({ ...o, order_items: items.get(String(o.order_id)) || [] }));
}

// ดึงออเดอร์ใบเดียว (ใช้ตอน webhook บอกว่าใบไหนเปลี่ยน) — ไม่ต้องกวาดทั้งร้าน
export async function fetchOrder({ accessToken, orderId }) {
  const j = await call('/order/get', { accessToken, params: { order_id: String(orderId) } });
  if (!j.data) return null;
  const items = await getOrderItems({ accessToken, orderIds: [orderId] });
  return { ...j.data, order_items: items.get(String(orderId)) || [] };
}

// ตรวจว่า push มาจาก Lazada จริง: HMAC-SHA256 ของ (app_key + เนื้อคำขอดิบ) ด้วย app_secret เทียบกับ header Authorization
export function verifyPush(rawBody, header) {
  const { key, secret } = creds();
  const expect = crypto.createHmac('sha256', secret).update(key + rawBody).digest('hex');
  const got = String(header || '').trim().toLowerCase();
  return got.length === expect.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expect));
}

// ── แปลงก้อนดิบของ Lazada → รูปแบบกลางที่ตารางเราใช้ ──────────────────
// เวลาของ Lazada หน้าตา "2026-10-09 12:34:56 +0700" — Date() อ่านตรงๆ ไม่ได้ ต้องจัดรูปก่อน
function parseTime(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  let tz = m[3] || '+07:00';
  if (/^[+-]\d{4}$/.test(tz)) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const d = new Date(`${m[1]}T${m[2]}${tz}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ออเดอร์เดียวมีหลายสถานะได้ (บางชิ้นยกเลิก บางชิ้นส่งแล้ว) — ตัดชิ้นที่ยกเลิกทิ้งแล้วเอาอันที่ "ช้าสุด" เป็นตัวแทน
// ทุกชิ้นยกเลิกหมดถึงนับว่ายกเลิก
const PROGRESS = ['unpaid', 'pending', 'topack', 'packed', 'repacked', 'ready_to_ship', 'ready_to_ship_pending', 'shipped', 'delivered', 'confirmed'];
function pickStatus(statuses) {
  const list = (statuses || []).map((s) => String(s).toLowerCase());
  const live = list.filter((s) => s !== 'canceled' && s !== 'cancelled');
  if (!live.length) return list[0] || null;
  const known = live.filter((s) => PROGRESS.includes(s));
  if (!known.length) return live[0];
  return known.sort((a, b) => PROGRESS.indexOf(a) - PROGRESS.indexOf(b))[0];
}

const cancelBy = (v) => {
  const t = String(v || '').toLowerCase();
  if (t.includes('buyer') || t.includes('customer')) return 'BUYER';
  if (t.includes('seller')) return 'SELLER';
  if (t.includes('system') || t.includes('lazada') || t.includes('auto')) return 'SYSTEM';
  return null;
};

export function normalizeOrder(o, shop) {
  const rows = o.order_items || [];
  // Lazada ให้ 1 ชิ้น = 1 แถว (qty 1 เสมอ) ต้องยุบแถวที่เป็นสินค้าเดียวกันเอง
  const lines = new Map();
  for (const it of rows) {
    const key = String(it.sku_id || it.shop_sku || it.sku || it.order_item_id);
    if (!lines.has(key)) {
      lines.set(key, {
        line_id: key,
        sku: it.sku || it.shop_sku || '',
        platform_sku_id: it.sku_id ? String(it.sku_id) : null,
        product_name: it.name || null,
        variant: it.variation || null,
        image_url: it.product_main_image || null,
        qty: 0,
        price: Number(it.item_price ?? it.paid_price ?? 0),
        raw: it,
      });
    }
    lines.get(key).qty += 1;
  }
  const items = [...lines.values()];

  const raw = pickStatus(o.statuses?.length ? o.statuses : rows.map((r) => r.status));
  const status = toStatus('lazada', raw);
  const updated = parseTime(o.updated_at);
  const first = rows.find((r) => r.tracking_code) || rows[0] || {};
  const slas = rows.map((r) => parseTime(r.sla_time_stamp)).filter(Boolean).sort();
  // กดแพ็ค/พิมพ์ใบแล้ว Lazada จะออกเลขพัสดุให้ — ใช้เป็นสัญญาณว่า "ของถูกหยิบมาแพ็คแล้ว" ได้แม้ภายหลังถูกยกเลิก
  const hasTracking = rows.some((r) => r.tracking_code);
  const sent = ['shipped', 'delivered', 'done'].includes(status);
  const arranged = status === 'packed' || sent || (status === 'cancelled' && hasTracking && !sent);
  const carrier = first.shipment_provider || null;

  return {
    order: {
      platform: 'lazada',
      shop,
      order_id: String(o.order_id),
      status,
      raw_status: raw,
      buyer: [o.customer_first_name, o.customer_last_name].filter(Boolean).join(' ').trim() || null,
      total: Number(o.price || 0),
      currency: 'THB',
      ship_by: slas[0] || null,
      is_cod: /cod|cash/i.test(String(o.payment_method || '')) || null,
      item_count: items.reduce((s, i) => s + i.qty, 0),
      ordered_at: parseTime(o.created_at),
      platform_updated_at: updated,
      paid_at: null,
      rts_at: arranged ? updated : null,
      // Lazada ไม่บอกเวลาที่ขนส่งมารับ — ใช้เวลาที่สถานะขยับล่าสุดแทนเมื่อถึง shipped ขึ้นไป
      collected_at: sent ? updated : null,
      cancelled_at: status === 'cancelled' ? updated : null,
      cancel_reason: rows.map((r) => r.reason).find(Boolean) || null,
      cancel_by: cancelBy(rows.map((r) => r.cancel_return_initiator).find(Boolean)),
      tracking_no: first.tracking_code || null,
      carrier: status === 'to_ship' ? null : carrier,
      is_express: isExpressShipping(carrier, first.shipping_provider_type),
      raw: o,
      synced_at: new Date().toISOString(),
    },
    items,
  };
}

// ── เงินที่ได้รับจริง (Finance API) ───────────────────────────────────────
// Lazada ไม่มี "ก้อนต่อออเดอร์" แบบ Shopee escrow และไม่มีใบสรุปให้ถามเป็นก้อนแบบ TikTok
// /finance/transaction/details/get ให้เป็น "บรรทัดค่าธรรมเนียม" ทีละรายการ (ออเดอร์หนึ่งใบมีหลายบรรทัด เช่น
// ราคาสินค้า, ค่าคอม, ค่าธรรมเนียมชำระเงิน, ค่าส่ง) แต่ละบรรทัดมี amount ติดเครื่องหมายแล้ว (เข้า = บวก, หัก = ลบ)
// เราต้องรวมบรรทัดเป็นก้อนต่อ (ออเดอร์ + วัน) เอง แล้วเก็บลง os_money_tx โครงเดียวกับแพลตฟอร์มอื่น
// ชื่อฟิลด์จัดรูปตอนอ่าน (ตัวพิมพ์เล็ก ช่องว่าง→_) เพราะ Lazada ตอบทั้ง "WHT amount" และ "paid status" แบบมีเว้นวรรค
const FIN_PAGE = 500;

const normKeys = (row) => Object.fromEntries(
  Object.entries(row || {}).map(([k, v]) => [String(k).trim().toLowerCase().replace(/[\s-]+/g, '_'), v]),
);
const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// from / to = YYYY-MM-DD (ทั้งสองวันนับรวม) — เรียกได้ทีละช่วงสั้นๆ แล้วไล่หน้าจนหมด
export async function listTransactions({ accessToken, from, to }) {
  const out = [];
  for (let offset = 0; offset < 100000; offset += FIN_PAGE) {
    const j = await call('/finance/transaction/details/get', {
      accessToken,
      params: { start_time: from, end_time: to, offset: String(offset), limit: String(FIN_PAGE) },
    });
    const rows = Array.isArray(j.data) ? j.data : [];
    out.push(...rows.map(normKeys));
    if (rows.length < FIN_PAGE) break;
  }
  return out;
}

// วันที่ในบรรทัดมาเป็น "05 Oct 2026" หรือ ISO ก็ได้ — คืน YYYY-MM-DD (ถือเป็นวัน UTC เหมือนใบสรุปแพลตฟอร์มอื่น)
function dayOf(s) {
  const t = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const d = new Date(`${t} UTC`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// วันของบรรทัด (YYYY-MM-DD) — route ใช้กรองให้ตรงกับวันที่ถาม
export const rowDay = (r) => dayOf(r.transaction_date);

const slug = (t) => String(t || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'other';

// จัดบรรทัดเข้ากลุ่มตามชื่อรายการ — ชื่อที่ไม่รู้จักและเป็นยอดหัก ไปอยู่กลุ่มค่าธรรมเนียม · เป็นยอดเข้า ไปอยู่ "ปรับปรุง"
function classify(row) {
  const name = String(row.fee_name || row.transaction_type || '').toLowerCase();
  const amt = num(row.amount);
  if (/shipping|delivery|logistic|freight/.test(name)) return 'ship';
  if (/item price|product price|reversal item|^refund/.test(name)) return 'price';
  if (/promotional|discount|voucher|flexi|coupon|campaign/.test(name)) return 'discount';
  return amt < 0 ? 'fee' : 'adjustment';
}

// เฉพาะบรรทัดที่ Lazada จ่ายแล้ว — ใบที่ยังไม่ถึงรอบปิดยอดจะมีบรรทัดแต่ยังไม่ใช่เงินเข้า
// ไม่มีฟิลด์นี้มาเลยก็ถือว่าจ่ายแล้ว (ไม่ทิ้งข้อมูลทั้งก้อนเพราะชื่อฟิลด์เปลี่ยน)
export const isPaidRow = (r) => !('paid_status' in r) || /^paid/i.test(String(r.paid_status || '').trim());

// รวมบรรทัดของ (ออเดอร์ + วัน) เดียวกัน → หนึ่งแถว os_money_tx
// tx_id ใส่วันต่อท้าย เพราะบรรทัดของออเดอร์เดียวกันกระจายหลายวันได้ (เช่น ปิดยอดแล้วค่อยมีตีคืนตามมา)
// ถ้ารวมทั้งใบเป็นแถวเดียว รอบดึงที่เห็นแค่บางวันจะเขียนทับด้วยยอดไม่ครบ
export function normalizeMoneyTx(rows, shop) {
  const groups = new Map();
  for (const r of rows) {
    const day = dayOf(r.transaction_date);
    if (!day) continue;
    const order = String(r.order_no || '').trim();
    const key = order ? `${order}@${day}` : `ADJ-${r.transaction_number || slug(r.fee_name)}@${day}`;
    if (!groups.has(key)) groups.set(key, { key, day, order, rows: [] });
    groups.get(key).rows.push(r);
  }

  return [...groups.values()].map(({ key, day, order, rows: g }) => {
    const sum = { price: 0, discount: 0, fee: 0, ship: 0, adjustment: 0 };
    const breakdown = {};
    const put = (k, v) => { if (v) breakdown[k] = Number(((breakdown[k] || 0) + v).toFixed(2)); };
    let wht = 0;
    for (const r of g) {
      const amt = num(r.amount);
      const kind = classify(r);
      sum[kind] += amt;
      const s = slug(r.fee_name || r.transaction_type);
      if (kind === 'price') put('rev.price_credit', amt);
      else if (kind === 'discount') put('rev.seller_discount', amt);
      else if (kind === 'fee') put(`fee.${s}`, amt);
      else if (kind === 'ship') put(`ship.${s}`, amt);
      else put(`fee.${s}`, amt);
      // ภาษีหัก ณ ที่จ่าย: ถ้า amount ยังไม่หักไว้ ("No") ต้องหักเพิ่มตอนโอนจริง
      if (/^no/i.test(String(r.wht_included_in_amount || ''))) wht += Math.abs(num(r.wht_amount));
    }
    if (wht) put('tax.withholding_tax', -wht);

    const total = Object.values(sum).reduce((a, b) => a + b, 0) - wht;
    const gross = sum.price;
    const revenue = gross + sum.discount;
    const fee = sum.fee - wht;
    const shipping = sum.ship;
    const settlement = Number(total.toFixed(2));
    const adjustment = Number((settlement - revenue - fee - shipping).toFixed(2));
    return {
      platform: 'lazada',
      shop,
      tx_id: key,
      statement_id: day,
      statement_at: `${day}T00:00:00.000Z`,
      type: order ? 'ORDER' : 'ADJUSTMENT',
      order_id: order || null,
      order_created_at: null,
      gross,
      seller_discount: sum.discount,
      customer_paid: gross,
      revenue,
      fee: Number(fee.toFixed(2)),
      shipping,
      adjustment,
      settlement,
      breakdown,
    };
  });
}

// ── รายการสินค้าทั้งร้าน (หน้า /product) ─────────────────────────────────
// /products/get ให้ตะกร้าพร้อมตัวเลือก ราคา คลัง มาในก้อนเดียว (ไม่ต้องถามทีละตะกร้าแบบ Shopee) ครั้งละไม่เกิน 50
// ต้องถามทีละ filter เพราะ Lazada ไม่บอกสถานะตะกร้ามาในก้อน — สถานะคือ filter ที่ถามเจอ
// live = ขายอยู่ · inactive = ปิดไว้ · pending = รอตรวจ · rejected = ไม่ผ่าน (ตะกร้าที่ลบแล้วไม่อยู่ในรายการ)
export const PRODUCT_PAGE_SIZE = 50;
export const PRODUCT_FILTERS = [
  { filter: 'live', status: 'NORMAL' },
  { filter: 'inactive', status: 'UNLIST' },
  { filter: 'pending', status: 'PENDING' },
  { filter: 'rejected', status: 'FAILED' },
];

export async function listProductsPage({ accessToken, filter, page }) {
  const j = await call('/products/get', {
    accessToken,
    params: { filter, offset: String(page * PRODUCT_PAGE_SIZE), limit: String(PRODUCT_PAGE_SIZE) },
  });
  return { products: j.data?.products || [], total: j.data?.total_products ?? null };
}

// ฟิลด์มาตรฐานของ SKU — ที่เหลือที่เป็นข้อความสั้นๆ ถือเป็นชื่อตัวเลือก (สี/ไซส์) เผื่อ Lazada ไม่ใส่ไว้ใน saleProp
const SKU_STD = new Set([
  'status', 'quantity', 'available', 'product_weight', 'images', 'sellersku', 'shopsku', 'url', 'skuid',
  'price', 'special_price', 'special_from_date', 'special_to_date', 'special_time_format', 'saleprop',
  'multiwarehouseinventories', 'fblwarehouseinventories', 'package_height', 'package_length', 'package_width',
  'package_weight', 'package_content', 'tax_class', 'barcode', 'channels', 'rank', 'quality_issues',
]);

function variantOf(s) {
  const sp = s.saleProp || s.saleprop;
  if (sp && typeof sp === 'object') {
    const v = Object.values(sp).filter((x) => typeof x === 'string' && x).join(' / ');
    if (v) return v;
  }
  const extra = Object.entries(s)
    .filter(([k, v]) => !SKU_STD.has(k.toLowerCase()) && typeof v === 'string' && v && v.length <= 40)
    .map(([, v]) => v);
  return extra.join(' / ') || null;
}

// ราคาพิเศษ: ใช้เมื่อมี ต่ำกว่าราคาปกติ และยังอยู่ในช่วงวันที่ (ถ้าระบุมา)
function promoOf(s, price) {
  const sp = Number(s.special_price);
  if (!Number.isFinite(sp) || sp <= 0 || price === null || sp >= price) return null;
  const now = Date.now();
  const from = s.special_from_date ? Date.parse(String(s.special_from_date).replace(' ', 'T') + '+07:00') : null;
  const to = s.special_to_date ? Date.parse(String(s.special_to_date).replace(' ', 'T') + '+07:00') : null;
  if (from && !Number.isNaN(from) && from > now) return null;
  if (to && !Number.isNaN(to) && to < now) return null;
  return sp;
}

const ms2iso = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
};

export function normalizeListing(p, shop, status) {
  const key = { platform: 'lazada', shop, product_id: String(p.item_id) };
  const rows = p.skus || [];
  const skus = rows.map((s, i) => {
    const price = s.price === undefined || s.price === null || s.price === '' ? null : Number(s.price);
    return {
      ...key,
      sku_id: String(s.SkuId ?? s.skuId ?? `${p.item_id}-${i}`),
      seller_sku: s.SellerSku || s.sellerSku || null,
      variant: variantOf(s),
      price: Number.isFinite(price) ? price : null,
      promo_price: promoOf(s, Number.isFinite(price) ? price : null),
      stock: Number(s.quantity ?? s.Available ?? 0) || 0,
      image_url: (s.Images || s.images || [])[0] || null,
      sort: i,
    };
  });
  return {
    listing: {
      ...key,
      title: p.attributes?.name || null,
      thumb_url: (p.images || [])[0] || rows.map((s) => (s.Images || [])[0]).find(Boolean) || null,
      status,
      item_sku: null,
      remote_updated_at: ms2iso(p.updated_time),
      remote_created_at: ms2iso(p.created_time),
    },
    skus,
  };
}
