'use client';
// แท็บรอบ/ร้าน + ใบจัดของ — สลับในเบราว์เซอร์ทั้งหมด (ข้อมูลทั้งวันโหลดมาจาก page.js แล้ว) กดแล้วขึ้นทันที
// รอบ/ร้านที่เลือกเขียนกลับลง URL (?r= &s=) ให้กดรีเฟรชหรือส่งลิงก์ต่อแล้วได้หน้าเดิม
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PLATFORM_LABEL } from '@/lib/shopGroups';
import { sumSkus, pivotSizes } from '@/lib/rounds';
import { assignSns, compareSns, applyDocFix, ANY_TIME } from '@/lib/r02';
import R02Upload from './R02Upload';
import CopySkus from './CopySkus';
import ViewToggle from './ViewToggle';
import PrintButton from './PrintButton';

const TH = { timeZone: 'Asia/Bangkok' };
const hhmm = (s) => new Date(s).toLocaleTimeString('th-TH', { ...TH, hour: '2-digit', minute: '2-digit' });
const shopName = (r) => `${PLATFORM_LABEL[r.platform] || r.platform} ${r.shop}`;
const pieces = (orders) => orders.reduce((s, o) => s + (o.os_order_items || []).reduce((t, i) => t + (Number(i.qty) || 0), 0), 0);
const itemsText = (o) => (o.os_order_items || []).map((i) => `${i.sku || i.product_name} × ${i.qty}`).join(', ');

export default function RoundView({ rounds, st, day, dayText, dayNav, initialRound, initialShop, initialView, viewCookie }) {
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

  // เช็คกับ Seniorsoft (R02.102) — ใบยิงออกลงรอบตามเวลายิง แล้วเทียบกับใบจัดของทีละร้าน
  // Seniorsoft ไม่แยกร้าน Shopee: SKU เดียวกันหักส่วนของร้านอื่นในรอบเดียวกันออกก่อน (ดู lib/r02.js)
  const [sns, setSns] = useState(null);
  const assigned = useMemo(() => (sns ? assignSns(rounds, applyDocFix(sns.lines, sns.fix)) : null), [sns, rounds]);
  // ThisShop (ANY_TIME) ไม่ดูเวลายิง: เทียบกับใบยิงทั้งวัน แล้วหักออเดอร์ ThisShop ของรอบอื่นด้วย
  const checkOf = (shop, rows) => {
    const anyTime = ANY_TIME.has(shop.platform);
    const others = rounds.filter((r) => anyTime || r.n === round.n)
      .flatMap((r) => r.shops.filter((x) => x.platform === shop.platform && !(r.n === round.n && x.key === shop.key)))
      .flatMap((x) => x.orders.flatMap((o) => (o.os_order_items || []).map((i) => ({ sku: i.sku, qty: Number(i.qty) || 0 }))));
    return compareSns(rows, others, assigned.get(`${anyTime ? '*' : round.n}|${shop.platform}`) || []);
  };
  const check = useMemo(() => (assigned ? checkOf(cur, skus) : null), [assigned, cur, skus]);   // eslint-disable-line react-hooks/exhaustive-deps
  const tabBad = useMemo(() => (assigned
    ? Object.fromEntries(round.shops.map((x) => [x.key, x.key === cur.key ? check.bad : checkOf(x, sumSkus(x.orders, stMap)).bad]))
    : {}), [assigned, round, cur.key, check, stMap]);   // eslint-disable-line react-hooks/exhaustive-deps
  // มีผลเช็ค: แถวที่ไม่ตรงขึ้นบนสุด
  const rowsShown = check ? [...check.rows].sort((a, b) => (a.qty === a.sns) - (b.qty === b.sns)) : skus;

  return (
    <>
      <div className="rday">
        {dayNav}
        <R02Upload day={day} value={sns} onChange={setSns} />
      </div>
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
            {x.key in tabBad && (tabBad[x.key] ? <span className="rbad">✗{tabBad[x.key]}</span> : <span className="rgood">✓</span>)}
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

        {check && (
          <div className={'rcheck ' + (check.bad ? 'bad' : 'good')}>
            <b>เช็คกับ Seniorsoft:</b> ต้องจัด {pieces(cur.orders)} ชิ้น · ยิงออก {check.snsTotal} ชิ้น ·{' '}
            {check.bad ? <b>ไม่ตรง {check.bad} รายการ</b> : <b>ตรงครบ ✓</b>}
            {grid && check.bad > 0 && <span> — กด "แถว" เพื่อดูว่า SKU ไหนไม่ตรง</span>}
          </div>
        )}

        {check && check.extra.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="rgrid-title">❗ ยิงออกใน Seniorsoft แต่ไม่มีในใบจัดของรอบนี้ (ยิงเกิน/ยิงผิดตัว) <span>· {check.extra.length} รายการ</span></div>
            <table className="rrows rextra">
              <thead><tr><th>SKU</th><th>ช่องทาง</th><th className="num">จำนวน</th><th className="rname">Detail</th></tr></thead>
              <tbody>
                {check.extra.map((e) => (
                  <tr key={e.sku} data-diff="over">
                    <td><span className="rsku">{e.sku}</span></td>
                    <td>{PLATFORM_LABEL[cur.platform] || cur.platform}</td>
                    <td className="num">{e.qty}</td>
                    <td className="rname" title={e.name}>{e.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
          <table className="rrows" data-check={check ? '1' : '0'}>
            <thead>
              <tr>
                <th>SKU</th><th className="rname">ชื่อสินค้า</th><th>ตัวเลือก</th><th>ไซส์</th>
                <th className="num">{check ? 'จากเว็บ' : 'จำนวน'}</th>
                {check && <th className="num">ยิงออก SNS</th>}
              </tr>
            </thead>
            <tbody>
              {rowsShown.map((s) => (
                <tr key={s.sku || `name:${s.name}|${s.color}|${s.size}`} data-diff={!check || s.qty === s.sns ? undefined : s.sns < s.qty ? 'short' : 'over'}>
                  <td>
                    {s.sku ? <span className="rsku">{s.sku}</span> : <span className="stale">ไม่มี SKU</span>}
                    {s.sku && !s.inSt && <span className="rg-miss" title="ไม่พบใน ST — ไซส์เดาจากแพลตฟอร์ม">!</span>}
                    <div className="rname-m">{s.name}</div>
                  </td>
                  <td className="rname" title={s.name}>{s.name}</td>
                  <td>{s.color}</td>
                  <td>{s.size}</td>
                  <td className="num">{s.qty}</td>
                  {check && (
                    <td className="num">
                      {s.sns}
                      {s.sns !== s.qty && <span className="rdiff" data-diff={s.sns < s.qty ? 'short' : 'over'}>{s.sns < s.qty ? `ขาด ${s.qty - s.sns}` : `เกิน ${s.sns - s.qty}`}</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ใบที่ยกเลิกหลังกดส่งไม่โชว์ที่นี่ (ไม่ต้องจัด และร้านดูที่หน้าออเดอร์ แท็บ "ยกเลิกก่อนขนส่งเข้ารับ" อยู่แล้ว) — ไม่นับในยอดด้วย */}
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
