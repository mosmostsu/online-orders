// ส่องข้อมูลดิบจาก Finance API ของ TikTok — ไว้ตรวจว่าตัวแปลงอ่านครบไหม
//
//   /api/debug/settlement?key=SYNC_SECRET                  → ใบสรุป 7 วันล่าสุด
//   /api/debug/settlement?key=SYNC_SECRET&statement=<id>   → 3 รายการแรกของใบนั้น ทั้งดิบและที่แปลงแล้ว
//
// เช็คได้ด้วยตาว่าแปลงถูก: ในแต่ละแถว revenue + fee + shipping + adjustment ต้องเท่ากับ settlement
import { NextResponse } from 'next/server';
import { listStatements, getStatementPage, normalizeMoneyTx } from '@/lib/tiktok';
import { listShops, usableToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  if (process.env.SYNC_SECRET && url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const shops = await listShops('tiktok');
  const row = shops.find((s) => s.shop === (url.searchParams.get('shop') || s.shop));
  if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบร้าน' }, { status: 404 });

  try {
    const tok = await usableToken(row);
    const auth = { accessToken: tok.access_token, shopCipher: tok.shop_cipher };
    const statementId = url.searchParams.get('statement');

    // ?scan=1&days=30 — หาแถวที่มียอดคืนเงิน (refund_*) ในใบสรุปย้อนหลัง แล้วโชว์ทุกแถวของออเดอร์นั้นเทียบกัน
    // อ่านอย่างเดียว ไม่เขียนฐานข้อมูล ใช้ตรวจว่าออเดอร์ที่ตีคืนมีแถวขาย/คืนแยกกันไหม และคืนคนละวันไหม
    if (url.searchParams.get('scan')) {
      const days = Math.min(60, Number(url.searchParams.get('days')) || 30);
      const maxPages = Math.min(20, Number(url.searchParams.get('pages')) || 8);
      const statements = await listStatements({ ...auth, since: Date.now() - days * 86400000, until: Date.now() });
      const byOrder = new Map();
      let scanned = 0, pages = 0;
      for (const st of statements) {
        let pageToken = '';
        while (pages < maxPages) {
          const data = await getStatementPage({ ...auth, statementId: st.id, pageToken });
          pages++;
          for (const t of data.transactions || []) {
            scanned++;
            const p = normalizeMoneyTx(t, { shop: row.shop, statementId: st.id, statementAt: st.statement_time ? new Date(st.statement_time * 1000).toISOString() : null });
            const k = p.order_id || p.tx_id;
            if (!byOrder.has(k)) byOrder.set(k, []);
            byOrder.get(k).push({
              statement: st.id, day: p.statement_at, type: p.type,
              gross: p.gross, discount: p.seller_discount, revenue: p.revenue, fee: p.fee,
              shipping: p.shipping, adjustment: p.adjustment, settlement: p.settlement,
              refund: Object.keys(p.breakdown).filter((x) => /refund|return|reverse/i.test(x)).map((x) => `${x}=${p.breakdown[x]}`),
            });
          }
          pageToken = data.next_page_token || '';
          if (!pageToken) break;
        }
        if (pages >= maxPages) break;
      }
      const returned = [...byOrder.entries()].filter(([, rows]) => rows.some((r) => r.refund.length));
      return NextResponse.json({
        ok: true, shop: row.shop, statements: statements.length, pages, scanned, orders: byOrder.size,
        returned_orders: returned.length,
        sample: returned.slice(0, 6).map(([order_id, rows]) => ({ order_id, rows })),
      });
    }

    if (!statementId) {
      const statements = await listStatements({ ...auth, since: Date.now() - 7 * 86400000, until: Date.now() });
      return NextResponse.json({ ok: true, shop: row.shop, statements });
    }

    const data = await getStatementPage({ ...auth, statementId });
    const sample = (data.transactions || []).slice(0, 3).map((t) => {
      const p = normalizeMoneyTx(t, { shop: row.shop, statementId, statementAt: null });
      const diff = Number((p.revenue + p.fee + p.shipping + p.adjustment - p.settlement).toFixed(2));
      return { parsed: p, balance_check: diff === 0 ? 'ตรง' : `ไม่ตรง ต่างกัน ${diff}`, raw: t };
    });
    return NextResponse.json({ ok: true, shop: row.shop, total_count: data.total_count, sample });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e), payload: e.payload || null });
  }
}
