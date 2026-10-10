// รายการสินค้าของร้าน Thaimart (Solid Sports) → os_listings / os_listing_skus (หน้า /product และ /allsite)
//
// Thaimart ไม่มี API สาธารณะ — ส่วนขยาย Chrome (extensions/thaimart-stock) ดึงสินค้าทั้งร้านจากหน้า Seller Center
// อยู่แล้วตอนอัปเดตคลัง จึงส่งรายการทั้งร้านมาที่นี่ในก้อนเดียว (ตะกร้าที่ไม่อยู่ในรอบนี้ = ถูกลบจากร้านแล้ว ลบตาม)
// รูปแบบเดียวกับ /api/mvp/listings แต่ Thaimart ให้รูปและสถานะสินค้าด้วย
//
// ป้องกันด้วย header x-key = MVP_STOCK_KEY (กุญแจเดียวกับส่วนขยาย MVP — ทำได้แค่ส่งรายการสินค้าเข้ามา)
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { saveListings, storedListings, removeListings } from '@/lib/listings';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PLATFORM = 'thaimart';
const SHOP = 'SOLID';

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return String(v ?? '').trim() === '' || !Number.isFinite(n) ? null : n;
};

// สถานะของ Thaimart (PRODUCT_STATUS_*) → ค่ากลางที่หน้า /product รู้จัก (lib/listings.js)
function mapStatus(s) {
  const t = String(s || '').toUpperCase();
  if (t.includes('PUBLISHED') && !t.includes('UN')) return 'ACTIVATE';
  if (t.includes('DRAFT')) return 'DRAFT';
  if (/UNPUBLISH|UNLIST|INACTIVE|HIDDEN|OFFSHELF/.test(t)) return 'UNLIST';
  if (/SUSPEND|BAN|BLOCK|FREEZE|REJECT/.test(t)) return 'BANNED';
  if (/REVIEW|PENDING|WAIT/.test(t)) return 'REVIEWING';
  return t || null;
}

export async function POST(req) {
  const key = process.env.MVP_STOCK_KEY;
  if (!key || req.headers.get('x-key') !== key) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const products = Array.isArray(body.products) ? body.products : [];
  // ส่งมาไม่ครบ ห้ามลบของเดิมทั้งร้าน
  if (products.length < 10) {
    return NextResponse.json({ ok: false, error: `ตะกร้าน้อยผิดปกติ (${products.length}) — ไม่บันทึก` }, { status: 400 });
  }

  // products[i] = { id, title, thumb, status, created, updated, variants: [{ id, sku, variant, price, stock, image }] }
  const items = [];
  let skuCount = 0;
  for (const p of products) {
    const pid = String(p.id || '').trim();
    if (!pid) continue;
    const skus = [];
    for (const v of p.variants || []) {
      const skuId = String(v.id || '').trim();
      if (!skuId || skus.some((s) => s.sku_id === skuId)) continue;
      skus.push({
        platform: PLATFORM, shop: SHOP, product_id: pid, sku_id: skuId,
        seller_sku: String(v.sku || '').trim() || null,
        variant: v.variant || null,
        price: num(v.price), promo_price: null, stock: num(v.stock),
        image_url: v.image || null, sort: skus.length,
      });
    }
    skuCount += skus.length;
    items.push({
      listing: {
        platform: PLATFORM, shop: SHOP, product_id: pid,
        title: p.title || null, thumb_url: p.thumb || null, status: mapStatus(p.status),
        item_sku: null,
        remote_updated_at: p.updated || null, remote_created_at: p.created || null,
      },
      skus,
    });
  }

  try {
    let saved = 0;
    for (let i = 0; i < items.length; i += 50) saved += await saveListings(items.slice(i, i + 50));
    const alive = new Set(items.map((x) => x.listing.product_id));
    const gone = (await storedListings(PLATFORM, SHOP)).map((s) => s.product_id).filter((id) => !alive.has(id));
    const removed = await removeListings(PLATFORM, SHOP, gone);

    // รายการ "SKU ไหนลงร้านไหน" ของหน้า /allsite (supabase/036)
    revalidateTag('listings');
    const { data: refreshed } = await db().rpc('os_st_on_refresh', { p_min_age: 0 }).then((r) => r, () => ({}));
    if (refreshed > 0) revalidateTag('allsite');
    return NextResponse.json({ ok: true, listings: saved, skus: skuCount, removed });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
