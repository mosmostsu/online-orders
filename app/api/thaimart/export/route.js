// TikTok SOLID → Thaimart (ไฟล์นำเข้า Excel) — ดู lib/thaimartExport.js
//   GET  → รายการตะกร้าที่ Thaimart ยังไม่มี (อ่านอย่างเดียว)
//   POST { ids: [...] } → ไฟล์ .xlsx (base64) แยกตามหมวด ≤500 แถว + ตะกร้าที่ข้ามพร้อมเหตุผล
// ไม่เขียนอะไรลง Thaimart — ผู้ใช้อัปโหลดไฟล์เองที่ seller.thaimart.com → นำเข้าสินค้า
import { NextResponse } from 'next/server';
import { thaimartCandidates, buildThaimartFiles } from '@/lib/thaimartExport';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json({ ok: true, items: await thaimartCandidates() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const b = await req.json().catch(() => ({}));
    const ids = (b.ids || []).map(String).filter((x) => /^\d+$/.test(x));
    return NextResponse.json({ ok: true, ...(await buildThaimartFiles(ids)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
