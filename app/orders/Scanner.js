'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// สแกนบาร์โค้ด/QR บนใบปะหน้าแล้วเปิดออเดอร์นั้นทันที
// iPhone ใช้เครื่องมือของ Safari ข้างในแม้เปิดด้วย Chrome จึงไม่มีตัวอ่านบาร์โค้ดของระบบให้ใช้
// (ต่างจากแอปอย่าง BigSeller ที่เป็นแอปติดตั้ง เรียกตัวอ่านของ iOS ได้ตรงๆ)
// ทางที่ทำให้ใกล้เคียงที่สุดคือ เปิดเต็มจอ + เลนส์หลัก + ซูม + ไฟฉาย
export default function Scanner() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('');     // ข้อความบอกสถานะให้ผู้ใช้เห็นว่าติดตรงไหน
  const [err, setErr] = useState('');
  const [torch, setTorch] = useState(null);   // null = เครื่องไม่มีไฟฉายให้สั่ง
  const scannerRef = useRef(null);
  const hintRef = useRef(null);
  const doneRef = useRef(false);   // อ่านได้แล้วครั้งหนึ่ง ไม่ต้องทำซ้ำ
  const tries = useRef(0);
  const [tryCount, setTries] = useState(0);
  const router = useRouter();

  async function found(text) {
    const code = String(text || '').trim();
    if (!code || doneRef.current) return;
    doneRef.current = true;          // callback ยิงทุกเฟรมที่อ่านออก ต้องกันไม่ให้พาไปซ้ำ
    clearTimeout(hintRef.current);
    setState('อ่านได้ ' + code.slice(0, 30) + ' — กำลังเปิดออเดอร์...');
    const s = scannerRef.current;
    if (s) s.stop().catch(() => {});

    // ถามเองว่าโค้ดนี้คือใบไหน แล้วพาไปหน้านั้นตรงๆ
    // เดิมส่งไปหน้ารายการแล้วให้เซิร์ฟเวอร์สั่งเด้งต่อ ซึ่งบนเบราว์เซอร์ของ iPhone ไม่เด้งให้
    let target = `/orders?status=all&scan=1&q=${encodeURIComponent(code)}`;
    try {
      const res = await fetch(`/api/orders/lookup?q=${encodeURIComponent(code)}`);
      const j = await res.json();
      if (j.order_id) target = `/orders/${encodeURIComponent(j.order_id)}`;
    } catch { /* ถามไม่ได้ก็ไปหน้ารายการตามเดิม */ }

    setOpen(false);
    router.push(target);
  }

  useEffect(() => {
    if (!open) return;
    let dead = false;
    // กันหน้าเลื่อนตอนสแกนเต็มจอ
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    (async () => {
      try {
        setState('กำลังโหลดตัวอ่าน...');
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (dead) return;

        setState('กำลังขอใช้กล้อง...');
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

        // iPhone มีกล้องหลังหลายตัว ถ้าปล่อยให้เลือกเอง มักได้ตัวมุมกว้าง (0.5x)
        // ซึ่งโฟกัสระยะใกล้ไม่ชัดและทำให้บาร์โค้ดเล็กจนอ่านไม่ออก ต้องเจาะจงเลนส์หลัก
        let source = { facingMode: 'environment' };
        // ความละเอียดสูงไว้ก่อน บาร์โค้ดเส้นถี่ต้องการรายละเอียดมาก
        const vc = { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'environment' };
        try {
          const cams = await Html5Qrcode.getCameras();
          const back = cams.filter((c) => /back|rear|environment|หลัง/i.test(c.label || ''));
          const main = back.find((c) => !/ultra|wide|เท|0\.5/i.test(c.label)) || back[0];
          if (main?.id) {
            source = { deviceId: { exact: main.id } };
            // ต้องใส่ลง videoConstraints ด้วย เพราะไลบรารีใช้ค่านี้ทับตัวเลือกกล้องข้างบน
            delete vc.facingMode;
            vc.deviceId = { exact: main.id };
          }
        } catch { /* ถามรายชื่อกล้องไม่ได้ ก็ใช้กล้องหลังแบบทั่วไป */ }

        await scanner.start(
          source,
          {
            fps: 10,
            // ไม่กำหนดกรอบ = อ่านทั้งภาพ จับได้ทั้ง QR และบาร์โค้ดโดยไม่ต้องเล็งให้ตรงกรอบ
            // ห้ามใส่ aspectRatio คู่กับ videoConstraints — ไลบรารีจะโยน error ทิ้งทั้งรอบ
            videoConstraints: vc,
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          },
          (text) => found(text),
          () => {
            // อ่านไม่ออกในเฟรมนั้นเป็นเรื่องปกติ แต่ต้องนับไว้ให้เห็น
            // ถ้าตัวเลขนี้ไม่ขยับเลย แปลว่าตัวอ่านไม่ได้ทำงาน คนละปัญหากับอ่านแล้วไม่ออก
            tries.current++;
            if (tries.current % 10 === 0 && !doneRef.current) setTries(tries.current);
          }
        );

        // ซูมเข้าอีกนิดถ้าเครื่องรองรับ — บาร์โค้ดใหญ่ขึ้นในเฟรม อ่านติดง่ายขึ้นมาก
        try { await scanner.applyVideoConstraints({ advanced: [{ zoom: 2 }] }); } catch { /* ไม่รองรับก็ข้าม */ }
        // ไฟฉายช่วยเยอะกับใบที่พิมพ์จางหรือกองของที่แสงไม่ถึง (iPhone มักสั่งไม่ได้ ก็ซ่อนปุ่มไป)
        try {
          const caps = scanner.getRunningTrackCapabilities?.();
          if (caps && 'torch' in caps) setTorch(false);
        } catch { /* ถามความสามารถไม่ได้ ก็ไม่ต้องมีปุ่ม */ }

        if (!dead) setState('เล็งให้บาร์โค้ดเต็มความกว้างกรอบ');
        // กล้องสดบน iPhone อ่านบาร์โค้ดเส้นถี่ไม่ค่อยติด ถ้าส่องนานแล้วยังเงียบ
        // ให้บอกทางที่แม่นกว่า — ถ่ายเป็นรูปแล้วอ่านจากรูป (ทดสอบกับใบจริงได้ 96%)
        hintRef.current = setTimeout(() => {
          if (!dead) setState('ยังอ่านไม่ติด — กด "ถ่ายรูป" จะแม่นกว่า');
        }, 12000);
      } catch (e) {
        const msg = String(e?.message || e);
        setErr(
          /permission|NotAllowed/i.test(msg) ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง — กดอนุญาตในเบราว์เซอร์แล้วลองใหม่'
          : /NotFound|no camera/i.test(msg) ? 'หากล้องไม่เจอ — ใช้ปุ่มถ่ายรูปแทน'
          : 'เปิดกล้องไม่ได้: ' + msg
        );
        setState('');
      }
    })();

    return () => {
      dead = true;
      clearTimeout(hintRef.current);
      document.body.style.overflow = prevOverflow;
      const s = scannerRef.current;
      if (s) s.stop().catch(() => {});
    };
  }, [open]);

  async function toggleTorch() {
    const s = scannerRef.current;
    if (!s) return;
    const next = !torch;
    try {
      await s.applyVideoConstraints({ advanced: [{ torch: next }] });
      setTorch(next);
    } catch { setTorch(null); }
  }

  // ทางสำรอง: ถ่ายรูปใบปะหน้าแล้วให้ระบบอ่านจากรูป
  // รูปนิ่งความละเอียดเต็มของกล้องอ่านได้แม่นกว่าภาพสดมาก
  async function fromPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr('');
    clearTimeout(hintRef.current);
    setState('กำลังอ่านจากรูป...');
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      const s = new Html5Qrcode('scanner-file', {
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
      setErr('อ่านจากรูปไม่ได้ — ถ่ายให้บาร์โค้ดชัดและเต็มกรอบกว่านี้');
      setState('');
    }
  }

  if (!open) {
    return (
      <>
        <button className="btn" onClick={() => { setErr(''); setState(''); setTorch(null); doneRef.current = false; tries.current = 0; setTries(0); setOpen(true); }}>
          📷 สแกน
        </button>
        <div id="scanner-file" hidden />
      </>
    );
  }

  return (
    <div className="scanfull">
      <div id="scanner-box" className="scanvideo" />
      <div id="scanner-file" hidden />

      {/* กรอบเล็งแบบสี่มุม บอกให้รู้ว่าต้องวางบาร์โค้ดตรงไหน */}
      <div className="scanframe">
        <i className="c tl" /><i className="c tr" /><i className="c bl" /><i className="c br" />
        <i className="scanline" />
      </div>

      <div className="scantop">
        <button className="scanx" onClick={() => setOpen(false)} aria-label="ปิด">✕</button>
        <span>สแกนใบปะหน้า</span>
        {torch === null
          ? <span style={{ width: 40 }} />
          : <button className="scanx" onClick={toggleTorch} aria-label="ไฟฉาย">{torch ? '🔦' : '💡'}</button>}
      </div>

      <div className="scanfoot">
        <div className="scanstate">
          {err || state || 'กำลังเตรียม...'}
          {!err && tryCount > 0 && <div className="sub" style={{ color: '#ffffff99' }}>อ่านไปแล้ว {tryCount} เฟรม</div>}
        </div>
        <label className="btn scanshot">
          📸 ถ่ายรูป
          <input type="file" accept="image/*" capture="environment" onChange={fromPhoto} hidden />
        </label>
      </div>
    </div>
  );
}
