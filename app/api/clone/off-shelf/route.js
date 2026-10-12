// รายการตะกร้า ThisShop ที่ปิดขายอยู่ แต่ Shopee REAL ขายอยู่ (อ่านอย่างเดียว) — ปุ่ม "เปิดขายทั้งหมด" ในหน้า /compare
// ตัวเปิดขายจริงคือ POST /api/clone/publish ทีละตะกร้า (เรียกจากหน้าเว็บ)
import { NextResponse } from 'next/server';
import { listOffShelf } from '@/lib/clone';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json({ ok: true, items: await listOffShelf() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
