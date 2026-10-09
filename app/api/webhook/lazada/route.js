// Lazada ยิงมาบอกเองเมื่อออเดอร์เปลี่ยนสถานะ (Push Mechanism)
// ตั้ง Callback URL นี้ในคอนโซล Lazada: https://<โดเมน>/api/webhook/lazada
//
// พิสูจน์ว่ามาจาก Lazada จริง: HMAC-SHA256 ของ (app_key + เนื้อคำขอดิบ) ด้วย app_secret เทียบกับ header Authorization
// ตัว push ไม่ได้บรรจุสถานะที่เราเชื่อได้ — ใช้แค่รู้ว่าใบไหนเปลี่ยน แล้วไปถามสถานะจริงจาก API เอง
//
// ต้องตอบ 2xx เสมอ ไม่ว่าจะเกิดอะไรขึ้น (แพลตฟอร์มอาจปิดการส่งถ้าปลายทางตอบพลาดซ้ำๆ)
// ใบที่พลาดจะถูกรอบดึงทุก 30 นาทีตามเก็บให้เอง
import { NextResponse } from 'next/server';
import { fetchOrder, normalizeOrder, verifyPush } from '@/lib/lazada';
import { listShops, usableToken } from '@/lib/tokens';
import { upsertOrders } from '@/lib/ingest';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// message_type 0 = ออเดอร์เปลี่ยนสถานะ (ตัวอื่นเป็นคืนสินค้า/สินค้า/แชท ไม่เกี่ยวกับงานนี้)
const ORDER_STATUS_PUSH = 0;

export async function POST(req) {
  const raw = await req.text();

  let ev = {};
  try {
    ev = JSON.parse(raw || '{}');
  } catch {
    return NextResponse.json({ ok: true, note: 'อ่านเนื้อคำขอไม่ได้' });
  }

  // ตอนกดบันทึกในคอนโซล Lazada อาจยิง test push มาก่อน — ตอบ 200 ให้ผ่านการตรวจ
  if (ev.message_type !== ORDER_STATUS_PUSH) {
    return NextResponse.json({ ok: true, ignored: ev.message_type ?? 'test' });
  }

  let signed = false;
  try { signed = verifyPush(raw, req.headers.get('authorization')); } catch { /* ไม่มี app secret */ }
  if (!signed) return NextResponse.json({ ok: true, note: 'ลายเซ็นไม่ตรง — ข้ามไป' });

  const orderId = ev?.data?.trade_order_id;
  if (!orderId) return NextResponse.json({ ok: true, ignored: 'ข้อมูลไม่ครบ' });

  try {
    // seller_id ใน push อาจเป็นรหัสสั้น (THxxxx) หรือเลขผู้ขาย — ลองเทียบกับที่เก็บไว้ตอนผูกร้านทั้งสองแบบ
    const shops = await listShops('lazada');
    const sid = String(ev.seller_id || '');
    const shop = shops.find((r) => String(r.shop_id) === sid
      || (r.extra?.country_user_info || []).some((u) => u.short_code === sid || String(u.seller_id) === sid))
      || (shops.length === 1 ? shops[0] : null);
    if (!shop) return NextResponse.json({ ok: true, ignored: 'ไม่รู้จักร้านนี้: ' + sid });

    const tok = await usableToken(shop);
    const order = await fetchOrder({ accessToken: tok.access_token, orderId });
    if (order) {
      const records = [normalizeOrder(order, shop.shop)];
      // เวลาที่สถานะเปลี่ยนจริงอยู่ใน push (วินาที) แม่นกว่า updated_at ของออเดอร์
      const t = Number(ev.data.status_update_time || ev.timestamp);
      const evAt = t ? new Date((t < 1e12 ? t * 1000 : t)).toISOString() : null;
      if (evAt) {
        for (const r of records) {
          if (r.order.status === 'cancelled') r.order.cancelled_at = evAt;
          r.order.platform_updated_at = evAt;
        }
      }
      await upsertOrders(records);
      const { notifyRisky } = await import('@/app/api/notify/risky/route');
      const { notifyExpress } = await import('@/app/api/notify/express/route');
      try { await notifyRisky(); } catch (e) { console.error('แจ้งยกเลิกไม่สำเร็จ:', e.message); }
      try { await notifyExpress(); } catch (e) { console.error('แจ้งส่งด่วนไม่สำเร็จ:', e.message); }
    }
    return NextResponse.json({ ok: true, order_id: String(orderId) });
  } catch (e) {
    console.error('webhook lazada พลาด:', e.message);
    return NextResponse.json({ ok: true, error: String(e.message || e) });
  }
}

// ให้คอนโซลเช็คได้ว่า URL ใช้ได้ไหม
export async function GET() {
  return NextResponse.json({ ok: true, msg: 'พร้อมรับแจ้งเตือนจาก Lazada' });
}
