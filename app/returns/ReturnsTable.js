'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { STATE_LABEL, RECV_LABEL, KIND_LABEL, isLate, toCsv, csvRows, CSV_COLS } from '@/lib/returns';

// ตารางของคืน — ติ๊กเลือกแล้วส่งออก CSV · ปุ่มรับ (บาร์โค้ดอ่านไม่ออก) · ของไม่ครบ · ยกเลิกการรับ
const NAME_KEY = 'order-sync:staff-name';
const PLATFORM_NAME = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop' };
const TH = { timeZone: 'Asia/Bangkok' };
const fmt = (s) => (s ? new Date(s).toLocaleString('th-TH', { ...TH, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const STATE_TONE = { arrived: 'ok', transit: 'warn', waiting: 'dim', failed: 'err', lost: 'err', not_needed: 'dim' };

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReturnsTable({ rows, exportAllHref, total }) {
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(null);
  const [missingFor, setMissingFor] = useState(null);
  const router = useRouter();

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

  function exportSelected() {
    const picked = rows.filter((r) => sel.has(r.id));
    const stamp = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
    download(`returns-${stamp}.csv`, toCsv(csvRows(picked), CSV_COLS));
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'flex-start', gap: 10, margin: '8px 0' }}>
        {sel.size > 0 ? (
          <>
            <button className="btn" onClick={exportSelected}>ส่งออกที่เลือก ({sel.size})</button>
            <button className="link" onClick={() => setSel(new Set())}>ล้างที่เลือก</button>
          </>
        ) : (
          <a className="btn" href={exportAllHref}>ส่งออกทั้งหมดตามตัวกรอง ({total})</a>
        )}
        <span className="sub">ไฟล์ CSV เปิดด้วย Excel ได้</span>
      </div>

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
