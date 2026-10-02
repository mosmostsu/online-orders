'use client';
// Report Selection — แท็บใหม่ที่เปิดจากตาราง ALL SITE แบบ ../allsitepd (openSelectedInTab)
// โชว์เฉพาะ SKU ที่เลือกไว้ (localStorage) กรอง/เรียงในหน้าได้ คลิกแถวไฮไลต์ ดาวน์โหลดเป็น Excel (CSV)
import { useEffect, useMemo, useState } from 'react';
import { useSelection, selection } from '../Selection';

const SHORT = { shopee: 'SHO', tiktok: 'TIK', thisshop: 'THIS', lazada: 'LAZ' };
const groupOf = (s) => (s.platform === 'thisshop' ? 'REAL' : String(s.shop).toUpperCase());
const colLabel = (s) => `${SHORT[s.platform] || s.platform.toUpperCase()} ${groupOf(s)}`;
const num = (n) => Number(n || 0).toLocaleString('en-US');
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

export default function Report() {
  const sel = useSelection();
  const skus = useMemo(() => [...sel].sort(), [sel]);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ brand: '', cat: '', sku: '' });
  const [yn, setYn] = useState({});
  const [hide, setHide] = useState(false);
  const [sort, setSort] = useState({ key: '', dir: 'asc' });
  const [mark, setMark] = useState(new Set());   // แถวที่คลิกไฮไลต์

  const key = skus.join(',');
  // รอให้อ่าน localStorage ก่อน — ไม่งั้นรอบแรกได้รายการว่าง แล้วขึ้น "ยังไม่ได้เลือก" แวบหนึ่ง
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    setErr('');
    fetch('/api/allsite/rows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skus }) })
      .then((r) => r.json())
      .then((j) => { if (!alive) return; if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ'); setData(j); })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  const shops = data?.shops || [];
  const all = data?.rows || [];
  const rows = useMemo(() => {
    let r = all.filter((x) => (!f.brand || x.brand === f.brand) && (!f.cat || x.cat === f.cat) && (!f.sku || x.sku === f.sku)
      && (!hide || x.qty > 0)
      && Object.entries(yn).every(([i, v]) => (v === 'Y') === Boolean(x.on?.[Number(i)])));
    if (sort.key) {
      const val = (x) => (sort.key.startsWith('s:') ? (x.on?.[Number(sort.key.slice(2))] ? 1 : 0) : x[sort.key] ?? '');
      r = [...r].sort((a, b) => {
        const A = val(a), B = val(b);
        const c = typeof A === 'number' && typeof B === 'number' ? A - B : String(A).localeCompare(String(B));
        return sort.dir === 'asc' ? c : -c;
      });
    } else {
      r = [...r].sort((a, b) => String(a.brand).localeCompare(String(b.brand)) || String(a.cat).localeCompare(String(b.cat)) || a.sku.localeCompare(b.sku));
    }
    return r;
  }, [all, f, yn, hide, sort]);

  const th = (k, label) => (
    <span className="tlink" onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'asc' ? 'desc' : 'asc' }))}>
      {label} <span className="tsort">{sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '▲▼'}</span>
    </span>
  );

  // Excel เปิด CSV ที่มี BOM เป็นภาษาไทยได้ถูก — ไม่ต้องลงไลบรารี .xlsx เพิ่ม
  function downloadCsv() {
    const head = ['แบรนด์', 'หมวดหมู่', 'SKU', 'ชื่อสินค้า', 'สต็อก', 'ราคา', ...shops.map(colLabel)];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head, ...rows.map((r) => [r.brand, r.cat, r.sku, r.name, r.qty, r.price ?? '', ...shops.map((_, i) => (r.on?.[i] ? 'Y' : 'N/A'))])]
      .map((l) => l.map(esc).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `allsite-selection-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="ast">
      <div className="ast-top">
        <div>
          <b className="ast-title">📊 REPORT SELECTION</b>
          <div className="sku">เลือกไว้ {num(skus.length)} รายการ · แสดง {num(rows.length)} · คลิกแถวเพื่อไฮไลต์</div>
        </div>
        <div className="ast-ctl">
          <label className="ast-hide"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> ซ่อนของหมด</label>
          <button type="button" className="btn ast-open" onClick={downloadCsv} disabled={!rows.length}>เซฟเป็น EXCEL</button>
          <button type="button" className="chip" onClick={() => { setF({ brand: '', cat: '', sku: '' }); setYn({}); setHide(false); setSort({ key: '', dir: 'asc' }); }}>ล้างตัวกรอง</button>
          <button type="button" className="chip" onClick={() => { if (confirm('ล้างรายการที่เลือกทั้งหมด?')) selection.clear(); }}>ล้างที่เลือก</button>
        </div>
      </div>

      {err && <div className="note">{err}</div>}
      {!data && !err && <div className="note">กำลังโหลด...</div>}
      {data && skus.length === 0 && (
        <div className="note">ยังไม่ได้เลือกสินค้า — กลับไปหน้า ALL SITE ติ๊กแถวที่ต้องการ แล้วกด “เปิดในแท็บใหม่”</div>
      )}

      {data && skus.length > 0 && (
        <div className="ast-wrap">
          <table className="ast-table">
            <thead>
              <tr>
                <th className="l">{th('brand', 'แบรนด์')}
                  <select className="ast-hsel" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })}>
                    <option value="">ทั้งหมด</option>{uniq(all.map((x) => x.brand)).map((v) => <option key={v}>{v}</option>)}
                  </select></th>
                <th className="l">{th('cat', 'หมวดหมู่')}
                  <select className="ast-hsel" value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })}>
                    <option value="">ทั้งหมด</option>{uniq(all.map((x) => x.cat)).map((v) => <option key={v}>{v}</option>)}
                  </select></th>
                <th className="l">{th('sku', 'SKU')}
                  <select className="ast-hsel" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })}>
                    <option value="">ทั้งหมด</option>{uniq(all.map((x) => x.sku)).map((v) => <option key={v}>{v}</option>)}
                  </select></th>
                <th className="l">{th('name', 'ชื่อสินค้า')}</th>
                <th className="ast-num">{th('qty', 'สต็อก')}</th>
                <th className="ast-num">{th('price', 'ราคา')}</th>
                {shops.map((s, i) => (
                  <th key={`${s.platform}:${s.shop}`} className="ast-shop" data-plat={s.platform}>
                    {th(`s:${i}`, colLabel(s))}
                    <select className="ast-hsel" value={yn[i] || ''}
                      onChange={(e) => setYn((o) => { const n = { ...o }; if (e.target.value) n[i] = e.target.value; else delete n[i]; return n; })}>
                      <option value="">All</option><option value="Y">Y</option><option value="N">N/A</option>
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku} className={mark.has(r.sku) ? 'ast-sel' : ''}
                  onClick={() => setMark((m) => { const n = new Set(m); if (n.has(r.sku)) n.delete(r.sku); else n.add(r.sku); return n; })}>
                  <td className="l ast-brand">{r.brand || '—'}</td>
                  <td className="l ast-cat">{r.cat || '—'}</td>
                  <td className="l ast-sku">{r.sku}</td>
                  <td className="l ast-name">{r.name}</td>
                  <td className={'ast-num ' + (r.qty > 0 ? 'ast-qty' : 'ast-zero')}>{num(r.qty)}</td>
                  <td className="ast-num">{r.price === null || r.price === undefined ? '—' : num(r.price)}</td>
                  {shops.map((s, i) => (
                    r.on?.[i]
                      ? <td key={`${s.platform}:${s.shop}`} className="ast-y" data-plat={s.platform}>Y</td>
                      : <td key={`${s.platform}:${s.shop}`} className="ast-na">N/A</td>
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
