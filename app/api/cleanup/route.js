// ล้างข้อมูลเก่า — เผื่อกรณีที่ pg_cron ในฐานข้อมูลใช้ไม่ได้
// เรียกวันละครั้งก็พอ: /api/cleanup?key=SYNC_SECRET
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req) {
  if (process.env.SYNC_SECRET && new URL(req.url).searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  try {
    const { data, error } = await db().rpc('os_cleanup');
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, msg: data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
