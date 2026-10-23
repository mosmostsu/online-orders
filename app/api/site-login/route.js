// ใส่รหัสเข้าเว็บ (ดู lib/siteGate.js) — ฟอร์มหน้า /login ส่งมาที่นี่
import { NextResponse } from 'next/server';
import { SITE_COOKIE, SITE_MAX_AGE, siteToken, sameStr } from '@/lib/siteGate';

export const dynamic = 'force-dynamic';

// เด้งกลับแบบที่อยู่สั้น — เหตุผลเดียวกับ /api/sales-pin (โดเมน deploy ของ Netlify)
const back303 = (path) => new NextResponse(null, { status: 303, headers: { Location: path } });
const safeBack = (raw) => (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/login') ? raw : '/orders');

export async function POST(req) {
  const form = await req.formData();
  const back = safeBack(String(form.get('back') || '/orders'));

  if (form.get('action') === 'logout') {
    const res = back303('/login');
    res.cookies.delete(SITE_COOKIE);
    return res;
  }

  const pw = process.env.SITE_PASSWORD || '';
  if (!pw || !sameStr(String(form.get('password') || ''), pw)) {
    // ช้าลงตอนใส่ผิด กันเดารหัสรัวๆ
    await new Promise((r) => setTimeout(r, 1500));
    return back303(`/login?wrong=1&back=${encodeURIComponent(back)}`);
  }

  const res = back303(back);
  res.cookies.set(SITE_COOKIE, await siteToken(), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SITE_MAX_AGE,
  });
  return res;
}
