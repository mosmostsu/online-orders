// ปลายทางที่ Shopee เด้งกลับหลังเจ้าของร้านกดอนุญาต
// เปิดหน้านี้เปล่าๆ (ไม่มี code) → พาไปหน้าอนุญาตของ Shopee
import { NextResponse } from 'next/server';
import { exchangeCode, authorizeUrl } from '@/lib/shopee';
import { saveToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const shopId = url.searchParams.get('shop_id');
  // ใส่ ?shop=REAL ตอนเปิดลิงก์ เพื่อบอกว่ากำลังผูกร้านไหน
  const label = url.searchParams.get('shop') || url.searchParams.get('state') || 'SOLID';

  if (!code) {
    const back = `${url.origin}/api/auth/shopee?shop=${encodeURIComponent(label)}`;
    return NextResponse.redirect(authorizeUrl(back));
  }

  try {
    const t = await exchangeCode({ code, shopId });
    await saveToken('shopee', label, {
      shop_id: String(shopId),
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      // Shopee ให้ access_token แค่ 4 ชั่วโมง ต้องต่ออายุบ่อยกว่า TikTok มาก
      expires_at: new Date(Date.now() + (t.expire_in || 14400) * 1000).toISOString(),
      refresh_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      extra: { raw: t },
    });
    return NextResponse.json({ ok: true, msg: `ผูกร้าน Shopee ${label} (${shopId}) เรียบร้อย`, next: '/orders' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
