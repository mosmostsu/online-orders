// แจ้ง LINE เมื่อมีออเดอร์ส่งด่วนเข้ามาใหม่และยังไม่ได้จัดส่ง
// ช้อปปี้บังคับแพ็คภายใน 2 ชั่วโมงสำหรับ "ส่งทันที" ถ้าไม่เห็นตอนเข้ามาก็เลยกำหนด
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { pushText, newExpressMessage } from '@/lib/line';

export const dynamic = 'force-dynamic';

export async function notifyExpress() {
  const sb = db();
  const { data, error } = await sb
    .from('os_orders')
    .select('*, os_order_items(sku, qty, product_name)')
    .eq('is_express', true)
    .eq('status', 'to_ship')          // รอจัดส่ง = ยังไม่ได้แพ็ค ต้องรีบ
    .is('express_notified_at', null)
    .order('ordered_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  if (!data?.length) return { sent: 0 };

  const sent = [];
  for (const o of data) {
    // จองสิทธิ์ส่งก่อน กันสองเครื่องส่งใบเดียวกันตอน push มาพร้อมกัน
    const { data: claimed } = await sb
      .from('os_orders')
      .update({ express_notified_at: new Date().toISOString() })
      .eq('id', o.id)
      .is('express_notified_at', null)
      .select('id');
    if (!claimed?.length) continue;

    const res = await pushText(newExpressMessage(o, o.os_order_items));
    sent.push({ order_id: o.order_id, skipped: res.skipped || false });
  }
  return { sent: sent.length, orders: sent };
}

export async function GET(req) {
  if (process.env.SYNC_SECRET && new URL(req.url).searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await notifyExpress()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
