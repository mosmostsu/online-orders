'use client';
// Report Selection — แท็บใหม่ที่เปิดจากตาราง ALL SITE แบบ ../allsitepd (openSelectedInTab)
// โชว์เฉพาะ SKU ที่ส่งมาจากปุ่ม "เปิดในแท็บใหม่" (localStorage HANDOFF) กรอง/เรียงในหน้าได้ คลิกแถวไฮไลต์ ดาวน์โหลดเป็น Excel (CSV)
//
// บันทึกเป็นรายงานได้ (supabase/044) → ลิงก์ ?id=... ใครเปิดก็เห็นรายการเดียวกัน
//   คลิกแถว = ติ๊ก "ทำแล้ว" บันทึกลงฐานข้อมูล คนอื่นเห็นด้วย (ดึงใหม่ทุก 15 วินาที) — มาเช็คแล้วทำต่อได้
// ปุ่มรีเฟรช: สร้างรายการ SKU×ร้านใหม่ แล้วดึงสต็อก/Y/N และติ๊กของทุกคนล่าสุด
//
// ค่าเริ่มต้น "รวมสี": แถวละรุ่น+สี (group_name ใน ST = ชื่อตัดไซส์ท้าย) รวมทุกไซส์ไว้แถวเดียว
//   ช่องร้านแบบเดียวกับมุมมองรุ่น+สี: ✓ 5/5 ลงครบ · ⚠ 3/5 ลงบางไซส์ · — ไม่ลงเลย — สลับไปดู "แยกไซส์" ได้
import { useEffect, useMemo, useState } from 'react';
import { HANDOFF } from '../Selection';

const SHORT = { shopee: 'SHO', tiktok: 'TIK', thisshop: 'THIS', lazada: 'LAZ' };
const groupOf = (s) => (s.platform === 'thisshop' ? 'REAL' : String(s.shop).toUpperCase());
const colLabel = (s) => `${SHORT[s.platform] || s.platform.toUpperCase()} ${groupOf(s)}`;
const num = (n) => Number(n || 0).toLocaleString('en-US');
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
// ไซส์ = ส่วนท้ายชื่อที่ตัดออกตอนทำรุ่น+สี ("... สีขาว - xl" → "XL") ไม่มีก็ใช้ SKU · พิมพ์ใหญ่เสมอ
const sizeOf = (r) => {
  const rest = String(r.name || '').slice(String(r.group_name || '').length).replace(/^\s*-\s*/, '').trim();
  return (rest || r.sku).toUpperCase();
};
// เรียงไซส์ตามลำดับจริง ไม่ใช่ตัวอักษร (L M S → S M L) · ไซส์ตัวเลข (รองเท้า) เรียงตามค่า
// ร้านใช้ทั้ง 2XL และ 4L/5L (ข้าม 3L) — ใส่ลำดับไว้ครบ
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '3L', '4L', '4XL', '5L', '5XL', '6L', '6XL', '7L', '8L', 'FREE', 'F', 'OSFM', 'OSFW', 'OSFY'];
const sizeRank = (z) => {
  const n = Number(z);
  if (!Number.isNaN(n)) return [0, n];
  const i = SIZE_ORDER.indexOf(z);
  return i >= 0 ? [1, i] : [2, z];
};
const bySize = (a, b) => {
  const [x, y] = [sizeRank(a.size), sizeRank(b.size)];
  return x[0] - y[0] || (typeof x[1] === 'number' && typeof y[1] === 'number' ? x[1] - y[1] : String(x[1]).localeCompare(String(y[1])));
};

