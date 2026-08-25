'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();

  async function go() {
    setBusy(true);
    setMsg('กำลังดึง...');
    try {
      const res = await fetch('/api/sync/tiktok', { method: 'POST' });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      const sum = (j.result || []).map((r) => r.error ? `${r.shop}: ${r.error}` : `${r.shop} ${r.fetched} ออเดอร์`).join(' · ');
      setMsg(sum || 'ไม่มีอะไรใหม่');
      router.refresh();
    } catch (e) {
      setMsg('พลาด: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <button className="btn" onClick={go} disabled={busy}>{busy ? 'กำลังดึง...' : 'ดึงออเดอร์ตอนนี้'}</button>
      {msg && <span className="sub" style={{ margin: 0 }}>{msg}</span>}
    </span>
  );
}
