'use client';
// เลือกตะกร้า Shopee REAL ที่จะโคลนไป ThisShop ในหน้า /compare
//
// ติ๊กได้เฉพาะแถวที่ ThisShop "ไม่พบ" และ Shopee REAL มีตะกร้าเดียว (หน้า page.js เป็นคนตัดสิน)
// ที่เลือกจำไว้ในหน้านี้ (หน่วยความจำ) ข้ามหน้า/เปลี่ยนตัวกรองได้ — รีเฟรชแล้วเริ่มว่าง
// กดปุ่มโคลน → แผงจับคู่หมวด/แบรนด์ + สั่งโคลน (app/allsite/report/CloneThisShop.js) ซึ่งเช็คซ้ำกับฐานข้อมูลอีกชั้น
import { useSyncExternalStore } from 'react';
import CloneThisShop from '../allsite/report/CloneThisShop';

let current = new Set();
let version = 0;
const listeners = new Set();
const emit = () => { version += 1; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
function useSel() {
  useSyncExternalStore(subscribe, () => version, () => -1);
  return current;
}
const set = (ids) => { current = new Set(ids); emit(); };

export function CloneCheck({ pid }) {
  const sel = useSel();
  const on = sel.has(pid);
  return (
    <input type="checkbox" className="cmp-clcb" checked={on} title="เลือกโคลนไป ThisShop"
      onClick={(e) => e.stopPropagation()}
      onChange={() => set(on ? [...current].filter((x) => x !== pid) : [...current, pid])} />
  );
}

export function CloneBar({ pagePids }) {
  const sel = useSel();
  const ids = [...sel];
  return (
    <div className="cmp-clbar">
      <span className="sku">โคลนไป ThisShop:</span>
      <button type="button" className="chip" disabled={!pagePids.length}
        onClick={() => set([...new Set([...current, ...pagePids])])}>ติ๊กทั้งหน้า ({pagePids.length})</button>
      <button type="button" className="chip" disabled={!ids.length} onClick={() => set([])}>ล้างที่เลือก</button>
      <b className="cmp-clcount">เลือกแล้ว {ids.length} ตะกร้า</b>
      {ids.length > 0 && <CloneThisShop productIds={ids} label={`🧬 โคลน ${ids.length} ตะกร้าไป ThisShop`} />}
    </div>
  );
}
