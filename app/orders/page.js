import Link from 'next/link';
import { db } from '@/lib/supabase';
import { STATUS, STATUS_ORDER, MINOR_STATUS, statusLabel, cancelByLabel } from '@/lib/status';
import SyncButton from './SyncButton';
import PullForm from './PullForm';
import NoteForm from './NoteForm';
import AutoRefresh from './AutoRefresh';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

// เซิร์ฟเวอร์ที่ Netlify เป็นเวลา UTC — ต้องบังคับโซนไทย ไม่งั้นเวลาเพี้ยนไป 7 ชั่วโมง
const TH = { timeZone: 'Asia/Bangkok' };
const fmtTime = (s) =>
  s ? new Date(s).toLocaleString('th-TH', { ...TH, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// "3 นาทีที่แล้ว" — บอกความสดของข้อมูลได้เร็วกว่าเวลาเป๊ะๆ
function ago(t) {
  const sec = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  if (sec < 10) return 'เมื่อกี้';
  if (sec < 90) return `${Math.round(sec)} วินาทีที่แล้ว`;
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

  let orders = [], counts = {}, risky = 0, returning = 0, total = 0;
  let err = null, matched = 0, lastSync = null, lastChange = null, photos = {};
  try {
    const sb = db();
    let q = sb
      .from('os_orders')
      .select('*, os_order_items(sku, product_name, qty, image_url)', { count: 'exact' })
      .order('ordered_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (active === 'risky') {
      // ยกเลิกแล้วแต่ขนส่งยังไม่มารับ = ของยังอยู่ในกองที่ร้าน ต้องรีบไปหยิบออก
      q = q.eq('status', 'cancelled').is('collected_at', null)
           .or('rts_at.not.is.null,cancelled_from.eq.packed');
    } else if (active === 'returning') {
      // ขนส่งรับไปแล้วค่อยยกเลิก = ของกำลังเดินทางกลับ ต้องคอยรับเข้าสต็อก
      q = q.eq('status', 'cancelled').not('collected_at', 'is', null);
    } else if (active !== 'all') {
      q = q.eq('status', active);
    }

    // ให้ฐานข้อมูลนับมาให้ ห้ามดึงทุกแถวมานับเอง — Supabase คืนสูงสุด 1000 แถว
    // เคยทำแบบนั้นแล้วพอออเดอร์เกินพัน ตัวเลขบนแถบเพี้ยนทั้งแถว
    const countOf = (build) => build(sb.from('os_orders').select('id', { count: 'exact', head: true }));
    const riskyFilter = (qq) => qq.eq('status', 'cancelled').is('collected_at', null)
      .or('rts_at.not.is.null,cancelled_from.eq.packed');
    const returningFilter = (qq) => qq.eq('status', 'cancelled').not('collected_at', 'is', null);
    const statusKeys = [...STATUS_ORDER, ...MINOR_STATUS];

    const [{ data, error, count }, log, change, totalRes, riskyRes, returningRes, ...statusRes] = await Promise.all([
      q,
      sb.from('os_sync_log').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle(),
      // ข้อมูลขยับจริงล่าสุดเมื่อไหร่ — นับรวมทั้งที่มาจาก webhook และรอบ cron
      sb.from('os_orders').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle(),
      countOf((qq) => qq),
      countOf(riskyFilter),
      countOf(returningFilter),
      ...statusKeys.map((k) => countOf((qq) => qq.eq('status', k))),
    ]);
    if (error) throw new Error(error.message);

    orders = data || [];
    matched = count || 0;
    total = totalRes.count || 0;
    risky = riskyRes.count || 0;
    returning = returningRes.count || 0;
    statusKeys.forEach((k, i) => { counts[k] = statusRes[i]?.count || 0; });
    lastSync = log?.data || null;
    lastChange = change?.data?.synced_at || null;

    const withPhoto = orders.filter((o) => o.pull_photo);
    if (withPhoto.length) {
      const { data: signed } = await sb.storage
        .from('proofs')
        .createSignedUrls(withPhoto.map((o) => o.pull_photo), 3600);
      for (const g of signed || []) if (g.path && g.signedUrl) photos[g.path] = g.signedUrl;
    }
  } catch (e) {
    err = String(e.message || e);
  }

  // เส้นทางปกติของออเดอร์ — คั่นด้วยลูกศรให้เห็นว่าไหลจากซ้ายไปขวา
  const flow = STATUS_ORDER.filter((k) => k !== 'cancelled')
    .map((k) => ({ key: k, label: statusLabel(k), n: counts[k] || 0 }));
  // สิ่งที่หลุดออกจากเส้นทาง — แยกกลุ่มไว้ต่างหาก
  const off = [
    { key: 'cancelled', label: statusLabel('cancelled'), n: counts.cancelled || 0 },
    { key: 'risky', label: '⚠️ ยกเลิกก่อนขนส่งเข้ารับ', n: risky, alert: true },
    { key: 'returning', label: '📦 ส่งแล้วตีคืน', n: returning },
    ...MINOR_STATUS.map((k) => ({ key: k, label: statusLabel(k), n: counts[k] || 0, dim: true })),
  ];

  return (
    <>
      <div className="row">
        <div>
          <h1>ออเดอร์รวมทุกร้าน</h1>
          <div className="sub">
            TikTok Shop · SOLID
            {lastChange && (
              <> · <b>อัปเดตล่าสุด {fmtTime(lastChange)} น.</b> ({ago(lastChange)})</>
            )}
            {(() => {
              // cron เป็นแค่ตาข่ายกันเหนียว — ถ้ามันเงียบไปนานหรือรอบล่าสุดพัง ต้องรู้
              if (!lastSync) return ' · ยังไม่เคยตรวจซ้ำ';
              const t = lastSync.finished_at || lastSync.started_at;
              const late = Date.now() - new Date(t).getTime() > 15 * 60000;
              return (
                <span className={lastSync.ok === false || late ? 'stale' : undefined}>
                  {' · ตรวจซ้ำ '}{ago(t)}
                  {lastSync.ok === false ? ' (รอบล่าสุดพลาด)' : late ? ' (นานผิดปกติ)' : ''}
                </span>
              );
            })()}
          </div>
        </div>
        <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <AutoRefresh />
          <SyncButton />
        </span>
      </div>

      {err && (
        <div className="note">
          <b>ยังต่อฐานข้อมูลไม่ได้</b><br />{err}<br /><br />
          ตั้งค่าใน <code>.env.local</code> แล้วรัน <code>supabase/schema.sql</code> + <code>supabase/002_order_events.sql</code> ก่อน
        </div>
      )}

      <div className="tabs">
        <a className="tab" data-on={active === 'all' ? '1' : '0'} href="/orders?status=all&page=1">
          ทั้งหมด <b>{total}</b>
        </a>

        <span className="divider" />

        {flow.map((t, i) => (
          <span key={t.key} className="step">
            {i > 0 && <span className="arrow">›</span>}
            <a className="tab" data-on={t.key === active ? '1' : '0'} href={`/orders?status=${t.key}&page=1`}>
              {t.label} <b>{t.n}</b>
            </a>
          </span>
        ))}

        <span className="divider" />

        {off.map((t) => (
          <a
            key={t.key}
            className="tab"
            data-on={t.key === active ? '1' : '0'}
            data-dim={t.dim ? '1' : '0'}
            data-alert={t.alert ? '1' : '0'}
            href={`/orders?status=${t.key}&page=1`}
          >
            {t.label} <b>{t.n}</b>
          </a>
        ))}
      </div>

      {active === 'risky' && (
        <div className="note note-danger">
          ยกเลิก<b>หลังร้านกดส่ง</b>แต่ขนส่งยังไม่มารับ — ของถูกหยิบมาแพ็คแล้ว ต้องไปเอาออกจากกองก่อนรถมา
          {' · '}<b>ยังไม่จัดการ {orders.filter((o) => !o.pulled_at).length} ใบ</b>
        </div>
      )}
      {active === 'packed' && (
        <div className="note">
          แพ็คเสร็จรอขนส่งมารับ — ใบที่ค้างนานมักเป็น <b>ของหมด</b> (ยังหาของไม่ได้)
          หรือ <b>ขนส่งลืมยิง</b> (ของออกไปแล้วแต่สถานะไม่ขยับ) กดใส่คอมเมนต์ไว้ให้กะถัดไปรู้เรื่องด้วย
        </div>
      )}
      {active === 'returning' && (
        <div className="note">
          ขนส่งรับของไปแล้วค่อยยกเลิก — ของกำลังเดินทางกลับร้าน ไม่ต้องไปหาในกอง
          แต่ต้องคอยรับของคืนแล้วเอาเข้าสต็อก
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>ออเดอร์</th>
            <th>สินค้า</th>
            <th style={{ width: 250 }}>สถานะ</th>
            <th>สั่งเมื่อ</th>
            <th style={{ textAlign: 'right' }}>ยอด</th>
            {(active === 'risky' || active === 'packed') && <th style={{ width: 220 }}>จัดการ</th>}
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
                    <div className="by">
                      {cancelByLabel(o.cancel_by)}{o.cancel_reason ? ` — ${o.cancel_reason}` : ''}
                    </div>
                    <table className="mini">
                      <tbody>
                        <tr><td>สั่งซื้อ</td><td>{fmtTime(o.ordered_at)}</td></tr>
                        <tr><td>กดส่ง</td><td>{o.rts_at ? fmtTime(o.rts_at) : '—'}</td></tr>
                        <tr><td>ขนส่งรับ</td><td>{o.collected_at ? fmtTime(o.collected_at) : '— ยังไม่มารับ'}</td></tr>
                        <tr className="hl"><td>ยกเลิก</td><td>{fmtTime(o.cancelled_at)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {o.status !== 'cancelled' && (o.rts_at || o.collected_at) && (
                  <table className="mini">
                    <tbody>
                      {o.rts_at && <tr><td>กดส่ง</td><td>{fmtTime(o.rts_at)}</td></tr>}
                      {o.collected_at && <tr><td>ขนส่งรับ</td><td>{fmtTime(o.collected_at)}</td></tr>}
                    </tbody>
                  </table>
                )}
              </td>
              <td className="sku">{fmtTime(o.ordered_at)}</td>
              <td className="num">{baht(o.total)}</td>
              {active === 'risky' && (
                <td style={{ minWidth: 210 }}>
                  <PullForm
                    orderId={o.order_id}
                    pulled={o.pulled_at ? {
                      at: o.pulled_at, by: o.pulled_by, note: o.pull_note,
                      photoUrl: o.pull_photo ? photos[o.pull_photo] : null,
                    } : null}
                  />
                </td>
              )}
              {active === 'packed' && (
                <td style={{ minWidth: 200 }}>
                  <NoteForm orderId={o.order_id} note={o.note} noteBy={o.note_by} noteAt={o.note_at} />
                </td>
              )}
            </tr>
          ))}
          {!orders.length && !err && (
            <tr><td colSpan={active === 'risky' || active === 'packed' ? 6 : 5} className="sub" style={{ padding: 24, textAlign: 'center' }}>ยังไม่มีออเดอร์ — กด "ดึงออเดอร์ตอนนี้"</td></tr>
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
