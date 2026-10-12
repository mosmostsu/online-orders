'use client';
// ปุ่ม "สร้างไฟล์นำเข้า Thaimart" ในหน้า /compare กลุ่ม SOLID — TikTok SOLID เป็นหลัก
// เลือกตะกร้าที่ Thaimart ยังไม่มี → ได้ไฟล์ .xlsx แยกตามหมวด (≤500 แถว) ไปอัปโหลดเองที่ seller.thaimart.com → นำเข้าสินค้า
// ไม่เขียนอะไรลง Thaimart และไม่แตะตะกร้าที่มีอยู่แล้ว (เซิร์ฟเวอร์ตรวจซ้ำตอนสร้างไฟล์)
import { useState } from 'react';

function download(name, b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function ThaimartExport() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [picks, setPicks] = useState(new Set());
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [out, setOut] = useState(null);

  async function load() {
    setBusy('load'); setErr(''); setOut(null);
    try {
      const j = await fetch('/api/thaimart/export').then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setItems(j.items);
      setPicks(new Set(j.items.map((x) => x.id)));
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(''); }
  }
  async function build() {
    setBusy('build'); setErr(''); setOut(null);
    try {
      const j = await fetch('/api/thaimart/export', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [...picks] }),
      }).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'สร้างไฟล์ไม่สำเร็จ');
      setOut(j);
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(''); }
  }
  const toggle = (id) => setPicks((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <button type="button" className="chip" onClick={() => { setOpen(true); if (!items) load(); }}
        title="TikTok SOLID เป็นหลัก — สร้างไฟล์ Excel ของตะกร้าที่ Thaimart ยังไม่มี">📄 ไฟล์นำเข้า Thaimart</button>
      {open && (
        <div className="cl-back" onClick={() => !busy && setOpen(false)}>
          <div className="cl-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cl-head">
              <div>
                <b className="ast-title">📄 ไฟล์นำเข้า Thaimart (TikTok SOLID เป็นหลัก)</b>
                <div className="sku">เฉพาะตะกร้าที่ Thaimart ยังไม่มี SKU ไหนเลย · ไม่แตะตะกร้าเดิม · สต็อกตาม Seniorsoft · ราคาตาม TikTok</div>
              </div>
              <span className="cl-headbtns">
                <button type="button" className="chip" onClick={load} disabled={Boolean(busy)}>🔄 โหลดใหม่</button>
                <button type="button" className="chip" onClick={() => setOpen(false)} disabled={Boolean(busy)}>ปิด</button>
              </span>
            </div>

            {busy === 'load' && <div className="note">กำลังเทียบ TikTok SOLID กับ Thaimart…</div>}
            {err && <div className="note note-danger">{err}</div>}

            {items && !out && (
              <>
                <div className="ast-selbar">
                  <b className="ast-selcount">เลือกแล้ว {picks.size} / {items.length} ตะกร้า</b>
                  <button type="button" className="chip" disabled={Boolean(busy)} onClick={() => setPicks(new Set(items.map((x) => x.id)))}>เลือกทั้งหมด</button>
                  <button type="button" className="chip" disabled={Boolean(busy)} onClick={() => setPicks(new Set())}>ล้าง</button>
                  <button type="button" className="btn ast-open" disabled={Boolean(busy) || !picks.size} onClick={build}>
                    {busy === 'build' ? 'กำลังสร้างไฟล์… (ราว 10–20 วินาที)' : `สร้างไฟล์ (${picks.size} ตะกร้า)`}
                  </button>
                </div>
                {items.length === 0 ? <div className="note">Thaimart มีครบทุกตะกร้าของ TikTok SOLID แล้ว</div> : (
                  <div className="ast-wrap">
                    <table className="ast-table">
                      <tbody>
                        {items.map((x) => (
                          <tr key={x.id} className={picks.has(x.id) ? 'ast-sel' : ''}>
                            <td className="ast-cbcol"><input type="checkbox" className="ast-cb" checked={picks.has(x.id)} disabled={Boolean(busy)} onChange={() => toggle(x.id)} /></td>
                            <td>{x.thumb ? <img src={x.thumb} alt="" className="cl-thumb" /> : null}</td>
                            <td className="l cl-path">{x.title}</td>
                            <td className="ast-num">{x.n} SKU</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {out && (
              <div className="cl-sec">
                <b>ไฟล์พร้อมอัปโหลด ({out.files.length} ไฟล์)</b>
                <div className="sku">อัปโหลดที่ seller.thaimart.com → นำเข้าสินค้า · <b>เลือกหมวดให้ตรงกับชื่อไฟล์</b> · 1 ไฟล์ = 1 หมวด</div>
                <table className="ast-table" style={{ marginTop: 8 }}>
                  <tbody>
                    {out.files.map((f) => (
                      <tr key={f.name}>
                        <td className="l"><b>{f.label}</b><div className="sku mono">{f.name}</div></td>
                        <td className="ast-num">{f.baskets} ตะกร้า · {f.rows} แถว</td>
                        <td><button type="button" className="btn ast-open" onClick={() => download(f.name, f.b64)}>ดาวน์โหลด</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {out.skipped.length > 0 && (
                  <details className="cl-sec" open>
                    <summary><b>ข้าม {out.skipped.length} ตะกร้า</b></summary>
                    <ul className="sku">{out.skipped.map((s) => <li key={s.id}>{s.title || s.id} — {s.why}</li>)}</ul>
                  </details>
                )}
                {out.warnings.length > 0 && (
                  <details className="cl-sec">
                    <summary><b>ข้อควรตรวจ {out.warnings.length} ตะกร้า</b> (เติมคู่ตัวเลือกที่ขาด/ย่อชื่อ ฯลฯ)</summary>
                    <ul className="sku">{out.warnings.map((w) => <li key={w.id}>{w.title} — {w.notes.join(' · ')}</li>)}</ul>
                  </details>
                )}
                <button type="button" className="chip" onClick={() => setOut(null)} style={{ marginTop: 8 }}>← กลับไปเลือก</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
