// แก้ตะกร้า (Shopee / Lazada / TikTok) — เพิ่มสี/ไซส์ + สร้าง SKU ใหม่ (หน้าแก้ไขสินค้า /product/<platform>/<shop>/<id>/edit)
//   /api/basket/shopee · /api/basket/lazada · /api/basket/tiktok — รูปแบบคำขอเดียวกันทุกแพลตฟอร์ม
//
// GET  ?shop=&itemId=            → { ok, plan } ตะกร้าสด + รหัสสีที่เดาได้ + ข้อเสนอจาก ST (lib/basket.js shopeeBasketPlan)
// GET  ?shop=&itemId=&st=a,b     → { ok, st } สต็อก ST ของรหัสสีที่พิมพ์เอง
// POST { shop, itemId, add: [[...], [...]], models: [{ opts, sku, price, stock }], rename?: [{ model_id, sku }] } → { ok, added, renamed, warnings }
//      add ชั้นแรกเป็น { text, image_id } ได้ (ตะกร้าที่สีมีรูปทุกตัว Shopee บังคับให้สีใหม่มีรูป)
// POST { action: 'upload', shop, data: base64, type } → { ok, image_id } อัปโหลดรูปจากเครื่องเป็นรูปของสีใหม่ (Shopee เท่านั้น)
//
// ⚠ เขียนลงร้านจริง — ล็อกแบบเดียวกับ /api/discount/shopee:
//   ต้องปลดล็อกด้วย SALES_PIN + มาจากหน้าเว็บเราเอง (เช็ค Origin) · ?key=SYNC_SECRET ใช้แทนได้ไว้ทดสอบ
//   เพิ่มได้อย่างเดียว ไม่ลบ/ไม่แก้ตัวเลือกเดิม (ดู lib/basket.js)
import { NextResponse } from 'next/server';
import { shopeeShops, lazadaShops, tiktokShops } from '@/lib/discounts';
import { shopeeBasketPlan, shopeeAddOptions, stForCodes, uploadBasketImage, BasketError } from '@/lib/basket';
import { lazadaBasketPlan, lazadaAddOptions, lazadaRenameSkus } from '@/lib/basketLazada';
import { tiktokBasketPlan, tiktokAddOptions } from '@/lib/basketTiktok';
import { salesUnlocked } from '@/lib/pin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const digits = (x) => /^\d+$/.test(String(x ?? ''));
const P = {
  shopee: { shops: shopeeShops, plan: shopeeBasketPlan, add: shopeeAddOptions, upload: uploadBasketImage },
  lazada: { shops: lazadaShops, plan: lazadaBasketPlan, add: lazadaAddOptions, upload: null, rename: lazadaRenameSkus },
  tiktok: { shops: tiktokShops, plan: tiktokBasketPlan, add: tiktokAddOptions, upload: null },
};
const platformOf = async (ctx) => P[(await ctx.params).platform] || null;
const unknown = () => NextResponse.json({ ok: false, error: 'ไม่รู้จักแพลตฟอร์มนี้' }, { status: 404 });

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

export async function GET(req, ctx) {
  const pf = await platformOf(ctx);
  if (!pf) return unknown();
  const denied = await guard(req, false);
  if (denied) return denied;
  const u = new URL(req.url);
  const shop = u.searchParams.get('shop') || '';
  const itemId = u.searchParams.get('itemId') || '';
  if (!(await pf.shops()).includes(shop)) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้านนี้' }, { status: 400 });
  if (!digits(itemId)) return NextResponse.json({ ok: false, error: 'itemId ไม่ถูกต้อง' }, { status: 400 });
  try {
    const st = u.searchParams.get('st');
    if (st !== null) return NextResponse.json({ ok: true, st: await stForCodes(st.split(',')) });
    return NextResponse.json({ ok: true, plan: await pf.plan(shop, itemId) });
  } catch (e) { return fail(e); }
}

export async function POST(req, ctx) {
  const pf = await platformOf(ctx);
  if (!pf) return unknown();
  const denied = await guard(req, true);
  if (denied) return denied;
  const b = await req.json().catch(() => ({}));
  const shop = String(b.shop || '');
  if (!(await pf.shops()).includes(shop)) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้านนี้' }, { status: 400 });
  if (b.action === 'upload') {
    if (!pf.upload) return NextResponse.json({ ok: false, error: 'อัปโหลดรูปได้เฉพาะ Shopee — เลือกรูปที่ตะกร้ามีอยู่แล้วแทน' }, { status: 400 });
    try {
      const bytes = new Uint8Array(Buffer.from(String(b.data || ''), 'base64'));
      if (!bytes.length) return NextResponse.json({ ok: false, error: 'ไม่มีรูป' }, { status: 400 });
      return NextResponse.json({ ok: true, image_id: await pf.upload(shop, bytes, String(b.type || '')) });
    } catch (e) { return fail(e); }
  }
  if (!digits(b.itemId)) return NextResponse.json({ ok: false, error: 'itemId ไม่ถูกต้อง' }, { status: 400 });
  const add = Array.isArray(b.add) ? b.add.map((l) => (Array.isArray(l) ? l : [])) : [];
  const models = Array.isArray(b.models) ? b.models : [];
  if (models.length > 200) return NextResponse.json({ ok: false, error: 'SKU ใหม่เยอะเกิน (ครั้งละไม่เกิน 200)' }, { status: 400 });
  // rename: [{ model_id, sku }] แก้เลข SKU ของตัวเลือกเดิม (Lazada) — ทำก่อนเพิ่มตัวใหม่ · ส่งมาอย่างเดียวได้
  const rename = Array.isArray(b.rename) ? b.rename : [];
  if (rename.length && !pf.rename) return NextResponse.json({ ok: false, error: 'แพลตฟอร์มนี้ยังแก้เลข SKU เดิมจากเว็บไม่ได้' }, { status: 400 });
  if (rename.length > 200) return NextResponse.json({ ok: false, error: 'แก้รหัสเยอะเกิน (ครั้งละไม่เกิน 200)' }, { status: 400 });
  try {
    const rn = rename.length ? await pf.rename({ shop, itemId: String(b.itemId), rename }) : { renamed: [], warnings: [] };
    const hasAdd = models.length > 0 || add.some((l) => l.length);
    const r = hasAdd ? await pf.add({ shop, itemId: String(b.itemId), add, models }) : { added: [], warnings: [] };
    return NextResponse.json({ ok: true, ...r, renamed: rn.renamed, warnings: [...rn.warnings, ...(r.warnings || [])] });
  } catch (e) { return fail(e); }
}
