'use client';
import { useEffect, useState } from 'react';

// โควต้าข้อความ LINE เดือนนี้ — โหลดหลังหน้าขึ้นแล้ว จะได้ไม่ถ่วงหน้าหลัก
// บัญชีฟรีส่งได้เดือนละจำกัด พอเต็มแล้วแจ้งเตือนจะเงียบไปเฉยๆ ต้องเห็นก่อนถึงจุดนั้น
export default function LineQuota() {
  const [q, setQ] = useState(null);

  useEffect(() => {
    fetch('/api/line/quota').then((r) => r.json()).then(setQ).catch(() => {});
  }, []);

  if (!q || q.limit == null) return null;
  const left = q.left ?? 0;
  // เตือนตอนที่เหลือไม่พอส่งอีกไม่กี่ครั้ง (หนึ่งครั้งใช้เท่ากับจำนวนคนในกลุ่ม)
  const perSend = q.perSend || 1;
  const level = left < perSend ? 'out' : left < perSend * 10 ? 'low' : 'ok';

  return (
    <span
      className="quota"
      data-level={level}
      title={`ใช้ไป ${q.used} จาก ${q.limit} ข้อความ · กลุ่มมี ${perSend} คน (ส่ง 1 ครั้งใช้ ${perSend} ข้อความ) · ส่งได้อีก ${q.sendsLeft ?? 0} ครั้ง · รีเซ็ตทุกวันที่ 1`}
    >
      LINE {left === 0 ? 'เต็มแล้ว' : `เหลือ ${left.toLocaleString('en-US')}`}
    </span>
  );
}
