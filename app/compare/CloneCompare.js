'use client';
// เลือกตะกร้า Shopee REAL ที่จะโคลนไป ThisShop ในหน้า /compare
//
// ติ๊กได้เฉพาะแถวที่ ThisShop "ไม่พบ" และ Shopee REAL มีตะกร้าเดียว (หน้า page.js เป็นคนตัดสิน)
// ที่เลือกจำไว้ในหน้านี้ (หน่วยความจำ) ข้ามหน้า/เปลี่ยนตัวกรองได้ — รีเฟรชแล้วเริ่มว่าง
// กดปุ่มโคลน → แผงจับคู่หมวด/แบรนด์ + สั่งโคลน (app/allsite/report/CloneThisShop.js) ซึ่งเช็คซ้ำกับฐานข้อมูลอีกชั้น
import { useState, useSyncExternalStore } from 'react';
import CloneThisShop from '../allsite/report/CloneThisShop';
import ExtLink from './ExtLink';

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

// ตะกร้า ThisShop ที่มีอยู่แล้วแต่ปิดขาย (หน้า compare เห็นเป็น "ไม่พบ") — ลิงก์หลังบ้าน + ปุ่ม "เปิดขาย"
// เปลี่ยนสถานะเป็นวางขายอย่างเดียว (POST /api/clone/publish) ไม่แก้ข้อมูลอื่นของสินค้า
export function OffShelf({ spuId, url, title }) {
  const [st, setSt] = useState('idle');   // idle | run | ok | err
  const [msg, setMsg] = useState('');

  async function publish(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`เปิดขายตะกร้า ThisShop เลข ${spuId}${title ? `\n“${title}”` : ''}?\n\nเปลี่ยนสถานะเป็นวางขายอย่างเดียว ไม่แก้ข้อมูลอื่น\n(ตัวเลือกที่สต็อกเป็น 0 ลูกค้าจะเห็นว่าของหมด)`)) return;
    setSt('run');
    setMsg('');
    try {
      const j = await fetch('/api/clone/publish', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spuId }),
      }).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      setSt('ok');
    } catch (err) {
      setSt('err');
      setMsg(String(err.message || err));
    }
  }

  return (
    <span className="cmp-offshelf" onClick={(e) => e.stopPropagation()}>
      {st === 'ok'
        ? <span className="cl-ok">✅ เปิดขายแล้ว</span>
        : <ExtLink href={url} title={`ThisShop มีตะกร้านี้แล้ว (เลข ${spuId}) แต่ปิดขายอยู่ — เปิดหลังบ้าน`}>ThisShop: ปิดขายอยู่ ↗</ExtLink>}
      {st !== 'ok' && (
        <button type="button" className="chip" disabled={st === 'run'} onClick={publish}>
          {st === 'run' ? '⏳ กำลังเปิดขาย…' : 'เปิดขาย'}
        </button>
      )}
      {st === 'err' && <span className="cl-err" title={msg}>❌ {msg.slice(0, 60)}</span>}
    </span>
  );
}
