// เงินเข้าจริง — ขายป้ายเท่าไร ร้านลดไปเท่าไร โดนหักเท่าไร เหลือเข้ากระเป๋าเท่าไร
//
// ยอดที่หน้าออเดอร์โชว์คือ "ลูกค้าจ่าย" ไม่ใช่เงินที่เราได้
// หน้านี้เอาตัวเลขจากใบสรุปรายวันของแพลตฟอร์ม (ชุดเดียวกับที่โอนเข้าบัญชีจริง) มาแจกแจง
//
// ไล่ดูเป็นชั้น: ตารางรายวัน → กดวัน → รายออเดอร์ของวันนั้น
// นับวันตาม "วันปิดยอด" ไม่ใช่วันสั่ง (เหตุผลอยู่ใน supabase/015_money_daily.sql)
//
// ออเดอร์จะโผล่ในหน้านี้ก็ต่อเมื่อแพลตฟอร์มปิดยอดแล้ว — ปกติ 10-20 วันหลังสั่ง
import Link from 'next/link';
import { db } from '@/lib/supabase';
import { breakdownGroups } from '@/lib/settlement';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../Nav';
import SyncMoney from './SyncMoney';
import RefreshWhile from './RefreshWhile';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;
// รายสินค้า: ตัดตัวที่ขายไม่ถึงเท่านี้ชิ้นทิ้ง — ขายชิ้นเดียวแล้วโดนตีคืนจะลอยขึ้นหัวตารางเป็น % ติดลบ
const SKU_MIN_QTY = 5;
const SORTS = [
  { key: 'disc', label: 'ลดเยอะสุด' },
  { key: 'low', label: 'เหลือน้อยสุด' },
  { key: 'net', label: 'เงินเข้ามากสุด' },
  { key: 'qty', label: 'ขายมากสุด' },
];
const RANGES = [
  { days: 7, label: '7 วัน' },
  { days: 30, label: '30 วัน' },
  { days: 60, label: '60 วัน' },   // รายการรายออเดอร์เก็บไว้ 60 วัน (ดู os_cleanup)
];

// จัดวันที่เอง ไม่พึ่ง toLocaleString — ผลต่างกันตามเวอร์ชัน Node/เบราว์เซอร์ (ดู lib/fmt.js)
const MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const thDate = (s) => new Date(new Date(s).getTime() + 7 * 3600000);
const fmtDate = (s) => {
  if (!s) return '—';
  const d = thDate(s);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};
const fmtDay = (s) => {
  const d = thDate(s);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};
// วันของใบสรุปเป็นเวลา 00:00 UTC — ใช้ส่วนวันที่ของ UTC ตรงๆ เป็นคีย์ใน URL
const dayKey = (s) => new Date(s).toISOString().slice(0, 10);

const baht = (n) => {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '−฿' : '฿') + Math.abs(v).toLocaleString('en-US');
};
const pct = (part, whole) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 100) : null);
// ส่วนที่หายไปคิดเป็นกี่ % ของราคาป้าย — โชว์ใต้จำนวนเงิน อ่านเทียบกันได้ทุกแถว
const ofGross = (part, whole) => {
  const p = pct(Math.abs(Number(part) || 0), whole);
  return p ? <div className="sku">{p}%</div> : null;
};
// เหลือกี่ % ของราคาป้าย — ค่าเฉลี่ยร้านช่วง ส.ค.-ก.ย. 2569 อยู่ราว 64%
const tone = (p) => (p === null ? 'dim' : p >= 65 ? 'ok' : p >= 55 ? 'warn' : 'err');

