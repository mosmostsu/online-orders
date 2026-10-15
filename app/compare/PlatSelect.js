'use client';
// มุมมองแพลตฟอร์มของหน้า /compare (?v=platform) แท็บ Shopee — ติ๊กตะกร้าหน้าแถวแล้วโคลนข้ามร้าน (Shopee SOLID ↔ REAL)
//
// ติ๊กได้เฉพาะแถวที่ร้านหนึ่งมีตะกร้าเดียว และอีกร้าน "ไม่พบ" (page.js เป็นคนตัดสินทิศทางให้แต่ละแถว)
// ที่เลือกจำไว้ในหน้านี้ (หน่วยความจำ) ข้ามหน้าได้ — กดโคลนแล้วเปิดแผงโคลนเดิม (CloneAcross) กรองเฉพาะที่ติ๊ก แยกตามทิศทาง
// เซิร์ฟเวอร์ตรวจซ้ำทุกครั้งก่อนสร้าง (SKU + ชื่อ) ไม่แตะตะกร้าเดิม — ดู lib/cloneShopeeShop.js
import { useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import CloneAcross from './CloneAcross';
import CloneMenu, { CloneMenuRow } from './CloneMenu';

let current = new Map();   // pid ต้นทาง → ร้านปลายทาง
let version = 0;
const listeners = new Set();
const emit = () => { version += 1; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
function useSel() {
  useSyncExternalStore(subscribe, () => version, () => -1);
  return current;
}
const set = (m) => { current = new Map(m); emit(); };
const drop = (id) => { const m = new Map(current); m.delete(String(id)); set(m); };

export function PlatCheck({ pid, dst, label = `Shopee ${dst}` }) {
  const sel = useSel();
  const on = sel.has(pid);
  return (
    <input type="checkbox" className="cmp-clcb" checked={on} title={`เลือกโคลนไป ${label}`}
      onClick={(e) => e.stopPropagation()}
      onChange={() => { const m = new Map(current); if (on) m.delete(pid); else m.set(pid, dst); set(m); }} />
  );
}

// แท็บ TikTok SOLID ⇄ Shopee REAL (X:main): ติ๊กตะกร้า Shopee REAL ที่ TikTok SOLID "ไม่พบ" → โคลนไป TikTok SOLID (dst = 'TT')
// หมวด/แบรนด์/แอตทริบิวต์ ใช้แผนที่ Shopee → TikTok SOLID (lib/cloneTiktok.js) · เลือก/แก้รูปก่อนโคลนได้
export function MainBar({ pagePairs }) {
  const sel = useSel();
  const router = useRouter();
  const ids = [...sel].filter(([, d]) => d === 'TT').map(([pid]) => pid);
  return (
    <CloneMenu count={ids.length}>
      <CloneMenuRow label="ติ๊กตะกร้าหน้าแถว (Shopee REAL มี · TikTok SOLID ไม่พบ):">
        <button type="button" className="chip" disabled={!pagePairs.length}
          onClick={() => { const m = new Map(current); for (const p of pagePairs) m.set(p.pid, p.dst); set(m); }}>ติ๊กทั้งหน้า ({pagePairs.length})</button>
        <button type="button" className="chip" disabled={!ids.length} onClick={() => set(new Map([...current].filter(([, d]) => d !== 'TT')))}>ล้างที่เลือก</button>
        <b className="cmp-clcount">เลือกแล้ว {ids.length} ตะกร้า</b>
      </CloneMenuRow>
      <CloneMenuRow label="ไป TikTok SOLID →">
        {ids.length > 0
          ? <CloneAcross shop="SOLID" srcShop="REAL" src="shopee" dest="tiktok" ids={ids} onCloned={drop} onClose={() => router.refresh()} />
          : <span className="sku">ติ๊กตะกร้าก่อน แล้วกดปลายทาง</span>}
      </CloneMenuRow>
    </CloneMenu>
  );
}

// pagePairs: [{ pid, dst }] ของหน้านี้ · shops: ร้านที่โคลนหากันได้ (['SOLID', 'REAL'])
export function PlatBar({ pagePairs, shops = ['SOLID', 'REAL'] }) {
  const sel = useSel();
  const router = useRouter();
  const all = [...sel];
  const to = (dst) => all.filter(([, d]) => d === dst).map(([pid]) => pid);
  const [a, b] = shops;
  return (
    <CloneMenu count={all.length}>
      <CloneMenuRow label="ติ๊กตะกร้าหน้าแถว (ร้านหนึ่งมี อีกร้านไม่พบ):">
        <button type="button" className="chip" disabled={!pagePairs.length}
          onClick={() => { const m = new Map(current); for (const p of pagePairs) m.set(p.pid, p.dst); set(m); }}>ติ๊กทั้งหน้า ({pagePairs.length})</button>
        <button type="button" className="chip" disabled={!all.length} onClick={() => set(new Map())}>ล้างที่เลือก</button>
        <b className="cmp-clcount">เลือกแล้ว {all.length} ตะกร้า</b>
      </CloneMenuRow>
      <CloneMenuRow label="ไปร้านอื่น (Shopee เหมือนกัน) →">
        {to(b).length > 0 && <CloneAcross shop={b} srcShop={a} src="shopee" dest="shopee" ids={to(b)} onCloned={drop} onClose={() => router.refresh()} />}
        {to(a).length > 0 && <CloneAcross shop={a} srcShop={b} src="shopee" dest="shopee" ids={to(a)} onCloned={drop} onClose={() => router.refresh()} />}
        {!all.length && <span className="sku">ติ๊กตะกร้าก่อน แล้วกดปลายทาง</span>}
      </CloneMenuRow>
    </CloneMenu>
  );
}
