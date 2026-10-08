'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const MAX_ROUNDS = 8; // route ทำงานรอบละ ~7 วินาที ถ้ายังไม่เสร็จเรียกต่อได้จนครบ (บันทึกต่อจากจุดที่ค้างไว้)

// ปุ่มดึงคลิปจาก TikTok ทันที — ปกติตัวตั้งเวลาดึงให้เองอยู่แล้ว (netlify/functions/sync-tiktok-display.mjs)
export default function RefreshVideos() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();

  async function go() {
    setBusy(true);
    let saved = 0;
    try {
      for (let i = 1; i <= MAX_ROUNDS; i++) {
        setMsg(`กำลังดึงคลิป... (รอบ ${i})`);
        const res = await fetch('/api/sync/tiktok-display', { method: 'POST' });
        const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status} (อาจหมดเวลา)` }));
        const bad = (j.results || []).find((r) => !r.ok);
        if (!j.ok && (j.error || bad)) throw new Error(j.error || bad.error);
        saved += (j.results || []).reduce((n, r) => n + (r.saved || 0), 0);
        if (j.done) {
          setMsg(`เสร็จ · อัปเดต ${saved.toLocaleString('en-US')} คลิป`);
          return;
        }
      }
      setMsg(`ดึงแล้ว ${saved.toLocaleString('en-US')} คลิป แต่ยังไม่ครบ — กดอีกครั้งเพื่อทำต่อ`);
    } catch (e) {
      setMsg(`สะดุด: ${e.message}`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="btn" onClick={go} disabled={busy}>{busy ? 'กำลังดึง...' : 'ดึงคลิปใหม่'}</button>
      {msg && <span className="sub" style={{ margin: 0 }}>{msg}</span>}
    </span>
  );
}
