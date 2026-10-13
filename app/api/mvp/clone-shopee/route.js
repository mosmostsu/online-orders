// โคลน TikTok MVP → Shopee MVP (ส่วนขยาย extensions/mvp-stock เป็นคนส่งเข้า Seller Center) — ดู lib/cloneShopeeMvp.js
//   GET                                   → ตะกร้า TikTok MVP ที่ Shopee MVP ยังไม่มี (อ่านอย่างเดียว)
//   POST { id, test?, categoryId? }       → product_info ของตะกร้านั้น (ยังไม่ได้เขียนอะไรลง Shopee — ส่วนขยายส่งเอง)
import { NextResponse } from 'next/server';
import { planTiktokToShopeeMvp, buildShopeeMvpProduct } from '@/lib/cloneShopeeMvp';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await planTiktokToShopeeMvp()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const b = await req.json().catch(() => ({}));
    const catPick = /^\d+$/.test(String(b.categoryId || '')) ? String(b.categoryId) : null;
    return NextResponse.json({ ok: true, ...(await buildShopeeMvpProduct({ id: b.id, test: b.test === true, catPick })) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
