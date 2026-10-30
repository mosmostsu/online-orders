'use client';
// แท็บรอบ/ร้าน + ใบจัดของ — สลับในเบราว์เซอร์ทั้งหมด (ข้อมูลทั้งวันโหลดมาจาก page.js แล้ว) กดแล้วขึ้นทันที
// รอบ/ร้านที่เลือกเขียนกลับลง URL (?r= &s=) ให้กดรีเฟรชหรือส่งลิงก์ต่อแล้วได้หน้าเดิม
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PLATFORM_LABEL } from '@/lib/shopGroups';
import { sumSkus, pivotSizes, normSku } from '@/lib/rounds';
import { assignSns, compareSns, applyDocFix, applySubs, lineFixKey, ANY_TIME, CASH } from '@/lib/r02';
import R02Upload, { saveR02 } from './R02Upload';
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
  const EXTRA = 'extra';   // แท็บ "ของเกิน" ตอนติ๊กยิงปนกัน


  const stMap = useMemo(() => new Map(Object.entries(st)), [st]);
  const skus = useMemo(() => sumSkus(cur.orders, stMap), [cur, stMap]);
  const grid = useMemo(() => (view === 'grid' ? pivotSizes(skus) : null), [view, skus]);
  const missing = skus.filter((s) => s.sku && !s.inSt).length;

  // เช็คกับ Seniorsoft (R02.102) — ใบยิงออกลงรอบตามเวลายิง แล้วเทียบกับใบจัดของทีละร้าน
  // Seniorsoft ไม่แยกร้าน Shopee: SKU เดียวกันหักส่วนของร้านอื่นในรอบเดียวกันออกก่อน (ดู lib/r02.js)
  const [sns, setSns] = useState(null);
  const assigned = useMemo(() => (sns ? assignSns(rounds, applyDocFix(sns.lines, sns.fix)) : null), [sns, rounds]);
  // ThisShop (ANY_TIME) ไม่ดูเวลายิง: เทียบกับใบยิงทั้งวัน แล้วหักออเดอร์ ThisShop ของรอบอื่นด้วย
  // รอบที่ติ๊ก "นับรวม" (ยิงปนกันหลายช่องทาง เฉพาะวันนั้น): ทุกช่องทางในรอบ (ยกเว้น ANY_TIME) ใช้ใบยิงกองเดียวกัน
  const merged = !!sns?.merge?.[round.n];
  const checkOf = (shop, rows, rr = round) => {
    const anyTime = ANY_TIME.has(shop.platform);
    const mergedR = !!sns?.merge?.[rr.n];
    const pool = mergedR && !anyTime
      ? new Set(rr.shops.map((x) => x.platform).filter((p) => !ANY_TIME.has(p)))
      : new Set([shop.platform]);
    const others = rounds.filter((r) => anyTime || r.n === rr.n)
      .flatMap((r) => r.shops.filter((x) => pool.has(x.platform) && !(r.n === rr.n && x.key === shop.key)))
      .flatMap((x) => x.orders.flatMap((o) => (o.os_order_items || []).map((i) => ({ sku: i.sku, qty: Number(i.qty) || 0 }))));
    const lines = applySubs(
      [...pool].flatMap((p) => assigned.get(`${anyTime ? '*' : rr.n}|${p}`) || []),
      (sns?.subs || []).filter((x) => x.n === rr.n && pool.has(x.platform)),
    );
    const c = compareSns(rows, others, lines);
    if (pool.size < 2 && !(mergedR && !anyTime)) return c;
    // ยิงปนกัน: ของที่ไม่มีในใบจัดของร้านไหนเลยแยกไปแท็บ "ของเกิน" ไม่นับซ้ำในทุกร้าน
    return { ...c, extra: [], bad: c.bad - c.extra.length, snsTotal: c.snsTotal - c.extra.reduce((n, e) => n + e.qty, 0) };
  };
  // ของเกินของทั้งรอบ (ติ๊กยิงปนกัน) — ใบยิงที่ SKU ไม่มีในใบจัดของร้านไหนในรอบนี้ แยกตาม SKU + บอกเลขใบ
  const poolExtra = useMemo(() => {
    if (!assigned || !merged) return [];
    const plats = new Set(round.shops.map((x) => x.platform).filter((p) => !ANY_TIME.has(p)));
    const have = new Set(round.shops.filter((x) => plats.has(x.platform))
      .flatMap((x) => x.orders.flatMap((o) => (o.os_order_items || []).map((i) => normSku(i.sku)))));
    const m = new Map();
    for (const l of [...plats].flatMap((p) => assigned.get(`${round.n}|${p}`) || [])) {
      const k = normSku(l.sku);
      if (have.has(k)) continue;
      const e = m.get(k) || { sku: l.sku, name: l.name, qty: 0, docs: [], plats: [] };
      e.qty += l.qty;
      if (!e.docs.includes(l.doc)) e.docs.push(l.doc);
      if (!e.plats.includes(l.platform)) e.plats.push(l.platform);
      m.set(k, e);
    }
    return [...m.values()];
  }, [assigned, merged, round]);
  const showExtra = pick.s === EXTRA && poolExtra.length > 0;

  // ของเกินที่รอบก่อนหน้า "ขาด" SKU เดียวกัน (ช่องทางเดียวกัน) = น่าจะหาเจอทีหลังแล้วยิงตามในรอบนี้
  // → ปุ่มย้ายไปนับในรอบนั้น (แก้ทีละตัวในใบ เก็บไว้กับไฟล์ของวันนั้น)
  // ไล่ทุกรอบก่อนหน้า (ใกล้สุดก่อน) คืนทุกรอบที่ขาด
  const shortBefore = (sku, plats) => {
    const out = [];
    for (const r of [...rounds].reverse()) {
      if (r.n >= round.n) continue;
      let short = 0;
      for (const x of r.shops) {
        if (!plats.includes(x.platform) || ANY_TIME.has(x.platform)) continue;
        const row = checkOf(x, sumSkus(x.orders, stMap), r).rows.find((y) => normSku(y.sku) === normSku(sku));
        if (row && row.sns < row.qty) short += row.qty - row.sns;
      }
      if (short) out.push({ n: r.n, short });
    }
    return out;
  };
  const updateSns = (v) => { setSns(v); saveR02(day, v); };
  const moveTo = (e, n) => {
    const fix = { ...(sns.fix || {}) };
    for (const d of e.docs) fix[lineFixKey(d, e.sku)] = `|${n}`;
    updateSns({ ...sns, fix });
  };
  // ออเดอร์ออนไลน์ที่ถูกยิงเป็น "เงินสด" — แถวที่ขาด ถ้ามีใบเงินสดวันนั้นที่มี SKU เดียวกัน ให้กดนับเข้ารอบนี้ได้ทีละตัว
  const cashBySku = useMemo(() => {
    const m = new Map();
    if (!sns) return m;
    for (const l of applyDocFix(sns.lines, sns.fix)) {
      if (l.platform !== CASH) continue;
      const k = normSku(l.sku);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(l);
    }
    return m;
  }, [sns]);
  const MoveBtn = ({ e, plats }) => {
    return shortBefore(e.sku, plats).map((b) => (
      <button key={b.n} className="btn rmove" onClick={() => moveTo(e, b.n)} title={`รอบ ${b.n} ขาด SKU นี้อยู่ ${b.short} ชิ้น`}>
        ↩ นับเป็นของรอบ {b.n} (ขาด {b.short})
      </button>
    ));
  };
  const check = useMemo(() => (assigned ? checkOf(cur, skus) : null), [assigned, cur, skus]);   // eslint-disable-line react-hooks/exhaustive-deps
  // แท็บ "อื่นๆ" (ทางเลือกสุดท้าย ปกติยิงไม่พลาด): แถวที่ขาดของทุกร้านในรอบนี้ + ของที่น่าจะเป็นตัวเดียวกัน
  //   💵 SKU เดียวกันแต่ยิงเป็นเงินสด · 📦 ยิงในรอบอื่น (เบิกโกดัง/ยิงทีหลัง) = ของเกินของรอบอื่นที่ใบจัดของรอบนั้นไม่มี
  //   🔁 ส่งของแทน = รุ่นเดียวกัน (6 ตัวแรกของ SKU ตรงกัน) ที่ยิงเกินในรอบนี้ ยิงในรอบอื่น หรืออยู่ในใบเงินสด
  const sameModel = (a, b) => normSku(a) !== normSku(b) && normSku(a).slice(0, 6) === normSku(b).slice(0, 6);
  const helpers = !assigned ? [] : round.shops.filter((x) => !ANY_TIME.has(x.platform)).flatMap((x) => {
    const c = x.key === cur.key ? check : checkOf(x, sumSkus(x.orders, stMap));
    const surplus = [
      ...(merged ? poolExtra : c.extra).map((e) => ({ sku: e.sku, qty: e.qty, name: e.name })),
      ...c.rows.filter((r) => r.sns > r.qty).map((r) => ({ sku: r.sku, qty: r.sns - r.qty, name: r.name })),
    ];
    const cashAll = [...cashBySku.values()].flat();
    // ใบยิงของรอบอื่น (ช่องทางเดียวกัน) ที่ SKU ไม่มีในใบจัดของรอบนั้น
    const otherLines = rounds.filter((r) => r.n !== round.n).flatMap((r) => {
      const have = new Set(r.shops.filter((y) => y.platform === x.platform)
        .flatMap((y) => y.orders.flatMap((o) => (o.os_order_items || []).map((i) => normSku(i.sku)))));
      return (assigned.get(`${r.n}|${x.platform}`) || []).filter((l) => !have.has(normSku(l.sku))).map((l) => ({ ...l, n: r.n }));
    });
    return c.rows.filter((r) => r.sku && r.sns < r.qty).flatMap((row) => [
      ...(cashBySku.get(normSku(row.sku)) || []).map((l) => ({ kind: 'cash', cash: true, ...l })),
      ...otherLines.filter((l) => normSku(l.sku) === normSku(row.sku)).map((l) => ({ kind: 'move', ...l })),
      ...surplus.filter((u) => sameModel(u.sku, row.sku)).map((u) => ({ kind: 'swap', ...u })),
      ...otherLines.filter((l) => sameModel(l.sku, row.sku)).map((l) => ({ kind: 'swap', ...l })),
      ...cashAll.filter((l) => sameModel(l.sku, row.sku)).map((l) => ({ kind: 'swap', cash: true, ...l })),
    ].map((h) => ({ ...h, shop: x, row, short: row.qty - row.sns })));
  });
  const useHelper = (h) => {
    // ใบเงินสด / ใบของรอบอื่น → ย้ายตัวนั้นมานับในร้าน+รอบนี้ก่อน
    const fix = h.cash || h.n ? { ...(sns.fix || {}), [lineFixKey(h.doc, h.sku)]: `${h.shop.platform}|${round.n}` } : sns.fix;
    const subs = h.kind === 'swap'
      ? [...(sns.subs || []), { n: round.n, platform: h.shop.platform, from: h.sku, to: h.row.sku, qty: Math.min(h.qty, h.short) }]
      : sns.subs;
    updateSns({ ...sns, fix, subs });
  };
  const OTHER = 'other';
  const showOther = pick.s === OTHER && helpers.length > 0 && !showExtra;
  const tabBad = useMemo(() => (assigned
    ? Object.fromEntries(round.shops.map((x) => [x.key, x.key === cur.key ? check.bad : checkOf(x, sumSkus(x.orders, stMap)).bad]))
    : {}), [assigned, round, cur.key, check, stMap]);   // eslint-disable-line react-hooks/exhaustive-deps
  // มีผลเช็ค: แถวที่ไม่ตรงขึ้นบนสุด
  const rowsShown = check ? [...check.rows].sort((a, b) => (a.qty === a.sns) - (b.qty === b.sns)) : skus;

  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set('r', round.n);
    u.searchParams.set('s', showExtra ? EXTRA : showOther ? OTHER : cur.key);
    window.history.replaceState(window.history.state, '', u);
  }, [round.n, cur.key, showExtra, showOther]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="rday">
        {dayNav}
        <R02Upload day={day} round={round.n} value={sns} onChange={setSns} />
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
            data-on={x.key === cur.key && !showExtra && !showOther ? '1' : '0'} aria-current={x.key === cur.key && !showExtra && !showOther ? 'page' : undefined}
            onClick={() => setPick({ r: round.n, s: x.key })}
          >
            <span className="rdot" />{shopName(x)} <small>{hhmm(x.from)}</small> <b>{x.orders.length}</b>
            {x.key in tabBad && (tabBad[x.key] ? <span className="rbad">✗{tabBad[x.key]}</span> : <span className="rgood">✓</span>)}
          </button>
        ))}
        {poolExtra.length > 0 && (
          <button
            className="tab rtab rtab-extra" data-on={showExtra ? '1' : '0'} aria-current={showExtra ? 'page' : undefined}
            onClick={() => setPick({ r: round.n, s: EXTRA })}
          >
            ของเกิน <b>{poolExtra.reduce((n, e) => n + e.qty, 0)}</b> <span className="rbad rbad-over">✗{poolExtra.length}</span>
          </button>
        )}
        {helpers.length > 0 && (
          <button
            className="tab rtab rtab-other" data-on={showOther ? '1' : '0'} aria-current={showOther ? 'page' : undefined}
            onClick={() => setPick({ r: round.n, s: OTHER })}
            title="ของที่ขาด แต่เจอในใบเงินสด หรือน่าจะส่งตัวอื่นแทน (เปลี่ยนสี/ไซส์)"
          >
            สินค้าอื่นๆ <b>{new Set(helpers.map((h) => `${h.shop.key}|${h.row.sku}`)).size}</b>
          </button>
        )}
      </div>

      {showOther ? (
        <div className="rcard">
          <div className="rhead">
            <div>
              <h2>สินค้าอื่นๆ · รอบ {round.n}</h2>
              <div className="sub" style={{ margin: 0 }}>
                ทางเลือกสุดท้าย — ของที่ยังขาด แต่เจอในใบเงินสดวันนี้ (💵) ยิงไว้ในรอบอื่น เช่นเบิกโกดัง/ยิงทีหลัง (📦) หรือมีรุ่นเดียวกันสี/ไซส์อื่นที่น่าจะส่งแทน (🔁) · กด "นับ" เฉพาะที่ใช่จริง ยกเลิกได้ใน "ยิงพลาด? แก้ทีละใบ"
              </div>
            </div>
          </div>
          <table className="rrows rother">
            <thead><tr><th>ร้าน</th><th>ที่ขาด</th><th className="num">ขาด</th><th>เจอ</th><th className="num">จำนวน</th><th /></tr></thead>
            <tbody>
              {helpers.map((h, i) => (
                <tr key={i} data-diff="short">
                  <td>{shopName(h.shop)}</td>
                  <td><span className="rsku">{h.row.sku}</span> <span className="rhint">{h.row.color} {h.row.size}</span></td>
                  <td className="num">{h.short}</td>
                  <td>
                    {h.kind === 'cash' ? '💵 ' : h.kind === 'move' ? '📦 ' : '🔁 ส่งแทนด้วย '}
                    <span className="rsku">{h.sku}</span>{' '}
                    <span className="rhint">
                      {h.cash ? `ใบเงินสด ${h.doc} · ${hhmm(h.at)}` : h.n ? `ยิงในรอบ ${h.n} · ใบ ${h.doc} · ${hhmm(h.at)}` : 'ยิงเกินในรอบนี้'}
                    </span>
                  </td>
                  <td className="num">{h.qty}</td>
                  <td className="rmove-td"><button className="btn rmove" onClick={() => useHelper(h)}>นับ</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : showExtra ? (
        <div className="rcard">
          <div className="rhead">
            <div>
              <h2>ของเกิน · รอบ {round.n}</h2>
              <div className="sub" style={{ margin: 0 }}>
                ติ๊ก "ยิงปนกัน" ไว้ — ยิงออกใน Seniorsoft แต่ไม่มีในใบจัดของร้านไหนในรอบนี้ (ยิงเกิน/ยิงผิดตัว หรือเป็นของร้านที่ไม่มีข้อมูลออเดอร์ เช่น Shopee MVP)
              </div>
            </div>
            <div className="rbig"><b>{poolExtra.length}</b> รายการ · <b>{poolExtra.reduce((n, e) => n + e.qty, 0)}</b> ชิ้น</div>
          </div>
          <table className="rrows rextra rextra-doc">
            <thead><tr><th>SKU</th><th>เลขใบ</th><th className="num">จำนวน</th><th className="rname">Detail</th><th /></tr></thead>
            <tbody>
              {poolExtra.map((e) => (
                <tr key={e.sku} data-diff="over">
                  <td><span className="rsku">{e.sku}</span></td>
                  <td>{e.docs.join(', ')}</td>
                  <td className="num">{e.qty}</td>
                  <td className="rname" title={e.name}>{e.name}</td>
                  <td className="rmove-td"><MoveBtn e={e} plats={e.plats} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="rcard" data-view={grid ? 'grid' : 'rows'}>
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
            <table className="rrows rextra rextra-doc">
              <thead><tr><th>SKU</th><th>เลขใบ</th><th className="num">จำนวน</th><th className="rname">Detail</th><th /></tr></thead>
              <tbody>
                {check.extra.map((e) => (
                  <tr key={e.sku} data-diff="over">
                    <td><span className="rsku">{e.sku}</span></td>
                    <td>{e.docs.join(', ')}</td>
                    <td className="num">{e.qty}</td>
                    <td className="rname" title={e.name}>{e.name}</td>
                    <td className="rmove-td"><MoveBtn e={e} plats={[cur.platform]} /></td>
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
        {/* พิมพ์แบบแถว: ตารางเล็กแน่นแบบชีต (SKU · ชื่อ · ตัวเลือก · จำนวน) หน้า A4 แนวตั้ง เรียง SKU แบบตัวอักษรเหมือนชีต — โชว์เฉพาะตอนพิมพ์ */}
        {!grid && (
          <table className="rprint">
            <thead><tr><th>{shopName(cur)} รอบ{round.n}</th><th>Product Name</th><th>Variation</th><th>จำนวน</th></tr></thead>
            <tbody>
              {[...skus].sort((a, b) => !a.sku - !b.sku || (a.sku || '').localeCompare(b.sku || '', 'en', { sensitivity: 'base' })).map((s) => (
                <tr key={s.sku || `name:${s.name}|${s.color}|${s.size}`}>
                  <td>{s.sku}</td><td>{s.name}</td><td>{[s.color, s.size].filter(Boolean).join(', ')}</td><td>{s.qty}</td>
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
      )}
    </>
  );
}
