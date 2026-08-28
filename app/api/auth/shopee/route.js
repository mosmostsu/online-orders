// ปลายทางที่ Shopee เด้งกลับหลังเจ้าของร้านกดอนุญาต
// เปิดหน้านี้เปล่าๆ (ไม่มี code) → พาไปหน้าอนุญาตของ Shopee
import { NextResponse } from 'next/server';
import { exchangeCode, authorizeUrl } from '@/lib/shopee';
import { saveToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

// แต่ละร้านอาจอยู่คนละแอปของ Shopee — เลือกด้วย ?p=REAL ตอนเปิดลิงก์
// ถ้าไม่ระบุก็ใช้ชุดหลัก (SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY)
function partnerFromEnv(tag) {
  const suffix = tag ? `_${tag.toUpperCase()}` : '';
  const id = process.env[`SHOPEE_PARTNER_ID${suffix}`];
  const key = process.env[`SHOPEE_PARTNER_KEY${suffix}`];
  return id && key ? { partner_id: id, partner_key: key } : null;
}

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const shopId = url.searchParams.get('shop_id');
  // Shopee ไม่ส่ง query ที่เราแนบไปกลับมา จึงจำแอปที่เลือกไว้ใน state ของ redirect url
  const tag = url.searchParams.get('p') || '';
  const partner = partnerFromEnv(tag);
  // Shopee เอา ?code=..&shop_id=.. ไปต่อท้าย redirect url ที่เราตั้งไว้
  // จึงใส่ชื่อร้านไปกับ url ไม่ได้ ต้องตั้งจาก shop_id ที่ได้กลับมาแทน แล้วเปลี่ยนชื่อทีหลัง
  const label = url.searchParams.get('shop') || (shopId ? `SHOPEE-${shopId}` : 'SHOPEE');

  if (!code) {
    if (!partner) {
      return NextResponse.json({ ok: false, error: `ไม่รู้จักแอป "${tag}" — ยังไม่ได้ตั้ง SHOPEE_PARTNER_ID_${tag.toUpperCase()}` }, { status: 400 });
    }
    // ใส่ ?p= กลับมาด้วย จะได้รู้ว่าตอนแลกโทเคนต้องใช้กุญแจของแอปไหน
    const back = `${url.origin}/api/auth/shopee${tag ? `?p=${encodeURIComponent(tag)}` : ''}`;
    return NextResponse.redirect(authorizeUrl(back, partner));
  }

  try {
    const t = await exchangeCode({ code, shopId, partner });
    await saveToken('shopee', label, {
      shop_id: String(shopId),
      // เก็บไว้ว่าร้านนี้ใช้แอปไหน ตอนดึงออเดอร์จะได้เซ็นด้วยกุญแจที่ถูกตัว
      partner_id: partner?.partner_id || process.env.SHOPEE_PARTNER_ID,
      partner_key: partner?.partner_key || process.env.SHOPEE_PARTNER_KEY,
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
