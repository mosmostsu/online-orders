// เชื่อมช่อง TikTok (Display API) — เจ้าของบัญชีกดอนุญาตครั้งเดียว แล้วระบบดึงคลิปเองทุก 12 ชม.
//
// เริ่ม:  /api/auth/tiktok-display?account=solid&key=SYNC_SECRET   (หรือ account=meta)
// TikTok เด้งกลับมาที่ path เดียวกันพร้อม ?code=… (ต้องตรงกับ Redirect URI ที่ลงทะเบียนในแอป)
// กันคนนอกเริ่มเอง: ขั้นเริ่มต้องมี key และ state ต้องตรงกับคุกกี้ที่ตั้งไว้ตอนเริ่ม
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { ACCOUNTS, authorizeUrl, exchangeCode, saveAccountToken } from '@/lib/tiktok-display';

export const dynamic = 'force-dynamic';

const COOKIE = 'os_ttd_state';

const page = (msg, status = 200) =>
  new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<body style="font-family:sans-serif;max-width:560px;margin:40px auto;padding:0 16px"><p>${msg}</p>` +
    `<p><a href="/video">ไปหน้าวิดีโอ</a></p></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');

  if (err) return page(`TikTok ไม่ได้อนุญาต: ${url.searchParams.get('error_description') || err}`, 400);

  // เริ่มเชื่อม → พาไปหน้าอนุญาตของ TikTok
  if (!code) {
    const secret = process.env.SYNC_SECRET;
    if (secret && url.searchParams.get('key') !== secret) return page('key ไม่ถูกต้อง', 401);
    const account = url.searchParams.get('account');
    if (!ACCOUNTS[account]) return page('ต้องระบุ ?account=solid หรือ ?account=meta', 400);
    try {
      const nonce = crypto.randomBytes(16).toString('hex');
      const res = NextResponse.redirect(authorizeUrl(`${account}.${nonce}`));
      res.cookies.set(COOKIE, nonce, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth', maxAge: 900 });
      return res;
    } catch (e) {
      return page(String(e.message || e), 500);
    }
  }

  // กลับมาพร้อม code → ตรวจ state แล้วแลกโทเคน
  const [account, nonce] = String(url.searchParams.get('state') || '').split('.');
  const mine = req.cookies.get(COOKIE)?.value || '';
  const ok = ACCOUNTS[account] && nonce && mine.length === nonce.length &&
    crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(nonce));
  if (!ok) return page('state ไม่ตรง — เริ่มเชื่อมใหม่จากลิงก์เดิม', 400);

  try {
    const t = await exchangeCode(code);
    await saveAccountToken(account, t);
    const res = page(`เชื่อมช่อง @${ACCOUNTS[account]} สำเร็จ — ระบบจะดึงคลิปให้เองทุก 12 ชั่วโมง`);
    res.cookies.delete(COOKIE);
    return res;
  } catch (e) {
    return page(String(e.message || e), 500);
  }
}
