'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// ปุ่มดึงไฟล์ ST กลางมาใหม่ทันที — ปกติตัวตั้งเวลาดึงให้ทุกชั่วโมงอยู่แล้ว (netlify/functions/sync-st.mjs)
export default function SyncSt() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();

  async function go() {
    setBusy(true);
    setMsg('กำลังดึงไฟล์ ST...');
    try {
      const res = await fetch('/api/sync/st?force=1', { method: 'POST' });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status} (อาจหมดเวลา)` }));
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      setMsg(j.skipped ? j.skipped : `เสร็จ · ${Number(j.rows).toLocaleString('en-US')} รหัส`);
    } catch (e) {
      setMsg(`สะดุด: ${e.message}`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="btn" onClick={go} disabled={busy}>{busy ? 'กำลังดึง...' : 'ดึงไฟล์ ST'}</button>
      {msg && <span className="sub" style={{ margin: 0 }}>{msg}</span>}
    </span>
  );
}
