'use client';
import { useState } from 'react';

// คัดลอกตาราง SKU (คั่นด้วยแท็บ) ไปวางในชีตได้ตรงช่อง — ลำดับคอลัมน์เดียวกับแท็บ final ในชีต
// SKU · Product Name · Variation · ไซส์ · จำนวน
export default function CopySkus({ rows }) {
  const [done, setDone] = useState(false);
  const text = rows.map((r) => [r.sku, r.name, r.color, r.size, r.qty].join('\t')).join('\n');
  const copy = () =>
    navigator.clipboard?.writeText(text).then(
      () => { setDone(true); setTimeout(() => setDone(false), 1500); },
      () => prompt('คัดลอกข้อความนี้', text),
    );
  return <button className="btn" onClick={copy}>{done ? 'คัดลอกแล้ว ✓' : 'คัดลอกตารางไปวางชีต'}</button>;
}
