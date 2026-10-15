'use client';
// กลุ่ม SOLID ในหน้า /compare — TikTok SOLID เป็นหลัก: ติ๊กตะกร้าหน้าแถว แล้วค่อยเลือกว่าจะโคลนไปร้านไหน
//
// ติ๊กได้เฉพาะแถวที่ TikTok SOLID มีตะกร้าเดียว และมีร้านปลายทางอย่างน้อยหนึ่งร้านที่ "ไม่พบ" (page.js เป็นคนตัดสิน)
// ที่เลือกจำไว้ในหน้านี้ (หน่วยความจำ) ข้ามหน้า/เปลี่ยนตัวกรองได้ — รีเฟรชแล้วเริ่มว่าง
// ปุ่มปลายทางเปิดแผงโคลนเดิม (CloneAcross / ThaimartExport) โดยกรองเหลือเฉพาะที่ติ๊ก · ไม่ติ๊กเลย = เห็นทุกตะกร้าที่ยังไม่มี
// เซิร์ฟเวอร์ตรวจซ้ำทุกครั้งก่อนสร้าง: ร้านปลายทางมี SKU ไหนของตะกร้านั้นแล้ว → ไม่สร้าง (ไม่แตะตะกร้าเดิม)
import { useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import CloneAcross from './CloneAcross';
import ThaimartExport from './ThaimartExport';
import CloneMenu, { CloneMenuRow } from './CloneMenu';

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
const drop = (id) => set([...current].filter((x) => x !== String(id)));

export function SolidCheck({ pid }) {
  const sel = useSel();
  const on = sel.has(pid);
  return (
    <input type="checkbox" className="cmp-clcb" checked={on} title="เลือกตะกร้า TikTok SOLID นี้ไว้โคลนไปร้านอื่น"
      onClick={(e) => e.stopPropagation()}
      onChange={() => set(on ? [...current].filter((x) => x !== pid) : [...current, pid])} />
  );
}

// dests: ['shopee', 'lazada', 'thaimart'] ตามร้านที่เลือกไว้ในกลุ่ม · shopeeToTiktok: มีทั้ง Shopee SOLID และ TikTok SOLID
export function SolidBar({ pagePids, dests, shopeeToTiktok = false }) {
  const sel = useSel();
  const router = useRouter();
  const ids = [...sel];
  const pick = ids.length ? ids : null;
  return (
    <CloneMenu count={ids.length}>
      <CloneMenuRow label="ติ๊กตะกร้า TikTok หน้าแถว:">
        <button type="button" className="chip" disabled={!pagePids.length}
          onClick={() => set([...new Set([...current, ...pagePids])])}>ติ๊กทั้งหน้า ({pagePids.length})</button>
        <button type="button" className="chip" disabled={!ids.length} onClick={() => set([])}>ล้างที่เลือก</button>
        <b className="cmp-clcount">{ids.length ? `เลือกแล้ว ${ids.length} ตะกร้า` : 'ไม่ติ๊ก = ดูทุกตะกร้าที่ยังไม่มี'}</b>
      </CloneMenuRow>
      <CloneMenuRow label="ไปแพลตฟอร์มอื่น · จาก TikTok SOLID →">
        {dests.includes('shopee') && <CloneAcross shop="SOLID" src="tiktok" dest="shopee" ids={pick} onCloned={drop} onClose={() => router.refresh()} />}
        {dests.includes('lazada') && <CloneAcross shop="SOLID" src="tiktok" dest="lazada" ids={pick} onCloned={drop} onClose={() => router.refresh()} />}
        {dests.includes('thaimart') && <ThaimartExport ids={pick} />}
      </CloneMenuRow>
      {shopeeToTiktok && (
        <CloneMenuRow label="ไปแพลตฟอร์มอื่น · จาก Shopee SOLID →">
          <CloneAcross shop="SOLID" src="shopee" dest="tiktok" />
        </CloneMenuRow>
      )}
      {shopeeToTiktok && (
        <CloneMenuRow label="ไปร้านอื่น (แพลตฟอร์มเดียวกัน) · จาก Shopee SOLID →">
          <CloneAcross shop="REAL" srcShop="SOLID" src="shopee" dest="shopee" onClose={() => router.refresh()} />
        </CloneMenuRow>
      )}
    </CloneMenu>
  );
}
