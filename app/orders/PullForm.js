'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// จำชื่อคนกดไว้ในเครื่อง จะได้ไม่ต้องพิมพ์ใหม่ทุกใบ
const NAME_KEY = 'order-sync:staff-name';

// ผลลัพธ์ที่เจอจริงตอนไปตามของในกอง — เลือกจากรายการ ไม่ต้องพิมพ์
const RESULTS = [
  'ยังไม่ได้แพ็ค + เอาใบออกแล้ว',
  'แพ็คแล้ว + หยิบของออกแล้ว',
  'ของหมด',
  'อื่นๆ',
];

export default function PullForm({ orderId, pulled }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(RESULTS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const router = useRouter();

  async function send(formData) {
    setBusy(true);
    setErr('');
    try {
      const picked = formData.get('result');
      if (picked && picked !== 'อื่นๆ') formData.set('note', picked);
      const res = await fetch('/api/orders/pull', { method: 'POST', body: formData });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      const by = formData.get('by');
      if (by) localStorage.setItem(NAME_KEY, String(by));
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (pulled?.at) {
    return (
      <div className="pulled">
        <b>✓ หยิบออกแล้ว</b>
        <div className="sku">
          {pulled.by} · {new Date(pulled.at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} น.
          {pulled.note ? ` · ${pulled.note}` : ''}
        </div>
        {pulled.photoUrl && <a href={pulled.photoUrl} target="_blank" rel="noreferrer"><img className="thumb" src={pulled.photoUrl} alt="หลักฐาน" /></a>}
        <button
          className="link"
          disabled={busy}
          onClick={() => {
            const fd = new FormData();
            fd.set('order_id', orderId);
            fd.set('undo', '1');
            send(fd);
          }}
        >
          กดผิด ยกเลิกการยืนยัน
        </button>
      </div>
    );
  }

  if (!open) {
    return <button className="btn danger-btn" onClick={() => setOpen(true)}>หยิบของออกแล้ว</button>;
  }

  return (
    <form
      className="pullform"
      action={send}
      onSubmit={(e) => { e.preventDefault(); send(new FormData(e.currentTarget)); }}
    >
      <input type="hidden" name="order_id" value={orderId} />
      <input
        name="by"
        placeholder="ชื่อคนหยิบ"
        required
        defaultValue={typeof window !== 'undefined' ? localStorage.getItem(NAME_KEY) || '' : ''}
      />
      {/* capture=environment = เปิดกล้องหลังให้เลย ถ่ายหน้างานได้ทันที */}
      <input name="photo" type="file" accept="image/*" capture="environment" />
      <select name="result" value={result} onChange={(e) => setResult(e.target.value)}>
        {RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      {result === 'อื่นๆ' && (
        <input name="note" placeholder="เกิดอะไรขึ้น เช่น หาไม่เจอ / ขนส่งรับไปแล้ว" autoFocus />
      )}
      <div className="row2">
        <button className="btn danger-btn" disabled={busy} type="submit">{busy ? 'กำลังบันทึก...' : 'ยืนยัน'}</button>
        <button className="btn" type="button" onClick={() => setOpen(false)} disabled={busy}>ยกเลิก</button>
      </div>
      {err && <div className="danger sku">{err}</div>}
    </form>
  );
}
