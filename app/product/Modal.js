'use client';
import { useEffect } from 'react';

// หน้าต่างป็อปอัพกลางจอ — กดพื้นหลัง / ✕ / Esc เพื่อปิด (ปิดไม่ได้ระหว่าง busy กันกดปิดตอนกำลังบันทึกลงร้าน)
export default function Modal({ title, onClose, busy = false, wide = false, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, busy]);
  return (
    <div className="mback" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={'mbox' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <div className="mhead">
          <b>{title}</b>
          <button type="button" className="mclose" onClick={onClose} disabled={busy} aria-label="ปิด">✕</button>
        </div>
        <div className="mbody">{children}</div>
      </div>
    </div>
  );
}
