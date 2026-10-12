'use client';
// ปุ่ม "โคลน TikTok → Shopee / Lazada" ในหน้า /compare กลุ่ม SOLID — TikTok เป็นหลัก
// แสดงตะกร้า TikTok ที่ปลายทางยังไม่มี SKU ไหนเลย พร้อมหมวด/แบรนด์ (และแอตทริบิวต์บังคับของ Lazada) ที่จะใช้
// ค่าพวกนี้เรียนจากตะกร้าที่ลงทั้งสองร้านแล้ว · ติ๊กแล้วโคลนทีละตัว — เซิร์ฟเวอร์ตรวจซ้ำก่อนสร้างทุกครั้ง ไม่แตะตะกร้าที่มีอยู่แล้ว
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// dest → API /api/xclone/tiktok-<dest>
const DEST = {
  shopee: { label: 'Shopee', cat: 'shopeeCat', live: 'ขึ้นขายทันที' },
  lazada: { label: 'Lazada', cat: 'lazadaCat', live: 'ขึ้นขายหลัง Lazada ตรวจสินค้า (QC)' },
};

export default function CloneFromTiktok({ shop = 'SOLID', dest = 'shopee' }) {
  const D = DEST[dest];
  const api = `/api/xclone/tiktok-${dest}`;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [picks, setPicks] = useState(new Set());
  const [res, setRes] = useState({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const ready = (x) => !x.problem && !x.cloned && x[D.cat];
  async function load() {
    setBusy('load'); setErr(''); setRes({});
    try {
      const j = await fetch(`${api}?shop=${shop}`).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setPlan(j);
      setPicks(new Set(j.items.filter((x) => ready(x) && x[D.cat].sure).map((x) => x.id)));
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(''); }
  }
  async function run() {
    const list = plan.items.filter((x) => picks.has(x.id) && ready(x) && res[x.id]?.s !== 'ok');
    if (!list.length) return;
    if (!confirm(`โคลน ${list.length} ตะกร้าจาก TikTok ${shop} ไป ${D.label} ${shop}?\n\n${D.live} · ราคาตาม TikTok · สต็อกตาม Seniorsoft`)) return;
    setBusy('run');
    for (const x of list) {
      setRes((r) => ({ ...r, [x.id]: { s: 'run' } }));
      try {
        const j = await fetch(api, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: x.id, shop }),
        }).then((r) => r.json()).catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ไม่ตอบ (อาจหมดเวลา) — ตรวจใน ${D.label} ก่อนกดซ้ำ` }));
        if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
        setRes((r) => ({ ...r, [x.id]: { s: 'ok', itemId: j.itemId, models: j.models, warn: (j.warnings || []).join(' · ') } }));
        setPicks((s) => { const n = new Set(s); n.delete(x.id); return n; });
      } catch (e) {
        setRes((r) => ({ ...r, [x.id]: { s: 'err', msg: String(e.message || e) } }));
      }
    }
    setBusy('');
  }
  const close = () => { setOpen(false); if (Object.values(res).some((r) => r.s === 'ok')) router.refresh(); };
  const toggle = (id) => setPicks((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const items = plan?.items || [];
  const chosen = items.filter((x) => picks.has(x.id) && ready(x)).length;

  return (
    <>
      <button type="button" className="chip" onClick={() => { setOpen(true); if (!plan) load(); }}
        title={`ตะกร้า TikTok ${shop} ที่ ${D.label} ${shop} ยังไม่มี`}>🧬 โคลน TikTok → {D.label}</button>
      {open && (
        <div className="cl-back" onClick={() => !busy && close()}>
          <div className="cl-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cl-head">
              <div>
                <b className="ast-title">🧬 โคลน TikTok {shop} → {D.label} {shop}</b>
                <div className="sku">เฉพาะตะกร้าที่ {D.label} ยังไม่มี SKU ไหนเลย · {D.live} · ราคาตาม TikTok · สต็อกตาม Seniorsoft · ไม่แตะตะกร้าเดิม</div>
              </div>
              <span className="cl-headbtns">
                <button type="button" className="chip" onClick={load} disabled={Boolean(busy)}>🔄 โหลดใหม่</button>
                <button type="button" className="chip" onClick={close} disabled={Boolean(busy)}>ปิด</button>
              </span>
            </div>
            {busy === 'load' && <div className="note">กำลังเทียบ TikTok กับ {D.label} และอ่านหมวดจาก TikTok…</div>}
            {err && <div className="note note-danger">{err}</div>}
            {plan && (
              <>
                <div className="ast-selbar">
                  <b className="ast-selcount">เลือกแล้ว {chosen} / พร้อมโคลน {items.filter(ready).length}</b>
                  <button type="button" className="chip" disabled={Boolean(busy)} onClick={() => setPicks(new Set(items.filter(ready).map((x) => x.id)))}>เลือกทั้งหมดที่พร้อม</button>
                  <button type="button" className="chip" disabled={Boolean(busy)} onClick={() => setPicks(new Set())}>ล้าง</button>
                  <button type="button" className="btn ast-open" disabled={Boolean(busy) || !chosen} onClick={run}>
                    {busy === 'run' ? 'กำลังโคลน…' : `โคลน ${chosen} ตัวไป ${D.label}`}
                  </button>
                </div>
                <div className="sku" style={{ marginBottom: 6 }}>
                  หมวดเดาจากตะกร้าที่ลงทั้งสองร้านแล้ว — ตัวที่โหวตไม่ถึง 60% ไม่ติ๊กให้ (ตรวจก่อน) · แผนที่สร้างเมื่อ {plan.mapBuiltAt?.slice(0, 10)}
                </div>
                {items.length === 0 ? <div className="note">{D.label} มีครบทุกตะกร้าของ TikTok แล้ว</div> : (
                  <div className="ast-wrap">
                    <table className="ast-table">
                      <thead><tr><th /><th /><th className="l">ตะกร้า TikTok</th><th className="l">หมวด {D.label} (โหวต)</th><th className="l">แบรนด์</th><th className="l">สถานะ</th></tr></thead>
                      <tbody>
                        {items.map((x) => {
                          const r = res[x.id];
                          return (
                            <tr key={x.id} className={picks.has(x.id) ? 'ast-sel' : ''}>
                              <td className="ast-cbcol">
                                <input type="checkbox" className="ast-cb" checked={picks.has(x.id)} disabled={!ready(x) || Boolean(busy) || r?.s === 'ok'} onChange={() => toggle(x.id)} />
                              </td>
                              <td>{x.thumb ? <img src={x.thumb} alt="" className="cl-thumb" /> : null}</td>
                              <td className="l cl-path">{x.title}<div className="sku">{x.n} SKU · {x.category || ''}</div></td>
                              <td className="l cl-path">
                                {x[D.cat] ? <>{x[D.cat].name} <span className={x[D.cat].sure ? 'sku' : 'cl-err'}>({x[D.cat].votes}/{x[D.cat].of}{x[D.cat].sure ? '' : ' ตรวจก่อน'})</span></> : '—'}
                                {x.attrs && Object.keys(x.attrs).length > 0 && (
                                  <div className="sku">แอตทริบิวต์บังคับ: {Object.entries(x.attrs).map(([k, v]) => `${k}=${v ?? '—'}`).join(' · ')}</div>
                                )}
                              </td>
                              <td className="l">{x.brand || '—'}</td>
                              <td className="l cl-path">
                                {x.cloned && <span className="sku">โคลนไปแล้ว {x.cloned.thisshop_spu_id || ''}</span>}
                                {!x.cloned && x.problem && !r && <span className="cl-err">{x.problem}</span>}
                                {r?.s === 'run' && '⏳ กำลังสร้าง…'}
                                {r?.s === 'ok' && <span className="cl-ok">✅ {D.label} {r.itemId} ({r.models} ตัวเลือก){r.warn ? ` · ⚠ ${r.warn}` : ''}</span>}
                                {r?.s === 'err' && <span className="cl-err">❌ {r.msg}</span>}
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
