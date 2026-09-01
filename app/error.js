'use client';
import { useEffect, useState } from 'react';

// พังเฉพาะบางหน้า (ไม่ถึงกับพังทั้งเว็บ) — โชว์สาเหตุจริงให้อ่านจากมือถือได้
// Next ตัดรายละเอียดออกในเวอร์ชันใช้งานจริง จึงต้องหยิบจากตัวดักที่วางไว้ใน layout ด้วย
export default function ErrorPage({ error, reset }) {
  const [raw, setRaw] = useState([]);
  const [ua, setUa] = useState('');
  const [where, setWhere] = useState('');
  useEffect(() => {
    setRaw((typeof window !== 'undefined' && window.__E) || []);
    setUa(typeof navigator !== 'undefined' ? navigator.userAgent : '');
    setWhere(typeof location !== 'undefined' ? location.pathname + location.search : '');
  }, []);

  // error บางตัวไม่มี message เลย (เช่นที่ถูกย่อในเวอร์ชันใช้งานจริง)
  // ต้องหยิบทุกช่องที่พอมี ไม่งั้นได้หน้าว่างซึ่งบอกอะไรไม่ได้
  const lines = [
    where && 'หน้า: ' + where,
    error?.message && 'ข้อความ: ' + error.message,
    error?.digest && 'รหัส: ' + error.digest,
    !error?.message && error && 'ชนิด: ' + (error.name || Object.prototype.toString.call(error)) + ' · ' + String(error),
    error?.stack && 'ที่มา: ' + String(error.stack).split('\n').slice(0, 4).map((x) => x.trim()).join(' | '),
    ...raw.map((r, i) => `ดักได้ ${i + 1}: ${r}`),
  ].filter(Boolean);

  return (
    <div className="note note-danger">
      <b>หน้านี้โหลดไม่ขึ้น</b>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, marginTop: 6 }}>
        {lines.length ? lines.join('\n') : 'ไม่มีรายละเอียด'}
      </pre>
      <div style={{ fontSize: 11, color: '#7f1d1d', wordBreak: 'break-all', marginTop: 6 }}>{ua}</div>
      <button className="btn" onClick={() => reset()} style={{ marginTop: 8 }}>ลองใหม่</button>
    </div>
  );
}