// ตัวเลือกสี/ไซส์ข้างในตะกร้า — พับไว้ กางดูได้ว่าตัวไหนลดหนัก/เหลือน้อย
function VariantList({ variants, count }) {
  const list = variants || [];
  if (!list.length) return null;
  return (
    <details className="fees variants">
      <summary>{count} ตัวเลือก</summary>
      <table className="mini">
        <tbody>
          {list.map((v) => {
            const qty = Number(v.qty) || 0;
            const keep = pct(v.settlement, v.gross);
            const disc = pct(Math.abs(Number(v.seller_discount) || 0), v.gross);
            return (
              <tr key={v.sku || '-'}>
                <td>
                  {v.variant || v.sku || '—'}
                  <span className="sku"> {v.sku}</span>
                </td>
                <td>{qty} ชิ้น</td>
                <td>{disc === null ? '—' : `ลด ${disc}%`}</td>
                <td>{keep === null ? '—' : <span className={`badge ${tone(keep)}`}>{keep}%</span>}</td>
                <td>{qty > 0 ? `${baht(Number(v.settlement) / qty)}/ชิ้น` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

export default async function MoneyPage({ searchParams }) {
  const sp = await searchParams;
  const days = RANGES.some((r) => r.days === Number(sp?.days)) ? Number(sp.days) : 30;
  const page = Math.max(1, Number(sp?.page) || 1);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp?.day || '') ? sp.day : null;
  const only = sp?.only === 'loss' ? 'loss' : 'all';
  const sort = ['disc', 'low', 'net', 'qty'].includes(sp?.sort) ? sp.sort : 'disc';
  // รายสินค้า: รวมตามตะกร้า (ค่าเริ่มต้น) หรือแยกทีละรหัสสี/ไซส์
  const group = sp?.group === 'sku' ? 'sku' : 'product';
  // สี่มุมมอง: รายวัน (ค่าเริ่มต้น) · รายสินค้า · ขาดทุนทั้งช่วง · รายออเดอร์ของวันที่เลือก
  const view = day ? 'day' : sp?.view === 'sku' ? 'sku' : only === 'loss' ? 'loss' : 'daily';

  const qs = (o = {}) => {
    const p = new URLSearchParams({ days: String(o.days ?? days) });
    const v = o.view !== undefined ? o.view : view === 'sku' ? 'sku' : null;
    const d = o.day === undefined ? day : o.day;
    const on = o.only ?? (o.day !== undefined || o.view !== undefined ? 'all' : only);
    if (v === 'sku' && !d) {
      p.set('view', 'sku');
      if ((o.sort ?? sort) !== 'disc') p.set('sort', o.sort ?? sort);
      if ((o.group ?? group) !== 'product') p.set('group', o.group ?? group);
    }
    if (d) p.set('day', d);
    if (on !== 'all') p.set('only', on);
    if ((o.page ?? 1) > 1) p.set('page', String(o.page));
    return '/money?' + p.toString();
  };

  const rangeFrom = new Date(Date.now() - days * 86400000).toISOString();
  const rangeTo = new Date(Date.now() + 86400000).toISOString();
  // การ์ดสรุปกับรายการ ใช้ช่วงของวันที่เลือก ถ้าไม่ได้เลือกวันก็ใช้ทั้งช่วง
  const from = day ? `${day}T00:00:00.000Z` : rangeFrom;
  const to = day ? new Date(new Date(`${day}T00:00:00.000Z`).getTime() + 86400000).toISOString() : rangeTo;

  let rows = [], total = 0, sum = {}, daily = [], bySku = null, lastRun = null, pendingAll = 0;
  let err = null, dailyErr = null, skuErr = null, needs018 = false;
  try {
    const sb = db();

    // รายออเดอร์ — ดึงเฉพาะมุมมองที่ต้องใช้ มุมมองรายวันไม่ต้องลากหมื่นแถวมา
    let listQ = null;
    if (view === 'day' || view === 'loss') {
      listQ = sb.from('os_money_tx')
        .select('tx_id, shop, type, order_id, order_created_at, statement_at, gross, seller_discount,'
          + ' customer_paid, fee, shipping, adjustment, settlement, breakdown', { count: 'exact' })
        .eq('platform', 'tiktok')
        .gte('statement_at', from).lt('statement_at', to);
      if (only === 'loss') listQ = listQ.lt('settlement', 0);
      listQ = listQ.order('statement_at', { ascending: false })
        .order('settlement', { ascending: true })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    }

    const skuArgs = {
      p_from: rangeFrom, p_to: rangeTo, p_platform: 'tiktok', p_sort: sort, p_min_qty: SKU_MIN_QTY, p_limit: 100,
    };
    const [listRes, sumRes, dayRes, logRes, pendRes, skuRes] = await Promise.all([
      listQ,
      sb.rpc('os_money_totals', { p_from: from, p_to: to, p_platform: 'tiktok', p_shop: null }),
      view === 'daily'
        ? sb.rpc('os_money_daily', { p_from: rangeFrom, p_to: rangeTo, p_platform: 'tiktok', p_shop: null })
        : null,
      sb.from('os_sync_log').select('*').eq('platform', 'money:tiktok')
        .order('started_at', { ascending: false }).limit(1).maybeSingle(),
      // นับทุกวันที่ยังดึงไม่ครบ ไม่จำกัดช่วงที่เลือกดู — ดู 7 วันอยู่ก็ต้องรู้ว่าวันเก่ายังดึงอยู่
      sb.from('os_statements').select('statement_id', { count: 'exact', head: true })
        .eq('platform', 'tiktok').eq('done', false),
      view === 'sku'
        ? sb.rpc(group === 'product' ? 'os_money_by_product' : 'os_money_by_sku', skuArgs)
        : null,
    ]);
    if (listRes?.error) throw new Error(listRes.error.message);
    if (sumRes.error) throw new Error(sumRes.error.message);
    // ตารางรายวันพังแยกได้ (เช่นยังไม่ได้รัน 015) — ส่วนอื่นของหน้ายังใช้ได้
    if (dayRes?.error) dailyErr = dayRes.error.message;
    let skuData = skuRes?.data || null;
    let skuError = skuRes?.error?.message || null;
    if (skuError && group === 'product') {
      // ยังไม่ได้รัน 018 — ถอยไปแสดงรายรหัสก่อน หน้าจะได้ไม่ว่าง แล้วบอกให้รัน
      const again = await sb.rpc('os_money_by_sku', skuArgs);
      if (!again.error) { skuData = again.data; skuError = null; needs018 = true; }
    }
    skuErr = skuError;
    bySku = skuData;

    rows = listRes?.data || [];
    total = listRes?.count || 0;
    sum = sumRes.data || {};
    daily = dayRes?.data || [];
    lastRun = logRes?.data || null;
    pendingAll = pendRes?.count || 0;
  } catch (e) {
    err = String(e.message || e);
  }

  // หน้ารายสินค้าไม่นับออเดอร์ตีคืน (ดู 017) การ์ดด้านบนต้องใช้ยอดชุดเดียวกับตาราง ไม่งั้นอ่านแล้วงง
  // ยังไม่ได้รัน 017 = ฟังก์ชันรุ่น 016 ไม่มียอดแบบไม่นับตีคืนมาให้ — ใช้ยอดเดิมไปก่อนแล้วบอกให้รัน
  const needs017 = view === 'sku' && bySku && !skuErr && bySku.tot_gross === undefined;
  const noReturns = view === 'sku' && bySku && !skuErr && !needs017;
  const byProduct = group === 'product' && !needs018;
  const gross = Number((noReturns ? bySku.tot_gross : sum.gross) || 0);
  const settlement = Number((noReturns ? bySku.tot_settlement : sum.settlement) || 0);
  const charges = noReturns
    ? Number(bySku.tot_charges || 0)
    : Number(sum.fee || 0) + Number(sum.shipping || 0);
  const sellerDiscount = noReturns ? bySku.tot_seller_discount : sum.seller_discount;

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
            TikTok · {day ? `ปิดยอดวันที่ ${fmtDay(`${day}T00:00:00Z`)}` : `ปิดยอดใน ${days} วันล่าสุด`}
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

      {day ? (
        <div className="tabs">
          <Link prefetch={false} className="tab" href={qs({ day: null, only: 'all' })}>← กลับไปดูรายวัน</Link>
        </div>
      ) : (
        <div className="tabs">
          {RANGES.map((r) => (
            <Link prefetch={false} key={r.days} className="tab" data-on={days === r.days ? '1' : '0'} href={qs({ days: r.days })}>
              {r.label}
            </Link>
          ))}
        </div>
      )}

      <div className="mcards">
        <div className="mcard">
          <span className="mlabel">
            {noReturns
              ? `ราคาป้ายรวม (${Number(bySku.tot_qty || 0).toLocaleString('en-US')} ชิ้น ไม่นับตีคืน)`
              : `ราคาป้ายรวม (${(sum.rows || 0).toLocaleString('en-US')} รายการ)`}
          </span>
          <b>{baht(gross)}</b>
        </div>
        <div className="mcard">
          <span className="mlabel">ร้านลดไป</span>
          <b className="danger">{baht(sellerDiscount)}</b>
          {gross > 0 && <span className="mfoot">{Math.abs(pct(sellerDiscount, gross))}% ของราคาป้าย</span>}
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

      {view === 'daily' && Number(sum.loss_n) > 0 && (
        <div className="note note-danger">
          <b>ขาดทุน {sum.loss_n} ใบ รวม {baht(sum.loss)}</b> — ส่วนใหญ่คือตีคืน
          (ไม่ได้เงินค่าสินค้า แต่ยังโดนค่าส่งไป-กลับ + ค่าธรรมเนียม){' '}
          <Link href={qs({ only: 'loss' })}>ดูรายการ</Link>
        </div>
      )}

      {/* แท็บมุมมอง */}
      <div className="tabs">
        {view === 'day' ? (
          <>
            <Link prefetch={false} className="tab" data-on={only === 'all' ? '1' : '0'} href={qs({ only: 'all' })}>
              ทุกรายการ <b>{sum.rows || 0}</b>
            </Link>
            <Link prefetch={false} className="tab" data-tone="err" data-on={only === 'loss' ? '1' : '0'} href={qs({ only: 'loss' })}>
              ขาดทุน <b>{sum.loss_n || 0}</b>
            </Link>
          </>
        ) : (
          <>
            <Link prefetch={false} className="tab" data-on={view === 'daily' ? '1' : '0'} href={qs({ view: null, only: 'all' })}>รายวัน</Link>
            <Link prefetch={false} className="tab" data-on={view === 'sku' ? '1' : '0'} href={qs({ view: 'sku' })}>รายสินค้า</Link>
            <Link prefetch={false} className="tab" data-tone="err" data-on={view === 'loss' ? '1' : '0'} href={qs({ view: null, only: 'loss' })}>
              ขาดทุน <b>{sum.loss_n || 0}</b>
            </Link>
          </>
        )}
      </div>

      {view === 'sku' && skuErr && (
        <div className="note">
          <b>รายสินค้ายังใช้ไม่ได้</b><br />{skuErr}<br /><br />
          รัน <code>supabase/016_money_by_sku.sql</code> ใน Supabase ก่อน
        </div>
      )}

      {needs017 && (
        <div className="note">
          <b>ยังนับออเดอร์ตีคืนรวมอยู่</b> — รัน <code>supabase/017_money_by_sku_no_returns.sql</code> ใน Supabase
          เพื่อแยกตีคืนออกและเรียงตามส่วนลดได้
        </div>
      )}

      {needs018 && (
        <div className="note">
          <b>ยังรวมตามตะกร้าไม่ได้</b> — รัน <code>supabase/018_money_by_product.sql</code> ใน Supabase ก่อน
          ระหว่างนี้แสดงแยกทีละรหัสไปก่อน
        </div>
      )}

      {view === 'sku' && !skuErr && bySku && (
        <>
          <div className="tabs">
            <Link prefetch={false} className="tab" data-on={byProduct ? '1' : '0'} href={qs({ group: 'product' })}>รวมตามตะกร้า</Link>
            <Link prefetch={false} className="tab" data-on={!byProduct ? '1' : '0'} href={qs({ group: 'sku' })}>แยกสี/ไซส์</Link>
          </div>
          <div className="tabs">
            {SORTS.map((s) => (
              <Link prefetch={false} key={s.key} className="chip" data-on={sort === s.key ? '1' : '0'} href={qs({ sort: s.key })}>
                {sort === s.key ? '● ' : ''}{s.label}
              </Link>
            ))}
            <span className="sub" style={{ margin: 0 }}>
              {Number(byProduct ? bySku.products : bySku.skus).toLocaleString('en-US')} {byProduct ? 'ตะกร้า' : 'รหัส'}
              {' '}· นับเฉพาะที่ขายตั้งแต่ {SKU_MIN_QTY} ชิ้น · ไม่นับตีคืน
              {Number(byProduct ? bySku.products : bySku.skus) > 100 ? ' · แสดง 100 อันดับแรก' : ''}
            </span>
          </div>

          {Number(bySku.returns_n) > 0 && (
            <div className="note">
              <b>ไม่นับออเดอร์ที่ตีคืน {Number(bySku.returns_n).toLocaleString('en-US')} ใบ ({baht(bySku.returns)})</b>
              {' '}— ตีคืนไม่ได้เงินค่าสินค้าแต่ยังโดนค่าส่งไป-กลับ ถ้านับรวม % จะดูแย่ทั้งที่ไม่เกี่ยวกับส่วนลด
              ดูจำนวนตีคืนของแต่ละสินค้าได้ที่คอลัมน์ขวาสุด
            </div>
          )}

          {Number(bySku.unmatched_n) > 0 && (
            <div className="note">
              มี {Number(bySku.unmatched_n).toLocaleString('en-US')} ออเดอร์ ({baht(bySku.unmatched)}) ที่หาสินค้าไม่เจอ
              ส่วนใหญ่เป็นออเดอร์ที่ถูกล้างออกจากระบบไปก่อนยอดปิด — ไม่ได้นับรวมในตารางนี้
            </div>
          )}

          <table className="orders">
            <thead>
              <tr>
                <th>{byProduct ? 'ตะกร้า' : 'สินค้า'}</th>
                <th className="r">ขาย</th>
                <th className="r">ราคาป้าย</th>
                <th className="r">ร้านลด</th>
                <th className="r">โดนหัก</th>
                <th className="r">เข้าจริง</th>
                <th className="r">เข้าจริง/ชิ้น</th>
                <th className="r">เหลือ</th>
                <th className="r">ตีคืน</th>
              </tr>
            </thead>
            <tbody>
              {(bySku.rows || []).map((s) => {
                const p = pct(s.settlement, s.gross);
                const qty = Number(s.qty) || 0;
                return (
                  <tr key={byProduct ? s.pkey : s.sku || '(ไม่มีรหัส)'}>
                    <td data-label={byProduct ? 'ตะกร้า' : 'สินค้า'}>
                      <div className="line">
                        {s.image_url
                          ? <img className="thumb sm" src={s.image_url} alt="" loading="lazy" />
                          : <span className="thumb sm thumb-empty" />}
                        <div style={{ minWidth: 0 }}>
                          <div className="clamp1" title={s.product_name || ''}>{s.product_name || '—'}</div>
                          {byProduct
                            ? <VariantList variants={s.variants} count={s.variants_n} />
                            : <div className="sku">{s.sku || '(ไม่มีรหัส)'}</div>}
                        </div>
                      </div>
                    </td>
                    <td data-label="ขาย" className="num">{qty.toLocaleString('en-US')} ชิ้น</td>
                    <td data-label="ราคาป้าย" className="num">
                      {baht(s.gross)}
                      {qty > 0 && <div className="sku">{baht(Number(s.gross) / qty)}/ชิ้น</div>}
                    </td>
                    <td data-label="ร้านลด" className="num">
                      {Number(s.seller_discount) ? baht(s.seller_discount) : '—'}{ofGross(s.seller_discount, s.gross)}
                    </td>
                    <td data-label="โดนหัก" className="num">
                      <span className="danger">{baht(s.charges)}</span>{ofGross(s.charges, s.gross)}
                    </td>
                    <td data-label="เข้าจริง" className="num"><b>{baht(s.settlement)}</b></td>
                    <td data-label="เข้าจริง/ชิ้น" className="num">{qty > 0 ? baht(Number(s.settlement) / qty) : '—'}</td>
                    <td data-label="เหลือ" className="num">
                      {p === null ? '—' : <span className={`badge ${tone(p)}`}>{p}%</span>}
                    </td>
                    <td data-label="ตีคืน (ไม่นับรวม)" className="num">
                      {Number(s.ret_orders)
                        ? <span className="sku">{s.ret_orders} ใบ<br />{baht(s.ret_settlement)}</span>
                        : '—'}
                    </td>
                  </tr>
                );
              })}
              {!(bySku.rows || []).length && (
                <tr>
                  <td colSpan={9} style={{ color: 'var(--muted)' }}>ยังไม่มีสินค้าที่ขายถึง {SKU_MIN_QTY} ชิ้นในช่วงนี้</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="note" style={{ marginTop: 12 }}>
            <b>คิดยังไง</b> — ไม่นับออเดอร์ที่ตีคืน · ราคาป้ายกับส่วนลดร้านใช้ตัวเลขจริงของแต่ละชิ้น
            ส่วนค่าคอม ค่าธรรมเนียม ค่าส่ง TikTok ให้มาเป็นยอดรวมต่อออเดอร์
            ออเดอร์ที่มีหลายสินค้า (~6%) จึงปันตามราคาขาย ออเดอร์สินค้าเดียวได้ตัวเลขตรงเต็มจำนวน
          </div>
        </>
      )}

      {view === 'daily' && dailyErr && (
        <div className="note">
          <b>ตารางรายวันยังใช้ไม่ได้</b><br />{dailyErr}<br /><br />
          รัน <code>supabase/015_money_daily.sql</code> ใน Supabase ก่อน
        </div>
      )}

      {view === 'daily' && !dailyErr && (
        <table className="orders">
          <thead>
            <tr>
              <th>วันปิดยอด</th>
              <th className="r">ออเดอร์</th>
              <th className="r">ราคาป้าย</th>
              <th className="r">ร้านลด</th>
              <th className="r">โดนหัก</th>
              <th className="r">เข้าจริง</th>
              <th className="r">เหลือ</th>
              <th className="r">ขาดทุน</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => {
              const p = pct(d.settlement, d.gross);
              const key = dayKey(d.day);
              return (
                <tr key={key} className="clickable">
                  <td data-label="วันปิดยอด">
                    <Link prefetch={false} href={qs({ day: key })}><b>{fmtDay(d.day)}</b> →</Link>
                    {!d.synced && <div><span className="badge warn">ยังดึงไม่ครบ</span></div>}
                  </td>
                  <td data-label="ออเดอร์" className="num">{Number(d.rows).toLocaleString('en-US')}</td>
                  <td data-label="ราคาป้าย" className="num">{baht(d.gross)}</td>
                  <td data-label="ร้านลด" className="num">{baht(d.seller_discount)}{ofGross(d.seller_discount, d.gross)}</td>
                  <td data-label="โดนหัก" className="num">
                    <span className="danger">{baht(Number(d.fee) + Number(d.shipping))}</span>
                    {ofGross(Number(d.fee) + Number(d.shipping), d.gross)}
                  </td>
                  <td data-label="เข้าจริง" className="num"><b>{baht(d.settlement)}</b></td>
                  <td data-label="เหลือ" className="num">
                    {p === null ? '—' : <span className={`badge ${tone(p)}`}>{p}%</span>}
                  </td>
                  <td data-label="ขาดทุน" className="num">
                    {Number(d.loss_n)
                      ? <Link prefetch={false} href={qs({ day: key, only: 'loss' })} className="danger">{d.loss_n} ใบ</Link>
                      : '—'}
                  </td>
                </tr>
              );
            })}
            {!daily.length && !err && (
              <tr>
                <td colSpan={8} style={{ color: 'var(--muted)' }}>ยังไม่มีข้อมูลในช่วงนี้ — กด “ดึงยอดเงิน” เพื่อเริ่ม</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {(view === 'day' || view === 'loss') && (
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
                  <td data-label="ร้านลด" className="num">
                    {Number(t.seller_discount) ? baht(t.seller_discount) : '—'}{ofGross(t.seller_discount, t.gross)}
                  </td>
                  <td data-label="โดนหัก" className="num">
                    <span className="danger">{baht(charge)}</span>{ofGross(charge, t.gross)}
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
                <td colSpan={7} style={{ color: 'var(--muted)' }}>ไม่มีรายการ</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {(view === 'day' || view === 'loss') && total > PAGE_SIZE && (
        <div className="pager">
          <Link prefetch={false} data-off={page <= 1 ? '1' : '0'} href={qs({ page: page - 1 })}>← ก่อนหน้า</Link>
          <span className="sub" style={{ margin: 0 }}>หน้า {page} / {Math.ceil(total / PAGE_SIZE)}</span>
          <Link prefetch={false} data-off={page * PAGE_SIZE >= total ? '1' : '0'} href={qs({ page: page + 1 })}>ถัดไป →</Link>
        </div>
      )}

      <div className="note" style={{ marginTop: 16 }}>
        <b>นับวันยังไง</b> — ตาม “วันที่ TikTok ปิดยอด” ซึ่งตรงกับเงินที่โอนเข้าบัญชีวันนั้น ไม่ใช่วันที่ลูกค้าสั่ง
        ออเดอร์ปิดยอดหลังสั่งราว 10-20 วัน ถ้านับตามวันสั่ง สองสัปดาห์ล่าสุดจะยังไม่ครบและดูต่ำเกินจริง
        <br />“เหลือ” = เงินเข้าจริงหารราคาป้าย · ตอนนี้รองรับ TikTok ก่อน Shopee กับ Lazada ต่อทีหลัง
      </div>
    </>
  );
}
