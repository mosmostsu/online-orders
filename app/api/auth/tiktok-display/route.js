// เชื่อมช่อง TikTok (Display API) — เจ้าของบัญชีกดอนุญาตครั้งเดียว แล้วระบบดึงคลิปเองทุก 12 ชม.
//
// เริ่ม:  เปิด /api/auth/tiktok-display  → กรอก SYNC_SECRET ในช่อง (ไม่ต้องพิมพ์ใน URL) แล้วเลือกช่อง
//         (ยังรองรับ ?account=solid&key=… แบบเดิม)
// TikTok เด้งกลับมาที่ path เดียวกันพร้อม ?code=… (ต้องตรงกับ Redirect URI ที่ลงทะเบียนในแอป)
// กันคนนอกเริ่มเอง: ขั้นเริ่มต้องมี key และ state ต้องตรงกับคุกกี้ที่ตั้งไว้ตอนเริ่ม
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { ACCOUNTS, authorizeUrl, exchangeCode, saveAccountToken } from '@/lib/tiktok-display';

export const dynamic = 'force-dynamic';

const COOKIE = 'os_ttd_state';

const html = (body, status = 200) =>
  new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<body style="font-family:sans-serif;max-width:560px;margin:40px auto;padding:0 16px">${body}` +
    `<p><a href="/video">ไปหน้าวิดีโอ</a></p></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
const page = (msg, status = 200) => html(`<p>${msg}</p>`, status);

const form = (msg = '') => html(
  `<h3>เชื่อมช่อง TikTok</h3>${msg ? `<p style="color:#b91c1c">${msg}</p>` : ''}` +
  `<form method="post" style="display:grid;gap:10px">` +
  `<label>ช่อง <select name="account"><option value="solid">solid_sports_</option><option value="meta">meta_sports_</option></select></label>` +
  `<label>SYNC_SECRET <input name="key" type="password" autocomplete="off" style="width:100%"></label>` +
  `<button type="submit">ไปหน้าอนุญาตของ TikTok</button></form>`,
  msg ? 401 : 200,
);

const same = (a, b) => {
  const x = Buffer.from(String(a || '').trim()), y = Buffer.from(String(b || '').trim());
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ตรวจ key แล้วพาไปหน้าอนุญาตของ TikTok
function start(account, key) {
  const secret = process.env.SYNC_SECRET;
  if (secret && !same(key, secret)) return form('key ไม่ถูกต้อง — ใช้ค่า SYNC_SECRET ที่ตั้งใน Netlify');
  if (!ACCOUNTS[account]) return page('ต้องเลือกช่อง solid หรือ meta', 400);
  try {
    const nonce = crypto.randomBytes(16).toString('hex');
    const res = NextResponse.redirect(authorizeUrl(`${account}.${nonce}`));
    res.cookies.set(COOKIE, nonce, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth', maxAge: 900 });
    return res;
  } catch (e) {
    return page(String(e.message || e), 500);
  }
}

export async function POST(req) {
  const f = await req.formData();
  return start(String(f.get('account') || ''), String(f.get('key') || ''));
}

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');

  if (err) return page(`TikTok ไม่ได้อนุญาต: ${url.searchParams.get('error_description') || err}`, 400);

  // เริ่มเชื่อม: มี key มากับลิงก์ → ไปต่อเลย ไม่มี → แสดงฟอร์มให้กรอก
  if (!code) {
    const key = url.searchParams.get('key');
    return key === null ? form() : start(url.searchParams.get('account'), key);
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
