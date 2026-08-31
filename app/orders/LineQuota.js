'use client';
import { useEffect, useState } from 'react';

// โควต้า LINE เดือนนี้ — โหลดหลังหน้าขึ้นแล้ว จะได้ไม่ถ่วงหน้าหลัก
// LINE นับตามจำนวนผู้รับ ไม่ใช่จำนวนครั้งที่ส่ง กลุ่มสามคนหนึ่งข้อความ = ใช้โควต้าสาม
// จึงต้องบอกว่า "ส่งได้อีกกี่ครั้ง" ไม่งั้นเห็นเลขเหลือแล้วเข้าใจผิดว่ายังส่งได้
export default function LineQuota() {
  const [q, setQ] = useState(null);

  useEffect(() => {
    fetch('/api/line/quota').then((r) => r.json()).then(setQ).catch(() => {});
  }, []);

  if (!q || q.limit == null) return null;
  const sends = q.sendsLeft ?? 0;
  const level = sends === 0 ? 'out' : sends < 10 ? 'low' : 'ok';

  return (
    <span
      className="quota"
      data-level={level}
      title={`ใช้ไป ${q.used} จาก ${q.limit} ข้อความ · กลุ่มมี ${q.perSend} คน (ส่ง 1 ครั้งใช้ ${q.perSend} ข้อความ) · รีเซ็ตทุกวันที่ 1`}
    >
      {sends === 0 ? 'LINE เต็มแล้ว' : `LINE ส่งได้อีก ${sends} ครั้ง`}
    </span>
  );
}
