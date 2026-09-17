// เงินเข้าจริง — ขายป้ายเท่าไร ร้านลดไปเท่าไร โดนหักเท่าไร เหลือเข้ากระเป๋าเท่าไร
//
// ยอดที่หน้าออเดอร์โชว์คือ "ลูกค้าจ่าย" ไม่ใช่เงินที่เราได้
// หน้านี้เอาตัวเลขจากใบสรุปรายวันของแพลตฟอร์ม (ชุดเดียวกับที่โอนเข้าบัญชีจริง) มาแจกแจง
//
// หมายเหตุ: ออเดอร์จะโผล่ในหน้านี้ก็ต่อเมื่อแพลตฟอร์ม "ปิดยอด" แล้ว
// ซึ่งเกิดหลังของถึงมือและพ้นเวลาคืนของ ปกติ 10-20 วันหลังสั่ง — ใบที่เพิ่งสั่งจึงยังไม่มี
import Link from 'next/link';
import { db } from '@/lib/supabase';
import { breakdownGroups } from '@/lib/settlement';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../Nav';
import SyncMoney from './SyncMoney';
import RefreshWhile from './RefreshWhile';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;
const RANGES = [
  { days: 7, label: '7 วัน' },
  { days: 30, label: '30 วัน' },
  { days: 60, label: '60 วัน' },   // รายการรายออเดอร์เก็บไว้ 60 วัน (ดู os_cleanup)
];

// จัดวันที่เอง ไม่พึ่ง toLocaleString — ผลต่างกันตามเวอร์ชัน Node/เบราว์เซอร์ (ดู lib/fmt.js)
const MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(new Date(s).getTime() + 7 * 3600000);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};
const baht = (n) => {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '−฿' : '฿') + Math.abs(v).toLocaleString('en-US');
};
const pct = (part, whole) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 100) : null);
// เหลือกี่ % ของราคาป้าย — ค่าเฉลี่ยร้านช่วง ก.ย. 2569 อยู่ราว 59%
const tone = (p) => (p === null ? 'dim' : p >= 65 ? 'ok' : p >= 50 ? 'warn' : 'err');

