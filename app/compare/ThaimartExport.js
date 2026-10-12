'use client';
// ปุ่ม "สร้างไฟล์นำเข้า Thaimart" ในหน้า /compare กลุ่ม SOLID — TikTok SOLID เป็นหลัก
// เลือกตะกร้าที่ Thaimart ยังไม่มี → ได้ไฟล์ .xlsx แยกตามหมวด (≤500 แถว) ไปอัปโหลดเองที่ seller.thaimart.com → นำเข้าสินค้า
// ไม่เขียนอะไรลง Thaimart และไม่แตะตะกร้าที่มีอยู่แล้ว (เซิร์ฟเวอร์ตรวจซ้ำตอนสร้างไฟล์)
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// คุยกับส่วนขยาย Chrome "Thaimart Stock Sync" (extensions/thaimart-stock) ผ่าน content-bridge.js
// ติดตั้งในโปรไฟล์ที่ล็อกอิน seller.thaimart.com แล้ว → กดส่งเข้า Thaimart ได้เลย ไม่ต้องอัปโหลดไฟล์เอง
function useThaimartExt() {
  const [ext, setExt] = useState(null);   // null = ยังไม่รู้ · false = ไม่มี · { version }
  const waiters = useRef(new Map());
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    const on = (e) => {
      if (e.source !== window || e.data?.source !== 'tm-ext') return;
      const d = e.data;
      if (d.type === 'tm-pong') setExt({ version: d.version });
      if (d.type === 'tm-progress') setProgress(d.progress);
      if (d.type === 'tm-result' && waiters.current.has(d.id)) { waiters.current.get(d.id)(d.result); waiters.current.delete(d.id); }
    };
    window.addEventListener('message', on);
    window.postMessage({ source: 'order-sync', type: 'tm-ping', id: 'ping' }, location.origin);
    const t = setTimeout(() => setExt((x) => x || false), 1500);
    return () => { window.removeEventListener('message', on); clearTimeout(t); };
  }, []);
  const ask = (type, extra = {}) => new Promise((resolve) => {
    const id = `${type}-${Date.now()}`;
    waiters.current.set(id, resolve);
    window.postMessage({ source: 'order-sync', type, id, ...extra }, location.origin);
  });
  return { ext, progress, ask };
}

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

