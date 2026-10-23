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
import CloneThisShop from './CloneThisShop';

const SHORT = { shopee: 'SHO', tiktok: 'TIK', thisshop: 'THIS', lazada: 'LAZ', thaimart: 'THM' };
const HIDE_SHOPS = 'allsite-report-hidden-shops';   // ร้านที่ซ่อนคอลัมน์ไว้ (จำในเครื่องนี้)
const shopKey = (s) => `${s.platform}:${s.shop}`;
const groupOf = (s) => (s.platform === 'thisshop' ? 'REAL' : String(s.shop).toUpperCase());
const colLabel = (s) => `${SHORT[s.platform] || s.platform.toUpperCase()} ${groupOf(s)}`;
const num = (n) => Number(n || 0).toLocaleString('en-US');
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
// ไซส์ = ส่วนท้ายชื่อที่ตัดออกตอนทำรุ่น+สี ("... สีขาว - xl" → "XL") · พิมพ์ใหญ่เสมอ
// ไม่มีส่วนท้าย (สินค้าไซส์เดียว) / ไม่มี group_name = '' → โชว์ "ไซส์เดียว" ไม่โชว์รหัส SKU ซ้ำ
const sizeOf = (r) => {
  if (!r.group_name) return '';
  return String(r.name || '').slice(String(r.group_name).length).replace(/^\s*-\s*/, '').trim().toUpperCase();
};
const ONE_SIZE = 'ไซส์เดียว';
// รับเข้าล่าสุด (R04.201) — 'YYYY-MM-DD' → "ต.ค. 69"
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const monLabel = (d) => (d ? `${TH_MON[Number(d.slice(5, 7)) - 1]} ${(Number(d.slice(0, 4)) + 543) % 100}` : '');
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
// ตัวกรองรับเข้า: '' ทุกช่วง · ตัวเลข = รับเข้าภายใน n เดือน (ไม่รับเข้าเกินนั้น = รุ่นเก่า ป้าย "เก่า")
// ข้อมูล R04 เริ่ม ม.ค. 68 (~22 เดือน) — ตอนนี้ 24 เดือน = มีเอกสารรับอย่างน้อยใบเดียว
const OLD_MONTHS = 24;
const AGES = [['', 'รับเข้า: ทุกช่วง'], [String(OLD_MONTHS), `รับเข้าภายใน ${OLD_MONTHS} เดือน`]];
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

