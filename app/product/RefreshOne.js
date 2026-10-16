'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// ปุ่ม ↻ ในแต่ละตะกร้าของหน้า /product — ดึงตะกร้านี้ใบเดียวสดจากแพลตฟอร์ม (ไม่ต้องดึงทั้งร้านใหม่)
// ใช้ /api/sync/product-one ตัวเดียวกับปุ่ม ↻ ในหน้า /compare · หมุนจนหน้าโหลดค่าใหม่เสร็จจริง
export default function RefreshOne({ platform, shop, id }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // { ok, text }
  const [secs, setSecs] = useState(0);
  const [navPending, startTransition] = useTransition();
  const refreshing = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (!busy) return undefined;
    const t0 = Date.now();
    setSecs(0);
    const t = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => {
    if (!msg?.ok) return undefined;
    const t = setTimeout(() => setMsg(null), 8000);
    return () => clearTimeout(t);
  }, [msg]);
  useEffect(() => {
    if (refreshing.current && !navPending) { refreshing.current = false; setBusy(false); }
  }, [navPending]);

  async function go() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/sync/product-one', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        // compare: false — หน้านี้ไม่ใช้ก้อน /compare ไม่ต้องรอสร้างใหม่ (ประหยัด ~4-6 วินาที)
        body: JSON.stringify({ items: [{ platform, shop, id }], compare: false }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status} (อาจหมดเวลา)` }));
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      const r = (j.results || [])[0] || {};
      if (r.error) throw new Error(r.error);
      setMsg(r.skipped ? { ok: false, text: r.skipped } : { ok: true, text: `ดึงแล้ว${r.skus !== undefined ? ` · ${r.skus} ตัวเลือก` : ''}` });
      refreshing.current = true;
      startTransition(() => { router.refresh(); });
    } catch (e) {
      setMsg({ ok: false, text: `พลาด: ${e.message}` });
    } finally {
      if (!refreshing.current) setBusy(false);
    }
  }

  return (
    <span className="prefresh">
      <button type="button" className="cmp-rbtn" data-busy={busy ? '1' : '0'} onClick={go}
        title="ดึงตะกร้านี้ใหม่จากแพลตฟอร์ม (ใบเดียว)" aria-label="ดึงตะกร้านี้ใหม่">↻</button>
      {(busy || msg) && (
        <span className="sku" data-ok={busy ? '' : msg.ok ? '1' : '0'} role="status">
          {busy ? `กำลังดึง… ${secs} วิ` : msg.text}
        </span>
      )}
    </span>
  );
}
