'use client';
// เลือกตะกร้า Shopee REAL ที่จะโคลนไป ThisShop ในหน้า /compare
//
// ติ๊กได้เฉพาะแถวที่ ThisShop "ไม่พบ" และ Shopee REAL มีตะกร้าเดียว (หน้า page.js เป็นคนตัดสิน)
// ที่เลือกจำไว้ในหน้านี้ (หน่วยความจำ) ข้ามหน้า/เปลี่ยนตัวกรองได้ — รีเฟรชแล้วเริ่มว่าง
// กดปุ่มโคลน → แผงจับคู่หมวด/แบรนด์ + สั่งโคลน (app/allsite/report/CloneThisShop.js) ซึ่งเช็คซ้ำกับฐานข้อมูลอีกชั้น
import { useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import CloneThisShop from '../allsite/report/CloneThisShop';
import ExtLink from './ExtLink';
import CloneMenu, { CloneMenuRow } from './CloneMenu';

let current = new Set();
let version = 0;
const listeners = new Set();
const emit = () => { version += 1; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
function useSel() {
  useSyncExternalStore(subscribe, () => version, () => -1);
  return current;
}
const set = (ids) => { current = new Set(ids); emit(); };

export function CloneCheck({ pid }) {
  const sel = useSel();
  const on = sel.has(pid);
  return (
    <input type="checkbox" className="cmp-clcb" checked={on} title="เลือกโคลนไป ThisShop"
      onClick={(e) => e.stopPropagation()}
      onChange={() => set(on ? [...current].filter((x) => x !== pid) : [...current, pid])} />
  );
}

export function CloneBar({ pagePids }) {
  const sel = useSel();
  const router = useRouter();
  const ids = [...sel];
  return (
    <div className="cmp-clbar">
      <CloneMenu count={ids.length}>
        <CloneMenuRow label="ติ๊กตะกร้า Shopee REAL หน้าแถว:">
          <button type="button" className="chip" disabled={!pagePids.length}
            onClick={() => set([...new Set([...current, ...pagePids])])}>ติ๊กทั้งหน้า ({pagePids.length})</button>
          <button type="button" className="chip" disabled={!ids.length} onClick={() => set([])}>ล้างที่เลือก</button>
          <b className="cmp-clcount">เลือกแล้ว {ids.length} ตะกร้า</b>
        </CloneMenuRow>
        <CloneMenuRow label="จาก Shopee REAL →">
          {/* โคลนสำเร็จตัวไหน เอาตัวนั้นออกจากที่เลือกทันที · ปิดแผงแล้วโหลดหน้าใหม่ให้เห็นผล */}
          {ids.length > 0 ? (
            <CloneThisShop productIds={ids} label={`🧬 ThisShop (${ids.length})`}
              onCloned={(id) => set([...current].filter((x) => x !== id))}
              onClose={() => router.refresh()} />
          ) : <span className="sku">ติ๊กตะกร้าก่อน แล้วกด ThisShop</span>}
        </CloneMenuRow>
      </CloneMenu>
    </div>
  );
}

// ตะกร้า ThisShop ที่มีอยู่แล้วแต่ปิดขาย (หน้า compare เห็นเป็น "ไม่พบ") — ลิงก์หลังบ้าน + ปุ่ม "เปิดขาย"
// เปลี่ยนสถานะเป็นวางขายอย่างเดียว (POST /api/clone/publish) ไม่แก้ข้อมูลอื่นของสินค้า
export function OffShelf({ spuId, url, title }) {
  const [st, setSt] = useState('idle');   // idle | run | ok | err
  const [msg, setMsg] = useState('');

  async function publish(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`เปิดขายตะกร้า ThisShop เลข ${spuId}${title ? `\n“${title}”` : ''}?\n\nเปลี่ยนสถานะเป็นวางขายอย่างเดียว ไม่แก้ข้อมูลอื่น\n(ตัวเลือกที่สต็อกเป็น 0 ลูกค้าจะเห็นว่าของหมด)`)) return;
    setSt('run');
    setMsg('');
    try {
      const j = await fetch('/api/clone/publish', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spuId }),
      }).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      setSt('ok');
    } catch (err) {
      setSt('err');
      setMsg(String(err.message || err));
    }
  }

  return (
    <span className="cmp-offshelf" onClick={(e) => e.stopPropagation()}>
      {st === 'ok'
        ? <span className="cl-ok">✅ เปิดขายแล้ว</span>
        : <ExtLink href={url} title={`ThisShop มีตะกร้านี้แล้ว (เลข ${spuId}) แต่ปิดขายอยู่ — เปิดหลังบ้าน`}>ThisShop: ปิดขายอยู่ ↗</ExtLink>}
      {st !== 'ok' && (
        <button type="button" className="chip" disabled={st === 'run'} onClick={publish}>
          {st === 'run' ? '⏳ กำลังเปิดขาย…' : 'เปิดขาย'}
        </button>
      )}
      {st === 'err' && <span className="cl-err" title={msg}>❌ {msg.slice(0, 60)}</span>}
    </span>
  );
}

