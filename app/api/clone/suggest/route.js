// เดาหมวด ThisShop ให้หมวด Shopee ที่ยังไม่ได้จับคู่ (ดู lib/clone.js suggestCategories)
// รับ { cats: [{ id, name }] } → { ok, suggestions: { [shopeeCatId]: { id, name, how, votes, of } } }
import { NextResponse } from 'next/server';
import { suggestCategories } from '@/lib/clone';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const cats = (body.cats || [])
      .map((c) => ({ id: String(c.id || ''), name: String(c.name || '') }))
      .filter((c) => /^\d+$/.test(c.id))
      .slice(0, 40);
    return NextResponse.json({ ok: true, suggestions: await suggestCategories(cats) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
