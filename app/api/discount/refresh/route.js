// ล้างที่จำไว้ของโปรส่วนลด (tag discounts) แล้วเด้งกลับ — ปุ่ม "ดึงโปรใหม่" ท้ายหน้า /discount/compare
// ดัชนีโปรของแต่ละร้านจำไว้ 10 นาที — ใช้ปุ่มนี้หลังแก้โปรในหลังร้าน/BigSeller แล้วอยากเห็นทันที
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  revalidateTag('discounts');
  const back = new URL(req.url).searchParams.get('back') || '/discount/compare';
  // เด้งกลับเฉพาะหน้า /discount (กัน open redirect)
  const to = back.startsWith('/discount') ? back : '/discount/compare';
  return NextResponse.redirect(new URL(to, req.url));
}
