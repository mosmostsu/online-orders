// Shopee ยิงมาบอกเองเมื่อออเดอร์เปลี่ยนสถานะ (Push Mechanism)
// ตั้ง Callback URL นี้ในคอนโซล: https://<โดเมน>/api/webhook/shopee
//
// พิสูจน์ว่ามาจาก Shopee จริง: HMAC-SHA256 ของ (url + "|" + เนื้อคำขอดิบ) ด้วย partner_key
// เทียบกับที่ส่งมาใน header Authorization
//
// สำคัญ: ต้องตอบ 2xx เสมอ ไม่ว่าจะเกิดอะไรขึ้น
// Shopee ถือว่า response ที่ไม่ใช่ 2xx = ปลายทางใช้ไม่ได้ แล้วจะปิดการส่งให้เรา
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getOrderDetails, normalizeOrder } from '@/lib/shopee';
import { upsertOrders } from '@/lib/ingest';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// รหัสที่เราสนใจ — ออเดอร์เปลี่ยนสถานะ กับ มีเลขพัสดุ
const ORDER_STATUS_PUSH = 3;
const ORDER_TRACKINGNO_PUSH = 4;

function verify(url, rawBody, header) {
  const key = process.env.SHOPEE_PARTNER_KEY;
  if (!key) return false;
  const expect = crypto.createHmac('sha256', key).update(`${url}|${rawBody}`).digest('hex');
  const got = String(header || '').trim();
  if (got.length !== expect.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expect));
}

export async function POST(req) {
  const raw = await req.text();

  let ev = {};
  try {
    ev = JSON.parse(raw || '{}');
  } catch {
    return NextResponse.json({ ok: true, note: 'อ่านเนื้อคำขอไม่ได้' });
  }

  // ตอนกด "Verify and Save" ในคอนโซล Shopee จะยิง test push มาก่อนที่แอปจะผูกกับร้าน
  // ตอบ 200 ไปก่อนเพื่อให้ผ่านการตรวจ แล้วค่อยเช็คลายเซ็นตอนทำงานจริง
  const url = new URL(req.url);
  const callbackUrl = `${url.origin}${url.pathname}`;
  const signed = verify(callbackUrl, raw, req.headers.get('authorization'));

  const code = ev.code;
  if (code !== ORDER_STATUS_PUSH && code !== ORDER_TRACKINGNO_PUSH) {
    return NextResponse.json({ ok: true, ignored: code ?? 'test' });
  }
  if (!signed) {
    return NextResponse.json({ ok: true, note: 'ลายเซ็นไม่ตรง — ข้ามไป' });
  }

  const orderSn = ev?.data?.ordersn || ev?.data?.order_sn;
  const shopId = ev.shop_id;
  if (!orderSn || !shopId) return NextResponse.json({ ok: true, ignored: 'ข้อมูลไม่ครบ' });

  try {
    const sb = db();
    const { data: shop } = await sb
      .from('os_shop_tokens')
      .select('*')
      .eq('platform', 'shopee')
      .eq('shop_id', String(shopId))
      .maybeSingle();
    if (!shop) return NextResponse.json({ ok: true, ignored: 'ไม่รู้จักร้านนี้: ' + shopId });

    // ดึงเฉพาะใบที่เปลี่ยน ไม่ต้องกวาดทั้งร้าน
    const orders = await getOrderDetails({
      accessToken: shop.access_token,
      shopId: shop.shop_id,
      orderSns: [String(orderSn)],
    });
    if (orders.length) {
      await upsertOrders(orders.map((o) => normalizeOrder(o, shop.shop)));
      const { notifyRisky } = await import('@/app/api/notify/risky/route');
      try { await notifyRisky(); } catch (e) { console.error('แจ้ง LINE ไม่สำเร็จ:', e.message); }
    }
    return NextResponse.json({ ok: true, order_sn: orderSn });
  } catch (e) {
    // ผิดพลาดฝั่งเราก็ยังตอบ 200 — รอบกวาดจะตามเก็บใบนี้ให้เอง
    console.error('webhook shopee พลาด:', e.message);
    return NextResponse.json({ ok: true, error: String(e.message || e) });
  }
}

// Shopee เรียก GET มาเช็คว่า URL ใช้ได้ไหมตอนตั้งค่า
export async function GET() {
  return NextResponse.json({ ok: true, msg: 'พร้อมรับแจ้งเตือนจาก Shopee' });
}
