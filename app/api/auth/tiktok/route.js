// ปลายทางที่ TikTok เด้งกลับหลังร้านกดอนุญาต — แลก code เป็นโทเคนแล้วเก็บลง DB
// เปิดหน้านี้โดยไม่มี code → พาไปหน้าอนุญาตของ TikTok
import { NextResponse } from 'next/server';
import { exchangeCode, getAuthorizedShops } from '@/lib/tiktok';
import { saveToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (!code) {
    // ลิงก์หน้าอนุญาตของแอป — เอามาจาก Partner Center (Service ID ของแอป)
    const serviceId = process.env.TIKTOK_SERVICE_ID;
    if (!serviceId) {
      return NextResponse.json({ ok: false, error: 'ยังไม่ได้ตั้ง TIKTOK_SERVICE_ID — เอามาจากหน้า App ใน Partner Center' }, { status: 400 });
    }
    const state = url.searchParams.get('shop') || 'SOLID';
    return NextResponse.redirect(
      `https://services.tiktokshop.com/open/authorize?service_id=${serviceId}&state=${encodeURIComponent(state)}`
    );
  }

  try {
    const shopLabel = url.searchParams.get('state') || 'SOLID';
    const t = await exchangeCode(code);
    const shops = await getAuthorizedShops(t.access_token);
    const s = shops[0] || {};

    await saveToken('tiktok', shopLabel, {
      shop_id: s.id ? String(s.id) : null,
      shop_cipher: s.cipher || null,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: t.access_token_expire_in ? new Date(t.access_token_expire_in * 1000).toISOString() : null,
      refresh_expires_at: t.refresh_token_expire_in ? new Date(t.refresh_token_expire_in * 1000).toISOString() : null,
      extra: { shops },
    });

    return NextResponse.json({
      ok: true,
      msg: `เชื่อมร้าน ${shopLabel} สำเร็จ`,
      shops: shops.map((x) => ({ id: x.id, name: x.name, region: x.region })),
      next: '/orders',
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
