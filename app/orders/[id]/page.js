import Link from 'next/link';
import { db } from '@/lib/supabase';
import { STATUS, statusLabel, cancelByLabel, isRiskyCancel } from '@/lib/status';
import { shortCarrier, cleanBuyer } from '@/lib/shipping';
import PullForm from '../PullForm';

export const dynamic = 'force-dynamic';

// บังคับโซนไทย — เซิร์ฟเวอร์เป็น UTC
const fmt = (s) =>
  s ? new Date(s).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const baht = (n) => '฿' + Math.round(Number(n) || 0).toLocaleString('en-US');

export default async function OrderDetail({ params }) {
  const { id } = await params;
  const sb = db();

  const { data: o } = await sb
    .from('os_orders')
    .select('*, os_order_items(*)')
    .eq('order_id', id)
    .maybeSingle();

  if (!o) {
    return (
      <>
        <Link className="sub" href="/orders">← กลับหน้ารวม</Link>
        <h1>ไม่พบออเดอร์ {id}</h1>
      </>
    );
  }

  const { data: events } = await sb
    .from('os_order_events')
    .select('*')
    .eq('order_ref', o.id)
    .order('at', { ascending: false });

  // สแกนใบปะหน้าแล้วเด้งมาหน้านี้ ต้องกดยืนยันได้ตรงนี้เลย ไม่ต้องย้อนกลับไปหน้ารวม
  const risky = isRiskyCancel(o);
  let photoUrl = null;
  if (risky && o.pull_photo) {
    const { data: signed } = await sb.storage.from('proofs').createSignedUrl(o.pull_photo, 3600);
    photoUrl = signed?.signedUrl || null;
  }

  const raw = o.raw || {};
  const addr = raw.recipient_address || {};
  const pkgs = raw.packages || [];

  return (
    <>
      <Link className="sub" href="/orders">← กลับหน้ารวม</Link>

      <div className="row" style={{ marginTop: 8 }}>
        <div>
          <h1 className="mono" style={{ fontSize: 18 }}>{o.order_id}</h1>
          <div className="sub">{o.platform} · {o.shop} · สั่งเมื่อ {fmt(o.ordered_at)}</div>
        </div>
        <span className={'badge ' + (STATUS[o.status]?.c || 'warn')} style={{ fontSize: 13, padding: '5px 12px' }}>
          {statusLabel(o.status)}
        </span>
      </div>

      {risky && (
        <section className="card pullcard">
          <h2 className="danger">⚠️ ยกเลิกก่อนขนส่งเข้ารับ — ของยังอยู่ในกอง</h2>
          <div className="sub" style={{ marginBottom: 10 }}>
            ยกเลิก {fmt(o.cancelled_at)}
            {o.cancel_by ? ` (${cancelByLabel(o.cancel_by)})` : ''}
            {' · '}ต้องไปเอาออกจากกองก่อนรถขนส่งมารับ
          </div>
          <PullForm
            orderId={o.order_id}
            pulled={{ at: o.pulled_at, by: o.pulled_by, note: o.pull_note, photoUrl }}
          />
        </section>
      )}

      <div className="cards">
        <section className="card">
          <h2>สินค้า ({o.item_count} ชิ้น)</h2>
          <table>
            <tbody>
              {(o.os_order_items || []).map((it) => (
                <tr key={it.id}>
                  <td style={{ width: 56 }}>
                    {it.image_url
                      ? <img className="thumb" src={it.image_url} alt="" loading="lazy" />
                      : <div className="thumb thumb-empty" />}
                  </td>
                  <td>
                    <div className="mono">{it.sku || '(ไม่มี SKU)'}</div>
                    <div className="sku clamp2" title={it.product_name}>{it.product_name}</div>
                    {it.variant && <div className="sku">{it.variant}</div>}
                  </td>
                  <td className="num" style={{ width: 60 }}>× {it.qty}</td>
                  <td className="num" style={{ width: 90 }}>{baht(it.price)}</td>
                </tr>
              ))}
              <tr>
                <td />
                <td><b>รวม</b></td>
                <td className="num"><b>{o.item_count}</b></td>
                <td className="num"><b>{baht(o.total)}</b></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>ผู้รับ</h2>
          <dl>
            <dt>ชื่อ</dt><dd>{addr.name || cleanBuyer(o.buyer) || '—'}</dd>
            <dt>โทร</dt><dd className="mono">{addr.phone_number || '—'}</dd>
            <dt>ที่อยู่</dt><dd>{addr.full_address || '—'}</dd>
            <dt>ขนส่ง</dt><dd>{shortCarrier(o.carrier) || raw.delivery_option_name || '—'}</dd>
            <dt>เลขพัสดุ</dt>
            <dd className="mono">{o.tracking_no || pkgs.map((p) => p.id).join(', ') || '—'}</dd>
          </dl>
        </section>

        <section className="card">
          <h2>เวลาสำคัญ</h2>
          <dl>
            <dt>สั่งซื้อ</dt><dd>{fmt(o.ordered_at)}</dd>
            <dt>จ่ายเงิน</dt><dd>{fmt(o.paid_at)}</dd>
            <dt>กดจัดส่ง</dt><dd>{fmt(o.rts_at)}</dd>
            <dt>ขนส่งรับของ</dt><dd>{fmt(o.collected_at)}</dd>
            {o.status === 'cancelled' && (
              <>
                <dt className="danger">ยกเลิก</dt>
                <dd className="danger">
                  {fmt(o.cancelled_at)}
                  {o.cancel_reason ? ` — ${o.cancel_reason}` : ''}
                  {o.cancel_by ? ` (${cancelByLabel(o.cancel_by)})` : ''}
                  {o.rts_at && <div className="danger"><b>ยกเลิกหลังกดจัดส่งแล้ว — ต้องตามดึงของกลับ</b></div>}
                </dd>
              </>
            )}
          </dl>
        </section>

        <section className="card">
          <h2>ไทม์ไลน์สถานะ</h2>
          {!events?.length && <div className="sub">ยังไม่มีบันทึก</div>}
          <ul className="timeline">
            {(events || []).map((e) => (
              <li key={e.id}>
                <span className={'badge ' + (STATUS[e.to_status]?.c || 'warn')}>{statusLabel(e.to_status)}</span>
                <span className="sub">
                  {e.from_status ? `จาก ${statusLabel(e.from_status)} · ` : 'เห็นครั้งแรก · '}
                  {fmt(e.at)}
                </span>
              </li>
            ))}
          </ul>
          <div className="sub" style={{ marginTop: 10 }}>
            เห็นครั้งแรก {fmt(o.first_seen_at)} · ดึงล่าสุด {fmt(o.synced_at)}
          </div>
        </section>

        <section className="card">
          <h2>ข้อมูลดิบจากแพลตฟอร์ม</h2>
          <details>
            <summary className="sub">กดเพื่อดู JSON ทั้งก้อน</summary>
            <pre className="raw">{JSON.stringify(raw, null, 2)}</pre>
          </details>
        </section>
      </div>
    </>
  );
}
