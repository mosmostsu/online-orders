// ThisShop Open API — ขอโทเคน + เซ็นคำขอ + ดึงออเดอร์
//
// ต่างจาก TikTok/Shopee ตรงที่ขอโทเคนใหม่ได้ตลอดด้วย appId+appSecret ไม่มี refresh token
// จึงไม่ต้องแย่งโทเคนกับสคริปต์ Colab ที่ร้านใช้อยู่
//
// เซ็นคำขอ: MD5 ของ (พารามิเตอร์เรียงตามชื่อ ต่อกันแบบ k=urlencode(v) + signKey) แล้วทำเป็นตัวพิมพ์ใหญ่
import crypto from 'crypto';
import { isExpressShipping } from './shipping.js';

const BASE = process.env.THISSHOP_BASE || 'https://open.thisshop.com';

// เลขสถานะของ ThisShop — ตรวจจากข้อมูลจริงว่าแต่ละค่าจ่ายเงินแล้วหรือยัง ส่งของแล้วหรือยัง
//   1  ยังไม่จ่าย ไม่มีของส่ง        (3,488 ใบ ค้างสะสม)
//   2  ยังไม่จ่ายเหมือนกัน           (เคยเข้าใจผิดว่าคือรอจัดส่ง)
//   8  จ่ายแล้ว รอจัดส่ง             (ค่าที่สคริปต์ Colab ใช้ดึงของที่ต้องหยิบ)
//   16 ส่งออกไปแล้ว
//   32 จบแล้ว
//   0  ยกเลิก/หมดอายุ
export const TS_STATUS = {
  0: 'cancelled',
  1: 'unpaid',
  2: 'unpaid',
  4: 'to_ship',     // ยังไม่เคยเจอใบในขั้นนี้ เดาว่าอยู่ระหว่างเตรียมของ
  8: 'to_ship',
  16: 'shipped',
  32: 'done',
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

export async function call(token, method, data, nonceSuffix = '001', timeoutMs = 60000) {
  const ts = String(Date.now());
  const p = { appId: process.env.THISSHOP_APP_ID, token, timestamp: ts, nonce: ts + nonceSuffix, method, data };
  const res = await post(`${BASE}/api/shop/router/rest`, { ...p, sign: sign(p) }, timeoutMs);
  if (!res?.transactionStatus?.success) {
    throw new Error(`ThisShop ${method} ล้มเหลว: ${res?.transactionStatus?.replyCode} ${res?.transactionStatus?.replyText}`);
  }
  return res;
}

// ── ออเดอร์ ───────────────────────────────────────────────────────────
// ThisShop ไม่มี API ขอรายละเอียดเป็นชุด ต้องยิงทีละใบ
// กอง "ส่งถึงแล้ว" มีสองพันกว่าใบซึ่งเป็นงานที่จบไปแล้ว ดึงทั้งหมดทุกรอบไม่คุ้ม
// รอบปกติจึงเอา: รอส่ง+กำลังส่ง ทั้งหมด (มีไม่กี่ใบ) และส่งถึงแล้วเฉพาะล่าสุด
const ACTIVE = [4, 8, 16];   // รอจัดส่ง (สองค่า) และกำลังจัดส่ง
const DONE = 32;          // ส่งถึงแล้ว

export async function fetchOrders({ recentDone = 10, maxOrders = 40, concurrency = 8 } = {}) {
  const token = await getToken();
  const ids = [];

  for (const st of ACTIVE) {
    for (let page = 1; page <= 20; page++) {
      const r = await call(token, 'thisshop.order.list.get',
        { orderStatus: st, pageNum: page, pageSize: 100 }, String(page).padStart(4, '0'));
      const items = r.result || [];
      ids.push(...items.map((o) => o.orderId));
      if (items.length < 100) break;
    }
  }

  // กองที่จบแล้ว เอาแค่หน้าแรกพอ ไว้ให้เห็นว่ามีอะไรส่งออกไปบ้าง
  if (recentDone > 0) {
    const r = await call(token, 'thisshop.order.list.get',
      { orderStatus: DONE, pageNum: 1, pageSize: recentDone }, '9001');
    ids.push(...(r.result || []).map((o) => o.orderId));
  }

  const targets = ids.slice(0, maxOrders);
  const orders = [];

  // ยิงทีละใบแต่ทำพร้อมกันหลายตัว ไม่งั้นรอบเดียวใช้เวลาเป็นนาที
  for (let i = 0; i < targets.length; i += concurrency) {
    const chunk = targets.slice(i, i + concurrency);
    const got = await Promise.all(chunk.map((id, j) =>
      call(token, 'thisshop.order.detail.get', { orderId: id }, String(i + j).padStart(6, '0'))
        .then((d) => d.result)
        .catch((e) => { console.error('ThisShop ใบ', id, ':', e.message); return null; })
    ));
    orders.push(...got.filter(Boolean));
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
      is_express: isExpressShipping(ships.map((s) => s.expressCompanyId).join(' ')),
      raw: o,
      synced_at: new Date().toISOString(),
    },
    items,
  };
}

// ── รายการสินค้าทั้งร้าน (หน้า /product) ─────────────────────────────────
// thisshop.item.list.get ได้ครบในคำขอเดียว (ตะกร้า + ตัวเลือก + ราคา + คลัง) แต่ไม่มีรูป
// ช้ามากและไม่นิ่ง: หน้าละ 10 ตะกร้าใช้ 1-30 วินาที ขอหน้าละ 20 ขึ้นไปหมดเวลาเกือบทุกครั้ง
// (วัดจริง ก.ย. 2569 ทั้งร้าน ~1,250 ตะกร้า) จึงต้องทยอยดึงทีละหน้า — ดู app/api/sync/products
export const ITEM_PAGE_SIZE = 10;

export async function listItemsPage(token, pageNum, timeoutMs = 12000) {
  const r = await call(token, 'thisshop.item.list.get',
    { pageNum, pageSize: ITEM_PAGE_SIZE }, String(pageNum).padStart(5, '0'), timeoutMs);
  return { items: r.result || [], total: r.page?.count ?? null };
}

// bolStatus "1" = วางขายอยู่ (ค่าที่เห็นในข้อมูลจริง) ค่าอื่นยังไม่เคยเห็น เก็บแยกไว้ไม่เดา
const TS_SHELF = { 1: 'ONSHELF', 0: 'OFFSHELF' };

// marketPrice = ราคาตั้ง · itemPrice = ราคาขายจริง (ต่ำกว่า = ติดโปร)
export function normalizeListing(spu, shop = 'THISSHOP') {
  const key = { platform: 'thisshop', shop, product_id: String(spu.spuId) };
  const skus = (spu.itemList || []).map((it, i) => {
    const price = it.marketPrice ?? it.itemPrice ?? null;
    const cur = it.itemPrice ?? null;
    return {
      ...key,
      sku_id: String(it.skuId),
      seller_sku: decodeSku(it.qrcode) || null,
      variant: Object.values(it.specInfo || {}).filter(Boolean).join(' / ') || null,
      price,
      promo_price: cur !== null && price !== null && cur < price ? cur : null,
      stock: it.stockNum ?? null,
      image_url: null,
      sort: i,
    };
  });
  return {
    listing: {
      ...key,
      title: spu.spuTitle || null,
      thumb_url: null,
      status: TS_SHELF[spu.bolStatus] || `TS_${spu.bolStatus}`,
      item_sku: null,
      remote_updated_at: null,
      remote_created_at: null,
    },
    skus,
  };
}
