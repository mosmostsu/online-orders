'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// หน้านี้เปิดค้างไว้ทั้งวันบนจอที่ร้าน ข้อมูลไหลเข้าตลอดจาก webhook
// จึงต้องดึงหน้าใหม่เป็นระยะ ไม่งั้นตัวเลขค้างอยู่ตอนที่เปิด
// หยุดเองเมื่อสลับไปแท็บอื่น จะได้ไม่ยิงทิ้งเปล่าๆ
const EVERY = 30;

export default function AutoRefresh() {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [left, setLeft] = useState(EVERY);
  const [pending, start] = useTransition();

  const refresh = () => {
    setLeft(EVERY);
    start(() => router.refresh());
  };

  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => {
      setLeft((n) => {
        if (document.visibilityState !== 'visible') return EVERY;
        if (n <= 1) {
          start(() => router.refresh());
          return EVERY;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [on, router]);

  return (
    <span className="refresh">
      <button className="btn" onClick={refresh} disabled={pending} title="ดึงหน้าใหม่เดี๋ยวนี้">
        {pending ? '⟳ กำลังโหลด...' : '⟳ รีเฟรช'}
      </button>
      <label className="sub" title={`ดึงหน้าใหม่เองทุก ${EVERY} วินาที`}>
        <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setLeft(EVERY); }} />
        อัตโนมัติ{on ? ` (${left}s)` : ''}
      </label>
    </span>
  );
}
