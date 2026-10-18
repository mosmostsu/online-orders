'use client';
import { useEffect, useState } from 'react';

// แก้พร้อมกันทุกร้าน — โผล่หลังกด "อัปเดต" / "บันทึกการจัดการตัวเลือก" สำเร็จ (BasketEditor ส่ง job มา)
//   job: { title: [บรรทัดสรุปสิ่งที่แก้], src: ตะกร้าต้นทางก่อนแก้, intent: { prices, add, renames }, notes: [สิ่งที่ไม่ส่งต่อ] }
//   1. ดึงตะกร้าเดียวกันในร้านอื่น (/api/basket-cross GET) ติ๊กเลือกร้าน (ติ๊กไว้ทุกร้านเป็นค่าเริ่มต้น)
//   2. "ดูตัวอย่าง" → ร้านละคำขอ อ่านตะกร้าสด แปลงคำสั่ง บอกว่าจะเปลี่ยนอะไร / ข้ามอะไรเพราะอะไร (ยังไม่เขียน)
//      ร้านที่บังคับรูปสีใหม่ → เลือกรูปจากรูปของตะกร้านั้น แล้วขอตัวอย่างใหม่ (ได้ sig ใหม่)
//   3. "ยืนยัน" → ยิงทีละร้าน เซิร์ฟเวอร์แปลงใหม่ต้องตรงกับตัวอย่าง (sig) ไม่งั้นไม่เขียน
const keyOf = (t) => `${t.platform}|${t.shop}|${t.itemId}`;
const post = async (body) => {
  const res = await fetch('/api/basket-cross', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
  if (!j.ok) throw new Error(j.error);
  return j;
};

export default function CrossShop({ platform, shop, itemId, job, onClose }) {
  const [targets, setTargets] = useState(null);   // null = กำลังโหลด
  const [err, setErr] = useState(null);
  const [pick, setPick] = useState({});           // key → ติ๊กไหม
  const [prev, setPrev] = useState({});           // key → { loading, preview, error }
  const [imgs, setImgs] = useState({});           // key → { ข้อความสีใหม่: รหัสรูป }
  const [res, setRes] = useState({});             // key → { ok, text }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setTargets(null); setErr(null); setPrev({}); setRes({}); setImgs({});
    fetch(`/api/basket-cross?${new URLSearchParams({ platform, shop, itemId })}`).then((r) => r.json()).then((j) => {
      if (!live) return;
      if (!j.ok) { setErr(j.error); setTargets([]); return; }
      setTargets(j.targets);
      setPick(Object.fromEntries(j.targets.map((t) => [keyOf(t), true])));
    }).catch((e) => { if (live) { setErr(e.message); setTargets([]); } });
    return () => { live = false; };
  }, [job, platform, shop, itemId]);

  const chosen = (targets || []).filter((t) => pick[keyOf(t)]);
  const body = (t, extra = {}) => ({ target: { platform: t.platform, shop: t.shop, itemId: t.itemId }, src: job.src, intent: job.intent, imgs: imgs[keyOf(t)] || {}, ...extra });

  async function previewOne(t, imgOverride) {
    const k = keyOf(t);
    setPrev((p) => ({ ...p, [k]: { loading: true } }));
    setRes((r) => { const n = { ...r }; delete n[k]; return n; });
    try {
      const j = await post({ ...body(t), action: 'preview', ...(imgOverride ? { imgs: imgOverride } : {}) });
      setPrev((p) => ({ ...p, [k]: { preview: j.preview } }));
    } catch (e) { setPrev((p) => ({ ...p, [k]: { error: e.message } })); }
  }
  const previewAll = () => { setRes({}); chosen.forEach((t) => previewOne(t)); };
  const pickImg = (t, text, id) => {
    const k = keyOf(t);
    const next = { ...(imgs[k] || {}), [text]: id };
    setImgs((m) => ({ ...m, [k]: next }));
    previewOne(t, next);
  };

  const ready = chosen.filter((t) => {
    const p = prev[keyOf(t)]?.preview;
    return p && !p.empty && !p.why && !p.needImg.some((x) => !x.image_id) && !res[keyOf(t)]?.ok;
  });

  async function applyAll() {
    const lines = ready.map((t) => `${t.label} (${t.itemId}):\n  ${prev[keyOf(t)].preview.lines.join('\n  ')}`);
    if (!window.confirm(`เขียนลงตะกร้าจริง ${ready.length} ร้าน?\n\n${lines.join('\n\n')}`)) return;
    setBusy(true);
    for (const t of ready) {
      const k = keyOf(t);
      try {
        const j = await post({ ...body(t), action: 'apply', sig: prev[k].preview.sig });
        setRes((r) => ({ ...r, [k]: { ok: true, text: `✓ ${j.done.join(' · ')}${j.warnings?.length ? ' · ' + j.warnings.join(' · ') : ''}` } }));
      } catch (e) { setRes((r) => ({ ...r, [k]: { ok: false, text: e.message } })); }
    }
    setBusy(false);
  }

  const anyLoading = Object.values(prev).some((p) => p.loading);

  return (
    <section className="pcard esec cross">
      <div className="cross-h">
        <h2 className="esec-h" style={{ margin: 0 }}>ใช้กับร้านอื่นด้วย</h2>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>ปิด</button>
      </div>
      <div className="sub" style={{ margin: '4px 0 10px' }}>
        ที่เพิ่งแก้: {job.title.join(' · ')}
        {job.notes.length > 0 && <span className="sku"> · ไม่ส่งต่อ: {job.notes.join(', ')}</span>}
      </div>

      {targets === null && <div className="sku">กำลังหาตะกร้าเดียวกันในร้านอื่น…</div>}
      {err && <div className="danger">{err}</div>}
      {targets && !err && !targets.length && <div className="sku">ไม่เจอตะกร้าที่มีเลข SKU ตรงกันในร้านอื่น (ต้องตรง ≥ 3 ตัว หรือ ≥ ครึ่งหนึ่ง)</div>}

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
                  {pick[k] && p && (
                    <div className="cross-body">
                      {p.loading && <span className="sku">กำลังอ่านตะกร้าสด…</span>}
                      {p.error && <span className="danger">{p.error}</span>}
                      {pv && pv.why && <span className="danger">ข้าม: {pv.why}</span>}
                      {pv && !pv.why && (
                        <>
                          {pv.lines.length > 0
                            ? <ul className="cross-ul">{pv.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                            : <span className="sku">ไม่มีอะไรต้องเปลี่ยนในร้านนี้</span>}
                          {pv.skipped.length > 0 && (
                            <ul className="cross-ul skip">{pv.skipped.map((l) => <li key={l}>ข้าม — {l}</li>)}</ul>
                          )}
                          {pv.needImg.map((x) => (
                            <div key={x.text} className="basket-img">
                              <span className={x.image_id ? 'sku' : 'danger'}>รูปของ <b>{x.text}</b>{x.image_id ? ' ✓' : ' (ร้านนี้บังคับ)'}:</span>
                              {pv.gallery.map((g) => (
                                <button key={g.image_id} type="button" className={'pick' + (x.image_id === g.image_id ? ' on' : '')} disabled={busy}
                                  onClick={() => pickImg(t, x.text, g.image_id)} title="ใช้รูปนี้">
                                  <img src={g.image_url} alt="" loading="lazy" />
                                </button>
                              ))}
                            </div>
                          ))}
                        </>
                      )}
                      {r && <div className={r.ok ? 'ok-t' : 'danger'}>{r.text}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="bedit-bar" style={{ marginTop: 10 }}>
            <button type="button" className="btn" onClick={previewAll} disabled={busy || anyLoading || !chosen.length}>
              {anyLoading ? 'กำลังอ่าน…' : `ดูตัวอย่าง (${chosen.length} ร้าน)`}
            </button>
            <button type="button" className="btn dark" onClick={applyAll} disabled={busy || anyLoading || !ready.length}>
              {busy ? 'กำลังเขียน…' : `ยืนยันใช้กับ ${ready.length} ร้าน`}
            </button>
            <span className="sku">ยังไม่เขียนอะไรจนกดยืนยัน · ร้านที่แปลงไม่ได้จะถูกข้าม{chosen.some((t) => t.platform === 'tiktok') ? ' · TikTok เพิ่ม/เปลี่ยนชื่อต้องรอตรวจ' : ''}</span>
          </div>
        </>
      )}
    </section>
  );
}
