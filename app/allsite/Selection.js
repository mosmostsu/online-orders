'use client';
// เลือกแถวในตาราง ALL SITE แล้วเปิดดูในแท็บใหม่ — แบบ ../allsitepd (openSelectedInTab)
// ที่เลือกเก็บใน localStorage ของเครื่องนี้ จำข้ามหน้า/ข้ามแท็บ หน้า /allsite/report อ่านจากที่เดียวกัน
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const KEY = 'allsite:selected';
let cache = null;
let version = 0;
const listeners = new Set();

function read() {
  if (cache) return cache;
  try { cache = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { cache = new Set(); }
  return cache;
}
function write(set) {
  cache = new Set(set);
  version++;
  try { localStorage.setItem(KEY, JSON.stringify([...cache])); } catch { /* โหมดส่วนตัว — จำได้แค่ในหน้านี้ */ }
  listeners.forEach((l) => l());
}
function subscribe(l) {
  listeners.add(l);
  // อีกแท็บแก้ที่เลือก (เช่นกดล้างในหน้า report) — อ่านใหม่
  const onStorage = (e) => { if (e.key === KEY) { cache = null; version++; l(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(l); window.removeEventListener('storage', onStorage); };
}
const EMPTY = new Set();
export function useSelection() {
  // ตอนเรนเดอร์ฝั่งเซิร์ฟเวอร์/hydrate ได้ -1 = ยังไม่อ่าน localStorage (ไม่งั้นช่องติ๊กไม่ตรงกับ HTML ที่ส่งมา)
  const v = useSyncExternalStore(subscribe, () => version, () => -1);
  return v === -1 ? EMPTY : read();
}
export const selection = {
  get: () => read(),
  set: write,
  add: (skus) => write([...read(), ...skus]),
  remove: (skus) => { const s = new Set(read()); skus.forEach((k) => s.delete(k)); write(s); },
  clear: () => write([]),
};

// ช่องติ๊กของแถว — ติ๊กแล้วแถวเป็นสีเหลืองแบบ allsitepd
export function RowCheck({ sku }) {
  const sel = useSelection();
  const ref = useRef(null);
  const on = sel.has(sku);
  useEffect(() => { ref.current?.closest('tr')?.classList.toggle('ast-sel', on); }, [on]);
  return (
    <input ref={ref} type="checkbox" className="ast-cb" checked={on}
      onChange={() => (on ? selection.remove([sku]) : selection.add([sku]))} />
  );
}

// ช่องติ๊กหัวตาราง — เลือก/เอาออก "ทั้งหมดที่กรองไว้" แบบ allsitepd (ไม่ใช่แค่หน้านี้)
// ติ๊กแล้ว = ทุกแถวในหน้านี้ถูกเลือก · query = ตัวกรองปัจจุบัน ส่งให้ /api/allsite/skus ไล่เอารหัสทั้งหมด
export function PageCheck({ skus, query, total }) {
  const sel = useSelection();
  const [busy, setBusy] = useState(false);
  const all = skus.length > 0 && skus.every((k) => sel.has(k));

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/allsite/skus?${query}`);
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      if (all) selection.remove(j.skus); else selection.add(j.skus);
      if (!all && j.capped) alert(`เลือกได้ไม่เกิน ${j.skus.length.toLocaleString('en-US')} รายการต่อครั้ง — กรองให้แคบลงก่อนถ้าต้องการทั้งหมด`);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <input type="checkbox" className="ast-cb" checked={all} disabled={busy || !total}
      title={`เลือกทั้งหมดที่กรองไว้ (${Number(total || 0).toLocaleString('en-US')})`} onChange={toggle} />
  );
}

// แถบ "เลือกแล้ว N รายการ · เปิดในแท็บใหม่ · ล้าง" — โผล่เมื่อเลือกอย่างน้อย 1 แถว
export function SelectionBar() {
  const sel = useSelection();
  const n = sel.size;
  if (!n) return <div className="ast-selbar sku">ติ๊กหน้าแถวเพื่อเลือก · ติ๊กช่องบนสุดของตาราง = เลือกทั้งหมดที่กรองไว้</div>;
  return (
    <div className="ast-selbar">
      <b className="ast-selcount">เลือกแล้ว {n.toLocaleString('en-US')} รายการ</b>
      <button type="button" className="btn ast-open" onClick={() => window.open('/allsite/report', '_blank')}>↗ เปิดในแท็บใหม่</button>
      <button type="button" className="chip" onClick={() => selection.clear()}>ล้างที่เลือก</button>
    </div>
  );
}