export default function Report({ id = '', sh = [] }) {
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
  const [age, setAge] = useState('');            // ตัวกรองรับเข้าล่าสุด (AGES)
  const [sort, setSort] = useState({ key: '', dir: 'asc' });
  const [mark, setMark] = useState(new Set());   // แถวที่ติ๊กทำแล้ว (รายงานที่บันทึก = ของทุกคน)
  const [open, setOpen] = useState('');          // ช่องร้านที่กดดูว่าขาดไซส์ไหน (แถว|ร้าน)
  const [hiddenShops, setHiddenShops] = useState(() => new Set());   // คอลัมน์ร้านที่ซ่อน (platform:shop)
  useEffect(() => {
    try { setHiddenShops(new Set(JSON.parse(localStorage.getItem(HIDE_SHOPS) || '[]'))); } catch { /* */ }
  }, []);
  const [menu, setMenu] = useState(false);       // เมนู ⋯ (ล้าง/ลบ — ของที่ย้อนไม่ได้อยู่ในนี้)
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

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
  // คอลัมน์ร้านที่โชว์ — i ยังเป็นลำดับเดิมใน shops (per / on / yn อ้างตามนี้)
  const visShops = shops.map((s, i) => ({ s, i })).filter(({ s }) => !hiddenShops.has(shopKey(s)));
  function saveHidden(next) {
    setHiddenShops(next);
    try { localStorage.setItem(HIDE_SHOPS, JSON.stringify([...next])); } catch { /* */ }
  }
  // เปิดมาจากหน้า ALL SITE พร้อม ?sh= → ซ่อนร้านที่ไม่ได้เลือกไว้ที่นั่น (ครั้งเดียวตอนรู้รายชื่อร้าน)
  // จำลงเครื่องด้วย บันทึกรายงานแล้วเปิดลิงก์ ?id= ก็ยังเห็นชุดเดิม
  const shKey = sh.join(',');
  const [shApplied, setShApplied] = useState(false);
  useEffect(() => {
    if (shApplied || !shKey || !shops.length) return;
    const want = new Set(shKey.split(','));
    if (shops.some((s) => want.has(shopKey(s)))) saveHidden(new Set(shops.map(shopKey).filter((k) => !want.has(k))));
    setShApplied(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shKey, shops.length, shApplied]);
  function toggleShop(s, i) {
    const k = shopKey(s);
    const next = new Set(hiddenShops);
    if (next.has(k)) next.delete(k);
    else {
      next.add(k);
      // ซ่อนแล้วตัวกรอง/การเรียงของร้านนั้นต้องหลุดไปด้วย ไม่งั้นแถวหายโดยไม่เห็นสาเหตุ
      setYn((o) => { const n = { ...o }; delete n[i]; return n; });
      setSort((o) => (o.key === `s:${i}` ? { key: '', dir: 'asc' } : o));
    }
    saveHidden(next);
  }
  // ปุ่มโคลนไป ThisShop ต้องมีทั้ง Shopee REAL (ต้นทาง) และ ThisShop (ปลายทาง) อยู่ในระบบ
  const canClone = skus.length > 0
    && shops.some((s) => s.platform === 'thisshop')
    && shops.some((s) => s.platform === 'shopee' && String(s.shop).toUpperCase() === 'REAL');

  // แถวที่จะโชว์ — รวมสี: รวมไซส์ของรุ่น+สีเดียวกันเป็นแถวเดียว
  const base = useMemo(() => {
    const kept = items.filter((x) => !hide || x.qty > 0);
    if (mode === 'size') {
      return kept.map((x) => ({ ...x, id: x.sku, label: x.name, code: x.sku, n: 1, per: shops.map((_, i) => (x.on?.[i] ? 1 : 0)), sizes: [] }));
    }
    const g = new Map();
    for (const x of kept) {
      const k = x.group_name || x.sku;
      if (!g.has(k)) g.set(k, { id: k, label: k, brand: x.brand, cat: x.cat, price: x.price, qty: 0, n: 0, per: shops.map(() => 0), sizes: [], codes: [], recv: null });
      const r = g.get(k);
      r.qty += x.qty;
      if (x.recv && !(r.recv >= x.recv)) r.recv = x.recv;   // รุ่น+สี = ไซส์ที่รับเข้าล่าสุด
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

  const recvFrom = data?.recv_from || null;   // null = โหลดข้อมูลรับเข้าไม่ได้ → ไม่โชว์คอลัมน์/ตัวกรอง
  const oldCut = monthsAgo(OLD_MONTHS);
  const isOld = (x) => !x.recv || x.recv < oldCut;

  const rows = useMemo(() => {
    // กรองร้าน: Y = ลงครบ · N = ไม่ครบ (รวมสี) หรือยังไม่ลง (แยกไซส์)
    const cut = age ? monthsAgo(Number(age)) : '';
    let r = base.filter((x) => (!f.brand || x.brand === f.brand) && (!f.cat || x.cat === f.cat) && (!f.key || x.id === f.key)
      && Object.entries(yn).every(([i, v]) => (v === 'Y') === (x.per[Number(i)] === x.n))
      && (!age || (Boolean(x.recv) && x.recv >= cut)));
    const val = (x) => {
      if (sort.key.startsWith('s:')) return x.per[Number(sort.key.slice(2))] / x.n;
      return { brand: x.brand, cat: x.cat, code: x.code, label: x.label, qty: x.qty, price: x.price, recv: x.recv || '' }[sort.key] ?? '';
    };
    r = [...r].sort((a, b) => {
      if (!sort.key) return String(a.brand).localeCompare(String(b.brand)) || String(a.cat).localeCompare(String(b.cat)) || String(a.code).localeCompare(String(b.code));
      const A = val(a), B = val(b);
      const c = typeof A === 'number' && typeof B === 'number' ? A - B : String(A).localeCompare(String(B));
      return sort.dir === 'asc' ? c : -c;
    });
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, f, yn, sort, age]);
  const recvText = (x) => (x.recv ? monLabel(x.recv) : `ก่อน ${monLabel(recvFrom)}`);

  const th = (k, label) => (
    <span className="tlink" onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'asc' ? 'desc' : 'asc' }))}>
      {label} <span className="tsort" data-on={sort.key === k ? '1' : '0'}>{sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '▲▼'}</span>
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
    const rh = recvFrom ? ['รับเข้าล่าสุด'] : [];
    const head = mode === 'color'
      ? ['แบรนด์', 'หมวดหมู่', 'รุ่น + สี', 'ไซส์', 'สต็อกรวม', 'ราคา', ...rh, ...visShops.map(({ s }) => colLabel(s))]
      : ['แบรนด์', 'หมวดหมู่', 'SKU', 'ชื่อสินค้า', 'สต็อก', 'ราคา', ...rh, ...visShops.map(({ s }) => colLabel(s))];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rc = (r) => (recvFrom ? [r.recv || `ก่อน ${recvFrom}`] : []);
    const body = rows.map((r) => (mode === 'color'
      ? [r.brand, r.cat, r.label, r.sizes.map((s) => s.size || ONE_SIZE).join(' '), r.qty, r.price ?? '', ...rc(r), ...visShops.map(({ i }) => shopCell(r, i))]
      : [r.brand, r.cat, r.code, r.label, r.qty, r.price ?? '', ...rc(r), ...visShops.map(({ i }) => shopCell(r, i))]));
    const lines = [head, ...body].map((l) => l.map(esc).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `allsite-selection-${mode === 'color' ? 'รวมสี' : 'แยกไซส์'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const done = rows.filter((r) => mark.has(r.id)).length;
  const filtered = Boolean(f.brand || f.cat || f.key || hide || age || sort.key || Object.keys(yn).length);
  function clearFilters() { setF({ brand: '', cat: '', key: '' }); setYn({}); setHide(false); setAge(''); setSort({ key: '', dir: 'asc' }); }
  function clearLocal() {
    if (!confirm('ล้างรายการที่เลือกทั้งหมด?')) return;
    try { localStorage.removeItem(HANDOFF); } catch { /* */ }
    setLocalSkus([]);
  }

  // หัวหน้า: ชื่อ + ความคืบหน้า (ซ้าย) · เลือกรายงาน/รีเฟรช (ขวา)
  // แถบเครื่องมือ: มุมมอง | ทำงาน (บันทึก/โคลน/Excel) | ⋯ (ล้าง/ลบ — ย้อนไม่ได้ เลยซ่อนไว้ในเมนู)
  return (
    <div className="ast ast-report">
      <div className="ast-top">
        <div>
          <b className="ast-title">{id ? `📋 ${report?.name || 'รายงาน'}` : '📊 REPORT SELECTION'}</b>
          <div className="ast-progress">
            <b className="ast-donecount" data-all={rows.length > 0 && done === rows.length ? '1' : '0'}>ทำแล้ว {num(done)} / {num(rows.length)}</b>
            <span className="sku">
              {num(skus.length)} SKU · แสดง {num(rows.length)} {mode === 'color' ? 'รุ่น+สี' : 'SKU'}
              {' · '}{id ? 'ติ๊กหน้าแถวเมื่อทำแล้ว (ทุกคนเห็น)' : 'ติ๊กหน้าแถวเมื่อทำแล้ว · บันทึกรายงานเพื่อให้คนอื่นเห็น'}
              {id && report?.updated_at && <> · แก้ล่าสุด {new Date(report.updated_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>}
            </span>
          </div>
        </div>
        <div className="ast-ctl">
          <select className="aselect" value={id} onChange={(e) => { window.location.href = e.target.value ? `/allsite/report?id=${e.target.value}` : '/allsite/report'; }}>
            <option value="">— ที่เลือกในเครื่องนี้ —</option>
            {saved.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.done}/{r.skus})</option>)}
            {id && !saved.some((r) => r.id === id) && <option value={id}>{report?.name || 'รายงานนี้'}</option>}
          </select>
          <button type="button" className="chip" onClick={refresh} title="ดึงสต็อก Y/N และติ๊กของทุกคนล่าสุด">🔄 รีเฟรช</button>
        </div>
      </div>

      <div className="ast-bar">
        <span className="ast-grp">
          <span className="ast-grp-h">มุมมอง</span>
          {[['color', 'รวมสี'], ['size', 'แยกไซส์']].map(([k, label]) => (
            <button key={k} type="button" className="chip" data-on={mode === k ? '1' : '0'}
              onClick={() => { setMode(k); setF((o) => ({ ...o, key: '' })); setSort({ key: '', dir: 'asc' }); }}>{label}</button>
          ))}
          <button type="button" className="chip" data-on={hide ? '1' : '0'} onClick={() => setHide((v) => !v)}
            title="ซ่อนแถวที่สต็อกเป็น 0">ซ่อนของหมด</button>
          {recvFrom && (
            <select className="aselect ast-age" value={age} data-on={age ? '1' : '0'} onChange={(e) => setAge(e.target.value)}
              title={`จากเอกสารรับ R04.201 (มีข้อมูลตั้งแต่ ${monLabel(recvFrom)})`}>
              {AGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          )}
          {filtered && <button type="button" className="ast-clear" onClick={clearFilters}>✕ ล้างตัวกรอง</button>}
        </span>
        <span className="ast-grp">
          {!id && skus.length > 0 && <button type="button" className="btn ast-save" onClick={saveReport}>💾 บันทึกรายงาน</button>}
          {id && <button type="button" className="btn ast-save" onClick={copyLink}>🔗 คัดลอกลิงก์</button>}
          {canClone && <CloneThisShop skus={skus} />}
          <button type="button" className="btn" onClick={downloadCsv} disabled={!rows.length}>⬇ Excel</button>
          {(id || skus.length > 0) && (
            <span className="ast-more">
              <button type="button" className="chip" aria-label="เมนูเพิ่มเติม" onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}>⋯</button>
              {menu && (
                <div className="ast-menu">
                  {!id && <button type="button" className="danger" onClick={clearLocal}>ล้างรายการที่เลือกทั้งหมด</button>}
                  {id && <button type="button" className="danger" onClick={deleteReport}>🗑 ลบรายงานนี้</button>}
                </div>
              )}
            </span>
          )}
        </span>
      </div>

      {shops.length > 0 && (
        <div className="ast-shops">
          <span className="sku">ร้านที่โชว์ (กดเพื่อซ่อน/โชว์):</span>
          {shops.map((s, i) => (
            <button key={shopKey(s)} type="button" className="chip" data-plat={s.platform}
              data-on={hiddenShops.has(shopKey(s)) ? '0' : '1'} onClick={() => toggleShop(s, i)}>{colLabel(s)}</button>
          ))}
          {visShops.length < shops.length && (
            <button type="button" className="chip ast-shops-all" onClick={() => saveHidden(new Set())}>
              โชว์ทั้งหมด (ซ่อนอยู่ {shops.length - visShops.length})
            </button>
          )}
        </div>
      )}

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
                <th className="ast-donecol" title="ทำแล้ว">✓</th>
                {/* แบรนด์/หมวด/SKU ย้ายมาเป็นบรรทัดรองใต้ชื่อ — ตัวกรองอยู่ในหัวคอลัมน์ชื่อ (คอลัมน์ที่ตรึงไว้) */}
                <th className="l ast-namecol">{th('label', mode === 'color' ? 'รุ่น + สี' : 'ชื่อสินค้า')}
                  <span className="ast-hsels">
                    <select className="ast-hsel" value={f.brand} data-on={f.brand ? '1' : '0'} onChange={(e) => setF({ ...f, brand: e.target.value })}>
                      <option value="">แบรนด์: ทั้งหมด</option>{uniq(base.map((x) => x.brand)).map((v) => <option key={v}>{v}</option>)}
                    </select>
                    <select className="ast-hsel" value={f.cat} data-on={f.cat ? '1' : '0'} onChange={(e) => setF({ ...f, cat: e.target.value })}>
                      <option value="">หมวด: ทั้งหมด</option>{uniq(base.map((x) => x.cat)).map((v) => <option key={v}>{v}</option>)}
                    </select>
                    {mode === 'size' && (
                      <select className="ast-hsel" value={f.key} data-on={f.key ? '1' : '0'} onChange={(e) => setF({ ...f, key: e.target.value })}>
                        <option value="">SKU: ทั้งหมด</option>{uniq(base.map((x) => x.id)).map((v) => <option key={v}>{v}</option>)}
                      </select>
                    )}
                  </span>
                </th>
                {mode === 'color' && <th className="l">ไซส์</th>}
                <th className="ast-num">{th('qty', mode === 'color' ? 'สต็อกรวม' : 'สต็อก')}</th>
                <th className="ast-num">{th('price', 'ราคา')}</th>
                {recvFrom && <th className="ast-num" title="เอกสารรับ R04.201 ครั้งล่าสุด">{th('recv', 'รับเข้าล่าสุด')}</th>}
                {visShops.map(({ s, i }) => (
                  <th key={`${s.platform}:${s.shop}`} className="ast-shop" data-plat={s.platform}>
                    {th(`s:${i}`, colLabel(s))}
                    <select className="ast-hsel" value={yn[i] || ''} data-on={yn[i] ? '1' : '0'}
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
                  <td className="ast-donecol">
                    <input type="checkbox" className="ast-cb" checked={mark.has(r.id)} aria-label="ทำแล้ว"
                      onClick={(e) => e.stopPropagation()} onChange={() => toggleMark(r.id)} />
                  </td>
                  <td className="l ast-name ast-namecol">
                    <div>{r.label}</div>
                    <div className="ast-sub">
                      {mode === 'size' && <b className="ast-sku">{r.code}</b>}
                      {[r.brand, r.cat].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  {mode === 'color' && (
                    <td className="l ast-sizes">
                      {r.sizes.map((s) => (
                        <span key={s.sku} className={s.qty > 0 ? 'ast-size-on' : 'ast-size-off'} title={`${s.sku} · คงเหลือ ${s.qty}`}>{s.size || ONE_SIZE}</span>
                      ))}
                    </td>
                  )}
                  <td className={'ast-num ' + (r.qty > 0 ? 'ast-qty' : 'ast-zero')}>{num(r.qty)}</td>
                  <td className="ast-num">{r.price === null || r.price === undefined ? '—' : num(r.price)}</td>
                  {recvFrom && (
                    <td className={'ast-num ast-recv' + (isOld(r) ? ' old' : '')} title={r.recv ? `รับเข้า ${r.recv}` : `ไม่มีเอกสารรับตั้งแต่ ${recvFrom}`}>
                      {recvText(r)}{isOld(r) && <span className="ast-oldtag">เก่า</span>}
                    </td>
                  )}
                  {visShops.map(({ s, i }) => (
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
