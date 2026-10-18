'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// หน้าแก้ไขสินค้า ส่วน "การขายและจัดส่ง" + "ยี่ห้อและคุณสมบัติ" — โหลดสดตอนเปิด (/api/basket/<platform>?more=1, lib/basketMore.js)
//   เปิด/ปิดการขาย (ยืนยันก่อน) · น้ำหนัก/ขนาดพัสดุ · ตารางไซส์ (Shopee/TikTok — เลือกรูปเดิมหรืออัปโหลด)
//   ยี่ห้อ (ค้นจากรายการของหมวด · Lazada พิมพ์ชื่อ) · แอตทริบิวต์ของหมวด (* = บังคับ) — บันทึกเฉพาะที่เปลี่ยน
const LABEL = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok' };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const valKey = (vals) => vals.map((v) => v.id || `~${v.name}`).join('|');

export default function BasketMore({ platform, shop, itemId, gallery = [] }) {
  const label = LABEL[platform] || platform;
  const router = useRouter();
  const [m, setM] = useState(null);           // ข้อมูลจากเซิร์ฟเวอร์
  const [err, setErr] = useState(null);
  const [pkg, setPkg] = useState(null);
  const [chart, setChart] = useState(null);   // { image_id, image_url } ที่เลือกใหม่
  const [pickChart, setPickChart] = useState(false);
  const [brand, setBrand] = useState(null);   // { id, name } ที่เลือกใหม่
  const [bq, setBq] = useState('');
  const [brands, setBrands] = useState(null);
  const [attrs, setAttrs] = useState({});     // id → values ที่แก้
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);

  const api = (q) => `/api/basket/${platform}?${new URLSearchParams({ shop, itemId, ...q })}`;
  async function load() {
    setErr(null);
    try {
      const j = await fetch(api({ more: '1' })).then((r) => r.json());
      if (!j.ok) throw new Error(j.error);
      setM(j.more);
      setPkg({ weight: j.more.pkg.weight ?? '', l: j.more.pkg.l ?? '', w: j.more.pkg.w ?? '', h: j.more.pkg.h ?? '' });
      setChart(null); setBrand(null); setAttrs({}); setBrands(null); setBq('');
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  async function post(body, what) {
    setBusy(what); setMsg(null);
    try {
      const res = await fetch(`/api/basket/${platform}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, shop, itemId }) });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error);
      setMsg({ ok: true, text: `✓ ${what}แล้ว${j.warnings?.length ? ' · ' + j.warnings.join(' · ') : ''}` });
      await load();
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: `${what}ไม่สำเร็จ: ${e.message}` }); }
    finally { setBusy(''); }
  }

  if (err) return <section className="pcard esec"><h2 className="esec-h">การขายและจัดส่ง</h2><div className="note">อ่านข้อมูลไม่ได้: {err} <button type="button" className="btn" onClick={load}>ลองใหม่</button></div></section>;
  if (!m) return <section className="pcard esec"><h2 className="esec-h">การขายและจัดส่ง</h2><div className="sku">กำลังโหลด…</div></section>;

  const pkgOrig = { weight: m.pkg.weight ?? '', l: m.pkg.l ?? '', w: m.pkg.w ?? '', h: m.pkg.h ?? '' };
  const pkgCh = pkg && !same(Object.values(pkg).map(Number), Object.values(pkgOrig).map(Number));
  const pkgBad = pkg && Object.values(pkg).some((v) => !(Number(v) > 0));
  const shipDirty = pkgCh || Boolean(chart);

  async function toggle() {
    const on = !m.status.on;
    if (!window.confirm(`${on ? 'เปิดขาย' : 'ปิดการขาย'}ตะกร้านี้ใน ${label} ${shop}?${on ? '' : '\n\nลูกค้าจะมองไม่เห็น/สั่งไม่ได้จนกว่าจะเปิดอีกครั้ง'}`)) return;
    await post({ action: 'status', on }, on ? 'เปิดขาย' : 'ปิดการขาย');
  }
  async function saveShip() {
    if (!window.confirm(`บันทึกลง ${label} ${shop}?\n\n${pkgCh ? `พัสดุ: ${pkg.weight} กก. · ${pkg.l}×${pkg.w}×${pkg.h} ซม.\n` : ''}${chart ? 'ตารางไซส์: รูปใหม่' : ''}`)) return;
    await post({ action: 'more', ...(pkgCh ? { pkg } : {}), ...(chart ? { sizeChart: chart.image_id } : {}) }, 'บันทึกการจัดส่ง');
  }
  async function uploadChart(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type) || file.size > 4 * 1024 * 1024) { setMsg({ ok: false, text: 'รูปต้องเป็น JPG/PNG ไม่เกิน 4MB' }); return; }
    setBusy('อัปโหลด'); setMsg(null);
    try {
      const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(file); });
      const res = await fetch(`/api/basket/${platform}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'upload', shop, data, type: file.type, use: 'size_chart' }) });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error);
      setChart({ image_id: j.image_id, image_url: URL.createObjectURL(file) }); setPickChart(false);
    } catch (e) { setMsg({ ok: false, text: `อัปโหลดไม่สำเร็จ: ${e.message}` }); }
    finally { setBusy(''); }
  }

  async function findBrands() {
    setBusy('ค้นยี่ห้อ');
    try {
      const j = await fetch(api({ brands: bq })).then((r) => r.json());
      if (!j.ok) throw new Error(j.error);
      setBrands(j.brands);
    } catch (e) { setMsg({ ok: false, text: `ค้นยี่ห้อไม่ได้: ${e.message}` }); }
    finally { setBusy(''); }
  }
  const attrCh = Object.entries(attrs).filter(([id, vals]) => valKey(vals) !== valKey(m.attrs.find((a) => a.id === id)?.value || []));
  const brandCh = brand && String(brand.id ?? brand.name) !== String(m.brand.id ?? m.brand.name);
  const reqMissing = m.attrs.filter((a) => a.required && !(attrs[a.id] ?? a.value).length).length;
  async function saveAttrs() {
    const lines = [brandCh && `ยี่ห้อ: ${m.brand.name || '—'} → ${brand.name}`, ...attrCh.map(([id, vals]) => `${m.attrs.find((a) => a.id === id)?.name}: ${vals.map((v) => v.name).join(', ') || '(ว่าง)'}`)].filter(Boolean);
    if (!window.confirm(`บันทึกลง ${label} ${shop}?\n\n${lines.join('\n')}`)) return;
    await post({ action: 'more', ...(brandCh ? { brand } : {}), ...(attrCh.length ? { attrs: attrCh.map(([id, values]) => ({ id, values })) } : {}) }, 'บันทึกยี่ห้อ/คุณสมบัติ');
  }
  const setA = (id, vals) => setAttrs((x) => ({ ...x, [id]: vals }));
  const blocked = Boolean(m.auditing);

  return (
    <>
      <section className="pcard esec">
        <div className="eimg-head">
          <h2 className="esec-h" style={{ margin: 0 }}>การขายและจัดส่ง</h2>
          <div className="etop-r">
            {msg && <span className={msg.ok ? 'ok-t' : 'danger'}>{msg.text}</span>}
            <button type="button" className="btn dark" onClick={saveShip} disabled={Boolean(busy) || !shipDirty || pkgBad || blocked}>{busy === 'บันทึกการจัดส่ง' ? 'กำลังบันทึก…' : 'บันทึกการจัดส่ง'}</button>
          </div>
        </div>
        {blocked && <div className="note" style={{ margin: '8px 0' }}>การแก้ไขครั้งก่อนยังรอ TikTok ตรวจ — แก้พัสดุ/ตารางไซส์/ยี่ห้อได้หลังผ่านตรวจ</div>}

        <div className="erow">
          <div className="elabel">สถานะ</div>
          <div className="efield bedit-bar" style={{ margin: 0 }}>
            <span className={'badge ' + (m.status.on ? 'ok' : 'warn')}>{m.status.on ? 'เปิดขาย' : 'ปิดการขาย'}</span>
            <span className="sku">{m.status.raw}</span>
            {m.status.canToggle
              ? <button type="button" className={'btn' + (m.status.on ? '' : ' dark')} onClick={toggle} disabled={Boolean(busy)}>{m.status.on ? 'ปิดการขาย' : 'เปิดขาย'}</button>
              : <span className="sku">สถานะนี้เปิด/ปิดจากเว็บไม่ได้</span>}
          </div>
        </div>

        <div className="erow">
          <div className="elabel">พัสดุ</div>
          <div className="efield">
            <div className="bedit-bar" style={{ margin: 0 }}>
              <label>น้ำหนัก <input className={'bin' + (pkgCh ? ' chg' : '')} style={{ width: 70 }} inputMode="decimal" value={pkg.weight} onChange={(e) => setPkg((p) => ({ ...p, weight: e.target.value.replace(/[^\d.]/g, '') }))} /> กก.</label>
              {['l', 'w', 'h'].map((k, i) => (
                <label key={k}>{['ยาว', 'กว้าง', 'สูง'][i]} <input className={'bin' + (pkgCh ? ' chg' : '')} style={{ width: 56 }} inputMode="decimal" value={pkg[k]} onChange={(e) => setPkg((p) => ({ ...p, [k]: e.target.value.replace(/[^\d.]/g, '') }))} /></label>
              ))}
              <span className="sku">ซม.</span>
            </div>
            <div className="sub" style={{ margin: '2px 0 0' }}>มีผลกับค่าส่งที่ลูกค้าเห็น{m.pkg.note ? ` · ${m.pkg.note}` : ''}{pkgBad ? ' · ต้องใส่ครบทุกช่อง' : ''}</div>
          </div>
        </div>

        <div className="erow">
          <div className="elabel">ตารางไซส์</div>
          <div className="efield">
            {!m.sizeChart.supported ? <span className="sku">{label} ไม่มี API ตารางไซส์ — ใส่ในหลังร้าน</span> : (
              <>
                <div className="eimgs">
                  {(chart || m.sizeChart.image_url) && <div className={'eimg' + (chart ? ' new' : '')}><img src={(chart || m.sizeChart).image_url} alt="" /></div>}
                  {!chart && !m.sizeChart.image_url && <span className="sku">{m.sizeChart.template ? `ใช้เทมเพลตของร้าน (#${m.sizeChart.template})` : 'ยังไม่มี'}</span>}
                  <button type="button" className="btn" onClick={() => setPickChart((x) => !x)}>{pickChart ? 'ปิด' : 'เปลี่ยนรูป'}</button>
                </div>
                {pickChart && (
                  <div className="basket-img">
                    {gallery.map((g) => (
                      <button key={g.image_id} type="button" className="pick" onClick={() => { setChart(g); setPickChart(false); }} title="ใช้รูปนี้"><img src={g.image_url} alt="" loading="lazy" /></button>
                    ))}
                    <label className="btn" style={{ padding: '4px 10px' }}>{busy === 'อัปโหลด' ? 'กำลังอัปโหลด…' : 'อัปโหลด…'}
                      <input type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { uploadChart(e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="pcard esec">
        <div className="eimg-head">
          <h2 className="esec-h" style={{ margin: 0 }}>ยี่ห้อและคุณสมบัติ</h2>
          <div className="etop-r">
            {(brandCh || attrCh.length > 0) && <span className="sku">ยังไม่ได้บันทึก</span>}
            {reqMissing > 0 && <span className="danger">ช่องบังคับยังว่าง {reqMissing}</span>}
            <button type="button" className="btn dark" onClick={saveAttrs} disabled={Boolean(busy) || (!brandCh && !attrCh.length) || reqMissing > 0 || blocked}>{busy === 'บันทึกยี่ห้อ/คุณสมบัติ' ? 'กำลังบันทึก…' : 'บันทึกยี่ห้อ/คุณสมบัติ'}</button>
          </div>
        </div>

        <div className="erow">
          <div className="elabel">ยี่ห้อ</div>
          <div className="efield">
            <div className="bedit-bar" style={{ margin: 0 }}>
              <b>{m.brand.name || '—'}</b>
              {brandCh && <span className="badge warn">→ {brand.name}</span>}
              {m.brand.search ? (
                <>
                  <input className="bin" style={{ width: 180, textAlign: 'left' }} placeholder="ค้นยี่ห้อ" value={bq} onChange={(e) => setBq(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') findBrands(); }} />
                  <button type="button" className="btn" onClick={findBrands} disabled={Boolean(busy)}>ค้น</button>
                </>
              ) : (
                <input className="bin" style={{ width: 180, textAlign: 'left' }} placeholder="พิมพ์ชื่อยี่ห้อ" value={brand?.name ?? ''} onChange={(e) => setBrand(e.target.value.trim() ? { id: e.target.value.trim(), name: e.target.value.trim() } : null)} />
              )}
            </div>
            {brands && (
              <div className="cat-list">
                {brands.length ? brands.map((b) => (
                  <button key={b.id} type="button" className={'cat-row' + (brand?.id === b.id ? ' on' : '')} onClick={() => setBrand(b)}>{b.name}</button>
                )) : <span className="sku" style={{ padding: 8 }}>ไม่เจอยี่ห้อนี้ในหมวดของตะกร้า</span>}
              </div>
            )}
          </div>
        </div>

        <div className="erow">
          <div className="elabel">คุณสมบัติ <span className="sku">({m.attrs.length})</span></div>
          <div className="efield attr-grid">
            {m.attrs.length === 0 && <span className="sku">หมวดนี้ไม่มีคุณสมบัติให้ตั้ง</span>}
            {m.attrs.map((a) => {
              const vals = attrs[a.id] ?? a.value;
              const ch = attrs[a.id] && valKey(attrs[a.id]) !== valKey(a.value);
              const cls = 'bin info-sel' + (ch ? ' chg' : '') + (a.required && !vals.length ? ' bad' : '');
              return (
                <label key={a.id} className="attr-row">
                  <span>{a.name}{a.required && <b className="danger"> *</b>}</span>
                  {a.options.length > 0 && !a.multi ? (
                    <span className="bedit-bar" style={{ margin: 0 }}>
                      <select className={cls} value={vals[0]?.id || (vals[0] ? '~' : '')}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) setA(a.id, []);
                          else if (v === '~') setA(a.id, [{ id: null, name: vals[0]?.name || '' }]);
                          else setA(a.id, [{ id: v, name: a.options.find((o) => o.id === v)?.name || v }]);
                        }}>
                        <option value="">— ไม่ระบุ —</option>
                        {a.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        {a.custom && <option value="~">พิมพ์เอง…</option>}
                      </select>
                      {vals[0] && !vals[0].id && <input className={cls} style={{ width: 140 }} value={vals[0].name} onChange={(e) => setA(a.id, [{ id: null, name: e.target.value }])} />}
                    </span>
                  ) : a.options.length > 0 ? (
                    <span className="attr-multi">
                      {a.options.slice(0, 60).map((o) => {
                        const on = vals.some((v) => v.id === o.id);
                        return <button key={o.id} type="button" className="chip" data-on={on ? '1' : '0'} onClick={() => setA(a.id, on ? vals.filter((v) => v.id !== o.id) : [...vals, { id: o.id, name: o.name }])}>{o.name}</button>;
                      })}
                    </span>
                  ) : (
                    <input className={cls} value={vals.map((v) => v.name).join(', ')} onChange={(e) => setA(a.id, e.target.value.trim() ? (a.multi ? e.target.value.split(',') : [e.target.value]).map((x) => ({ id: null, name: x.trim() })).filter((x) => x.name) : [])} />
                  )}
                </label>
              );
            })}
          </div>
        </div>
        {platform === 'tiktok' && <div className="sub" style={{ margin: '6px 0 0' }}>TikTok: แก้พัสดุ/ตารางไซส์/ยี่ห้อ/คุณสมบัติแล้วต้องรอตรวจ (เปิด/ปิดการขายไม่ต้อง)</div>}
      </section>
    </>
  );
}
