// แผนเติมตัวเลือกที่ ThisShop ขาดให้เหมือน Shopee REAL (ปุ่ม "เติม ThisShop" หน้า /compare) — ดู lib/thisshopFill.js
// POST { shopeeItemId, spuId }                 → { ok, tiers, add, extra, keep, editUrl } (nothing: true = ครบแล้ว)
// POST { action: 'verify', spuId, keep, add }  → { ok, total, lostOld, notAdded } ตรวจตะกร้าสดหลังส่วนขยายบันทึก
// ไม่เขียนอะไรลงร้าน — ส่วนขยาย extensions/thisshop-fill เป็นคนกดในหลังบ้านตามแผนนี้
// อยู่ใต้ /api/basket/ → middleware บังคับปลดล็อก SALES_PIN (แผนนี้ใช้แก้ตะกร้าจริง)
import { NextResponse } from 'next/server';
import { buildFillPlan, verifyFill, FillError } from '@/lib/thisshopFill';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === 'verify') return NextResponse.json(await verifyFill(body));
    return NextResponse.json(await buildFillPlan({ shopeeItemId: body.shopeeItemId, spuId: body.spuId }));
  } catch (e) {
    const known = e instanceof FillError;
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: known ? 400 : 500 });
  }
}
