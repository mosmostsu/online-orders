'use client';
import { useEffect, useRef, useState } from 'react';

// แก้พร้อมกันทุกร้าน — โผล่หลังบันทึกสำเร็จในหน้าแก้ไขสินค้า (BasketEditor / BasketInfo / BasketImages ส่ง job มา)
//   job: { title: [บรรทัดสรุปสิ่งที่แก้], src: ตะกร้าต้นทางก่อนแก้, intent: { prices, add, renames }, notes: [สิ่งที่ไม่ส่งต่อ] }
//   1. ดึงตะกร้าเดียวกันในร้านกลุ่มเดียวกันบนแพลตฟอร์มอื่น (/api/basket-cross GET) ติ๊กไว้ทุกร้านเป็นค่าเริ่มต้น
//      รูปสินค้า / ชื่อ / รายละเอียด ไม่ติ๊กไว้ — ผู้ใช้ต้องติ๊กเองถึงจะส่ง (ทับของร้านปลายทางทั้งหมด)
//   2. "ดูตัวอย่าง" → ร้านละคำขอ อ่านตะกร้าสด แปลงคำสั่ง บอกว่าจะเปลี่ยนอะไร / ข้ามอะไรเพราะอะไร / เตือน SKU ติดโปร (ยังไม่เขียน)
//      สีใหม่ของร้านที่บังคับรูป → ใช้รูปจากต้นทางอัตโนมัติ เลือกรูปของร้านนั้นแทนได้ (ขอตัวอย่างใหม่ ได้ sig ใหม่)
//   3. "ยืนยัน" → ยิงทีละร้าน เซิร์ฟเวอร์แปลงใหม่ต้องตรงกับตัวอย่าง (sig) ไม่งั้นไม่เขียน → สรุปผลรวม + ลองใหม่เฉพาะร้านที่ไม่สำเร็จ
const keyOf = (t) => `${t.platform}|${t.shop}|${t.itemId}`;
const post = async (body) => {
  const res = await fetch('/api/basket-cross', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
  if (!j.ok) throw new Error(j.error);
  return j;
};
const EXTRA = [
  { k: 'main', label: 'รูปสินค้า', hint: 'แทนทั้งชุด' },
  { k: 'title', label: 'ชื่อสินค้า' },
  { k: 'desc', label: 'รายละเอียด' },
];
const isReady = (pv) => pv && !pv.empty && !pv.why && !pv.needImg.some((x) => !x.image_id && !x.src);

export default function CrossShop({ platform, shop, itemId, job, onClose }) {
  const [targets, setTargets] = useState(null);   // null = กำลังโหลด
  const [err, setErr] = useState(null);
  const [pick, setPick] = useState({});           // key → ติ๊กไหม
  const [extra, setExtra] = useState({ main: false, title: false, desc: false });
  const [prev, setPrev] = useState({});           // key → { loading, preview, error }
  const [imgs, setImgs] = useState({});           // key → { ข้อความสีใหม่: รหัสรูปของร้านนั้น }
  const [res, setRes] = useState({});             // key → { ok, text } | { running } | { waiting }
  const [busy, setBusy] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    let live = true;
    setTargets(null); setErr(null); setPrev({}); setRes({}); setImgs({}); setExtra({ main: false, title: false, desc: false });
    fetch(`/api/basket-cross?${new URLSearchParams({ platform, shop, itemId })}`).then((r) => r.json()).then((j) => {
      if (!live) return;
      if (!j.ok) { setErr(j.error); setTargets([]); return; }
      setTargets(j.targets);
      setPick(Object.fromEntries(j.targets.map((t) => [keyOf(t), true])));
    }).catch((e) => { if (live) { setErr(e.message); setTargets([]); } });
    return () => { live = false; };
  }, [job, platform, shop, itemId]);

  const intent = { ...job.intent, ...extra };
  const hasWork = intent.prices.length > 0 || intent.add.length > 0 || intent.renames.length > 0 || extra.main || extra.title || extra.desc;
  const chosen = (targets || []).filter((t) => pick[keyOf(t)]);
  const body = (t, imgOverride) => ({ target: { platform: t.platform, shop: t.shop, itemId: t.itemId }, src: job.src, intent, imgs: imgOverride || imgs[keyOf(t)] || {} });

  async function previewOne(t, imgOverride) {
    const k = keyOf(t);
    setPrev((p) => ({ ...p, [k]: { loading: true } }));
    setRes((r) => { const n = { ...r }; delete n[k]; return n; });
    try {
      const j = await post({ ...body(t, imgOverride), action: 'preview' });
      setPrev((p) => ({ ...p, [k]: { preview: j.preview } }));
      return j.preview;
    } catch (e) { setPrev((p) => ({ ...p, [k]: { error: e.message } })); return null; }
  }
  const previewAll = () => { setRes({}); chosen.forEach((t) => previewOne(t)); };
  const toggleExtra = (k) => { setExtra((x) => ({ ...x, [k]: !x[k] })); setPrev({}); setRes({}); };
  const pickImg = (t, text, id) => {
    const k = keyOf(t);
    const next = { ...(imgs[k] || {}) };
    if (id) next[text] = id; else delete next[text];
    setImgs((m) => ({ ...m, [k]: next }));
    previewOne(t, next);
  };

  const ready = chosen.filter((t) => isReady(prev[keyOf(t)]?.preview) && !res[keyOf(t)]?.ok);

  // ยิงทีละร้าน — ร้านที่พลาดไม่ทำให้ร้านอื่นหยุด
  async function run(list, pv) {
    setBusy(true);
    setRes((r) => ({ ...r, ...Object.fromEntries(list.map((t) => [keyOf(t), { waiting: true }])) }));
    for (const t of list) {
      const k = keyOf(t);
      setRes((r) => ({ ...r, [k]: { running: true } }));
      try {
        const j = await post({ ...body(t), action: 'apply', sig: pv[k].sig });
        setRes((r) => ({ ...r, [k]: { ok: true, text: `✓ สำเร็จ · ${j.done.join(' · ')}${j.warnings?.length ? ' · ' + j.warnings.join(' · ') : ''}` } }));
      } catch (e) { setRes((r) => ({ ...r, [k]: { ok: false, text: `✕ ไม่สำเร็จ · ${e.message}` } })); }
    }
    setBusy(false);
  }
  const confirmText = (list, pv) => list.map((t) => `${t.label} (${t.itemId}):\n  ${pv[keyOf(t)].lines.join('\n  ')}`).join('\n\n');

  async function applyAll() {
    const pv = Object.fromEntries(ready.map((t) => [keyOf(t), prev[keyOf(t)].preview]));
    if (!window.confirm(`เขียนลงตะกร้าจริง ${ready.length} ร้าน?\n\n${confirmText(ready, pv)}`)) return;
    await run(ready, pv);
  }

  // ลองใหม่เฉพาะร้านที่ไม่สำเร็จ: อ่านตะกร้าสดใหม่ (ส่วนที่ทำไปแล้วจะหายจากรายการ) แล้วยิงต่อ
  async function retryFailed() {
    const failed = chosen.filter((t) => res[keyOf(t)] && res[keyOf(t)].ok === false);
    setBusy(true);
    const got = await Promise.all(failed.map(async (t) => [t, await previewOne(t)]));
    setBusy(false);
    const list = got.filter(([, p]) => isReady(p)).map(([t]) => t);
    if (!list.length) return;
    const pv = Object.fromEntries(got.filter(([, p]) => isReady(p)).map(([t, p]) => [keyOf(t), p]));
    if (!window.confirm(`ลองใหม่ ${list.length} ร้าน?\n\n${confirmText(list, pv)}`)) return;
    await run(list, pv);
  }

  const anyLoading = Object.values(prev).some((p) => p.loading);
  const ran = chosen.filter((t) => res[keyOf(t)]?.ok !== undefined);
  const okN = ran.filter((t) => res[keyOf(t)].ok).length;
  const failed = ran.filter((t) => !res[keyOf(t)].ok);
  const finished = !busy && ran.length > 0;

  return (
    <section className="pcard esec cross" ref={box}>
      <div className="cross-h">
        <h2 className="esec-h" style={{ margin: 0 }}>ใช้กับร้านอื่นด้วย</h2>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>ปิด</button>
      </div>
      <div className="sub" style={{ margin: '4px 0 10px' }}>
        ที่เพิ่งแก้: {job.title.join(' · ')}
        {job.notes.length > 0 && <span className="sku"> · ไม่ส่งต่อ: {job.notes.join(', ')}</span>}
        <span className="sku"> · ส่งเฉพาะร้านกลุ่มเดียวกัน ({shop})</span>
      </div>

      <div className="cross-extra">
        <span className="sku">ส่งของต้นทางไปทับด้วย (ติ๊กเอง):</span>
        {EXTRA.map((x) => (
          <label key={x.k} className="cross-x">
            <input type="checkbox" checked={extra[x.k]} disabled={busy} onChange={() => toggleExtra(x.k)} />
            {x.label}{x.hint && <span className="sku"> ({x.hint})</span>}
          </label>
        ))}
      </div>

      {targets === null && <div className="sku">กำลังหาตะกร้าเดียวกันในร้านอื่น…</div>}
      {err && <div className="danger">{err}</div>}
      {targets && !err && !targets.length && <div className="sku">ไม่เจอตะกร้าที่มีเลข SKU ตรงกันในร้าน {shop} บนแพลตฟอร์มอื่น (ต้องตรง ≥ 3 ตัว หรือ ≥ ครึ่งหนึ่ง)</div>}

      {finished && (
        <div className={'cross-sum ' + (failed.length ? 'bad' : 'good')}>
          <b>สำเร็จ {okN}/{ran.length} ร้าน</b>
          {failed.length > 0 && <span> · ไม่สำเร็จ: {failed.map((t) => t.label).join(', ')}</span>}
          {failed.length > 0 && <button type="button" className="btn" onClick={retryFailed} disabled={busy || anyLoading}>ลองใหม่เฉพาะร้านที่ไม่สำเร็จ</button>}
        </div>
      )}
      {busy && Object.values(res).some((r) => r.running || r.waiting) && <div className="sku" style={{ margin: '6px 0' }}>กำลังส่งทีละร้าน… อย่าปิดหน้านี้</div>}

      {targets && targets.length > 0 && (
        <>
          <div className="cross-list">
            {targets.map((t) => {
              const k = keyOf(t);
              const p = prev[k];
              const r = res[k];
              const pv = p?.preview;
              return (
                <div key={k} className={'cross-row' + (pick[k] ? '' : ' off')}>
                  <label className="cross-pick">
                    <input type="checkbox" checked={Boolean(pick[k])} disabled={busy} onChange={() => setPick((x) => ({ ...x, [k]: !x[k] }))} />
                    {t.thumb ? <img className="thumb" src={t.thumb} alt="" loading="lazy" /> : <span className="thumb thumb-empty" />}
                    <span style={{ minWidth: 0 }}>
                      <span className="shop" data-shop={t.shop}>{t.label}</span>{' '}
                      <a className="link sku" href={`/product/${t.platform}/${encodeURIComponent(t.shop)}/${encodeURIComponent(t.itemId)}/edit`} target="_blank" rel="noreferrer">{t.itemId} ↗</a>
                      <span className="sku clamp1">{t.title || ''}</span>
                      <span className="sku"> SKU ตรงกัน {t.n}{t.total !== null ? `/${t.total}` : ''} (ต้นทาง {t.mine})</span>
                    </span>
                  </label>
                  {pick[k] && (p || r) && (
                    <div className="cross-body">
                      {p?.loading && <span className="sku">กำลังอ่านตะกร้าสด…</span>}
                      {p?.error && <span className="danger">{p.error}</span>}
                      {pv && pv.why && <span className="danger">ข้าม: {pv.why}</span>}
                      {pv && !pv.why && (
                        <>
                          {pv.lines.length > 0
                            ? <ul className="cross-ul">{pv.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                            : <span className="sku">ไม่มีอะไรต้องเปลี่ยนในร้านนี้</span>}
                          {pv.warns.length > 0 && <ul className="cross-ul warn">{pv.warns.map((l) => <li key={l}>⚠ {l}</li>)}</ul>}
                          {pv.skipped.length > 0 && <ul className="cross-ul skip">{pv.skipped.map((l) => <li key={l}>ข้าม — {l}</li>)}</ul>}
                          {pv.needImg.map((x) => (
                            <div key={x.text} className="basket-img">
                              <span className={x.image_id || x.src ? 'sku' : 'danger'}>
                                รูปของ <b>{x.text}</b>{x.image_id ? ': เลือกเองจากร้านนี้' : x.src ? ': ใช้รูปจากต้นทาง' : ' (ร้านนี้บังคับ — ต้นทางไม่มีรูป เลือกจากร้านนี้)'}
                              </span>
                              {x.src && <span className="pick on" title="รูปจากต้นทาง"><img src={x.src.url} alt="" loading="lazy" /></span>}
                              {x.image_id && <button type="button" className="btn" style={{ padding: '2px 8px' }} disabled={busy} onClick={() => pickImg(t, x.text, null)}>ใช้รูปต้นทาง</button>}
                              <span className="sku">หรือเลือกของร้านนี้:</span>
                              {pv.gallery.map((g) => (
                                <button key={g.image_id} type="button" className={'pick' + (x.image_id === g.image_id ? ' on' : '')} disabled={busy}
                                  onClick={() => pickImg(t, x.text, g.image_id)} title="ใช้รูปนี้">
                                  <img src={g.image_url} alt="" loading="lazy" />
                                </button>
                              ))}
                            </div>
                          ))}
                          {pv.mainPrev && (
                            <div className="cross-imgs">
                              <span className="sku">รูปสินค้าเดิม</span>
                              <span className="cross-strip">{pv.mainPrev.from.map((u, i) => <img key={i} src={u} alt="" loading="lazy" />)}</span>
                              <span className="sku">→ ใหม่</span>
                              <span className="cross-strip">{pv.mainPrev.to.map((u, i) => <img key={i} src={u} alt="" loading="lazy" />)}</span>
                            </div>
                          )}
                          {pv.descPrev && (
                            <details className="cross-desc">
                              <summary className="sku">ดูรายละเอียดเดิม / ใหม่</summary>
                              <div className="cross-desc-g">
                                <div><b className="sku">เดิม</b><pre>{pv.descPrev.from || '(ว่าง)'}</pre></div>
                                <div><b className="sku">ใหม่</b><pre>{pv.descPrev.to}</pre></div>
                              </div>
                            </details>
                          )}
                        </>
                      )}
                      {r?.waiting && <div className="sku">รอคิว</div>}
                      {r?.running && <div className="sku">กำลังส่ง…</div>}
                      {r && r.ok !== undefined && <div className={r.ok ? 'ok-t' : 'danger'}>{r.text}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="bedit-bar" style={{ marginTop: 10 }}>
            <button type="button" className="btn" onClick={previewAll} disabled={busy || anyLoading || !chosen.length || !hasWork}>
              {anyLoading ? 'กำลังอ่าน…' : `ดูตัวอย่าง (${chosen.length} ร้าน)`}
            </button>
            <button type="button" className="btn dark" onClick={applyAll} disabled={busy || anyLoading || !ready.length}>
              {busy ? 'กำลังส่ง…' : `ยืนยันส่ง ${ready.length} ร้าน`}
            </button>
            <span className="sku">
              {hasWork ? 'ยังไม่เขียนอะไรจนกดยืนยัน · ร้านที่แปลงไม่ได้จะถูกข้าม' : 'ติ๊กอย่างน้อยหนึ่งอย่างที่จะส่งต่อ'}
              {chosen.some((t) => t.platform === 'tiktok') ? ' · TikTok แก้ตัวเลือก/ชื่อ/รูปต้องรอตรวจ' : ''}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
