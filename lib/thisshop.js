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

// ThisShop เข้ารหัสแบบ form (Java URLEncoder): เว้นวรรคเป็น + และเข้ารหัสทุกตัวอักษรยกเว้น A-Z a-z 0-9 - _ . *
// encodeURIComponent ของ JS ปล่อย ! ' ( ) ~ ไว้ดิบ ต้องเข้ารหัสเพิ่ม ไม่งั้นลายเซ็นไม่ตรงทุกครั้งที่ข้อความมีวงเล็บ/!/'
// (เคยพัง "10018 the sign is error" ตอนสร้างสินค้าที่ชื่อ/คำอธิบายมี "(" — ทดสอบยืนยันกับ API จริง 2026-10-12)
// ⚠ "~" ฝั่งเขาจัดการไม่ได้ทุกแบบ (ดู scrubTilde ใน addGoods)
const formEncode = (s) => encodeURIComponent(s)
  .replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  .replace(/%20/g, '+');

function sign(params) {
  const key = process.env.THISSHOP_SIGN_KEY;
  const toStr = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
  const base = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== null && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${formEncode(toStr(params[k]))}`)
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

// ThisShop จำกัดความถี่ (QPS) — ถูกปฏิเสธด้วยรหัส 900305 ให้รอแล้วลองใหม่ ไม่ใช่ความผิดพลาดจริง
// (เคยโดนตอนเปิดขายหลายตัวติดกัน: ขอโทเคนใหม่ทุกตัว → "QPS has exceeded the limit" ล้มทั้งชุด)
const QPS_CODE = '900305';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withQps(fn, tries = 4) {
  for (let i = 0; ; i += 1) {
    const r = await fn();
    const s = r?.transactionStatus;
    if (!s || s.success || String(s.replyCode) !== QPS_CODE || i >= tries - 1) return r;
    await sleep(700 * 2 ** i);   // 0.7 → 1.4 → 2.8 วินาที
  }
}

// โทเคนมีอายุ 24 ชั่วโมงตามเอกสาร (ขอใหม่ได้ไม่จำกัด แต่ถูกจำกัดความถี่) — จำไว้ 10 นาทีต่อเครื่องเซิร์ฟเวอร์ ไม่ขอใหม่ทุกคำขอ
const TOKEN_TTL_MS = 10 * 60 * 1000;
let tokenCache = { token: null, at: 0 };

export async function getToken() {
  if (tokenCache.token && Date.now() - tokenCache.at < TOKEN_TTL_MS) return tokenCache.token;
  const d = await withQps(() => post(`${BASE}/api/oauth/access/token`, {
    appId: process.env.THISSHOP_APP_ID,
    appSecret: process.env.THISSHOP_APP_SECRET,
    timestamp: String(Date.now()),
  }));
  if (!d?.transactionStatus?.success) throw new Error('ขอโทเคน ThisShop ไม่สำเร็จ: ' + JSON.stringify(d).slice(0, 200));
  tokenCache = { token: d.token, at: Date.now() };
  return d.token;
}

export async function call(token, method, data, nonceSuffix = '001', timeoutMs = 60000) {
  // สร้างเวลา/nonce ใหม่ทุกครั้งที่ลองซ้ำ (nonce ต้องไม่ซ้ำ)
  const res = await withQps(() => {
    const ts = String(Date.now());
    const p = { appId: process.env.THISSHOP_APP_ID, token, timestamp: ts, nonce: ts + nonceSuffix, method, data };
    return post(`${BASE}/api/shop/router/rest`, { ...p, sign: sign(p) }, timeoutMs);
  });
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
// ช้าตาม "จำนวนตัวเลือก" ในหน้า ไม่ใช่จำนวนตะกร้า — ราว 0.03 วินาทีต่อตัวเลือก (วัดจริง ก.ย. 2569)
// หน้าละ 10 ตะกร้าบางหน้ามีเกือบ 800 ตัวเลือก ใช้ 26 วินาที ตัวดึงเลยค้างหน้าเดิมทุกรอบ
// หน้าละ 2 ตะกร้า ยิงพร้อมกัน 8 หน้า: ~130 ตะกร้าใน 17 วินาที หน้าที่ช้าสุด ~4 วินาที ไม่พลาดเลย
// ⚠️ เปลี่ยนค่านี้ = เลขหน้าใน os_listing_cursor ชี้คนละที่ ต้องรีเซ็ตตัวชี้ (ลบแถว thisshop ทิ้ง)
export const ITEM_PAGE_SIZE = 2;

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

// ── สร้างสินค้า (เอกสาร API ข้อ 4.8 / 4.11 / 4.12 / 4.28 + อัปโหลดรูป) ──────────────
// nonce ต้องไม่ซ้ำ — ยิงหลายรูปพร้อมกันใน ms เดียวกันได้ จึงต่อเลขสุ่มท้าย
const nonceTail = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

// หมวดลูกของ parentId ('0' = ยอดสุด) — queryType 2 = เฉพาะหมวดที่ร้านเราได้สิทธิ์ขาย
export async function categoryChildren(token, parentId = '0') {
  const r = await call(token, 'thisshop.goods.category.get', { parentId, queryType: '2' }, nonceTail());
  return (r.result?.dataList || []).map((c) => ({
    id: String(c.categoryId),
    name: c.txtNameLocal || c.txtNameEn || String(c.categoryId),
    leaf: c.bolTreeIsleaf === 'y',
  }));
}

// แบรนด์ที่ร้านใช้ได้ในหมวดระดับ 3 นั้น (จำกัดต่อหมวด)
export async function categoryBrands(token, categoryId) {
  const r = await call(token, 'thisshop.category.brand.get', { categoryId }, nonceTail());
  return (r.result || []).map((b) => ({
    id: String(b.brandId),
    name: b.nameEn || b.nameLocal || String(b.brandId),
    nameLocal: b.nameLocal || null,
  }));
}

// อัปโหลดรูป (form-data) — เซ็นเฉพาะ appId/timestamp/token/method/nonce ไม่รวมไฟล์กับ sign
// ได้ imageUrl (path ชั่วคราว ใช้ใส่ imageUrl/mediaList ตอนสร้างสินค้า) กับ url เต็มไว้ใช้ใน <img>
// รูปต้องไม่เกิน 800KB และกว้างยาวไม่เกิน 5000 พิกเซล
export async function uploadImage(token, bytes, filename, contentType = 'image/jpeg', timeoutMs = 30000) {
  let res = null;
  const d = await withQps(async () => {
    const ts = String(Date.now());
    const p = {
      appId: process.env.THISSHOP_APP_ID, timestamp: ts, token,
      method: 'thisshop.goods.image.upload', nonce: ts + nonceTail(),
    };
    const fd = new FormData();
    for (const [k, v] of Object.entries({ ...p, sign: sign(p) })) fd.append(k, v);
    fd.append('file', new Blob([bytes], { type: contentType }), filename);
    res = await fetch(`${BASE}/api/image/upload`, { method: 'POST', body: fd, signal: AbortSignal.timeout(timeoutMs) });
    return res.json().catch(() => null);
  });
  if (!d?.transactionStatus?.success) {
    throw new Error(`อัปโหลดรูปไม่สำเร็จ: ${d?.transactionStatus?.replyCode || ''} ${d?.transactionStatus?.replyText || res.status}`);
  }
  return { path: d.imageUrl, url: d.interviewImageUrl || null };
}

// สร้างสินค้า — คืน spuId
export async function addGoods(token, data) {
  // "~" ในข้อความทำให้ลายเซ็นไม่ผ่านทุกวิธีเข้ารหัส (ทดสอบแล้ว) — เปลี่ยนเป็น "-" (เช่น "1~2 ชิ้น" → "1-2 ชิ้น")
  const scrubTilde = JSON.parse(JSON.stringify(data).replace(/~/g, '-'));
  const r = await call(token, 'thisshop.goods.add', scrubTilde, nonceTail());
  const spuId = r.result?.spuId;
  if (!spuId) throw new Error('ThisShop ไม่ส่ง spuId กลับมา: ' + JSON.stringify(r).slice(0, 200));
  return String(spuId);
}

// รายละเอียดสินค้าที่สร้างแล้ว — ใช้ตรวจหลังสร้าง
export async function goodsDetails(token, spuId) {
  const r = await call(token, 'thisshop.goods.details', { spuId }, nonceTail());
  return r.result || null;
}

// ลบสินค้า (กรณีสร้างผิด) — ใช้เฉพาะตอนผู้ใช้สั่ง
export async function deleteGoods(token, spuIds) {
  return call(token, 'thisshop.goods.delete', { spuIds }, nonceTail());
}

// รหัส SKU → รูปที่ ThisShop รับ (ระบบเขาไม่รับจุดกับขีด) ย้อนกลับด้วย decodeSku
export const encodeSku = (s) => String(s || '').replace(/\./g, 'dott').replace(/-/g, 'sizee');
