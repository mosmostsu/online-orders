// แก้ตะกร้า (Shopee / Lazada / TikTok) — เพิ่มสี/ไซส์ + สร้าง SKU ใหม่ (หน้าแก้ไขสินค้า /product/<platform>/<shop>/<id>/edit)
//   /api/basket/shopee · /api/basket/lazada · /api/basket/tiktok — รูปแบบคำขอเดียวกันทุกแพลตฟอร์ม
//
// GET  ?shop=&itemId=            → { ok, plan } ตะกร้าสด + รหัสสีที่เดาได้ + ข้อเสนอจาก ST (lib/basket.js shopeeBasketPlan)
// GET  ?shop=&itemId=&st=a,b     → { ok, st } สต็อก ST ของรหัสสีที่พิมพ์เอง
// POST { shop, itemId, add: [[...], [...]], models: [{ opts, sku, price, stock }] } → { ok, added, warnings }
//      add ชั้นแรกเป็น { text, image_id } ได้ (ตะกร้าที่สีมีรูปทุกตัว Shopee บังคับให้สีใหม่มีรูป)
// POST { action: 'upload', shop, data: base64, type, use: 'main'|'option' } → { ok, image_id } อัปโหลดรูปจากเครื่อง (ทุกแพลตฟอร์ม)
//      Shopee = image_id · TikTok = uri · Lazada = url — ยังไม่ผูกตะกร้าจนกดบันทึก
// POST { action: 'images', shop, itemId, main: [รหัสรูป] | null, options: { ตัวเลือกชั้นแรก: รหัสรูป } | null } → { ok, main, options, warnings }
//      แก้รูปสินค้า (เรียง/ลบ/เพิ่ม) + เปลี่ยนรูปตัวเลือกเดิม
// POST { action: 'edit', shop, itemId, edits: [{ model_id, sku?, price? }] } → { ok, changed, warnings }
//      แก้รหัส SKU / ราคาของ SKU เดิม (ทุกแพลตฟอร์ม · TikTok เปลี่ยนรหัสต้องรอตรวจ)
// POST { action: 'structure', shop, itemId, tiers: [{ name, options: [{ from, text }] }], del: [model_id] } → { ok, deleted, reshaped, warnings }
//      เรียงตัวเลือกใหม่ / เปลี่ยนชื่อตัวเลือก+ชื่อชั้น / ลบตัวเลือก (SKU ที่ใช้ถูกลบด้วย) / ลบ SKU รายตัว
// POST { action: 'info', shop, itemId, title?, description?, category?: { id, attrs } } → { ok, title, description, category, warnings }
//      ชื่อ / รายละเอียด / หมวด (เปลี่ยนหมวดได้เฉพาะ Shopee — แอตทริบิวต์บังคับขาด → 400 payload.need)
// GET  ?shop=&itemId=&more=1          → { ok, more } สถานะขาย · พัสดุ · ตารางไซส์ · ยี่ห้อ · แอตทริบิวต์ของหมวด (lib/basketMore.js)
// GET  ?shop=&itemId=&brands=<คำค้น>  → { ok, brands: [{ id, name }] } ยี่ห้อที่ใช้ได้ในหมวดของตะกร้า (Shopee / TikTok)
// GET  ?shop=&itemId=&attrSearch=<attribute_id>&q=  → { ok, values } ค่าของแอตทริบิวต์ที่ต้องค้น (Shopee)
// POST { action: 'status', shop, itemId, on: true|false } → เปิด/ปิดการขาย
// POST { action: 'more', shop, itemId, pkg?: { weight, l, w, h }, sizeChart?: รหัสรูป, brand?: { id, name }, attrs?: [{ id, values }] }
// วิดีโอสินค้า (lib/basketVideo.js) — อัปโหลดเสร็จแล้วผูกเข้าตะกร้าด้วย action 'more' { video: รหัส } (Shopee ส่ง videoRemove: true = ลบ)
//   Shopee  POST { action: 'video-init', shop, md5, size } → { uploadId, partSize, parts }
//           POST ?action=video-part&shop=&uploadId=&seq=  (body = ไฟล์ชิ้นนั้น application/octet-stream ≤4MB)
//           POST { action: 'video-complete', shop, uploadId, parts, cost } · { action: 'video-cancel', shop, uploadId }
//           GET  ?shop=&itemId=&videoResult=<uploadId> → { ok, video: { status, url, cover, duration, message } }
//   TikTok  POST { action: 'video-stage', shop, size, type } → { path, url } ลิงก์อัปโหลดตรงไป Supabase Storage (PUT ไฟล์)
//           POST { action: 'video-upload', shop, path } → { id, url } ส่งไฟล์ที่ฝากไว้ให้ TikTok แล้วลบทิ้ง
// GET  ?shop=&itemId=&cats=1          → { ok, cats: [{ id, path }] } หมวดปลายของ Shopee
// GET  ?shop=&itemId=&catNeeds=<id>   → { ok, need: [...] } แอตทริบิวต์บังคับของหมวดใหม่ที่ตะกร้ายังไม่มีค่า (Shopee)
//
// ⚠ เขียนลงร้านจริง — ล็อกแบบเดียวกับ /api/discount/shopee:
//   ต้องปลดล็อกด้วย SALES_PIN + มาจากหน้าเว็บเราเอง (เช็ค Origin) · ?key=SYNC_SECRET ใช้แทนได้ไว้ทดสอบ
//   ลบตัวเลือก/SKU: หน้าเว็บให้พิมพ์ยืนยันก่อน · ตรวจซ้ำกับตะกร้าสดที่เซิร์ฟเวอร์ทุกครั้ง (lib/basket.js checkStructure)
import { NextResponse } from 'next/server';
import { shopeeShops, lazadaShops, tiktokShops } from '@/lib/discounts';
import {
  shopeeBasketPlan, shopeeAddOptions, shopeeSetImages, shopeeEditModels, shopeeSetStructure, shopeeSetInfo,
  shopeeCategoryList, shopeeCategoryNeeds, stForCodes, uploadBasketImage, BasketError,
} from '@/lib/basket';
import { lazadaBasketPlan, lazadaAddOptions, lazadaSetImages, lazadaEditModels, lazadaUploadImage, lazadaSetStructure, lazadaSetInfo } from '@/lib/basketLazada';
import { tiktokBasketPlan, tiktokAddOptions, tiktokSetImages, tiktokEditModels, tiktokUploadImage, tiktokSetStructure, tiktokSetInfo } from '@/lib/basketTiktok';
import { salesUnlocked } from '@/lib/pin';
import { moreInfo, brandSearch, attrSearch, setStatus, setMore } from '@/lib/basketMore';
import { shopeeVideoInit, shopeeVideoPart, shopeeVideoComplete, shopeeVideoResult, shopeeVideoCancel, tiktokVideoStage, tiktokVideoUpload } from '@/lib/basketVideo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const digits = (x) => /^\d+$/.test(String(x ?? ''));
const P = {
  shopee: { shops: shopeeShops, plan: shopeeBasketPlan, add: shopeeAddOptions, upload: uploadBasketImage, images: shopeeSetImages, edit: shopeeEditModels, structure: shopeeSetStructure, info: shopeeSetInfo, cats: shopeeCategoryList, catNeeds: shopeeCategoryNeeds },
  lazada: { shops: lazadaShops, plan: lazadaBasketPlan, add: lazadaAddOptions, upload: lazadaUploadImage, images: lazadaSetImages, edit: lazadaEditModels, structure: lazadaSetStructure, info: lazadaSetInfo },
  tiktok: { shops: tiktokShops, plan: tiktokBasketPlan, add: tiktokAddOptions, upload: tiktokUploadImage, images: tiktokSetImages, edit: tiktokEditModels, structure: tiktokSetStructure, info: tiktokSetInfo },
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
    const vr = u.searchParams.get('videoResult');
    if (vr) {
      if ((await ctx.params).platform !== 'shopee') return NextResponse.json({ ok: false, error: 'ถามผลวิดีโอได้เฉพาะ Shopee' }, { status: 400 });
      return NextResponse.json({ ok: true, video: await shopeeVideoResult(shop, vr) });
    }
    if (u.searchParams.get('more')) return NextResponse.json({ ok: true, more: await moreInfo((await ctx.params).platform, shop, itemId) });
    if (u.searchParams.get('attrSearch')) return NextResponse.json({ ok: true, values: await attrSearch((await ctx.params).platform, shop, itemId, u.searchParams.get('attrSearch'), u.searchParams.get('q') || '') });
    if (u.searchParams.get('brands') !== null) return NextResponse.json({ ok: true, brands: await brandSearch((await ctx.params).platform, shop, itemId, u.searchParams.get('brands')) });
    if (u.searchParams.get('cats')) {
      if (!pf.cats) return NextResponse.json({ ok: false, error: 'เปลี่ยนหมวดจากเว็บได้เฉพาะ Shopee' }, { status: 400 });
      return NextResponse.json({ ok: true, cats: await pf.cats(shop) });
    }
    const cn = u.searchParams.get('catNeeds');
    if (cn !== null) {
      if (!pf.catNeeds || !digits(cn)) return NextResponse.json({ ok: false, error: 'หมวดไม่ถูกต้อง' }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await pf.catNeeds(shop, itemId, Number(cn))) });
    }
    return NextResponse.json({ ok: true, plan: await pf.plan(shop, itemId) });
  } catch (e) { return fail(e); }
}

