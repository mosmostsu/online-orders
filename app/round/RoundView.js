'use client';
// แท็บรอบ/ร้าน + ใบจัดของ — สลับในเบราว์เซอร์ทั้งหมด (ข้อมูลทั้งวันโหลดมาจาก page.js แล้ว) กดแล้วขึ้นทันที
// รอบ/ร้านที่เลือกเขียนกลับลง URL (?r= &s=) ให้กดรีเฟรชหรือส่งลิงก์ต่อแล้วได้หน้าเดิม
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PLATFORM_LABEL } from '@/lib/shopGroups';
import { sumSkus, pivotSizes } from '@/lib/rounds';
import CopySkus from './CopySkus';
import ViewToggle from './ViewToggle';
import PrintButton from './PrintButton';

const TH = { timeZone: 'Asia/Bangkok' };
const hhmm = (s) => new Date(s).toLocaleTimeString('th-TH', { ...TH, hour: '2-digit', minute: '2-digit' });
const shopName = (r) => `${PLATFORM_LABEL[r.platform] || r.platform} ${r.shop}`;
const pieces = (orders) => orders.reduce((s, o) => s + (o.os_order_items || []).reduce((t, i) => t + (Number(i.qty) || 0), 0), 0);
const itemsText = (o) => (o.os_order_items || []).map((i) => `${i.sku || i.product_name} × ${i.qty}`).join(', ');

export default function RoundView({ rounds, st, dayText, initialRound, initialShop, initialView, viewCookie }) {
  // ไม่ได้เลือก = รอบล่าสุด (ตอนกำลังแพ็คคือรอบที่กำลังกดอยู่) · ร้านแรกในรอบ (เริ่มกดส่งก่อน)
  const [pick, setPick] = useState({ r: initialRound, s: initialShop });
  const [view, setView] = useState(initialView);
  const round = rounds.find((r) => String(r.n) === String(pick.r)) || rounds[rounds.length - 1];
  const cur = round.shops.find((x) => x.key === pick.s) || round.shops[0];

  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set('r', round.n);
    u.searchParams.set('s', cur.key);
    window.history.replaceState(window.history.state, '', u);
  }, [round.n, cur.key]);

  const stMap = useMemo(() => new Map(Object.entries(st)), [st]);
  const skus = useMemo(() => sumSkus(cur.orders, stMap), [cur, stMap]);
  const grid = useMemo(() => (view === 'grid' ? pivotSizes(skus) : null), [view, skus]);
  const missing = skus.filter((s) => s.sku && !s.inSt).length;

  return (
    <>
      <div className="tabs rnums">
        {rounds.map((r) => (
          <button
            key={r.n} className="tab" data-on={r.n === round.n ? '1' : '0'} aria-current={r.n === round.n ? 'page' : undefined}
            onClick={() => setPick({ r: r.n })}
          >
            รอบ {r.n} <small>{hhmm(r.from)}–{hhmm(r.to)}</small> <b>{r.shops.reduce((n, x) => n + x.orders.length, 0)}</b>
            {r.live && <span className="rlive">กำลังกด</span>}
          </button>
        ))}
      </div>
      <div className="tabs rtabs">
        {round.shops.map((x) => (
          <button
            key={x.key} className="tab rtab" data-plat={x.platform}
            data-on={x.key === cur.key ? '1' : '0'} aria-current={x.key === cur.key ? 'page' : undefined}
            onClick={() => setPick({ r: round.n, s: x.key })}
          >
            <span className="rdot" />{shopName(x)} <small>{hhmm(x.from)}</small> <b>{x.orders.length}</b>
          </button>
        ))}
      </div>

      <div className="rcard">
        <div className="rhead">
          <div>
            <h2>{shopName(cur)} · รอบ {round.n}</h2>
            <div className="sub" style={{ margin: 0 }}>
              {dayText} · กดส่ง {hhmm(cur.from)}–{hhmm(cur.to)} น.{cur.live ? ' (ยังกดอยู่)' : ''}
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
          <ViewToggle view={view} cookie={viewCookie} onChange={setView} />
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
                      {t.sizes.map((z) => <th key={z.key} className="rg-z">{z.label}{z.note && <div className="rg-note">{z.note}</div>}</th>)}
                      <th className="rg-sum">รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((g) => (
                      <tr key={g.basket + '|' + g.color + '|' + g.name} data-first={g.first ? '1' : '0'} data-last={g.last ? '1' : '0'}>
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
          <table className="rrows">
            <thead><tr><th>SKU</th><th className="rname">ชื่อสินค้า</th><th>ตัวเลือก</th><th>ไซส์</th><th className="num">จำนวน</th></tr></thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s.sku || `name:${s.name}|${s.color}|${s.size}`}>
                  <td>
                    {s.sku ? <span className="rsku">{s.sku}</span> : <span className="stale">ไม่มี SKU</span>}
                    {s.sku && !s.inSt && <span className="rg-miss" title="ไม่พบใน ST — ไซส์เดาจากแพลตฟอร์ม">!</span>}
                    <div className="rname-m">{s.name}</div>
                  </td>
                  <td className="rname" title={s.name}>{s.name}</td>
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
                {' · '}{itemsText(o)}
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
            <thead><tr><th>ออเดอร์</th><th>ปริ้น/กดส่ง</th><th>สินค้า</th></tr></thead>
            <tbody>
              {cur.orders.map((o) => (
                <tr key={o.order_id}>
                  <td><Link href={`/orders?status=all&q=${encodeURIComponent(o.order_id)}`}>#{o.order_id}</Link></td>
                  <td className="sku">{hhmm(o.ship_at)}</td>
                  <td>{itemsText(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </>
  );
}
