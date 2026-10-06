// ปลายทางที่ TikTok เด้งกลับหลังร้านกดอนุญาต — แลก code เป็นโทเคนแล้วเก็บลง DB
// เปิดหน้านี้โดยไม่มี code → พาไปหน้าอนุญาตของ TikTok
import { NextResponse } from 'next/server';
import { exchangeCode, getAuthorizedShops } from '@/lib/tiktok';
import { saveToken, listShops } from '@/lib/tokens';

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
    // ไม่มีค่าเริ่มต้น: ถ้าไม่รู้ว่าเป็นร้านไหนต้องหยุด ไม่งั้นโทเคนร้านใหม่ไปทับร้านที่ผูกอยู่แล้ว
    const shopLabel = url.searchParams.get('state') || url.searchParams.get('shop');
    if (!shopLabel) {
      return NextResponse.json({ ok: false, error: 'ไม่รู้ว่าเป็นร้านไหน — เปิดผ่าน /api/auth/tiktok?shop=ชื่อร้าน (ไม่ได้แลก code)' }, { status: 400 });
    }
    const t = await exchangeCode(code);
    const shops = await getAuthorizedShops(t.access_token);
    const s = shops[0] || {};

    // ร้านชื่อนี้ผูกไว้แล้วแต่เป็นคนละร้านจริง → ไม่ทับ
    const old = (await listShops('tiktok')).find((r) => r.shop === shopLabel);
    if (old?.shop_id && s.id && String(old.shop_id) !== String(s.id)) {
      return NextResponse.json({
        ok: false,
        error: `ชื่อ ${shopLabel} ผูกกับร้าน id ${old.shop_id} อยู่แล้ว แต่ที่เพิ่งอนุญาตคือ ${s.name || ''} (id ${s.id}) — ไม่ได้บันทึก ตรวจว่าล็อกอินถูกร้านและตั้งชื่อถูกไหม`,
      }, { status: 409 });
    }

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
