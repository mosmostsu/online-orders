'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// สแกนบาร์โค้ด/QR บนใบปะหน้าแล้วเปิดออเดอร์นั้นทันที
// ต้องใช้ไลบรารีอ่านภาพเอง เพราะ iPhone ใช้เครื่องมือของ Safari ข้างใน
// แม้จะเปิดด้วย Chrome ก็ตาม ซึ่งยังไม่มีตัวอ่านบาร์โค้ดในตัว
export default function Scanner() {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const boxRef = useRef(null);
  const scannerRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    let stopped = false;

    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        const el = boxRef.current;
        if (!el || stopped) return;

        const scanner = new Html5Qrcode(el.id, { verbose: false });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },          // กล้องหลัง
          { fps: 10, qrbox: { width: 250, height: 160 } },
          (text) => {
            // อ่านได้แล้วปิดกล้องทันที ไม่งั้นจะยิงซ้ำหลายรอบ
            scanner.stop().catch(() => {});
            setOpen(false);
            const code = String(text).trim();
            router.push(`/orders?status=all&scan=1&q=${encodeURIComponent(code)}`);
          },
          () => {}                                 // อ่านไม่ออกในเฟรมนั้น ไม่ต้องทำอะไร
        );
      } catch (e) {
        setErr(
          String(e?.message || e).includes('Permission')
            ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง — กดอนุญาตในเบราว์เซอร์แล้วลองใหม่'
            : 'เปิดกล้องไม่ได้: ' + String(e?.message || e)
        );
      }
    })();

    return () => {
      stopped = true;
      const s = scannerRef.current;
      if (s) s.stop().catch(() => {});
    };
  }, [open, router]);

  if (!open) {
    return (
      <button className="btn" onClick={() => { setErr(''); setOpen(true); }} title="สแกนบาร์โค้ดบนใบปะหน้า">
        📷 สแกน
      </button>
    );
  }

  return (
    <div className="scanwrap">
      <div id="scanner-box" ref={boxRef} className="scanbox" />
      <div className="scanbar">
        <span className="sub">เล็งบาร์โค้ดหรือ QR บนใบปะหน้า</span>
        <button className="btn" onClick={() => setOpen(false)}>ปิด</button>
      </div>
      {err && <div className="note note-danger">{err}</div>}
    </div>
  );
}
