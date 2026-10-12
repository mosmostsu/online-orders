'use client';
// โคลนสินค้า Shopee REAL → ThisShop จากรายงาน (ปุ่มในแถบเครื่องมือของ Report)
//
// รับ SKU ทั้งหมดในรายงาน → /api/clone/plan หาตะกร้าของ Shopee REAL ที่ยังไม่มีใน ThisShop เลย
// ผู้ใช้ติ๊กเลือกเอง จับคู่หมวดครั้งเดียวต่อหมวด (จำไว้) แล้วกดโคลน — ระบบทำทีละตัว ขึ้นขายทันที
// ตัวที่มีบางตัวเลือกใน ThisShop แล้วเลือกไม่ได้ (โคลนซ้ำจะได้สินค้าซ้ำสองตะกร้า)
import { useEffect, useMemo, useRef, useState } from 'react';

const num = (n) => Number(n || 0).toLocaleString('en-US');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9฀-๿]/g, '');

// หมวด/แบรนด์ของ ThisShop — จำไว้ในหน้านี้ ไม่ต้องขอซ้ำทุกครั้งที่เปลี่ยนช่อง
const cache = {};
async function api(url) {
  if (!cache[url]) {
    const j = await fetch(url).then((r) => r.json());
    if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
    cache[url] = j.items;
  }
  return cache[url];
}
const getChildren = (parent) => api(`/api/clone/catalog?parent=${parent}`);
const getBrands = (cat) => api(`/api/clone/catalog?brands=${cat}`);

