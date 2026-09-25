// Shopee Open Platform API v2 — เซ็นคำขอ + ดึงออเดอร์ + ต่ออายุโทเคน
// เซ็นยังไง: HMAC-SHA256 คีย์ = partner_key, ข้อความ = partner_id + path + timestamp + access_token + shop_id
// (ตอนขอโทเคนใหม่จะไม่มี access_token กับ shop_id ในข้อความ)
// ยืนยันจากสคริปต์ Colab ที่ร้านใช้อยู่จริง
import crypto from 'crypto';

const BASE = process.env.SHOPEE_API_BASE || 'https://partner.shopeemobile.com';

// ร้านแต่ละร้านอาจอยู่คนละแอป (partner คนละตัว) จึงต้องส่งกุญแจของร้านนั้นมาด้วยทุกครั้ง
// ถ้าไม่ส่งมาก็ใช้ชุดหลักใน env (ร้านแรกที่ผูก)
export function partnerOf(row) {
  const id = row?.partner_id || process.env.SHOPEE_PARTNER_ID;
  const key = row?.partner_key || process.env.SHOPEE_PARTNER_KEY;
  if (!id || !key) throw new Error('ไม่รู้ว่าร้านนี้ใช้แอปไหน (ไม่มี partner_id / partner_key)');
  return { id, key };
}

function sign(path, ts, accessToken = '', shopId = '', partner = null) {
  const { id, key } = partnerOf(partner);
  const base = `${id}${path}${ts}${accessToken}${shopId}`;
  return crypto.createHmac('sha256', key).update(base).digest('hex');
}

