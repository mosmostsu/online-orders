// หมวดปลายทางให้เลือกเองในแผงโคลน — GET ?dest=shopee|lazada|tiktok&shop=SOLID → [{ id, path }] (เฉพาะ leaf, อ่านอย่างเดียว)
import { NextResponse } from 'next/server';
import { destCategories } from '@/lib/destCategories';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams;
    const dest = String(sp.get('dest') || '');
    const shop = String(sp.get('shop') || 'SOLID').toUpperCase();
    if (!['shopee', 'lazada', 'tiktok'].includes(dest) || shop !== 'SOLID') {
      return NextResponse.json({ ok: false, error: 'ปลายทางนี้ยังไม่รองรับ' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, items: await destCategories(dest, shop) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
