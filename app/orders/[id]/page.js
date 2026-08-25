import Link from 'next/link';
import { db } from '@/lib/supabase';
import { STATUS, statusLabel } from '@/lib/status';

export const dynamic = 'force-dynamic';

const fmt = (s) =>
  s ? new Date(s).toLocaleString('th-TH', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
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

      <div className="cards">
        <section className="card">
          <h2>สินค้า ({o.item_count} ชิ้น)</h2>
          <table>
            <tbody>
              {(o.os_order_items || []).map((it) => (
                <tr key={it.id}>
                  <td>
                    <div className="mono">{it.sku || '(ไม่มี SKU)'}</div>
                    <div className="sku">{it.product_name}</div>
                  </td>
                  <td className="num" style={{ width: 60 }}>× {it.qty}</td>
                  <td className="num" style={{ width: 90 }}>{baht(it.price)}</td>
                </tr>
              ))}
              <tr>
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
            <dt>ชื่อ</dt><dd>{addr.name || o.buyer || '—'}</dd>
            <dt>โทร</dt><dd className="mono">{addr.phone_number || '—'}</dd>
            <dt>ที่อยู่</dt><dd>{addr.full_address || '—'}</dd>
            <dt>ขนส่ง</dt><dd>{raw.shipping_provider || raw.delivery_option_name || '—'}</dd>
            <dt>เลขพัสดุ</dt>
            <dd className="mono">{pkgs.map((p) => p.id).join(', ') || raw.tracking_number || '—'}</dd>
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
