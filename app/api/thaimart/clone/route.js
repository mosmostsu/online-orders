// TikTok SOLID → Thaimart แบบส่งตรง (ส่วนขยาย extensions/thaimart-stock เป็นคนส่งเข้า Thaimart) — ดู lib/thaimartExport.js
//   POST { ids: [...], test?: true } → { products: [{ id, title, cat, product }], skipped, warnings }
// ฝั่งนี้แค่เตรียมก้อนสินค้า (ตรวจซ้ำว่า Thaimart ยังไม่มี SKU ไหนของตะกร้านั้น) ไม่ได้เขียนอะไรลง Thaimart
import { NextResponse } from 'next/server';
import { buildThaimartProducts } from '@/lib/thaimartExport';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const b = await req.json().catch(() => ({}));
    const ids = (b.ids || []).map(String).filter((x) => /^\d+$/.test(x)).slice(0, 25);
    if (!ids.length) return NextResponse.json({ ok: false, error: 'ยังไม่ได้เลือกตะกร้า' }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await buildThaimartProducts(ids, { test: b.test === true })) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
