'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Scanner from '../orders/Scanner';
import { KIND_LABEL, normCode } from '@/lib/returns';
import { beep, listenUnlock, unlockSound } from './beep';

// ช่องยิงรับของคืน
//   ยิง → ขึ้นกรอบ "รอตรวจ" ติ๊กครบทุกชิ้นไว้ให้แล้ว (ยังไม่บันทึก) → เปิดกล่องเช็ค ชิ้นไหนไม่มีกดให้เป็นแดง → กด "ตกลง"
//   ช่องยิงรับโฟกัสตลอด ยิงกล่องต่อไปได้เลยไม่ต้องคลิกช่อง · มีเสียงติ๊ดตอนเจอ / ตื๊ดตอนไม่เจอ
//   ยิงกล่องเดิมซ้ำ = ตกลง (แบบ BigSeller) · ออเดอร์เดียวกันหลายกล่องรวมอยู่กรอบเดียว
//   ยิงไม่เจอ ขึ้นบอกสั้น ๆ ข้างช่องยิงแล้วหายไป ไม่ค้างในรายการ
// ปืนยิงแบบเสียบคอม = พิมพ์เลขแล้วกด Enter ให้เอง · แป้นค้างเป็นไทยก็ได้ (lib/returns normCode)
// รายการที่ยังไม่กดตกลงจำไว้ในเครื่อง — รีเฟรชหน้า/เผลอปิดก็ไม่หาย
const NAME_KEY = 'order-sync:staff-name';   // ตัวเดียวกับ PullForm หน้าออเดอร์
const PENDING_KEY = 'order-sync:returns-pending';

