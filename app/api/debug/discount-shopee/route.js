// ส่องก้อนดิบของโปรส่วนลด Shopee — ตรวจชื่อฟิลด์ก่อนเชื่อหน้า /discount (อ่านอย่างเดียว ไม่แก้อะไรในร้าน)
//
//   /api/debug/discount-shopee?key=SYNC_SECRET&shop=SOLID                      → รายการโปร ongoing (ดิบ)
//   /api/debug/discount-shopee?key=SYNC_SECRET&shop=SOLID&status=all           → ทุกสถานะ
//   /api/debug/discount-shopee?key=SYNC_SECRET&shop=SOLID&id=<discount_id>     → สินค้าในโปร (ดิบ + แตกรายตัวเลือก)
import { NextResponse } from 'next/server';
import { call, discountRows } from '@/lib/shopee';
import { listShops, readOnlyToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  // ส่งข้อมูลดิบของร้านออกไป — บังคับต้องมี key เสมอ (ไม่ตั้ง SYNC_SECRET = ปิดหน้านี้)
  if (!process.env.SYNC_SECRET || url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const shops = await listShops('shopee');
  const row = shops.find((s) => s.shop === (url.searchParams.get('shop') || s.shop));
  if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบร้าน', shops: shops.map((s) => s.shop) }, { status: 404 });
  try {
    const tok = readOnlyToken(row);
    const auth = { accessToken: tok.access_token, shopId: tok.shop_id, partner: tok };
    const id = url.searchParams.get('id');
    if (id) {
      const raw = await call('/api/v2/discount/get_discount', { ...auth, params: { discount_id: id, page_no: '1', page_size: '5' }, debugRaw: true });
      return NextResponse.json({ ok: true, shop: row.shop, raw, rows: raw.response ? discountRows(raw.response) : [] });
    }
    const raw = await call('/api/v2/discount/get_discount_list', {
      ...auth, params: { discount_status: url.searchParams.get('status') || 'ongoing', page_no: '1', page_size: '20' }, debugRaw: true,
    });
    return NextResponse.json({ ok: true, shop: row.shop, raw });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload || null }, { status: 500 });
  }
}
