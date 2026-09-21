// ส่องข้อมูลดิบจาก escrow ของ Shopee — ไว้ตรวจว่าตัวแปลงอ่านครบไหม (คู่กับ app/api/debug/settlement ของ TikTok)
//
//   /api/debug/settlement-shopee?key=SYNC_SECRET                    → ออเดอร์ที่ escrow ปล่อย 7 วันล่าสุด
//   /api/debug/settlement-shopee?key=SYNC_SECRET&order=<order_sn>   → ก้อนดิบ + ที่แปลงแล้วของใบนั้น
//
// เช็คได้ด้วยตาว่าแปลงถูก: revenue + fee + shipping + adjustment ต้องเท่ากับ settlement เสมอ
// (adjustment ของ Shopee เป็นตัวปรับให้สมการตรงเสมอ ไม่ได้การันตีว่า revenue/fee/shipping แยกถูกช่อง
//  100% — ต้องเทียบ escrow_amount กับใบเสร็จจริงสัก 10-20 ใบก่อนเชื่อตัวเลขที่แยกหมวดนี้เต็มที่)
import { NextResponse } from 'next/server';
import { listEscrow, getEscrowDetailBatch, normalizeMoneyTx } from '@/lib/shopee';
import { listShops, usableToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  if (process.env.SYNC_SECRET && url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const shops = await listShops('shopee');
  const row = shops.find((s) => s.shop === (url.searchParams.get('shop') || s.shop));
  if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบร้าน' }, { status: 404 });

  try {
    const tok = await usableToken(row);
    const auth = { accessToken: tok.access_token, shopId: tok.shop_id, partner: tok };
    const orderSn = url.searchParams.get('order');

    if (!orderSn) {
      const escrow = await listEscrow({ ...auth, since: Date.now() - 7 * 86400000, until: Date.now() });
      return NextResponse.json({ ok: true, shop: row.shop, count: escrow.length, escrow });
    }

    const detail = await getEscrowDetailBatch({ ...auth, orderSns: [orderSn] });
    if (!detail.length) return NextResponse.json({ ok: false, error: 'ไม่พบใบนี้ (อาจยังไม่ escrow ปล่อย)' });

    const parsed = normalizeMoneyTx(detail[0], { shop: row.shop, statementAt: new Date().toISOString() });
    const diff = Number((parsed.revenue + parsed.fee + parsed.shipping + parsed.adjustment - parsed.settlement).toFixed(2));
    return NextResponse.json({
      ok: true, shop: row.shop,
      parsed, balance_check: diff === 0 ? 'ตรง' : `ไม่ตรง ต่างกัน ${diff}`, raw: detail[0],
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload || null });
  }
}
