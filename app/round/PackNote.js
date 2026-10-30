'use client';
// งานก่อนแพ็คของออเดอร์ (แท็บหมายเหตุ) — กดปุ่มลัดหรือพิมพ์เอง แล้วติ๊กว่าทำแล้ว · บันทึกที่ /api/orders/pack-note (ทุกเครื่องเห็น)
import { useState } from 'react';

const NAME_KEY = 'order-sync:staff-name';   // ชื่อเดียวกับที่ใส่ตอนคอมเมนต์ในหน้าออเดอร์ (app/orders/NoteForm.js)
const QUICK = ['เขียนบิล', 'เปลี่ยนของ'];
const hhmm = (s) => new Date(s).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

export default function PackNote({ o, onSaved }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const send = async (body) => {
    setBusy(true);
    setErr('');
    try {
      let by = '';
      try { by = localStorage.getItem(NAME_KEY) || ''; } catch { /* ไม่มีชื่อก็ได้ */ }
      const res = await fetch('/api/orders/pack-note', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: o.id, by, ...body }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onSaved(j.row);
      setEdit(false);
    } catch (e) {
      setErr('บันทึกไม่สำเร็จ: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (o.pack_note && !edit) {
    const done = !!o.pack_done_at;
    return (
      <div className="pnote" data-done={done ? '1' : '0'}>
        <label className="pnote-chk">
          <input type="checkbox" checked={done} disabled={busy} onChange={(e) => send({ done: e.target.checked })} />
          <span>{o.pack_note}</span>
        </label>
        <div className="pnote-meta">
          {done ? `✓ ทำแล้ว ${o.pack_done_by ? o.pack_done_by + ' · ' : ''}${hhmm(o.pack_done_at)} น.` : 'ยังไม่ได้ทำ'}
          {' · '}<button className="linkbtn" disabled={busy} onClick={() => { setText(o.pack_note); setEdit(true); }}>แก้</button>
          {' · '}<button className="linkbtn" disabled={busy} onClick={() => send({ note: '' })}>ลบ</button>
        </div>
        {err && <div className="stale">{err}</div>}
      </div>
    );
  }

  return (
    <div className="pnote">
      <div className="pnote-add">
        {!edit && QUICK.map((q) => (
          <button key={q} className="chip" type="button" disabled={busy} onClick={() => send({ note: q })}>+ {q}</button>
        ))}
        <input
          value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
          placeholder={edit ? '' : 'หรือพิมพ์เอง แล้วกด Enter'}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) send({ note: text }); if (e.key === 'Escape') setEdit(false); }}
        />
        {edit && <button className="btn rmove" disabled={busy || !text.trim()} onClick={() => send({ note: text })}>บันทึก</button>}
        {edit && <button className="linkbtn" onClick={() => setEdit(false)}>ยกเลิก</button>}
      </div>
      {err && <div className="stale">{err}</div>}
    </div>
  );
}