const TH = { timeZone: 'Asia/Bangkok' };
const fmt = (s) => (s ? new Date(s).toLocaleString('th-TH', { ...TH, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const groupKey = (r) => `${r.platform}|${r.shop}|${r.order_id}`;
const itemKey = (rid, i) => `${rid}:${i}`;

// ติ๊กครบทุกชิ้นของกล่องที่ยังไม่รับ — ค่าเริ่มต้นตอนยิงเข้ามา
function fullGot(rows) {
  const got = {};
  for (const r of rows) if (!r.recv) (r.items || []).forEach((it, i) => { got[itemKey(r.id, i)] = Number(it.qty) || 1; });
  return got;
}

// ติ๊กไปแล้วกี่ชิ้น จากที่ต้องได้กี่ชิ้น (เฉพาะกล่องที่ยังไม่รับ)
function tally(g) {
  let need = 0, have = 0;
  for (const r of g.rows) {
    if (r.recv) continue;
    (r.items || []).forEach((it, i) => {
      const q = Number(it.qty) || 1;
      need += q;
      have += Math.min(q, g.got?.[itemKey(r.id, i)] || 0);
    });
  }
  return { need, have };
}

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
      // กรอบที่ค้างจากเวอร์ชันก่อน (ยังไม่เคยติ๊ก) = ติ๊กครบไว้ให้
      if (Array.isArray(saved)) setGroups(saved.map((g) => (g.got && Object.keys(g.got).length ? g : { ...g, got: fullGot(g.rows || []) })));
    } catch { /* เครื่องไม่ให้เก็บ ก็เริ่มใหม่ */ }
    input.current?.focus();
    return listenUnlock();   // กด/พิมพ์ตรงไหนในหน้าก็ปลดล็อกเสียง
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
    if (tone === 'err') beep('err');
    flashTimer.current = setTimeout(() => setFlash(null), 6000);
  }

  // กดปุ่มในกรอบเสร็จ ให้เคอร์เซอร์กลับไปที่ช่องยิง จะได้ยิงกล่องต่อไปได้เลย
  function refocus(e) {
    if (e.target.closest('input, textarea, select, form')) return;
    if (window.matchMedia?.('(pointer: coarse)').matches) return;   // มือถือ: ไม่ต้องเด้งคีย์บอร์ดขึ้นมาเอง
    setTimeout(() => input.current?.focus(), 0);
  }

  const update = (key, fn) => setGroups((gs) => gs.map((g) => (g.key === key ? fn(g) : g)));

  // ติ๊กของในกล่องทีละชิ้น — ครบ = เขียว · ยังไม่ได้ = แดง (กดซ้ำวนกลับ 0)
  const setGot = (g, k, n) => {
    const fn = (x) => (x.key === g.key ? { ...x, got: { ...(x.got || {}), [k]: n } } : x);
    groupsRef.current = groupsRef.current.map(fn);
    setGroups((gs) => gs.map(fn));
  };
  const tickAll = (g) => {
    const got = fullGot(g.rows);
    const fn = (x) => (x.key === g.key ? { ...x, got } : x);
    groupsRef.current = groupsRef.current.map(fn);
    setGroups((gs) => gs.map(fn));
    return { ...g, got };
  };

  // บันทึกตามที่ติ๊ก — ชิ้นที่ไม่ได้ติ๊ก = ขาด (รับไม่ครบ)
  async function confirm(g) {
    const name = by.trim();
    if (!name) { say('ใส่ชื่อคนรับก่อน แล้วกดตกลงอีกที'); return; }
    try { localStorage.setItem(NAME_KEY, name); } catch { /* ไม่เป็นไร */ }
    const open = g.rows.filter((r) => !r.recv);
    if (!open.length) return;
    try {
      const out = [];
      const full = [];
      for (const r of open) {
        const missing = (r.items || []).map((it, i) => {
          const q = Number(it.qty) || 1;
          return { sku: it.sku || it.name, qty: q - Math.min(q, g.got?.[itemKey(r.id, i)] || 0) };
        }).filter((m) => m.qty > 0);
        if (missing.length) out.push(...(await post({ ids: [r.id], by: name, missing, note: g.note || '' })).rows);
        else full.push(r.id);
      }
      if (full.length) out.push(...(await post({ ids: full, by: name })).rows);
      const got = new Map(out.map((r) => [r.id, r]));
      update(g.key, (x) => ({ ...x, rows: x.rows.map((r) => (got.has(r.id) ? { ...got.get(r.id), already: false } : r)) }));
      beep('save');
      router.refresh();
    } catch (e) { say(e.message); }
  }

  // ยิงบาร์โค้ดสินค้า (SKU) ตอนมีกล่องรอตรวจ = ติ๊กชิ้นนั้น (ติ๊กครบอยู่แล้วก็แค่ติ๊ดรับรู้ ไม่ไปค้นเป็นกล่อง)
  function tickBySku(c) {
    const nc = normCode(c);
    let seen = false;
    for (const g of groupsRef.current) {
      if (g.undone || boxStatus(g) !== 'pending') continue;
      for (const r of g.rows) {
        if (r.recv) continue;
        const items = r.items || [];
        for (let i = 0; i < items.length; i++) {
          const k = itemKey(r.id, i);
          const q = Number(items[i].qty) || 1;
          const have = g.got?.[k] || 0;
          if (!items[i].sku || normCode(items[i].sku) !== nc) continue;
          seen = true;
          if (have < q) { setGot(g, k, have + 1); return true; }
        }
      }
    }
    return seen;
  }

  async function scanOne(c) {
    if (tickBySku(c)) { beep('ok'); return; }
    const j = await post({ code: c, peek: true });
    if (j.notFound) { say(`ไม่เจอ ${c} — ลองยิงบาร์โค้ดอีกแท่ง หรือค้นจากตารางด้านล่าง`); return; }
    // ใบยกเลิกก่อนขนส่งรับ: ยิง = เลือกเข้าไฟล์ Seniorsoft (เหมือนติ๊กในตาราง) ไม่รับ — หยิบออกจัดการที่หน้าออเดอร์
    const cancel = j.rows.filter((r) => r.kind === 'cancel');
    if (cancel.length) {
      window.dispatchEvent(new CustomEvent('returns:select', { detail: cancel.map((r) => r.id) }));
      beep('ok');
      say(`เลือก ${cancel[0].order_id} เข้าไฟล์ "ยกเลิก" แล้ว — ยิงใบต่อไป หรือกด 💾 ไฟล์ Seniorsoft`, 'ok');
    }
    j.rows = j.rows.filter((r) => r.kind !== 'cancel');
    if (!j.rows.length) return;
    const key = groupKey(j.rows[0]);
    const g = groupsRef.current.find((x) => x.key === key);
    // ยิงกล่องเดิมซ้ำตอนยังรอตรวจ = ตกลงตามที่ติ๊กไว้
    if (g && !g.undone && boxStatus(g) === 'pending' && j.rows.every((r) => g.rows.some((x) => x.id === r.id))) {
      await confirm(g);
      return;
    }
    beep(j.rows.every((r) => r.already) ? 'err' : 'ok');
    const merge = (gs) => {
      const old = gs.find((x) => x.key === key);
      const rest = gs.filter((x) => x.key !== key);
      const rows = old && !old.undone ? [...old.rows] : [];   // ยกเลิกไปแล้วยิงใหม่ = เริ่มกรอบใหม่ด้วยข้อมูลสด
      const added = j.rows.filter((r) => !rows.some((x) => x.id === r.id));
      rows.push(...added);
      const keep = old && !old.undone ? old : {};
      // กล่องที่เพิ่งยิงเข้ามา ติ๊กครบไว้ก่อน · กล่องที่อยู่ในกรอบแล้วคงตามที่ติ๊กไว้
      const got = { ...fullGot(added), ...(keep.got || {}) };
      return [{ key, codes: [...new Set([...(old?.codes || []), c])], rows, undone: false, got, note: keep.note || '' }, ...rest];
    };
    groupsRef.current = merge(groupsRef.current);
    setGroups(merge);
  }

  // ยิงรัว ๆ ได้ — เลขที่ยิงเข้ามาระหว่างกำลังค้นกล่องก่อนหน้า ต่อคิวไว้ ช่องยิงไม่ล็อก
  const queue = useRef([]);
  const running = useRef(false);
  async function scan(raw) {
    const codes = String(raw || '').split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
    setCode('');
    input.current?.focus();
    if (!codes.length) return;
    queue.current.push(...codes);
    if (running.current) return;
    running.current = true;
    setBusy(true);
    while (queue.current.length) {
      const c = queue.current.shift();
      try { await scanOne(c); } catch (e) { say(e.message); }
    }
    running.current = false;
    setBusy(false);
    input.current?.focus();
  }

  // ตกลงเฉพาะกล่องที่ติ๊กครบทุกชิ้นแล้ว — กล่องที่ยังไม่ได้เช็คไม่ถูกบันทึกไปด้วย
  async function confirmAll() {
    for (const g of groupsRef.current) {
      const t = tally(g);
      if (boxStatus(g) === 'pending' && t.need > 0 && t.have === t.need) await confirm(g);
    }
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
  const ready = pending.filter((g) => { const t = tally(g); return t.need > 0 && t.have === t.need; });
  const LABEL = { pending: 'รอตรวจ', saved: 'รับครบแล้ว', partial: 'รับไม่ครบ', already: 'รับไปก่อนแล้ว', undone: 'ยกเลิกแล้ว' };
  const TONE = { pending: 'wait', saved: 'ok', partial: 'warn', already: 'warn', undone: 'dim' };

  return (
    <div className="retscan" onClick={refocus} onPointerDown={unlockSound} onKeyDown={unlockSound}>
      <div className="retscan-row">
        <input className="retscan-by" placeholder="ชื่อคนรับ" value={by} onChange={(e) => setBy(e.target.value)} />
        <textarea
          ref={input}
          className="retscan-code"
          rows={1}
          placeholder="ยิงบาร์โค้ดกล่อง / พิมพ์เลขพัสดุ เลขออเดอร์ แล้วกด Enter"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); scan(code); }
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (/[\r\n]/.test(t.trim())) { e.preventDefault(); scan(t); }
          }}
        />
        <button className="btn" disabled={!code.trim()} onClick={() => scan(code)}>{busy ? 'กำลังค้น…' : 'ค้นกล่อง'}</button>
        <Scanner onCode={(c) => scan(c)} />
        <button type="button" className="btn" title="ทดสอบเสียง — ไม่ได้ยิน ให้เช็คลำโพง/เสียงของแท็บ" onClick={() => beep('save')}>🔊 ทดสอบเสียง</button>
      </div>
      {flash && <div className="retscan-flash" data-tone={flash.tone}>{flash.msg}</div>}

      {groups.length > 0 && (
        <div className="retscan-log">
          <div className="retscan-bar">
            <span className="sub">
              ยิงรอบนี้ {groups.filter((g) => boxStatus(g) !== 'undone').length} ออเดอร์
              {pending.length > 0 && <> · <b className="retscan-wait">รอกดตกลง {pending.length}</b></>}
            </span>
            {ready.length > 1 && <button className="btn primary" onClick={confirmAll}>✓ ตกลงทุกกล่องที่ติ๊กครบ ({ready.length})</button>}
            <button className="link" onClick={() => setGroups((gs) => gs.filter((g) => boxStatus(g) === 'pending'))}>ล้างที่เสร็จแล้ว</button>
          </div>
          {groups.map((g) => {
            const st = boxStatus(g);
            const r0 = g.rows[0];
            const items = g.rows.flatMap((r) => (r.items || []).map((it, i) => ({ ...it, rid: r.id, k: itemKey(r.id, i), open: !r.recv })));
            const t = tally(g);
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
                        {t.have === t.need
                          ? <button className="btn primary" onClick={() => confirm(g)}>✓ ครบ ตกลง</button>
                          : t.have > 0
                            ? <button className="btn warn" onClick={() => confirm(g)}>บันทึก ขาด {t.need - t.have} ชิ้น</button>
                            : null}
                        {t.have < t.need && <button className="link" onClick={() => tickAll(g)}>ติ๊กครบทุกชิ้น</button>}
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
                {items.length > 0 && st === 'pending' && (
                  <>
                    <div className="sub retscan-hint">ติ๊กครบไว้ให้แล้ว — ชิ้นไหนไม่มีในกล่อง กดให้เป็นแดง · ได้ {t.have}/{t.need} ชิ้น</div>
                    <div className="retscan-items">
                      {items.map((it) => {
                        const q = Number(it.qty) || 1;
                        const n = Math.min(q, g.got?.[it.k] || 0);
                        return (
                          <button
                            key={it.k}
                            type="button"
                            className="retscan-tick"
                            data-state={!it.open ? 'done' : n >= q ? 'full' : n > 0 ? 'part' : 'none'}
                            disabled={!it.open}
                            onClick={() => setGot(g, it.k, n > 0 ? n - 1 : q)}
                          >
                            <span className="box">{n >= q ? '✓' : ''}</span>
                            {it.image ? <img className="thumb sm" src={it.image} alt="" loading="lazy" /> : null}
                            <span className="mono">{it.sku || '(ไม่มี SKU)'}</span>
                            <b>{q > 1 ? `${n}/${q}` : ''}</b>
                          </button>
                        );
                      })}
                    </div>
                    {t.have > 0 && t.have < t.need && (
                      <input className="retscan-note" placeholder="หมายเหตุ (ถ้ามี) เช่น ได้ของผิดสี"
                        defaultValue={g.note || ''}
                        onChange={(e) => { const v = e.target.value; update(g.key, (x) => ({ ...x, note: v })); }} />
                    )}
                  </>
                )}
                {items.length > 0 && st !== 'pending' && (
                  <div className="retscan-items">
                    {items.map((it) => (
                      <span key={it.k} className="line">
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
