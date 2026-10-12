// โคลน TikTok → Shopee (ร้านเดียวกัน) — ดู lib/cloneShopee.js
//   GET  ?shop=SOLID                         → ตะกร้า TikTok ที่ Shopee ยังไม่มี + หมวด/แบรนด์ที่จะใช้ (อ่านอย่างเดียว)
//   POST { id, shop }                         → โคลนหนึ่งตะกร้า (ขึ้นขายทันที)
//   POST { id, shop, test: true }             → สร้างแบบทดสอบ ([TEST] ซ่อน สต็อก 0)
//   POST { action: 'delete-test', itemId }    → ลบสินค้าทดสอบ (เฉพาะ [TEST] + ซ่อน)
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { planTiktokToShopee, cloneTiktokToShopee, deleteTestItem } from '@/lib/cloneShopee';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SHOPS = ['SOLID'];
const shopOf = (v) => (SHOPS.includes(String(v || 'SOLID').toUpperCase()) ? String(v || 'SOLID').toUpperCase() : null);

export async function GET(req) {
  try {
    const shop = shopOf(new URL(req.url).searchParams.get('shop'));
    if (!shop) return NextResponse.json({ ok: false, error: 'ร้านนี้ยังไม่รองรับ' }, { status: 400 });
    return NextResponse.json({ ok: true, shop, ...(await planTiktokToShopee(shop)) });
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
    const r = await cloneTiktokToShopee({ id: b.id, shop, test: b.test === true });
    if (b.test !== true) { revalidateTag('listings'); revalidateTag('allsite'); }
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
