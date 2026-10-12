'use client';
// ปุ่ม "โคลน TikTok → Shopee" ในหน้า /compare กลุ่ม SOLID — TikTok เป็นหลัก
// แสดงตะกร้า TikTok ที่ Shopee ยังไม่มี SKU ไหนเลย พร้อมหมวด/แบรนด์ที่จะใช้ (เรียนจากตะกร้าที่ลงทั้งสองร้านแล้ว)
// ติ๊กแล้วโคลนทีละตัว (ขึ้นขายทันที) — เซิร์ฟเวอร์ตรวจซ้ำก่อนสร้างทุกครั้ง ไม่แตะตะกร้าที่มีอยู่แล้ว
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CloneTiktokShopee({ shop = 'SOLID' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [picks, setPicks] = useState(new Set());
  const [res, setRes] = useState({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const ready = (x) => !x.problem && !x.cloned && x.shopeeCat;
  async function load() {
    setBusy('load'); setErr(''); setRes({});
    try {
      const j = await fetch(`/api/xclone/tiktok-shopee?shop=${shop}`).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setPlan(j);
      setPicks(new Set(j.items.filter((x) => ready(x) && x.shopeeCat.sure).map((x) => x.id)));
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(''); }
  }
  async function run() {
    const list = plan.items.filter((x) => picks.has(x.id) && ready(x) && res[x.id]?.s !== 'ok');
    if (!list.length) return;
    if (!confirm(`โคลน ${list.length} ตะกร้าจาก TikTok ${shop} ไป Shopee ${shop}?\n\nขึ้นขายทันที · ราคาตาม TikTok · สต็อกตาม Seniorsoft`)) return;
    setBusy('run');
    for (const x of list) {
      setRes((r) => ({ ...r, [x.id]: { s: 'run' } }));
      try {
        const j = await fetch('/api/xclone/tiktok-shopee', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: x.id, shop }),
        }).then((r) => r.json()).catch(() => ({ ok: false, error: 'เซิร์ฟเวอร์ไม่ตอบ (อาจหมดเวลา) — ตรวจใน Shopee ก่อนกดซ้ำ' }));
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
        title={`ตะกร้า TikTok ${shop} ที่ Shopee ${shop} ยังไม่มี`}>🧬 โคลน TikTok → Shopee</button>
      {open && (
        <div className="cl-back" onClick={() => !busy && close()}>
          <div className="cl-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cl-head">
              <div>
                <b className="ast-title">🧬 โคลน TikTok {shop} → Shopee {shop}</b>
                <div className="sku">เฉพาะตะกร้าที่ Shopee ยังไม่มี SKU ไหนเลย · ขึ้นขายทันที · ราคาตาม TikTok · สต็อกตาม Seniorsoft · ไม่แตะตะกร้าเดิม</div>
              </div>
              <span className="cl-headbtns">
                <button type="button" className="chip" onClick={load} disabled={Boolean(busy)}>🔄 โหลดใหม่</button>
                <button type="button" className="chip" onClick={close} disabled={Boolean(busy)}>ปิด</button>
              </span>
            </div>
            {busy === 'load' && <div className="note">กำลังเทียบ TikTok กับ Shopee และอ่านหมวดจาก TikTok…</div>}
            {err && <div className="note note-danger">{err}</div>}
            {plan && (
              <>
                <div className="ast-selbar">
                  <b className="ast-selcount">เลือกแล้ว {chosen} / พร้อมโคลน {items.filter(ready).length}</b>
                  <button type="button" className="chip" disabled={Boolean(busy)} onClick={() => setPicks(new Set(items.filter(ready).map((x) => x.id)))}>เลือกทั้งหมดที่พร้อม</button>
                  <button type="button" className="chip" disabled={Boolean(busy)} onClick={() => setPicks(new Set())}>ล้าง</button>
                  <button type="button" className="btn ast-open" disabled={Boolean(busy) || !chosen} onClick={run}>
                    {busy === 'run' ? 'กำลังโคลน…' : `โคลน ${chosen} ตัวไป Shopee`}
                  </button>
                </div>
                <div className="sku" style={{ marginBottom: 6 }}>
                  หมวดเดาจากตะกร้าที่ลงทั้งสองร้านแล้ว — ตัวที่โหวตไม่ถึง 60% ไม่ติ๊กให้ (ตรวจก่อน) · แผนที่สร้างเมื่อ {plan.mapBuiltAt?.slice(0, 10)}
                </div>
                {items.length === 0 ? <div className="note">Shopee มีครบทุกตะกร้าของ TikTok แล้ว</div> : (
                  <div className="ast-wrap">
                    <table className="ast-table">
                      <thead><tr><th /><th /><th className="l">ตะกร้า TikTok</th><th className="l">หมวด Shopee (โหวต)</th><th className="l">แบรนด์</th><th className="l">สถานะ</th></tr></thead>
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
                              <td className="l">{x.shopeeCat ? <>{x.shopeeCat.id} <span className={x.shopeeCat.sure ? 'sku' : 'cl-err'}>({x.shopeeCat.votes}/{x.shopeeCat.of})</span></> : '—'}</td>
                              <td className="l">{x.brand || '—'}</td>
                              <td className="l cl-path">
                                {x.cloned && <span className="sku">โคลนไปแล้ว {x.cloned.thisshop_spu_id || ''}</span>}
                                {!x.cloned && x.problem && !r && <span className="cl-err">{x.problem}</span>}
                                {r?.s === 'run' && '⏳ กำลังสร้าง…'}
                                {r?.s === 'ok' && <span className="cl-ok">✅ Shopee {r.itemId} ({r.models} ตัวเลือก){r.warn ? ` · ⚠ ${r.warn}` : ''}</span>}
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
