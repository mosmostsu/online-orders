'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// "แก้ตะกร้า / เพิ่ม SKU" ในหน้ารายละเอียดสินค้า (Shopee) — เพิ่มสี/ไซส์ใหม่ + สร้าง SKU ให้ครบทุกคู่
// เพิ่มได้อย่างเดียว ไม่ลบ/ไม่แก้ตัวเลือกเดิม · ตรวจซ้ำที่เซิร์ฟเวอร์ทุกอย่าง (lib/basket.js, /api/basket/shopee)
// SKU ใหม่ = รหัสสี + ไซส์ ต่อกันตรงๆ แบบรหัส Seniorsoft (062541000 + S) · รหัสสีเดาจาก SKU เดิมของตะกร้า
const up = (s) => String(s ?? '').trim().toUpperCase();
const BUFFER = 2;   // คลังเริ่มต้น = ST − 2 (ต้องตรงกับ ST_BUFFER ใน lib/basket.js)

export default function BasketAdd({ shop, itemId }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [add, setAdd] = useState([[], []]);     // ตัวเลือกใหม่ต่อชั้น [{ text, code }]
  const [draft, setDraft] = useState(['', '']); // ช่องพิมพ์ต่อชั้น
  const [draftCode, setDraftCode] = useState('');
  const [st, setSt] = useState(new Map());      // SKU ตัวใหญ่ → { qty, price }
  const [ovr, setOvr] = useState({});           // แก้เองในตาราง key → { sku, price, stock }

  const api = (q) => `/api/basket/shopee?${new URLSearchParams({ shop, itemId, ...q })}`;

  async function load() {
    setOpen(true);
    if (plan) return;
    setBusy(true); setMsg(null);
    try {
      const j = await fetch(api({})).then((r) => r.json()).catch(() => ({ ok: false, error: 'โหลดไม่สำเร็จ' }));
      if (!j.ok) throw new Error(j.error);
      setPlan(j.plan);
      setSt(new Map(j.plan.st.map((r) => [up(r.sku), r])));
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  if (!open) {
    return (
      <section className="pcard" style={{ marginBottom: 14 }}>
        <div className="bedit-bar">
          <h2 className="vh" style={{ margin: 0 }}>แก้ตะกร้า / เพิ่ม SKU</h2>
          <span className="sku">เพิ่มสีหรือไซส์ใหม่ เทียบกับ ST ให้</span>
          <button type="button" className="btn" onClick={load}>เปิด</button>
          {msg && <span className={msg.ok ? 'ok-t' : 'danger'}>{msg.text}</span>}
        </div>
      </section>
    );
  }
  if (!plan) {
    return <section className="pcard" style={{ marginBottom: 14 }}>{busy ? <span className="sku">กำลังอ่านตะกร้าจาก Shopee…</span> : <span className="danger">{msg?.text}</span>}</section>;
  }
  if (!plan.hasModel || !plan.tiers.length) {
    return <section className="pcard" style={{ marginBottom: 14 }}><span className="sku">ตะกร้านี้ไม่มีตัวเลือก — เพิ่มตัวเลือกชั้นแรกในหลังร้าน Shopee</span></section>;
  }

  const tiers = plan.tiers;
  const sizeTier = plan.sizeTier;
  const colorTier = tiers.length === 2 && sizeTier >= 0 ? 1 - sizeTier : (tiers.length === 2 ? 0 : -1);
  const all = tiers.map((t, ti) => [...t.options.map((o) => ({ text: o.text, old: true, code: ti === colorTier ? plan.codes[o.text] : undefined })), ...add[ti]]);
  const oneCode = tiers.length === 1 ? plan.codes[''] : undefined;
  const have = new Set(plan.models.map((m) => m.tier_index.join(',')));
  const prices = plan.models.map((m) => Number(m.price)).filter((p) => p > 0);

  // ทุกคู่ที่มีตัวเลือกใหม่อย่างน้อย 1 ตัว
  const combos = (ti, acc) => (ti === tiers.length ? [acc] : all[ti].flatMap((_, i) => combos(ti + 1, [...acc, i])));
  const rows = combos(0, []).filter((ix) => ix.some((i, ti) => !all[ti][i].old) && !have.has(ix.join(','))).map((ix) => {
    const opts = ix.map((i, ti) => all[ti][i]);
    const key = opts.map((o) => o.text).join('\u0001');
    const size = sizeTier >= 0 ? opts[sizeTier].text : '';
    const code = colorTier >= 0 ? opts[colorTier].code : oneCode;
    const auto = code && size ? `${code}${size}` : '';
    const o = ovr[key] || {};
    const sku = o.sku ?? auto;
    const s = st.get(up(sku));
    // ราคาเริ่มต้น: ST → ตัวเลือกเดิมไซส์เดียวกัน → ราคาสูงสุดของตะกร้า
    const sameSize = sizeTier >= 0 ? plan.models.find((m) => up(tiers[sizeTier].options[m.tier_index[sizeTier]]?.text) === up(size)) : null;
    const price = o.price ?? (s?.price || sameSize?.price || (prices.length ? Math.max(...prices) : ''));
    const stock = o.stock ?? (s ? Math.max(0, s.qty - BUFFER) : 0);
    return { key, opts, sku, s, price, stock };
  });

  const setO = (key, f, v) => setOvr((x) => ({ ...x, [key]: { ...(x[key] || {}), [f]: v } }));
  const addOpt = (ti, text, code) => {
    const t = String(text || '').trim();
    if (!t) return;
    if (all[ti].some((o) => up(o.text) === up(t))) { setMsg({ ok: false, text: `"${t}" มีอยู่แล้ว` }); return; }
    if (t.length > 20) { setMsg({ ok: false, text: `"${t}" ยาวเกิน 20 ตัวอักษร` }); return; }
    setMsg(null);
    setAdd((a) => a.map((l, i) => (i === ti ? [...l, { text: t, code: code ? String(code).trim() : undefined }] : l)));
    // รหัสสีที่พิมพ์เองไม่ได้ขึ้นต้นด้วยคำนำหน้าเดิม → ถาม ST เพิ่ม
    if (code && !(plan.prefix && up(code).startsWith(up(plan.prefix)))) {
      fetch(api({ st: code })).then((r) => r.json()).then((j) => {
        if (j.ok) setSt((m) => { const n = new Map(m); for (const r of j.st) n.set(up(r.sku), r); return n; });
      }).catch(() => {});
    }
  };
  const delOpt = (ti, text) => setAdd((a) => a.map((l, i) => (i === ti ? l.filter((o) => o.text !== text) : l)));

  const problems = rows.filter((r) => !(Number(r.price) > 0) || !Number.isInteger(Number(r.stock)) || Number(r.stock) < 0).length;
  const nNewOpt = add.reduce((n, l) => n + l.length, 0);

  async function save() {
    const lines = add.map((l, ti) => (l.length ? `${tiers[ti]?.name}: ${l.map((o) => o.text).join(', ')}` : null)).filter(Boolean);
    if (!window.confirm(`บันทึกลงตะกร้าจริงใน Shopee ${shop}?\n\n${lines.join('\n')}\nSKU ใหม่ ${rows.length} ตัว\n\nตัวเลือกเดิมไม่ถูกแตะ`)) return;
    setBusy(true); setMsg(null);
    try {
      const body = {
        shop, itemId,
        add: tiers.map((_, ti) => add[ti].map((o) => o.text)),
        models: rows.map((r) => ({ opts: r.opts.map((o) => o.text), sku: r.sku, price: Number(r.price), stock: Number(r.stock) })),
      };
      const res = await fetch('/api/basket/shopee', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error);
      setMsg({ ok: true, text: `✓ เพิ่ม ${j.added.length} SKU แล้ว${j.warnings?.length ? ' · ' + j.warnings.join(' · ') : ''}` });
      setAdd([[], []]); setOvr({}); setPlan(null); setOpen(false);
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  const sug = plan.suggest;
  return (
    <section className="pcard basket" style={{ marginBottom: 14 }}>
      <div className="bedit-bar" style={{ paddingTop: 0 }}>
        <h2 className="vh" style={{ margin: 0 }}>แก้ตะกร้า / เพิ่ม SKU</h2>
        <span className="sku">เพิ่มได้อย่างเดียว — ตัวเลือกเดิมไม่ถูกแตะ</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>ปิด</button>
      </div>

      {(sug.colors.length > 0 || sug.sizes.length > 0) && (
        <div className="note" style={{ marginBottom: 10 }}>
          <b>ใน ST มีแต่ตะกร้ายังไม่มี</b> <span className="sku">(รหัสขึ้นต้น <span className="mono">{plan.prefix}</span>)</span>
          <div className="basket-opts" style={{ marginTop: 6 }}>
            {sug.colors.filter((c) => !all[colorTier]?.some((o) => up(o.code) === up(c.code))).map((c) => (
              <button key={c.code} type="button" className="opt sug" onClick={() => addOpt(colorTier, c.text || c.code, c.code)}
                title={`${c.n} ไซส์ใน ST · คงเหลือรวม ${c.qty}`}>+ {c.text || '(ไม่มีชื่อ)'} <span className="mono sku">{c.code}</span></button>
            ))}
            {sug.sizes.filter((z) => !all[sizeTier]?.some((o) => up(o.text) === up(z.text))).map((z) => (
              <button key={z.text} type="button" className="opt sug" onClick={() => addOpt(sizeTier, z.text)}
                title={`${z.n} สีใน ST · คงเหลือรวม ${z.qty}`}>+ ไซส์ {z.text}</button>
            ))}
          </div>
          <div className="sku" style={{ marginTop: 4 }}>กดเพื่อเพิ่ม · ชื่อสีเดาจากชื่อสินค้าใน ST ตรวจก่อนบันทึก (แก้ชื่อได้ด้วยการลบแล้วพิมพ์เอง)</div>
        </div>
      )}

      {tiers.map((t, ti) => (
        <div key={ti} className="basket-tier">
          <b>{t.name}</b>
          <div className="basket-opts">
            {all[ti].map((o) => (
              <span key={o.text} className={'opt ' + (o.old ? '' : 'new')}>
                {o.text}{o.code && <span className="mono sku"> {o.code}</span>}
                {!o.old && <button type="button" className="x" onClick={() => delOpt(ti, o.text)} title="เอาออก">✕</button>}
              </span>
            ))}
          </div>
          <div className="bedit-bar">
            <input className="bin" style={{ width: 150, textAlign: 'left' }} value={draft[ti]} placeholder={ti === sizeTier ? 'เช่น 3XL' : 'เช่น แดง'}
              onChange={(e) => setDraft((d) => d.map((x, i) => (i === ti ? e.target.value : x)))} maxLength={20} />
            {ti === colorTier && (
              <input className="bin" style={{ width: 120, textAlign: 'left' }} value={draftCode} placeholder="รหัสสี (ถ้ามี)" onChange={(e) => setDraftCode(e.target.value)} />
            )}
            <button type="button" className="btn" onClick={() => {
              if (ti === sizeTier) { draft[ti].split(/[\s,]+/).forEach((x) => addOpt(ti, x)); }
              else addOpt(ti, draft[ti], ti === colorTier ? draftCode : undefined);
              setDraft((d) => d.map((x, i) => (i === ti ? '' : x))); if (ti === colorTier) setDraftCode('');
            }}>+ เพิ่ม{ti === sizeTier ? 'ไซส์' : ''}</button>
            {ti === sizeTier && <span className="sku">หลายไซส์คั่นด้วยเว้นวรรค</span>}
          </div>
        </div>
      ))}

      {rows.length > 0 && (
        <div className="skutable-wrap" style={{ marginTop: 8 }}>
          <table className="dopts">
            <thead><tr><th>ตัวเลือกใหม่</th><th>SKU</th><th className="r">ST</th><th className="r">คลังที่ตั้ง</th><th className="r">ราคา</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="bchg">
                  <td>{r.opts.map((o) => o.text).join(' / ')}</td>
                  <td><input className="bin" style={{ width: 140, textAlign: 'left' }} value={r.sku} onChange={(e) => setO(r.key, 'sku', e.target.value.trim())} /></td>
                  <td className="num">{r.s ? <span className="ok-t">✓ {r.s.qty}</span> : <span className="danger" title="ไม่เจอรหัสนี้ใน ST">✕</span>}</td>
                  <td className="num"><input className="bin" style={{ width: 64 }} value={r.stock} inputMode="numeric" onChange={(e) => setO(r.key, 'stock', e.target.value.replace(/\D/g, ''))} /></td>
                  <td className="num"><input className={'bin ' + (Number(r.price) > 0 ? '' : 'bad')} value={r.price} inputMode="numeric" onChange={(e) => setO(r.key, 'price', e.target.value.replace(/[^\d.]/g, ''))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bedit-bar" style={{ marginTop: 6 }}>
        <span className="sku">
          {nNewOpt ? `ตัวเลือกใหม่ ${nNewOpt} · ` : ''}SKU ใหม่ {rows.length} ตัว
          {rows.length > 0 && ' · คลังเริ่มต้น = ST − 2 · ไม่อยากขายคู่ไหนให้ใส่คลัง 0'}
        </span>
        <span style={{ flex: 1 }} />
        {msg && <span className={msg.ok ? 'ok-t' : 'danger'}>{msg.text}</span>}
        <button type="button" className="btn dark" onClick={save} disabled={busy || !rows.length || problems > 0}>
          {busy ? 'กำลังบันทึก…' : 'อัปเดตขึ้น Shopee'}
        </button>
      </div>
    </section>
  );
}
