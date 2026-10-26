// รอบจัดส่ง — แต่ละร้านกดจัดส่งไปกี่ใบ กี่ชิ้น ในแต่ละรอบ
// แทนการ export รีพอร์ตจากทุกร้านมาวางในชีต "tiktok SCS order" ทุกครั้งที่ตัดรอบ
// รอบจับเองจากเวลากดจัดส่ง (ดู lib/rounds.js) ไม่ต้องมีคนกดปุ่มตัดรอบ
import Link from 'next/link';
import { db } from '@/lib/supabase';
import { PLATFORM_LABEL } from '@/lib/shopGroups';
import { thaiDay, dayRange, shiftDay, splitRounds, sumSkus, ROUND_GAP_MIN } from '@/lib/rounds';
import Nav from '../Nav';
import AutoRefresh from '../orders/AutoRefresh';
import CopySkus from './CopySkus';

export const dynamic = 'force-dynamic';

const TH = { timeZone: 'Asia/Bangkok' };
const hhmm = (s) => new Date(s).toLocaleTimeString('th-TH', { ...TH, hour: '2-digit', minute: '2-digit' });
const dayLabel = (d) =>
  new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { ...TH, day: 'numeric', month: 'short' });
const shopName = (r) => `${PLATFORM_LABEL[r.platform] || r.platform} ${r.shop}`;
const pieces = (orders) => orders.reduce((s, o) => s + (o.os_order_items || []).reduce((t, i) => t + (Number(i.qty) || 0), 0), 0);

// ออเดอร์ที่กดส่งในวันนั้นทั้งหมด — วันยุ่งเกิน 1,000 ใบ (เพดานต่อคำขอของ Supabase) จึงต้องขอเป็นหน้าๆ
async function loadDay(day) {
  const { from, to } = dayRange(day);
  const all = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db()
      .from('os_orders')
      .select('order_id, platform, shop, status, buyer, rts_at, cancelled_at, os_order_items(sku, product_name, qty)')
      .gte('rts_at', from)
      .lt('rts_at', to)
      .order('rts_at', { ascending: true })
      .range(i, i + 999);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < 1000) return all;
  }
}

export default async function RoundPage({ searchParams }) {
  const sp = await searchParams;
  const today = thaiDay();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp?.d || '') && sp.d <= today ? sp.d : today;
  const href = (o) => {
    const p = new URLSearchParams();
    const d = o.d ?? day;
    if (d !== today) p.set('d', d);
    if (o.r) p.set('r', o.r);
    const s = p.toString();
    return '/round' + (s ? '?' + s : '');
  };

  let rounds = [], err = null;
  try {
    rounds = splitRounds(await loadDay(day));
  } catch (e) {
    err = String(e.message || e);
  }
  // ไม่ได้เลือก = รอบที่เริ่มล่าสุด (ตอนกำลังแพ็คคือรอบที่กำลังกดอยู่)
  const cur = rounds.find((r) => r.key === sp?.r) || rounds[rounds.length - 1];
  const live = (r) => day === today && Date.now() - Date.parse(r.to) < ROUND_GAP_MIN * 60000;
  const skus = cur ? sumSkus(cur.orders) : [];

  return (
    <>
      <Nav active="round" />
      <div className="row">
        <div>
          <h1>รอบจัดส่ง</h1>
          <div className="sub">
            จับรอบจากเวลากดจัดส่งของแต่ละร้าน — กดห่างกันเกิน {ROUND_GAP_MIN} นาทีนับเป็นรอบใหม่ · Shopee MVP ยังไม่มีข้อมูลออเดอร์
          </div>
        </div>
        <AutoRefresh />
      </div>

      <div className="rday">
        <Link className="btn" href={href({ d: shiftDay(day, -1) })}>◀ {dayLabel(shiftDay(day, -1))}</Link>
        <b>{day === today ? 'วันนี้ · ' : ''}{dayLabel(day)}</b>
        {day < today && <Link className="btn" href={href({ d: shiftDay(day, 1) })}>{dayLabel(shiftDay(day, 1))} ▶</Link>}
        {day < today && <Link className="btn" href={href({ d: today })}>วันนี้</Link>}
      </div>

      {err && <div className="note note-danger">โหลดออเดอร์ไม่สำเร็จ: {err}</div>}
      {!err && !rounds.length && <div className="note">ยังไม่มีออเดอร์ที่กดจัดส่งใน{day === today ? 'วันนี้' : 'วันนั้น'}</div>}

      {rounds.length > 0 && (
        <div className="tabs rtabs">
          {rounds.map((r) => (
            <Link
              key={r.key} prefetch={false} className="tab rtab" data-plat={r.platform}
              data-on={r.key === cur.key ? '1' : '0'} aria-current={r.key === cur.key ? 'page' : undefined}
              href={href({ r: r.key })}
            >
              <span className="rdot" />{shopName(r)} รอบ {r.n} <small>{hhmm(r.from)}</small> <b>{r.orders.length}</b>
              {live(r) && <span className="rlive">กำลังกด</span>}
            </Link>
          ))}
        </div>
      )}

      {cur && (
        <div className="rcard">
          <div className="rhead">
            <div>
              <h2>{shopName(cur)} · รอบ {cur.n}</h2>
              <div className="sub" style={{ margin: 0 }}>
                กดส่ง {hhmm(cur.from)}–{hhmm(cur.to)} น.{live(cur) ? ' (ยังกดอยู่)' : ''}
              </div>
            </div>
            <div className="rbig"><b>{cur.orders.length}</b> ใบ · <b>{pieces(cur.orders)}</b> ชิ้น</div>
          </div>

          <table>
            <thead><tr><th>SKU</th><th>ชื่อสินค้า</th><th className="num">ชิ้น</th></tr></thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s.sku || 'name:' + s.name}>
                  <td className="sku">{s.sku || <span className="stale">ไม่มี SKU</span>}</td>
                  <td>{s.name}</td>
                  <td className="num">{s.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {cur.cancelled.length > 0 && (
            <details className="note note-danger" style={{ marginTop: 14 }}>
              <summary><b>ยกเลิกหลังกดส่ง {cur.cancelled.length} ใบ — ไม่นับรวม ต้องดึงของกลับ</b></summary>
              {cur.cancelled.map((o) => (
                <div key={o.order_id}>
                  <Link href={`/orders?status=all&q=${encodeURIComponent(o.order_id)}`}>#{o.order_id}</Link>
                  {' · '}{(o.os_order_items || []).map((i) => `${i.sku || i.product_name} × ${i.qty}`).join(', ')}
                  {o.cancelled_at && ` · ยกเลิก ${hhmm(o.cancelled_at)} น.`}
                </div>
              ))}
            </details>
          )}

          <div className="rbtns">
            <CopySkus rows={skus} />
          </div>

          <details style={{ marginTop: 10 }}>
            <summary>ดูรายออเดอร์ ({cur.orders.length} ใบ)</summary>
            <table style={{ marginTop: 8 }}>
              <thead><tr><th>ออเดอร์</th><th>กดส่ง</th><th>สินค้า</th></tr></thead>
              <tbody>
                {cur.orders.map((o) => (
                  <tr key={o.order_id}>
                    <td><Link href={`/orders?status=all&q=${encodeURIComponent(o.order_id)}`}>#{o.order_id}</Link></td>
                    <td className="sku">{hhmm(o.rts_at)}</td>
                    <td>{(o.os_order_items || []).map((i) => `${i.sku || i.product_name} × ${i.qty}`).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </>
  );
}
