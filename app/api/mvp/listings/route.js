// รายการสินค้าของร้าน Shopee MVP → os_listings / os_listing_skus (หน้า /product และ /allsite)
//
// MVP ไม่มี API — ส่วนขยาย Chrome (extensions/mvp-stock) อ่านไฟล์ Mass Update "แก้ไขสินค้า" ที่โหลดมาอัปเดตคลังอยู่แล้ว
// แล้วส่งแถวทั้งไฟล์มาที่นี่ทุกรอบ (ทั้งร้านในก้อนเดียว) — ตะกร้าที่ไม่อยู่ในไฟล์รอบนี้ = ถูกลบจากร้านแล้ว ลบตาม
//
// ข้อจำกัดของไฟล์: ไม่มีรูป และไม่มีสถานะตะกร้า (ขายอยู่/ปิด/โดนแบน) จึงนับเป็น "ขายอยู่" ทั้งหมด
// ร้านนี้ไม่มีแถวใน os_shop_tokens — ฟังก์ชันคัดร้านดูจาก os_listings ด้วย (ดู supabase/049)
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { saveListings, storedListings, removeListings } from '@/lib/listings';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PLATFORM = 'shopee';
const SHOP = 'MVP';

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return String(v ?? '').trim() === '' || !Number.isFinite(n) ? null : n;
};

export async function POST(req) {
  const key = process.env.MVP_STOCK_KEY;
  if (!key || req.headers.get('x-key') !== key) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  // ไฟล์ว่าง/ส่งมาไม่ครบ ห้ามลบของเดิมทั้งร้าน
  if (rows.length < 10) return NextResponse.json({ ok: false, error: `แถวน้อยผิดปกติ (${rows.length}) — ไม่บันทึก` }, { status: 400 });

  // แถวของไฟล์ = หนึ่งตัวเลือก (สี/ไซส์) · รวมตามรหัสสินค้าเป็นตะกร้า เรียงตัวเลือกตามลำดับในไฟล์
  const byProduct = new Map();
  for (const r of rows) {
    const pid = String(r.product_id || '').trim();
    if (!pid) continue;
    if (!byProduct.has(pid)) {
      byProduct.set(pid, {
        listing: {
          platform: PLATFORM, shop: SHOP, product_id: pid,
          title: r.title || null, thumb_url: null, status: 'NORMAL',
          item_sku: r.parent_sku || null, remote_updated_at: null, remote_created_at: null,
        },
        skus: [],
      });
    }
    const x = byProduct.get(pid);
    const skuId = String(r.variation_id || '').trim() || pid;   // ตะกร้าไม่มีตัวเลือก ใช้รหัสสินค้าแทน
    if (x.skus.some((s) => s.sku_id === skuId)) continue;
    x.skus.push({
      platform: PLATFORM, shop: SHOP, product_id: pid, sku_id: skuId,
      seller_sku: String(r.sku || '').trim() || null,
      variant: r.variant || null,
      price: num(r.price), promo_price: null, stock: num(r.stock),
      image_url: null, sort: x.skus.length,
    });
  }
  const items = [...byProduct.values()];

  try {
    let saved = 0;
    for (let i = 0; i < items.length; i += 50) saved += await saveListings(items.slice(i, i + 50));
    const alive = new Set(byProduct.keys());
    const gone = (await storedListings(PLATFORM, SHOP)).map((s) => s.product_id).filter((id) => !alive.has(id));
    const removed = await removeListings(PLATFORM, SHOP, gone);

    // รายการ "SKU ไหนลงร้านไหน" ของหน้า /allsite (supabase/036) — แบบเดียวกับรอบดึงสินค้าของร้านอื่น
    revalidateTag('listings');
    const { data: refreshed } = await db().rpc('os_st_on_refresh', { p_min_age: 0 }).then((r) => r, () => ({}));
    if (refreshed > 0) revalidateTag('allsite');
    return NextResponse.json({ ok: true, listings: saved, skus: rows.length, removed });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
