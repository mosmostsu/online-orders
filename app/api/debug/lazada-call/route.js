// ยิง API ของ Lazada ตรงๆ พร้อมพารามิเตอร์ที่กำหนดเอง — ไว้ทดลองตอน endpoint ตอบแปลก (เช่น /products/get ServiceTimeout)
// โดยไม่ต้องแก้โค้ดแล้ว deploy ใหม่ทุกครั้งที่อยากลองค่าใหม่
//
//   /api/debug/lazada-call?key=SYNC_SECRET&path=/products/get&filter=all&limit=1
//   พารามิเตอร์อื่นนอกจาก key / path / shop ส่งต่อให้ Lazada ตามนั้น
//
// อ่านอย่างเดียว: ยอมแค่ path ที่เป็นการ "get" ข้อมูลเท่านั้น
import { NextResponse } from 'next/server';
import { call } from '@/lib/lazada';
import { listShops, usableToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

const READ_ONLY = /^\/(products?|orders?|finance|category|brands?|seller|logistic)[a-z0-9/_]*\/get$/i;

export async function GET(req) {
  const url = new URL(req.url);
  if (!process.env.SYNC_SECRET || url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const path = url.searchParams.get('path') || '';
  if (!READ_ONLY.test(path)) {
    return NextResponse.json({ ok: false, error: 'ยอมเฉพาะ path อ่านข้อมูลที่ลงท้ายด้วย /get' }, { status: 400 });
  }
  const shops = await listShops('lazada');
  const row = shops.find((s) => s.shop === (url.searchParams.get('shop') || s.shop));
  if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบร้าน' }, { status: 404 });

  const params = {};
  for (const [k, v] of url.searchParams) if (!['key', 'path', 'shop'].includes(k)) params[k] = v;

  const t0 = Date.now();
  try {
    const tok = await usableToken(row);
    const json = await call(path, { accessToken: tok.access_token, params });
    return NextResponse.json({ ok: true, ms: Date.now() - t0, path, params, response: json });
  } catch (e) {
    return NextResponse.json({ ok: false, ms: Date.now() - t0, path, params, error: String(e.message || e), payload: e.payload });
  }
}
