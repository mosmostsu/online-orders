// วางแผนโคลน Shopee REAL → ThisShop (ดู lib/clone.js)
// รับได้สองแบบ: skus = รหัส SKU จากรายงาน /allsite/report · productIds = เลขตะกร้า Shopee REAL จากหน้า /compare
import { NextResponse } from 'next/server';
import { planClone } from '@/lib/clone';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX = 5000;

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const skus = (body.skus || []).map((s) => String(s)).filter(Boolean).slice(0, MAX);
    const productIds = (body.productIds || []).map((s) => String(s)).filter((s) => /^\d+$/.test(s)).slice(0, 500);
    if (!skus.length && !productIds.length) return NextResponse.json({ ok: false, error: 'ยังไม่ได้เลือกสินค้า' }, { status: 400 });
    return NextResponse.json(await planClone(skus, productIds));
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
