// เปลี่ยนชื่อร้านที่ผูกไว้ — ใช้หลังกดอนุญาต เพราะตอนนั้นเรารู้แค่ shop_id
// เรียก: /api/shops/rename?key=SYNC_SECRET&platform=shopee&from=SHOPEE-123456&to=SOLID
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  if (process.env.SYNC_SECRET && url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const platform = url.searchParams.get('platform') || 'shopee';
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const sb = db();
  if (!from || !to) {
    const { data } = await sb.from('os_shop_tokens').select('platform, shop, shop_id, updated_at');
    return NextResponse.json({ ok: true, shops: data || [], วิธีใช้: 'ใส่ &from=ชื่อเดิม&to=ชื่อใหม่' });
  }

  // เปลี่ยนทั้งตารางโทเคนและออเดอร์ที่ดึงมาแล้ว ให้ชื่อร้านตรงกันทั้งระบบ
  const { error: e1 } = await sb.from('os_shop_tokens').update({ shop: to }).eq('platform', platform).eq('shop', from);
  if (e1) return NextResponse.json({ ok: false, error: e1.message }, { status: 500 });
  const { error: e2 } = await sb.from('os_orders').update({ shop: to }).eq('platform', platform).eq('shop', from);
  if (e2) return NextResponse.json({ ok: false, error: e2.message }, { status: 500 });

  return NextResponse.json({ ok: true, msg: `เปลี่ยนชื่อร้าน ${from} เป็น ${to} แล้ว` });
}
