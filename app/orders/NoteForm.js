'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const NAME_KEY = 'order-sync:staff-name';
// สองเรื่องที่เจอบ่อยสุดของใบที่ค้างรอขนส่ง — กดปุ่มเดียวจบ ไม่ต้องพิมพ์
const QUICK = ['ของหมด', 'ขนส่งลืมยิง'];

export default function NoteForm({ orderId, note, noteBy, noteAt }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note || '');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function save(value) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('order_id', orderId);
      fd.set('note', value);
      fd.set('by', localStorage.getItem(NAME_KEY) || '');
      const res = await fetch('/api/orders/note', { method: 'POST', body: fd });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
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
          <button className="link" onClick={() => setOpen(true)}>แก้</button>
          <button className="link" onClick={() => save('')} disabled={busy}>ลบ</button>
        </span>
      </div>
    ) : (
      <button className="btn" onClick={() => setOpen(true)}>+ ใส่คอมเมนต์</button>
    );
  }

  return (
    <div className="pullform">
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
