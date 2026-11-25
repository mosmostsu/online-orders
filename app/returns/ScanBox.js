'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Scanner from '../orders/Scanner';
import { KIND_LABEL } from '@/lib/returns';

// ช่องยิงรับของคืน
//   ยิง → ขึ้นกรอบ "รอตรวจ" พร้อมสินค้าที่ควรอยู่ในกล่อง (ยังไม่บันทึก) → เปิดกล่องเช็ค → กด "ครบ ตกลง" หรือ "ของไม่ครบ"
//   ยิงกล่องเดิมซ้ำ = ตกลง (แบบ BigSeller) · ออเดอร์เดียวกันหลายกล่องรวมอยู่กรอบเดียว
//   ยิงไม่เจอ ขึ้นบอกสั้น ๆ ข้างช่องยิงแล้วหายไป ไม่ค้างในรายการ
// ปืนยิงแบบเสียบคอม = พิมพ์เลขแล้วกด Enter ให้เอง · แป้นค้างเป็นไทยก็ได้ (lib/returns normCode)
// รายการที่ยังไม่กดตกลงจำไว้ในเครื่อง — รีเฟรชหน้า/เผลอปิดก็ไม่หาย
const NAME_KEY = 'order-sync:staff-name';   // ตัวเดียวกับ PullForm หน้าออเดอร์
const PENDING_KEY = 'order-sync:returns-pending';

