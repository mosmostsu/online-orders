// โคลนหนึ่งตะกร้าไป ThisShop (ขึ้นขายทันที) — เรียกทีละตัวจากหน้ารายงาน (ดู lib/clone.js runClone)
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { runClone } from '@/lib/clone';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const b = await req.json().catch(() => ({}));
    const r = await runClone({
      productId: b.productId, categoryId: b.categoryId, categoryName: b.categoryName || null,
      brandId: b.brandId, brandName: b.brandName || null, title: b.title || null,
    });
    // ล้างที่จำไว้ของหน้า /compare /product /allsite ให้เห็นตะกร้าที่เพิ่งสร้าง
    revalidateTag('listings');
    revalidateTag('allsite');
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
