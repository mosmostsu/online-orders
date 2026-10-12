// โคลน TikTok → TikTok คนละร้าน (TikTok SOLID → TikTok MVP) — ดู lib/cloneTiktokTiktok.js
//   GET  ?shop=MVP                            → ตะกร้า TikTok SOLID ที่ TikTok MVP ยังไม่มี (อ่านอย่างเดียว)
//   POST { id, shop: 'MVP' }                  → โคลนหนึ่งตะกร้า
//   POST { id, shop: 'MVP', test: true }      → สร้างแบบทดสอบ (แบบร่าง [TEST] SKU -TEST จำนวน 0)
//   POST { action: 'delete-test', itemId, shop: 'MVP' } → ลบสินค้าทดสอบ (เฉพาะแบบร่าง [TEST] + SKU -TEST ทุกตัว)
// shop = ร้าน "ปลายทาง" · ร้านต้นทางกำหนดไว้ใน ROUTES
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { ROUTES, planTiktokToTiktok, cloneTiktokToTiktok } from '@/lib/cloneTiktokTiktok';
import { deleteTestProduct } from '@/lib/cloneTiktok';
import { shopToken } from '@/lib/cloneCommon';
import * as tiktok from '@/lib/tiktok';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const shopOf = (v) => { const s = String(v || '').toUpperCase(); return ROUTES[s] ? s : null; };

export async function GET(req) {
  try {
    const shop = shopOf(new URL(req.url).searchParams.get('shop'));
    if (!shop) return NextResponse.json({ ok: false, error: 'ร้านนี้ยังไม่รองรับ' }, { status: 400 });
    return NextResponse.json({ ok: true, shop, ...(await planTiktokToTiktok(shop)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const b = await req.json().catch(() => ({}));
    const shop = shopOf(b.shop);
    if (!shop) return NextResponse.json({ ok: false, error: 'ร้านนี้ยังไม่รองรับ' }, { status: 400 });
    if (b.action === 'inspect') {   // อ่านอย่างเดียว — ตรวจตะกร้าที่เพิ่งสร้างในร้านปลายทาง (คีย์แอป MVP อยู่บน Netlify เท่านั้น)
      const t = await shopToken('tiktok', shop);
      const p = await tiktok.getProduct({ accessToken: t.access_token, shopCipher: t.shop_cipher, productId: String(b.itemId) });
      return NextResponse.json({
        ok: true, status: p.status, title: p.title, brand: p.brand || null, category: (p.category_chains || []).slice(-1)[0] || null,
        sizeChart: Boolean(p.size_chart), images: (p.main_images || []).length, attrs: (p.product_attributes || []).length,
        skus: (p.skus || []).map((s) => ({ sku: s.seller_sku, price: s.price?.sale_price, qty: (s.inventory || []).map((w) => w.quantity), opts: (s.sales_attributes || []).map((a) => `${a.name}=${a.value_name}${a.sku_img ? '🖼' : ''}`) })),
      });
    }
    if (b.action === 'delete-test') {
      return NextResponse.json({ ok: true, ...(await deleteTestProduct({ itemId: b.itemId, shop })) });
    }
    const r = await cloneTiktokToTiktok({ id: b.id, dst: shop, test: b.test === true });
    if (b.test !== true) { revalidateTag('listings'); revalidateTag('allsite'); }
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload ? JSON.stringify(e.payload).slice(0, 1500) : undefined }, { status: 500 });
  }
}