export default async function MoneyPage({ searchParams }) {
  const sp = await searchParams;
  const days = RANGES.some((r) => r.days === Number(sp?.days)) ? Number(sp.days) : 30;
  const page = Math.max(1, Number(sp?.page) || 1);
  const only = sp?.only === 'loss' ? 'loss' : 'all';

  const qs = (o = {}) => {
    const p = new URLSearchParams({ days: String(o.days ?? days), page: String(o.page ?? 1) });
    if ((o.only ?? only) !== 'all') p.set('only', o.only ?? only);
    return '/money?' + p.toString();
  };

  const from = new Date(Date.now() - days * 86400000).toISOString();
  const to = new Date(Date.now() + 86400000).toISOString();

  let rows = [], total = 0, sum = {}, daily = [], lastRun = null, pendingAll = 0, err = null;
  try {
    const sb = db();
    let q = sb.from('os_money_tx')
      .select('tx_id, shop, type, order_id, order_created_at, statement_at, gross, seller_discount,'
        + ' customer_paid, fee, shipping, adjustment, settlement, breakdown', { count: 'exact' })
      .eq('platform', 'tiktok')
      .gte('statement_at', from);
    if (only === 'loss') q = q.lt('settlement', 0);
    q = q.order('statement_at', { ascending: false })
      .order('settlement', { ascending: true })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const [main, sumRes, dayRes, logRes, pendRes] = await Promise.all([
      q,
      sb.rpc('os_money_totals', { p_from: from, p_to: to, p_platform: 'tiktok', p_shop: null }),
      sb.from('os_statements')
        .select('statement_id, shop, statement_at, revenue, fee, adjustment, settlement, payment_status, tx_total, tx_synced, done')
        .eq('platform', 'tiktok').gte('statement_at', from)
        .order('statement_at', { ascending: false }),
      sb.from('os_sync_log').select('*').eq('platform', 'money:tiktok')
        .order('started_at', { ascending: false }).limit(1).maybeSingle(),
      // นับทุกวันที่ยังดึงไม่ครบ ไม่จำกัดช่วงที่เลือกดู — ดู 7 วันอยู่ก็ต้องรู้ว่าวันเก่ายังดึงอยู่
      sb.from('os_statements').select('statement_id', { count: 'exact', head: true })
        .eq('platform', 'tiktok').eq('done', false),
    ]);
    if (main.error) throw new Error(main.error.message);
    if (sumRes.error) throw new Error(sumRes.error.message);

    rows = main.data || [];
    total = main.count || 0;
    sum = sumRes.data || {};
    daily = dayRes.data || [];
    lastRun = logRes?.data || null;
    pendingAll = pendRes?.count || 0;
  } catch (e) {
    err = String(e.message || e);
  }

  const gross = Number(sum.gross || 0);
  const settlement = Number(sum.settlement || 0);
  const charges = Number(sum.fee || 0) + Number(sum.shipping || 0);

  // กำลังดึงอยู่ไหม — รอบหนึ่งยาว ~20 วินาที แล้วปุ่ม/cron เรียกรอบถัดไปต่อทันที
  // ช่วงรอยต่อระหว่างรอบ log จะขึ้นว่าจบแล้ว จึงนับว่ายังดึงอยู่ถ้าเพิ่งจบไม่ถึงนาทีและยังมีวันค้าง
  const now = Date.now();
  const startedAgo = lastRun ? now - new Date(lastRun.started_at).getTime() : Infinity;
  const finishedAgo = lastRun?.finished_at ? now - new Date(lastRun.finished_at).getTime() : Infinity;
  const syncing = Boolean(lastRun) && (
    (!lastRun.finished_at && startedAgo < 60000)
    || (pendingAll > 0 && lastRun.ok !== false && finishedAgo < 60000)
  );

  return (
    <>
      <Nav active="money" />

      <div className="row">
        <div>
          <h1>เงินเข้าจริง</h1>
          <div className="sub">
            TikTok · ปิดยอดใน {days} วันล่าสุด
            {lastRun && (
              <> · ดึงล่าสุด {fmtTimeTH(lastRun.finished_at || lastRun.started_at)} น.
                {lastRun.ok === false && <span className="stale"> (รอบล่าสุดพลาด: {String(lastRun.error || '').slice(0, 80)})</span>}
              </>
            )}
          </div>
        </div>
        <SyncMoney />
      </div>

      {err && (
        <div className="note">
          <b>ดึงข้อมูลไม่ได้</b><br />{err}<br /><br />
          รัน <code>supabase/014_money_statements.sql</code> ใน Supabase ก่อน
        </div>
      )}

      {!err && syncing && (
        <div className="syncing">
          <span className="pulse" />
          <span>
            <b>กำลังดึงยอดเงิน</b> — เหลืออีก {pendingAll} วัน ตัวเลขด้านล่างจะค่อยๆ ครบ
            <span className="sub" style={{ display: 'block', margin: 0 }}>หน้านี้อัปเดตเองทุก 10 วินาที ไม่ต้องกดอะไร</span>
          </span>
          <RefreshWhile every={10} />
        </div>
      )}

      {!err && !syncing && pendingAll > 0 && (
        <div className="note">
          ยังดึงรายการไม่ครบ {pendingAll} วัน — ตัวเลขด้านล่างจึงยังต่ำกว่าความจริง
          กด “ดึงยอดเงิน” ต่อได้เลย (ระบบก็ดึงต่อเองทุกชั่วโมง)
        </div>
      )}

      <div className="tabs">
        {RANGES.map((r) => (
          <Link prefetch={false} key={r.days} className="tab" data-on={days === r.days ? '1' : '0'} href={qs({ days: r.days })}>
            {r.label}
          </Link>
        ))}
      </div>

      <div className="mcards">
        <div className="mcard">
          <span className="mlabel">ราคาป้ายรวม ({(sum.rows || 0).toLocaleString('en-US')} รายการ)</span>
          <b>{baht(gross)}</b>
        </div>
        <div className="mcard">
          <span className="mlabel">ร้านลดไป</span>
          <b className="danger">{baht(sum.seller_discount)}</b>
          {gross > 0 && <span className="mfoot">{Math.abs(pct(sum.seller_discount, gross))}% ของราคาป้าย</span>}
        </div>
        <div className="mcard">
          <span className="mlabel">ค่าคอม ค่าธรรมเนียม ค่าส่ง</span>
          <b className="danger">{baht(charges)}</b>
          {gross > 0 && <span className="mfoot">{Math.abs(pct(charges, gross))}% ของราคาป้าย</span>}
        </div>
        <div className="mcard hero">
          <span className="mlabel">เงินเข้าจริง</span>
          <b>{baht(settlement)}</b>
          {gross > 0 && <span className="mfoot">เหลือ {pct(settlement, gross)}% ของราคาป้าย</span>}
        </div>
      </div>

      {Number(sum.loss_n) > 0 && (
        <div className="note note-danger">
          <b>ขาดทุน {sum.loss_n} ใบ รวม {baht(sum.loss)}</b> — ส่วนใหญ่คือตีคืน
          (ไม่ได้เงินค่าสินค้า แต่ยังโดนค่าส่งไป-กลับ + ค่าธรรมเนียม){' '}
          <Link href={qs({ only: 'loss' })}>ดูรายการ</Link>
        </div>
      )}

      {daily.length > 0 && (
        <details className="daily">
          <summary>ยอดโอนรายวัน ({daily.length} วัน) — เทียบกับเงินเข้าบัญชีได้</summary>
          <table className="orders">
            <thead>
              <tr>
                <th>ปิดยอด</th>
                <th className="r">ยอดขาย</th>
                <th className="r">หัก</th>
                <th className="r">ปรับปรุง</th>
                <th className="r">โอนเข้า</th>
                <th>ดึงรายการ</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.shop + d.statement_id}>
                  <td data-label="ปิดยอด">{fmtDate(d.statement_at)} <span className="sku">{d.shop}</span></td>
                  <td data-label="ยอดขาย" className="num">{baht(d.revenue)}</td>
                  <td data-label="หัก" className="num danger">{baht(d.fee)}</td>
                  <td data-label="ปรับปรุง" className="num">{Number(d.adjustment) ? baht(d.adjustment) : '—'}</td>
                  <td data-label="โอนเข้า" className="num"><b>{baht(d.settlement)}</b></td>
                  <td data-label="ดึงรายการ">
                    {d.done
                      ? <span className="badge ok">ครบ {d.tx_total}</span>
                      : <span className="badge warn">{d.tx_synced || 0}/{d.tx_total ?? '?'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <div className="tabs">
        <Link prefetch={false} className="tab" data-on={only === 'all' ? '1' : '0'} href={qs({ only: 'all' })}>ทุกรายการ</Link>
        <Link prefetch={false} className="tab" data-tone="err" data-on={only === 'loss' ? '1' : '0'} href={qs({ only: 'loss' })}>
          ขาดทุน <b>{sum.loss_n || 0}</b>
        </Link>
      </div>

      <table className="orders">
        <thead>
          <tr>
            <th>ออเดอร์</th>
            <th>ปิดยอด</th>
            <th className="r">ราคาป้าย</th>
            <th className="r">ร้านลด</th>
            <th className="r">โดนหัก</th>
            <th className="r">เข้าจริง</th>
            <th className="r">เหลือ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const p = pct(t.settlement, t.gross);
            const charge = Number(t.fee) + Number(t.shipping);
            const groups = breakdownGroups(t.breakdown);
            const returned = Number(t.gross) <= 0 && Number(t.settlement) < 0;
            return (
              <tr key={t.tx_id}>
                <td data-label="ออเดอร์">
                  {t.order_id
                    ? <Link href={`/orders/${t.order_id}`} className="mono">{t.order_id}</Link>
                    : <span className="mono">{t.type}</span>}
                  <div className="sku">{t.shop} · สั่ง {fmtDate(t.order_created_at)}</div>
                </td>
                <td data-label="ปิดยอด">{fmtDate(t.statement_at)}</td>
                <td data-label="ราคาป้าย" className="num">{baht(t.gross)}</td>
                <td data-label="ร้านลด" className="num">{Number(t.seller_discount) ? baht(t.seller_discount) : '—'}</td>
                <td data-label="โดนหัก" className="num">
                  <span className="danger">{baht(charge)}</span>
                  {groups.length > 0 && (
                    <details className="fees">
                      <summary>แจกแจง</summary>
                      <table className="mini">
                        <tbody>
                          {groups.flatMap((g) => g.lines.map((f, i) => (
                            <tr key={f.key}>
                              <td>{i === 0 ? <b>{g.label}</b> : null} {f.label}</td>
                              <td>{baht(f.amount)}</td>
                            </tr>
                          )))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </td>
                <td data-label="เข้าจริง" className="num">
                  <b className={Number(t.settlement) < 0 ? 'danger' : undefined}>{baht(t.settlement)}</b>
                </td>
                <td data-label="เหลือ" className="num">
                  {returned
                    ? <span className="badge err">ตีคืน</span>
                    : p === null ? '—' : <span className={`badge ${tone(p)}`}>{p}%</span>}
                </td>
              </tr>
            );
          })}
          {!rows.length && !err && (
            <tr>
              <td colSpan={7} style={{ color: 'var(--muted)' }}>
                ยังไม่มีรายการในช่วงนี้ — กด “ดึงยอดเงิน” เพื่อเริ่ม
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
        <b>ทำไมไม่เห็นออเดอร์ที่เพิ่งสั่ง</b> — TikTok ปิดยอดหลังของถึงมือลูกค้าและพ้นเวลาคืนของ
        ปกติ 10-20 วันหลังสั่ง ออเดอร์จะโผล่ในหน้านี้ตอนนั้น
        <br />“เหลือ” = เงินเข้าจริงหารราคาป้าย · ตอนนี้รองรับ TikTok ก่อน Shopee กับ Lazada ต่อทีหลัง
      </div>
    </>
  );
}
