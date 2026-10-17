// ส่องคำสั่งแก้ตะกร้า (เพิ่มสี/ไซส์/SKU) ของ TikTok / Lazada กับสินค้าทดสอบเท่านั้น — ห้ามใช้กับของจริง
//
//   POST ?key=SYNC_SECRET  { op, shop: 'SOLID', id, body? }
//     tiktok-get       → ก้อนดิบของตะกร้า (สถานะ/ตัวเลือก/skus)
//     tiktok-partial   { body } → POST /product/202309/products/{id}/partial_edit
//     tiktok-edit      { body } → PUT  /product/202309/products/{id} (แก้ทั้งก้อน)
//     lazada-get       → /product/item/get (ตัวเลือก/skus)
//     lazada-update    { body } → POST /product/update (payload = { Request: { Product: body } })
// กันพลาด: ตะกร้าต้องชื่อขึ้นต้น [TEST] และ SKU เดิมทุกตัวลงท้าย -TEST · SKU ที่ส่งมาทุกตัวต้องลงท้าย -TEST (อ่านจากร้านทุกครั้ง)
// ปิดบนเว็บจริง — ใช้บน deploy preview เท่านั้น
import { NextResponse } from 'next/server';
import * as tiktok from '@/lib/tiktok';
import * as lazada from '@/lib/lazada';
import { listShops, storedToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const isTest = (s) => String(s || '').startsWith('[TEST]');
const allTest = (list) => list.length > 0 && list.every((s) => String(s || '').endsWith('-TEST'));
// SKU ทุกตัวในก้อนที่จะส่ง (seller_sku / SellerSku) ต้องเป็น -TEST
function sentSkus(x, out = []) {
  if (Array.isArray(x)) x.forEach((y) => sentSkus(y, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (/^seller_?sku$/i.test(k)) out.push(v); else sentSkus(v, out); }
  return out;
}

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
  const id = String(b.id || '');
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: 'ต้องมี id' }, { status: 400 });
  try {
    if (b.op.startsWith('tiktok')) {
      const row = (await listShops('tiktok')).find((r) => r.shop === shop);
      const tok = storedToken(row);
      const auth = { accessToken: tok.access_token, shopCipher: tok.shop_cipher };
      const p = await tiktok.getProduct({ ...auth, productId: id });
      const view = {
        status: p.status, title: p.title, audit: p.audit,
        skus: (p.skus || []).map((s) => ({ id: s.id, seller_sku: s.seller_sku, price: s.price, inventory: s.inventory, sales_attributes: s.sales_attributes })),
      };
      if (b.op === 'tiktok-get') return NextResponse.json({ ok: true, data: view, raw: b.raw ? p : undefined });
      if (!isTest(p.title) || !allTest((p.skus || []).map((s) => s.seller_sku))) throw new Error('ไม่ใช่สินค้าทดสอบ — ไม่ทำ');
      if (!allTest(sentSkus(b.body))) throw new Error('SKU ที่ส่งต้องลงท้าย -TEST ทุกตัว');
      // ราคา/คลังของ SKU เดิม (ไม่ต้องรอตรวจ) — ใช้ตั้งคลัง 1 ชั่วคราวเพื่อดูว่าแก้ตะกร้าแล้วคลังเดิมถูกรีเซ็ตไหม
      if (b.op === 'tiktok-price') {
        const data = await tiktok.call(`/product/202309/products/${id}/prices/update`, { ...auth, method: 'POST', body: b.body });
        return NextResponse.json({ ok: true, data });
      }
      if (b.op === 'tiktok-stock') {
        const data = await tiktok.setStock({ ...auth, productId: id, skuIds: (b.skuIds || []).map(String), qty: Number(b.qty) });
        return NextResponse.json({ ok: true, data });
      }
      const path = `/product/202309/products/${id}`;
      const data = b.op === 'tiktok-partial'
        ? await tiktok.call(`${path}/partial_edit`, { ...auth, method: 'POST', body: b.body })
        : await tiktok.call(path, { ...auth, method: 'PUT', body: b.body });
      await new Promise((r) => setTimeout(r, 2000));
      const a = await tiktok.getProduct({ ...auth, productId: id });
      return NextResponse.json({ ok: true, data, after: { status: a.status, audit: a.audit, skus: (a.skus || []).map((s) => ({ id: s.id, seller_sku: s.seller_sku, price: s.price?.sale_price, qty: (s.inventory || []).reduce((n, w) => n + w.quantity, 0), attrs: (s.sales_attributes || []).map((x) => `${x.name}=${x.value_name}`).join(' | ') })) } });
    }
    const row = (await listShops('lazada')).find((r) => r.shop === shop);
    const accessToken = storedToken(row).access_token;
    const it = await lazada.getProductItem({ accessToken, itemId: id });
    if (!it) throw new Error('ไม่พบตะกร้า');
    const view = { status: it.status, name: it.attributes?.name, variation: it.variation, skus: (it.skus || []).map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !/image|package|special/i.test(k)))) };
    if (b.op === 'lazada-get') return NextResponse.json({ ok: true, data: view, raw: b.raw ? it : undefined });
    if (!isTest(it.attributes?.name) || !allTest((it.skus || []).map((s) => s.SellerSku))) throw new Error('ไม่ใช่สินค้าทดสอบ — ไม่ทำ');
    if (!allTest(sentSkus(b.body))) throw new Error('SKU ที่ส่งต้องลงท้าย -TEST ทุกตัว');
    const data = await lazada.callPost(b.path || '/product/update', { accessToken, body: { payload: JSON.stringify({ Request: { Product: { ItemId: id, ...b.body } } }) } });
    await new Promise((r) => setTimeout(r, 2000));
    const a = await lazada.getProductItem({ accessToken, itemId: id });
    return NextResponse.json({ ok: true, data, after: { status: a?.status, variation: a?.variation, skus: (a?.skus || []).map((s) => ({ SkuId: s.SkuId, SellerSku: s.SellerSku, price: s.price, quantity: s.quantity, saleProp: s.saleProp, Status: s.Status })) } });
  } catch (e) {
    return NextResponse.json({ ok: false, op: b.op, error: String(e.message || e), payload: e.payload || null });
  }
}
