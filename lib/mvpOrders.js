// ออเดอร์ของร้าน Shopee ที่ไม่มี API (MVP, PACE) → รูปแบบกลางของ lib/ingest.js (upsertOrders)
//
// ส่วนขยาย Chrome (extensions/mvp-stock) อ่านจากคำขอเบื้องหลังของหน้า "คำสั่งซื้อของฉัน" ใน Seller Center แล้วส่งมาที่
// POST /api/mvp/orders — ส่วนขยายส่งค่าตามที่ Seller Center ตอบ (เวลาเป็นวินาที) ตัวนี้แปลงให้เหมือนออเดอร์ Shopee ที่มี API
//
// ช่องที่ส่วนขยายส่งมา (ต่อออเดอร์):
//   order_sn · list = แท็บที่เจอ ('toship' ยังไม่กดส่ง · 'processed' กดจัดส่งแล้ว · 'shipping' · 'done' · 'cancelled')
//   status = order.status ของ Seller Center (4 สำเร็จ · 5 ยกเลิก)
//   create_time · arrange_time = เวลากดจัดส่ง (get_forder_logistics.ctime) · pickup_time = ขนส่งรับจริง (actual_pickup_time)
//   logistics_mtime · ship_by_date · total_price · carrier · items [{ item_id, model_id, sku, name, variant, qty, price, image }]
//
// เวลากดจัดส่งของร้านพวกนี้เป็นเวลาจริง (ไม่ใช่ "เวลาที่ขยับล่าสุด" แบบ Shopee API) — หน้ารอบใช้ตรงๆ (lib/rounds.js shipAt)
import { isExpressShipping } from './shipping.js';

const iso = (s) => (Number(s) > 0 ? new Date(Number(s) * 1000).toISOString() : null);
const IMG = 'https://cf.shopee.co.th/file/';

// แท็บ "ที่ต้องจัดส่ง" แยกเป็น ยังไม่จัดการ (toship) / จัดการแล้ว (processed) — เชื่อแท็บก่อนเวลา
// (ไม่รู้ว่าพัสดุบางแบบมีเวลา ctime ตั้งแต่ก่อนกดส่งไหม ใบที่ยังไม่กดส่งห้ามขึ้นเป็นแพ็คแล้ว)
export function mvpStatus(o) {
  if (Number(o.status) === 5 || o.list === 'cancelled') return 'cancelled';
  if (Number(o.status) === 4 || o.list === 'done') return 'done';
  if (o.list === 'shipping' || Number(o.pickup_time) > 0) return 'shipped';
  if (o.list === 'processed') return 'packed';
  if (o.list === 'toship') return 'to_ship';
  return Number(o.arrange_time) > 0 ? 'packed' : 'to_ship';
}

// now = เวลาที่ใช้แทนเมื่อไม่รู้เวลายกเลิก (ใส่ได้เพื่อทดสอบ)
export function normalizeMvpOrder(o, shop, now = new Date()) {
  const lines = new Map();
  for (const it of o.items || []) {
    const key = `${it.item_id || ''}|${it.model_id || ''}`;
    if (!lines.has(key)) {
      lines.set(key, {
        line_id: key,
        sku: String(it.sku || '').trim(),
        platform_sku_id: it.model_id ? String(it.model_id) : null,
        product_name: it.name || null,
        variant: it.variant || null,
        image_url: it.image ? IMG + it.image : null,
        qty: 0,
        price: Number(it.price) || 0,
        raw: null,   // Supabase ใกล้เต็ม ไม่เก็บก้อนดิบ
      });
    }
    lines.get(key).qty += Number(it.qty) || 1;
  }
  const items = [...lines.values()];
  const status = mvpStatus(o);
  const rts = status === 'to_ship' ? null : iso(o.arrange_time);
  const updated = iso(Math.max(Number(o.logistics_mtime) || 0, Number(o.arrange_time) || 0, Number(o.create_time) || 0));
  return {
    order: {
      platform: 'shopee',
      shop,
      order_id: String(o.order_sn),
      status,
      raw_status: `SC:${o.list || ''}:${o.status ?? ''}`,
      buyer: null,
      total: Number(o.total_price) || 0,
      currency: 'THB',
      ship_by: iso(o.ship_by_date),
      is_cod: null,
      item_count: items.reduce((s, i) => s + i.qty, 0),
      ordered_at: iso(o.create_time),
      platform_updated_at: updated,
      paid_at: null,
      rts_at: rts,
      collected_at: iso(o.pickup_time),
      // ไม่มีเวลายกเลิกในข้อมูล — ใช้เวลาพัสดุขยับล่าสุด ไม่มีก็เวลาที่เห็น (ส่วนขยายส่งใบที่ยกเลิกมาครั้งเดียวตอนเปลี่ยนสถานะ)
      cancelled_at: status === 'cancelled' ? (iso(o.logistics_mtime) || now.toISOString()) : null,
      cancel_reason: null,
      cancel_by: null,
      tracking_no: null,
      carrier: status === 'to_ship' ? null : (o.carrier || null),
      is_express: isExpressShipping(o.carrier, ''),
      raw: null,
      synced_at: now.toISOString(),
    },
    items,
  };
}
