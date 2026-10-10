'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// ปุ่ม ↻ ท้ายแถว — ดึงตะกร้าทุกใบในแถวนั้น (ทุกร้านพร้อมกัน) สดจากแพลตฟอร์ม แล้วโหลดหน้าใหม่
// วางอยู่ใน <summary> จึงกันไม่ให้แถวกาง/หุบตามตอนกด
// ร้านที่ไม่มี API (Shopee MVP, ThisShop, Thaimart) เซิร์ฟเวอร์ข้ามให้เอง
export default function RefreshRow({ items }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();

  async function go(e) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/sync/product-one', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status} (อาจหมดเวลา)` }));
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      const done = j.results.filter((r) => r.ok).length;
      const skipped = j.results.filter((r) => r.skipped).length;
      const bad = j.results.find((r) => r.error);
      setMsg(bad ? `พลาด: ${bad.error}` : `รีเฟรช ${done} ใบ${skipped ? ` · ข้าม ${skipped} (ไม่มี API)` : ''}`);
      router.refresh();
    } catch (err) {
      setMsg(`พลาด: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!items.length) return null;
  return (
    <span className="cmp-rr" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <button type="button" className="cmp-rbtn" data-busy={busy ? '1' : '0'} onClick={go}
        title="รีเฟรชตะกร้าในแถวนี้จากแพลตฟอร์ม (ทุกร้านพร้อมกัน)" aria-label="รีเฟรชแถวนี้">↻</button>
      {msg && <span className="cmp-rmsg">{msg}</span>}
    </span>
  );
}
