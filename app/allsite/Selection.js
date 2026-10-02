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

// ช่องติ๊กหัวตาราง — เลือก/เอาออกทั้งหน้านี้
export function PageCheck({ skus }) {
  const sel = useSelection();
  const all = skus.length > 0 && skus.every((k) => sel.has(k));
  return (
    <input type="checkbox" className="ast-cb" checked={all} title="เลือกทั้งหน้านี้"
      onChange={() => (all ? selection.remove(skus) : selection.add(skus))} />
  );
}

// แถบ "เลือกแล้ว N รายการ · เปิดในแท็บใหม่ · ล้าง" + เลือกทั้งหมดที่กรองไว้
// query = ตัวกรองปัจจุบันของตาราง ส่งให้ /api/allsite/skus ไล่เอารหัสทั้งหมดที่ตรงเงื่อนไข
export function SelectionBar({ total, query }) {
  const sel = useSelection();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const n = sel.size;

  async function selectAllFiltered() {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/allsite/skus?${query}`);
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      selection.add(j.skus);
      if (j.capped) setMsg(`เลือกได้ไม่เกิน ${j.skus.length.toLocaleString('en-US')} รายการต่อครั้ง`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ast-selbar">
      <button type="button" className="chip" onClick={selectAllFiltered} disabled={busy || !total}>
        {busy ? 'กำลังเลือก...' : `☑ เลือกทั้งหมดที่กรองไว้ (${Number(total || 0).toLocaleString('en-US')})`}
      </button>
      {n > 0 && (
        <>
          <b className="ast-selcount">เลือกแล้ว {n.toLocaleString('en-US')} รายการ</b>
          <button type="button" className="btn ast-open" onClick={() => window.open('/allsite/report', '_blank')}>↗ เปิดในแท็บใหม่</button>
          <button type="button" className="chip" onClick={() => selection.clear()}>ล้างที่เลือก</button>
        </>
      )}
      {msg && <span className="sku">{msg}</span>}
    </div>
  );
}
