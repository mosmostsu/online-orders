'use client';
// ปุ่ม "โคลน <ต้นทาง> → <ปลายทาง>" ในหน้า /compare กลุ่ม SOLID (TikTok → Shopee/Lazada, Shopee → TikTok)
// แสดงตะกร้าต้นทางที่ปลายทางยังไม่มี SKU ไหนเลย พร้อมหมวด/แบรนด์ (และแอตทริบิวต์บังคับ) ที่จะใช้
// ค่าพวกนี้เรียนจากตะกร้าที่ลงทั้งสองร้านแล้ว · ติ๊กแล้วโคลนทีละตัว — เซิร์ฟเวอร์ตรวจซ้ำก่อนสร้างทุกครั้ง ไม่แตะตะกร้าที่มีอยู่แล้ว
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ImageEditor from './ImageEditor';

// src/dest → API /api/xclone/<src>-<dest>
const DEST = {
  shopee: { label: 'Shopee', cat: 'shopeeCat', live: 'ขึ้นขายทันที' },
  lazada: { label: 'Lazada', cat: 'lazadaCat', live: 'ขึ้นขายหลัง Lazada ตรวจสินค้า (QC)' },
  tiktok: { label: 'TikTok', cat: 'tiktokCat', live: 'ขึ้นขายหลัง TikTok ตรวจสินค้า' },
};
const SRC = { tiktok: 'TikTok', shopee: 'Shopee' };
const UNKNOWN_CAT = /^ไม่รู้หมวด/;   // หายได้ด้วยการเลือกหมวดเอง
const NO_CHART = /บังคับตารางไซส์/;   // หายได้ด้วยการอัปรูปตารางไซส์เอง (โคลนไป TikTok)

// หมวดปลายทางทั้งหมด (leaf) — โหลดครั้งเดียวต่อปลายทาง
const catCache = {};
function loadCats(dest, shop) {
  const k = `${dest}:${shop}`;
  if (!catCache[k]) {
    catCache[k] = fetch(`/api/xclone/categories?dest=${dest}&shop=${shop}`).then((r) => r.json()).then((j) => {
      if (!j.ok) { delete catCache[k]; throw new Error(j.error || 'โหลดหมวดไม่ได้'); }
      return j.items;
    });
  }
  return catCache[k];
}

