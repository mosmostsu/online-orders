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
// รายสินค้า: ค่าเริ่มต้นแสดงทุกตะกร้าที่ขายได้
// ปุ่ม 5/20 ชิ้นมีไว้กรองตัวที่ขายน้อยออก เวลาเรียงตามส่วนลดแล้วตัวที่ขายชิ้นเดียวมารบกวนหัวตาราง
const MIN_QTYS = [1, 5, 20];
const SKU_MIN_QTY = 1;
const SKU_LIMIT = 1000;
// คอลัมน์ของตารางรายสินค้า — กดหัวตารางเพื่อเรียง กดซ้ำสลับมาก/น้อย
// เรียงฝั่งเว็บ เพราะดึงมาครบทุกแถวอยู่แล้ว (ไม่เกินพันตะกร้า) จะได้เรียงได้ทุกคอลัมน์
const COLS = [
  { key: 'qty', label: 'ขาย', of: (r) => Number(r.qty) || 0 },
  { key: 'gross', label: 'ราคาป้าย', of: (r) => Number(r.gross) || 0 },
  { key: 'disc', label: 'ร้านลด', of: (r) => (Number(r.gross) > 0 ? -Number(r.seller_discount) / Number(r.gross) : 0) },
  { key: 'charges', label: 'โดนหัก', of: (r) => -Number(r.charges) || 0 },
  { key: 'net', label: 'เข้าจริง', of: (r) => Number(r.settlement) || 0 },
  // ตัวที่ไม่มีทุนให้ไปอยู่ท้ายเสมอไม่ว่าจะเรียงทางไหน — ค่าติดลบมากๆ ตอนเรียงมาก→น้อย
  { key: 'cost', label: 'ทุน', of: (r) => (r._cost ?? -1e12) },
  { key: 'profit', label: 'กำไร', of: (r) => (r._profit ?? -1e12) },
  { key: 'margin', label: 'กำไร %', of: (r) => (r._margin ?? -1e12) },
  { key: 'ret', label: 'ตีคืน', of: (r) => Number(r.ret_orders) || 0 },
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

// กำไรกี่ % ของราคาป้าย — ใช้ฐานเดียวกับคอลัมน์อื่น อ่านต่อกันได้: ร้านลด + โดนหัก + ทุน + กำไร = 100
const profitTone = (p) => (p === null ? 'dim' : p >= 15 ? 'ok' : p >= 5 ? 'warn' : 'err');

// ทุนของหนึ่งแถว (ตะกร้า = รวมทุกตัวเลือกข้างใน) จากทุนล่าสุดต่อรหัส
// คิดกำไรเฉพาะแถวที่มีทุนครบทุกชิ้น — ครบแค่บางส่วนแล้วเอามาหักจะได้กำไรสูงเกินจริง
function withCost(r, costs, byProduct) {
  if (!costs) return r;
  const parts = byProduct ? (r.variants || []) : [r];
  let cost = 0, qty = 0, covered = 0, est = false, off = false;
  for (const v of parts) {
    const q = Number(v.qty) || 0;
    qty += q;
    const c = costs[v.sku];
    if (c && q > 0) {
      cost += q * Number(c.cost);
      covered += q;
      if (c.est) est = true;
      if (c.off) off = true;
    }
  }
  if (!qty || covered < qty) return { ...r, _costPartial: covered > 0 };
  const profit = Number(r.settlement) - cost;
  return {
    ...r,
    _cost: cost,
    _profit: profit,
    _margin: Number(r.gross) > 0 ? profit / Number(r.gross) : null,
    _costEst: est,
    _costOff: off,
  };
}

// ตัวเลือกสี/ไซส์ข้างในตะกร้า — พับไว้ กางดูได้ว่าตัวไหนลดหนัก/เหลือน้อย/กำไรน้อย
function VariantList({ variants, count, costs }) {
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
                <td>{qty > 0 ? `เข้า ${baht(Number(v.settlement) / qty)}/ชิ้น` : '—'}</td>
                {costs && (() => {
                  const c = costs[v.sku];
                  if (!c || !qty) return <td colSpan={2}>ไม่มีทุน</td>;
                  const profit = Number(v.settlement) / qty - Number(c.cost);
                  return (
                    <>
                      <td>ทุน {baht(c.cost)}{c.est ? '*' : ''}{c.off ? ' (ลดนอกบิล)' : ''}</td>
                      <td className={profit < 0 ? 'danger' : undefined}>กำไร {baht(profit)}/ชิ้น</td>
                    </>
                  );
                })()}
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
  // ช่วงวันปิดยอดที่เลือกเอง "วันที่...ถึงวันที่..." — ถ้ามี จะใช้แทนปุ่ม 7/30/60 วัน
  // วันที่ในลิงก์เป็นวันไทย ซึ่งตรงกับวันที่ UTC ของใบสรุป (ใบสรุปตัดรอบ 00:00 UTC = 07:00 ไทย)
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const todayTH = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  let dFrom = isDate(sp?.from) ? sp.from : null;
  let dTo = isDate(sp?.to) ? sp.to : null;
  if (dFrom && !dTo) dTo = todayTH;
  if (dTo && !dFrom) dFrom = new Date(new Date(`${dTo}T00:00:00Z`).getTime() - 29 * 86400000).toISOString().slice(0, 10);
  if (dFrom && dTo && dFrom > dTo) [dFrom, dTo] = [dTo, dFrom];
  const custom = Boolean(dFrom && dTo);
  const page = Math.max(1, Number(sp?.page) || 1);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp?.day || '') ? sp.day : null;
  const only = sp?.only === 'loss' ? 'loss' : 'all';
  const sort = COLS.some((c) => c.key === sp?.sort) ? sp.sort : 'qty';
  const dir = sp?.dir === 'asc' ? 'asc' : 'desc';
  const q = (sp?.q || '').trim();
  const minQty = MIN_QTYS.includes(Number(sp?.min)) ? Number(sp.min) : SKU_MIN_QTY;
  // รายสินค้า: รวมตามตะกร้า (ค่าเริ่มต้น) หรือแยกทีละรหัสสี/ไซส์
  const group = sp?.group === 'sku' ? 'sku' : 'product';
  // เจาะดูรายออเดอร์ของตะกร้า/รหัสเดียว — ค่าที่ส่งมาคือ pkey (รหัสตะกร้า) หรือรหัสสินค้า
  const pick = typeof sp?.pick === 'string' && sp.pick ? sp.pick : null;
  // สี่มุมมอง: รายวัน (ค่าเริ่มต้น) · รายสินค้า · ขาดทุนทั้งช่วง · รายออเดอร์ของวันที่เลือก
  const view = day ? 'day' : sp?.view === 'sku' ? 'sku' : only === 'loss' ? 'loss' : 'daily';

  const qs = (o = {}) => {
    const p = new URLSearchParams({ days: String(o.days ?? days) });
    const v = o.view !== undefined ? o.view : view === 'sku' ? 'sku' : null;
    const d = o.day === undefined ? day : o.day;
    const on = o.only ?? (o.day !== undefined || o.view !== undefined ? 'all' : only);
    if (v === 'sku' && !d) {
      p.set('view', 'sku');
      const pk = o.pick === undefined ? pick : o.pick;
      if (pk) p.set('pick', pk);
      if ((o.sort ?? sort) !== 'qty') p.set('sort', o.sort ?? sort);
      if ((o.dir ?? dir) !== 'desc') p.set('dir', o.dir ?? dir);
      if ((o.q ?? q)) p.set('q', o.q ?? q);
      if ((o.group ?? group) !== 'product') p.set('group', o.group ?? group);
      if ((o.min ?? minQty) !== SKU_MIN_QTY) p.set('min', String(o.min ?? minQty));
    }
    if (d) p.set('day', d);
    if (on !== 'all') p.set('only', on);
    // กดปุ่ม 7/30/60 วัน = เลิกใช้ช่วงที่เลือกเอง นอกนั้นพาช่วงวันติดไปด้วยทุกลิงก์
    if (custom && o.days === undefined) { p.set('from', dFrom); p.set('to', dTo); }
    if ((o.page ?? 1) > 1) p.set('page', String(o.page));
    return '/money?' + p.toString();
  };

  const rangeFrom = custom ? `${dFrom}T00:00:00.000Z` : new Date(Date.now() - days * 86400000).toISOString();
  const rangeTo = custom
    ? new Date(new Date(`${dTo}T00:00:00.000Z`).getTime() + 86400000).toISOString()
    : new Date(Date.now() + 86400000).toISOString();
  // การ์ดสรุปกับรายการ ใช้ช่วงของวันที่เลือก ถ้าไม่ได้เลือกวันก็ใช้ทั้งช่วง
  const from = day ? `${day}T00:00:00.000Z` : rangeFrom;
  const to = day ? new Date(new Date(`${day}T00:00:00.000Z`).getTime() + 86400000).toISOString() : rangeTo;

  let rows = [], total = 0, sum = {}, daily = [], bySku = null, lastRun = null, pendingAll = 0;
  let err = null, dailyErr = null, skuErr = null, needs018 = false;
  let costMap = null, costErr = null;
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
      p_from: rangeFrom, p_to: rangeTo, p_platform: 'tiktok', p_sort: 'qty', p_min_qty: minQty, p_limit: SKU_LIMIT,
    };
    const [listRes, sumRes, dayRes, logRes, pendRes, skuRes, costRes] = await Promise.all([
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
      // ทุนล่าสุดของรหัสที่ขายในช่วงนี้ (จากบิลรับของ Seniorsoft) — ไม่มีก็ยังดูหน้าได้ แค่ไม่มีคอลัมน์กำไร
      view === 'sku'
        ? sb.rpc('os_costs_for', { p_from: rangeFrom, p_to: rangeTo, p_platform: 'tiktok' })
        : null,
    ]);
    if (costRes?.error) costErr = costRes.error.message;
    else if (costRes?.data) costMap = costRes.data;
    if (listRes?.error) throw new Error(listRes.error.message);
    if (sumRes.error) throw new Error(sumRes.error.message);
    // ตารางรายวันพังแยกได้ (เช่นยังไม่ได้รัน 015) — ส่วนอื่นของหน้ายังใช้ได้
    if (dayRes?.error) dailyErr = dayRes.error.message;
    // รายออเดอร์ของตะกร้า/รหัสที่เจาะดู — หนึ่งแถวคือสินค้าหนึ่งตัวในออเดอร์หนึ่งใบ
    if (view === 'sku' && pick) {
      let pq = sb.from('os_money_items')
        .select('tx_id, order_id, sku, variant, qty, gross, seller_discount, charges, settlement, statement_at', { count: 'exact' })
        .eq('platform', 'tiktok')
        .gte('statement_at', rangeFrom).lt('statement_at', rangeTo);
      pq = group === 'product' && !needs018 ? pq.eq('product_id', pick) : pq.eq('sku', pick);
      const picked = await pq
        .order('statement_at', { ascending: false })
        .order('settlement', { ascending: true })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      if (!picked.error) {
        rows = picked.data || [];
        total = picked.count || 0;
        // ใบไหนเป็นออเดอร์ตีคืน — หน้ารายสินค้าไม่นับพวกนี้ ต้องติดป้ายไว้ไม่ให้งงว่าทำไมตัวเลขไม่บวกกัน
        const txIds = rows.map((r) => r.tx_id);
        if (txIds.length) {
          const { data: txs } = await sb.from('os_money_tx')
            .select('tx_id, breakdown').eq('platform', 'tiktok').in('tx_id', txIds);
          const ret = new Set((txs || [])
            .filter((t) => t.breakdown && 'rev.refund_subtotal_before_discount_amount' in t.breakdown)
            .map((t) => t.tx_id));
          rows = rows.map((r) => ({ ...r, is_return: ret.has(r.tx_id) }));
        }
      }
    }

    let skuData = skuRes?.data || null;
    let skuError = skuRes?.error?.message || null;
    if (skuError && group === 'product') {
      // ยังไม่ได้รัน 018 — ถอยไปแสดงรายรหัสก่อน หน้าจะได้ไม่ว่าง แล้วบอกให้รัน
      const again = await sb.rpc('os_money_by_sku', skuArgs);
      if (!again.error) { skuData = again.data; skuError = null; needs018 = true; }
    }
    skuErr = skuError;
    bySku = skuData;

    // รูปปกของตะกร้า — ข้อมูลออเดอร์มีแค่รูปของตัวเลือก จึงใช้รูปปกที่รอบดึงยอดเก็บไว้แทนถ้ามี
    // ยังไม่ได้รัน 019 หรือยังดึงรูปไม่ถึง ก็ใช้รูปตัวเลือกไปก่อน ไม่ต้องพัง
    const productIds = (bySku?.rows || []).map((r) => r.product_id).filter(Boolean);
    if (productIds.length) {
      const { data: covers } = await sb.from('os_products')
        .select('product_id, thumb_url, cover_url')
        .eq('platform', 'tiktok').in('product_id', productIds);
      const coverOf = new Map((covers || []).map((c) => [c.product_id, c.thumb_url || c.cover_url]));
      bySku.rows = bySku.rows.map((r) => ({ ...r, image_url: coverOf.get(r.product_id) || r.image_url }));
    }

    // เฉพาะมุมมองที่ถามรายออเดอร์มา — ถ้าเป็นหน้าเจาะดูสินค้า rows ถูกเติมไว้ข้างบนแล้ว อย่าล้างทิ้ง
    if (listRes) {
      rows = listRes.data || [];
      total = listRes.count || 0;
    }
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

  // ค้นด้วยชื่อสินค้า รหัสตะกร้า หรือรหัสสี/ไซส์ข้างใน แล้วเรียงตามคอลัมน์ที่เลือก
  const hasCosts = Boolean(costMap && Object.keys(costMap).length);
  const allSkuRows = (bySku?.rows || []).map((r) => (hasCosts ? withCost(r, costMap, byProduct) : r));

  // ยอดรวมทุน/กำไร — นับเฉพาะแถวที่มีทุนครบ แล้วบอกว่าครอบคลุมกี่ % ของชิ้นที่ขาย
  const costTot = (() => {
    if (!hasCosts) return null;
    let cost = 0, settle = 0, gr = 0, q = 0, qAll = 0;
    for (const r of allSkuRows) {
      qAll += Number(r.qty) || 0;
      if (r._cost === undefined) continue;
      cost += r._cost; settle += Number(r.settlement) || 0; gr += Number(r.gross) || 0; q += Number(r.qty) || 0;
    }
    return { cost, profit: settle - cost, gross: gr, coverage: qAll ? q / qAll : 0 };
  })();
  const needle = q.toLowerCase();
  const skuRows = (() => {
    const hit = needle
      ? allSkuRows.filter((r) => [r.product_name, r.sku, r.product_id, ...(r.variants || []).map((v) => v.sku)]
        .some((v) => String(v || '').toLowerCase().includes(needle)))
      : [...allSkuRows];
    const col = COLS.find((c) => c.key === sort) || COLS[0];
    hit.sort((a, b) => (dir === 'asc' ? col.of(a) - col.of(b) : col.of(b) - col.of(a)));
    return hit;
  })();
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
            TikTok · {day
              ? `ปิดยอดวันที่ ${fmtDay(`${day}T00:00:00Z`)}`
              : custom
                ? `ปิดยอด ${fmtDay(`${dFrom}T00:00:00Z`)} – ${fmtDay(`${dTo}T00:00:00Z`)}`
                : `ปิดยอดใน ${days} วันล่าสุด`}
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
            <Link prefetch={false} key={r.days} className="tab" data-on={!custom && days === r.days ? '1' : '0'} href={qs({ days: r.days })}>
              {r.label}
            </Link>
          ))}
          <span className="divider" />
          {/* ฟอร์ม GET ธรรมดา ไม่ต้องมีโค้ดฝั่งเครื่อง — กดดูแล้วได้ลิงก์ที่ส่งต่อให้คนอื่นได้ */}
          <form className="daterange" action="/money" method="get" data-on={custom ? '1' : '0'}>
            {view === 'sku' && <input type="hidden" name="view" value="sku" />}
            {view === 'sku' && group !== 'product' && <input type="hidden" name="group" value={group} />}
            {view === 'sku' && sort !== 'disc' && <input type="hidden" name="sort" value={sort} />}
            {only === 'loss' && <input type="hidden" name="only" value="loss" />}
            <input type="date" name="from" defaultValue={dFrom || rangeFrom.slice(0, 10)} max={todayTH} aria-label="ตั้งแต่วันที่" />
            <span>ถึง</span>
            <input type="date" name="to" defaultValue={dTo || todayTH} max={todayTH} aria-label="ถึงวันที่" />
            <button className="btn" type="submit">ดู</button>
          </form>
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
        {view === 'sku' && costTot && (
          <>
            <div className="mcard">
              <span className="mlabel">ทุนสินค้า (บิลรับของล่าสุด)</span>
              <b>{baht(costTot.cost)}</b>
              {costTot.gross > 0 && <span className="mfoot">{pct(costTot.cost, costTot.gross)}% ของราคาป้าย</span>}
            </div>
            <div className="mcard hero">
              <span className="mlabel">กำไร</span>
              <b className={costTot.profit < 0 ? 'danger' : undefined}>{baht(costTot.profit)}</b>
              <span className="mfoot">
                {costTot.gross > 0 ? `${pct(costTot.profit, costTot.gross)}% ของราคาป้าย · ` : ''}
                คิดจาก {Math.round(costTot.coverage * 100)}% ของชิ้นที่ขาย
              </span>
            </div>
          </>
        )}
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

      {view === 'sku' && pick && (
        <>
          <div className="tabs">
            <Link prefetch={false} className="tab" href={qs({ pick: null })}>← กลับไปดูรายสินค้า</Link>
          </div>

          <div className="note">
            รายออเดอร์ของ{byProduct ? 'ตะกร้า' : 'รหัส'}นี้ในช่วงที่เลือก — {total.toLocaleString('en-US')} รายการ
            {' '}หนึ่งแถว = สินค้าตัวนี้ในออเดอร์หนึ่งใบ ค่าธรรมเนียมเป็นส่วนที่ปันมาให้ตัวนี้แล้ว
          </div>

          <table className="orders">
            <thead>
              <tr>
                <th>ออเดอร์</th>
                <th>ปิดยอด</th>
                <th className="r">ชิ้น</th>
                <th className="r">ราคาป้าย</th>
                <th className="r">ร้านลด</th>
                <th className="r">โดนหัก</th>
                <th className="r">เข้าจริง</th>
                <th className="r">ทุน</th>
                <th className="r">กำไร</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const keep = pct(r.settlement, r.gross);
                const c = hasCosts ? costMap[r.sku] : null;
                const cost = c ? Number(c.cost) * (Number(r.qty) || 0) : null;
                const profit = cost === null ? null : Number(r.settlement) - cost;
                const margin = profit === null ? null : pct(profit, r.gross);
                return (
                  <tr key={r.tx_id + '-' + (r.sku || '')}>
                    <td data-label="ออเดอร์">
                      <Link href={`/orders/${r.order_id}`} className="mono">{r.order_id}</Link>
                      <div className="sku">
                        {r.variant || r.sku}
                        {r.is_return && <span className="badge err" style={{ marginLeft: 6 }}>ตีคืน ไม่นับรวม</span>}
                      </div>
                    </td>
                    <td data-label="ปิดยอด">{fmtDate(r.statement_at)}</td>
                    <td data-label="ชิ้น" className="num">{r.qty}</td>
                    <td data-label="ราคาป้าย" className="num">{baht(r.gross)}</td>
                    <td data-label="ร้านลด" className="num">
                      {Number(r.seller_discount) ? baht(r.seller_discount) : '—'}{ofGross(r.seller_discount, r.gross)}
                    </td>
                    <td data-label="โดนหัก" className="num">
                      <span className="danger">{baht(r.charges)}</span>{ofGross(r.charges, r.gross)}
                    </td>
                    <td data-label="เข้าจริง" className="num">
                      <b className={Number(r.settlement) < 0 ? 'danger' : undefined}>{baht(r.settlement)}</b>
                      {keep !== null && <div className="sku">เหลือ {keep}%</div>}
                    </td>
                    <td data-label="ทุน" className="num">
                      {cost === null ? '—' : (
                        <>
                          {baht(cost)}{c.est ? '*' : ''}{ofGross(cost, r.gross)}
                          {c.off && <div className="sku">หักลดนอกบิลแล้ว</div>}
                        </>
                      )}
                    </td>
                    <td data-label="กำไร" className="num">
                      {profit === null ? '—' : (
                        <>
                          <b className={profit < 0 ? 'danger' : undefined}>{baht(profit)}</b>
                          {margin !== null && <div><span className={`badge ${profitTone(margin)}`}>{margin}%</span></div>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={9} style={{ color: 'var(--muted)' }}>ไม่มีรายการในช่วงนี้</td></tr>
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
        </>
      )}

      {view === 'sku' && !pick && !skuErr && bySku && (
        <>
          <div className="tabs">
            <Link prefetch={false} className="tab" data-on={byProduct ? '1' : '0'} href={qs({ group: 'product' })}>รวมตามตะกร้า</Link>
            <Link prefetch={false} className="tab" data-on={!byProduct ? '1' : '0'} href={qs({ group: 'sku' })}>แยกสี/ไซส์</Link>
          </div>
          <form className="search" action="/money" method="get">
            <input type="hidden" name="view" value="sku" />
            {group !== 'product' && <input type="hidden" name="group" value={group} />}
            {minQty !== SKU_MIN_QTY && <input type="hidden" name="min" value={String(minQty)} />}
            {sort !== 'qty' && <input type="hidden" name="sort" value={sort} />}
            {dir !== 'desc' && <input type="hidden" name="dir" value={dir} />}
            {custom && <input type="hidden" name="from" value={dFrom} />}
            {custom && <input type="hidden" name="to" value={dTo} />}
            {!custom && <input type="hidden" name="days" value={String(days)} />}
            <input name="q" defaultValue={q} placeholder="ค้นชื่อสินค้า หรือรหัส" aria-label="ค้นหาสินค้า" />
            <button className="btn" type="submit">ค้นหา</button>
            {q && <Link className="chip" href={qs({ q: '' })}>ล้าง</Link>}
          </form>

          <div className="tabs">
            <span className="sub" style={{ margin: 0 }}>ขายตั้งแต่</span>
            {MIN_QTYS.map((m) => (
              <Link prefetch={false} key={m} className="chip" data-on={minQty === m ? '1' : '0'} href={qs({ min: m })}>
                {m === 1 ? 'ทั้งหมด' : `${m} ชิ้น`}
              </Link>
            ))}
            <span className="sub" style={{ margin: 0 }}>
              {skuRows.length.toLocaleString('en-US')} {byProduct ? 'ตะกร้า' : 'รหัส'}
              {q ? ` ที่ตรงกับ “${q}”` : ''} · ไม่นับตีคืน
            </span>
          </div>

          {Number(bySku.returns_n) > 0 && (
            <div className="note">
              <b>ไม่นับออเดอร์ที่ตีคืน {Number(bySku.returns_n).toLocaleString('en-US')} ใบ ({baht(bySku.returns)})</b>
              {' '}— ตีคืนไม่ได้เงินค่าสินค้าแต่ยังโดนค่าส่งไป-กลับ ถ้านับรวม % จะดูแย่ทั้งที่ไม่เกี่ยวกับส่วนลด
              ดูจำนวนตีคืนของแต่ละสินค้าได้ที่คอลัมน์ขวาสุด
            </div>
          )}

          {/* ขึ้นเฉพาะตอนที่ยอดที่หลุดมีผลจริง — ช่วงแรกมี 272 ใบที่หาสินค้าไม่เจอ แต่ทั้งหมดเป็น
              ออเดอร์คืนเงินเต็มจำนวน ยอดรวม −฿32 ขึ้นเตือนไปก็มีแต่ทำให้คิดว่าข้อมูลหาย */}
          {(() => {
            // เทียบยอดในตารางกับยอดรวมทั้งช่วง — ส่วนต่างคือตะกร้าที่ขายไม่ถึงเกณฑ์
            const shown = allSkuRows.reduce((n, r) => n + Number(r.settlement || 0), 0);
            const hidden = Number(bySku.tot_settlement || 0) - shown;
            if (minQty === 1 || hidden < 1000) return null;
            return (
              <div className="note">
                ไม่ได้แสดงอีก {baht(hidden)} จาก{byProduct ? 'ตะกร้า' : 'สินค้า'}ที่ขายไม่ถึง {minQty} ชิ้นในช่วงนี้
                {' '}<Link href={qs({ min: 1 })}>ดูทั้งหมด</Link>
              </div>
            );
          })()}

          {Math.abs(Number(bySku.unmatched)) >= 500 && (
            <div className="note">
              <b>มียอด {baht(bySku.unmatched)} ที่ไม่รู้ว่าเป็นสินค้าตัวไหน</b> ({Number(bySku.unmatched_n).toLocaleString('en-US')} ออเดอร์)
              {' '}— ไม่มีรายการสินค้าของออเดอร์เหล่านี้ในระบบ (สั่งก่อนระบบเริ่มเก็บ 25 ส.ค. 2569 หรือถูกล้างไปแล้ว)
              จึงไม่ได้นับรวมในตารางนี้
            </div>
          )}

          <table className="orders">
            <thead>
              <tr>
                <th>{byProduct ? 'ตะกร้า' : 'สินค้า'}</th>
                {COLS.map((c) => (
                  <th key={c.key} className="r">
                    <Link
                      prefetch={false}
                      className="sortby"
                      data-on={sort === c.key ? '1' : '0'}
                      href={qs({ sort: c.key, dir: sort === c.key && dir === 'desc' ? 'asc' : 'desc' })}
                    >
                      {c.label}{sort === c.key ? (dir === 'desc' ? ' ▼' : ' ▲') : ''}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skuRows.map((s) => {
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
                          <div className="clamp1" title={s.product_name || ''}>
                            <Link prefetch={false} href={qs({ pick: byProduct ? s.pkey : s.sku })}>
                              {s.product_name || '—'}
                            </Link>
                          </div>
                          {byProduct
                            ? <VariantList variants={s.variants} count={s.variants_n} costs={hasCosts ? costMap : null} />
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
                    <td data-label="เข้าจริง" className="num">
                      <b>{baht(s.settlement)}</b>
                      {p !== null && <div className="sku">เหลือ {p}%</div>}
                    </td>
                    <td data-label="ทุน" className="num">
                      {s._cost !== undefined
                        ? <>
                          {baht(s._cost)}{s._costEst ? '*' : ''}{ofGross(s._cost, s.gross)}
                          {s._costOff && <div className="sku">หักลดนอกบิลแล้ว</div>}
                        </>
                        : <span className="sku">{s._costPartial ? 'ทุนไม่ครบ' : 'ไม่มีทุน'}</span>}
                    </td>
                    <td data-label="กำไร" className="num">
                      {s._profit !== undefined
                        ? <>
                          <b className={s._profit < 0 ? 'danger' : undefined}>{baht(s._profit)}</b>
                          {qty > 0 && <div className="sku">{baht(s._profit / qty)}/ชิ้น</div>}
                        </>
                        : '—'}
                    </td>
                    <td data-label="กำไร %" className="num">
                      {s._margin != null
                        ? <span className={`badge ${profitTone(Math.round(s._margin * 100))}`}>{Math.round(s._margin * 100)}%</span>
                        : '—'}
                    </td>
                    <td data-label="ตีคืน (ไม่นับรวม)" className="num">
                      {Number(s.ret_orders)
                        ? <span className="sku">{s.ret_orders} ใบ<br />{baht(s.ret_settlement)}</span>
                        : '—'}
                    </td>
                  </tr>
                );
              })}
              {!skuRows.length && (
                <tr>
                  <td colSpan={10} style={{ color: 'var(--muted)' }}>
                    {q ? `ไม่เจอสินค้าที่ตรงกับ “${q}”` : 'ยังไม่มีข้อมูลในช่วงนี้'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="note" style={{ marginTop: 12 }}>
            <b>คิดยังไง</b> — ไม่นับออเดอร์ที่ตีคืน · ราคาป้ายกับส่วนลดร้านใช้ตัวเลขจริงของแต่ละชิ้น
            ส่วนค่าคอม ค่าธรรมเนียม ค่าส่ง TikTok ให้มาเป็นยอดรวมต่อออเดอร์
            ออเดอร์ที่มีหลายสินค้า (~6%) จึงปันตามราคาขาย ออเดอร์สินค้าเดียวได้ตัวเลขตรงเต็มจำนวน
            <br /><b>ทุน</b> — ทุนต่อชิ้นจากบิลรับของล่าสุดใน Seniorsoft (หักส่วนลดแล้ว ตามยอดในบิล)
            คูณจำนวนที่ขาย · <b>*</b> = ไม่มีบิลของรหัสนี้ตรงๆ ใช้ทุนของไซส์อื่นในรุ่นเดียวกันแทน
            · กำไร = เข้าจริง − ทุน ยังไม่หักค่าแพ็ค ค่าแรง และยังไม่แยก VAT
            <br /><b>ส่วนลดนอกบิล</b> — SCS (รองเท้านักเรียน) ใช้ทุน = ราคาป้ายในบิล × 70%
            เพราะลดในบิล 20% แล้วมาลดเพิ่มนอกบิลอีกทีหลัง (ตั้งไว้ที่ supabase/021)
          </div>
          {costErr && (
            <div className="note">
              <b>ยังคิดกำไรไม่ได้</b> — รัน <code>supabase/020_costs.sql</code> ใน Supabase ก่อน ({costErr})
            </div>
          )}
          {!costErr && costMap && !hasCosts && (
            <div className="note">ยังไม่มีข้อมูลทุน — รอรอบดึงต้นทุนจากบิลรับของ (วันละครั้ง)</div>
          )}
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
