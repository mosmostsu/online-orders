// บันทึกราคาโปรของตะกร้าเดียวขึ้น Shopee — ปุ่มบันทึกในหน้าโปร (/discount/shopee/...) และหน้าสินค้า
//
// POST { shop, discountId, itemId, purchaseLimit, set: [{ model_id, price }], remove: [model_id], inPromo: [model_id] }
//   → { ok, results: [{ model_id, action: 'update'|'add'|'remove', error }] }
//
// ⚠ เขียนลงร้านจริง — ต้องปลดล็อกด้วยรหัส SALES_PIN ก่อน (คุกกี้เดียวกับหน้าเงินเข้า ดู lib/pin.js)
// เว็บไม่มีระบบล็อกอิน ใครมีลิงก์ก็เปิดได้ จึงไม่ให้แก้ราคาโดยไม่มีรหัส
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { shopeeSaveBasket, shopeeShops } from '@/lib/discounts';
import { salesUnlocked } from '@/lib/pin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const digits = (x) => /^\d+$/.test(String(x ?? ''));

export async function POST(req) {
  // ?key=SYNC_SECRET แทนรหัสได้ — ไว้ทดสอบเส้นทางเดียวกับปุ่มโดยไม่ต้องรู้ SALES_PIN
  const key = new URL(req.url).searchParams.get('key');
  const byKey = Boolean(process.env.SYNC_SECRET) && key === process.env.SYNC_SECRET;
  if (!byKey && !(await salesUnlocked())) {
    return NextResponse.json({ ok: false, error: 'ต้องใส่รหัสปลดล็อกก่อนถึงจะแก้โปรได้' }, { status: 401 });
  }
  const b = await req.json().catch(() => ({}));
  const shop = String(b.shop || '');
  if (!(await shopeeShops()).includes(shop)) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้านนี้' }, { status: 400 });
  if (!digits(b.discountId) || !digits(b.itemId)) return NextResponse.json({ ok: false, error: 'discountId / itemId ไม่ถูกต้อง' }, { status: 400 });

  const set = (Array.isArray(b.set) ? b.set : []).map((m) => ({ model_id: String(m?.model_id ?? ''), price: Number(m?.price) }));
  const remove = (Array.isArray(b.remove) ? b.remove : []).map(String);
  const bad = set.find((m) => !digits(m.model_id) || !Number.isFinite(m.price) || m.price <= 0) || remove.find((x) => !digits(x));
  if (bad) return NextResponse.json({ ok: false, error: 'ราคาหรือรหัสตัวเลือกไม่ถูกต้อง' }, { status: 400 });
  if (!set.length && !remove.length) return NextResponse.json({ ok: false, error: 'ไม่มีอะไรให้บันทึก' }, { status: 400 });

  try {
    const results = await shopeeSaveBasket({
      shop, discountId: String(b.discountId), itemId: String(b.itemId),
      // null/ไม่ส่ง = ไม่รู้ค่าเดิม → shopeeSaveBasket อ่านจากโปรก่อนแล้วส่งค่าเดิม (กันรีเซ็ตเป็น 0)
      purchaseLimit: b.purchaseLimit === null || b.purchaseLimit === undefined ? undefined : Math.max(0, Math.floor(Number(b.purchaseLimit) || 0)),
      set, remove, inPromo: (Array.isArray(b.inPromo) ? b.inPromo : []).map(String),
    });
    // ล้างที่จำไว้ของหน้าโปร — เปิดใหม่ได้ค่าที่เพิ่งบันทึก (Shopee อาจหน่วงไม่กี่วินาที)
    revalidateTag('discounts');
    return NextResponse.json({ ok: results.every((r) => !r.error), results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload || null }, { status: 500 });
  }
}
