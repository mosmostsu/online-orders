// โควต้าข้อความ LINE ที่เหลือเดือนนี้ — หน้าเว็บเรียกดูเองหลังหน้าโหลดเสร็จ
import { NextResponse } from 'next/server';
import { getQuota } from '@/lib/line';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json((await getQuota()) || { limit: null, used: null, left: null });
}
