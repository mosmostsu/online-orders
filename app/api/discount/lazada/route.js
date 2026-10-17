// บันทึกราคาพิเศษ (Special Price) ของตะกร้าเดียวขึ้น Lazada — ป็อปอัพ "แก้โปร" ในหน้าสินค้า
//
// POST { shop, itemId, set: [{ model_id: SkuId, price }], remove: [SkuId] }
//   → { ok, results: [{ model_id, action: 'update'|'add'|'remove'|'noop', error }] }
//   ช่วงเวลา: ตัวที่มีช่วงเวลาเดิมยังไม่หมดคงไว้ · ใหม่ = ตอนนี้ → อีก 1 ปี · เอาออก = ตั้งวันจบเป็นตอนนี้ (ดู lazadaSaveSpecial)
//   ราคาปกติ / ราคาพิเศษเดิม / ช่วงเวลา เซิร์ฟเวอร์อ่านจาก Lazada เองทุกครั้ง ไม่เชื่อที่เบราว์เซอร์ส่งมา
//
// ⚠ เขียนลงร้านจริง — ด่านเดียวกับ /api/discount/shopee: middleware.js (SALES_PIN + Origin) และเช็คซ้ำที่นี่
//   ?key=SYNC_SECRET ใช้แทนได้ไว้ทดสอบ · ทุกครั้งที่บันทึกเก็บประวัติลง os_discount_log (platform 'lazada', discount_id 'special')
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { lazadaSaveSpecial, lazadaShops, ValidationError } from '@/lib/discounts';
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
  if (!(await lazadaShops()).includes(shop)) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้านนี้' }, { status: 400 });
  if (!digits(b.itemId)) return NextResponse.json({ ok: false, error: 'itemId ไม่ถูกต้อง' }, { status: 400 });
  const set = (Array.isArray(b.set) ? b.set : []).map((m) => ({ model_id: String(m?.model_id ?? ''), price: Number(m?.price) }));
  const remove = (Array.isArray(b.remove) ? b.remove : []).map(String);
  const bad = set.find((m) => !digits(m.model_id) || !Number.isFinite(m.price) || m.price <= 0) || remove.find((x) => !digits(x));
  if (bad) return NextResponse.json({ ok: false, error: 'ราคาหรือรหัสตัวเลือกไม่ถูกต้อง' }, { status: 400 });
  if (!set.length && !remove.length) return NextResponse.json({ ok: false, error: 'ไม่มีอะไรให้บันทึก' }, { status: 400 });

  try {
    const results = await lazadaSaveSpecial({
      shop, itemId: String(b.itemId), set, remove,
      meta: {
        ip: req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
        ua: req.headers.get('user-agent'),
      },
    });
    revalidateTag('discounts');
    revalidateTag('listings');
    return NextResponse.json({ ok: results.every((r) => !r.error), results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload || null }, { status: e instanceof ValidationError ? 400 : 500 });
  }
}
