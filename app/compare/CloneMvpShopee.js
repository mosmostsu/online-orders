'use client';
// ปุ่ม "โคลน TikTok MVP → Shopee MVP" ในหน้า /compare กลุ่ม MVP
// Shopee MVP ไม่มี API → ส่วนขยาย MVP Stock Sync (extensions/mvp-stock 1.1+) ส่งเข้า Seller Center จากโปรไฟล์ที่ล็อกอินร้าน MVP
// รายการ/หมวด/แบรนด์มาจาก GET /api/mvp/clone-shopee · ส่วนขยายขอ product_info ทีละตะกร้าจาก POST /api/mvp/clone-shopee แล้วส่งเอง
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

function useMvpExt() {
  const [ext, setExt] = useState(null);   // null = ยังไม่รู้ · false = ไม่มี · { version }
  const [progress, setProgress] = useState(null);
  const waiters = useRef(new Map());
  useEffect(() => {
    const on = (e) => {
      if (e.source !== window || e.data?.source !== 'mvp-ext') return;
      const d = e.data;
      if (d.type === 'mvp-pong') setExt({ version: d.version });
      if (d.type === 'mvp-progress') setProgress(d.progress);
      if (d.type === 'mvp-result' && waiters.current.has(d.id)) { waiters.current.get(d.id)(d.result); waiters.current.delete(d.id); }
    };
    window.addEventListener('message', on);
    window.postMessage({ source: 'order-sync', type: 'mvp-ping', id: 'ping' }, location.origin);
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

export default function CloneMvpShopee() {
  const router = useRouter();
  const { ext, progress, ask } = useMvpExt();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [picks, setPicks] = useState(new Set());
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [out, setOut] = useState(null);

  const ready = (x) => !x.problem && x.shopeeCat;
  async function load() {
    setBusy('load'); setErr(''); setOut(null);
    try {
      const j = await fetch('/api/mvp/clone-shopee').then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setPlan(j);
      setPicks(new Set(j.items.filter((x) => ready(x) && x.shopeeCat.sure).map((x) => x.id)));
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(''); }
  }
  async function run() {
    const ids = [...picks];
    if (!confirm(`โคลน ${ids.length} ตะกร้าจาก TikTok MVP ไป Shopee MVP?\n\nส่วนขยายสร้างใน Seller Center ทีละตัว · ขึ้นขายทันที · ราคาตาม TikTok · สต็อกตาม Seniorsoft`)) return;
    setBusy('run'); setErr(''); setOut(null);
    try {
      const r = await ask('mvp-clone', { ids });
      if (!r?.ok) throw new Error(r?.error || 'ส่วนขยายไม่ตอบ');
      setOut(r);
      setPicks((p) => { const n = new Set(p); for (const c of r.created || []) n.delete(c.id); return n; });
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(''); }
  }
  const toggle = (id) => setPicks((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const items = plan?.items || [];
  const chosen = items.filter((x) => picks.has(x.id) && ready(x)).length;

  return (
    <>
      <button type="button" className="chip" onClick={() => { setOpen(true); if (!plan) load(); }}
        title="ตะกร้า TikTok MVP ที่ Shopee MVP ยังไม่มี — ส่งเข้า Seller Center ด้วยส่วนขยาย MVP Stock Sync">🧬 โคลน TikTok → Shopee MVP</button>
      {open && (
        <div className="cl-back" onClick={() => !busy && setOpen(false)}>
          <div className="cl-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cl-head">
              <div>
                <b className="ast-title">🧬 โคลน TikTok MVP → Shopee MVP</b>
                <div className="sku">เฉพาะตะกร้าที่ Shopee MVP ยังไม่มี SKU ไหนเลย และไม่มีตะกร้าชื่อเดียวกัน · ขึ้นขายทันที · ราคาตาม TikTok · สต็อกตาม Seniorsoft · ไม่แตะตะกร้าเดิม</div>
              </div>
              <span className="cl-headbtns">
                <button type="button" className="chip" onClick={load} disabled={Boolean(busy)}>🔄 โหลดใหม่</button>
                <button type="button" className="chip" onClick={() => { setOpen(false); if (out?.created?.length) router.refresh(); }} disabled={Boolean(busy)}>ปิด</button>
              </span>
            </div>
            {ext === false && (
              <div className="note note-danger">
                ต้องเปิดหน้านี้ใน Chrome โปรไฟล์ที่ล็อกอิน Seller Center ร้าน MVP และติดตั้งส่วนขยาย MVP Stock Sync เวอร์ชัน 1.1 ขึ้นไป (Shopee MVP ไม่มี API)
              </div>
            )}
            {busy === 'load' && <div className="note">กำลังเทียบ TikTok MVP กับ Shopee MVP…</div>}
            {err && <div className="note note-danger">{err}</div>}
            {busy === 'run' && progress && <div className="note">{progress.text}</div>}
            {out && (
              <div className={`note ${out.failed?.length ? 'note-danger' : ''}`}>
                สร้างใน Shopee MVP แล้ว {out.created.length} ตะกร้า{out.failed.length ? ` · ไม่สำเร็จ ${out.failed.length}` : ''}
                {out.failed.length > 0 && <ul className="sku">{out.failed.map((f) => <li key={f.id}>{items.find((x) => x.id === f.id)?.title || f.id} — {f.error}</li>)}</ul>}
              </div>
            )}
            {plan && (
              <>
                <div className="ast-selbar">
                  <b className="ast-selcount">เลือกแล้ว {chosen} / พร้อมโคลน {items.filter(ready).length}</b>
                  <button type="button" className="chip" disabled={Boolean(busy)} onClick={() => setPicks(new Set(items.filter(ready).map((x) => x.id)))}>เลือกทั้งหมดที่พร้อม</button>
                  <button type="button" className="chip" disabled={Boolean(busy)} onClick={() => setPicks(new Set())}>ล้าง</button>
                  <button type="button" className="btn ast-open" disabled={Boolean(busy) || !chosen || !ext} onClick={run}>
                    {busy === 'run' ? 'กำลังโคลน…' : `🚀 โคลน ${chosen} ตัวไป Shopee MVP`}
                  </button>
                </div>
                {items.length === 0 ? <div className="note">Shopee MVP มีครบทุกตะกร้าของ TikTok MVP แล้ว</div> : (
                  <div className="ast-wrap">
                    <table className="ast-table">
                      <thead><tr><th /><th /><th className="l">ตะกร้า TikTok MVP</th><th className="l">หมวด Shopee (โหวต)</th><th className="l">แบรนด์</th><th className="l">สถานะ</th></tr></thead>
                      <tbody>
                        {items.map((x) => {
                          const c = out?.created?.find((y) => y.id === x.id);
                          return (
                            <tr key={x.id} className={picks.has(x.id) ? 'ast-sel' : ''}>
                              <td className="ast-cbcol"><input type="checkbox" className="ast-cb" checked={picks.has(x.id)} disabled={!ready(x) || Boolean(busy) || Boolean(c)} onChange={() => toggle(x.id)} /></td>
                              <td>{x.thumb ? <img src={x.thumb} alt="" className="cl-thumb" /> : null}</td>
                              <td className="l cl-path">{x.title}<div className="sku">{x.n} SKU · {x.category || ''}</div></td>
                              <td className="l cl-path">{x.shopeeCat ? <>{x.shopeeCat.name} <span className={x.shopeeCat.sure ? 'sku' : 'cl-err'}>({x.shopeeCat.votes}/{x.shopeeCat.of}{x.shopeeCat.sure ? '' : ' ตรวจก่อน'})</span></> : '—'}</td>
                              <td className="l">{x.brand || '—'}</td>
                              <td className="l cl-path">
                                {c ? <span className="cl-ok">✅ Shopee {c.productId} ({c.models} ตัวเลือก)</span> : x.problem ? <span className="cl-err">{x.problem}</span> : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
