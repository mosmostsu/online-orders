// เติม "ราคาพิเศษ" ของสินค้า TikTok จากโปรที่กำลังดำเนินการ (lib/discounts.js applyTiktokPromoPrices)
// GET ?key=SYNC_SECRET[&shop=SOLID] — รอบตั้งเวลา sync-products ยิงหลังซิงก์สินค้า TikTok ทุกชั่วโมง
// ร้านที่แอปยังไม่มีสิทธิ์ Promotion (MVP 105005) ข้ามไป ไม่ทำให้ร้านอื่นพัง
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { applyTiktokPromoPrices, tiktokShops } from '@/lib/discounts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req) {
  const u = new URL(req.url);
  if (!process.env.SYNC_SECRET || u.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const want = u.searchParams.get('shop');
  const shops = (await tiktokShops()).filter((s) => !want || s === want);
  const out = {};
  for (const shop of shops) {
    try { out[shop] = await applyTiktokPromoPrices(shop); } catch (e) { out[shop] = { error: String(e.message || e) }; }
  }
  if (Object.values(out).some((r) => r.changed)) { revalidateTag('listings'); revalidateTag('allsite'); }
  return NextResponse.json({ ok: true, shops: out });
}
