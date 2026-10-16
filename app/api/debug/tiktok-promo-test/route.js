// ส่อง/ทดสอบคำสั่งแก้โปร TikTok ทีละขั้น กับสินค้า+โปรทดสอบเท่านั้น — ห้ามใช้กับของจริง
//
//   POST ?key=SYNC_SECRET  { op, shop: 'SOLID', ... }
//     create      { type: DIRECT_DISCOUNT|FIXED_PRICE, level: PRODUCT|VARIATION }  → สร้างโปร "[TEST] ลบได้ …" เริ่มอีก 2 ชม.
//     activity    { activityId }                     → ก้อนดิบของโปร
//     product     { productId }                      → ก้อนดิบของสินค้า (ดูชื่อ/สถานะ/skus)
//     update      { activityId, products }           → PUT .../products (ส่ง products ตรงๆ)
//     remove      { activityId, productIds, skuIds } → DELETE .../products
//     deactivate  { activityId }                     → ปิดโปร
// กันพลาด: เขียนได้เฉพาะโปรที่ชื่อขึ้นต้น [TEST] และทุกสินค้าที่ส่งต้องชื่อขึ้นต้น [TEST] (อ่านจาก TikTok ทุกครั้ง)
// ปิดบนเว็บจริง — ใช้บน deploy preview เท่านั้น
import { NextResponse } from 'next/server';
import * as tiktok from '@/lib/tiktok';
import { listShops, storedToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const isTest = (s) => String(s || '').startsWith('[TEST]');

export async function POST(req) {
  const url = new URL(req.url);
  const prodHost = (() => { try { return new URL(process.env.URL || '').host; } catch { return ''; } })();
  if (process.env.CONTEXT === 'production' || (prodHost && url.host === prodHost)) {
    return NextResponse.json({ ok: false, error: 'ปิดบนเว็บจริง — ใช้บน deploy preview เท่านั้น' }, { status: 404 });
  }
  if (!process.env.SYNC_SECRET || url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const b = await req.json().catch(() => ({}));
  const shop = String(b.shop || 'SOLID');
  const row = (await listShops('tiktok')).find((r) => r.shop === shop);
  if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบร้าน' }, { status: 404 });
  const tok = storedToken(row);
  const auth = { accessToken: tok.access_token, shopCipher: tok.shop_cipher };

  const guardActivity = async (id) => {
    const a = await tiktok.getActivity({ ...auth, activityId: id });
    if (!isTest(a.title)) throw new Error(`โปร ${id} ไม่ใช่ [TEST] ("${a.title}") — ไม่ทำ`);
    return a;
  };
  const guardProducts = async (ids) => {
    for (const id of new Set(ids.map(String))) {
      const p = await tiktok.getProduct({ ...auth, productId: id });
      if (!isTest(p.title)) throw new Error(`สินค้า ${id} ไม่ใช่ [TEST] ("${p.title}") — ไม่ทำ`);
    }
  };

  try {
    let data;
    if (b.op === 'create') {
      const now = Math.floor(Date.now() / 1000);
      data = await tiktok.createActivity({
        ...auth,
        body: {
          title: `[TEST] ลบได้ ${new Date().toISOString().slice(5, 16).replace('T', ' ')}`,
          activity_type: b.type || 'DIRECT_DISCOUNT', product_level: b.level || 'VARIATION',
          begin_time: now + 2 * 3600, end_time: now + 26 * 3600,
        },
      });
    } else if (b.op === 'activity') {
      data = await tiktok.getActivity({ ...auth, activityId: b.activityId });
    } else if (b.op === 'product') {
      data = await tiktok.getProduct({ ...auth, productId: b.productId });
    } else if (b.op === 'update') {
      await guardActivity(b.activityId);
      await guardProducts((b.products || []).map((p) => p.id));
      data = await tiktok.updateActivityProducts({ ...auth, activityId: b.activityId, products: b.products || [] });
    } else if (b.op === 'remove') {
      const a = await guardActivity(b.activityId);
      // sku_ids: หาว่าเป็นของตะกร้าไหนจากก้อนโปร แล้วเช็คตะกร้านั้นด้วย
      const skuPid = (a.products || []).filter((p) => (p.skus || []).some((s) => (b.skuIds || []).map(String).includes(String(s.id)))).map((p) => p.id);
      await guardProducts([...(b.productIds || []), ...skuPid]);
      if ((b.skuIds || []).length && !skuPid.length) throw new Error('sku_ids ไม่อยู่ในโปรนี้ — ไม่ทำ');
      data = await tiktok.removeActivityProducts({ ...auth, activityId: b.activityId, productIds: b.productIds || [], skuIds: b.skuIds || [] });
    } else if (b.op === 'deactivate') {
      await guardActivity(b.activityId);
      data = await tiktok.deactivateActivity({ ...auth, activityId: b.activityId });
    } else {
      return NextResponse.json({ ok: false, error: 'op ไม่รู้จัก' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, op: b.op, data });
  } catch (e) {
    return NextResponse.json({ ok: false, op: b.op, error: String(e.message || e), payload: e.payload || null });
  }
}
