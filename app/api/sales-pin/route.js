// ปลดล็อก/ล็อกตัวเลขยอดขาย (ดู lib/pin.js) — ฟอร์มในหน้า /summary ส่งมาที่นี่แล้วเด้งกลับหน้าเดิม
import { NextResponse } from 'next/server';
import { PIN_COOKIE, PIN_MAX_AGE, pinMatches, pinToken } from '@/lib/pin';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const form = await req.formData();
  // กลับหน้าเดิมได้เฉพาะลิงก์ในเว็บนี้ — กันถูกใช้เป็นทางเด้งไปเว็บอื่น
  const back = String(form.get('back') || '/summary');
  const to = new URL(back.startsWith('/') && !back.startsWith('//') ? back : '/summary', req.url);

  if (form.get('action') === 'lock') {
    const res = NextResponse.redirect(to, 303);
    res.cookies.delete(PIN_COOKIE);
    return res;
  }

  if (!pinMatches(String(form.get('pin') || ''))) {
    // ช้าลงนิดนึงตอนใส่ผิด กันเดารหัสรัวๆ
    await new Promise((r) => setTimeout(r, 1500));
    to.searchParams.set('pin', 'wrong');
    return NextResponse.redirect(to, 303);
  }

  to.searchParams.delete('pin');
  const res = NextResponse.redirect(to, 303);
  res.cookies.set(PIN_COOKIE, pinToken(), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: PIN_MAX_AGE,
  });
  return res;
}
