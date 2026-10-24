// เชื่อมบัญชี Canva (OAuth + PKCE) ให้ปุ่ม "ตัดด้วย Canva" — lib/canva.js
// เปิด /api/auth/canva → ต้องปลดล็อกรหัสยอดขายก่อน (หน้า /auth/* ไม่ต้องล็อกอินเว็บ — กันคนนอกมาเชื่อมบัญชีตัวเองทับ)
//   → พาไปหน้าอนุญาตของ Canva → Canva เด้งกลับมาที่นี่พร้อม code → แลกโทเคนเก็บลง DB → กลับหน้าสินค้า
// Redirect URL ที่ต้องใส่ใน Integration ของ Canva: <เว็บ>/api/auth/canva (เช่น https://order-sync-solid.netlify.app/api/auth/canva)
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { salesUnlocked } from '@/lib/pin';
import { authorizeUrl, exchangeCode } from '@/lib/canva';

export const dynamic = 'force-dynamic';

const COOKIE = 'os_canva_pkce';
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const siteOf = (req) => process.env.URL || `https://${req.headers.get('x-forwarded-host') || req.headers.get('host')}`;

export async function GET(req) {
  const url = new URL(req.url);
  const site = siteOf(req);
  const redirectUri = `${site}/api/auth/canva`;
  const code = url.searchParams.get('code');
  const fail = (msg, status = 400) => new NextResponse(
    `<meta charset="utf-8"><p style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Inter','IBM Plex Sans Thai','Noto Sans Thai','Segoe UI',sans-serif">เชื่อม Canva ไม่สำเร็จ: ${String(msg).replace(/</g, '&lt;')}</p><p><a href="/product">← กลับหน้าสินค้า</a></p>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

  if (!code) {
    if (url.searchParams.get('error')) return fail(url.searchParams.get('error_description') || url.searchParams.get('error'));
    if (!(await salesUnlocked())) return fail('ต้องปลดล็อกรหัสยอดขายในเว็บก่อน (เปิดหน้าแก้ไขสินค้าแล้วใส่รหัส) แล้วกดเชื่อมใหม่', 401);
    if (!process.env.CANVA_CLIENT_ID) return fail('ยังไม่ได้ตั้ง CANVA_CLIENT_ID / CANVA_CLIENT_SECRET ใน Netlify');
    const verifier = b64url(crypto.randomBytes(48));
    const state = b64url(crypto.randomBytes(16));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const res = NextResponse.redirect(authorizeUrl({ redirectUri, state, challenge }));
    res.cookies.set(COOKIE, `${state}.${verifier}`, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth/canva', maxAge: 600 });
    return res;
  }

  const [state, verifier] = String(req.cookies.get(COOKIE)?.value || '').split('.');
  if (!state || state !== url.searchParams.get('state')) return fail('ลิงก์หมดอายุหรือไม่ได้เริ่มจากเว็บนี้ — กดเชื่อม Canva ใหม่');
  try {
    await exchangeCode({ code, verifier, redirectUri });
  } catch (e) { return fail(e.message, 500); }
  const res = NextResponse.redirect(`${site}/product?canva=ok`);
  res.cookies.delete({ name: COOKIE, path: '/api/auth/canva' });
  return res;
}
