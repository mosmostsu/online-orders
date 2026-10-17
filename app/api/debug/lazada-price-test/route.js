// ส่อง/ทดสอบคำสั่งแก้ราคาพิเศษ Lazada กับสินค้าทดสอบเท่านั้น — ห้ามใช้กับของจริง
//
//   POST ?key=SYNC_SECRET  { op, shop: 'SOLID', itemId, ... }
//     get     → ก้อนดิบของตะกร้า (/product/item/get) เฉพาะฟิลด์ราคา/ราคาพิเศษของทุก SKU
//     price   { skus: [{ SkuId, Price?, SalePrice?, SaleStartDate?, SaleEndDate? }] } → /product/price_quantity/update (ส่งตามที่ให้)
//     update  { skus: [{ SkuId, special_price?, special_from_date?, special_to_date? }] } → /product/update (ส่งแค่ ItemId + skus ที่ให้)
// กันพลาด: เขียนได้เฉพาะตะกร้าชื่อขึ้นต้น [TEST] ที่ SellerSku ลงท้าย -TEST ทุกตัว (อ่านจาก Lazada ทุกครั้ง)
// ปิดบนเว็บจริง — ใช้บน deploy preview เท่านั้น
import { NextResponse } from 'next/server';
import * as lazada from '@/lib/lazada';
import { listShops, storedToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pickSku = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => /sku|price|special|quantity|status/i.test(k) && !/image/i.test(k)));

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
  const row = (await listShops('lazada')).find((r) => r.shop === String(b.shop || 'SOLID'));
  if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบร้าน' }, { status: 404 });
  const accessToken = storedToken(row).access_token;
  const itemId = String(b.itemId || '');
  if (!/^\d+$/.test(itemId)) return NextResponse.json({ ok: false, error: 'ต้องมี itemId' }, { status: 400 });

  try {
    const it = await lazada.getProductItem({ accessToken, itemId });
    if (!it) throw new Error('ไม่พบตะกร้า');
    const view = { item_id: it.item_id, name: it.attributes?.name, status: it.status, skus: (it.skus || []).map(pickSku) };
    if (b.op === 'get') return NextResponse.json({ ok: true, data: view });
    const sellerSkus = (it.skus || []).map((s) => s.SellerSku);
    if (!String(it.attributes?.name || '').startsWith('[TEST]') || !sellerSkus.length || sellerSkus.some((s) => !String(s || '').endsWith('-TEST'))) {
      throw new Error(`ไม่ใช่สินค้าทดสอบ ([TEST] + SKU -TEST) — ไม่ทำ ("${it.attributes?.name}")`);
    }
    const own = new Set((it.skus || []).map((s) => String(s.SkuId)));
    if ((b.skus || []).some((s) => !own.has(String(s.SkuId)))) throw new Error('SkuId ไม่ใช่ของตะกร้านี้');
    let data;
    if (b.op === 'price') {
      const skus = (b.skus || []).map((s) => `<Sku><ItemId>${x(itemId)}</ItemId><SkuId>${x(s.SkuId)}</SkuId>${
        ['Price', 'SalePrice', 'SaleStartDate', 'SaleEndDate'].filter((k) => k in s).map((k) => `<${k}>${x(s[k])}</${k}>`).join('')}</Sku>`).join('');
      const payload = `<?xml version="1.0" encoding="UTF-8" ?><Request><Product><Skus>${skus}</Skus></Product></Request>`;
      data = await lazada.callPost('/product/price_quantity/update', { accessToken, body: { payload } });
    } else if (b.op === 'update') {
      const payload = JSON.stringify({ Request: { Product: { ItemId: itemId, Skus: { Sku: (b.skus || []).map((s) => ({ ...s, SkuId: String(s.SkuId) })) } } } });
      data = await lazada.callPost('/product/update', { accessToken, body: { payload } });
    } else {
      return NextResponse.json({ ok: false, error: 'op ไม่รู้จัก' }, { status: 400 });
    }
    await new Promise((r) => setTimeout(r, 1500));
    const after = await lazada.getProductItem({ accessToken, itemId });
    return NextResponse.json({ ok: true, op: b.op, data, after: (after?.skus || []).map(pickSku) });
  } catch (e) {
    return NextResponse.json({ ok: false, op: b.op, error: String(e.message || e), payload: e.payload || null });
  }
}
