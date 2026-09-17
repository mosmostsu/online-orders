'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// หนึ่งรอบของเซิร์ฟเวอร์ทำได้ไม่เกิน ~17 วินาที (Netlify ตัดที่ ~26)
// ครั้งแรกมีของค้างเป็นเดือน จึงกดครั้งเดียวแล้ววนเรียกต่อเองจนหมด หรือครบเพดานรอบ
const MAX_ROUNDS = 12;

export default function SyncMoney() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();

  async function go() {
    setBusy(true);
    let saved = 0;
    try {
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        setMsg(`รอบ ${round} · ได้แล้ว ${saved} รายการ...`);
        const res = await fetch('/api/sync/settlement', { method: 'POST' });
        // โดน Netlify ตัดจะได้หน้า HTML กลับมา ไม่ใช่ JSON — บอกให้ชัดแทนที่จะขึ้น error อ่านไม่ออก
        const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status} (อาจหมดเวลา)` }));
        if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
        const bad = (j.result || []).find((r) => r.error);
        if (bad) throw new Error(`${bad.shop}: ${bad.error}`);
        saved += (j.result || []).reduce((s, r) => s + (r.saved || 0), 0);
        if (!j.more) break;
        // รอบก่อนยังไม่ปล่อยล็อก — เว้นจังหวะนิดนึงก่อนเรียกซ้ำ
        if (j.skipped) await new Promise((r) => setTimeout(r, 5000));
      }
      setMsg(`เสร็จ · ได้ ${saved} รายการ`);
    } catch (e) {
      setMsg(`ได้ ${saved} รายการ แล้วสะดุด: ${e.message}`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <button className="btn" onClick={go} disabled={busy}>{busy ? 'กำลังดึง...' : 'ดึงยอดเงิน'}</button>
      {msg && <span className="sub" style={{ margin: 0 }}>{msg}</span>}
    </span>
  );
}
