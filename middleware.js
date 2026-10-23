// ด่านกลางของคำขอที่แก้ข้อมูล (POST/PUT/PATCH/DELETE) ใต้ /api — เว็บไม่มีระบบล็อกอิน ใครรู้ URL ก็ยิงได้
//
// แบ่ง 2 ระดับ (GET ไม่แตะ — รอบตั้งเวลาของ Netlify ยิง GET พร้อม ?key=SYNC_SECRET และ route เช็คเอง):
//   ระดับ 1 เขียนลงร้านจริง/ลบของ (โคลน, เปิดขาย, แก้โปร, เพิ่ม SKU, ลบรายงาน, debug)
//     → ต้องปลดล็อก SALES_PIN (คุกกี้เดียวกับหน้า /money ดู lib/pin.js) + มาจากหน้าเว็บเรา
//   ระดับ 2 ที่เหลือ (โน้ตออเดอร์, หยิบของออกจากกอง, ปุ่มดึงออเดอร์/สินค้า, รายงาน allsite)
//     → มาจากหน้าเว็บเราเท่านั้น (เช็ค Origin) ลูกน้องหน้าร้านใช้ได้โดยไม่ต้องรู้รหัสยอดขาย
//     กันเว็บอื่นยิงข้ามมาตอนเครื่องเราเปิดเว็บค้างไว้ — กันคนตั้งใจปลอม header ไม่ได้ (ของสำคัญอยู่ระดับ 1)
//   ?key=SYNC_SECRET ผ่านทั้งสองระดับ (สคริปต์/ทดสอบ)
//
// ยกเว้น (มีด่านของตัวเองแล้ว):
//   webhook/* (ลายเซ็นแพลตฟอร์ม) · auth/* (OAuth) · sales-pin (ฟอร์มใส่รหัสเอง)
//   mvp/listings, mvp/report, mvp/stock, thaimart/listings, thaimart/price — ส่วนขยาย Chrome ส่ง header x-key = MVP_STOCK_KEY
//
// mvp/clone-shopee, thaimart/clone แค่เตรียมก้อนข้อมูลให้ส่วนขยาย (ไม่เขียนลงร้าน) ส่วนขยายยิงจาก background
// Origin เป็น chrome-extension:// → ระดับ 2 ยอมรับ Origin แบบนี้ด้วย
//
// รันบน edge — ใช้ Web Crypto แทน node crypto (ค่าแฮชต้องตรงกับ pinToken() ใน lib/pin.js)
import { NextResponse } from 'next/server';
import { SITE_COOKIE, PUBLIC, siteToken, sameStr } from '@/lib/siteGate';

const PIN_COOKIE = 'os_sales_pin';   // ตรงกับ lib/pin.js (import ตรงไม่ได้ เพราะไฟล์นั้นใช้ node crypto + next/headers)
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const EXEMPT = [
  /^\/api\/webhook\//, /^\/api\/auth\//, /^\/api\/sales-pin\/?$/,
  /^\/api\/mvp\/(listings|report|stock)\/?$/, /^\/api\/thaimart\/(listings|price)\/?$/,
];

const needsPin = (path, method) =>
  /^\/api\/(clone|xclone|discount|basket|debug)\//.test(path)
  || (method === 'DELETE' && /^\/api\/allsite\/reports\//.test(path));

function sameEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function pinToken() {
  const pin = process.env.SALES_PIN;
  if (!pin) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${pin}|${process.env.SYNC_SECRET || ''}`));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function fromOurPage(req) {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  if (origin.startsWith('chrome-extension://')) return true;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  try { return new URL(origin).host === host; } catch { return false; }
}

const deny = (status, error) =>
  NextResponse.json({ ok: false, error }, { status, headers: { 'x-guard': 'middleware' } });

// บอทเก็บข้อมูล (เช่น meta-externalagent) เคยไล่ยิงหน้า /video /compare หลายหมื่นครั้ง จนฐานข้อมูลอืดทั้งเว็บ
// ตัดทิ้งตั้งแต่ด่านนี้ ไม่ให้ไปถึงฐานข้อมูล — webhook ไม่โดน เพราะแพลตฟอร์มไม่ได้ใช้ชื่อพวกนี้
const BOT = /meta-externalagent|facebookexternalhit|GPTBot|ClaudeBot|CCBot|Bytespider|PetalBot|AhrefsBot|SemrushBot|DotBot|bingbot|Googlebot|Amazonbot|PerplexityBot|crawler|spider/i;

export async function middleware(req) {
  const path = req.nextUrl.pathname;
  if (path !== '/robots.txt' && BOT.test(req.headers.get('user-agent') || '')) {
    return new NextResponse('Forbidden', { status: 403, headers: { 'x-guard': 'bot' } });
  }
  const method = req.method.toUpperCase();
  const secret = process.env.SYNC_SECRET;
  const key = req.nextUrl.searchParams.get('key') || req.headers.get('x-sync-key');
  const hasKey = Boolean(secret && key && sameEq(key, secret));

  // ด่าน 0: รหัสเข้าเว็บ (lib/siteGate.js) — ยังไม่ตั้ง SITE_PASSWORD = ข้ามด่านนี้
  // ผ่านได้ถ้า: หน้าสาธารณะ · มี SYNC_SECRET (รอบตั้งเวลา) · ส่วนขยาย Chrome (x-key / Origin chrome-extension://
  // — route พวกนั้นเช็คกุญแจของตัวเองต่อ) · มีคุกกี้ที่ได้จากหน้า /login
  const gate = await siteToken();
  if (gate && !hasKey && !PUBLIC.some((re) => re.test(path))
      && !req.headers.get('x-key')
      && !(req.headers.get('origin') || '').startsWith('chrome-extension://')
      && !sameStr(req.cookies.get(SITE_COOKIE)?.value || '', gate)) {
    if (path.startsWith('/api/')) return deny(401, 'ต้องเข้าสู่ระบบก่อน');
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?back=${encodeURIComponent(path + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  if (!WRITE.has(method) || !path.startsWith('/api/')) return NextResponse.next();
  if (EXEMPT.some((re) => re.test(path))) return NextResponse.next();
  if (hasKey) return NextResponse.next();

  if (!fromOurPage(req)) return deny(403, 'คำขอไม่ได้มาจากหน้าเว็บนี้');
  if (needsPin(path, method)) {
    const t = await pinToken();
    const c = req.cookies.get(PIN_COOKIE)?.value || '';
    if (!t || !sameEq(c, t)) return deny(401, 'ต้องใส่รหัสปลดล็อกก่อน (ช่องรหัสที่หน้า /money หรือ /summary)');
  }
  return NextResponse.next();
}

// ทุกหน้า (ยกเว้นไฟล์ static ของ Next) — เพื่อให้ด่านกันบอทครอบหน้าเว็บด้วย ไม่ใช่แค่ /api
export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico).*)' };
