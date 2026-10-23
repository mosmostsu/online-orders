// เข้าสู่ระบบด้วยรหัสร้าน SITE_PIN (ด่านอยู่ที่ middleware.js) — ฟอร์มในหน้า /login ส่งมาที่นี่แล้วเด้งกลับหน้าที่จะไป
import crypto from 'crypto';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SITE_COOKIE = 'os_site';   // ตรงกับ middleware.js
const MAX_AGE = 365 * 86400;   // middleware ต่ออายุให้ทุกครั้งที่เปิดหน้า

// ค่าแฮชต้องตรงกับ siteToken() ใน middleware.js
const token = () => crypto.createHash('sha256').update(`site|${process.env.SITE_PIN}|${process.env.SYNC_SECRET || ''}`).digest('hex');

// ที่อยู่แบบสั้นเสมอ — เหตุผลเดียวกับ app/api/sales-pin/route.js
const go = (path) => new NextResponse(null, { status: 303, headers: { Location: path } });

export async function POST(req) {
  const form = await req.formData();
  const raw = String(form.get('next') || '/');
  const next = raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/login') ? raw : '/';

  if (form.get('action') === 'logout') {
    const res = go('/login');
    res.cookies.delete(SITE_COOKIE);
    return res;
  }

  const pin = process.env.SITE_PIN;
  const input = String(form.get('pin') || '');
  const a = Buffer.from(input), b = Buffer.from(pin || '');
  if (!pin || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    // ช้าลงนิดนึงตอนใส่ผิด กันเดารหัสรัวๆ
    await new Promise((r) => setTimeout(r, 1500));
    return go(`/login?wrong=1&next=${encodeURIComponent(next)}`);
  }

  const res = go(next);
  res.cookies.set(SITE_COOKIE, token(), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE });
  return res;
}
