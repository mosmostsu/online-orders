// ติดตั้งร้าน TikTok ครั้งเดียวจบ — เอาโทเคนที่มีอยู่แล้ว (จากสคริปต์ Colab) ใส่ลง DB
// เปิด /api/setup/tiktok?key=SYNC_SECRET  ครั้งเดียวหลัง deploy
// ไม่ต้องทำ OAuth ใหม่ = ไม่ไปล้มโทเคนที่ Colab ใช้อยู่
import { NextResponse } from 'next/server';
import { getAuthorizedShops } from '@/lib/tiktok';
import { saveToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  if (process.env.SYNC_SECRET && url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }

  const access = process.env.TIKTOK_ACCESS_TOKEN;
  const refresh = process.env.TIKTOK_REFRESH_TOKEN;
  if (!access) return NextResponse.json({ ok: false, error: 'ยังไม่ได้ตั้ง TIKTOK_ACCESS_TOKEN' }, { status: 400 });

  try {
    const shops = await getAuthorizedShops(access);
    const wanted = process.env.TIKTOK_SHOP_ID;
    const target = shops.find((s) => String(s.id) === wanted) || shops[0];
    if (!target) return NextResponse.json({ ok: false, error: 'โทเคนใช้ได้แต่ไม่เห็นร้านเลย' }, { status: 400 });

    await saveToken('tiktok', url.searchParams.get('shop') || 'SOLID', {
      shop_id: String(target.id),
      shop_cipher: target.cipher,
      access_token: access,
      refresh_token: refresh || null,
      // โทเคน TikTok อยู่ได้ ~7 วัน — ไม่รู้เวลาหมดที่แน่นอน เดาไว้ 6 วันเพื่อให้ต่ออายุก่อน
      expires_at: new Date(Date.now() + 6 * 86400000).toISOString(),
      extra: { shops },
    });

    return NextResponse.json({
      ok: true,
      msg: `ผูกร้าน ${target.name} เรียบร้อย — ไปที่ /orders แล้วกดดึงออเดอร์ได้เลย`,
      shops: shops.map((s) => ({ id: s.id, name: s.name, region: s.region })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
