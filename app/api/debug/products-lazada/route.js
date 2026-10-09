// ส่องข้อมูลดิบตะกร้า Lazada — ไว้ตรวจว่าตัวแปลงอ่านชื่อ/ราคา/ตัวเลือกถูกไหม (คู่กับ debug/settlement-lazada)
//
//   /api/debug/products-lazada?key=SYNC_SECRET                    → จำนวนตะกร้าแต่ละ filter + ตะกร้าแรกที่เจอ (ดิบ + แปลงแล้ว)
//   /api/debug/products-lazada?key=SYNC_SECRET&filter=inactive    → ดู filter อื่น
import { NextResponse } from 'next/server';
import { listProductsPage, normalizeListing, PRODUCT_FILTERS } from '@/lib/lazada';
import { listShops, usableToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  if (process.env.SYNC_SECRET && url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const shops = await listShops('lazada');
  const row = shops.find((s) => s.shop === (url.searchParams.get('shop') || s.shop));
  if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบร้าน' }, { status: 404 });

  try {
    const tok = await usableToken(row);
    const only = url.searchParams.get('filter');
    const out = {};
    let sample = null;
    for (const f of PRODUCT_FILTERS.filter((x) => !only || x.filter === only)) {
      const { products, total } = await listProductsPage({ accessToken: tok.access_token, filter: f.filter, page: 0 });
      out[f.filter] = { first_page: products.length, total_products: total };
      if (!sample && products[0]) {
        sample = { filter: f.filter, raw: products[0], parsed: normalizeListing(products[0], row.shop, f.status) };
      }
    }
    return NextResponse.json({ ok: true, shop: row.shop, filters: out, sample });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload }, { status: 500 });
  }
}
