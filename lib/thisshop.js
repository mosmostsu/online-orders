// ThisShop Open API — ขอโทเคน + เซ็นคำขอ + ดึงออเดอร์
//
// ต่างจาก TikTok/Shopee ตรงที่ขอโทเคนใหม่ได้ตลอดด้วย appId+appSecret ไม่มี refresh token
// จึงไม่ต้องแย่งโทเคนกับสคริปต์ Colab ที่ร้านใช้อยู่
//
// เซ็นคำขอ: MD5 ของ (พารามิเตอร์เรียงตามชื่อ ต่อกันแบบ k=urlencode(v) + signKey) แล้วทำเป็นตัวพิมพ์ใหญ่
import crypto from 'crypto';

const BASE = process.env.THISSHOP_BASE || 'https://open.thisshop.com';

// เลขสถานะของ ThisShop (สำรวจจากข้อมูลจริง ไม่ได้อยู่ในเอกสารที่เข้าถึงได้)
export const TS_STATUS = {
  0: 'cancelled',   // ยกเลิก/หมดอายุ
  1: 'unpaid',      // รอชำระเงิน
  2: 'to_ship',     // จ่ายแล้ว รอจัดส่ง
  16: 'shipped',    // กำลังจัดส่ง
  32: 'done',       // ส่งถึงแล้ว
};

function sign(params) {
  const key = process.env.THISSHOP_SIGN_KEY;
  const toStr = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
  const base = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== null && params[k] !== undefined && params[k] !== '')
    .sort()
    // ThisShop ใช้ urlencode แบบ form (เว้นวรรคเป็น +) ไม่ใช่ %20
    .map((k) => `${k}=${encodeURIComponent(toStr(params[k])).replace(/%20/g, '+')}`)
    .join('');
  return crypto.createHash('md5').update(base + key).digest('hex').toUpperCase();
}

async function post(url, body, timeoutMs = 30000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

// โทเคนอยู่ได้ไม่นาน แต่ขอใหม่ได้เรื่อยๆ จึงขอสดทุกครั้งที่เริ่มรอบดึง
export async function getToken() {
  const d = await post(`${BASE}/api/oauth/access/token`, {
    appId: process.env.THISSHOP_APP_ID,
    appSecret: process.env.THISSHOP_APP_SECRET,
    timestamp: String(Date.now()),
  });
  if (!d?.transactionStatus?.success) throw new Error('ขอโทเคน ThisShop ไม่สำเร็จ: ' + JSON.stringify(d).slice(0, 200));
  return d.token;
}

export async function call(token, method, data, nonceSuffix = '001') {
  const ts = String(Date.now());
  const p = { appId: process.env.THISSHOP_APP_ID, token, timestamp: ts, nonce: ts + nonceSuffix, method, data };
  const res = await post(`${BASE}/api/shop/router/rest`, { ...p, sign: sign(p) }, 60000);
  if (!res?.transactionStatus?.success) {
    throw new Error(`ThisShop ${method} ล้มเหลว: ${res?.transactionStatus?.replyCode} ${res?.transactionStatus?.replyText}`);
  }
  return res;
}

// ── ออเดอร์ ───────────────────────────────────────────────────────────
// เอาเฉพาะกองที่ร้านสนใจ: รอจัดส่ง กับ ส่งแล้ว (ไม่เอาใบที่ยังไม่จ่าย ซึ่งค้างสะสมหลายพันใบ)
const WANTED = [2, 16, 32];

export async function fetchOrders({ statuses = WANTED, maxPages = 20 } = {}) {
  const token = await getToken();
  const ids = [];

  for (const st of statuses) {
    for (let page = 1; page <= maxPages; page++) {
      const r = await call(token, 'thisshop.order.list.get',
        { orderStatus: st, pageNum: page, pageSize: 100 }, String(page).padStart(4, '0'));
      const items = r.result || [];
      ids.push(...items.map((o) => o.orderId));
      const total = r.page?.count;
      if (items.length < 100 || (total != null && ids.length >= total)) break;
    }
  }

  // รายละเอียดต้องดึงทีละใบ (ไม่มี API แบบขอเป็นชุด)
  const orders = [];
  for (let i = 0; i < ids.length; i++) {
    try {
      const d = await call(token, 'thisshop.order.detail.get', { orderId: ids[i] }, String(i).padStart(6, '0'));
      if (d.result) orders.push(d.result);
    } catch (e) {
      console.error('ThisShop ดึงใบ', ids[i], 'ไม่ได้:', e.message);
    }
  }
  return orders;
}

// ── แปลงเป็นรูปแบบกลาง ────────────────────────────────────────────────
// SKU ถูกเข้ารหัสไว้ใน qrcode เพราะระบบไม่รับจุดกับขีด
const decodeSku = (q) => (q || '').replace(/dott/g, '.').replace(/sizee/g, '-');

// เวลาที่ส่งมาเป็นข้อความเวลาไทย ไม่มีโซนกำกับ ต้องเติมเอง
const toIso = (s) => (s ? new Date(String(s).replace(' ', 'T') + '+07:00').toISOString() : null);

export function normalizeOrder(o, shop = 'THISSHOP') {
  const items = (o.itemList || []).map((it, i) => ({
    line_id: it.orderItemId || `${it.skuId}|${i}`,
    sku: decodeSku(it.qrcode),
    platform_sku_id: it.skuId ? String(it.skuId) : null,
    product_name: it.skuName || null,
    variant: null,
    image_url: it.imageUrl || it.picUrl || null,
    qty: Math.round(Number(it.quantity) || 1),
    price: Number(it.itemPrice || 0),
    raw: it,
  }));

  // เวลาที่ของออกจากร้าน อยู่ในรายการจัดส่ง
  const ships = o.shipList || [];
  const shippedAt = ships.map((s) => toIso(s.deliveryTime)).filter(Boolean).sort()[0] || null;
  const status = TS_STATUS[o.orderStatus] || 'unknown';

  return {
    order: {
      platform: 'thisshop',
      shop,
      order_id: String(o.orderId),
      status,
      raw_status: String(o.orderStatus),
      buyer: o.addressInfo?.receiverName || null,
      total: Number(o.paymentAmount ?? o.orderTotalAmount ?? 0),
      currency: 'THB',
      item_count: items.reduce((s, i) => s + i.qty, 0),
      ordered_at: toIso(o.submitTime),
      platform_updated_at: toIso(o.updateTime),
      paid_at: toIso(o.payTime),
      // ThisShop ไม่แยก "กดส่ง" กับ "ขนส่งรับ" มีแค่เวลาเดียวคือตอนออกของ
      rts_at: shippedAt,
      collected_at: shippedAt,
      cancelled_at: status === 'cancelled' ? toIso(o.updateTime) : null,
      tracking_no: ships.map((s) => s.expressNo).filter(Boolean).join(', ') || null,
      carrier: ships.map((s) => s.expressCompanyId).filter(Boolean)[0] || null,
      raw: o,
      synced_at: new Date().toISOString(),
    },
    items,
  };
}
