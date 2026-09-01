// สรุปใบที่แพ็คไว้แล้วแต่ยังไม่ออกจากร้าน — ยิงตอน 17:00 รอบเดียว หลังรถออกไปแล้ว
// ใบที่ยังค้างตอนนั้นคือใบที่มีปัญหาจริง (ของหมด / ขนส่งลืมยิง)
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { pushText, packedSummaryMessage } from '@/lib/line';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (process.env.SYNC_SECRET && new URL(req.url).searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  try {
    const { data, error } = await db()
      .from('os_orders')
      .select('order_id, shop, note, rts_at, is_express, carrier, os_order_items(sku, qty)')
      .eq('status', 'packed')
      .order('rts_at', { ascending: true });
    if (error) throw new Error(error.message);

    const rows = data || [];
    // ไม่มีใบค้าง = ไม่ต้องส่งอะไรเลย จะได้ไม่รบกวนทุกเย็น
    if (!rows.length) return NextResponse.json({ ok: true, count: 0, skipped: 'ไม่มีใบค้าง' });

    const res = await pushText(packedSummaryMessage(rows));
    return NextResponse.json({ ok: true, count: rows.length, line: res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
