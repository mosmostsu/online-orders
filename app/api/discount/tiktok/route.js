// บันทึกโปรของตะกร้าเดียวขึ้น TikTok — ปุ่มบันทึกในหน้าโปร (/discount/tiktok/...)
//
// POST { shop, discountId, itemId, purchaseLimit, set: [{ model_id, discount } | { model_id, price }], remove: [model_id] }
//   → { ok, results: [{ model_id, action: 'update'|'add'|'remove'|'noop', error }] }
//   โปรแบบ % (DIRECT_DISCOUNT) ส่ง discount = % จำนวนเต็ม · ราคาตายตัว (FIXED_PRICE) ส่ง price = บาท
//   โปรระดับตะกร้า (PRODUCT) model_id = รหัสตะกร้า · ระดับตัวเลือก (VARIATION) model_id = sku_id
//   purchaseLimit: ตัวเลข = ตั้งใหม่ (0 = ไม่จำกัด) · null = คงค่าเดิมในโปร
//   ประเภทโปร / ตัวไหนอยู่ในโปร / ราคาปกติ / ค่าจำกัดเดิม เซิร์ฟเวอร์อ่านจาก TikTok เองทุกครั้ง ไม่เชื่อที่เบราว์เซอร์ส่งมา
//
// ⚠ เขียนลงร้านจริง — ด่านเดียวกับ /api/discount/shopee: middleware.js (SALES_PIN + Origin) และเช็คซ้ำที่นี่
//   ?key=SYNC_SECRET ใช้แทนได้ไว้ทดสอบ · ทุกครั้งที่บันทึกเก็บประวัติลง os_discount_log (platform 'tiktok')
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { tiktokSaveBasket, tiktokShops, ValidationError } from '@/lib/discounts';
import { salesUnlocked } from '@/lib/pin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const digits = (x) => /^\d+$/.test(String(x ?? ''));

export async function POST(req) {
  const key = new URL(req.url).searchParams.get('key');
  const byKey = Boolean(process.env.SYNC_SECRET) && key === process.env.SYNC_SECRET;
  if (!byKey) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    let same = false;
    try { same = Boolean(origin) && new URL(origin).host === host; } catch { same = false; }
    if (!same) return NextResponse.json({ ok: false, error: 'คำขอไม่ได้มาจากหน้าเว็บนี้' }, { status: 403 });
    if (!(await salesUnlocked())) {
      return NextResponse.json({ ok: false, error: 'ต้องใส่รหัสปลดล็อกก่อนถึงจะแก้โปรได้' }, { status: 401 });
    }
  }
  const b = await req.json().catch(() => ({}));
  const shop = String(b.shop || '');
  if (!(await tiktokShops()).includes(shop)) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้านนี้' }, { status: 400 });
  if (!digits(b.discountId) || !digits(b.itemId)) return NextResponse.json({ ok: false, error: 'discountId / itemId ไม่ถูกต้อง' }, { status: 400 });

  const val = (x) => (x === null || x === undefined || x === '' ? undefined : Number(x));
  const set = (Array.isArray(b.set) ? b.set : []).map((m) => ({ model_id: String(m?.model_id ?? ''), discount: val(m?.discount), price: val(m?.price) }));
  const remove = (Array.isArray(b.remove) ? b.remove : []).map(String);
  const bad = set.find((m) => !digits(m.model_id) || ![m.discount, m.price].some((v) => Number.isFinite(v) && v > 0)) || remove.find((x) => !digits(x));
  if (bad) return NextResponse.json({ ok: false, error: 'ราคา/% หรือรหัสตัวเลือกไม่ถูกต้อง' }, { status: 400 });
  if (!set.length && !remove.length) return NextResponse.json({ ok: false, error: 'ไม่มีอะไรให้บันทึก' }, { status: 400 });
  const limitIn = b.purchaseLimit === null || b.purchaseLimit === undefined ? null : Number(b.purchaseLimit);
  if (limitIn !== null && !(Number.isInteger(limitIn) && limitIn >= 0)) return NextResponse.json({ ok: false, error: 'จำกัดการซื้อไม่ถูกต้อง' }, { status: 400 });

  try {
    const results = await tiktokSaveBasket({
      shop, activityId: String(b.discountId), productId: String(b.itemId), purchaseLimit: limitIn, set, remove,
      meta: {
        ip: req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
        ua: req.headers.get('user-agent'),
      },
    });
    // รอสักครู่ค่อยล้างที่จำไว้ (ส่องแล้วอ่านกลับหลังบันทึกเห็นค่าใหม่ แต่ยังไม่ได้วัดว่าทันทีหรือไม่)
    await new Promise((r) => setTimeout(r, 1500));
    revalidateTag('discounts');
    return NextResponse.json({ ok: results.every((r) => !r.error), results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload || null }, { status: e instanceof ValidationError ? 400 : 500 });
  }
}
