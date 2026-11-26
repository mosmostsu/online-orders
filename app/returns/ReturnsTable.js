'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STATE_LABEL, RECV_LABEL, KIND_LABEL, isLate, toCsv, csvRows, CSV_COLS } from '@/lib/returns';
import { saveAs, saveToSync, pickSyncFolder, syncFolderName, canPickFolder, stamp } from './saveFile';

// ตารางของคืน — 💾 บันทึกทั้งหมด (CSV) / 💾 ไฟล์ Seniorsoft · ปุ่มรับ (บาร์โค้ดอ่านไม่ออก) · ของไม่ครบ · ยกเลิกการรับ
const NAME_KEY = 'order-sync:staff-name';
const PLATFORM_NAME = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop' };
const TH = { timeZone: 'Asia/Bangkok' };
const fmt = (s) => (s ? new Date(s).toLocaleString('th-TH', { ...TH, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const STATE_TONE = { arrived: 'ok', transit: 'warn', waiting: 'dim', failed: 'err', lost: 'err', not_needed: 'dim' };

async function ssCall(init) {
  const res = await fetch('/api/returns/seniorsoft', init);
  const j = await res.json().catch(() => ({ ok: false, error: 'ตอบกลับไม่ถูกต้อง' }));
  if (!j.ok && !j.needSql) throw new Error(j.error || 'ทำไฟล์ไม่สำเร็จ');
  if (j.needSql) throw Object.assign(new Error(j.error), { needSql: true });
  return j;
}
const ssGet = () => ssCall({ cache: 'no-store' }).catch((e) => (e.needSql ? { ok: false, needSql: true, error: e.message } : Promise.reject(e)));
const ssPost = (body) => ssCall({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export default function ReturnsTable({ rows, exportAllHref, total }) {
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(null);
  const [missingFor, setMissingFor] = useState(null);
  const [msg, setMsg] = useState('');
  const [pending, setPending] = useState(null);   // กล่องที่รับแล้วแต่ยังไม่ส่งไฟล์ Seniorsoft
  const [syncName, setSyncName] = useState('');
  const [canPick, setCanPick] = useState(false);
  const router = useRouter();

  const refreshPending = () => ssGet().then(setPending).catch((e) => setPending({ ok: false, error: e.message }));
  useEffect(() => {
    refreshPending();
    setCanPick(canPickFolder());
    syncFolderName().then(setSyncName);
  }, [rows]);

  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function staff() {
    let by = '';
    try { by = localStorage.getItem(NAME_KEY) || ''; } catch { /* ไม่เป็นไร */ }
    if (!by) {
      by = (window.prompt('ชื่อคนรับ') || '').trim();
      if (by) try { localStorage.setItem(NAME_KEY, by); } catch { /* ไม่เป็นไร */ }
    }
    return by;
  }

  async function post(body) {
    const res = await fetch('/api/returns/receive', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({ ok: false, error: 'ตอบกลับไม่ถูกต้อง' }));
    if (!j.ok) throw new Error(j.error || 'บันทึกไม่สำเร็จ');
    return j;
  }

  async function act(id, body) {
    setBusy(id);
    try { await post({ id, ...body }); setMissingFor(null); router.refresh(); } catch (e) { alert(e.message); }
    setBusy(null);
  }

  // 💾 บันทึกทั้งหมด — ไฟล์ CSV ทุกคอลัมน์ เปิดหน้าต่าง "บันทึกเป็น" ให้เลือกที่เก็บเอง
  async function saveAll() {
    setMsg('');
    try {
      const picked = rows.filter((r) => sel.has(r.id));
      const text = picked.length
        ? toCsv(csvRows(picked), CSV_COLS)
        : await fetch(exportAllHref).then((r) => { if (!r.ok) throw new Error('ส่งออกไม่สำเร็จ'); return r.text(); });
      const res = await saveAs(`ของคืน-${stamp()}.csv`, new Blob([text], { type: 'text/csv;charset=utf-8' }),
        { description: 'ไฟล์ CSV (Excel)', accept: { 'text/csv': ['.csv'] } });
      if (!res.cancelled) setMsg(`บันทึกแล้ว: ${res.where}`);
    } catch (e) { setMsg('บันทึกไม่สำเร็จ: ' + e.message); }
  }

  // 💾 ไฟล์ Seniorsoft — "รหัส<TAB>จำนวน" ของที่รับแล้วแต่ยังไม่เคยส่ง (หรือแถวที่ติ๊ก) ลงโฟลเดอร์ sync ใน Drive
  async function saveSeniorsoft() {
    setMsg('');
    try {
      const picked = rows.filter((r) => sel.has(r.id)).map((r) => r.id);
      const j = picked.length ? await ssPost({ ids: picked }) : await ssGet();
      if (j.needSql) { setMsg(j.error); return; }
      if (!j.rows.length) { setMsg(picked.length ? 'แถวที่เลือกยังไม่ได้รับของ' : 'ไม่มีของที่รับใหม่ (ส่งไฟล์ไปครบแล้ว)'); return; }
      const res = await saveToSync(`ตีคืน-${stamp()}.txt`, new Blob([j.text], { type: 'text/plain' }));
      if (res.cancelled) return;
      await ssPost({ ids: j.ids, mark: true });
      setMsg(`บันทึกแล้ว ${j.rows.length} รหัส ${j.pieces} ชิ้น (${j.boxes} กล่อง) → ${res.where}` +
        (j.noSku ? ` · ⚠️ ไม่มีรหัส ${j.noSku} ชิ้น ต้องคีย์เอง` : ''));
      refreshPending();
      setSyncName(await syncFolderName());
    } catch (e) { setMsg('บันทึกไม่สำเร็จ: ' + e.message); }
  }

  async function changeFolder() {
    try { setSyncName(await pickSyncFolder()); } catch { /* กดยกเลิก */ }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'flex-start', gap: 10, margin: '8px 0', flexWrap: 'wrap' }}>
        <button className="btn" onClick={saveAll}>💾 บันทึกทั้งหมด{sel.size ? ` (ที่เลือก ${sel.size})` : ` (${total})`}</button>
        <button className="btn primary ss" onClick={saveSeniorsoft} disabled={pending?.needSql}
          title="รหัส<TAB>จำนวน ของที่รับแล้วแต่ยังไม่เคยส่ง — บันทึกแล้วจดไว้ ไม่ส่งซ้ำ">
          💾 ไฟล์ Seniorsoft{sel.size ? ` (ที่เลือก ${sel.size})` : pending?.ok ? ` (ใหม่ ${pending.boxes} กล่อง)` : ''}
        </button>
        {sel.size > 0 && <button className="link" onClick={() => setSel(new Set())}>ล้างที่เลือก</button>}
        <span className="sub">
          {pending?.needSql ? pending.error : <>โฟลเดอร์ Seniorsoft: {syncName || 'ยังไม่ได้เลือก (เลือกตอนกดครั้งแรก)'}</>}
          {canPick && !pending?.needSql && <> · <button className="link" onClick={changeFolder}>เปลี่ยนโฟลเดอร์</button></>}
        </span>
      </div>
      {msg && <div className="sub" style={{ margin: '0 0 8px' }}>{msg}</div>}

      <table className="orders returns">
        <thead>
          <tr>
            <th style={{ width: 28 }}>
              <input type="checkbox" checked={allOn} aria-label="เลือกทั้งหน้า"
                onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.id)))} />
            </th>
            <th>ออเดอร์</th>
            <th>สินค้า</th>
            <th>สถานะการคืน</th>
            <th>สถานะรับ</th>
            <th style={{ width: 150 }}>จัดการ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.recv ? 'done' : undefined}>
              <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label="เลือก" /></td>
              <td data-label="ออเดอร์">
                <a className="mono" href={`/orders/${encodeURIComponent(r.order_id)}`}>{r.order_id}</a>
                <div className="sku">
                  <span className="plat" data-plat={r.platform}>{PLATFORM_NAME[r.platform] || r.platform}</span>
                  {' · '}{r.shop}{' · '}{KIND_LABEL[r.kind]}
                </div>
                {r.tracking_no && <div className="track"><span className="mono">{r.tracking_no}</span>{r.carrier ? <span className="sku"> · {r.carrier}</span> : null}</div>}
                {r.reason && <div className="sku">{r.reason}</div>}
              </td>
              <td data-label="สินค้า">
                {(r.items || []).map((it, i) => (
                  <div key={i} className="line">
                    {it.image ? <img className="thumb sm" src={it.image} alt="" loading="lazy" /> : <div className="thumb sm thumb-empty" />}
                    <div>
                      <span className="mono">{it.sku || '(ไม่มี SKU)'}</span> × {it.qty}
                      <div className="sku clamp1" tabIndex={0} title={it.name}>{it.name}</div>
                    </div>
                  </div>
                ))}
              </td>
              <td data-label="สถานะการคืน">
                <span className={'badge ' + (STATE_TONE[r.state] || '')}>{STATE_LABEL[r.state] || r.state}</span>
                {isLate(r) && <span className="badge err">ค้างเกิน 7 วัน</span>}
                <div className="sku">
                  {r.kind === 'buyer' ? 'ขอคืน' : 'ตีกลับ'} {fmt(r.started_at)}
                  {r.arrived_at && <><br />ถึงร้าน {fmt(r.arrived_at)}</>}
                </div>
              </td>
              <td data-label="สถานะรับ">
                <span className={'badge ' + (r.recv === 'full' ? 'ok' : r.recv === 'partial' ? 'err' : 'warn')}>{RECV_LABEL[r.recv || 'none']}</span>
                {r.recv && <div className="sku">{r.received_by} · {fmt(r.received_at)}</div>}
                {r.missing?.length > 0 && <div className="sku">ขาด: {r.missing.map((m) => `${m.sku} ×${m.qty}`).join(', ')}</div>}
                {r.receive_note && <div className="sku">{r.receive_note}</div>}
              </td>
              <td data-label="จัดการ">
                {!r.recv ? (
                  <button className="btn" disabled={busy === r.id} onClick={() => { const by = staff(); if (by) act(r.id, { by }); }}>รับ</button>
                ) : (
                  <button className="link" disabled={busy === r.id} onClick={() => { if (confirm('ยกเลิกการรับกล่องนี้?')) act(r.id, { undo: true }); }}>ยกเลิกการรับ</button>
                )}
                {' '}<button className="link" onClick={() => setMissingFor(missingFor === r.id ? null : r.id)}>ของไม่ครบ</button>
                {missingFor === r.id && (
                  <form className="retscan-missing" action={(fd) => {
                    const by = staff(); if (!by) return;
                    const missing = (r.items || []).map((it, i) => ({ sku: it.sku || it.name, qty: Number(fd.get('m' + i)) || 0 })).filter((m) => m.qty > 0);
                    act(r.id, { by, missing, note: String(fd.get('note') || '') });
                  }}>
                    {(r.items || []).map((it, i) => (
                      <label key={i}>
                        <span className="mono">{it.sku || it.name}</span> ขาด
                        <input type="number" name={'m' + i} min={0} max={it.qty} defaultValue={0} style={{ width: 56 }} /> / {it.qty}
                      </label>
                    ))}
                    <input name="note" placeholder="หมายเหตุ" defaultValue={r.receive_note || ''} />
                    <button className="btn">บันทึก</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={6} className="sub" style={{ padding: 24, textAlign: 'center' }}>ไม่มีกล่องในกองนี้</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
