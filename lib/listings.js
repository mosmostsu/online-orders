// บันทึกรายการสินค้าทั้งร้าน → os_listings + os_listing_skus (ดู supabase/030)
import { db } from './supabase.js';

const nums = (arr) => arr.filter((v) => v !== null && v !== undefined).map(Number);
const min = (a) => (a.length ? Math.min(...a) : null);
const max = (a) => (a.length ? Math.max(...a) : null);

// items = [{ listing, skus }] จาก normalizeListing ของแต่ละแพลตฟอร์ม
// ตัวเลือกเขียนใหม่ทั้งชุดต่อตะกร้า — ร้านลบ/เพิ่มสีไซส์ได้ upsert อย่างเดียวจะค้างตัวที่ลบไปแล้ว
export async function saveListings(items) {
  if (!items.length) return 0;
  const sb = db();
  const now = new Date().toISOString();
  const listings = items.map(({ listing, skus }) => {
    const prices = nums(skus.map((s) => s.price));
    const promos = nums(skus.map((s) => s.promo_price));
    const stocks = nums(skus.map((s) => s.stock));
    return {
      ...listing,
      sku_n: skus.length,
      price_min: min(prices), price_max: max(prices),
      promo_min: min(promos), promo_max: max(promos),
      stock: stocks.length ? stocks.reduce((a, b) => a + b, 0) : null,
      min_stock: min(stocks),   // แท็บ "เหลือ ≤2" ของหน้า /product (ดู supabase/031)
      // มีเฉพาะ Shopee (ดู supabase/032) — ใส่ทุกแถวเสมอ upsert ทีละชุดยึดคอลัมน์ให้ตรงกันทุกแถว
      deboost: listing.deboost ?? null,
      violation: listing.violation ?? null,
      synced_at: now,
    };
  });

  const { platform, shop } = listings[0];
  const ids = listings.map((l) => l.product_id);
  const { error: e1 } = await sb.from('os_listing_skus').delete()
    .eq('platform', platform).eq('shop', shop).in('product_id', ids);
  if (e1) throw new Error(e1.message);

  const skus = items.flatMap((x) => x.skus);
  for (let i = 0; i < skus.length; i += 500) {
    const { error } = await sb.from('os_listing_skus')
      .upsert(skus.slice(i, i + 500), { onConflict: 'platform,shop,sku_id' });
    if (error) throw new Error(error.message);
  }
  const { error: e2 } = await sb.from('os_listings').upsert(listings, { onConflict: 'platform,shop,product_id' });
  if (e2) throw new Error(e2.message);
  return listings.length;
}

// ของที่เก็บไว้แล้วของร้านนี้ — ใช้ตัดสินว่าตะกร้าไหนต้องดึงใหม่
export async function storedListings(platform, shop) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('os_listings')
      .select('product_id, remote_updated_at, synced_at')
      .eq('platform', platform).eq('shop', shop)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ตะกร้าที่ไม่อยู่ในรายการของแพลตฟอร์มแล้ว (ลบ/ย้ายไปถังขยะ) — ลบออกจากหน้าเราด้วย
export async function removeListings(platform, shop, productIds) {
  if (!productIds.length) return 0;
  const sb = db();
  for (let i = 0; i < productIds.length; i += 300) {
    const chunk = productIds.slice(i, i + 300);
    await sb.from('os_listing_skus').delete().eq('platform', platform).eq('shop', shop).in('product_id', chunk);
    const { error } = await sb.from('os_listings').delete().eq('platform', platform).eq('shop', shop).in('product_id', chunk);
    if (error) throw new Error(error.message);
  }
  return productIds.length;
}

// ── สถานะตะกร้า — แต่ละแพลตฟอร์มเรียกไม่เหมือนกัน รวมเป็น 3 กลุ่มตามแท็บของหลังร้าน ──
const LIVE = ['NORMAL', 'ACTIVATE', 'ONSHELF'];
const OFF = ['UNLIST', 'SELLER_DEACTIVATED', 'DRAFT', 'OFFSHELF'];
export function listingGroup(status) {
  if (LIVE.includes(status)) return 'live';
  if (OFF.includes(status)) return 'off';
  return 'problem';   // ถูกระงับ / รอตรวจ / ไม่ผ่าน
}
const LABEL = {
  NORMAL: 'ขายอยู่', ACTIVATE: 'ขายอยู่', ONSHELF: 'ขายอยู่',
  UNLIST: 'ไม่แสดง', SELLER_DEACTIVATED: 'ไม่แสดง', DRAFT: 'ฉบับร่าง', OFFSHELF: 'ไม่แสดง',
  BANNED: 'ถูกระงับ', PLATFORM_DEACTIVATED: 'ถูกระงับ', FREEZE: 'ถูกระงับ', SHOPEE_DELETE: 'Shopee ลบ',
  REVIEWING: 'รอตรวจสอบ', PENDING: 'รอตรวจสอบ', FAILED: 'ไม่ผ่านตรวจ',
};
export const listingLabel = (s) => LABEL[s] || s || '—';

// แท็บบนหน้า /product ตามหลังร้าน Shopee: ขายอยู่ · การละเมิด · อยู่ระหว่างตรวจสอบ · ยังไม่ลงขาย
// แท็บทับกันได้เหมือนหลังร้าน: ตะกร้าที่ยังขายอยู่แต่ "ถูกลดการมองเห็น" (deboost) อยู่ทั้งขายอยู่และการละเมิด
// (REAL ขายอยู่ 1,065 ของหลังร้านนับกระเป๋า 9352343678 ที่โดนลดการมองเห็นรวมไปด้วย)
const BANNED = ['BANNED', 'PLATFORM_DEACTIVATED', 'FREEZE', 'FAILED', 'SHOPEE_DELETE'];
const REVIEW = ['REVIEWING', 'PENDING'];
export function inListingTab(r, tab) {
  if (tab === 'all') return true;
  if (tab === 'live') return LIVE.includes(r.status);
  if (tab === 'banned') return BANNED.includes(r.status) || Boolean(r.deboost);
  if (tab === 'review') return REVIEW.includes(r.status);
  // ยังไม่ลงขาย = ปิดไว้ / ฉบับร่าง / สถานะที่ยังไม่รู้จัก
  return !LIVE.includes(r.status) && !BANNED.includes(r.status) && !REVIEW.includes(r.status);
}
// สีป้ายสถานะ
export function listingTone(r) {
  if (BANNED.includes(r.status) || r.deboost) return 'err';
  if (LIVE.includes(r.status)) return 'ok';
  if (REVIEW.includes(r.status)) return 'warn';
  return 'dim';
}
