// สินค้าในโปรส่วนลด Shopee หนึ่งโปร (รายตัวเลือก) — ปุ่ม "ดูสินค้า" ในหน้า /discount · อ่านอย่างเดียว
// GET ?shop=SOLID&id=<discount_id> → { ok, rows: [{ item_id, sku_id, item_name, model_name, seller_sku, price, promo, stock, promo_stock, limit }] }
// เติมเลข SKU ร้าน (seller_sku) จากที่เก็บไว้ใน os_listing_skus — Shopee ไม่ส่งมาในก้อนโปร
import { NextResponse } from 'next/server';
import { getDiscount, discountRows } from '@/lib/shopee';
import { listShops, usableToken } from '@/lib/tokens';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req) {
  const u = new URL(req.url);
  const shop = u.searchParams.get('shop');
  const id = u.searchParams.get('id');
  if (!shop || !/^\d+$/.test(String(id || ''))) return NextResponse.json({ ok: false, error: 'ต้องมี shop และ id' }, { status: 400 });
  try {
    const row = (await listShops('shopee')).find((r) => r.shop === shop);
    if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบโทเคนของร้านนี้' }, { status: 404 });
    const tok = await usableToken(row);
    const d = await getDiscount({ accessToken: tok.access_token, shopId: tok.shop_id, partner: tok, discountId: id });
    const rows = discountRows(d);

    const itemIds = [...new Set(rows.map((r) => r.item_id))];
    const skuOf = new Map();
    for (let i = 0; i < itemIds.length; i += 200) {
      const { data, error } = await db().from('os_listing_skus').select('product_id, sku_id, seller_sku')
        .eq('platform', 'shopee').eq('shop', shop).in('product_id', itemIds.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const s of data || []) skuOf.set(`${s.product_id}:${s.sku_id}`, s.seller_sku);
    }
    for (const r of rows) r.seller_sku = skuOf.get(`${r.item_id}:${r.sku_id}`) || null;
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
