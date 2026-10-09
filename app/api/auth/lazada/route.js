// ปลายทางที่ Lazada เด้งกลับหลังเจ้าของร้านกดอนุญาต
// เปิดหน้านี้เปล่าๆ (ไม่มี code) → พาไปหน้าอนุญาตของ Lazada · ระบุชื่อร้านด้วย ?shop=SOLID
import { NextResponse } from 'next/server';
import { exchangeCode, authorizeUrl } from '@/lib/lazada';
import { saveToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  // Lazada ส่ง state ที่แนบไปกลับมาให้ จึงใช้จำชื่อร้านข้ามการเด้งได้
  const shop = url.searchParams.get('shop') || url.searchParams.get('state') || 'LAZADA';

  try {
    // redirect_uri ต้องตรงกับที่ตั้งไว้ใน Lazada console (App Management → Callback URL) ทุกตัวอักษร
    const back = `${url.origin}/api/auth/lazada`;
    if (!code) return NextResponse.redirect(authorizeUrl(back, shop));

    const t = await exchangeCode(code);
    const info = (t.country_user_info || [])[0] || {};
    await saveToken('lazada', shop, {
      shop_id: String(info.seller_id || t.account || ''),
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(Date.now() + (t.expires_in || 2592000) * 1000).toISOString(),
      refresh_expires_at: new Date(Date.now() + (t.refresh_expires_in || 15552000) * 1000).toISOString(),
      extra: { account: t.account, country: t.country, country_user_info: t.country_user_info },
    });
    return NextResponse.json({ ok: true, msg: `ผูกร้าน Lazada ${shop} (${info.short_code || t.account || ''}) เรียบร้อย`, next: '/orders' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
