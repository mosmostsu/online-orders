'use client';
import { useState } from 'react';
import SkuRow from './SkuRow';

// "ดู SKU อื่น (63 SKU) ⌄" — กดแล้วโหลดตัวเลือกที่เหลือมากางในหน้าเดิม เหมือนหลังร้าน Shopee
// โหลดครั้งเดียวแล้วจำไว้ กดซ่อน/กางซ้ำไม่ต้องโหลดใหม่
export default function SkuMore({ platform, shop, id, skip, total }) {
  const [open, setOpen] = useState(false);
  const [skus, setSkus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (skus) return;
    setBusy(true);
    setErr('');
    try {
      const q = new URLSearchParams({ platform, shop, id, skip: String(skip) });
      const res = await fetch(`/api/products/skus?${q}`);
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setSkus(j.skus);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && skus && skus.map((v) => <SkuRow key={v.sku_id} v={v} />)}
      <button type="button" className="pmore" onClick={toggle}>
        {busy ? 'กำลังโหลด...' : open ? 'ซ่อน ⌃' : `ดู SKU อื่น (${total} SKU) ⌄`}
      </button>
      {err && <div className="sku danger" style={{ textAlign: 'center' }}>{err}</div>}
    </>
  );
}
