'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const NAME_KEY = 'order-sync:staff-name';
// สองเรื่องที่เจอบ่อยสุดของใบที่ค้างรอขนส่ง — กดปุ่มเดียวจบ ไม่ต้องพิมพ์
const QUICK = ['ของหมด', 'ขนส่งลืมยิง'];

export default function NoteForm({ orderId, note, noteBy, noteAt }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note || '');
  const [by, setBy] = useState(noteBy || '');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // เปิดฟอร์ม = ดึงค่าล่าสุดมาตั้งต้นเสมอ
  // ชื่อ: ใช้ชื่อคนคอมเมนต์เดิมก่อน ถ้ายังไม่มีค่อยใช้ชื่อที่จำไว้ในเครื่อง
  // (อ่าน localStorage ตอนคลิกเท่านั้น ตอน render ฝั่ง server ไม่มี window)
  function openForm() {
    setText(note || '');
    setBy(noteBy || localStorage.getItem(NAME_KEY) || '');
    setOpen(true);
  }

  async function save(value, name = by) {
    // เว้นช่องชื่อไว้ = ไม่ได้ตั้งใจลบชื่อ ให้คงชื่อเดิมไว้
    const who = String(name || '').trim() || String(noteBy || '').trim();
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('order_id', orderId);
      fd.set('note', value);
      fd.set('by', who);
      const res = await fetch('/api/orders/note', { method: 'POST', body: fd });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      if (who) localStorage.setItem(NAME_KEY, who);
      setOpen(false);
      router.refresh();
    } catch (e) {
      alert('บันทึกไม่สำเร็จ: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return note ? (
      <div className="noteshow">
        <div className="notetext">💬 {note}</div>
        <div className="sku">
          {noteBy || ''}
          {noteAt ? ` · ${new Date(noteAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} น.` : ''}
        </div>
        <span className="row2">
          <button className="link" onClick={openForm}>แก้</button>
          <button className="link" onClick={() => save('')} disabled={busy}>ลบ</button>
        </span>
      </div>
    ) : (
      <button className="btn" onClick={openForm}>+ ใส่คอมเมนต์</button>
    );
  }

  return (
    <div className="pullform">
      <input
        value={by}
        onChange={(e) => setBy(e.target.value)}
        placeholder="ชื่อคนคอมเมนต์"
        onKeyDown={(e) => { if (e.key === 'Enter') save(text); }}
      />
      <span className="row2">
        {QUICK.map((q) => (
          <button key={q} className="chip" type="button" disabled={busy} onClick={() => save(q)}>{q}</button>
        ))}
      </span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="พิมพ์เอง เช่น รอของเข้าพรุ่งนี้"
        onKeyDown={(e) => { if (e.key === 'Enter') save(text); }}
      />
      <span className="row2">
        <button className="btn" disabled={busy} onClick={() => save(text)}>{busy ? 'บันทึก...' : 'บันทึก'}</button>
        <button className="btn" type="button" onClick={() => setOpen(false)} disabled={busy}>ปิด</button>
      </span>
    </div>
  );
}