const TH = { timeZone: 'Asia/Bangkok' };
const fmt = (s) => (s ? new Date(s).toLocaleString('th-TH', { ...TH, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const groupKey = (r) => `${r.platform}|${r.shop}|${r.order_id}`;

async function post(body) {
  const res = await fetch('/api/returns/receive', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({ ok: false, error: 'ตอบกลับไม่ถูกต้อง' }));
  if (!j.ok) throw new Error(j.error || 'บันทึกไม่สำเร็จ');
  return j;
}

// สถานะของกรอบ: pending = รอกดตกลง · saved = รับแล้ว · partial = รับไม่ครบ · already = รับไปก่อนแล้ว · undone = ยกเลิกแล้ว
function boxStatus(g) {
  if (g.undone) return 'undone';
  if (g.rows.every((r) => r.already)) return 'already';
  if (g.rows.some((r) => r.recv === 'partial')) return 'partial';
  if (g.rows.every((r) => r.recv)) return 'saved';
  return 'pending';
}

export default function ScanBox() {
  const [by, setBy] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState([]);   // ล่าสุดบน: { key, codes:[], rows:[], undone }
  const [flash, setFlash] = useState(null);   // ข้อความสั้นข้างช่องยิง (ไม่เจอ / ลืมใส่ชื่อ)
  const [missingFor, setMissingFor] = useState(null);
  const input = useRef(null);
  const flashTimer = useRef(null);
  const router = useRouter();

  useEffect(() => {
    try {
      setBy(localStorage.getItem(NAME_KEY) || '');
      const saved = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
      if (Array.isArray(saved)) setGroups(saved);
    } catch { /* เครื่องไม่ให้เก็บ ก็เริ่มใหม่ */ }
    input.current?.focus();
  }, []);

  // ยิงหลายเลขติดกัน (วางหลายบรรทัด) ต้องเห็นกรอบล่าสุด ไม่ใช่ค่าตอนเริ่มยิง
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  // จำเฉพาะกรอบที่ยังไม่กดตกลง
  useEffect(() => {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(groups.filter((g) => boxStatus(g) === 'pending'))); } catch { /* ไม่เป็นไร */ }
  }, [groups]);

  function say(msg, tone = 'err') {
    clearTimeout(flashTimer.current);
    setFlash({ msg, tone });
    flashTimer.current = setTimeout(() => setFlash(null), 6000);
  }

  const update = (key, fn) => setGroups((gs) => gs.map((g) => (g.key === key ? fn(g) : g)));

  async function confirm(g) {
    const name = by.trim();
    if (!name) { say('ใส่ชื่อคนรับก่อน แล้วกดตกลงอีกที'); return; }
    try { localStorage.setItem(NAME_KEY, name); } catch { /* ไม่เป็นไร */ }
    const ids = g.rows.filter((r) => !r.recv).map((r) => r.id);
    if (!ids.length) return;
    try {
      const j = await post({ ids, by: name });
      const got = new Map(j.rows.map((r) => [r.id, r]));
      update(g.key, (x) => ({ ...x, rows: x.rows.map((r) => (got.has(r.id) ? { ...got.get(r.id), already: false } : r)) }));
      router.refresh();
    } catch (e) { say(e.message); }
  }

  async function scanOne(c) {
    const j = await post({ code: c, peek: true });
    if (j.notFound) { say(`ไม่เจอ ${c} — ลองยิงบาร์โค้ดอีกแท่ง หรือค้นจากตารางด้านล่าง`); return; }
    const key = groupKey(j.rows[0]);
    const g = groupsRef.current.find((x) => x.key === key);
    // ยิงกล่องเดิมซ้ำตอนยังรอตรวจ = ตกลง
    if (g && !g.undone && boxStatus(g) === 'pending' && j.rows.every((r) => g.rows.some((x) => x.id === r.id))) {
      await confirm(g);
      return;
    }
    const merge = (gs) => {
      const old = gs.find((x) => x.key === key);
      const rest = gs.filter((x) => x.key !== key);
      const rows = old && !old.undone ? [...old.rows] : [];   // ยกเลิกไปแล้วยิงใหม่ = เริ่มกรอบใหม่ด้วยข้อมูลสด
      for (const r of j.rows) if (!rows.some((x) => x.id === r.id)) rows.push(r);
      return [{ key, codes: [...new Set([...(old?.codes || []), c])], rows, undone: false }, ...rest];
    };
    groupsRef.current = merge(groupsRef.current);
    setGroups(merge);
  }

  async function scan(raw) {
    const codes = String(raw || '').split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
    if (!codes.length) return;
    setBusy(true);
    for (const c of codes) {
      try { await scanOne(c); } catch (e) { say(e.message); }
    }
    setBusy(false);
    setCode('');
    input.current?.focus();
  }

  async function confirmAll() {
    for (const g of groups.filter((x) => boxStatus(x) === 'pending')) await confirm(g);
  }

  async function undo(g) {
    const ids = g.rows.filter((r) => !r.already && r.recv).map((r) => r.id);
    try {
      if (ids.length) await post({ ids, undo: true });
      update(g.key, (x) => ({ ...x, undone: true }));
      router.refresh();
    } catch (e) { say(e.message); }
  }

  async function saveMissing(g, form) {
    const name = by.trim();
    if (!name) { say('ใส่ชื่อคนรับก่อน'); return; }
    const note = String(form.get('note') || '');
    try {
      const out = [];
      for (const r of g.rows.filter((x) => !x.already)) {
        const missing = (r.items || [])
          .map((it, i) => ({ sku: it.sku || it.name, qty: Number(form.get(`m${r.id}-${i}`)) || 0 }))
          .filter((m) => m.qty > 0);
        const j = await post({ ids: [r.id], by: name, missing, note });
        out.push(...j.rows);
      }
      const got = new Map(out.map((r) => [r.id, r]));
      update(g.key, (x) => ({ ...x, rows: x.rows.map((r) => (got.has(r.id) ? { ...got.get(r.id), already: false } : r)) }));
      setMissingFor(null);
      router.refresh();
    } catch (e) { say(e.message); }
  }

  const pending = groups.filter((g) => boxStatus(g) === 'pending');
  const LABEL = { pending: 'รอตรวจ', saved: 'รับครบแล้ว', partial: 'รับไม่ครบ', already: 'รับไปก่อนแล้ว', undone: 'ยกเลิกแล้ว' };
  const TONE = { pending: 'wait', saved: 'ok', partial: 'warn', already: 'warn', undone: 'dim' };

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
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); scan(code); }
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (/[\r\n]/.test(t.trim())) { e.preventDefault(); scan(t); }
          }}
        />
        <button className="btn" disabled={busy || !code.trim()} onClick={() => scan(code)}>ค้นกล่อง</button>
        <Scanner onCode={(c) => scan(c)} />
      </div>
      {flash && <div className="retscan-flash" data-tone={flash.tone}>{flash.msg}</div>}

      {groups.length > 0 && (
        <div className="retscan-log">
          <div className="retscan-bar">
            <span className="sub">
              ยิงรอบนี้ {groups.filter((g) => boxStatus(g) !== 'undone').length} ออเดอร์
              {pending.length > 0 && <> · <b className="retscan-wait">รอกดตกลง {pending.length}</b></>}
            </span>
            {pending.length > 1 && <button className="btn primary" onClick={confirmAll}>✓ ครบทั้งหมด ตกลง ({pending.length})</button>}
            <button className="link" onClick={() => setGroups((gs) => gs.filter((g) => boxStatus(g) === 'pending'))}>ล้างที่เสร็จแล้ว</button>
          </div>
          {groups.map((g) => {
            const st = boxStatus(g);
            const r0 = g.rows[0];
            const items = g.rows.flatMap((r) => (r.items || []).map((it) => ({ ...it, rid: r.id })));
            const reasons = [...new Set(g.rows.map((r) => r.reason).filter(Boolean))];
            const kinds = [...new Set(g.rows.map((r) => KIND_LABEL[r.kind]))];
            return (
              <div key={g.key} className="retscan-item" data-tone={TONE[st]}>
                <div className="retscan-head">
                  <b>{LABEL[st]}</b>
                  <span className="mono"> {r0.order_id}</span>
                  <span className="sku"> · {r0.platform} {r0.shop} · {kinds.join(' + ')}{reasons.length ? ` (${reasons.join(', ')})` : ''}</span>
                  {g.rows.length > 1 && <span className="sku"> · {g.rows.length} กล่อง</span>}
                  {st === 'already' && <span className="sku"> · {g.rows.map((r) => `${r.received_by || '-'} ${fmt(r.received_at)}`).join(', ')}</span>}
                  <span className="retscan-act">
                    {st === 'pending' && (
                      <>
                        <button className="btn primary" onClick={() => confirm(g)}>✓ ครบ ตกลง</button>
                        <button className="btn" onClick={() => setMissingFor(missingFor === g.key ? null : g.key)}>ของไม่ครบ</button>
                        <button className="link" onClick={() => setGroups((gs) => gs.filter((x) => x.key !== g.key))}>เอาออก</button>
                      </>
                    )}
                    {(st === 'saved' || st === 'partial') && (
                      <>
                        <button className="link" onClick={() => setMissingFor(missingFor === g.key ? null : g.key)}>ของไม่ครบ</button>
                        {' · '}<button className="link" onClick={() => undo(g)}>ยกเลิก</button>
                      </>
                    )}
                  </span>
                </div>
                {items.length > 0 && (
                  <div className="retscan-items">
                    {items.map((it, i) => (
                      <span key={i} className="line">
                        {it.image ? <img className="thumb sm" src={it.image} alt="" loading="lazy" /> : null}
                        <span className="mono">{it.sku || '(ไม่มี SKU)'}</span> × {it.qty}
                      </span>
                    ))}
                  </div>
                )}
                {g.rows.some((r) => r.missing?.length) && (
                  <div className="sku">ขาด: {g.rows.flatMap((r) => r.missing || []).map((m) => `${m.sku} ×${m.qty}`).join(', ')}</div>
                )}
                {missingFor === g.key && (
                  <form className="retscan-missing" action={(fd) => saveMissing(g, fd)}>
                    <div className="sub">ใส่จำนวนที่ขาด (0 = ครบ)</div>
                    {g.rows.filter((r) => !r.already).flatMap((r) => (r.items || []).map((it, i) => (
                      <label key={`${r.id}-${i}`}>
                        <span className="mono">{it.sku || it.name}</span> ขาด
                        <input type="number" name={`m${r.id}-${i}`} min={0} max={it.qty} defaultValue={0} style={{ width: 56 }} />
                        / {it.qty}
                      </label>
                    )))}
                    <input name="note" placeholder="หมายเหตุ เช่น ได้ของผิดสี" />
                    <button className="btn">บันทึก</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
