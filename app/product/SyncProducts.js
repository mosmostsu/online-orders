'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// ดึงเฉพาะร้านที่เปิดดูอยู่ — หนึ่งรอบของเซิร์ฟเวอร์ได้ ~17 วินาที ร้านที่มีหลายร้อยตะกร้าต้องหลายรอบ
// กดครั้งเดียวแล้ววนเรียกต่อเองจนหมด หรือครบเพดานรอบ
// ThisShop ได้ทีละ ~100 ตะกร้าต่อรอบ ทั้งร้าน ~1,250 จึงต้องให้รอบมากกว่า
const MAX_ROUNDS = 15;
const MAX_ROUNDS_THISSHOP = 40;

export default function SyncProducts({ platform, shop }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();

  async function go() {
    setBusy(true);
    let saved = 0;
    try {
      const rounds = platform === 'thisshop' ? MAX_ROUNDS_THISSHOP : MAX_ROUNDS;
      for (let round = 1; round <= rounds; round++) {
        setMsg(`รอบ ${round} · ได้แล้ว ${saved} ตะกร้า...`);
        const q = new URLSearchParams({ platform, shop });
        const res = await fetch(`/api/sync/products?${q}`, { method: 'POST' });
        const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status} (อาจหมดเวลา)` }));
        if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
        const bad = (j.result || []).find((r) => r.error);
        if (bad) throw new Error(bad.error);
        saved += (j.result || []).reduce((s, r) => s + (r.saved || 0), 0);
        if (!j.more) break;
        if ((j.result || []).some((r) => r.skipped)) await new Promise((r) => setTimeout(r, 5000));
        // ให้ตัวเลขในหน้าขยับระหว่างทาง ไม่ต้องรอจบทุกรอบ
        router.refresh();
      }
      setMsg(`เสร็จ · อัปเดต ${saved} ตะกร้า`);
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
      {msg && <span className="sub" style={{ margin: 0 }}>{msg}</span>}
    </span>
  );
}
