import Link from 'next/link';
import { db } from '@/lib/supabase';
import { STATUS, STATUS_ORDER, MINOR_STATUS, isRiskyCancel, statusLabel } from '@/lib/status';
import SyncButton from './SyncButton';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

// เซิร์ฟเวอร์ที่ Netlify เป็นเวลา UTC — ต้องบังคับโซนไทย ไม่งั้นเวลาเพี้ยนไป 7 ชั่วโมง
const TH = { timeZone: 'Asia/Bangkok' };
const fmtTime = (s) =>
  s ? new Date(s).toLocaleString('th-TH', { ...TH, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// "3 นาทีที่แล้ว" — บอกความสดของข้อมูลได้เร็วกว่าเวลาเป๊ะๆ
function ago(t) {
  const sec = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  if (sec < 90) return 'เมื่อครู่';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;
  return `${Math.round(hr / 24)} วันที่แล้ว`;
}
const baht = (n) => '฿' + Math.round(Number(n) || 0).toLocaleString('en-US');

export default async function OrdersPage({ searchParams }) {
  const sp = await searchParams;
  const active = sp?.status || 'to_ship';
  const page = Math.max(1, Number(sp?.page) || 1);

  let orders = [], counts = {}, risky = 0, err = null, matched = 0, lastSync = null;
  try {
    const sb = db();
    let q = sb
      .from('os_orders')
      .select('*, os_order_items(sku, product_name, qty, image_url)', { count: 'exact' })
      .order('ordered_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (active === 'risky') {
      // ยกเลิกทั้งที่ของถูกหยิบ/แพ็คไปแล้ว — กองที่ต้องรีบตามดึงกลับ
      // rts_at (เวลาที่ร้านกดจัดส่ง) มาจากแพลตฟอร์มโดยตรง จึงจับได้แม้ออเดอร์นั้นเราเพิ่งมาเห็นตอนยกเลิกแล้ว
      q = q.eq('status', 'cancelled').or('rts_at.not.is.null,cancelled_from.in.(packed,to_ship)');
    } else if (active !== 'all') {
      q = q.eq('status', active);
    }

    const [{ data, error, count }, all, log] = await Promise.all([
      q,
      sb.from('os_orders').select('status, cancelled_from, rts_at'),
      sb.from('os_sync_log').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    lastSync = log?.data || null;
    if (error) throw new Error(error.message);
    orders = data || [];
    matched = count || 0;
    for (const r of all.data || []) {
      counts[r.status] = (counts[r.status] || 0) + 1;
      if (isRiskyCancel(r)) risky++;
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
          <div className="sub">
            TikTok Shop · SOLID
            {lastSync ? (
              <>
                {' · '}
                <span className={lastSync.ok === false ? 'stale' : undefined}>
                  ดึงล่าสุด {fmtTime(lastSync.finished_at || lastSync.started_at)} น.
                  {' ('}{ago(lastSync.finished_at || lastSync.started_at)}{')'}
                  {lastSync.ok === false ? ' — รอบล่าสุดพลาด' : ''}
                </span>
              </>
            ) : ' · ยังไม่เคยดึง'}
          </div>
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
                  <div key={i} className="line">
                    {it.image_url
                      ? <img className="thumb sm" src={it.image_url} alt="" loading="lazy" />
                      : <div className="thumb sm thumb-empty" />}
                    <div>
                      <span className="mono">{it.sku || '(ไม่มี SKU)'}</span> × {it.qty}
                      <div className="sku clamp1" title={it.product_name}>{it.product_name}</div>
                    </div>
                  </div>
                ))}
              </td>
              <td>
                <span className={'badge ' + (STATUS[o.status]?.c || 'warn')}>{statusLabel(o.status)}</span>
                {o.status === 'cancelled' && (
                  <div className="sku">
                    {o.cancelled_at && <div>ยกเลิก {fmtTime(o.cancelled_at)} น.</div>}
                    {o.cancel_reason && <div>{o.cancel_reason}</div>}
                    <div>
                      {o.cancelled_from ? `จาก: ${statusLabel(o.cancelled_from)}` : 'ไม่รู้สถานะก่อนหน้า'}
                      {o.rts_at ? ' · กดจัดส่งไปแล้ว' : ''}
                    </div>
                  </div>
                )}
                {o.status !== 'cancelled' && o.rts_at && (
                  <div className="sku">กดจัดส่ง {fmtTime(o.rts_at)} น.</div>
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
