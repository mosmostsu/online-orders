// ปลายทางที่ TikTok เด้งกลับหลังร้านกดอนุญาต — แลก code เป็นโทเคนแล้วเก็บลง DB
// เปิดหน้านี้โดยไม่มี code → พาไปหน้าอนุญาตของ TikTok
import { NextResponse } from 'next/server';
import { exchangeCode, getAuthorizedShops, appByKey, bindToken } from '@/lib/tiktok';
import { saveToken, listShops } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (!code) {
    // ลิงก์หน้าอนุญาตของแอป — เอามาจาก Partner Center (Service ID ของแอป)
    // ?app=MVP = ร้านที่ใช้แอปของตัวเอง → ใช้ TIKTOK_SERVICE_ID_MVP (ไม่ใส่ = แอปหลัก)
    const appName = (url.searchParams.get('app') || '').toUpperCase();
    const idName = appName ? `TIKTOK_SERVICE_ID_${appName}` : 'TIKTOK_SERVICE_ID';
    const serviceId = process.env[idName];
    if (!serviceId) {
      return NextResponse.json({ ok: false, error: `ยังไม่ได้ตั้ง ${idName} — เอามาจากหน้า App ใน Partner Center` }, { status: 400 });
    }
    const state = url.searchParams.get('shop');
    if (!state) {
      return NextResponse.json({ ok: false, error: 'ระบุชื่อร้านด้วย เช่น /api/auth/tiktok?shop=MVP' }, { status: 400 });
    }
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
    // TikTok แนบ app_key ของแอปที่ออก code มาให้ — ใช้เลือกคีย์ที่จะแลกโทเคน (ไม่แนบ = แอปหลัก)
    const callbackKey = url.searchParams.get('app_key');
    const app = callbackKey ? appByKey(callbackKey) : '';
    if (app === undefined) {
      return NextResponse.json({
        ok: false,
        error: `code นี้ออกโดยแอป ${callbackKey} ซึ่งยังไม่ได้ตั้งคีย์ — ตั้ง TIKTOK_APP_KEY_ชื่อ / TIKTOK_APP_SECRET_ชื่อ ใน Netlify แล้ว deploy ใหม่ (ไม่ได้แลก code)`,
      }, { status: 400 });
    }
    const t = await exchangeCode(code, app);
    bindToken(t.access_token, app);
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
      extra: { shops, app },
    });

    return NextResponse.json({
      ok: true,
      msg: `เชื่อมร้าน ${shopLabel} สำเร็จ` + (app ? ` (แอป ${app})` : ''),
      shops: shops.map((x) => ({ id: x.id, name: x.name, region: x.region })),
      next: '/orders',
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
