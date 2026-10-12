// โคลน TikTok → Lazada (ร้านเดียวกัน) — ดู lib/cloneLazada.js
//   GET  ?shop=SOLID                         → ตะกร้า TikTok ที่ Lazada ยังไม่มี + หมวด/แอตทริบิวต์/แบรนด์ที่จะใช้ (อ่านอย่างเดียว)
//   POST { id, shop }                         → โคลนหนึ่งตะกร้า
//   POST { id, shop, test: true }             → สร้างแบบทดสอบ ([TEST] SKU -TEST จำนวน 0)
//   POST { action: 'delete-test', itemId }    → ลบสินค้าทดสอบ (เฉพาะ [TEST] + SKU -TEST ทุกตัว)
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { planTiktokToLazada, cloneTiktokToLazada, deleteTestItem } from '@/lib/cloneLazada';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SHOPS = ['SOLID'];
const shopOf = (v) => (SHOPS.includes(String(v || 'SOLID').toUpperCase()) ? String(v || 'SOLID').toUpperCase() : null);

export async function GET(req) {
  try {
    const shop = shopOf(new URL(req.url).searchParams.get('shop'));
    if (!shop) return NextResponse.json({ ok: false, error: 'ร้านนี้ยังไม่รองรับ' }, { status: 400 });
    return NextResponse.json({ ok: true, shop, ...(await planTiktokToLazada(shop)) });
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
    const r = await cloneTiktokToLazada({ id: b.id, shop, test: b.test === true, catPick: /^\d+$/.test(String(b.categoryId || '')) ? String(b.categoryId) : null });
    if (b.test !== true) { revalidateTag('listings'); revalidateTag('allsite'); }
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload ? JSON.stringify(e.payload).slice(0, 1500) : undefined }, { status: 500 });
  }
}
