'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// ดึงเฉพาะร้านที่เปิดดูอยู่ — หนึ่งรอบของเซิร์ฟเวอร์ได้ ~17 วินาที ร้านที่มีหลายร้อยตะกร้าต้องหลายรอบ
// กดครั้งเดียวแล้ววนเรียกต่อเองจนหมด หรือครบเพดานรอบ
// ThisShop ได้ทีละ ~100 ตะกร้าต่อรอบ ทั้งร้าน ~1,250 จึงต้องให้รอบมากกว่า
//
// ความคืบหน้า "ดึงแล้ว x / y ตะกร้า":
//   Shopee/TikTok — รอบแรกบอกว่าต้องดึงกี่ตะกร้า (todo = ใหม่/ถูกแก้/เก่าเกิน 3 ชม.) แต่ละรอบบอกที่เหลือ (left)
//   Lazada/ThisShop — ไล่ทั้งร้านทีละหน้า ใช้จำนวนตะกร้าของร้านที่มีอยู่ (count) เป็นเป้า
const MAX_ROUNDS = 15;
const MAX_ROUNDS_THISSHOP = 40;

export default function SyncProducts({ platform, shop, count = null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [prog, setProg] = useState(null);   // { done, target }
  const router = useRouter();
  const byTodo = platform === 'shopee' || platform === 'tiktok';

  async function go() {
    setBusy(true);
    setMsg('กำลังเริ่ม…');
    setProg(null);
    let saved = 0;
    let target = byTodo ? null : count;
    let done = 0;
    try {
      const rounds = platform === 'thisshop' ? MAX_ROUNDS_THISSHOP : MAX_ROUNDS;
      for (let round = 1; round <= rounds; round++) {
        const q = new URLSearchParams({ platform, shop });
        const res = await fetch(`/api/sync/products?${q}`, { method: 'POST' });
        const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status} (อาจหมดเวลา)` }));
        if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
        const rs = j.result || [];
        const bad = rs.find((r) => r.error);
        if (bad) throw new Error(bad.error);
        saved += rs.reduce((s, r) => s + (r.saved || 0), 0);
        if (byTodo) {
          const todo = rs.reduce((s, r) => s + (r.todo || 0), 0);
          const left = rs.reduce((s, r) => s + (r.left || 0), 0);
          if (target === null && rs.some((r) => r.todo !== undefined)) target = todo;   // รอบแรกที่ได้ตัวเลข = เป้าทั้งหมด
          if (target !== null) done = Math.max(0, target - left);
        } else {
          done = target ? Math.min(saved, target) : saved;
        }
        if (target) setProg({ done, target });
        setMsg(target === 0
          ? 'ทุกตะกร้าสดอยู่แล้ว (ดึงไม่เกิน 3 ชม.)'
          : `ดึงแล้ว ${done.toLocaleString('en-US')}${target ? ` / ${target.toLocaleString('en-US')}` : ''} ตะกร้า${target ? ` (${Math.round((done / target) * 100)}%)` : ''} · รอบ ${round}`);
        if (!j.more) break;
        if (rs.some((r) => r.skipped)) {
          setMsg((m) => `${m} · มีอีกรอบกำลังทำงานอยู่ รอสักครู่…`);
          await new Promise((r) => setTimeout(r, 5000));
        }
        // ให้ตัวเลขในหน้าขยับระหว่างทาง ไม่ต้องรอจบทุกรอบ
        router.refresh();
      }
      if (target) setProg({ done: target, target });
      setMsg(target === 0 ? 'ทุกตะกร้าสดอยู่แล้ว (ดึงไม่เกิน 3 ชม.)' : `เสร็จ · อัปเดต ${saved.toLocaleString('en-US')} ตะกร้า`);
    } catch (e) {
      setMsg(`ได้ ${saved} ตะกร้า แล้วสะดุด: ${e.message}`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="btn" onClick={go} disabled={busy}>{busy ? 'กำลังดึง...' : 'ดึงสินค้า'}</button>
      {msg && (
        <span className="sync-prog">
          <span className="sub" style={{ margin: 0 }}>{msg}</span>
          {prog && prog.target > 0 && (
            <span className="sync-bar"><i style={{ width: `${Math.min(100, Math.round((prog.done / prog.target) * 100))}%` }} /></span>
          )}
        </span>
      )}
    </span>
  );
}