export default function Report({ id = '' }) {
  const [report, setReport] = useState(null);     // รายงานที่บันทึกไว้ (มี id ในลิงก์)
  const [saved, setSaved] = useState([]);         // รายการรายงานทั้งหมด ไว้เลือกเปิด
  const [tick, setTick] = useState(0);            // กดรีเฟรช
  const [fresh, setFresh] = useState(false);
  const [localSkus, setLocalSkus] = useState([]);   // ที่ส่งมาจากหน้า ALL SITE (อ่านตอนเปิดหน้า)
  const skus = useMemo(() => (id ? [...(report?.skus || [])].sort() : localSkus), [id, report, localSkus]);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('color');   // color = รวมสี · size = แยกไซส์
  const [f, setF] = useState({ brand: '', cat: '', key: '' });
  const [yn, setYn] = useState({});
  const [hide, setHide] = useState(false);
  const [sort, setSort] = useState({ key: '', dir: 'asc' });
  const [mark, setMark] = useState(new Set());   // แถวที่ติ๊กทำแล้ว (รายงานที่บันทึก = ของทุกคน)
  const [open, setOpen] = useState('');          // ช่องร้านที่กดดูว่าขาดไซส์ไหน (แถว|ร้าน)

  const key = skus.join(',');

  // รายงานที่บันทึก: อ่านรายการ + ติ๊กทำแล้ว แล้วดึงติ๊กของคนอื่นทุก 15 วินาที
  async function loadReport() {
    const j = await fetch(`/api/allsite/reports/${id}`).then((r) => r.json());
    if (!j.ok) throw new Error(j.error || 'เปิดรายงานไม่ได้');
    setReport(j.report);
    setMark(new Set(j.report.done || []));
  }
  useEffect(() => {
    if (!id) return undefined;
    loadReport().catch((e) => setErr(e.message));
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') loadReport().catch(() => {});
    }, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    fetch('/api/allsite/reports').then((r) => r.json()).then((j) => j.ok && setSaved(j.reports)).catch(() => {});
  }, [id, tick]);
  // รอให้อ่าน localStorage ก่อน — ไม่งั้นรอบแรกได้รายการว่าง แล้วขึ้น "ยังไม่ได้เลือก" แวบหนึ่ง
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { setLocalSkus(JSON.parse(localStorage.getItem(HANDOFF) || '[]').sort()); } catch { setLocalSkus([]); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    setErr('');
    if (id && !report) return undefined;   // รอรายการของรายงานก่อน
    fetch('/api/allsite/rows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skus, fresh }) })
      .then((r) => r.json())
      .then((j) => { if (!alive) return; if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ'); setData(j); setFresh(false); })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, tick, Boolean(report)]);

  // 🔄 รีเฟรช — สร้างรายการ SKU×ร้านใหม่แล้วดึงทุกอย่างล่าสุด (รวมติ๊กของคนอื่น)
  function refresh() {
    setData(null);
    setFresh(true);
    setTick((t) => t + 1);
    if (id) loadReport().catch((e) => setErr(e.message));
  }

  // ติ๊ก/เอาติ๊กออก — รายงานที่บันทึก: ขึ้นทันทีแล้วบันทึกลงฐานข้อมูล (ทีละแถว ไม่ทับของคนอื่น)
  function toggleMark(k) {
    const on = !mark.has(k);
    setMark((m) => { const n = new Set(m); if (on) n.add(k); else n.delete(k); return n; });
    if (!id) return;
    fetch(`/api/allsite/reports/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: k, on }) })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setMark(new Set(j.done)); else alert(j.error || 'บันทึกไม่สำเร็จ'); })
      .catch(() => alert('บันทึกไม่สำเร็จ — ลองกดรีเฟรช'));
  }

  // 💾 บันทึกรายการที่เลือกในเครื่องนี้เป็นรายงาน แล้วเปิดลิงก์ของรายงานนั้น
  async function saveReport() {
    const d0 = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    const name = prompt('ตั้งชื่อรายงาน (คนอื่นจะเห็นชื่อนี้)', `เช็คลงสินค้า ${d0}`);
    if (!name) return;
    const j = await fetch('/api/allsite/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, skus }) })
      .then((r) => r.json()).catch(() => ({ ok: false, error: 'บันทึกไม่สำเร็จ' }));
    if (!j.ok) { alert(j.error); return; }
    // ติ๊กที่ทำไว้ก่อนบันทึก ยกไปด้วย
    await Promise.all([...mark].map((k) => fetch(`/api/allsite/reports/${j.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: k, on: true }) })));
    window.location.href = `/allsite/report?id=${j.id}`;
  }
  function copyLink() {
    const url = window.location.href;
    navigator.clipboard?.writeText(url).then(() => alert('คัดลอกลิงก์แล้ว ส่งให้คนอื่นเปิดได้เลย'), () => prompt('คัดลอกลิงก์นี้', url));
  }
  async function deleteReport() {
    if (!confirm(`ลบรายงาน "${report?.name}"? คนอื่นจะเปิดลิงก์นี้ไม่ได้อีก`)) return;
    const j = await fetch(`/api/allsite/reports/${id}`, { method: 'DELETE' }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (!j.ok) { alert(j.error || 'ลบไม่สำเร็จ'); return; }
    window.location.href = '/allsite/report';
  }

  const shops = data?.shops || [];
  const items = data?.rows || [];

  // แถวที่จะโชว์ — รวมสี: รวมไซส์ของรุ่น+สีเดียวกันเป็นแถวเดียว
  const base = useMemo(() => {
    const kept = items.filter((x) => !hide || x.qty > 0);
    if (mode === 'size') {
      return kept.map((x) => ({ ...x, id: x.sku, label: x.name, code: x.sku, n: 1, per: shops.map((_, i) => (x.on?.[i] ? 1 : 0)), sizes: [] }));
    }
    const g = new Map();
    for (const x of kept) {
      const k = x.group_name || x.sku;
      if (!g.has(k)) g.set(k, { id: k, label: k, brand: x.brand, cat: x.cat, price: x.price, qty: 0, n: 0, per: shops.map(() => 0), sizes: [], codes: [] });
      const r = g.get(k);
      r.qty += x.qty;
      r.n += 1;
      r.codes.push(x.sku);
      r.sizes.push({ size: sizeOf(x), qty: x.qty, sku: x.sku, on: x.on || [] });
      x.on?.forEach((v, i) => { if (v) r.per[i] += 1; });
      if (r.price === null || r.price === undefined) r.price = x.price;
    }
    // รหัสรุ่นโชว์เป็นช่วง SKU ของไซส์แรก — ไซส์เรียงตามรหัส
    return [...g.values()].map((r) => {
      r.sizes.sort(bySize);
      return { ...r, code: r.codes.sort()[0] };
    });
  }, [items, shops, mode, hide]);

  const rows = useMemo(() => {
    // กรองร้าน: Y = ลงครบ · N = ไม่ครบ (รวมสี) หรือยังไม่ลง (แยกไซส์)
    let r = base.filter((x) => (!f.brand || x.brand === f.brand) && (!f.cat || x.cat === f.cat) && (!f.key || x.id === f.key)
      && Object.entries(yn).every(([i, v]) => (v === 'Y') === (x.per[Number(i)] === x.n)));
    const val = (x) => {
      if (sort.key.startsWith('s:')) return x.per[Number(sort.key.slice(2))] / x.n;
      return { brand: x.brand, cat: x.cat, code: x.code, label: x.label, qty: x.qty, price: x.price }[sort.key] ?? '';
    };
    r = [...r].sort((a, b) => {
      if (!sort.key) return String(a.brand).localeCompare(String(b.brand)) || String(a.cat).localeCompare(String(b.cat)) || String(a.code).localeCompare(String(b.code));
      const A = val(a), B = val(b);
      const c = typeof A === 'number' && typeof B === 'number' ? A - B : String(A).localeCompare(String(B));
      return sort.dir === 'asc' ? c : -c;
    });
    return r;
  }, [base, f, yn, sort]);

  const th = (k, label) => (
    <span className="tlink" onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'asc' ? 'desc' : 'asc' }))}>
      {label} <span className="tsort">{sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '▲▼'}</span>
    </span>
  );
  // รวมสี: ✓ 5/5 / ⚠ 3/5 / — (แบบมุมมองรุ่น+สี) · แยกไซส์: Y / N/A (แบบ allsitepd)
  const shopCell = (r, i) => {
    const on = r.per[i];
    if (mode === 'size') return on ? 'Y' : 'N/A';
    if (on === r.n) return `✓ ${on}/${r.n}`;
    if (on === 0) return '—';
    return `⚠ ${on}/${r.n}`;
  };
  const shopClass = (r, i) => {
    const on = r.per[i];
    if (mode === 'size') return on ? 'ast-y' : 'ast-na';
    return on === r.n ? 'a-ok ast-cnt' : on === 0 ? 'a-no ast-cnt' : 'a-part ast-cnt';
  };

  // Excel เปิด CSV ที่มี BOM เป็นภาษาไทยได้ถูก — ไม่ต้องลงไลบรารี .xlsx เพิ่ม
  function downloadCsv() {
    const head = mode === 'color'
      ? ['แบรนด์', 'หมวดหมู่', 'รุ่น + สี', 'ไซส์', 'สต็อกรวม', 'ราคา', ...shops.map(colLabel)]
      : ['แบรนด์', 'หมวดหมู่', 'SKU', 'ชื่อสินค้า', 'สต็อก', 'ราคา', ...shops.map(colLabel)];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = rows.map((r) => (mode === 'color'
      ? [r.brand, r.cat, r.label, r.sizes.map((s) => s.size).join(' '), r.qty, r.price ?? '', ...shops.map((_, i) => shopCell(r, i))]
      : [r.brand, r.cat, r.code, r.label, r.qty, r.price ?? '', ...shops.map((_, i) => shopCell(r, i))]));
    const lines = [head, ...body].map((l) => l.map(esc).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `allsite-selection-${mode === 'color' ? 'รวมสี' : 'แยกไซส์'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="ast">
      <div className="ast-top">
        <div>
          <b className="ast-title">{id ? `📋 ${report?.name || 'รายงาน'}` : '📊 REPORT SELECTION'}</b>
          <div className="sku">
            {num(skus.length)} SKU · แสดง {num(rows.length)} {mode === 'color' ? 'รุ่น+สี' : 'SKU'}
            {' · '}<b className="ast-donecount">ทำแล้ว {num(rows.filter((r) => mark.has(r.id)).length)} / {num(rows.length)}</b>
            {' · '}{id ? 'คลิกแถว = ติ๊กทำแล้ว (ทุกคนเห็น)' : 'คลิกแถวเพื่อติ๊ก · บันทึกรายงานเพื่อให้คนอื่นเห็น'}
            {id && report?.updated_at && <> · แก้ล่าสุด {new Date(report.updated_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>}
          </div>
        </div>
        <div className="ast-ctl">
          <select className="aselect" value={id} onChange={(e) => { window.location.href = e.target.value ? `/allsite/report?id=${e.target.value}` : '/allsite/report'; }}>
            <option value="">— ที่เลือกในเครื่องนี้ —</option>
            {saved.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.done}/{r.skus})</option>)}
            {id && !saved.some((r) => r.id === id) && <option value={id}>{report?.name || 'รายงานนี้'}</option>}
          </select>
          <button type="button" className="chip" onClick={refresh} title="ดึงสต็อก Y/N และติ๊กของทุกคนล่าสุด">🔄 รีเฟรช</button>
          {!id && skus.length > 0 && <button type="button" className="btn ast-save" onClick={saveReport}>💾 บันทึกรายงาน</button>}
          {id && <button type="button" className="chip" onClick={copyLink}>🔗 คัดลอกลิงก์</button>}
          <span className="ast-mode">
            {[['color', 'รวมสี'], ['size', 'แยกไซส์']].map(([k, label]) => (
              <button key={k} type="button" className="chip" data-on={mode === k ? '1' : '0'}
                onClick={() => { setMode(k); setF((o) => ({ ...o, key: '' })); setSort({ key: '', dir: 'asc' }); }}>{label}</button>
            ))}
          </span>
          <label className="ast-hide"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> ซ่อนของหมด</label>
          <button type="button" className="btn ast-open" onClick={downloadCsv} disabled={!rows.length}>เซฟเป็น EXCEL</button>
          <button type="button" className="chip" onClick={() => { setF({ brand: '', cat: '', key: '' }); setYn({}); setHide(false); setSort({ key: '', dir: 'asc' }); }}>ล้างตัวกรอง</button>
          {!id && <button type="button" className="chip" onClick={() => { if (confirm('ล้างรายการที่เลือกทั้งหมด?')) { try { localStorage.removeItem(HANDOFF); } catch { /* */ } setLocalSkus([]); } }}>ล้างที่เลือก</button>}
          {id && <button type="button" className="chip" onClick={deleteReport}>🗑 ลบรายงาน</button>}
        </div>
      </div>

      {err && <div className="note">{err}</div>}
      {!data && !err && <div className="note">กำลังโหลด...</div>}
      {data && skus.length === 0 && (
        <div className="note">
          ยังไม่ได้เลือกสินค้าในเครื่องนี้ — กลับไปหน้า ALL SITE ติ๊กแถวที่ต้องการ แล้วกด “เปิดในแท็บใหม่”
          {saved.length > 0 && <> หรือเลือกเปิด<b>รายงานที่บันทึกไว้</b>จากช่องด้านบน</>}
        </div>
      )}

      {data && skus.length > 0 && (
        <div className="ast-wrap">
          <table className="ast-table">
            <thead>
              <tr>
                <th className="l">{th('brand', 'แบรนด์')}
                  <select className="ast-hsel" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })}>
                    <option value="">ทั้งหมด</option>{uniq(base.map((x) => x.brand)).map((v) => <option key={v}>{v}</option>)}
                  </select></th>
                <th className="l">{th('cat', 'หมวดหมู่')}
                  <select className="ast-hsel" value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })}>
                    <option value="">ทั้งหมด</option>{uniq(base.map((x) => x.cat)).map((v) => <option key={v}>{v}</option>)}
                  </select></th>
                {mode === 'size' && (
                  <th className="l">{th('code', 'SKU')}
                    <select className="ast-hsel" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })}>
                      <option value="">ทั้งหมด</option>{uniq(base.map((x) => x.id)).map((v) => <option key={v}>{v}</option>)}
                    </select></th>
                )}
                <th className="l">{th('label', mode === 'color' ? 'รุ่น + สี' : 'ชื่อสินค้า')}</th>
                {mode === 'color' && <th className="l">ไซส์</th>}
                <th className="ast-num">{th('qty', mode === 'color' ? 'สต็อกรวม' : 'สต็อก')}</th>
                <th className="ast-num">{th('price', 'ราคา')}</th>
                {shops.map((s, i) => (
                  <th key={`${s.platform}:${s.shop}`} className="ast-shop" data-plat={s.platform}>
                    {th(`s:${i}`, colLabel(s))}
                    <select className="ast-hsel" value={yn[i] || ''}
                      onChange={(e) => setYn((o) => { const n = { ...o }; if (e.target.value) n[i] = e.target.value; else delete n[i]; return n; })}>
                      <option value="">All</option><option value="Y">{mode === 'color' ? 'Y (ครบ)' : 'Y'}</option><option value="N">{mode === 'color' ? 'ไม่ครบ' : 'N/A'}</option>
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={mark.has(r.id) ? 'ast-sel' : ''}
                  onClick={() => toggleMark(r.id)}>
                  <td className="l ast-brand">{r.brand || '—'}</td>
                  <td className="l ast-cat">{r.cat || '—'}</td>
                  {mode === 'size' && <td className="l ast-sku">{r.code}</td>}
                  <td className="l ast-name">{r.label}</td>
                  {mode === 'color' && (
                    <td className="l ast-sizes">
                      {r.sizes.map((s) => (
                        <span key={s.sku} className={s.qty > 0 ? 'ast-size-on' : 'ast-size-off'} title={`${s.sku} · คงเหลือ ${s.qty}`}>{s.size}</span>
                      ))}
                    </td>
                  )}
                  <td className={'ast-num ' + (r.qty > 0 ? 'ast-qty' : 'ast-zero')}>{num(r.qty)}</td>
                  <td className="ast-num">{r.price === null || r.price === undefined ? '—' : num(r.price)}</td>
                  {shops.map((s, i) => (
                    <ShopCell key={`${s.platform}:${s.shop}`} r={r} i={i} mode={mode} cls={shopClass(r, i)} text={shopCell(r, i)}
                      plat={s.platform} label={colLabel(s)} open={open === `${r.id}|${i}`}
                      onToggle={() => setOpen((o) => (o === `${r.id}|${i}` ? '' : `${r.id}|${i}`))} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ช่องร้าน — ลงไม่ครบ (⚠ 5/6) กดแล้วเด้งบอกว่าไซส์ไหนยังไม่ได้ลง ชี้เมาส์ค้างก็เห็น
function ShopCell({ r, i, mode, cls, text, plat, label, open, onToggle }) {
  const partial = mode === 'color' && r.per[i] > 0 && r.per[i] < r.n;
  const missing = partial ? r.sizes.filter((z) => !z.on?.[i]) : [];
  const listed = partial ? r.sizes.filter((z) => z.on?.[i]) : [];
  if (!partial) return <td className={cls} data-plat={plat}>{text}</td>;
  return (
    <td className={cls + ' ast-click'} data-plat={plat} title={`ยังไม่ลง: ${missing.map((z) => z.size).join(' ')}`}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      {text}
      {open && (
        <div className="ast-pop" onClick={(e) => e.stopPropagation()}>
          <div className="ast-pop-h">{label} · ยังไม่ลง {missing.length} ไซส์</div>
          <div>{missing.map((z) => <span key={z.sku} className="ast-pz miss" title={`${z.sku} · คงเหลือ ${z.qty}`}>{z.size}</span>)}</div>
          <div className="sku" style={{ marginTop: 6 }}>ลงแล้ว</div>
          <div>{listed.map((z) => <span key={z.sku} className="ast-pz ok" title={z.sku}>{z.size}</span>)}</div>
        </div>
      )}
    </td>
  );
}
