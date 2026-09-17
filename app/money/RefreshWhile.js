'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// ดึงหน้าใหม่เป็นระยะ "เฉพาะตอนที่กำลังดึงยอดเงินอยู่" — ตัวเลขจะค่อยๆ ขึ้นให้เห็น
// หน้าเซิร์ฟเวอร์ใส่ตัวนี้มาเฉพาะตอนกำลังดึง พอดึงเสร็จ render รอบถัดไปจะไม่มีตัวนี้ = หยุดเอง
export default function RefreshWhile({ every = 10 }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, every * 1000);
    return () => clearInterval(t);
  }, [router, every]);
  return null;
}
