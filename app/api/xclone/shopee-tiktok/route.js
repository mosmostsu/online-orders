// โคลน Shopee → TikTok (ร้านเดียวกัน) — ดู lib/cloneTiktok.js
//   GET  ?shop=SOLID                         → ตะกร้า Shopee ที่ TikTok ยังไม่มี + หมวด/แบรนด์/แอตทริบิวต์/ตารางไซส์ที่จะใช้ (อ่านอย่างเดียว)
//   POST { id, shop }                         → โคลนหนึ่งตะกร้า
//   POST { id, shop, test: true }             → สร้างแบบทดสอบ (แบบร่าง [TEST] SKU -TEST จำนวน 0)
//   POST { action: 'delete-test', itemId }    → ลบสินค้าทดสอบ (เฉพาะแบบร่าง [TEST] + SKU -TEST ทุกตัว)
//   src = ร้าน Shopee ต้นทาง (GET ?src=REAL / POST { src: 'REAL' }) ไม่ใส่ = ชื่อเดียวกับ shop · GET ?ids=1,2 → เฉพาะตะกร้าที่ติ๊ก
//   POST { action: 'images', id, shop, src }       → รูปของตะกร้าต้นทาง (หน้าแก้รูปก่อนโคลน)
//   POST { action: 'upload-image', shop, data }    → อัปรูปที่แก้แล้วเข้า TikTok → { imageId: 'uri:…' }
//   POST { id, shop, src, gallery: [...] }          → โคลนโดยใช้รูปตามที่เลือก/แก้
//   POST { action: 'upload-sizechart', shop, data } → อัปรูปตารางไซส์เข้า TikTok → { uri } · โคลนด้วย { sizeChart: uri }
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { planShopeeToTiktok, cloneShopeeToTiktok, deleteTestProduct, sourceImagesTiktok, uploadEditedImageTiktok, uploadSizeChartTiktok, SOURCES } from '@/lib/cloneTiktok';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SHOPS = ['SOLID'];
const shopOf = (v) => (SHOPS.includes(String(v || 'SOLID').toUpperCase()) ? String(v || 'SOLID').toUpperCase() : null);
const srcOf = (v, shop) => { const s = String(v || shop).toUpperCase(); return (SOURCES[shop] || [shop]).includes(s) ? s : null; };

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams;
    const shop = shopOf(sp.get('shop'));
    const src = shop && srcOf(sp.get('src'), shop);
    if (!shop || !src) return NextResponse.json({ ok: false, error: 'ร้านนี้ยังไม่รองรับ' }, { status: 400 });
    const ids = sp.get('ids') ? sp.get('ids').split(',').filter((x) => /^\d+$/.test(x)) : null;
    return NextResponse.json({ ok: true, shop, src, ...(await planShopeeToTiktok(shop, { src, ids })) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const b = await req.json().catch(() => ({}));
    const shop = shopOf(b.shop);
    const src = shop && srcOf(b.src, shop);
    if (!shop || !src) return NextResponse.json({ ok: false, error: 'ร้านนี้ยังไม่รองรับ' }, { status: 400 });
    if (b.action === 'delete-test') {
      return NextResponse.json({ ok: true, ...(await deleteTestProduct({ itemId: b.itemId, shop })) });
    }
    if (b.action === 'images') return NextResponse.json({ ok: true, ...(await sourceImagesTiktok({ id: b.id, shop, src })) });
    if (b.action === 'upload-image') return NextResponse.json({ ok: true, ...(await uploadEditedImageTiktok({ shop, data: b.data })) });
    if (b.action === 'upload-sizechart') return NextResponse.json({ ok: true, ...(await uploadSizeChartTiktok({ shop, data: b.data })) });
    const r = await cloneShopeeToTiktok({ id: b.id, shop, src, test: b.test === true, catPick: /^\d+$/.test(String(b.categoryId || '')) ? String(b.categoryId) : null, gallery: b.gallery ?? null, sizeChart: b.sizeChart ?? null });
    if (b.test !== true) { revalidateTag('listings'); revalidateTag('allsite'); }
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload ? JSON.stringify(e.payload).slice(0, 1500) : undefined }, { status: 500 });
  }
}
