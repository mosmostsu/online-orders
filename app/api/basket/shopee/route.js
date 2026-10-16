// แก้ตะกร้า Shopee — เพิ่มสี/ไซส์ + สร้าง SKU ใหม่ (ปุ่ม "แก้ตะกร้า / เพิ่ม SKU" ในหน้ารายละเอียดสินค้า)
//
// GET  ?shop=&itemId=            → { ok, plan } ตะกร้าสด + รหัสสีที่เดาได้ + ข้อเสนอจาก ST (lib/basket.js shopeeBasketPlan)
// GET  ?shop=&itemId=&st=a,b     → { ok, st } สต็อก ST ของรหัสสีที่พิมพ์เอง
// POST { shop, itemId, add: [[...], [...]], models: [{ opts, sku, price, stock }] } → { ok, added, warnings }
//
// ⚠ เขียนลงร้านจริง — ล็อกแบบเดียวกับ /api/discount/shopee:
//   ต้องปลดล็อกด้วย SALES_PIN + มาจากหน้าเว็บเราเอง (เช็ค Origin) · ?key=SYNC_SECRET ใช้แทนได้ไว้ทดสอบ
//   เพิ่มได้อย่างเดียว ไม่ลบ/ไม่แก้ตัวเลือกเดิม (ดู lib/basket.js)
import { NextResponse } from 'next/server';
import { shopeeShops } from '@/lib/discounts';
import { shopeeBasketPlan, shopeeAddOptions, stForCodes, BasketError } from '@/lib/basket';
import { salesUnlocked } from '@/lib/pin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const digits = (x) => /^\d+$/.test(String(x ?? ''));

async function guard(req, write) {
  const key = new URL(req.url).searchParams.get('key');
  if (process.env.SYNC_SECRET && key === process.env.SYNC_SECRET) return null;
  if (write) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    let same = false;
    try { same = Boolean(origin) && new URL(origin).host === host; } catch { same = false; }
    if (!same) return NextResponse.json({ ok: false, error: 'คำขอไม่ได้มาจากหน้าเว็บนี้' }, { status: 403 });
  }
  if (!(await salesUnlocked())) return NextResponse.json({ ok: false, error: 'ต้องใส่รหัสปลดล็อกก่อนถึงจะแก้ตะกร้าได้' }, { status: 401 });
  return null;
}

const fail = (e) => NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload || null }, { status: e instanceof BasketError ? 400 : 500 });

export async function GET(req) {
  const denied = await guard(req, false);
  if (denied) return denied;
  const u = new URL(req.url);
  const shop = u.searchParams.get('shop') || '';
  const itemId = u.searchParams.get('itemId') || '';
  if (!(await shopeeShops()).includes(shop)) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้านนี้' }, { status: 400 });
  if (!digits(itemId)) return NextResponse.json({ ok: false, error: 'itemId ไม่ถูกต้อง' }, { status: 400 });
  try {
    const st = u.searchParams.get('st');
    if (st !== null) return NextResponse.json({ ok: true, st: await stForCodes(st.split(',')) });
    return NextResponse.json({ ok: true, plan: await shopeeBasketPlan(shop, itemId) });
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  const denied = await guard(req, true);
  if (denied) return denied;
  const b = await req.json().catch(() => ({}));
  const shop = String(b.shop || '');
  if (!(await shopeeShops()).includes(shop)) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้านนี้' }, { status: 400 });
  if (!digits(b.itemId)) return NextResponse.json({ ok: false, error: 'itemId ไม่ถูกต้อง' }, { status: 400 });
  const add = Array.isArray(b.add) ? b.add.map((l) => (Array.isArray(l) ? l : [])) : [];
  const models = Array.isArray(b.models) ? b.models : [];
  if (models.length > 200) return NextResponse.json({ ok: false, error: 'SKU ใหม่เยอะเกิน (ครั้งละไม่เกิน 200)' }, { status: 400 });
  try {
    const r = await shopeeAddOptions({ shop, itemId: String(b.itemId), add, models });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) { return fail(e); }
}
