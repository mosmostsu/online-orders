// ออเดอร์ของร้าน Shopee ที่ไม่มี API (MVP, PACE) → os_orders / os_order_items ตารางเดียวกับร้านที่มี API
//
// ส่วนขยาย Chrome (extensions/mvp-stock 1.3+) อ่านหน้า "คำสั่งซื้อของฉัน" ของ Seller Center ทุก 10 นาที
// (และเมื่อหน้า /round ขอ) แล้วส่งเฉพาะใบที่ใหม่/สถานะเปลี่ยนมาที่นี่ — แปลงด้วย lib/mvpOrders.js
// ได้แล้วหน้ารอบจัดส่ง (/round) เห็นใบจัดของของร้านนี้ เช็คกับ R02.102 ได้ ไม่ตกไปเป็น "ของเกิน"
// และสูตรคลังของ /api/mvp/stock หักออเดอร์ของร้านนี้เองด้วย
import { NextResponse } from 'next/server';
import { upsertOrders } from '@/lib/ingest';
import { normalizeMvpOrder } from '@/lib/mvpOrders';
import { SHOPEE_NO_API } from '@/lib/shopGroups';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  const key = process.env.MVP_STOCK_KEY;
  if (!key || req.headers.get('x-key') !== key) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const shop = String(body.shop || '').toUpperCase();
  if (!SHOPEE_NO_API.includes(shop)) return NextResponse.json({ ok: false, error: `ไม่รู้จักร้าน ${shop}` }, { status: 400 });
  const list = Array.isArray(body.orders) ? body.orders : [];
  if (list.length > 2000) return NextResponse.json({ ok: false, error: 'ออเดอร์เยอะเกินในรอบเดียว' }, { status: 400 });

  const now = new Date();
  const records = list
    .filter((o) => /^[0-9A-Z]{8,20}$/.test(String(o?.order_sn || '')) && Array.isArray(o.items) && o.items.length)
    .map((o) => normalizeMvpOrder(o, shop, now));
  try {
    const r = await upsertOrders(records);
    return NextResponse.json({ ok: true, shop, received: list.length, saved: r.upserted, items: r.items || 0 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
