'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// หน้านี้เปิดค้างไว้ทั้งวันบนจอที่ร้าน — ต้องอัปเดตเองไม่งั้นเห็นตัวเลขค้างของเมื่อชั่วโมงที่แล้ว
// หยุดรีเฟรชตอนสลับไปแท็บอื่น จะได้ไม่ยิงทิ้งเปล่าๆ
export default function AutoRefresh({ seconds = 60 }) {
  const router = useRouter();
  const [on, setOn] = useState(true);

  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [on, seconds, router]);

  return (
    <label className="autorefresh sub" title={`อัปเดตเองทุก ${seconds} วินาที`}>
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
      อัปเดตเอง
    </label>
  );
}
