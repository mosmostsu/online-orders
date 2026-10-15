// โคลน Shopee → Shopee คนละร้าน (Shopee SOLID ↔ Shopee REAL) — ดู lib/cloneShopeeShop.js
//   GET  ?shop=REAL                              → ตะกร้า Shopee SOLID ที่ Shopee REAL ยังไม่มี (อ่านอย่างเดียว)
//   POST { id, shop: 'REAL' }                    → โคลนหนึ่งตะกร้า
//   POST { id, shop: 'REAL', test: true }        → สร้างแบบทดสอบ ([TEST] ซ่อน SKU -TEST สต็อก 0)
//   POST { action: 'delete-test', itemId, shop } → ลบสินค้าทดสอบ (เฉพาะ [TEST] + ซ่อน)
//   POST { action: 'images', id, shop }          → รูปของตะกร้าต้นทาง (หน้าแก้รูปก่อนโคลน)
//   POST { action: 'upload-image', shop, data }  → อัปรูปที่แก้แล้ว (data URL) → { imageId }
//   POST { id, shop, gallery: [imageId…] }       → โคลนโดยใช้รูปตามที่เลือก/แก้
// shop = ร้าน "ปลายทาง" · ร้านต้นทางคืออีกร้าน (ROUTES)
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { ROUTES, planShopeeToShopee, cloneShopeeToShopee, sourceImages, uploadEditedImage } from '@/lib/cloneShopeeShop';
import { deleteTestItem } from '@/lib/cloneShopee';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const shopOf = (v) => { const s = String(v || '').toUpperCase(); return ROUTES[s] ? s : null; };

export async function GET(req) {
  try {
    const shop = shopOf(new URL(req.url).searchParams.get('shop'));
    if (!shop) return NextResponse.json({ ok: false, error: 'ร้านนี้ยังไม่รองรับ' }, { status: 400 });
    return NextResponse.json({ ok: true, shop, ...(await planShopeeToShopee(shop)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const b = await req.json().catch(() => ({}));
    const shop = shopOf(b.shop);
    if (!shop) return NextResponse.json({ ok: false, error: 'ร้านนี้ยังไม่รองรับ' }, { status: 400 });
    if (b.action === 'delete-test') {
      return NextResponse.json({ ok: true, ...(await deleteTestItem({ itemId: b.itemId, shop })) });
    }
    if (b.action === 'images') return NextResponse.json({ ok: true, ...(await sourceImages({ id: b.id, dst: shop })) });
    if (b.action === 'upload-image') return NextResponse.json({ ok: true, ...(await uploadEditedImage({ dst: shop, data: b.data })) });
    const r = await cloneShopeeToShopee({ id: b.id, dst: shop, test: b.test === true, gallery: b.gallery ?? null });
    if (b.test !== true) { revalidateTag('listings'); revalidateTag('allsite'); }
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload ? JSON.stringify(e.payload).slice(0, 1500) : undefined }, { status: 500 });
  }
}
