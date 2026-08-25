import Link from 'next/link';
import { db } from '@/lib/supabase';
import { STATUS, STATUS_ORDER, MINOR_STATUS, RISKY_BEFORE_CANCEL, statusLabel } from '@/lib/status';
import SyncButton from './SyncButton';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

const fmtTime = (s) =>
  s ? new Date(s).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const baht = (n) => '฿' + Math.round(Number(n) || 0).toLocaleString('en-US');

export default async function OrdersPage({ searchParams }) {
  const sp = await searchParams;
  const active = sp?.status || 'to_ship';
  const page = Math.max(1, Number(sp?.page) || 1);

  let orders = [], counts = {}, risky = 0, err = null, matched = 0;
  try {
    const sb = db();
    let q = sb
      .from('os_orders')
      .select('*, os_order_items(sku, product_name, qty)', { count: 'exact' })
      .order('ordered_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (active === 'risky') {
      // ยกเลิกทั้งที่ของถูกหยิบ/แพ็คไปแล้ว — กองที่ต้องรีบตามดึงกลับ
      q = q.eq('status', 'cancelled').in('cancelled_from', RISKY_BEFORE_CANCEL);
    } else if (active !== 'all') {
      q = q.eq('status', active);
    }

    const [{ data, error, count }, all] = await Promise.all([
      q,
      sb.from('os_orders').select('status, cancelled_from'),
    ]);
    if (error) throw new Error(error.message);
    orders = data || [];
    matched = count || 0;
    for (const r of all.data || []) {
      counts[r.status] = (counts[r.status] || 0) + 1;
      if (r.status === 'cancelled' && RISKY_BEFORE_CANCEL.includes(r.cancelled_from)) risky++;
    }
  } catch (e) {
    err = String(e.message || e);
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const tabs = [
    { key: 'all', label: 'ทั้งหมด', n: total },
    ...STATUS_ORDER.map((k) => ({ key: k, label: statusLabel(k), n: counts[k] || 0 })),
    { key: 'risky', label: '⚠️ ยกเลิกหลังหยิบของ', n: risky },
    ...MINOR_STATUS.map((k) => ({ key: k, label: statusLabel(k), n: counts[k] || 0, dim: true })),
  ];

  return (
    <>
      <div className="row">
        <div>
          <h1>ออเดอร์รวมทุกร้าน</h1>
          <div className="sub">TikTok Shop · SOLID — เฟส 1 ดูของจริงก่อน ยังไม่แตะสต็อก</div>
        </div>
        <SyncButton />
      </div>

      {err && (
        <div className="note">
          <b>ยังต่อฐานข้อมูลไม่ได้</b><br />{err}<br /><br />
          ตั้งค่าใน <code>.env.local</code> แล้วรัน <code>supabase/schema.sql</code> + <code>supabase/002_order_events.sql</code> ก่อน
        </div>
      )}

      <div className="tabs">
        {tabs.map((t) => (
          <a key={t.key} className="tab" data-on={t.key === active ? '1' : '0'} data-dim={t.dim ? '1' : '0'} href={`/orders?status=${t.key}&page=1`}>
            {t.label} <b>{t.n}</b>
          </a>
        ))}
      </div>

      {active === 'risky' && (
        <div className="note">
          ลูกค้ายกเลิก<b>หลังจาก</b>ของถูกหยิบหรือแพ็คไปแล้ว — ต้องตามดึงออกจากกองก่อนขนส่งมารับ
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>ออเดอร์</th>
            <th>สินค้า</th>
            <th>สถานะ</th>
            <th>สั่งเมื่อ</th>
            <th style={{ textAlign: 'right' }}>ยอด</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="clickable">
              <td>
                <Link className="mono" href={`/orders/${o.order_id}`}>{o.order_id}</Link>
                <div className="sku">{o.platform} · {o.shop}{o.buyer ? ' · ' + o.buyer : ''}</div>
              </td>
              <td>
                {(o.os_order_items || []).map((it, i) => (
                  <div key={i}>
                    <span className="mono">{it.sku || '(ไม่มี SKU)'}</span> × {it.qty}
                    <div className="sku">{it.product_name}</div>
                  </div>
                ))}
              </td>
              <td>
                <span className={'badge ' + (STATUS[o.status]?.c || 'warn')}>{statusLabel(o.status)}</span>
                {o.status === 'cancelled' && (
                  <div className="sku">
                    {o.cancelled_from ? `ยกเลิกจาก: ${statusLabel(o.cancelled_from)}` : 'เห็นตอนยกเลิกแล้ว (ไม่รู้สถานะก่อนหน้า)'}
                  </div>
                )}
              </td>
              <td className="sku">{fmtTime(o.ordered_at)}</td>
              <td className="num">{baht(o.total)}</td>
            </tr>
          ))}
          {!orders.length && !err && (
            <tr><td colSpan={5} className="sub" style={{ padding: 24, textAlign: 'center' }}>ยังไม่มีออเดอร์ — กด "ดึงออเดอร์ตอนนี้"</td></tr>
          )}
        </tbody>
      </table>

      {matched > PAGE_SIZE && (
        <nav className="pager">
          <a className="btn" data-off={page <= 1 ? '1' : '0'} href={`/orders?status=${active}&page=${page - 1}`}>‹ ก่อนหน้า</a>
          <span className="sub">
            หน้า {page} จาก {Math.ceil(matched / PAGE_SIZE)} · ทั้งหมด {matched.toLocaleString('en-US')} ออเดอร์
          </span>
          <a className="btn" data-off={page * PAGE_SIZE >= matched ? '1' : '0'} href={`/orders?status=${active}&page=${page + 1}`}>ถัดไป ›</a>
        </nav>
      )}
    </>
  );
}
