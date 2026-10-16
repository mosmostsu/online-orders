// ด่านกลางของคำขอที่แก้ข้อมูล (POST/PUT/PATCH/DELETE) ใต้ /api — เว็บไม่มีระบบล็อกอิน ใครรู้ URL ก็ยิงได้
//
// แบ่ง 2 ระดับ (GET ไม่แตะ — รอบตั้งเวลาของ Netlify ยิง GET พร้อม ?key=SYNC_SECRET และ route เช็คเอง):
//   ระดับ 1 เขียนลงร้านจริง/ลบของ (โคลน, เปิดขาย, แก้โปร, ลบรายงาน, debug)
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

const PIN_COOKIE = 'os_sales_pin';   // ตรงกับ lib/pin.js (import ตรงไม่ได้ เพราะไฟล์นั้นใช้ node crypto + next/headers)
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const EXEMPT = [
  /^\/api\/webhook\//, /^\/api\/auth\//, /^\/api\/sales-pin\/?$/,
  /^\/api\/mvp\/(listings|report|stock)\/?$/, /^\/api\/thaimart\/(listings|price)\/?$/,
];

const needsPin = (path, method) =>
  /^\/api\/(clone|xclone|discount|debug)\//.test(path)
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

export async function middleware(req) {
  const method = req.method.toUpperCase();
  if (!WRITE.has(method)) return NextResponse.next();
  const path = req.nextUrl.pathname;
  if (EXEMPT.some((re) => re.test(path))) return NextResponse.next();

  const secret = process.env.SYNC_SECRET;
  const key = req.nextUrl.searchParams.get('key');
  if (secret && key && sameEq(key, secret)) return NextResponse.next();

  if (!fromOurPage(req)) return deny(403, 'คำขอไม่ได้มาจากหน้าเว็บนี้');
  if (needsPin(path, method)) {
    const t = await pinToken();
    const c = req.cookies.get(PIN_COOKIE)?.value || '';
    if (!t || !sameEq(c, t)) return deny(401, 'ต้องใส่รหัสปลดล็อกก่อน (ช่องรหัสที่หน้า /money หรือ /summary)');
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
