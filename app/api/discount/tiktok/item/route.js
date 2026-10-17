// โปรส่วนลดของตะกร้าเดียว (TikTok) — ป็อปอัพ "แก้โปร" ในหน้ารายการสินค้า/หน้ารายละเอียด (app/product/PromoPop.js) เรียกตอนกดเปิด
// GET ?shop=&itemId= → { ok, promo, skus }  promo จาก tiktokItemPromo (ดัชนีโปรที่ยังไม่จบ จำไว้ 5 นาที) · skus = ตัวเลือกทั้งหมดของตะกร้า (os_listing_skus)
// ต้องปลดล็อก SALES_PIN แบบเดียวกับปุ่มบันทึก (/api/discount/tiktok) · ?key=SYNC_SECRET ใช้แทนได้
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { tiktokItemPromo, tiktokShops } from '@/lib/discounts';
import { salesUnlocked } from '@/lib/pin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;   // ดัชนีว่าง (หลังบันทึก/ครบ 5 นาที) ต้องอ่านทุกโปรใหม่ — โดน rate limit ได้

export async function GET(req) {
  const u = new URL(req.url);
  const key = u.searchParams.get('key');
  const byKey = Boolean(process.env.SYNC_SECRET) && key === process.env.SYNC_SECRET;
  if (!byKey && !(await salesUnlocked())) return NextResponse.json({ ok: false, error: 'ต้องใส่รหัสปลดล็อกก่อนถึงจะแก้โปรได้' }, { status: 401 });
  const shop = u.searchParams.get('shop') || '';
  const itemId = u.searchParams.get('itemId') || '';
  if (!(await tiktokShops()).includes(shop)) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้านนี้' }, { status: 400 });
  if (!/^\d+$/.test(itemId)) return NextResponse.json({ ok: false, error: 'itemId ไม่ถูกต้อง' }, { status: 400 });
  try {
    const [promo, s] = await Promise.all([
      tiktokItemPromo(shop, itemId),
      db().from('os_listing_skus').select('sku_id, seller_sku, variant, price, stock, sort')
        .eq('platform', 'tiktok').eq('shop', shop).eq('product_id', itemId).order('sort'),
    ]);
    if (s.error) throw new Error(s.error.message);
    return NextResponse.json({ ok: true, promo, skus: s.data || [] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