export async function POST(req, ctx) {
  const pf = await platformOf(ctx);
  if (!pf) return unknown();
  const denied = await guard(req, true);
  if (denied) return denied;
  const platform = (await ctx.params).platform;
  const u = new URL(req.url);
  // ชิ้นวิดีโอ Shopee ส่งเป็นไบต์ล้วน (ไม่ห่อ base64/JSON ให้ชิ้น 4MB ยังไม่เกินที่ Netlify รับ)
  if (u.searchParams.get('action') === 'video-part') {
    const shop = u.searchParams.get('shop') || '';
    if (platform !== 'shopee' || !(await pf.shops()).includes(shop)) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้านนี้' }, { status: 400 });
    try {
      const bytes = new Uint8Array(await req.arrayBuffer());
      return NextResponse.json({ ok: true, ...(await shopeeVideoPart(shop, u.searchParams.get('uploadId'), u.searchParams.get('seq'), bytes)) });
    } catch (e) { return fail(e); }
  }
  const b = await req.json().catch(() => ({}));
  const shop = String(b.shop || '');
  if (!(await pf.shops()).includes(shop)) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้านนี้' }, { status: 400 });
  if (String(b.action || '').startsWith('video-')) {
    const V = {
      shopee: {
        'video-init': () => shopeeVideoInit(shop, b),
        'video-complete': () => shopeeVideoComplete(shop, b.uploadId, b.parts, b.cost),
        'video-cancel': () => shopeeVideoCancel(shop, b.uploadId),
      },
      tiktok: {
        'video-stage': () => tiktokVideoStage(shop, b),
        'video-upload': () => tiktokVideoUpload(shop, b.path),
      },
    };
    const f = V[platform]?.[b.action];
    if (!f) return NextResponse.json({ ok: false, error: 'แพลตฟอร์มนี้อัปโหลดวิดีโอจากเว็บไม่ได้' }, { status: 400 });
    try {
      return NextResponse.json({ ok: true, ...(await f()) });
    } catch (e) { return fail(e); }
  }
  if (b.action === 'upload') {
    try {
      const bytes = new Uint8Array(Buffer.from(String(b.data || ''), 'base64'));
      if (!bytes.length) return NextResponse.json({ ok: false, error: 'ไม่มีรูป' }, { status: 400 });
      return NextResponse.json({ ok: true, image_id: await pf.upload(shop, bytes, String(b.type || ''), ['option', 'size_chart'].includes(b.use) ? b.use : 'main') });
    } catch (e) { return fail(e); }
  }
  if (!digits(b.itemId)) return NextResponse.json({ ok: false, error: 'itemId ไม่ถูกต้อง' }, { status: 400 });
  if (b.action === 'images') {
    const options = b.options && typeof b.options === 'object' && !Array.isArray(b.options) ? b.options : null;
    try {
      return NextResponse.json({ ok: true, ...(await pf.images({ shop, itemId: String(b.itemId), main: Array.isArray(b.main) ? b.main : null, options })) });
    } catch (e) { return fail(e); }
  }
  if (b.action === 'status') {
    try {
      return NextResponse.json({ ok: true, ...(await setStatus((await ctx.params).platform, shop, String(b.itemId), b.on === true)) });
    } catch (e) { return fail(e); }
  }
  if (b.action === 'more') {
    try {
      return NextResponse.json({ ok: true, ...(await setMore((await ctx.params).platform, shop, String(b.itemId), b)) });
    } catch (e) { return fail(e); }
  }
  if (b.action === 'structure') {
    try {
      return NextResponse.json({ ok: true, ...(await pf.structure({ shop, itemId: String(b.itemId), tiers: b.tiers, del: Array.isArray(b.del) ? b.del : [] })) });
    } catch (e) { return fail(e); }
  }
  if (b.action === 'info') {
    const str = (x) => (typeof x === 'string' ? x : null);
    const category = b.category && typeof b.category === 'object' ? { id: b.category.id, attrs: b.category.attrs || {} } : null;
    try {
      return NextResponse.json({ ok: true, ...(await pf.info({ shop, itemId: String(b.itemId), title: str(b.title), description: str(b.description), category })) });
    } catch (e) { return fail(e); }
  }
  if (b.action === 'edit') {
    try {
      return NextResponse.json({ ok: true, ...(await pf.edit({ shop, itemId: String(b.itemId), edits: Array.isArray(b.edits) ? b.edits : [] })) });
    } catch (e) { return fail(e); }
  }
  const add = Array.isArray(b.add) ? b.add.map((l) => (Array.isArray(l) ? l : [])) : [];
  const models = Array.isArray(b.models) ? b.models : [];
  if (models.length > 200) return NextResponse.json({ ok: false, error: 'SKU ใหม่เยอะเกิน (ครั้งละไม่เกิน 200)' }, { status: 400 });
  try {
    const r = await pf.add({ shop, itemId: String(b.itemId), add, models });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) { return fail(e); }
}