// เปิดขายทีเดียวหลายตัว: ตะกร้า ThisShop ที่ปิดอยู่แต่ Shopee REAL ขายอยู่ (GET /api/clone/off-shelf)
// ไม่แสดงตะกร้าที่สต็อกรวม = 0 เลย (เปิดไปจะเป็นของหมดทั้งตะกร้า ไม่ควรขึ้นขาย) — บอกแค่ว่าซ่อนไปกี่ตัว
// เปิดทีละตัวเรียงกัน (POST /api/clone/publish) แสดงผลรายตัว หยุดกลางทางได้
export function BatchPublish() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [items, setItems] = useState(null);
  const [hiddenZero, setHiddenZero] = useState(0);
  const [picks, setPicks] = useState(new Set());
  const [res, setRes] = useState({});
  const [running, setRunning] = useState(false);
  const stop = useRef(false);

  async function load() {
    setLoading(true); setErr(''); setItems(null); setRes({});
    try {
      const j = await fetch('/api/clone/off-shelf').then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      // ตัดตัวที่สต็อกรวม 0 ออกตั้งแต่ต้น — ไม่ให้เห็น ไม่ให้เลือก
      const ok = j.items.filter((x) => x.stock > 0);
      setHiddenZero(j.items.length - ok.length);
      setItems(ok);
      setPicks(new Set(ok.map((x) => x.id)));
    } catch (e) { setErr(String(e.message || e)); } finally { setLoading(false); }
  }
  function show() { setOpen(true); if (!items) load(); }

  const chosen = (items || []).filter((x) => picks.has(x.id) && res[x.id]?.s !== 'ok');
  const doneN = Object.values(res).filter((r) => r.s === 'ok').length;

  function toggle(id) {
    setPicks((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function run() {
    if (!chosen.length) return;
    if (!confirm(`เปิดขาย ${chosen.length} ตะกร้าใน ThisShop?\n\nเปลี่ยนสถานะเป็นวางขายอย่างเดียว ไม่แก้ข้อมูลอื่น\n(ตัวเลือกบางไซส์ที่สต็อกเป็น 0 ลูกค้าจะเห็นว่าของหมด)`)) return;
    stop.current = false;
    setRunning(true);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const x of chosen) {
      if (stop.current) break;
      setRes((r) => ({ ...r, [x.id]: { s: 'run' } }));
      try {
        // ThisShop จำกัดความถี่ (QPS) — โดนแล้วรอแล้วลองตัวเดิมใหม่ได้ถึง 3 รอบ (ฝั่งเซิร์ฟเวอร์ลองซ้ำให้อีกชั้น)
        let j = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          j = await fetch('/api/clone/publish', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spuId: x.id }),
          }).then((r) => r.json());
          if (j.ok || !/QPS|900305/.test(String(j.error || ''))) break;
          await wait(3000 * (attempt + 1));
        }
        if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
        setRes((r) => ({ ...r, [x.id]: { s: 'ok' } }));
      } catch (e) {
        setRes((r) => ({ ...r, [x.id]: { s: 'err', msg: String(e.message || e) } }));
      }
      await wait(500);   // เว้นจังหวะระหว่างตัว ไม่ยิงติดกัน
    }
    setRunning(false);
  }

  const row = (x) => (
    <tr key={x.id} className={picks.has(x.id) ? 'ast-sel' : ''}>
      <td className="ast-cbcol">
        <input type="checkbox" className="ast-cb" checked={picks.has(x.id)} disabled={running || res[x.id]?.s === 'ok'} onChange={() => toggle(x.id)} />
      </td>
      <td className="l">
        <div className="cl-path">{x.title || '(ไม่มีชื่อ)'}</div>
        <div className="sku">เลข {x.id} · <a className="link" href={x.url} target="_blank" rel="noreferrer">หลังบ้าน ↗</a></div>
      </td>
      <td className="ast-num">{x.matched}/{x.n}</td>
      <td className="ast-num">{x.stock}</td>
      <td className="l">
        {res[x.id]?.s === 'run' && '⏳ กำลังเปิดขาย…'}
        {res[x.id]?.s === 'ok' && <span className="cl-ok">✅ เปิดขายแล้ว</span>}
        {res[x.id]?.s === 'err' && <span className="cl-err">❌ {res[x.id].msg}</span>}
      </td>
    </tr>
  );

  return (
    <>
      <button type="button" className="chip" onClick={show} title="ตะกร้า ThisShop ที่ปิดขายอยู่ แต่ Shopee REAL ขายอยู่">▶ เปิดขายที่ปิดอยู่ (หลายตัว)</button>
      {open && (
        <div className="cl-back" onClick={() => !running && setOpen(false)}>
          <div className="cl-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cl-head">
              <div>
                <b className="ast-title">▶ เปิดขาย ThisShop ทีละหลายตัว</b>
                <div className="sku">ตะกร้าที่ ThisShop มีแล้วแต่ปิดขายอยู่ ขณะที่ Shopee REAL ขายอยู่ · เปลี่ยนสถานะเป็นวางขายอย่างเดียว</div>
              </div>
              <span className="cl-headbtns">
                <button type="button" className="chip" onClick={load} disabled={loading || running}>🔄 โหลดใหม่</button>
                <button type="button" className="chip" onClick={() => setOpen(false)} disabled={running}>ปิด</button>
              </span>
            </div>

            {loading && <div className="note">กำลังเทียบข้อมูลทั้งร้าน… (ใช้ราว 10 วินาที)</div>}
            {err && <div className="note note-danger">{err}</div>}

            {items && (
              <>
                <div className="cl-counts">
                  <span className="chip" data-on="1">เปิดขายได้ {items.length}</span>
                  {hiddenZero > 0 && <span className="sku">ไม่แสดง {hiddenZero} ตะกร้าที่สต็อกรวม = 0</span>}
                  {doneN > 0 && <b className="cl-ok">เปิดขายแล้ว {doneN} ตัว</b>}
                </div>
                <div className="ast-selbar">
                  <b className="ast-selcount">เลือกแล้ว {chosen.length} / {items.length} ตะกร้า</b>
                  <button type="button" className="chip" disabled={running} onClick={() => setPicks(new Set(items.map((x) => x.id)))}>เลือกทั้งหมด</button>
                  <button type="button" className="chip" disabled={running} onClick={() => setPicks(new Set())}>ล้าง</button>
                  <button type="button" className="btn ast-open" disabled={running || !chosen.length} onClick={run}>
                    {running ? 'กำลังเปิดขาย…' : `เปิดขาย ${chosen.length} ตัว`}
                  </button>
                  {running && <button type="button" className="chip" onClick={() => { stop.current = true; }}>หยุดหลังตัวนี้</button>}
                </div>

                {items.length === 0 ? (
                  <div className="note">ไม่มีตะกร้าที่ปิดอยู่แต่ Shopee REAL ขายอยู่และมีสต็อก{hiddenZero > 0 ? ` (ซ่อน ${hiddenZero} ตะกร้าที่สต็อก = 0)` : ''}</div>
                ) : (
                  <div className="ast-wrap">
                    <table className="ast-table">
                      <thead><tr><th /><th className="l">ตะกร้าใน ThisShop</th><th className="ast-num">SKU ตรง</th><th className="ast-num">สต็อกรวม</th><th className="l">สถานะ</th></tr></thead>
                      <tbody>{items.map(row)}</tbody>
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
