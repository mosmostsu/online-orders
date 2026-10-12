// วางแผนโคลน Shopee REAL → ThisShop: จากรหัส SKU ในรายงาน ได้รายการตะกร้าพร้อมสถานะ (ดู lib/clone.js)
import { NextResponse } from 'next/server';
import { planClone } from '@/lib/clone';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX = 5000;

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const skus = (body.skus || []).map((s) => String(s)).filter(Boolean).slice(0, MAX);
    if (!skus.length) return NextResponse.json({ ok: false, error: 'ยังไม่มี SKU ที่เลือก' }, { status: 400 });
    return NextResponse.json(await planClone(skus));
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