// เลือกหมวด ThisShop 3 ระดับ — เลือกถึงระดับสุดท้าย (leaf) แล้วส่งกลับ { id, name }
function CatPicker({ onPick }) {
  const [levels, setLevels] = useState([]);    // [{ list, sel }]
  const [err, setErr] = useState('');

  useEffect(() => {
    getChildren('0').then((list) => setLevels([{ list, sel: '' }])).catch((e) => setErr(e.message));
  }, []);

  async function choose(depth, id) {
    const next = levels.slice(0, depth + 1);
    next[depth] = { ...next[depth], sel: id };
    setLevels(next);
    if (!id) return;
    const item = next[depth].list.find((x) => x.id === id);
    if (item?.leaf) {
      const name = next.map((l) => l.list.find((x) => x.id === l.sel)?.name).filter(Boolean).join(' › ');
      onPick({ id, name });
      return;
    }
    try {
      const list = await getChildren(id);
      setLevels([...next, { list, sel: '' }]);
    } catch (e) { setErr(e.message); }
  }

  return (
    <span className="cl-pick">
      {levels.map((l, i) => (
        <select key={i} className="aselect" value={l.sel} onChange={(e) => choose(i, e.target.value)}>
          <option value="">{i === 0 ? '— เลือกหมวด ThisShop —' : '— เลือก —'}</option>
          {l.list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      ))}
      {err && <b className="cl-err">{err}</b>}
    </span>
  );
}

export default function CloneThisShop({ skus }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [plan, setPlan] = useState(null);
  const [picks, setPicks] = useState(new Set());
  const [maps, setMaps] = useState({});          // รหัสหมวด Shopee → { id, name } ของ ThisShop
  const [changing, setChanging] = useState({});  // หมวดที่กด "เปลี่ยน"
  const [brands, setBrands] = useState({});      // รหัสหมวด ThisShop → รายชื่อแบรนด์
  const [brandPick, setBrandPick] = useState({});
  const [titles, setTitles] = useState({});
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const stop = useRef(false);

  async function load() {
    setLoading(true); setErr(''); setPlan(null);
    try {
      const j = await fetch('/api/clone/plan', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skus }),
      }).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'วางแผนไม่สำเร็จ');
      setPlan(j);
      const m = {};
      for (const c of j.cats) if (c.mapped?.id) m[c.id] = c.mapped;
      setMaps(m);
      setPicks(new Set());
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }
  function openPanel() { setOpen(true); if (!plan) load(); }

  // หมวดไหนจับคู่แล้ว → ไปเอารายชื่อแบรนด์ของหมวดนั้นมา
  useEffect(() => {
    for (const m of Object.values(maps)) {
      if (m?.id && !brands[m.id]) {
        getBrands(m.id).then((list) => setBrands((b) => ({ ...b, [m.id]: list }))).catch(() => setBrands((b) => ({ ...b, [m.id]: [] })));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps]);

  // แบรนด์ของตะกร้า: ที่ผู้ใช้เลือก → ไม่ก็จับจากชื่อแบรนด์ Shopee
  const brandOf = (p) => {
    const m = p.catId ? maps[p.catId] : null;
    if (!m) return null;
    const list = brands[m.id] || [];
    const chosen = brandPick[p.id];
    if (chosen) return list.find((b) => b.id === chosen) || null;
    return list.find((b) => p.brandName && (norm(b.name) === norm(p.brandName) || norm(b.nameLocal) === norm(p.brandName))) || null;
  };
  const blockReason = (p) => {
    if (p.state !== 'ready') return '';
    if (p.status !== 'NORMAL') return 'ไม่ได้วางขายอยู่ใน Shopee';
    if (p.noSku) return 'มีตัวเลือกไม่มีรหัส SKU';
    if (!p.catId) return 'ไม่รู้หมวด Shopee';
    if (!maps[p.catId]) return 'จับคู่หมวดก่อน';
    if (!brandOf(p)) return 'เลือกแบรนด์';
    return '';
  };
  const ready = useMemo(() => (plan?.products || []).filter((p) => p.state === 'ready'), [plan]);
  const eligible = ready.filter((p) => !blockReason(p));
  const others = (plan?.products || []).filter((p) => p.state !== 'ready');

  function toggle(id) {
    setPicks((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function runAll() {
    const list = ready.filter((p) => picks.has(p.id) && !blockReason(p));
    if (!list.length) return;
    if (!confirm(`โคลน ${list.length} ตัวไป ThisShop?\n\nสินค้าจะขึ้นขายทันที ราคาป้ายเต็มตาม Shopee สต็อกตาม Seniorsoft`)) return;
    stop.current = false;
    setRunning(true);
    for (const p of list) {
      if (stop.current) break;
      setResults((r) => ({ ...r, [p.id]: { s: 'run' } }));
      const m = maps[p.catId];
      const b = brandOf(p);
      try {
        const j = await fetch('/api/clone/run', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            productId: p.id, categoryId: m.id, categoryName: m.name, brandId: b.id, brandName: b.name,
            title: (titles[p.id] ?? p.clean).trim(),
          }),
        }).then((r) => r.json());
        if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
        setResults((r) => ({ ...r, [p.id]: { s: 'ok', spuId: j.spuId, sent: j.sent, warn: (j.warnings || []).join(' · ') } }));
        setPicks((s) => { const n = new Set(s); n.delete(p.id); return n; });
      } catch (e) {
        setResults((r) => ({ ...r, [p.id]: { s: 'err', msg: String(e.message || e) } }));
      }
    }
    setRunning(false);
  }

  const doneN = Object.values(results).filter((r) => r.s === 'ok').length;
  const pickedN = ready.filter((p) => picks.has(p.id)).length;

  return (
    <>
      <button type="button" className="chip" onClick={openPanel} title="สร้างสินค้าใน ThisShop จากตะกร้า Shopee REAL ที่ยังไม่มี">🧬 โคลนไป ThisShop</button>
      {open && (
        <div className="cl-back" onClick={() => !running && setOpen(false)}>
          <div className="cl-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cl-head">
              <div>
                <b className="ast-title">🧬 โคลนสินค้า Shopee REAL → ThisShop</b>
                <div className="sku">เลือกเฉพาะตะกร้าที่ยังไม่มีใน ThisShop เลย · ขึ้นขายทันที · ราคาป้ายเต็ม · สต็อกตาม Seniorsoft</div>
              </div>
              <span className="cl-headbtns">
                <button type="button" className="chip" onClick={load} disabled={loading || running}>🔄 วางแผนใหม่</button>
                <button type="button" className="chip" onClick={() => setOpen(false)} disabled={running}>ปิด</button>
              </span>
            </div>

            {loading && <div className="note">กำลังหาตะกร้าและเทียบกับ ThisShop… (ครั้งแรกอาจใช้ 10-20 วินาที)</div>}
            {err && <div className="note note-danger">{err}</div>}
            {plan?.needsSql && (
              <div className="note note-danger">
                ยังไม่ได้รัน <code>supabase/051_clone_thisshop.sql</code> ใน Supabase — รันก่อน ระบบจึงจะยอมโคลน (กันสร้างสินค้าซ้ำ)
              </div>
            )}
            {plan?.liveError && <div className="note">ถามหมวด/แบรนด์จาก Shopee ไม่สำเร็จ: {plan.liveError}</div>}

            {plan && (
              <>
                <div className="cl-counts">
                  <span className="chip" data-on="1">โคลนได้ {num(plan.counts.ready)}</span>
                  <span className="chip">มีบางตัวเลือกแล้ว (ข้าม) {num(plan.counts.partial)}</span>
                  <span className="chip">อยู่ใน ThisShop แล้ว {num(plan.counts.on)}</span>
                  <span className="chip">โคลนไปแล้ว {num(plan.counts.cloned)}</span>
                </div>

                {plan.cats.length > 0 && (
                  <div className="cl-sec">
                    <b>1) จับคู่หมวด Shopee → ThisShop</b> <span className="sku">(ทำครั้งเดียวต่อหมวด ระบบจำไว้ — แบรนด์จับจากชื่ออัตโนมัติ)</span>
                    <table className="ast-table cl-cats">
                      <tbody>
                        {plan.cats.map((c) => (
                          <tr key={c.id}>
                            <td className="l">{c.name} <span className="sku">({c.count} ตัว)</span></td>
                            <td className="l">
                              {maps[c.id] && !changing[c.id] ? (
                                <>✅ {maps[c.id].name} <button type="button" className="chip" onClick={() => setChanging((o) => ({ ...o, [c.id]: true }))}>เปลี่ยน</button></>
                              ) : (
                                <CatPicker onPick={(v) => { setMaps((m) => ({ ...m, [c.id]: v })); setChanging((o) => ({ ...o, [c.id]: false })); }} />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="cl-sec">
                  <b>2) เลือกตะกร้าที่จะโคลน</b>
                  <div className="ast-selbar">
                    <b className="ast-selcount">เลือกแล้ว {pickedN} / พร้อมโคลน {eligible.length}</b>
                    <button type="button" className="chip" disabled={running}
                      onClick={() => setPicks(new Set(eligible.map((p) => p.id)))}>ติ๊กทั้งหมดที่พร้อม</button>
                    <button type="button" className="chip" disabled={running} onClick={() => setPicks(new Set())}>ล้างที่เลือก</button>
                    <button type="button" className="btn ast-open" disabled={running || !pickedN || plan.needsSql} onClick={runAll}>
                      {running ? 'กำลังโคลน…' : `โคลน ${pickedN} ตัวไป ThisShop`}
                    </button>
                    {running && <button type="button" className="chip" onClick={() => { stop.current = true; }}>หยุดหลังตัวนี้</button>}
                    {doneN > 0 && <b className="cl-ok">สำเร็จแล้ว {doneN} ตัว</b>}
                  </div>

                  {ready.length === 0 ? (
                    <div className="note">ไม่มีตะกร้าที่โคลนได้ในรายงานนี้</div>
                  ) : (
                    <div className="ast-wrap">
                      <table className="ast-table">
                        <thead>
                          <tr><th /><th /><th className="l">ชื่อ (แก้ได้)</th><th className="ast-num">ตัวเลือก</th><th className="ast-num">ราคา</th><th className="l">แบรนด์</th><th className="l">สถานะ</th></tr>
                        </thead>
                        <tbody>
                          {ready.map((p) => {
                            const why = blockReason(p);
                            const r = results[p.id];
                            const m = p.catId ? maps[p.catId] : null;
                            return (
                              <tr key={p.id} className={picks.has(p.id) ? 'ast-sel' : ''}>
                                <td className="ast-cbcol">
                                  <input type="checkbox" className="ast-cb" checked={picks.has(p.id)} disabled={Boolean(why) || running || r?.s === 'ok'}
                                    onChange={() => toggle(p.id)} />
                                </td>
                                <td>{p.thumb ? <img src={p.thumb} alt="" className="cl-thumb" /> : null}</td>
                                <td className="l">
                                  <input className="cl-title" value={titles[p.id] ?? p.clean} disabled={running}
                                    onChange={(e) => setTitles((t) => ({ ...t, [p.id]: e.target.value }))} />
                                  <div className="sku">{p.catName || '—'}</div>
                                </td>
                                <td className="ast-num">{p.n}</td>
                                <td className="ast-num">{p.priceMin === null ? '—' : p.priceMin === p.priceMax ? num(p.priceMin) : `${num(p.priceMin)}–${num(p.priceMax)}`}</td>
                                <td className="l">
                                  {m && (brands[m.id] || []).length > 0 ? (
                                    <select className="aselect" value={brandOf(p)?.id || ''} disabled={running}
                                      onChange={(e) => setBrandPick((b) => ({ ...b, [p.id]: e.target.value }))}>
                                      <option value="">{p.brandName ? `— ${p.brandName} (ไม่ตรง) —` : '— เลือกแบรนด์ —'}</option>
                                      {brands[m.id].map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    </select>
                                  ) : <span className="sku">{p.brandName || '—'}</span>}
                                </td>
                                <td className="l">
                                  {r?.s === 'run' && '⏳ กำลังสร้าง…'}
                                  {r?.s === 'ok' && <span className="cl-ok">✅ สร้างแล้ว spuId {r.spuId} ({r.sent} ตัวเลือก){r.warn ? ` · ⚠ ${r.warn}` : ''}</span>}
                                  {r?.s === 'err' && <span className="cl-err">❌ {r.msg}</span>}
                                  {!r && why && <span className="sku">{why}</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {others.length > 0 && (
                  <details className="cl-sec">
                    <summary><b>ตะกร้าที่โคลนไม่ได้ / ไม่ต้องโคลน ({others.length})</b></summary>
                    <table className="ast-table">
                      <tbody>
                        {others.map((p) => (
                          <tr key={p.id}>
                            <td className="l">{p.clean}</td>
                            <td className="ast-num">{p.n} ตัวเลือก</td>
                            <td className="l sku">
                              {p.state === 'partial' && `มีใน ThisShop แล้ว ${p.presentN}/${p.n} ตัวเลือก — ข้าม (ไปจัดการด้วยมือ)`}
                              {p.state === 'on' && 'ลงใน ThisShop ครบแล้ว'}
                              {p.state === 'cloned' && `โคลนไปแล้ว${p.spuId ? ` (spuId ${p.spuId})` : ' / กำลังโคลน'}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
