// ดูก้อนดิบที่ Finance API ตอบกลับมาสำหรับออเดอร์ใบเดียว
//
// มีไว้เพราะเอกสารของ TikTok ไม่ได้บอกชื่อฟิลด์ครบ และแต่ละประเทศก็หักคนละรายการ
// เปิดหน้านี้กับใบที่ปิดยอดแล้วหนึ่งใบ จะเห็นชื่อฟิลด์จริงทั้งหมด
// แล้วเอาไปเทียบกับตัวแปลงใน lib/tiktok.js (normalizeSettlement) ว่าจับครบไหม
//
//   /api/debug/settlement?key=SYNC_SECRET&order=576...
import { NextResponse } from 'next/server';
import { getOrderSettlement, normalizeSettlement } from '@/lib/tiktok';
import { listShops, usableToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  if (process.env.SYNC_SECRET && url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const orderId = url.searchParams.get('order');
  if (!orderId) return NextResponse.json({ ok: false, error: 'ใส่ ?order=เลขออเดอร์' }, { status: 400 });

  const shops = await listShops('tiktok');
  const row = shops.find((s) => s.shop === (url.searchParams.get('shop') || s.shop));
  if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบร้าน' }, { status: 404 });

  try {
    const tok = await usableToken(row);
    const raw = await getOrderSettlement({
      accessToken: tok.access_token, shopCipher: tok.shop_cipher, orderId,
    });
    return NextResponse.json({
      ok: true,
      shop: row.shop,
      // สิ่งที่ตัวแปลงของเราอ่านออก — ถ้าค่าไหนเป็น null แปลว่าชื่อฟิลด์ไม่ตรง ต้องไปแก้ตัวแปลง
      parsed: normalizeSettlement(raw, { orderRef: 0, shop: row.shop, orderId }),
      raw,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload || null }, { status: 200 });
  }
}
