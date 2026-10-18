'use client';
// ปุ่ม "เติม ThisShop" ท้ายแถวหน้า /compare (กลุ่มที่มี Shopee REAL + ThisShop) — เพิ่มสี/ไซส์ที่ ThisShop ขาดให้เหมือน Shopee REAL
// ThisShop ไม่มี API แก้ตะกร้า → ส่วนขยาย ThisShop Fill (extensions/thisshop-fill) กดในหลังบ้าน sale.thisshop.com แทนคน
//   1. ถามแผนจาก POST /api/basket/thisshop-fill (ตัวเลือกที่ขาด ชื่อ ราคา คลัง รูป) → โชว์ให้ดูก่อน
//   2. กด "ทดลอง" = ส่วนขยายทำทุกขั้นแต่ไม่บันทึก · กด "เพิ่มเลย" = บันทึกจริง
//   3. บันทึกแล้วตรวจตะกร้าสดอีกรอบ (action: 'verify') แล้วรีเฟรชแถว
// ป็อปอัพวาดผ่าน portal — ปุ่มอยู่ใน <summary> คลิกในป็อปอัพจะได้ไม่ไปพับ/กางแถว
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

let extPromise = null;
function pingExt() {
  if (extPromise) return extPromise;
  extPromise = new Promise((resolve) => {
    const on = (e) => {
      if (e.source !== window || e.data?.source !== 'tsfill-ext' || e.data.type !== 'tsfill-pong') return;
      window.removeEventListener('message', on);
      resolve({ version: e.data.version });
    };
    window.addEventListener('message', on);
    window.postMessage({ source: 'order-sync', type: 'tsfill-ping', id: 'ping' }, location.origin);
    setTimeout(() => { window.removeEventListener('message', on); resolve(false); }, 1500);
  });
  return extPromise;
}

const money = (n) => Number(n).toLocaleString('en-US');

