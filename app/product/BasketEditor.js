'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// หน้าแก้ไขสินค้า Shopee (หน้าตาตาม BigSeller) — /product/shopee/[shop]/[id]/edit
//   แถบบน: ← กลับ · สถานะ · ปุ่ม "อัปเดต"
//   ตัวเลือกสินค้า: กล่องละชั้น (สี / ไซส์) ตัวเลือกเดิมล็อกไว้ เพิ่มตัวใหม่ได้ · สีใหม่เลือกรูปได้ (Shopee บังคับถ้าสีเดิมมีรูป)
//   SKU, สต็อกและราคา: SKU เดิมดูอย่างเดียว · แถวเหลือง = SKU ใหม่ แก้รหัส/คลัง/ราคาได้ · แก้เป็นชุดได้
//   children = ส่วนราคาพิเศษ (โปรส่วนลด — app/product/ItemPromo.js) วางต่อจากตาราง
// เพิ่มได้อย่างเดียว ไม่ลบ/ไม่แก้ตัวเลือกเดิม · ตรวจซ้ำที่เซิร์ฟเวอร์ทุกอย่าง (lib/basket.js, /api/basket/shopee)
// SKU ใหม่ = รหัสสี + ไซส์ ต่อกันตรงๆ แบบรหัส Seniorsoft (062541000 + S) · รหัสสีเดาจาก SKU เดิมของตะกร้า
const up = (s) => String(s ?? '').trim().toUpperCase();
const BUFFER = 2;   // คลังเริ่มต้น = ST − 2 (ต้องตรงกับ ST_BUFFER ใน lib/basket.js)
const baht = (n) => (n === null || n === undefined || n === '' ? '—' : '฿' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }));

