'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Scanner from '../orders/Scanner';
import { KIND_LABEL } from '@/lib/returns';

// ช่องยิงรับของคืน — ยิงแล้วบันทึกทันที ไม่มีขั้น "ยืนยัน" (ลืมกดยืนยันแล้วกล่องหายไม่ได้)
// ปืนยิงแบบเสียบคอม = พิมพ์เลขแล้วกด Enter ให้เอง · แป้นค้างเป็นไทยก็ได้ ระบบแปลงกลับ (lib/returns normCode)
// วางเลขหลายบรรทัด (ก๊อปจากไฟล์) = รับทีละเลข
const NAME_KEY = 'order-sync:staff-name';   // ตัวเดียวกับ PullForm หน้าออเดอร์

const TH = { timeZone: 'Asia/Bangkok' };
const fmt = (s) => (s ? new Date(s).toLocaleString('th-TH', { ...TH, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function ScanBox() {
  const [by, setBy] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);   // ยิงรอบนี้ ล่าสุดบน
  const [missingFor, setMissingFor] = useState(null);   // id กล่องที่กำลังติ๊กของขาด
  const input = useRef(null);
  const router = useRouter();

  useEffect(() => {
    try { setBy(localStorage.getItem(NAME_KEY) || ''); } catch { /* เครื่องไม่ให้เก็บ ก็พิมพ์ใหม่ */ }
    input.current?.focus();
  }, []);

  async function post(body) {
    const res = await fetch('/api/returns/receive', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({ ok: false, error: 'ตอบกลับไม่ถูกต้อง' }));
    if (!j.ok) throw new Error(j.error || 'บันทึกไม่สำเร็จ');
    return j;
  }

  async function receive(raw) {
    const codes = String(raw || '').split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
    if (!codes.length) return;
    if (!by.trim()) { setLog((l) => [{ key: Date.now(), tone: 'err', code: codes[0], msg: 'ใส่ชื่อคนรับก่อน' }, ...l]); return; }
    try { localStorage.setItem(NAME_KEY, by.trim()); } catch { /* ไม่เป็นไร */ }
    setBusy(true);
    for (const c of codes) {
      try {
        const j = await post({ code: c, by: by.trim() });
        if (j.notFound) {
          setLog((l) => [{ key: Date.now() + c, tone: 'err', code: c, msg: 'ไม่เจอในระบบ — ลองยิงบาร์โค้ดอีกแท่ง หรือค้นจากตาราง' }, ...l]);
          continue;
        }
        const entries = j.rows.map((r) => ({
          key: `${Date.now()}-${r.id}`, row: r, code: c,
          tone: r.already ? 'warn' : 'ok',
          msg: r.already ? `รับไปแล้ว ${fmt(r.received_at)} โดย ${r.received_by || '-'}` : 'รับแล้ว',
        }));
        setLog((l) => [...entries, ...l]);
      } catch (e) {
        setLog((l) => [{ key: Date.now() + c, tone: 'err', code: c, msg: e.message }, ...l]);
      }
    }
    setBusy(false);
    setCode('');
    input.current?.focus();
    router.refresh();
  }

  async function undo(entry) {
    try {
      await post({ id: entry.row.id, undo: true });
      setLog((l) => l.map((x) => (x.key === entry.key ? { ...x, tone: 'dim', msg: 'ยกเลิกการรับแล้ว' } : x)));
      router.refresh();
    } catch (e) { alert(e.message); }
  }

  async function saveMissing(entry, form) {
    const missing = (entry.row.items || [])
      .map((it, i) => ({ sku: it.sku || it.name, qty: Number(form.get('m' + i)) || 0 }))
      .filter((m) => m.qty > 0);
    const note = String(form.get('note') || '');
    try {
      const j = await post({ id: entry.row.id, by: by.trim() || 'ไม่ระบุ', missing, note });
      const r = j.rows[0];
      setLog((l) => l.map((x) => (x.key === entry.key ? { ...x, row: r, tone: r.recv === 'partial' ? 'warn' : 'ok', msg: r.recv === 'partial' ? 'รับไม่ครบ' : 'รับแล้ว' } : x)));
      setMissingFor(null);
      router.refresh();
    } catch (e) { alert(e.message); }
  }

  return (
    <div className="retscan">
      <div className="retscan-row">
        <input className="retscan-by" placeholder="ชื่อคนรับ" value={by} onChange={(e) => setBy(e.target.value)} />
        <textarea
          ref={input}
          className="retscan-code"
          rows={1}
          placeholder="ยิงบาร์โค้ดกล่อง / พิมพ์เลขพัสดุ เลขออเดอร์ แล้วกด Enter"
          value={code}
          disabled={busy}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); receive(code); }
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (/[\r\n]/.test(t.trim())) { e.preventDefault(); receive(t); }
          }}
        />
        <button className="btn" disabled={busy || !code.trim()} onClick={() => receive(code)}>รับ</button>
        <Scanner onCode={(c) => receive(c)} />
      </div>

      {log.length > 0 && (
        <div className="retscan-log">
          <div className="sub">ยิงรอบนี้ {log.filter((x) => x.tone === 'ok' || x.tone === 'warn').length} กล่อง
            {' · '}<button className="link" onClick={() => setLog([])}>ล้างรายการ</button>
          </div>
          {log.map((x) => (
            <div key={x.key} className="retscan-item" data-tone={x.tone}>
              <div className="retscan-head">
                <b>{x.msg}</b>
                <span className="mono"> {x.row ? x.row.order_id : x.code}</span>
                {x.row && <span className="sku"> · {x.row.platform} {x.row.shop} · {KIND_LABEL[x.row.kind]}{x.row.reason ? ` (${x.row.reason})` : ''}</span>}
                {x.row && !x.row.already && x.tone !== 'dim' && (
                  <span className="retscan-act">
                    <button className="link" onClick={() => setMissingFor(missingFor === x.key ? null : x.key)}>ของไม่ครบ</button>
                    {' · '}<button className="link" onClick={() => undo(x)}>ยกเลิก</button>
                  </span>
                )}
              </div>
              {x.row?.items?.length > 0 && (
                <div className="retscan-items">
                  {x.row.items.map((it, i) => (
                    <span key={i} className="line">
                      {it.image ? <img className="thumb sm" src={it.image} alt="" loading="lazy" /> : null}
                      <span className="mono">{it.sku || '(ไม่มี SKU)'}</span> × {it.qty}
                    </span>
                  ))}
                </div>
              )}
              {missingFor === x.key && (
                <form className="retscan-missing" action={(fd) => saveMissing(x, fd)}>
                  <div className="sub">ใส่จำนวนที่ขาด (0 = ครบ)</div>
                  {(x.row.items || []).map((it, i) => (
                    <label key={i}>
                      <span className="mono">{it.sku || it.name}</span> ขาด
                      <input type="number" name={'m' + i} min={0} max={it.qty} defaultValue={0} style={{ width: 56 }} />
                      / {it.qty}
                    </label>
                  ))}
                  <input name="note" placeholder="หมายเหตุ เช่น ได้ของผิดสี" />
                  <button className="btn">บันทึก</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
