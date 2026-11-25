'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// ปุ่ม "ดึงสถานะใหม่" — ปกติระบบดึงเองทุกชั่วโมง (นาทีที่ 40) กดเมื่ออยากเห็นสดกว่านั้น
export default function SyncReturns() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();

  async function run() {
    setBusy(true);
    setMsg('กำลังดึง…');
    try {
      const res = await fetch('/api/sync/returns', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      const n = (j.failed || 0) + (j.tiktok || 0) + (j.shopee || 0);
      setMsg(j.errors?.length ? 'ดึงได้บางส่วน: ' + j.errors[0] : `อัปเดตแล้ว ${n} กล่อง · ถึงร้านใหม่ ${j.checked || 0}`);
      router.refresh();
    } catch (e) {
      setMsg('ดึงไม่สำเร็จ: ' + e.message);
    }
    setBusy(false);
  }

  return (
    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {msg && <span className="sub">{msg}</span>}
      <button className="btn" disabled={busy} onClick={run}>↻ ดึงสถานะใหม่</button>
    </span>
  );
}
