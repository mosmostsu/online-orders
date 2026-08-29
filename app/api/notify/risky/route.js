// แจ้ง LINE เรื่องใบที่ยกเลิกทั้งที่ของถูกหยิบมาแพ็คแล้ว
// เรียกจาก webhook ทุกครั้งที่มีออเดอร์เปลี่ยน และจากรอบกวาดเป็นตัวสำรอง
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { pushText, riskyCancelMessage } from '@/lib/line';

export const dynamic = 'force-dynamic';

// ใช้ร่วมกับ webhook ได้โดยตรง ไม่ต้องยิง HTTP ซ้ำ
export async function notifyRisky() {
  const sb = db();
  const { data, error } = await sb
    .from('os_orders')
    .select('*, os_order_items(sku, qty)')
    .eq('status', 'cancelled')
    .is('collected_at', null)
    .is('notified_at', null)
    .not('rts_at', 'is', null)
    .order('cancelled_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  if (!data?.length) return { sent: 0 };

  const sent = [];
  for (const o of data) {
    // จองสิทธิ์ส่งก่อนค่อยส่งจริง — push อาจมาพร้อมกันหลายใบ แล้วเครื่องหลายตัวรับพร้อมกัน
    // ถ้าไปส่งก่อนแล้วค่อยบันทึก อีกเครื่องจะเห็นใบเดียวกันแล้วส่งซ้ำ
    // ตรงนี้ใครอัปเดตได้ก่อนคนนั้นได้สิทธิ์ ที่เหลือจะไม่ได้แถวกลับมาแล้วข้ามไป
    const { data: claimed } = await sb
      .from('os_orders')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', o.id)
      .is('notified_at', null)
      .select('id');
    if (!claimed?.length) continue;

    const res = await pushText(riskyCancelMessage(o, o.os_order_items));
    // ส่งไม่ผ่าน (เช่นโควต้าเดือนนั้นเต็ม) ให้คืนสถานะกลับ จะได้ลองใหม่รอบหน้า
    // ไม่งั้นใบนั้นจะถูกทำเครื่องหมายว่าแจ้งแล้วทั้งที่ไม่มีใครได้รับ
    if (!res.ok && !res.skipped) {
      await sb.from('os_orders').update({ notified_at: null }).eq('id', o.id);
      continue;
    }
    sent.push({ order_id: o.order_id, skipped: res.skipped || false });
  }
  return { sent: sent.length, orders: sent };
}

export async function GET(req) {
  if (process.env.SYNC_SECRET && new URL(req.url).searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await notifyRisky()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