export default function ThisShopFill({ shopeeItemId, spuId, items }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ext, setExt] = useState(null);       // null = ยังไม่รู้ · false = ไม่มี · { version }
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState('');      // load | dry | run | verify
  const [err, setErr] = useState('');
  const [out, setOut] = useState(null);      // ผลจากส่วนขยาย
  const [check, setCheck] = useState(null);  // ผลตรวจหลังบันทึก
  const [progress, setProgress] = useState('');
  const waiter = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const on = (e) => {
      if (e.source !== window || e.data?.source !== 'tsfill-ext') return;
      if (e.data.type === 'tsfill-progress' && e.data.progress?.spuId === spuId) setProgress(e.data.progress.text || '');
      if (e.data.type === 'tsfill-result' && waiter.current?.id === e.data.id) { waiter.current.resolve(e.data.result); waiter.current = null; }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [open, spuId]);

  async function load() {
    setBusy('load'); setErr(''); setOut(null); setCheck(null); setPlan(null);
    try {
      const [x, res] = await Promise.all([pingExt(), fetch('/api/basket/thisshop-fill', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopeeItemId, spuId }),
      })]);
      setExt(x);
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error || 'วางแผนไม่สำเร็จ');
      setPlan(j);
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(''); }
  }

  const ask = (dry) => new Promise((resolve) => {
    const id = `fill-${Date.now()}`;
    waiter.current = { id, resolve };
    window.postMessage({ source: 'order-sync', type: 'tsfill-run', id, plan, dry }, location.origin);
  });

  async function run(dry) {
    if (!dry && !confirm(`เพิ่ม ${plan.add.length} ตัวเลือกในตะกร้า ThisShop ${spuId}?\n\nส่วนขยายจะเปิดหลังบ้านแล้วกดบันทึกจริง · SKU เดิมไม่แตะ`)) return;
    setBusy(dry ? 'dry' : 'run'); setErr(''); setOut(null); setCheck(null); setProgress('');
    try {
      const r = await ask(dry);
      setOut(r);
      if (!r?.ok) throw new Error(`${r?.error || 'ส่วนขยายไม่ตอบ'}${r?.step ? ` (ขั้น ${r.step})` : ''}`);
      if (!dry) {
        setBusy('verify');
        const v = await fetch('/api/basket/thisshop-fill', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'verify', spuId, keep: plan.keep, add: plan.add }),
        }).then((x) => x.json()).catch(() => null);
        setCheck(v || { ok: false, error: 'ตรวจหลังบันทึกไม่ได้' });
        // ดึงตะกร้าในแถวนี้ใหม่ (เหมือนปุ่ม ↻) ให้หน้าเห็นตัวเลือกใหม่
        await fetch('/api/sync/product-one', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items, thisshop: true }),
        }).catch(() => null);
      }
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(''); }
  }

  const close = () => {
    if (busy) return;
    setOpen(false);
    if (check) router.refresh();
  };
  const saved = out?.ok && !out.dry;

  return (
    <>
      <button type="button" className="cmp-rbtn" title="เพิ่มสี/ไซส์ที่ ThisShop ขาดให้เหมือน Shopee REAL (ส่วนขยาย ThisShop Fill)"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); load(); }}>➕</button>
      {open && createPortal(
        <div className="cl-back" onClick={close}>
          <div className="cl-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cl-head">
              <div>
                <b className="ast-title">➕ เติม ThisShop ให้เหมือน Shopee REAL</b>
                <div className="sku">
                  เพิ่มเฉพาะตัวเลือกที่ Shopee REAL มีแต่ ThisShop ไม่มี · ราคาป้ายเต็ม · คลังจาก ST · รูปสีจาก Shopee · SKU เดิมไม่แตะ
                  {plan?.title ? <> · ThisShop: {plan.title}</> : null}
                </div>
              </div>
              <span className="cl-headbtns">
                <button type="button" className="chip" onClick={load} disabled={Boolean(busy)}>🔄 วางแผนใหม่</button>
                <button type="button" className="chip" onClick={close} disabled={Boolean(busy)}>ปิด</button>
              </span>
            </div>

            {busy === 'load' && <div className="note">กำลังเทียบ Shopee REAL กับ ThisShop…</div>}
            {ext === false && (
              <div className="note note-danger">
                ยังไม่ได้ติดตั้งส่วนขยาย ThisShop Fill ใน Chrome นี้ — chrome://extensions → Developer mode → Load unpacked → โฟลเดอร์ extensions/thisshop-fill
                (และต้องล็อกอินหลังบ้าน sale.thisshop.com ค้างไว้)
              </div>
            )}
            {err && <div className="note note-danger">{err}</div>}
            {(busy === 'dry' || busy === 'run') && <div className="note">{progress || 'ส่วนขยายกำลังทำงาน…'} — อย่าปิดแท็บหลังบ้านที่เปิดขึ้นมา</div>}
            {busy === 'verify' && <div className="note">บันทึกแล้ว กำลังตรวจตะกร้า ThisShop อีกรอบ…</div>}
            {out?.ok && out.dry && (
              <div className="note">✅ ทดลองผ่าน (ยังไม่บันทึก) — {(out.log || []).join(' · ')}</div>
            )}
            {saved && check && (
              <div className={`note ${check.ok ? '' : 'note-danger'}`}>
                {check.ok
                  ? `✅ เพิ่มแล้ว ${out.added} ตัวเลือก · ตะกร้าตอนนี้มี ${check.total} SKU · SKU เดิมอยู่ครบ`
                  : `⚠ บันทึกแล้วแต่ตรวจไม่ผ่าน — SKU เดิมหาย: ${(check.lostOld || []).join(', ') || '-'} · ตัวใหม่ยังไม่ขึ้น: ${(check.notAdded || []).join(', ') || '-'} ${check.error || ''}`}
              </div>
            )}
            {out && !out.ok && out.log?.length > 0 && <div className="sku">ทำไปแล้ว: {out.log.join(' · ')}</div>}

            {plan?.nothing && <div className="note">ThisShop มีครบทุกตัวเลือกของ Shopee REAL แล้ว</div>}
            {plan && !plan.nothing && (
              <>
                <div className="sku" style={{ margin: '6px 0' }}>
                  SKU เดิม {plan.keep.length} ตัว (ไม่แตะ) · จะเพิ่ม {plan.add.length} ตัว
                  {plan.extra > 0 ? ` · หลังบ้านจะสร้างแถวเกิน ${plan.extra} แถว (ส่วนขยายลบให้ก่อนบันทึก)` : ''}
                </div>
                {plan.tiers.filter((t) => t.add.length).map((t) => (
                  <div key={t.name} className="sku" style={{ margin: '4px 0' }}>
                    {t.name} ใหม่:{' '}
                    {t.add.map((a) => (
                      <span key={a.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 10 }}>
                        {a.image ? <img src={a.image} alt="" className="thumb xs" /> : null}<b>{a.value}</b>
                      </span>
                    ))}
                  </div>
                ))}
                <div className="ast-wrap">
                  <table className="ast-table">
                    <thead><tr><th className="l">รหัส</th><th className="l">ตัวเลือก ({plan.tiers.map((t) => t.name).join(' / ')})</th><th>ราคา</th><th>คลัง</th></tr></thead>
                    <tbody>
                      {plan.add.map((a) => (
                        <tr key={a.code}>
                          <td className="l mono">{a.code}</td>
                          <td className="l">{a.values.join(' / ')}</td>
                          <td className="ast-num">{money(a.price)}</td>
                          <td className="ast-num">{a.stock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!saved && (
                  <div className="ast-selbar" style={{ marginTop: 10 }}>
                    <button type="button" className="chip" disabled={Boolean(busy) || !ext} onClick={() => run(true)}
                      title="ส่วนขยายทำทุกขั้นในหลังบ้านจนถึงก่อนกดบันทึก แล้วปิดทิ้ง — ไม่มีอะไรถูกบันทึก">🧪 ทดลอง (ไม่บันทึก)</button>
                    <button type="button" className="btn ast-open" disabled={Boolean(busy) || !ext} onClick={() => run(false)}>
                      {busy === 'run' ? 'กำลังเพิ่ม…' : `➕ เพิ่ม ${plan.add.length} ตัวเลือกใน ThisShop`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