export default function BasketEditor({ shop, itemId, plan, promoOf = {}, back, statusLabel, statusTone, children }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [add, setAdd] = useState([[], []]);     // ตัวเลือกใหม่ต่อชั้น [{ text, code, image_id, image_url }]
  const [draft, setDraft] = useState(['', '']); // ช่องพิมพ์ต่อชั้น
  const [draftCode, setDraftCode] = useState('');
  const [st, setSt] = useState(() => new Map(plan.st.map((r) => [up(r.sku), r])));   // SKU ตัวใหญ่ → { qty, price }
  const [ovr, setOvr] = useState({});           // แก้เองในตาราง key → { sku, price, stock }
  const [bulk, setBulk] = useState({ price: '', stock: '' });

  const tiers = plan.tiers;
  const sizeTier = plan.sizeTier;
  const colorTier = tiers.length === 2 && sizeTier >= 0 ? 1 - sizeTier : (tiers.length === 2 ? 0 : -1);
  const all = tiers.map((t, ti) => [
    ...t.options.map((o) => ({ text: o.text, old: true, image_url: o.image_url, code: ti === colorTier ? plan.codes[o.text] : undefined })),
    ...add[ti],
  ]);
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

  const api = (q) => `/api/basket/shopee?${new URLSearchParams({ shop, itemId, ...q })}`;
  const setO = (key, f, v) => setOvr((x) => ({ ...x, [key]: { ...(x[key] || {}), [f]: v } }));
  const applyBulk = () => {
    setOvr((x) => {
      const n = { ...x };
      for (const r of rows) {
        n[r.key] = { ...(n[r.key] || {}), ...(bulk.price !== '' ? { price: bulk.price } : {}), ...(bulk.stock !== '' ? { stock: bulk.stock } : {}) };
      }
      return n;
    });
  };
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
  const setImg = (text, img) => setAdd((a) => a.map((l, i) => (i === 0 ? l.map((o) => (o.text === text ? { ...o, ...img } : o)) : l)));
  // รูปจากเครื่อง → อัปโหลดเข้าคลังสื่อ Shopee ได้ image_id (ยังไม่ผูกตะกร้าจนกดอัปเดต)
  async function upload(text, file) {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) { setMsg({ ok: false, text: 'รูปต้องเป็น JPG หรือ PNG' }); return; }
    if (file.size > 4 * 1024 * 1024) { setMsg({ ok: false, text: 'รูปใหญ่เกิน 4MB' }); return; }
    setBusy(true); setMsg(null);
    try {
      const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(file); });
      const res = await fetch('/api/basket/shopee', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'upload', shop, data, type: file.type }) });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error);
      setImg(text, { image_id: j.image_id, image_url: URL.createObjectURL(file) });
    } catch (e) { setMsg({ ok: false, text: `อัปโหลดรูปไม่สำเร็จ: ${e.message}` }); }
    finally { setBusy(false); }
  }

  const noImg = plan.needImage ? add[0].filter((o) => !o.image_id).length : 0;
  const badRows = rows.filter((r) => !(Number(r.price) > 0) || r.stock === '' || !Number.isInteger(Number(r.stock)) || Number(r.stock) < 0).length;
  const nNewOpt = add.reduce((n, l) => n + l.length, 0);

  async function save() {
    const lines = add.map((l, ti) => (l.length ? `${tiers[ti]?.name}: ${l.map((o) => o.text).join(', ')}` : null)).filter(Boolean);
    if (!window.confirm(`อัปเดตตะกร้าจริงใน Shopee ${shop}?\n\n${lines.join('\n')}\nSKU ใหม่ ${rows.length} ตัว\n\nตัวเลือกเดิมไม่ถูกแตะ`)) return;
    setBusy(true); setMsg(null);
    try {
      const body = {
        shop, itemId,
        add: tiers.map((_, ti) => add[ti].map((o) => (ti === 0 && o.image_id ? { text: o.text, image_id: o.image_id } : o.text))),
        models: rows.map((r) => ({ opts: r.opts.map((o) => o.text), sku: r.sku, price: Number(r.price), stock: Number(r.stock) })),
      };
      const res = await fetch('/api/basket/shopee', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error);
      setMsg({ ok: true, text: `✓ เพิ่ม ${j.added.length} SKU แล้ว${j.warnings?.length ? ' · ' + j.warnings.join(' · ') : ''}` });
      setAdd([[], []]); setOvr({});
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  const sug = plan.suggest;
  const optText = (m, ti) => tiers[ti].options[m.tier_index[ti]]?.text ?? '—';
  const canSave = !busy && rows.length > 0 && badRows === 0 && noImg === 0;

  return (
    <>
      <div className="etop">
        <div className="etop-l">
          <Link className="sub" style={{ margin: 0 }} href={back}>←</Link>
          <span>Shopee &gt; <b>แก้ไขสินค้า</b></span>
          <span className="shop" data-shop={shop}>{shop}</span>
          {statusLabel && <span className={'badge ' + (statusTone || '')}>{statusLabel}</span>}
        </div>
        <div className="etop-r">
          {msg && <span className={msg.ok ? 'ok-t' : 'danger'}>{msg.text}</span>}
          {!msg && (nNewOpt > 0 || rows.length > 0) && <span className="sku">ตัวเลือกใหม่ {nNewOpt} · SKU ใหม่ {rows.length} · ยังไม่ได้อัปเดต</span>}
          <button type="button" className="btn dark" onClick={save} disabled={!canSave}>{busy ? 'กำลังอัปเดต…' : 'อัปเดต'}</button>
        </div>
      </div>

      <section className="pcard esec">
        <h2 className="esec-h">ข้อมูลการขาย</h2>

        {(!plan.hasModel || !tiers.length) ? (
          <div className="sku">ตะกร้านี้ไม่มีตัวเลือก — เพิ่มตัวเลือกชั้นแรกในหลังร้าน Shopee</div>
        ) : (
          <>
            {(sug.colors.length > 0 || sug.sizes.length > 0) && (
              <div className="note" style={{ marginBottom: 12 }}>
                <b>ใน ST มีแต่ตะกร้ายังไม่มี</b> <span className="sku">(รหัสขึ้นต้น <span className="mono">{plan.prefix}</span>) — กดเพื่อเพิ่ม</span>
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
              </div>
            )}

            <div className="erow">
              <div className="elabel">ตัวเลือกสินค้า</div>
              <div className="efield">
                {tiers.map((t, ti) => (
                  <div key={ti} className="etier">
                    <div className="etier-h"><b>{t.name}</b><span className="sku">{all[ti].length} ตัวเลือก</span></div>
                    <div className="basket-opts">
                      {all[ti].map((o) => (
                        <span key={o.text} className={'opt ' + (o.old ? '' : 'new')}>
                          <span className="ck">{o.old ? '☑' : '＋'}</span>
                          {o.text}{o.code && <span className="mono sku"> {o.code}</span>}
                          {!o.old && <button type="button" className="x" onClick={() => delOpt(ti, o.text)} title="เอาออก">✕</button>}
                        </span>
                      ))}
                    </div>
                    {ti === 0 && all[0].some((o) => o.image_url) && (
                      <div className="eimgs">
                        {all[0].map((o) => (
                          <div key={o.text} className={'eimg' + (o.old ? '' : ' new')}>
                            {o.image_url ? <img src={o.image_url} alt="" loading="lazy" /> : <span className="eimg-empty">+ รูป</span>}
                            <span className="sku clamp1">{o.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {ti === 0 && plan.needImage && add[0].map((o) => (
                      <div key={o.text} className="basket-img">
                        <span className={o.image_id ? 'sku' : 'danger'}>รูปของ <b>{o.text}</b>{o.image_id ? ' ✓' : ' (Shopee บังคับ)'}:</span>
                        {plan.gallery.map((g) => (
                          <button key={g.image_id} type="button" className={'pick' + (o.image_id === g.image_id ? ' on' : '')}
                            onClick={() => setImg(o.text, { image_id: g.image_id, image_url: g.image_url })} title="ใช้รูปนี้">
                            <img src={g.image_url} alt="" loading="lazy" />
                          </button>
                        ))}
                        <label className="btn" style={{ padding: '4px 10px' }}>อัปโหลด…
                          <input type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { upload(o.text, e.target.files?.[0]); e.target.value = ''; }} />
                        </label>
                      </div>
                    ))}
                    <div className="bedit-bar">
                      <input className="bin" style={{ width: 150, textAlign: 'left' }} value={draft[ti]} placeholder={ti === sizeTier ? 'เช่น 3XL หรือ 3XL 4XL' : 'ชื่อตัวเลือก เช่น แดง'}
                        onChange={(e) => setDraft((d) => d.map((x, i) => (i === ti ? e.target.value : x)))} />
                      {ti === colorTier && (
                        <input className="bin" style={{ width: 130, textAlign: 'left' }} value={draftCode} placeholder="รหัสสี (ถ้ามี)" onChange={(e) => setDraftCode(e.target.value)} />
                      )}
                      <button type="button" className="btn" onClick={() => {
                        if (ti === sizeTier) draft[ti].split(/[\s,]+/).forEach((x) => addOpt(ti, x));
                        else addOpt(ti, draft[ti], ti === colorTier ? draftCode : undefined);
                        setDraft((d) => d.map((x, i) => (i === ti ? '' : x))); if (ti === colorTier) setDraftCode('');
                      }}>+ เพิ่มตัวเลือก</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="erow">
              <div className="elabel">SKU, สต็อกและราคา</div>
              <div className="efield">
                {rows.length > 0 && (
                  <div className="bedit-bar">
                    <span className="sku">แก้เป็นชุด (เฉพาะแถวใหม่):</span>
                    <input className="bin" placeholder="฿ ราคา" value={bulk.price} inputMode="numeric" onChange={(e) => setBulk((b) => ({ ...b, price: e.target.value.replace(/[^\d.]/g, '') }))} />
                    <input className="bin" style={{ width: 64 }} placeholder="สต็อก" value={bulk.stock} inputMode="numeric" onChange={(e) => setBulk((b) => ({ ...b, stock: e.target.value.replace(/\D/g, '') }))} />
                    <button type="button" className="btn" onClick={applyBulk} disabled={bulk.price === '' && bulk.stock === ''}>ใช้</button>
                  </div>
                )}
                <div className="skutable-wrap">
                  <table className="dopts etable">
                    <thead>
                      <tr>
                        <th>SKU ID</th>
                        {tiers.map((t, ti) => <th key={ti}>{t.name}</th>)}
                        <th>SKU</th><th className="r">ST</th><th className="r">สต็อก</th><th className="r">ราคา</th><th className="r">ราคาพิเศษ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.models.map((m) => (
                        <tr key={m.model_id}>
                          <td className="sku mono">{m.model_id}</td>
                          {tiers.map((_, ti) => <td key={ti}>{optText(m, ti)}</td>)}
                          <td className="mono">{m.sku || <span className="sku">—</span>}</td>
                          <td className="num sku">{st.get(up(m.sku))?.qty ?? '—'}</td>
                          <td className={'num ' + (Number(m.stock) === 0 ? 'danger' : '')}>{Number(m.stock) === 0 ? 'หมด' : m.stock ?? '—'}</td>
                          <td className="num">{baht(m.price)}</td>
                          <td className="num">{promoOf[m.model_id] ? <span className="promo">{baht(promoOf[m.model_id])}</span> : <span className="sku">—</span>}</td>
                        </tr>
                      ))}
                      {rows.map((r) => (
                        <tr key={r.key} className="bchg">
                          <td><span className="badge warn">ใหม่</span></td>
                          {r.opts.map((o, ti) => <td key={ti}>{o.text}</td>)}
                          <td><input className="bin" style={{ width: 140, textAlign: 'left' }} value={r.sku} onChange={(e) => setO(r.key, 'sku', e.target.value.trim())} /></td>
                          <td className="num">{r.s ? <span className="ok-t">✓ {r.s.qty}</span> : <span className="danger" title="ไม่เจอรหัสนี้ใน ST">✕</span>}</td>
                          <td className="num"><input className={'bin ' + (r.stock === '' ? 'bad' : '')} style={{ width: 64 }} value={r.stock} inputMode="numeric" onChange={(e) => setO(r.key, 'stock', e.target.value.replace(/\D/g, ''))} /></td>
                          <td className="num"><input className={'bin ' + (Number(r.price) > 0 ? '' : 'bad')} value={r.price} inputMode="numeric" onChange={(e) => setO(r.key, 'price', e.target.value.replace(/[^\d.]/g, ''))} /></td>
                          <td className="num sku">ใส่โปรหลังอัปเดต</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="sub" style={{ margin: '8px 0 0' }}>
                  SKU เดิมดูได้อย่างเดียว (คลังให้ระบบซิงก์ดูแล) · แถวเหลือง = SKU ใหม่ คลังเริ่ม = ST − {BUFFER} · ไม่อยากขายคู่ไหนให้ใส่คลัง 0
                  {noImg > 0 && <span className="danger"> · ยังไม่ได้เลือกรูป {noImg} สี</span>}
                  {badRows > 0 && <span className="danger"> · ราคา/สต็อกไม่ถูก {badRows} แถว</span>}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {children}
    </>
  );
}
