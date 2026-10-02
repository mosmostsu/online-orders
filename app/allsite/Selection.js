'use client';
// เลือกแถวในตาราง ALL SITE แล้วเปิดดูในแท็บใหม่ — แบบ ../allsitepd (openSelectedInTab)
//
// ที่เลือกจำไว้แค่ในหน้านี้ (หน่วยความจำ) — เปลี่ยนหน้า/เปลี่ยนตัวกรองยังอยู่ แต่เข้าใหม่/รีเฟรชเริ่มว่าง
// (เคยเก็บใน localStorage แล้วค้างข้ามวัน เข้ามาใหม่ยังติ๊กของเก่าอยู่) อยากเก็บไว้ทำต่อ → บันทึกรายงาน
// ตอนกด "เปิดในแท็บใหม่" ส่งรายการผ่าน localStorage (HANDOFF) ให้หน้า /allsite/report อ่าน
import { useEffect, useRef, useSyncExternalStore } from 'react';

export const HANDOFF = 'allsite:handoff';
let current = new Set();
let pending = 0;          // กำลังเลือกทั้งหมดกี่รายการ (0 = ไม่ได้รอ)
let version = 0;
const listeners = new Set();

function emit() { version++; listeners.forEach((l) => l()); }
function subscribe(l) { listeners.add(l); return () => listeners.delete(l); }

export function useSelection() {
  useSyncExternalStore(subscribe, () => version, () => -1);
  return current;
}
export function usePending() {
  useSyncExternalStore(subscribe, () => version, () => -1);
  return pending;
}
export const selection = {
  get: () => current,
  add: (skus) => { current = new Set([...current, ...skus]); emit(); },
  remove: (skus) => { const s = new Set(current); skus.forEach((k) => s.delete(k)); current = s; emit(); },
  clear: () => { current = new Set(); emit(); },
  setPending: (n) => { pending = n; emit(); },
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
// query = ตัวกรองปัจจุบัน ส่งให้ /api/allsite/skus ไล่เอารหัสทั้งหมด (~1.5 วินาที เซิร์ฟเวอร์อยู่อเมริกา)
// ระหว่างรอ แถบด้านบนขึ้น "กำลังเลือกทั้งหมด n รายการ…" แล้วค่อยใส่ทีเดียว — ไม่ติ๊กหน้านี้ก่อน
// (เคยติ๊กหน้านี้ก่อน ตัวเลขเลยขึ้น 50 แวบหนึ่งแล้วค่อยเด้งเป็นจำนวนจริง ดูเหมือนเลือกผิด)
export function PageCheck({ skus, query, total }) {
  const sel = useSelection();
  const busy = usePending() > 0;
  const all = skus.length > 0 && skus.every((k) => sel.has(k));

  async function toggle() {
    selection.setPending(Number(total) || 1);
    try {
      const res = await fetch(`/api/allsite/skus?${query}`);
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      if (all) selection.remove(j.skus); else selection.add(j.skus);
      if (!all && j.capped) alert(`เลือกได้ไม่เกิน ${j.skus.length.toLocaleString('en-US')} รายการต่อครั้ง — กรองให้แคบลงก่อนถ้าต้องการทั้งหมด`);
    } catch (e) {
      alert(e.message);
    } finally {
      selection.setPending(0);
    }
  }

  return (
    <input type="checkbox" className="ast-cb" checked={all} disabled={busy || !total}
      title={`เลือกทั้งหมดที่กรองไว้ (${Number(total || 0).toLocaleString('en-US')})`} onChange={toggle} />
  );
}

// แถบ "เลือกแล้ว N รายการ · เปิดในแท็บใหม่ · ล้าง"
export function SelectionBar() {
  const sel = useSelection();
  const pending = usePending();
  const n = sel.size;
  if (pending) {
    return <div className="ast-selbar"><b className="ast-selcount">⏳ กำลังเลือกทั้งหมด {pending.toLocaleString('en-US')} รายการ…</b></div>;
  }
  if (!n) return <div className="ast-selbar sku">ติ๊กหน้าแถวเพื่อเลือก · ติ๊กช่องบนสุดของตาราง = เลือกทั้งหมดที่กรองไว้</div>;
  function openReport() {
    try { localStorage.setItem(HANDOFF, JSON.stringify([...sel])); } catch { /* โหมดส่วนตัว */ }
    window.open('/allsite/report', '_blank');
  }
  return (
    <div className="ast-selbar">
      <b className="ast-selcount">เลือกแล้ว {n.toLocaleString('en-US')} รายการ</b>
      <button type="button" className="btn ast-open" onClick={openReport}>↗ เปิดในแท็บใหม่</button>
      <button type="button" className="chip" onClick={() => selection.clear()}>ล้างที่เลือก</button>
    </div>
  );
}
