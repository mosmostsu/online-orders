// สรุปรอบเย็น 17:30 — รวมสองเรื่องไว้ในข้อความเดียว
//   1. ใบที่ยกเลิกแล้วของยังอยู่ในกอง และยังไม่มีใครกดว่าเก็บออกแล้ว (ค้างสะสม ไม่ใช่เฉพาะวันนี้)
//   2. ใบที่แพ็คแล้วยังไม่ออกจากร้าน
//
// เดิมแยกเป็นสองรอบ (16:30 กับ 17:00) คนอ่านอันแรกแล้วลืมอันหลัง จึงรวมเป็นครั้งเดียว
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { pushText, dailySummaryMessage, onlyNotifyPlatforms } from '@/lib/line';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (process.env.SYNC_SECRET && new URL(req.url).searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1';

  try {
    const sb = db();
    const [riskyRes, packedRes] = await Promise.all([
      // ยกเลิกหลังกดส่ง ขนส่งยังไม่มารับ และยังไม่มีใครกดว่าเก็บของออกแล้ว
      onlyNotifyPlatforms(sb.from('os_orders')
        .select('order_id, platform, shop, is_express, cancelled_at, os_order_items(sku, qty)'))
        .eq('status', 'cancelled')
        .is('collected_at', null)
        .is('pulled_at', null)
        .not('rts_at', 'is', null)
        .order('cancelled_at', { ascending: false }),
      onlyNotifyPlatforms(sb.from('os_orders')
        .select('order_id, platform, shop, note, rts_at, is_express, carrier, os_order_items(sku, qty)'))
        .eq('status', 'packed')
        .order('rts_at', { ascending: true }),
    ]);
    if (riskyRes.error) throw new Error(riskyRes.error.message);
    if (packedRes.error) throw new Error(packedRes.error.message);

    const risky = riskyRes.data || [];
    const packed = packedRes.data || [];
    const text = dailySummaryMessage(risky, packed);
    if (!text) return NextResponse.json({ ok: true, risky: 0, packed: 0, skipped: 'ไม่มีอะไรค้าง' });
    if (dry) return NextResponse.json({ ok: true, dry: true, risky: risky.length, packed: packed.length, text });

    const line = await pushText(text);
    return NextResponse.json({ ok: true, risky: risky.length, packed: packed.length, line });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