// ids: ตะกร้า TikTok ที่ติ๊กไว้ในหน้า (SolidSelect) → แผงโชว์เฉพาะตัวนั้น · null = ทุกตะกร้าที่ Thaimart ยังไม่มี
export default function ThaimartExport({ ids = null }) {
  const router = useRouter();
  const { ext, progress, ask } = useThaimartExt();
  const [sent, setSent] = useState(null);   // ผลส่งเข้า Thaimart ผ่านส่วนขยาย
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(null);
  const want = ids ? new Set(ids) : null;
  const items = all ? (want ? all.filter((x) => want.has(x.id)) : all) : null;
  const outside = want && all ? [...want].filter((id) => !all.some((x) => x.id === id)).length : 0;
  const scopeIds = (list) => (want ? list.filter((x) => want.has(x.id)) : list).map((x) => x.id);
  const [picks, setPicks] = useState(new Set());
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [out, setOut] = useState(null);

  async function load() {
    setBusy('load'); setErr(''); setOut(null);
    try {
      const j = await fetch('/api/thaimart/export').then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setAll(j.items);
      setPicks(new Set(scopeIds(j.items)));
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(''); }
  }
  // ส่งเป็นชุดละ BATCH ตะกร้า — 74 ตะกร้าในคำขอเดียวใช้ ~23 วินาที ใกล้เพดานเวลาของ Netlify (~26 วินาที)
  const BATCH = 25;
  const [prog, setProg] = useState('');
  async function build() {
    setBusy('build'); setErr(''); setOut(null);
    try {
      const ids = [...picks];
      const all = { files: [], skipped: [], warnings: [] };
      const n = Math.ceil(ids.length / BATCH);
      for (let i = 0; i < n; i += 1) {
        setProg(`ชุด ${i + 1}/${n}`);
        const j = await fetch('/api/thaimart/export', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: ids.slice(i * BATCH, (i + 1) * BATCH) }),
        }).then((r) => r.json()).catch(() => ({ ok: false, error: 'เซิร์ฟเวอร์ไม่ตอบ (อาจหมดเวลา) ลองใหม่' }));
        if (!j.ok) throw new Error(`ชุด ${i + 1}/${n}: ${j.error || 'สร้างไฟล์ไม่สำเร็จ'}`);
        // ชื่อไฟล์ของแต่ละชุดซ้ำกันได้ (นาทีเดียวกัน ส่วนที่ 1) — ต่อเลขชุดท้ายชื่อ
        all.files.push(...j.files.map((f) => (n > 1 ? { ...f, name: f.name.replace(/\.xlsx$/, `-b${i + 1}.xlsx`) } : f)));
        all.skipped.push(...j.skipped);
        all.warnings.push(...j.warnings);
      }
      setOut(all);
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(''); setProg(''); }
  }
  const toggle = (id) => setPicks((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function push() {
    const list = [...picks];
    if (!confirm(`ส่ง ${list.length} ตะกร้าเข้า Thaimart (Solid Sports) แล้วเผยแพร่เลย?\n\nส่วนขยายจะตรวจ SKU สดใน Thaimart อีกรอบ ตัวที่มีแล้วจะไม่สร้างซ้ำ`)) return;
    setBusy('push'); setErr(''); setSent(null);
    try {
      const r = await ask('tm-clone', { ids: list });
      if (!r?.ok) throw new Error(r?.error || 'ส่วนขยายไม่ตอบ');
      setSent(r);
      setPicks((p) => { const n = new Set(p); for (const c of r.created || []) n.delete(c.id); return n; });
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(''); }
  }

  return (
    <>
      <button type="button" className="chip" onClick={() => { setOpen(true); if (!all) load(); else setPicks(new Set(scopeIds(all))); }}
        title="TikTok SOLID เป็นหลัก — สร้างไฟล์ Excel ของตะกร้าที่ Thaimart ยังไม่มี">📄 {ids ? `Thaimart (${ids.length})` : 'ไฟล์นำเข้า Thaimart'}</button>
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
                  {ext && (
                    <button type="button" className="btn ast-open" disabled={Boolean(busy) || !picks.size} onClick={push}
                      title="ส่วนขยาย Thaimart Stock Sync ส่งเข้าร้านให้เลย (ต้องล็อกอิน seller.thaimart.com ค้างไว้ในโปรไฟล์นี้)">
                      {busy === 'push' ? 'กำลังส่งเข้า Thaimart…' : `🚀 ส่งเข้า Thaimart เลย (${picks.size})`}
                    </button>
                  )}
                  <button type="button" className={ext ? 'chip' : 'btn ast-open'} disabled={Boolean(busy) || !picks.size} onClick={build}>
                    {busy === 'build' ? `กำลังสร้างไฟล์… ${prog}` : `📄 สร้างไฟล์ (${picks.size} ตะกร้า)`}
                  </button>
                </div>
                {ext === false && (
                  <div className="sku">ส่งเข้า Thaimart อัตโนมัติได้ถ้าติดตั้งส่วนขยาย Thaimart Stock Sync (เวอร์ชัน 1.1 ขึ้นไป) ในโปรไฟล์ที่ล็อกอิน Thaimart — ตอนนี้ใช้ไฟล์ไปก่อน</div>
                )}
                {busy === 'push' && progress && (
                  <div className="note">{progress.text}{progress.total ? ` (${progress.done}/${progress.total})` : ''}</div>
                )}
                {sent && (
                  <div className={`note ${sent.created?.length ? '' : 'note-danger'}`}>
                    สร้างใน Thaimart แล้ว {sent.created?.length || 0} ตะกร้า · เผยแพร่ {sent.published || 0}
                    {sent.notFound?.length ? ` · ยังไม่เห็นในร้าน ${sent.notFound.length} (อาจยังสร้างอยู่ ตรวจในหลังร้าน)` : ''}
                    {sent.note ? ` · ${sent.note}` : ''}
                    {sent.skipped?.length > 0 && <ul className="sku">{sent.skipped.map((x) => <li key={x.id}>{x.title || x.id} — {x.why}</li>)}</ul>}
                    {sent.created?.length > 0 && <div><button type="button" className="chip" onClick={() => { setOpen(false); router.refresh(); }}>ปิดแล้วโหลดหน้าใหม่</button></div>}
                  </div>
                )}
                {outside > 0 && <div className="note">ที่ติ๊กไว้ {outside} ตะกร้า ไม่อยู่ในรายการ — Thaimart มี SKU ของตะกร้านั้นแล้ว (หรือตะกร้าไม่ได้ขายอยู่)</div>}
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
