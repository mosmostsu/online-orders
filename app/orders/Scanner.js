'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// สแกนบาร์โค้ด/QR บนใบปะหน้าแล้วเปิดออเดอร์นั้นทันที
// iPhone ใช้เครื่องมือของ Safari ข้างในแม้เปิดด้วย Chrome จึงไม่มีตัวอ่านบาร์โค้ดในตัว
// ต้องใช้ไลบรารีอ่านภาพเอง และบางเครื่องเปิดกล้องสดไม่ได้ จึงมีทางถ่ายรูปให้อ่านแทน
export default function Scanner() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('');     // ข้อความบอกสถานะให้ผู้ใช้เห็นว่าติดตรงไหน
  const [err, setErr] = useState('');
  const scannerRef = useRef(null);
  const router = useRouter();

  function found(text) {
    const code = String(text || '').trim();
    if (!code) return;
    setState('อ่านได้: ' + code.slice(0, 40));
    const s = scannerRef.current;
    if (s) s.stop().catch(() => {});
    setOpen(false);
    router.push(`/orders?status=all&scan=1&q=${encodeURIComponent(code)}`);
  }

  useEffect(() => {
    if (!open) return;
    let dead = false;

    (async () => {
      try {
        setState('กำลังโหลดตัวอ่าน...');
        const { Html5Qrcode } = await import('html5-qrcode');
        if (dead) return;

        setState('กำลังขอใช้กล้อง...');
        const { Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        // บนใบปะหน้ามีทั้ง QR (สี่เหลี่ยมจัตุรัส) และบาร์โค้ดแท่ง (แนวนอนยาว)
        // ต้องบอกให้อ่านทุกแบบที่เจอจริง ไม่งั้นจับได้แค่บางอัน
        const formats = [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
          Html5QrcodeSupportedFormats.PDF_417,
        ];
        const scanner = new Html5Qrcode('scanner-box', { verbose: false, formatsToSupport: formats });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 12,
            // ไม่กำหนดกรอบ = อ่านทั้งภาพ จับได้ทั้ง QR และบาร์โค้ดโดยไม่ต้องเล็งให้ตรงกรอบ
            aspectRatio: 1.4,
            videoConstraints: {
              facingMode: 'environment',
              width: { ideal: 1920 },     // ความละเอียดสูงขึ้น อ่านบาร์โค้ดเส้นถี่ได้ดีกว่า
              height: { ideal: 1080 },
            },
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          },
          (text) => found(text),
          () => {}    // อ่านไม่ออกในเฟรมนั้น เป็นเรื่องปกติ ไม่ต้องทำอะไร
        );
        if (!dead) setState('เล็งบาร์โค้ดหรือ QR ให้เต็มจอ');
      } catch (e) {
        const msg = String(e?.message || e);
        setErr(
          /permission|NotAllowed/i.test(msg) ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง — กดอนุญาตในเบราว์เซอร์แล้วลองใหม่'
          : /NotFound|no camera/i.test(msg) ? 'หากล้องไม่เจอ — ลองใช้ปุ่มถ่ายรูปด้านล่างแทน'
          : 'เปิดกล้องไม่ได้: ' + msg
        );
        setState('');
      }
    })();

    return () => {
      dead = true;
      const s = scannerRef.current;
      if (s) s.stop().catch(() => {});
    };
  }, [open]);

  // ทางสำรอง: ถ่ายรูปใบปะหน้าแล้วให้ระบบอ่านจากรูป
  async function fromPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr('');
    setState('กำลังอ่านจากรูป...');
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      const s = new Html5Qrcode('scanner-box', {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.ITF,
        ],
      });
      const text = await s.scanFile(file, false);
      found(text);
    } catch {
      setErr('อ่านจากรูปไม่ได้ — ลองถ่ายให้บาร์โค้ดชัดและเต็มกรอบกว่านี้');
      setState('');
    }
  }

  if (!open) {
    return (
      <button className="btn" onClick={() => { setErr(''); setState(''); setOpen(true); }}>
        📷 สแกน
      </button>
    );
  }

  return (
    <div className="scanwrap">
      <div id="scanner-box" className="scanbox" />
      <div className="scanbar">
        <span className="sub">{state || 'กำลังเตรียม...'}</span>
        <span className="row2">
          <label className="btn" style={{ cursor: 'pointer' }}>
            ถ่ายรูปแทน
            <input type="file" accept="image/*" capture="environment" onChange={fromPhoto} hidden />
          </label>
          <button className="btn" onClick={() => setOpen(false)}>ปิด</button>
        </span>
      </div>
      {err && <div className="note note-danger">{err}</div>}
    </div>
  );
}
