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
      // ดึงทุกแพลตฟอร์มที่ผูกไว้ ร้านไหนยังไม่ได้ผูกก็แค่ข้ามไป
      const results = await Promise.all(
        ['tiktok', 'shopee', 'thisshop'].map((p) =>
          fetch(`/api/sync/${p}`, { method: 'POST' }).then((r) => r.json()).catch(() => null)
        )
      );
      const rows = results.flatMap((j) => (j?.ok ? j.result || [] : []));
      if (!rows.length) throw new Error(results.find((j) => j && !j.ok)?.error || 'ไม่มีร้านที่ผูกไว้');
      const sum = rows.map((r) => (r.error ? `${r.shop}: ${r.error}` : `${r.shop} ${r.fetched} ออเดอร์`)).join(' · ');
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
      <button className="btn" onClick={go} disabled={busy}>{busy ? 'กำลังดึง...' : 'ดึงใหม่'}</button>
      {msg && <span className="sub" style={{ margin: 0 }}>{msg}</span>}
    </span>
  );
}
