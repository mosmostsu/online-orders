// เงินเข้าจริง — ออเดอร์ใบนี้ หลังหักทุกอย่างแล้ว เข้ากระเป๋าเราเท่าไร
//
// ยอดที่หน้าออเดอร์โชว์คือ "ลูกค้าจ่าย" ไม่ใช่เงินที่เราได้
// หน้านี้เอาตัวเลขจาก Finance API ของแพลตฟอร์มมาวางคู่กัน จะได้เห็นส่วนต่างทันที
import Link from 'next/link';
import { db } from '@/lib/supabase';
import { feeLines } from '@/lib/settlement';
import Nav from '../Nav';
import SyncMoney from './SyncMoney';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;
const RANGES = [
  { days: 7, label: '7 วัน' },
  { days: 30, label: '30 วัน' },
  { days: 90, label: '90 วัน' },
];

const TH = { timeZone: 'Asia/Bangkok' };
const fmtDate = (s) =>
  s ? new Date(s).toLocaleString('th-TH', { ...TH, day: '2-digit', month: 'short' }) : '—';
const baht = (n) =>
  n === null || n === undefined ? '—' : '฿' + Math.round(Number(n)).toLocaleString('en-US');
// เงินที่ถูกหักโชว์เป็นเลขติดลบเสมอ จะได้อ่านออกทันทีว่าไหลออก
const minus = (n) => (n ? '−฿' + Math.round(Math.abs(Number(n))).toLocaleString('en-US') : '—');
const pct = (part, whole) => (whole ? Math.round((Number(part) / Number(whole)) * 100) : null);

// Supabase คืนตารางที่ผูกกันมาเป็น object หรือ array แล้วแต่ว่ามันมองความสัมพันธ์เป็นแบบไหน
// รับไว้ทั้งสองแบบ จะได้ไม่พังเวลาเปลี่ยนรุ่น
const one = (v) => (Array.isArray(v) ? v[0] || null : v || null);

