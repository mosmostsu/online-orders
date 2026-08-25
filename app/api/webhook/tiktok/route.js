// TikTok ยิงมาบอกเองเมื่อออเดอร์เปลี่ยนสถานะ — เร็วกว่ารอรอบ cron หลายเท่า
// ตั้ง callback URL นี้ใน Partner Center: https://<โดเมน>/api/webhook/tiktok
//
// พิสูจน์ว่ามาจาก TikTok จริง: HMAC-SHA256 ของ (app_key + เนื้อคำขอดิบ) ด้วย app_secret
// เทียบกับที่ส่งมาใน header Authorization — ต้องเทียบกับ "เนื้อดิบ" ห้าม parse ก่อน
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getOrderDetails, normalizeOrder } from '@/lib/tiktok';
import { upsertOrders } from '@/lib/ingest';
import { notifyRisky } from '@/app/api/notify/risky/route';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ORDER_STATUS_CHANGE = 1;

function verify(rawBody, header) {
  const secret = process.env.TIKTOK_APP_SECRET;
  const key = process.env.TIKTOK_APP_KEY;
  if (!secret || !key) return false;
  const expect = crypto.createHmac('sha256', secret).update(key + rawBody).digest('hex');
  const got = String(header || '').trim();
  // ความยาวต้องเท่ากันก่อน ไม่งั้น timingSafeEqual โยน error
  if (got.length !== expect.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expect));
}

export async function POST(req) {
  const raw = await req.text();

  if (!verify(raw, req.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: 'ลายเซ็นไม่ถูกต้อง' }, { status: 401 });
  }

  let ev;
  try {
    ev = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'อ่านเนื้อคำขอไม่ได้' }, { status: 400 });
  }

  // ตอบ TikTok ให้ไวที่สุด แล้วค่อยทำงานต่อ — ถ้าตอบช้ามันจะยิงซ้ำ
  if (ev.type !== ORDER_STATUS_CHANGE) {
    return NextResponse.json({ ok: true, ignored: ev.type });
  }

  const orderId = ev?.data?.order_id;
  if (!orderId) return NextResponse.json({ ok: true, ignored: 'ไม่มีเลขออเดอร์' });

  try {
    const sb = db();
    const { data: shop } = await sb
      .from('os_shop_tokens')
      .select('*')
      .eq('platform', 'tiktok')
      .eq('shop_id', String(ev.shop_id))
      .maybeSingle();

    if (!shop) return NextResponse.json({ ok: true, ignored: 'ไม่รู้จักร้านนี้: ' + ev.shop_id });

    // ดึงเฉพาะใบที่เปลี่ยน — ไม่ต้องกวาดทั้งร้าน
    const orders = await getOrderDetails({
      accessToken: shop.access_token,
      shopCipher: shop.shop_cipher,
      ids: [String(orderId)],
    });
    if (orders.length) {
      await upsertOrders(orders.map((o) => normalizeOrder(o, shop.shop)));
      // ยกเลิกทั้งที่ของถูกหยิบมาแพ็คแล้ว = ต้องรู้เดี๋ยวนี้ ยิ่งเร็วยิ่งดึงของทัน
      // พลาดก็ไม่เป็นไร รอบกวาดจะตามแจ้งให้เอง
      try { await notifyRisky(); } catch (e) { console.error('แจ้ง LINE ไม่สำเร็จ:', e.message); }
    }

    return NextResponse.json({ ok: true, order_id: orderId, status: ev?.data?.order_status });
  } catch (e) {
    // ตอบ 200 ไว้ก่อนถ้าเป็นความผิดพลาดฝั่งเรา — ไม่งั้น TikTok จะยิงซ้ำไม่หยุด
    // รอบ cron จะตามเก็บใบนี้ให้เองอยู่แล้ว
    console.error('webhook พลาด:', e.message);
    return NextResponse.json({ ok: false, error: String(e.message || e) });
  }
}

// TikTok เรียก GET มาเช็คว่า URL ใช้ได้ไหมตอนตั้งค่า
export async function GET() {
  return NextResponse.json({ ok: true, msg: 'พร้อมรับแจ้งเตือนจาก TikTok' });
}
