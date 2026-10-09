// ส่องข้อมูลดิบจาก Finance API ของ Lazada — ไว้ตรวจว่าชื่อฟิลด์/การจัดกลุ่มถูกไหม (คู่กับ debug/settlement-shopee)
//
//   /api/debug/settlement-lazada?key=SYNC_SECRET&from=2026-10-01&to=2026-10-03   → บรรทัดดิบ + ชื่อรายการที่เจอ + ที่แปลงแล้ว
//   เพิ่ม &order=<order_no> เพื่อกรองเหลือใบเดียว
//
// ดูให้ได้ว่า: (1) ชื่อฟิลด์ตรงกับที่ตัวแปลงอ่านไหม (2) fee_name แต่ละตัวตกกลุ่มถูกไหม
// (3) adjustment (ตัวปรับให้สมการตรงเสมอ) ไม่ใหญ่ผิดปกติ — ใหญ่ = มีรายการที่เรายังจัดกลุ่มไม่ถูก
import { NextResponse } from 'next/server';
import { listTransactions, normalizeMoneyTx } from '@/lib/lazada';
import { listShops, usableToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  if (process.env.SYNC_SECRET && url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const shops = await listShops('lazada');
  const row = shops.find((s) => s.shop === (url.searchParams.get('shop') || s.shop));
  if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบร้าน' }, { status: 404 });

  try {
    const tok = await usableToken(row);
    const today = new Date().toISOString().slice(0, 10);
    const from = url.searchParams.get('from') || new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const to = url.searchParams.get('to') || today;
    const order = url.searchParams.get('order');
    let rows = await listTransactions({ accessToken: tok.access_token, from, to });
    if (order) rows = rows.filter((r) => String(r.order_no) === order);

    const names = {};
    for (const r of rows) {
      const n = r.fee_name || r.transaction_type;
      names[n] = (names[n] || 0) + 1;
    }
    const parsed = normalizeMoneyTx(rows, row.shop);
    return NextResponse.json({
      ok: true, shop: row.shop, from, to, lines: rows.length,
      paid_statuses: [...new Set(rows.map((r) => r.paid_status))],
      fee_names: names,
      keys: rows[0] ? Object.keys(rows[0]) : [],
      groups: parsed.length,
      groups_with_adjustment: parsed.filter((p) => Math.abs(p.adjustment) > 0.5).length,
      sample_raw: rows.slice(0, 8),
      sample_parsed: parsed.slice(0, 5),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload }, { status: 500 });
  }
}
