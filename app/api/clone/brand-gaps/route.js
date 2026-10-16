// แบรนด์ที่ ThisShop ยังไม่ให้ใช้ ของตะกร้า Shopee REAL ที่จะโคลน (ดู lib/cloneBrandGaps.js) — หน้า /clone-brands
import { NextResponse } from 'next/server';
import { brandGaps } from '@/lib/cloneBrandGaps';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json(await brandGaps());
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
