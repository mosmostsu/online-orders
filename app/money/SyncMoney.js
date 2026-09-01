'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SyncMoney() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();

  async function go() {
    setBusy(true);
    setMsg('กำลังถามยอด...');
    try {
      const j = await fetch('/api/sync/settlement', { method: 'POST' }).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      const sum = (j.result || [])
        .map((r) => (r.error ? `${r.shop}: ${r.error}` : `${r.shop} ปิดยอด ${r.settled} · รออีก ${r.waiting}`))
        .join(' · ');
      setMsg(sum || 'ไม่มีใบที่ต้องถาม');
      router.refresh();
    } catch (e) {
      setMsg('พลาด: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <button className="btn" onClick={go} disabled={busy}>{busy ? 'กำลังถามยอด...' : 'ถามยอดเงินตอนนี้'}</button>
      {msg && <span className="sub" style={{ margin: 0 }}>{msg}</span>}
    </span>
  );
}