export default async function MoneyPage({ searchParams }) {
  const sp = await searchParams;
  const days = RANGES.some((r) => r.days === Number(sp?.days)) ? Number(sp.days) : 30;
  const page = Math.max(1, Number(sp?.page) || 1);
  const only = sp?.only || 'all';      // all | settled | waiting
  const shop = sp?.shop || 'all';

  const qs = (o = {}) => {
    const p = new URLSearchParams({ days: String(o.days ?? days), page: String(o.page ?? 1) });
    if ((o.only ?? only) !== 'all') p.set('only', o.only ?? only);
    if ((o.shop ?? shop) !== 'all') p.set('shop', o.shop ?? shop);
    return '/money?' + p.toString();
  };

  const from = new Date(Date.now() - days * 86400000).toISOString();
  const to = new Date(Date.now() + 86400000).toISOString();

  let rows = [], sum = {}, shops = [], total = 0, lastRun = null, err = null;
  try {
    const sb = db();
    // ดูเฉพาะใบที่ปิดยอดแล้ว = ต้อง join แบบบังคับให้มีคู่ (!inner)
    // ถ้าไม่ใส่ ใบที่ยังไม่มีแถวยอดเงินจะติดมาด้วยโดยที่ช่องเงินว่างเปล่า
    const join = only === 'settled' ? 'os_settlements!inner' : 'os_settlements';
    let q = sb
      .from('os_orders')
      .select(
        'id, order_id, platform, shop, status, total, item_count, ordered_at,' +
        ` ${join}(net, fee_total, customer_paid, revenue, adjustment, settled,` +
        ' statement_at, fee_breakdown, error, tried_at)',
        { count: 'exact' }
      )
      .eq('platform', 'tiktok')
      .neq('status', 'cancelled')
      .gte('ordered_at', from)
      .order('ordered_at', { ascending: false });
    if (shop !== 'all') q = q.eq('shop', shop);
    if (only === 'settled') q = q.eq('os_settlements.settled', true);
    q = q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const [main, sumRes, shopRes, logRes] = await Promise.all([
      q,
      sb.rpc('os_money_summary', {
        p_from: from, p_to: to, p_platform: 'tiktok', p_shop: shop === 'all' ? null : shop,
      }),
      sb.from('os_shop_tokens').select('shop').eq('platform', 'tiktok'),
      sb.from('os_sync_log').select('*').eq('platform', 'money:tiktok')
        .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (main.error) throw new Error(main.error.message);

    rows = (main.data || []).map((o) => ({ ...o, s: one(o.os_settlements) }));
    // "ยังไม่ปิดยอด" กรองฝั่งเราเพราะเป็นการหาแถวที่ยังไม่มีคู่ ซึ่งถามตรงๆ ไม่ได้
    if (only === 'waiting') rows = rows.filter((r) => !r.s?.settled);
    total = main.count || 0;
    sum = sumRes?.data || {};
    shops = (shopRes.data || []).map((r) => r.shop);
    lastRun = logRes?.data || null;
  } catch (e) {
    err = String(e.message || e);
  }

  const paid = Number(sum.paid || 0);
  const net = Number(sum.net || 0);
  const fee = Number(sum.fee || 0);
  const settledPaid = Number(sum.settled_paid || 0);
  const keepPct = pct(net, settledPaid);

  return (
    <>
      <Nav active="money" />

      <div className="row">
        <div>
          <h1>เงินเข้าจริง</h1>
          <div className="sub">
            TikTok · {days} วันล่าสุด
            {lastRun && (
              <> · ถามยอดล่าสุด {fmtDate(lastRun.finished_at || lastRun.started_at)}
                {lastRun.ok === false ? <span className="stale"> (รอบล่าสุดพลาด)</span> : null}
              </>
            )}
          </div>
        </div>
        <SyncMoney />
      </div>

      {err && (
        <div className="note">
          <b>ดึงข้อมูลไม่ได้</b><br />{err}<br /><br />
          รัน <code>supabase/013_settlement.sql</code> ใน Supabase ก่อน
        </div>
      )}

      <div className="tabs">
        {RANGES.map((r) => (
          <Link prefetch={false} key={r.days} className="tab" data-on={days === r.days ? '1' : '0'} href={qs({ days: r.days })}>
            {r.label}
          </Link>
        ))}
        {shops.length > 1 && (
          <>
            <span className="divider" />
            <Link prefetch={false} className="tab" data-on={shop === 'all' ? '1' : '0'} href={qs({ shop: 'all' })}>ทุกร้าน</Link>
            {shops.map((s) => (
              <Link prefetch={false} key={s} className="tab" data-on={shop === s ? '1' : '0'} href={qs({ shop: s })}>{s}</Link>
            ))}
          </>
        )}
      </div>

      {/* สรุปยอด — นับเฉพาะใบที่ปิดยอดแล้ว
          ถ้าเอาใบที่ยังไม่มีตัวเลขมารวมด้วย เปอร์เซ็นต์จะดูต่ำกว่าความจริงจนตัดสินใจผิด */}
      <div className="mcards">
        <div className="mcard">
          <span className="mlabel">ลูกค้าจ่าย (ปิดยอดแล้ว {sum.settled_n || 0} ใบ)</span>
          <b>{baht(settledPaid)}</b>
        </div>
        <div className="mcard">
          <span className="mlabel">ถูกหักไป</span>
          <b className="danger">{minus(fee)}</b>
          {settledPaid > 0 && <span className="mfoot">{pct(fee, settledPaid)}% ของยอดขาย</span>}
        </div>
        <div className="mcard hero">
          <span className="mlabel">เงินเข้าเราจริง</span>
          <b>{baht(net)}</b>
          {keepPct !== null && <span className="mfoot">เหลือ {keepPct}% จากที่ลูกค้าจ่าย</span>}
        </div>
        <div className="mcard">
          <span className="mlabel">ยังไม่ปิดยอด</span>
          <b>{Math.max(0, (sum.orders || 0) - (sum.settled_n || 0))} ใบ</b>
          <span className="mfoot">ยอดขาย {baht(paid - settledPaid)}</span>
        </div>
      </div>

      <div className="tabs">
        {[['all', 'ทุกใบ'], ['settled', 'ปิดยอดแล้ว'], ['waiting', 'ยังไม่ปิดยอด']].map(([k, label]) => (
          <Link prefetch={false} key={k} className="tab" data-on={only === k ? '1' : '0'} href={qs({ only: k })}>{label}</Link>
        ))}
      </div>

      <table className="orders">
        <thead>
          <tr>
            <th>ออเดอร์</th>
            <th>วันที่</th>
            <th className="r">ลูกค้าจ่าย</th>
            <th className="r">ถูกหัก</th>
            <th className="r">เข้าจริง</th>
            <th className="r">เหลือ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const s = o.s;
            const paidOne = s?.customer_paid ?? o.total;
            const keep = s?.settled ? pct(s.net, paidOne) : null;
            const lines = s?.settled ? feeLines(s.fee_breakdown) : [];
            return (
              <tr key={o.id}>
                <td data-label="ออเดอร์">
                  <Link href={`/orders/${o.order_id}`} className="mono">{o.order_id}</Link>
                  <div className="sku">{o.shop} · {o.item_count} ชิ้น</div>
                </td>
                <td data-label="วันที่">{fmtDate(o.ordered_at)}</td>
                <td data-label="ลูกค้าจ่าย" className="num">{baht(paidOne)}</td>
                <td data-label="ถูกหัก" className="num">
                  {s?.settled ? <span className="danger">{minus(s.fee_total)}</span> : '—'}
                  {lines.length > 0 && (
                    <details className="fees">
                      <summary>หักอะไรบ้าง</summary>
                      <table className="mini">
                        <tbody>
                          {lines.map((f) => (
                            <tr key={f.key}>
                              <td>{f.label}</td>
                              <td>{f.amount < 0 ? minus(f.amount) : baht(f.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </td>
                <td data-label="เข้าจริง" className="num">
                  {s?.settled ? <b>{baht(s.net)}</b> : <span className="badge dim">ยังไม่ปิดยอด</span>}
                </td>
                <td data-label="เหลือ" className="num">
                  {keep === null
                    ? '—'
                    : <span className={`badge ${keep >= 80 ? 'ok' : keep >= 70 ? 'warn' : 'err'}`}>{keep}%</span>}
                </td>
              </tr>
            );
          })}
          {!rows.length && !err && (
            <tr>
              <td colSpan={6} style={{ color: 'var(--muted)' }}>
                ยังไม่มีข้อมูลในช่วงนี้ — กด “ถามยอดเงินตอนนี้” เพื่อเริ่มดึง
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {total > PAGE_SIZE && (
        <div className="pager">
          <Link prefetch={false} data-off={page <= 1 ? '1' : '0'} href={qs({ page: page - 1 })}>← ก่อนหน้า</Link>
          <span className="sub" style={{ margin: 0 }}>หน้า {page} / {Math.ceil(total / PAGE_SIZE)}</span>
          <Link prefetch={false} data-off={page * PAGE_SIZE >= total ? '1' : '0'} href={qs({ page: page + 1 })}>ถัดไป →</Link>
        </div>
      )}

      <div className="note" style={{ marginTop: 16 }}>
        <b>อ่านตัวเลขยังไง</b> — แพลตฟอร์มปิดยอดเป็นรอบวัน หลังของถึงมือลูกค้าและพ้นเวลาคืนของ
        ใบที่ยังไม่ถึงรอบจะขึ้นว่า “ยังไม่ปิดยอด” เป็นเรื่องปกติ ไม่ใช่ข้อมูลหาย
        <br />ตอนนี้รองรับ TikTok ก่อน · Shopee กับ Lazada ต่อทีหลัง (คนละ API กัน)
      </div>
    </>
  );
}
