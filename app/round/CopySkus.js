'use client';
import { useState } from 'react';

// คัดลอก SKU + จำนวน (คั่นด้วยแท็บ) ไปวางในชีตได้ตรงช่อง
export default function CopySkus({ rows }) {
  const [done, setDone] = useState(false);
  const text = rows.map((r) => `${r.sku || r.name}\t${r.qty}`).join('\n');
  const copy = () =>
    navigator.clipboard?.writeText(text).then(
      () => { setDone(true); setTimeout(() => setDone(false), 1500); },
      () => prompt('คัดลอกข้อความนี้', text),
    );
  return <button className="btn" onClick={copy}>{done ? 'คัดลอกแล้ว ✓' : 'คัดลอก SKU + จำนวน'}</button>;
}
