'use client';
import { useEffect, useState } from 'react';
import { saveToSync, stamp } from '../returns/saveFile';

// ปุ่ม 💾 ไฟล์ Seniorsoft ในแท็บ "⚠️ ยกเลิกก่อนขนส่งเข้ารับ"
// ของถูกยิงออกใน Seniorsoft ตอนตัดรอบไปแล้ว — หยิบออกจากกองแล้วต้องเอาเข้าใหม่
// ไฟล์ "รหัส<TAB>จำนวน" ลงโฟลเดอร์ sync เดียวกับของตีคืน (เลือกครั้งแรกที่หน้า /returns หรือที่นี่ก็ได้ จำร่วมกัน)
// ส่งแล้วจดไว้ (os_orders.ss_at) กดซ้ำไม่ได้ของเดิม
async function call(init) {
  const res = await fetch('/api/orders/risky-seniorsoft', init);
  const j = await res.json().catch(() => ({ ok: false, error: 'ตอบกลับไม่ถูกต้อง' }));
  if (!j.ok && !j.needSql) throw new Error(j.error || 'ทำไฟล์ไม่สำเร็จ');
  return j;
}

export default function RiskySeniorsoft() {
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => call({ cache: 'no-store' }).then(setInfo).catch((e) => setInfo({ ok: false, error: e.message }));
  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true);
    setMsg('');
    try {
      const j = await call({ cache: 'no-store' });
      if (j.needSql) { setMsg(j.error); return; }
      if (!j.rows.length) { setMsg('ไม่มีใบที่หยิบออกใหม่ (ส่งไฟล์ไปครบแล้ว)'); return; }
      const res = await saveToSync(`ยกเลิกก่อนรับ-${stamp()}.txt`, new Blob([j.text], { type: 'text/plain' }));
      if (res.cancelled) return;
      await call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: j.ids, mark: true }) });
      setMsg(`บันทึกแล้ว ${j.rows.length} รหัส ${j.pieces} ชิ้น (${j.orders} ใบ) → ${res.where}` +
        (j.noSku ? ` · ⚠️ ไม่มีรหัส ${j.noSku} ชิ้น ต้องคีย์เอง` : ''));
      load();
    } catch (e) {
      setMsg('บันทึกไม่สำเร็จ: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginLeft: 8 }}>
      <button className="btn primary ss" disabled={busy || info?.needSql} onClick={save}
        title="ใบที่หยิบของออกแล้ว (ไม่นับ 'ของหมด') ที่ยังไม่เคยส่ง — รหัส<TAB>จำนวน ลงโฟลเดอร์ sync">
        💾 ไฟล์ Seniorsoft{info?.ok ? ` (ใหม่ ${info.orders} ใบ)` : ''}
      </button>
      {info?.needSql && <span className="sub">{info.error}</span>}
      {msg && <span className="sub">{msg}</span>}
    </span>
  );
}