// ค้นหมวดปลายทางด้วยคำ (ทุกคำต้องอยู่ในเส้นทางหมวด) แล้วกดเลือก
function CatSearch({ dest, shop, initial = '', onPick, onCancel }) {
  const [all, setAll] = useState(null);
  const [q, setQ] = useState(initial);
  const [err, setErr] = useState('');
  useEffect(() => { loadCats(dest, shop).then(setAll).catch((e) => setErr(e.message)); }, [dest, shop]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = all && words.length ? all.filter((c) => words.every((w) => c.path.toLowerCase().includes(w))).slice(0, 15) : [];
  return (
    <div className="catsearch">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์ชื่อหมวด เช่น รองเท้าฟุตบอล" />
      <button type="button" className="chip" onClick={onCancel}>ยกเลิก</button>
      {err && <div className="cl-err">{err}</div>}
      {!all && !err && <div className="sku">กำลังโหลดหมวด…</div>}
      {hits.map((c) => (
        <button type="button" key={c.id} className="catsearch-hit" onClick={() => onPick(c)}>{c.path}</button>
      ))}
      {all && words.length > 0 && hits.length === 0 && <div className="sku">ไม่เจอหมวดที่มีคำนี้</div>}
    </div>
  );
}

// ids: ตะกร้าต้นทางที่ติ๊กไว้ในหน้า (SolidSelect) → แผงโชว์เฉพาะตัวนั้น · null = ทุกตะกร้าที่ปลายทางยังไม่มี
// onCloned(id): โคลนสำเร็จ (เอาออกจากที่ติ๊ก) · onClose(): ปิดแผงหลังมีตัวที่โคลนสำเร็จ
// srcShop: ร้านต้นทาง (ไม่ใส่ = ร้านเดียวกับปลายทาง) เช่น Shopee SOLID → Shopee REAL ใส่ src="shopee" dest="shopee" srcShop="SOLID" shop="REAL"
// แพลตฟอร์มเดียวกัน → หมวดคัดลอกจากต้นทาง ไม่มีให้เลือกหมวดเอง
export default function CloneAcross({ shop = 'SOLID', srcShop = shop, src = 'tiktok', dest = 'shopee', ids = null, onCloned, onClose }) {
  const samePlatform = src === dest;
  const D = DEST[dest];
  const S = SRC[src];
  const api = `/api/xclone/${src}-${dest}`;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [picks, setPicks] = useState(new Set());
  const [res, setRes] = useState({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [over, setOver] = useState({});      // หมวดที่ผู้ใช้เลือกเอง { id ตะกร้า: { id, path } }
  const [editing, setEditing] = useState(null);
  // หน้าแก้รูปก่อนโคลน (เฉพาะ Shopee → Shopee คนละร้าน) — { id ตะกร้า: { ids: [รหัสรูป], kept, edited, total } }
  const canEditImages = src === 'shopee' && (dest === 'shopee' || dest === 'tiktok');
  // ข้ามร้าน (เช่น Shopee REAL → TikTok SOLID) ต้องบอกร้านต้นทาง · Shopee → TikTok อ่านจาก Shopee ทีละตะกร้า → ส่งเฉพาะที่ติ๊กไป
  const srcQ = !samePlatform && srcShop !== shop ? `&src=${srcShop}` : '';
  const idsQ = src === 'shopee' && dest === 'tiktok' && ids?.length ? `&ids=${ids.join(',')}` : '';
  const [gal, setGal] = useState({});
  const [imgFor, setImgFor] = useState(null);

  const [charts, setCharts] = useState({});   // รูปตารางไซส์ที่อัปเอง { id ตะกร้า: { uri, name } }
  const [chartBusy, setChartBusy] = useState('');
  const fixed = (x) => (over[x.id] && UNKNOWN_CAT.test(x.problem)) || (charts[x.id] && NO_CHART.test(x.problem));
  const ready = (x) => !x.cloned && (x[D.cat] || over[x.id]) && (!x.problem || fixed(x));
  const uploadChart = (x, file) => {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = async () => {
      setChartBusy(x.id);
      try {
        const j = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'upload-sizechart', shop, data: String(fr.result) }) }).then((r) => r.json());
        if (!j.ok) throw new Error(j.error || 'อัปไม่สำเร็จ');
        setCharts((c) => ({ ...c, [x.id]: { uri: j.uri, name: file.name } }));
        setPicks((p) => new Set(p).add(x.id));
      } catch (e) { setErr(`อัปตารางไซส์ไม่สำเร็จ: ${e.message || e}`); } finally { setChartBusy(''); }
    };
    fr.readAsDataURL(file);
  };
  const want = ids ? new Set(ids) : null;
  const scope = (list) => (want ? list.filter((x) => want.has(x.id)) : list);
  const autoPicks = (list) => new Set(scope(list).filter((x) => ready(x) && (over[x.id] || x[D.cat]?.sure)).map((x) => x.id));
  async function load() {
    setBusy('load'); setErr(''); setRes({});
    try {
      const j = await fetch(`${api}?shop=${shop}${srcQ}${idsQ}`).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setPlan(j);
      setPicks(autoPicks(j.items));
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(''); }
  }
  async function run() {
    const list = plan.items.filter((x) => picks.has(x.id) && ready(x) && res[x.id]?.s !== 'ok');
    if (!list.length) return;
    if (!confirm(`โคลน ${list.length} ตะกร้าจาก ${S} ${srcShop} ไป ${D.label} ${shop}?\n\n${D.live} · ราคาตาม ${S} · สต็อกตาม Seniorsoft`)) return;
    setBusy('run');
    for (const x of list) {
      setRes((r) => ({ ...r, [x.id]: { s: 'run' } }));
      try {
        const j = await fetch(api, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: x.id, shop, ...(srcQ ? { src: srcShop } : {}), ...(over[x.id] ? { categoryId: over[x.id].id } : {}), ...(gal[x.id] ? { gallery: gal[x.id].ids } : {}), ...(charts[x.id] ? { sizeChart: charts[x.id].uri } : {}) }),
        }).then((r) => r.json()).catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ไม่ตอบ (อาจหมดเวลา) — ตรวจใน ${D.label} ก่อนกดซ้ำ` }));
        if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
        setRes((r) => ({ ...r, [x.id]: { s: 'ok', itemId: j.itemId, models: j.models, warn: (j.warnings || []).join(' · ') } }));
        setPicks((s) => { const n = new Set(s); n.delete(x.id); return n; });
        onCloned?.(x.id);
      } catch (e) {
        setRes((r) => ({ ...r, [x.id]: { s: 'err', msg: String(e.message || e) } }));
      }
    }
    setBusy('');
  }
  const close = () => {
    setOpen(false);
    if (Object.values(res).some((r) => r.s === 'ok')) { if (onClose) onClose(); else router.refresh(); }
  };
  const toggle = (id) => setPicks((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const items = scope(plan?.items || []);
  const outside = want ? [...want].filter((id) => !(plan?.items || []).some((x) => x.id === id)).length : 0;
  const chosen = items.filter((x) => picks.has(x.id) && ready(x)).length;

  return (
    <>
      <button type="button" className="chip" onClick={() => { setOpen(true); if (!plan) load(); else setPicks(autoPicks(plan.items)); }}
        title={`ตะกร้า ${S} ${srcShop} ที่ ${D.label} ${shop} ยังไม่มี`}>🧬 {ids ? (samePlatform ? `→ ${D.label} ${shop} (${ids.length})` : `${D.label} (${ids.length})`) : samePlatform ? `โคลน ${S} ${srcShop} → ${D.label} ${shop}` : `โคลน ${S} → ${D.label}`}</button>
      {open && (
        <div className="cl-back" onClick={() => !busy && close()}>
          <div className="cl-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cl-head">
              <div>
                <b className="ast-title">🧬 โคลน {S} {srcShop} → {D.label} {shop}</b>
                <div className="sku">เฉพาะตะกร้าที่ {D.label} ยังไม่มี SKU ไหนเลย · {D.live} · ราคาตาม {S}{samePlatform ? ` ${srcShop}` : ''} · สต็อกตาม Seniorsoft · ไม่แตะตะกร้าเดิม</div>
              </div>
              <span className="cl-headbtns">
                <button type="button" className="chip" onClick={load} disabled={Boolean(busy)}>🔄 โหลดใหม่</button>
                <button type="button" className="chip" onClick={close} disabled={Boolean(busy)}>ปิด</button>
              </span>
            </div>
            {busy === 'load' && <div className="note">กำลังเทียบ {S} กับ {D.label} และอ่านหมวดจาก {S}…</div>}
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
                {outside > 0 && (
                  <div className="note">ที่ติ๊กไว้ {outside} ตะกร้า ไม่อยู่ในรายการ — {D.label} มี SKU ของตะกร้านั้นแล้ว (หรือตะกร้าไม่ได้ขายอยู่) จึงไม่โคลนซ้ำ</div>
                )}
                {plan.mapBuiltAt ? (
                  <div className="sku" style={{ marginBottom: 6 }}>
                    หมวดเดาจากตะกร้าที่ลงทั้งสองร้านแล้ว — ตัวที่โหวตไม่ถึง 60% ไม่ติ๊กให้ (ตรวจก่อน) · แผนที่สร้างเมื่อ {plan.mapBuiltAt?.slice(0, 10)}
                  </div>
                ) : samePlatform && (
                  <div className="sku" style={{ marginBottom: 6 }}>แพลตฟอร์มเดียวกัน — หมวด แบรนด์ แอตทริบิวต์ ตัวเลือก รูป คัดลอกจากตะกร้าต้นทาง · ราคาตาม {S} {srcShop}</div>
                )}
                {items.length === 0 ? <div className="note">{D.label} มีครบทุกตะกร้าของ {S} แล้ว</div> : (
                  <div className="ast-wrap">
                    <table className="ast-table">
                      <thead><tr><th /><th /><th className="l">ตะกร้า {S}</th><th className="l">หมวด {D.label} (โหวต)</th><th className="l">แบรนด์</th><th className="l">สถานะ</th></tr></thead>
                      <tbody>
                        {items.map((x) => {
                          const r = res[x.id];
                          return (
                            <tr key={x.id} className={picks.has(x.id) ? 'ast-sel' : ''}>
                              <td className="ast-cbcol">
                                <input type="checkbox" className="ast-cb" checked={picks.has(x.id)} disabled={!ready(x) || Boolean(busy) || r?.s === 'ok'} onChange={() => toggle(x.id)} />
                              </td>
                              <td>{x.thumb ? <img src={x.thumb} alt="" className="cl-thumb" /> : null}</td>
                              <td className="l cl-path">{x.title}<div className="sku">{x.n} SKU · {x.category || ''}</div>
                                {canEditImages && !x.cloned && r?.s !== 'ok' && (
                                  <span className="cl-gal">
                                    <button type="button" className="link catsearch-btn" disabled={Boolean(busy)} onClick={() => setImgFor(x)}>
                                      🖼 {gal[x.id] ? 'แก้รูปอีกครั้ง' : 'เลือก/แก้รูป'}
                                    </button>
                                    {gal[x.id] && (
                                      <>
                                        <span className="sku"> ใช้ {gal[x.id].ids.length}/{gal[x.id].total} รูป{gal[x.id].edited ? ` · แก้โลโก้ ${gal[x.id].edited}` : ''} </span>
                                        <button type="button" className="link catsearch-btn" disabled={Boolean(busy)} onClick={() => setGal((g) => { const n = { ...g }; delete n[x.id]; return n; })}>ใช้รูปเดิมทั้งหมด</button>
                                      </>
                                    )}
                                  </span>
                                )}
                              </td>
                              <td className="l cl-path">
                                {over[x.id] ? <>{over[x.id].path} <span className="sku">(เลือกเอง)</span></>
                                  : x[D.cat] ? <>{x[D.cat].name} <span className={x[D.cat].sure ? 'sku' : 'cl-err'}>({x[D.cat].votes}/{x[D.cat].of}{x[D.cat].sure ? '' : ' ตรวจก่อน'})</span></> : '—'}
                                {!samePlatform && !x.cloned && r?.s !== 'ok' && editing !== x.id && (
                                  <button type="button" className="link catsearch-btn" disabled={Boolean(busy)} onClick={() => setEditing(x.id)}>
                                    {over[x.id] || x[D.cat] ? 'เปลี่ยนหมวด' : 'เลือกหมวด'}
                                  </button>
                                )}
                                {over[x.id] && editing !== x.id && (
                                  <button type="button" className="link catsearch-btn" onClick={() => setOver((o) => { const n = { ...o }; delete n[x.id]; return n; })}>ใช้หมวดที่เดา</button>
                                )}
                                {editing === x.id && (
                                  <CatSearch dest={dest} shop={shop} initial={(x[D.cat]?.name || '').split(' › ').slice(-1)[0] || ''}
                                    onCancel={() => setEditing(null)}
                                    onPick={(c) => { setOver((o) => ({ ...o, [x.id]: c })); setEditing(null); setPicks((p) => new Set(p).add(x.id)); }} />
                                )}
                                {x.attrs && Object.keys(x.attrs).length > 0 && (
                                  <div className="sku">แอตทริบิวต์บังคับ: {Object.entries(x.attrs).map(([k, v]) => `${k}=${v ?? '—'}`).join(' · ')}</div>
                                )}
                              </td>
                              <td className="l">{x.brand || '—'}</td>
                              <td className="l cl-path">
                                {x.cloned && <span className="sku">โคลนไปแล้ว {x.cloned.thisshop_spu_id || ''}</span>}
                                {!x.cloned && x.problem && !r && !fixed(x) && <span className="cl-err">{x.problem}</span>}
                                {dest === 'tiktok' && !x.cloned && r?.s !== 'ok' && x.problem && NO_CHART.test(x.problem) && (
                                  <div>
                                    {charts[x.id] && <span className="cl-ok">📏 ตารางไซส์: {charts[x.id].name} </span>}
                                    <label className="link catsearch-btn" style={{ cursor: 'pointer' }}>
                                      {chartBusy === x.id ? 'กำลังอัป…' : charts[x.id] ? 'เปลี่ยนรูปตารางไซส์' : '📏 อัปรูปตารางไซส์'}
                                      <input type="file" accept="image/png,image/jpeg" hidden disabled={Boolean(busy) || chartBusy === x.id} onChange={(e) => uploadChart(x, e.target.files?.[0])} />
                                    </label>
                                  </div>
                                )}
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
      {imgFor && (
        <ImageEditor api={api} shop={shop} srcShop={srcShop} id={imgFor.id} title={imgFor.title} destLabel={`${D.label} ${shop}`}
          onCancel={() => setImgFor(null)}
          onDone={(g) => { setGal((o) => ({ ...o, [imgFor.id]: g })); setPicks((p) => new Set(p).add(imgFor.id)); setImgFor(null); }} />
      )}
    </>
  );
}