// เรียก API ของร้าน (ต้องมีโทเคนกับ shop_id เสมอ)
// debugRaw: true คืนทั้งก้อน (error/message/request_id/response) แทนที่จะตัดเอาแต่ .response
// ไว้ส่องตอนสงสัยว่าฟิลด์ที่ตัวแปลงอ่านไม่ตรงกับที่ Shopee ตอบจริง (ดู app/api/debug/settlement-shopee)
export async function call(path, { params = {}, accessToken, shopId, method = 'GET', body = null, partner = null, debugRaw = false } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const q = new URLSearchParams({
    partner_id: partnerOf(partner).id,
    timestamp: String(ts),
    access_token: accessToken,
    shop_id: String(shopId),
    sign: sign(path, ts, accessToken, String(shopId), partner),
    ...params,
  });

  const res = await fetch(`${BASE}${path}?${q}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (debugRaw) return json;
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
// Shopee ยอมให้ถามช่วงเวลาได้ครั้งละไม่เกิน 15 วัน — ถ้าขอกว้างกว่านั้นจะถูกปฏิเสธทั้งคำขอ
const MAX_WINDOW = 14 * 86400 * 1000;

// ไม่ระบุ order_status = ได้ทุกสถานะในรอบเดียว
// (เคยเขียนวนทีละสถานะ 8 รอบ ซึ่งยิง API มากกว่าที่จำเป็น 8 เท่าโดยไม่ได้อะไรเพิ่ม)
export async function listOrderSns({ accessToken, shopId, since, until, timeField = 'update_time', partner = null }) {
  const out = new Set();
  const end = until || Date.now();

  // ซอยช่วงเวลาเป็นท่อนละไม่เกิน 15 วัน แล้วไล่ถามทีละท่อน
  for (let from = since; from < end; from += MAX_WINDOW) {
    const to = Math.min(from + MAX_WINDOW, end);
    let cursor = '';
    for (let page = 0; page < 100; page++) {
      const data = await call('/api/v2/order/get_order_list', {
        accessToken, shopId, partner,
        params: {
          time_range_field: timeField,
          time_from: String(Math.floor(from / 1000)),
          time_to: String(Math.floor(to / 1000)),
          page_size: '100',
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

const FIELDS = [
  'item_list', 'package_list', 'pay_time', 'pickup_done_time', 'ship_by_date',
  'total_amount', 'order_status', 'recipient_address', 'buyer_username',
  'cancel_by', 'cancel_reason', 'buyer_cancel_reason', 'update_time', 'create_time',
  'shipping_carrier', 'actual_shipping_fee',
].join(',');

export async function getOrderDetails({ accessToken, shopId, orderSns, partner = null }) {
  const out = [];
  for (let i = 0; i < orderSns.length; i += 50) {
    const data = await call('/api/v2/order/get_order_detail', {
      accessToken, shopId, partner,
      params: { order_sn_list: orderSns.slice(i, i + 50).join(','), response_optional_fields: FIELDS },
    });
    out.push(...(data.order_list || []));
  }
  return out;
}

// เลขติดตามพัสดุ Shopee ไม่ส่งมากับรายละเอียดออเดอร์ ต้องขอแยกทีละใบ
// (package_number ที่มากับออเดอร์เป็นรหัสภายในของ Shopee คนละตัวกับเลขที่ใช้ติดตามกับขนส่ง)
export async function getTrackingNumber({ accessToken, shopId, orderSn, partner = null }) {
  try {
    const d = await call('/api/v2/logistics/get_tracking_number', {
      accessToken, shopId, partner, params: { order_sn: orderSn },
    });
    if (!d.tracking_number) return null;
    // ส่งด่วนใช้ไรเดอร์ของ Shopee Food ซึ่งมีรหัสให้คนแพ็คบอกไรเดอร์ตอนมารับ
    // ติดไว้กับเลขพัสดุเลย คนหน้างานจะได้เห็นพร้อมกัน
    return d.pickup_code ? `${d.tracking_number} · รหัสรับ ${d.pickup_code}` : d.tracking_number;
  } catch {
    return null;   // ใบที่ยังไม่ได้กดจัดส่งจะยังไม่มีเลข ถือเป็นเรื่องปกติ
  }
}

export async function fetchOrders({ accessToken, shopId, since, until, partner = null }) {
  const sns = await listOrderSns({ accessToken, shopId, since, until, partner });
  if (!sns.length) return [];
  return getOrderDetails({ accessToken, shopId, orderSns: sns, partner });
}

// ── โทเคน ─────────────────────────────────────────────────────────────
// access_token อยู่ได้ 4 ชั่วโมงเท่านั้น (สั้นกว่า TikTok มาก) · refresh_token 30 วัน
export async function refreshToken({ refreshToken: rt, shopId, partner = null }) {
  const ts = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/access_token/get';
  const q = new URLSearchParams({
    partner_id: partnerOf(partner).id,
    timestamp: String(ts),
    sign: sign(path, ts, '', '', partner),   // ขั้นนี้ยังไม่มีโทเคน จึงเซ็นด้วย partner_id + path + ts เท่านั้น
  });
  const res = await fetch(`${BASE}${path}?${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      refresh_token: rt,
      partner_id: Number(partnerOf(partner).id),
      shop_id: Number(shopId),
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`ต่ออายุโทเคน Shopee ไม่สำเร็จ: ${json.error} ${json.message || ''}`);
  return json;   // { access_token, refresh_token, expire_in }
}

// แลก code จากหน้าอนุญาต → โทเคนชุดแรกของร้าน
export async function exchangeCode({ code, shopId, partner = null }) {
  const ts = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/token/get';
  const q = new URLSearchParams({
    partner_id: partnerOf(partner).id,
    timestamp: String(ts),
    sign: sign(path, ts, '', '', partner),
  });
  const res = await fetch(`${BASE}${path}?${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, partner_id: Number(partnerOf(partner).id), shop_id: Number(shopId) }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`แลกโทเคน Shopee ไม่สำเร็จ: ${json.error} ${json.message || ''}`);
  return json;
}

// ลิงก์ให้เจ้าของร้านกดอนุญาต
export function authorizeUrl(redirectUrl, partner = null) {
  const ts = Math.floor(Date.now() / 1000);
  const path = '/api/v2/shop/auth_partner';
  const q = new URLSearchParams({
    partner_id: partnerOf(partner).id,
    timestamp: String(ts),
    sign: sign(path, ts, '', '', partner),
    redirect: redirectUrl,
  });
  return `${BASE}${path}?${q}`;
}

// ── แปลงก้อนดิบของ Shopee → รูปแบบกลางที่ตารางเราใช้ ──────────────────
import { toStatus } from './status.js';
import { isExpressShipping } from './shipping.js';

const ts2iso = (t) => (t ? new Date(t * 1000).toISOString() : null);

// สถานะพัสดุของ Shopee บอกได้ตรงๆ ว่าตอนยกเลิกนั้นของไปถึงไหนแล้ว (จากเอกสาร Order Management)
//   LOGISTICS_INVALID          ยกเลิกตอนพัสดุยัง READY = ยังไม่ได้กดจัดส่ง ของอยู่บนชั้น
//   LOGISTICS_REQUEST_CANCELED ยกเลิกตอนพัสดุ REQUEST_CREATED = กดจัดส่งแล้ว ของถูกหยิบมาแพ็ค
//   LOGISTICS_PICKUP_FAILED    ขนส่งรับไม่สำเร็จ หรือรับแล้วส่งต่อไม่ได้
const PICKED_UP = ['LOGISTICS_PICKUP_DONE', 'LOGISTICS_DELIVERY_DONE', 'LOGISTICS_DELIVERY_FAILED', 'LOGISTICS_LOST'];
// จองรถแล้ว = กดจัดส่งแล้วจริง
// ห้ามรวม LOGISTICS_READY เพราะนั่นแปลว่าแค่จ่ายเงินเรียบร้อย ยังไม่มีใครกดส่ง
const ARRANGED = ['LOGISTICS_REQUEST_CREATED', 'LOGISTICS_PICKUP_RETRY'];
// ยกเลิกทั้งที่กดจัดส่งไปแล้ว — ของถูกหยิบมาแพ็คแล้ว ต้องไปเอาออกจากกอง
const CANCELLED_AFTER_ARRANGE = ['LOGISTICS_REQUEST_CANCELED', 'LOGISTICS_PICKUP_FAILED'];

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
  const arranged = logi.some((s) => ARRANGED.includes(s));
  // ยกเลิกหลังกดจัดส่ง — Shopee ล้าง pickup_done_time ทิ้ง แต่ยังทิ้งร่องรอยไว้ที่สถานะพัสดุ
  const cancelledAfterArrange = logi.some((s) => CANCELLED_AFTER_ARRANGE.includes(s));
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
      ship_by: ts2iso(o.ship_by_date),        // เส้นตายที่ต้องส่งของ
      is_cod: o.cod ?? null,
      item_count: items.reduce((s, i) => s + i.qty, 0),
      ordered_at: ts2iso(o.create_time),
      platform_updated_at: updated,
      paid_at: ts2iso(o.pay_time),
      // กดจัดส่งแล้ว = จองรถ ถูกรับไปแล้ว หรือยกเลิกทั้งที่จองรถไว้แล้ว
      // (ไม่มีเวลาเป๊ะ ใช้เวลาที่ออเดอร์ขยับล่าสุดแทน)
      rts_at: arranged || collected || cancelledAfterArrange ? updated : null,
      collected_at: collected,   // เวลาจริงจาก Shopee ถ้ามี
      cancelled_at: status === 'cancelled' ? updated : null,
      // เหตุผลมาได้ 2 ช่อง — ฝั่งร้านยกเลิกกับฝั่งลูกค้ายกเลิกคนละฟิลด์กัน
      cancel_reason: o.cancel_reason || o.buyer_cancel_reason || null,
      cancel_by: o.cancel_by || null,
      // ยังไม่กดจัดส่ง = ยังไม่มีเลขพัสดุและยังไม่ได้เรียกขนส่งจริง
      // (package_number ที่ Shopee ส่งมาตั้งแต่ต้นเป็นรหัสภายใน ไม่ใช่เลขที่ติดตามได้ ห้ามเอามาโชว์)
      tracking_no: null,
      carrier: status === 'to_ship' ? null : (o.shipping_carrier || pkgs.map((p) => p.shipping_carrier).filter(Boolean)[0] || null),
      is_express: isExpressShipping(o.shipping_carrier, pkgs.map((p) => p.shipping_carrier).join(' ')),
      raw: o,
      synced_at: new Date().toISOString(),
    },
    items,
  };
}

// ── เงินที่ได้รับจริง (Escrow) ───────────────────────────────────────────
// Shopee ไม่มี "ใบสรุปรายวัน" ให้ถามเป็นก้อนแบบ TikTok — มีแค่ระดับออเดอร์:
//   1. get_escrow_list         รายชื่อออเดอร์ที่ escrow ปล่อยแล้วในช่วงเวลา (แค่เลข + ยอดคร่าวๆ)
//   2. get_escrow_detail_batch แจกแจงเต็มทีละไม่เกิน 50 ใบ (Shopee แนะนำ 1-20 ใบ/ครั้ง)
// "ใบสรุปรายวัน" ของเราสำหรับ Shopee เลยเป็นของสังเคราะห์เอง — รวมยอดตามวันที่ escrow ปล่อย
// (ทำใน os_rebuild_statements ฝั่ง SQL จากแถว os_money_tx ที่บันทึกแล้ว ไม่ใช่เดายอดจาก escrow_list เอง)
const shopeeNum = (v) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || Number.isNaN(n) ? 0 : n;
};
const ESCROW_WINDOW = 14 * 86400 * 1000; // ถามได้ครั้งละไม่เกิน 15 วันเหมือน order list

export async function listEscrow({ accessToken, shopId, since, until, partner = null }) {
  const out = [];
  const end = until || Date.now();
  for (let from = since; from < end; from += ESCROW_WINDOW) {
    const to = Math.min(from + ESCROW_WINDOW, end);
    for (let pageNo = 1; pageNo < 500; pageNo++) {
      const data = await call('/api/v2/payment/get_escrow_list', {
        accessToken, shopId, partner,
        params: {
          release_time_from: String(Math.floor(from / 1000)),
          release_time_to: String(Math.floor(to / 1000)),
          page_size: '100',
          page_no: String(pageNo),
        },
      });
      out.push(...(data.escrow_list || []));
      if (!data.more) break;
    }
  }
  return out;
}

// ทีละไม่เกิน 50 ใบต่อคำขอ
// endpoint นี้ต้องเป็น POST + ส่ง order_sn_list เป็น array จริงในตัว body (ไม่ใช่ GET + คอมมาต่อกันแบบ order/get_order_detail)
// ก้อนที่ตอบกลับมาไม่ใช่ {order_income_list:[...]} แบบที่เอกสารนอกบอก — เป็น array ตรงๆ
// แต่ละใบห่อด้วย {escrow_detail: {...}} อีกชั้น (ตรวจกับก้อนดิบจริงแล้ว) แกะชั้นนั้นออกให้ตรงนี้เลย
export async function getEscrowDetailBatch({ accessToken, shopId, orderSns, partner = null }) {
  const out = [];
  for (let i = 0; i < orderSns.length; i += 50) {
    const data = await call('/api/v2/payment/get_escrow_detail_batch', {
      accessToken, shopId, partner, method: 'POST',
      body: { order_sn_list: orderSns.slice(i, i + 50) },
    });
    const list = Array.isArray(data) ? data : [];
    out.push(...list.map((x) => x.escrow_detail || x));
  }
  return out;
}

// เก็บเฉพาะฟิลด์ที่ไม่เป็นศูนย์ ลงในกลุ่ม rev./fee./tax./ship. ให้ breakdownGroups() ใน lib/settlement.js
// จัดกลุ่มโชว์ได้เหมือน TikTok — ชื่อไทยของแต่ละฟิลด์อยู่ใน lib/settlement.js (LABEL)
// ชื่อฟิลด์ตรวจกับก้อนดิบจริงจาก get_escrow_detail_batch แล้ว (ต่างจากเอกสารนอกที่อ้างอิงตอนเขียนแรก)
function shopeeBreakdown(income) {
  const out = {};
  const put = (prefix, key, val) => { const n = shopeeNum(val); if (n !== 0) out[prefix + key] = n; };
  put('rev.', 'subtotal', income.items?.reduce((s, i) => s + shopeeNum(i.original_price), 0));
  put('rev.', 'seller_discount', -shopeeNum(income.items?.reduce((s, i) => s + shopeeNum(i.seller_discount), 0)));
  put('rev.', 'shopee_discount', income.items?.reduce((s, i) => s + shopeeNum(i.shopee_discount), 0));
  put('rev.', 'voucher_from_seller', -shopeeNum(income.voucher_from_seller));
  put('rev.', 'voucher_from_shopee', shopeeNum(income.voucher_from_shopee));
  put('rev.', 'coins', -shopeeNum(income.coins));
  put('rev.', 'credit_card_promotion', shopeeNum(income.credit_card_promotion));
  put('fee.', 'commission_fee', -shopeeNum(income.commission_fee));
  put('fee.', 'seller_transaction_fee', -shopeeNum(income.seller_transaction_fee));
  put('fee.', 'service_fee', -shopeeNum(income.service_fee));
  put('fee.', 'seller_order_processing_fee', -shopeeNum(income.seller_order_processing_fee));
  put('tax.', 'withholding_tax', -shopeeNum(income.withholding_tax));
  put('ship.', 'actual_shipping_fee', -shopeeNum(income.actual_shipping_fee));
  put('ship.', 'buyer_paid_shipping_fee', shopeeNum(income.buyer_paid_shipping_fee));
  put('ship.', 'shopee_shipping_rebate', shopeeNum(income.shopee_shipping_rebate));
  put('ship.', 'reverse_shipping_fee', -shopeeNum(income.reverse_shipping_fee));
  return out;
}

// หนึ่งออเดอร์ที่ escrow ปล่อยแล้ว → หนึ่งแถวใน os_money_tx
// escrow_amount คือยอดที่ Shopee ยืนยันว่าจ่ายจริง ใช้เป็น settlement ตรงๆ เชื่อถือได้ 100%
// revenue/fee/shipping สามช่องแรกมาจากฟิลด์ที่ตรวจกับก้อนดิบจริงแล้ว (ไม่ใช่เดาจากเอกสารนอกอีกต่อไป)
// ตรวจสมการกับออเดอร์จริง (75 ค่าสินค้า − 22 ค่าธรรมเนียม − 0 ค่าส่งสุทธิ = 53 escrow_amount) ตรงเป๊ะ
// adjustment ยังเก็บไว้เป็นตัวปรับเผื่อกรณีอื่นที่ยังไม่เจอ (เช่น ตีคืน/โปรโมชั่นพิเศษ) จะได้ไม่ทำให้ settlement ผิด
export function normalizeMoneyTx(entry, { shop, statementAt }) {
  const income = entry.order_income || {};
  const items = income.items || [];
  // original_price ของ items[] ในนี้เป็นราคา "รวมทั้งไลน์" อยู่แล้ว (ตรงกับ order_original_price)
  // ไม่ใช่ราคาต่อชิ้นแบบที่ order/get_order_detail ใช้ — ห้ามคูณ quantity_purchased ซ้ำ
  // (เจอจริง: original_price 3500 + quantity_purchased 10 → ราคาป้ายพองเป็น 35,000 ทั้งที่ของจริง 3,500)
  const gross = items.reduce((s, i) => s + shopeeNum(i.original_price), 0);
  const sellerDiscount = -items.reduce((s, i) => s + shopeeNum(i.seller_discount), 0);
  const fee = -(shopeeNum(income.commission_fee) + shopeeNum(income.seller_transaction_fee)
    + shopeeNum(income.service_fee) + shopeeNum(income.seller_order_processing_fee)
    + shopeeNum(income.withholding_tax));
  const shipping = -(shopeeNum(income.actual_shipping_fee) - shopeeNum(income.buyer_paid_shipping_fee)
    - shopeeNum(income.shopee_shipping_rebate) + shopeeNum(income.reverse_shipping_fee));
  const revenue = gross + sellerDiscount;
  const settlement = shopeeNum(income.escrow_amount);
  const adjustment = Number((settlement - revenue - fee - shipping).toFixed(2));
  return {
    platform: 'shopee',
    shop,
    tx_id: String(entry.order_sn),
    statement_id: statementAt.slice(0, 10),   // วันที่ escrow ปล่อย — คีย์เดียวกับที่ os_rebuild_statements ใช้รวมยอด
    statement_at: statementAt,
    type: 'ORDER',
    order_id: String(entry.order_sn),
    order_created_at: null,   // escrow API ไม่บอกวันสั่ง — ดูได้จากหน้าออเดอร์แทน
    gross,
    seller_discount: sellerDiscount,
    customer_paid: shopeeNum(income.buyer_total_amount),
    revenue,
    fee,
    shipping,
    adjustment,
    settlement,
    breakdown: shopeeBreakdown(income),
  };
}

// ── ข้อมูลตะกร้า (Product API) ────────────────────────────────────────
// ใช้เอารูปปกกับชื่อสินค้ามาแสดงในหน้ารายสินค้า — ข้อมูลออเดอร์มีแค่รูปของตัวเลือกสี/ไซส์
// product_id ของ Shopee ที่เก็บไว้ใน os_money_items คือ item_id ตัวนี้เอง (ดู supabase/028)
export async function getItemBaseInfo({ accessToken, shopId, itemIds, partner = null }) {
  const out = [];
  for (let i = 0; i < itemIds.length; i += 50) {
    const data = await call('/api/v2/product/get_item_base_info', {
      accessToken, shopId, partner,
      params: { item_id_list: itemIds.slice(i, i + 50).join(',') },
    });
    out.push(...(data.item_list || []));
  }
  return out;
}

export function normalizeProduct(p) {
  const images = p.image?.image_url_list || [];
  return {
    platform: 'shopee',
    product_id: String(p.item_id),
    title: p.item_name || null,
    cover_url: images[0] || null,
    thumb_url: images[0] || null,
    status: p.item_status || null,
    synced_at: new Date().toISOString(),
  };
}

// ── รายการสินค้าทั้งร้าน (หน้า /product) ─────────────────────────────────
// get_item_list ให้แค่ item_id + เวลาแก้ไขล่าสุด (ครั้งละไม่เกิน 100) — ถามทีละสถานะ
// เพราะ call() ส่ง params เป็น object ใส่ item_status ซ้ำหลายค่าในคำขอเดียวไม่ได้
// ต้องขอครบ 4 สถานะที่หลังร้านโชว์ — รุ่นแรกขอแค่ NORMAL/UNLIST แท็บ "การละเมิด" กับ
// "อยู่ระหว่างตรวจสอบ" ในหน้า /product เลยว่างตลอด (ไม่นับ SELLER_DELETE/SHOPEE_DELETE = ลบแล้ว)
export async function listItemIds({ accessToken, shopId, partner = null, statuses = ['NORMAL', 'UNLIST', 'BANNED', 'REVIEWING'] }) {
  const out = [];
  for (const status of statuses) {
    let offset = 0;
    for (let guard = 0; guard < 200; guard++) {
      const data = await call('/api/v2/product/get_item_list', {
        accessToken, shopId, partner,
        params: { offset: String(offset), page_size: '100', item_status: status },
      });
      out.push(...(data.item || []));
      if (!data.has_next_page) break;
      offset = data.next_offset;
    }
  }
  return out;
}

// ตัวเลือกสี/ไซส์ของตะกร้าเดียว — Shopee ไม่มีแบบถามทีละหลายตะกร้า
export async function getModelList({ accessToken, shopId, itemId, partner = null }) {
  return call('/api/v2/product/get_model_list', {
    accessToken, shopId, partner, params: { item_id: String(itemId) },
  });
}

// ราคา: original_price = ราคาตั้ง · current_price = ราคาที่ลูกค้าเห็นตอนนี้ (ต่ำกว่า = ติดโปร)
function shopeePrices(priceInfo) {
  const p = (priceInfo || [])[0] || {};
  const price = p.original_price ?? p.current_price ?? null;
  const cur = p.current_price ?? null;
  return { price, promo_price: cur !== null && price !== null && cur < price ? cur : null };
}
const shopeeStock = (s) => s?.summary_info?.total_available_stock ?? null;

// base = ก้อนจาก get_item_base_info · models = ก้อนจาก get_model_list (null ถ้าไม่มีตัวเลือก)
export function normalizeListing(base, models, shop) {
  const key = { platform: 'shopee', shop, product_id: String(base.item_id) };
  const tiers = models?.tier_variation || [];
  const images = base.image?.image_url_list || [];
  let skus;
  if (base.has_model && models?.model?.length) {
    skus = models.model.map((m) => {
      const opts = (m.tier_index || []).map((ix, t) => tiers[t]?.option_list?.[ix]);
      return {
        ...key,
        sku_id: String(m.model_id),
        seller_sku: m.model_sku || null,
        variant: opts.map((o) => o?.option).filter(Boolean).join(' / ') || null,
        ...shopeePrices(m.price_info),
        stock: shopeeStock(m.stock_info_v2),
        // รูปของตัวเลือกผูกกับชั้นแรก (มักเป็นสี)
        image_url: opts[0]?.image?.image_url || null,
      };
    });
    // เรียงตามลำดับตัวเลือกที่ร้านตั้งไว้ (สี → ไซส์) ไม่ใช่ตาม model_id
    const order = (s) => (models.model.find((m) => String(m.model_id) === s.sku_id)?.tier_index || []);
    skus.sort((a, b) => {
      const x = order(a), y = order(b);
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    });
  } else {
    skus = [{
      ...key, sku_id: String(base.item_id), seller_sku: base.item_sku || null, variant: null,
      ...shopeePrices(base.price_info), stock: shopeeStock(base.stock_info_v2), image_url: null,
    }];
  }
  skus.forEach((s, i) => { s.sort = i; });
  return {
    listing: {
      ...key,
      title: base.item_name || null,
      thumb_url: images[0] || null,
      status: base.item_status || null,
      item_sku: base.has_model ? (base.item_sku || null) : null,
      remote_updated_at: base.update_time ? new Date(base.update_time * 1000).toISOString() : null,
      remote_created_at: base.create_time ? new Date(base.create_time * 1000).toISOString() : null,
    },
    skus,
  };
}
