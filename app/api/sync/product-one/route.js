// รีเฟรชตะกร้าเฉพาะใบที่ระบุ จากแพลตฟอร์มโดยตรง — ปุ่ม ↻ ท้ายแถวในหน้า /compare
//
// POST { items: [{ platform, shop, id }, ...] }  (ไม่เกิน 12 ใบต่อคำขอ)
// ได้ { ok, results: [{ platform, shop, id, ok, skus } | { ..., skipped } | { ..., error }] }
//
// ใช้ตัวแปลงเดียวกับรอบดึงสินค้า (app/api/sync/products) แล้วบันทึกทับตะกร้านั้นด้วย saveListings
// ร้านที่ไม่มี API (Shopee MVP, ThisShop, Thaimart) ข้ามพร้อมบอกเหตุผล ไม่ถือเป็นข้อผิดพลาด
// Lazada ไม่มีคำขอ "ตะกร้าเดียว" ในแบบเดียวกับตอนดึงทั้งร้าน — ถามด้วย sku_seller_list ของตะกร้านั้นแทน
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import * as shopee from '@/lib/shopee';
import * as tiktok from '@/lib/tiktok';
import * as lazada from '@/lib/lazada';
import { saveListings } from '@/lib/listings';
import { listShops, usableToken } from '@/lib/tokens';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const API_PLATFORMS = ['shopee', 'tiktok', 'lazada'];
const MAX_ITEMS = 12;

async function refreshShopee(row, id) {
  const auth = { accessToken: row.access_token, shopId: row.shop_id, partner: row };
  const bases = await shopee.getItemBaseInfo({ ...auth, itemIds: [id] });
  const b = bases.find((x) => String(x.item_id) === id);
  if (!b) throw new Error('Shopee ไม่พบตะกร้านี้ (ถูกลบหรือถูกระงับ)');
  const models = b.has_model ? await shopee.getModelList({ ...auth, itemId: b.item_id }) : null;
  const item = shopee.normalizeListing(b, models, row.shop);
  // ยอดขายสะสม (หน้า /summary) — พังก็ไม่ให้การรีเฟรชพัง
  const sales = await shopee.getItemSales({ ...auth, itemIds: [id] }).catch(() => new Map());
  if (sales.has(id)) item.listing.sold_total = sales.get(id);
  await saveListings([item]);
  return item.skus.length;
}

async function refreshTiktok(row, id) {
  const auth = { accessToken: row.access_token, shopCipher: row.shop_cipher };
  const item = tiktok.normalizeListing(await tiktok.getProduct({ ...auth, productId: id }), row.shop);
  await saveListings([item]);
  return item.skus.length;
}

async function refreshLazada(row, id) {
  // SKU ที่เก็บไว้ของตะกร้านี้ — ใช้ถามกลับว่าตะกร้าที่มี SKU เหล่านี้ตอนนี้หน้าตาเป็นยังไง
  const { data: stored, error } = await db().from('os_listing_skus')
    .select('seller_sku').eq('platform', 'lazada').eq('shop', row.shop).eq('product_id', id);
  if (error) throw new Error(error.message);
  const sellerSkus = [...new Set((stored || []).map((s) => s.seller_sku).filter(Boolean))].slice(0, 20);
  if (!sellerSkus.length) throw new Error('ตะกร้านี้ไม่มี SKU ในระบบ ใช้ถาม Lazada ไม่ได้');
  const { data: l } = await db().from('os_listings')
    .select('status').eq('platform', 'lazada').eq('shop', row.shop).eq('product_id', id).maybeSingle();
  const j = await lazada.call('/products/get', {
    accessToken: row.access_token,
    params: { filter: 'all', sku_seller_list: JSON.stringify(sellerSkus), limit: '10', offset: '0' },
  });
  const p = (j.data?.products || []).find((x) => String(x.item_id) === id);
  if (!p) throw new Error('Lazada ไม่พบตะกร้านี้ (ถูกลบแล้ว หรือ SKU ถูกเปลี่ยนทั้งหมด) — ลองซิงค์ทั้งกลุ่ม');
  // สถานะ: คำขอนี้ไม่บอกสถานะ ใช้ของเดิมที่เก็บไว้ (ซิงค์ทั้งกลุ่มจะอัปเดตให้ถูกเอง)
  const item = lazada.normalizeListing(p, row.shop, l?.status || 'NORMAL');
  await saveListings([item]);
  return item.skus.length;
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((x) => ({ platform: String(x?.platform || ''), shop: String(x?.shop || ''), id: String(x?.id || '') }))
    .filter((x) => x.platform && x.shop && x.id)
    .slice(0, MAX_ITEMS);
  if (!items.length) return NextResponse.json({ ok: false, error: 'ไม่มีตะกร้าให้รีเฟรช' }, { status: 400 });

  // ร้านเดียวกันทำทีละใบ (กันต่ออายุโทเคนซ้อนกัน) ต่างร้านทำพร้อมกัน
  const byShop = new Map();
  for (const it of items) {
    const k = `${it.platform}:${it.shop}`;
    if (!byShop.has(k)) byShop.set(k, []);
    byShop.get(k).push(it);
  }

  const results = [];
  await Promise.all([...byShop.values()].map(async (group) => {
    const { platform, shop } = group[0];
    if (!API_PLATFORMS.includes(platform)) {
      for (const it of group) results.push({ ...it, skipped: 'ร้านนี้ไม่มี API ให้ดึงรายตะกร้า' });
      return;
    }
    let row;
    try {
      const rows = await listShops(platform);
      const found = rows.find((r) => r.shop === shop);
      if (!found) {
        for (const it of group) results.push({ ...it, skipped: 'ไม่พบโทเคนของร้านนี้ (ไม่มี API)' });
        return;
      }
      row = await usableToken(found);
    } catch (e) {
      for (const it of group) results.push({ ...it, error: String(e.message || e) });
      return;
    }
    for (const it of group) {
      try {
        const skus = platform === 'shopee' ? await refreshShopee(row, it.id)
          : platform === 'tiktok' ? await refreshTiktok(row, it.id)
            : await refreshLazada(row, it.id);
        results.push({ ...it, ok: true, skus });
      } catch (e) {
        results.push({ ...it, error: String(e.message || e) });
      }
    }
  }));

  // ล้างที่จำไว้ของหน้า /compare, /product, /allsite — ให้หน้าถัดไปเห็นของใหม่
  if (results.some((r) => r.ok)) {
    revalidateTag('listings');
    revalidateTag('allsite');
  }
  return NextResponse.json({ ok: true, results });
}
