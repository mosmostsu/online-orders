// บันทึกราคาโปรของตะกร้าเดียวขึ้น Shopee — ปุ่มบันทึกในหน้าโปร (/discount/shopee/...) และหน้าสินค้า
//
// POST { shop, discountId, itemId, purchaseLimit, set: [{ model_id, price }], remove: [model_id] }
//   → { ok, results: [{ model_id, action: 'update'|'add'|'remove', error }] }
//   purchaseLimit: ตัวเลข = ตั้งใหม่ · null = คงค่าเดิมในโปร (เซิร์ฟเวอร์อ่านเอง)
//   ตัวไหนอยู่ในโปรแล้ว / ราคาปกติ / ค่าจำกัดเดิม เซิร์ฟเวอร์อ่านจาก Shopee เองทุกครั้ง ไม่เชื่อที่เบราว์เซอร์ส่งมา
//
// ⚠ เขียนลงร้านจริง:
//   - ต้องปลดล็อกด้วยรหัส SALES_PIN (คุกกี้เดียวกับหน้าเงินเข้า ดู lib/pin.js) — เว็บไม่มีระบบล็อกอิน
//     ?key=SYNC_SECRET ใช้แทนได้ไว้ทดสอบ
//   - ต้องมาจากหน้าเว็บเราเอง (เช็ค Origin) กันเว็บอื่นยิงข้ามมาตอนเครื่องที่ปลดล็อกไว้เปิดอยู่
//   - ทุกครั้งที่บันทึกเก็บประวัติลง os_discount_log (supabase/061)
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { shopeeSaveBasket, shopeeShops, ValidationError } from '@/lib/discounts';
import { salesUnlocked } from '@/lib/pin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const digits = (x) => /^\d+$/.test(String(x ?? ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function POST(req) {
  const key = new URL(req.url).searchParams.get('key');
  const byKey = Boolean(process.env.SYNC_SECRET) && key === process.env.SYNC_SECRET;
  if (!byKey) {
    // คำขอจากเบราว์เซอร์ต้องมาจากโดเมนเดียวกัน (เบราว์เซอร์ส่ง Origin มากับ POST เสมอ)
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
  if (!(await shopeeShops()).includes(shop)) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้านนี้' }, { status: 400 });
  if (!digits(b.discountId) || !digits(b.itemId)) return NextResponse.json({ ok: false, error: 'discountId / itemId ไม่ถูกต้อง' }, { status: 400 });

  const set = (Array.isArray(b.set) ? b.set : []).map((m) => ({ model_id: String(m?.model_id ?? ''), price: Number(m?.price) }));
  const remove = (Array.isArray(b.remove) ? b.remove : []).map(String);
  const bad = set.find((m) => !digits(m.model_id) || !Number.isFinite(m.price) || m.price <= 0) || remove.find((x) => !digits(x));
  if (bad) return NextResponse.json({ ok: false, error: 'ราคาหรือรหัสตัวเลือกไม่ถูกต้อง' }, { status: 400 });
  if (!set.length && !remove.length) return NextResponse.json({ ok: false, error: 'ไม่มีอะไรให้บันทึก' }, { status: 400 });
  const limitIn = b.purchaseLimit === null || b.purchaseLimit === undefined ? null : Number(b.purchaseLimit);
  if (limitIn !== null && !(Number.isInteger(limitIn) && limitIn >= 0)) return NextResponse.json({ ok: false, error: 'จำกัดการซื้อไม่ถูกต้อง' }, { status: 400 });

  try {
    const results = await shopeeSaveBasket({
      shop, discountId: String(b.discountId), itemId: String(b.itemId), purchaseLimit: limitIn, set, remove,
      meta: {
        ip: req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
        ua: req.headers.get('user-agent'),
      },
    });
    // Shopee อัปเดตไม่ทันที — รอสักครู่ค่อยล้างที่จำไว้ ไม่งั้นหน้าที่โหลดใหม่อาจจำค่าเก่าไว้อีก 2 นาที (คนกดจะนึกว่าไม่ติดแล้วกดซ้ำ)
    await sleep(3000);
    revalidateTag('discounts');
    return NextResponse.json({ ok: results.every((r) => !r.error), results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload || null }, { status: e instanceof ValidationError ? 400 : 500 });
  }
}
