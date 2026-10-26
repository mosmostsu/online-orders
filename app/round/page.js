// รอบจัดส่ง — แต่ละร้านกดจัดส่งไปกี่ใบ กี่ชิ้น ในแต่ละรอบ
// แทนการ export รีพอร์ตจากทุกร้านมาวางในชีต "tiktok SCS order" ทุกครั้งที่ตัดรอบ
// รอบจับเองจากเวลากดจัดส่ง (ดู lib/rounds.js) ไม่ต้องมีคนกดปุ่มตัดรอบ
import Link from 'next/link';
import { cookies } from 'next/headers';
import { db } from '@/lib/supabase';
import { PLATFORM_LABEL } from '@/lib/shopGroups';
import { thaiDay, dayRange, shiftDay, splitRounds, sumSkus, pivotSizes, normSku, ROUND_GAP_MIN } from '@/lib/rounds';
import Nav from '../Nav';
import AutoRefresh from '../orders/AutoRefresh';
import CopySkus from './CopySkus';
import ViewToggle from './ViewToggle';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

const ROUND_VIEW_COOKIE = 'round_view';   // 'rows' = แถวแบบแท็บ final · 'grid' = ตารางไซส์แบบแท็บ SCS ST23

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
      .select('order_id, platform, shop, status, buyer, rts_at, cancelled_at, os_order_items(sku, product_name, variant, qty)')
      .gte('rts_at', from)
      .lt('rts_at', to)
      .order('rts_at', { ascending: true })
      .range(i, i + 999);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < 1000) return all;
  }
}

// ชื่อ/หมวดใน ST ของ SKU ที่อยู่ในรอบ — ไซส์ยึดตาม ST (ดู lib/rounds.js)
// os_st เก็บตามตัวพิมพ์ของ Seniorsoft แต่แพลตฟอร์มอาจพิมพ์ต่าง จึงถามทั้งแบบเดิม/เล็ก/ใหญ่
// ถามไม่ได้ก็ไม่เป็นไร ตารางยังออก แค่ไซส์มาจากแพลตฟอร์มแทน
async function loadSt(skus) {
  const ask = [...new Set(skus.filter(Boolean).flatMap((s) => [s, s.toLowerCase(), s.toUpperCase()]))];
  const st = new Map();
  for (let i = 0; i < ask.length; i += 150) {
    const { data, error } = await db().from('os_st').select('sku, name, cat').in('sku', ask.slice(i, i + 150));
    if (error) return st;
    for (const r of data || []) st.set(normSku(r.sku), r);
  }
  return st;
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
  const st = cur ? await loadSt(cur.orders.flatMap((o) => (o.os_order_items || []).map((i) => i.sku))) : new Map();
  const skus = cur ? sumSkus(cur.orders, st) : [];
  const missing = skus.filter((s) => s.sku && !s.inSt).length;
  const view = (await cookies()).get(ROUND_VIEW_COOKIE)?.value === 'grid' ? 'grid' : 'rows';
  const grid = view === 'grid' ? pivotSizes(skus) : null;

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
                {dayLabel(day)} · กดส่ง {hhmm(cur.from)}–{hhmm(cur.to)} น.{live(cur) ? ' (ยังกดอยู่)' : ''}
              </div>
            </div>
            <div className="rbig"><b>{cur.orders.length}</b> ใบ · <b>{pieces(cur.orders)}</b> ชิ้น</div>
          </div>

          {missing > 0 && (
            <div className="note" style={{ fontSize: 12.5 }}>
              SKU {missing} ตัวไม่พบใน ST ของ Seniorsoft (รหัสบนแพลตฟอร์มไม่ตรง) — ไซส์ของตัวนั้นเดาจากตัวเลือกบนแพลตฟอร์ม
            </div>
          )}

          <div className="rbtns rtools">
            <ViewToggle view={view} cookie={ROUND_VIEW_COOKIE} />
            <PrintButton />
          </div>

          {grid ? (
            grid.map((t) => (
              <div key={t.key} className="rgrid-block">
                <div className="rgrid-title">{t.title} <span>· {t.rows.reduce((n, g) => n + g.total, 0)} ชิ้น</span></div>
                <div className="rgrid-wrap">
                  <table className="rgrid">
                    <thead>
                      <tr>
                        <th className="rg-code">รหัส</th>
                        <th className="rg-name">สินค้า</th>
                        <th className="rg-color">สี</th>
                        {t.sizes.map((z) => <th key={z.key} className="rg-z">{z.label}</th>)}
                        <th className="rg-sum">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.rows.map((g) => (
                        <tr key={g.name + '|' + g.color}>
                          <td className="rg-code">
                            {g.codes.slice(0, 3).join(' / ')}{g.codes.length > 3 ? ' …' : ''}
                            {g.notInSt && <span className="rg-miss" title="มี SKU ที่ไม่พบใน ST — ไซส์เดาจากแพลตฟอร์ม">!</span>}
                          </td>
                          <td className="rg-name" title={g.basket}>{g.name || <span className="stale">ไม่มีชื่อ</span>}</td>
                          <td className="rg-color">{g.color}</td>
                          {t.sizes.map((z) => <td key={z.key} className="rg-z">{g.cells[z.key] || ''}</td>)}
                          <td className="rg-sum">{g.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          ) : (
          <table>
            <thead><tr><th>SKU</th><th className="rname">ชื่อสินค้า</th><th>ตัวเลือก</th><th>ไซส์</th><th className="num">จำนวน</th></tr></thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s.sku || `name:${s.name}|${s.color}|${s.size}`}>
                  <td>
                    {s.sku ? <span className="rsku">{s.sku}</span> : <span className="stale">ไม่มี SKU</span>}
                    {s.sku && !s.inSt && <div className="stale" style={{ fontSize: 11 }}>ไม่พบใน ST</div>}
                    <div className="rname-m">{s.name}</div>
                  </td>
                  <td className="rname">{s.name}</td>
                  <td>{s.color}</td>
                  <td>{s.size}</td>
                  <td className="num">{s.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}

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

          <div className="rbtns rcopy">
            <CopySkus rows={skus} />
          </div>

          <details className="rorders" style={{ marginTop: 10 }}>
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
