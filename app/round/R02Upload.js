'use client';
// ปุ่มอัปโหลดรีพอร์ต R02.102 จาก Seniorsoft — อ่านในเบราว์เซอร์ (lib/r02.js) ไม่ส่งไฟล์ขึ้นเซิร์ฟเวอร์
// จำผลไว้ในเครื่องตามวัน (localStorage) กดรีเฟรชแล้วไม่ต้องอัปใหม่ · ไฟล์ทั้งวันอัปซ้ำได้ ไฟล์ใหม่ทับของเดิม
import { useEffect, useRef, useState } from 'react';
import { readSheetRows, parseR02 } from '@/lib/r02';

const KEY = (day) => `r02:${day}`;
const thaiDayOf = (iso) => new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10);
const hhmm = (s) => new Date(s).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

export default function R02Upload({ day, value, onChange }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY(day)) || 'null');
      if (saved?.lines) onChange(saved);
    } catch { /* เปิดแบบส่วนตัว/บล็อก storage — แค่ไม่จำ */ }
  }, [day]);   // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (file) => {
    if (!file) return;
    setBusy(true);
    setMsg('');
    try {
      const all = parseR02(await readSheetRows(new Uint8Array(await file.arrayBuffer())));
      const lines = all.filter((l) => thaiDayOf(l.at) === day);
      if (!lines.length) {
        const days = [...new Set(all.map((l) => thaiDayOf(l.at)))].join(', ');
        setMsg(all.length ? `ไฟล์นี้เป็นของวันที่ ${days} ไม่ใช่วันที่เปิดอยู่` : 'ไม่พบใบขาย OSVS ของ TikTok / Shopee / Lazada / ThisShop ในไฟล์ — ใช่ไฟล์ R02.102 ไหม');
        return;
      }
      const v = { file: file.name, at: new Date().toISOString(), lines };
      onChange(v);
      try { localStorage.setItem(KEY(day), JSON.stringify(v)); } catch { /* เต็ม/บล็อก — ใช้ได้แค่จนปิดหน้า */ }
    } catch (e) {
      setMsg('อ่านไฟล์ไม่ได้: ' + (e.message || e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const clear = () => {
    onChange(null);
    try { localStorage.removeItem(KEY(day)); } catch { /* ไม่เป็นไร */ }
  };

  const docs = value ? new Set(value.lines.map((l) => l.doc)).size : 0;
  return (
    <span className="r02">
      <input ref={input} type="file" accept=".xlsx,.XLSX" hidden onChange={(e) => load(e.target.files?.[0])} />
      <button className="btn" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? 'กำลังอ่าน…' : value ? '📄 อัป R02.102 ใหม่' : '📄 อัปโหลด R02.102 เพื่อเช็ค'}
      </button>
      {value && (
        <span className="sub" style={{ margin: 0 }}>
          {value.file} · {docs} ใบ · อัป {hhmm(value.at)} น. ·{' '}
          <button className="linkbtn" onClick={clear}>เอาออก</button>
        </span>
      )}
      {msg && <span className="stale">{msg}</span>}
    </span>
  );
}
