// โคลน Shopee → TikTok (ร้านเดียวกัน) — ดู lib/cloneTiktok.js
//   GET  ?shop=SOLID                         → ตะกร้า Shopee ที่ TikTok ยังไม่มี + หมวด/แบรนด์/แอตทริบิวต์/ตารางไซส์ที่จะใช้ (อ่านอย่างเดียว)
//   POST { id, shop }                         → โคลนหนึ่งตะกร้า
//   POST { id, shop, test: true }             → สร้างแบบทดสอบ (แบบร่าง [TEST] SKU -TEST จำนวน 0)
//   POST { action: 'delete-test', itemId }    → ลบสินค้าทดสอบ (เฉพาะแบบร่าง [TEST] + SKU -TEST ทุกตัว)
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { planShopeeToTiktok, cloneShopeeToTiktok, deleteTestProduct } from '@/lib/cloneTiktok';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SHOPS = ['SOLID'];
const shopOf = (v) => (SHOPS.includes(String(v || 'SOLID').toUpperCase()) ? String(v || 'SOLID').toUpperCase() : null);

export async function GET(req) {
  try {
    const shop = shopOf(new URL(req.url).searchParams.get('shop'));
    if (!shop) return NextResponse.json({ ok: false, error: 'ร้านนี้ยังไม่รองรับ' }, { status: 400 });
    return NextResponse.json({ ok: true, shop, ...(await planShopeeToTiktok(shop)) });
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
      return NextResponse.json({ ok: true, ...(await deleteTestProduct({ itemId: b.itemId, shop })) });
    }
    const r = await cloneShopeeToTiktok({ id: b.id, shop, test: b.test === true, catPick: /^\d+$/.test(String(b.categoryId || '')) ? String(b.categoryId) : null });
    if (b.test !== true) { revalidateTag('listings'); revalidateTag('allsite'); }
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload ? JSON.stringify(e.payload).slice(0, 1500) : undefined }, { status: 500 });
  }
}
