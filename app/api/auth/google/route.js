// เชื่อม Google Drive ให้หน้า /shoot อัปฟุตได้ (OAuth ของบัญชีเจ้าของ Drive) — lib/gdrive.js
// เปิด /api/auth/google → ต้องปลดล็อกรหัสยอดขายก่อน (หน้า /auth/* ไม่ต้องล็อกอินเว็บ — กันคนนอกมาเชื่อมบัญชีตัวเองทับ)
//   → หน้าอนุญาตของ Google → เด้งกลับมาที่นี่พร้อม code → เก็บ refresh token + สร้างโฟลเดอร์ "ฟุตเทจจาก Studio" → กลับหน้า Studio
// Authorized redirect URI ที่ต้องใส่ใน OAuth client: <เว็บ>/api/auth/google (เช่น https://order-sync-solid.netlify.app/api/auth/google)
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { salesUnlocked } from '@/lib/pin';
import { authorizeUrl, exchangeCode, driveConfigured } from '@/lib/gdrive';

export const dynamic = 'force-dynamic';

const COOKIE = 'os_google_state';
const siteOf = (req) => process.env.URL || `https://${req.headers.get('x-forwarded-host') || req.headers.get('host')}`;

export async function GET(req) {
  const url = new URL(req.url);
  const site = siteOf(req);
  const redirectUri = `${site}/api/auth/google`;
  const code = url.searchParams.get('code');
  const fail = (msg, status = 400) => new NextResponse(
    `<meta charset="utf-8"><p style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Inter','IBM Plex Sans Thai','Noto Sans Thai','Segoe UI',sans-serif">เชื่อม Google Drive ไม่สำเร็จ: ${String(msg).replace(/</g, '&lt;')}</p><p><a href="/studio#shoot">← กลับหน้า Studio</a></p>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

  if (!code) {
    if (url.searchParams.get('error')) return fail(url.searchParams.get('error'));
    if (!(await salesUnlocked())) return fail('ต้องปลดล็อกรหัสยอดขายในเว็บก่อน (เปิดหน้า Studio แล้วใส่รหัส) แล้วกดเชื่อมใหม่', 401);
    if (!driveConfigured()) return fail('ยังไม่ได้ตั้ง GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET ใน Netlify');
    const state = crypto.randomBytes(16).toString('hex');
    const res = NextResponse.redirect(authorizeUrl({ redirectUri, state }));
    res.cookies.set(COOKIE, state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth/google', maxAge: 600 });
    return res;
  }

  const state = String(req.cookies.get(COOKIE)?.value || '');
  if (!state || state !== url.searchParams.get('state')) return fail('ลิงก์หมดอายุหรือไม่ได้เริ่มจากเว็บนี้ — กดเชื่อม Google Drive ใหม่');
  // ขากลับก็ต้องปลดล็อกอยู่ — คุกกี้ state อย่างเดียวไม่พอให้คนอื่นเชื่อมบัญชีทับ
  if (!(await salesUnlocked())) return fail('ต้องปลดล็อกรหัสยอดขายก่อน', 401);
  try {
    await exchangeCode({ code, redirectUri });
  } catch (e) { return fail(e.message, 500); }
  const res = NextResponse.redirect(`${site}/studio?drive=ok#shoot`);
  res.cookies.delete({ name: COOKIE, path: '/api/auth/google' });
  return res;
}
