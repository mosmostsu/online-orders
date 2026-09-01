'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Scanner from './Scanner';

// ค้นจากเลขออเดอร์ เลขพัสดุ SKU ชื่อสินค้า หรือชื่อผู้รับ — ช่องเดียวหาได้หมด
export default function SearchBox({ initial = '' }) {
  const [q, setQ] = useState(initial);
  const router = useRouter();
  const sp = useSearchParams();

  function go(e) {
    e.preventDefault();
    const p = new URLSearchParams(sp.toString());
    const v = q.trim();
    if (v) p.set('q', v);
    else p.delete('q');
    p.delete('page');
    // ค้นแล้วต้องมองทุกสถานะ ไม่งั้นหาใบที่ส่งไปแล้วไม่เจอ
    if (v) p.set('status', 'all');
    router.push('/orders?' + p.toString());
  }

  function clear() {
    setQ('');
    const p = new URLSearchParams(sp.toString());
    p.delete('q');
    p.delete('page');
    router.push('/orders?' + p.toString());
  }

  return (
    <form className="search" onSubmit={go}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ค้นหา เลขออเดอร์ / เลขพัสดุ / SKU / ชื่อสินค้า"
        inputMode="search"
      />
      {q && <button type="button" className="link" onClick={clear}>ล้าง</button>}
      <button className="btn" type="submit">ค้นหา</button>
      <Scanner />
    </form>
  );
}
