// ตัวเลือกที่เหลือของตะกร้าเดียว — ปุ่ม "ดู SKU อื่น" ในหน้า /product เรียกตอนกดกาง
// หน้ารวมส่งมาแค่ 3 ตัวแรกต่อตะกร้า ที่เหลือโหลดเฉพาะตะกร้าที่คนกดดูจริง
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const u = new URL(req.url);
  const platform = u.searchParams.get('platform');
  const shop = u.searchParams.get('shop');
  const id = u.searchParams.get('id');
  const skip = Math.max(0, Number(u.searchParams.get('skip')) || 0);
  if (!platform || !shop || !id) return NextResponse.json({ ok: false, error: 'ต้องมี platform, shop, id' }, { status: 400 });

  const { data, error } = await db().from('os_listing_skus')
    .select('sku_id, seller_sku, variant, price, promo_price, stock, image_url, sort')
    .eq('platform', platform).eq('shop', shop).eq('product_id', id)
    .gte('sort', skip)
    .order('sort');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, skus: data || [] });
}
