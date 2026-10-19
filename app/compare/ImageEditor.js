'use client';
// หน้าแก้รูปก่อนโคลนข้ามร้าน (เช่น Shopee REAL → SOLID) — เปิดจากแผงโคลน (CloneAcross)
//
// 1) เลือกเองว่าจะเอารูปไหนของตะกร้าต้นทางไปบ้าง (ติ๊ก/เอาออก · เลื่อนลำดับ)
// 2) รูปไหนมีโลโก้ร้านต้นทาง → แปะโลโก้ร้านปลายทางทับ (ลากย้าย/ย่อขยายได้) หรือวางกล่องสีปิดโลโก้เดิม
// 3) ยืนยัน → รูปที่แก้ถูกวาดใหม่ในเบราว์เซอร์ แล้วอัปขึ้นคลังรูปของร้านปลายทาง (ยังไม่ผูกกับตะกร้าไหน)
//    ได้รายการรหัสรูปไปส่งพร้อมคำสั่งโคลน · ตะกร้าต้นทางไม่ถูกแตะ
//
// รูปโหลดผ่าน /api/xclone/img (CDN ไม่ส่ง CORS → วาดลง canvas แล้ว export ไม่ได้)
// โลโก้: อัปเองครั้งเดียวต่อร้าน จำไว้ในเบราว์เซอร์นี้ · ไม่มีก็ลอง /logos/<ร้าน>.png
// Box / render / useShopLogo ใช้ร่วมกับหน้าแก้รูปทีละรูปในหน้าแก้ไขสินค้า (app/product/ImageEditOne.js)
import { useCallback, useEffect, useRef, useState } from 'react';

// blob:/data: (รูปที่เพิ่งอัปจากเครื่อง) วาดลง canvas ได้ตรงๆ ไม่ต้องผ่าน proxy · http:// (Lazada บางรูป) / //host ปรับเป็น https
export const proxied = (u) => {
  const s = String(u || '').replace(/^(https?:)?\/\//, 'https://');
  return /^https:/.test(s) ? `/api/xclone/img?u=${encodeURIComponent(s)}` : s;
};
const LOGO_KEY = (shop) => `cloneLogo:${shop}`;
const loadImg = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('โหลดรูปไม่ได้')); i.src = src; });

function savedLogo(shop) {
  try { return localStorage.getItem(LOGO_KEY(shop)) || null; } catch { return null; }
}
const DEFAULT_LOGO = { SOLID: '/solid-logo-120.png' };

// โลโก้ของร้าน (จำในเบราว์เซอร์ → /logos/<ร้าน>.png → ค่าเริ่มต้น) · pick(file) → สัดส่วน สูง/กว้าง ของโลโก้ใหม่
export function useShopLogo(shop) {
  const [logo, setLogo] = useState(null);
  const [ratio, setRatio] = useState(0.4);
  useEffect(() => {
    const cands = [savedLogo(shop), `/logos/${shop}.png`, DEFAULT_LOGO[shop]].filter(Boolean);
    (async () => {
      for (const s of cands) {
        try { const i = await loadImg(s); setLogo(s); setRatio(i.naturalHeight / i.naturalWidth); return; } catch { /* ลองตัวถัดไป */ }
      }
    })();
  }, [shop]);
  const pick = useCallback((file) => new Promise((ok, bad) => {
    const fr = new FileReader();
    fr.onload = async () => {
      const s = String(fr.result);
      try {
        const i = await loadImg(s);
        const r = i.naturalHeight / i.naturalWidth;
        setLogo(s); setRatio(r);
        try { localStorage.setItem(LOGO_KEY(shop), s); } catch { /* เต็ม/ปิดไว้ — ใช้ได้เฉพาะรอบนี้ */ }
        ok(r);
      } catch { bad(new Error('อ่านไฟล์โลโก้ไม่ได้')); }
    };
    fr.onerror = () => bad(new Error('อ่านไฟล์โลโก้ไม่ได้'));
    fr.readAsDataURL(file);
  }), [shop]);
  return { logo, ratio, pick };
}

// กล่องที่ลากได้บนรูป (พิกัด 0..1 ของรูป) · มุมขวาล่าง = ย่อ/ขยาย · ratio = สูง/กว้าง ของกล่อง (โลโก้ล็อกสัดส่วน)
export function Box({ stage, b, ratio, onChange, onRemove, children, label }) {
  const start = useRef(null);
  const down = (mode) => (e) => {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { mode, x: e.clientX, y: e.clientY, b: { ...b } };
  };
  const move = (e) => {
    const s = start.current;
    if (!s || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    const dx = (e.clientX - s.x) / r.width;
    const dy = (e.clientY - s.y) / r.height;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    if (s.mode === 'move') {
      onChange({ ...b, x: clamp(s.b.x + dx, -0.05, 1 - s.b.w * 0.2), y: clamp(s.b.y + dy, -0.05, 1 - s.b.h * 0.2) });
    } else {
      const w = clamp(s.b.w + dx, 0.03, 1);
      const h = ratio ? w * ratio * (r.width / r.height) : clamp(s.b.h + dy, 0.03, 1);
      onChange({ ...b, w, h });
    }
  };
  const up = () => { start.current = null; };
  return (
    <div className="ie-box" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
      onPointerDown={down('move')} onPointerMove={move} onPointerUp={up} title={`${label} — ลากเพื่อย้าย`}>
      {children}
      <button type="button" className="ie-x" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove} title="เอาออก">×</button>
      <span className="ie-rs" onPointerDown={down('size')} onPointerMove={move} onPointerUp={up} title="ลากเพื่อย่อ/ขยาย" />
    </div>
  );
}

// สีพื้นหลังรอบกล่อง (ใช้เป็นสีเริ่มต้นของกล่องปิดโลโก้)
export function sampleColor(img, b) {
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const x = Math.round(Math.min(img.naturalWidth - 1, (b.x + b.w) * img.naturalWidth + 4));
    const y = Math.round(Math.min(img.naturalHeight - 1, (b.y + b.h) * img.naturalHeight + 4));
    const [r, gg, bb] = g.getImageData(x, y, 1, 1).data;
    return `#${[r, gg, bb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  } catch { return '#eeeeee'; }
}

// วาดรูปที่แก้แล้วเป็น JPEG (ขนาดเท่ารูปเดิม) · item = { url, logo, covers }
export async function render(item, logoSrc, q = 0.92) {
  const img = await loadImg(proxied(item.url));
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.drawImage(img, 0, 0, W, H);
  for (const k of item.covers) { g.fillStyle = k.color; g.fillRect(k.x * W, k.y * H, k.w * W, k.h * H); }
  if (item.logo && logoSrc) {
    const L = await loadImg(logoSrc);
    g.drawImage(L, item.logo.x * W, item.logo.y * H, item.logo.w * W, item.logo.h * H);
  }
  return c.toDataURL('image/jpeg', q);
}

// api: /api/xclone/shopee-shopee หรือ shopee-tiktok · shop: ร้านปลายทาง · srcShop: ร้าน Shopee ต้นทาง · id: ตะกร้าต้นทาง
// destLabel: ชื่อปลายทางที่โชว์ (เช่น 'TikTok SOLID') · โลโก้จำแยกตามชื่อร้าน (SOLID ใช้ร่วมกันทุกแพลตฟอร์ม)
// onDone({ ids, kept, edited }) → รหัสรูปเรียงตามลำดับ · onCancel()
export default function ImageEditor({ api, shop, srcShop, id, title, destLabel = `Shopee ${shop}`, onDone, onCancel }) {
  const [items, setItems] = useState(null);   // [{ id, url, on, logo: {x,y,w,h}|null, covers: [{x,y,w,h,color}] }]
  const [cur, setCur] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const { logo, ratio: logoRatio, pick } = useShopLogo(shop);   // โลโก้ร้านปลายทาง
  const stage = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const j = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'images', id, shop, src: srcShop }) }).then((r) => r.json());
        if (!j.ok) throw new Error(j.error || 'โหลดรูปไม่สำเร็จ');
        if (!dead) setItems(j.images.filter((x) => x.url).map((x) => ({ ...x, on: true, logo: null, covers: [] })));
      } catch (e) { if (!dead) setErr(String(e.message || e)); }
    })();
    return () => { dead = true; };
  }, [api, id, shop, srcShop]);

  const pickLogo = async (file) => {
    if (!file) return;
    try {
      const r = await pick(file);
      // กล่องโลโก้ที่วางไว้แล้ว ปรับสัดส่วนตามโลโก้ใหม่
      setItems((list) => list.map((x) => (x.logo ? { ...x, logo: { ...x.logo, h: x.logo.w * r * (x.ar || 1) } } : x)));
    } catch (e) { setErr(e.message); }
  };

  const patch = (i, p) => setItems((list) => list.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const it = items?.[cur];
  const ar = () => (imgRef.current ? imgRef.current.naturalWidth / imgRef.current.naturalHeight : 1);   // กว้าง/สูง ของรูป
  const addLogo = () => { const a = ar(); const w = 0.22; patch(cur, { ar: a, logo: { x: 0.01, y: 0.01, w, h: w * logoRatio * a } }); };
  const addCover = () => {
    const b = { x: 0.01, y: 0.01, w: 0.22, h: 0.09 };
    patch(cur, { covers: [...it.covers, { ...b, color: imgRef.current ? sampleColor(imgRef.current, b) : '#eeeeee' }] });
  };
  const moveItem = (i, d) => setItems((list) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    setCur(j);
    return n;
  });

  const chosen = (items || []).filter((x) => x.on);
  const edited = chosen.filter((x) => x.logo || x.covers.length);
  async function confirm() {
    if (!chosen.length) { setErr('ต้องเลือกอย่างน้อย 1 รูป'); return; }
    if (chosen.length > 9) { setErr('เลือกได้ไม่เกิน 9 รูป'); return; }
    if (edited.some((x) => x.logo) && !logo) { setErr('ยังไม่มีโลโก้ — กด "อัปโลโก้" ก่อน'); return; }
    setErr('');
    const ids = [];
    try {
      for (const [k, x] of chosen.entries()) {
        if (!x.logo && !x.covers.length) { ids.push(x.id); continue; }
        setBusy(`กำลังอัปรูปที่แก้ (${k + 1}/${chosen.length})…`);
        const data = await render(x, logo);
        const j = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'upload-image', shop, data }) }).then((r) => r.json());
        if (!j.ok) throw new Error(j.error || 'อัปรูปไม่สำเร็จ');
        ids.push(j.imageId);
      }
      onDone({ ids, kept: chosen.length - edited.length, edited: edited.length, total: items.length });
    } catch (e) {
      setErr(String(e.message || e));
    } finally { setBusy(''); }
  }

  return (
    <div className="cl-back ie-back" onClick={() => !busy && onCancel()}>
      <div className="cl-panel ie-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cl-head">
          <div>
            <b className="ast-title">🖼 เลือก/แก้รูปก่อนโคลน → {destLabel}</b>
            <div className="sku">{title} · รูปจาก Shopee {srcShop} (ตะกร้าเดิมไม่ถูกแตะ) · ติ๊กรูปที่จะเอา · รูปที่มีโลโก้ร้าน {srcShop} กด “แปะโลโก้ {shop}” แล้วลากไปทับ</div>
          </div>
          <span className="cl-headbtns">
            <button type="button" className="chip" disabled={Boolean(busy)} onClick={onCancel}>ยกเลิก</button>
            <button type="button" className="btn ast-open" disabled={Boolean(busy) || !items} onClick={confirm}>
              {busy || `ใช้ ${chosen.length} รูป${edited.length ? ` (แก้ ${edited.length})` : ''}`}
            </button>
          </span>
        </div>
        {err && <div className="note note-danger">{err}</div>}
        {!items && !err && <div className="note">กำลังโหลดรูปจาก Shopee {srcShop}…</div>}
        {items && (
          <div className="ie-body">
            <div className="ie-list">
              {items.map((x, i) => (
                <div key={x.id} className={`ie-th${i === cur ? ' on' : ''}${x.on ? '' : ' off'}`} onClick={() => setCur(i)}>
                  <img src={proxied(x.url)} alt="" />
                  <label className="ie-th-cb" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={x.on} onChange={() => patch(i, { on: !x.on })} /> {i + 1}
                  </label>
                  {(x.logo || x.covers.length > 0) && <span className="ie-th-tag">แก้</span>}
                  <span className="ie-th-mv">
                    <button type="button" disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveItem(i, -1); }} title="เลื่อนขึ้น">↑</button>
                    <button type="button" disabled={i === items.length - 1} onClick={(e) => { e.stopPropagation(); moveItem(i, 1); }} title="เลื่อนลง">↓</button>
                  </span>
                </div>
              ))}
            </div>
            {it && (
              <div className="ie-main">
                <div className="ie-tools">
                  <button type="button" className="chip" disabled={!it.on || Boolean(it.logo)} onClick={addLogo}>＋ แปะโลโก้ {shop}</button>
                  <button type="button" className="chip" disabled={!it.on} onClick={addCover}>＋ กล่องปิดโลโก้เดิม</button>
                  {it.covers.map((k, i) => (
                    <label key={i} className="sku ie-color">สีกล่อง {i + 1}
                      <input type="color" value={k.color} onChange={(e) => patch(cur, { covers: it.covers.map((c, j) => (j === i ? { ...c, color: e.target.value } : c)) })} />
                    </label>
                  ))}
                  <span className="psep" />
                  {logo && <img src={logo} alt="" className="ie-logo-prev" title={`โลโก้ ${shop}`} />}
                  <label className="chip ie-upl">{logo ? 'เปลี่ยนโลโก้' : 'อัปโลโก้'} {shop}
                    <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pickLogo(e.target.files?.[0])} />
                  </label>
                </div>
                <div className={`ie-stage${it.on ? '' : ' off'}`} ref={stage}>
                  <img ref={imgRef} src={proxied(it.url)} alt="" crossOrigin="anonymous" draggable={false} />
                  {it.covers.map((k, i) => (
                    <Box key={`c${i}`} stage={stage} b={k} label="กล่องปิด"
                      onChange={(nb) => patch(cur, { covers: it.covers.map((c, j) => (j === i ? nb : c)) })}
                      onRemove={() => patch(cur, { covers: it.covers.filter((_, j) => j !== i) })}>
                      <div className="ie-fill" style={{ background: k.color }} />
                    </Box>
                  ))}
                  {it.logo && (
                    <Box stage={stage} b={it.logo} ratio={logoRatio} label={`โลโก้ ${shop}`}
                      onChange={(nb) => patch(cur, { logo: nb })} onRemove={() => patch(cur, { logo: null })}>
                      {logo ? <img src={logo} alt="" className="ie-fill" draggable={false} /> : <div className="ie-fill ie-nologo">ยังไม่มีโลโก้</div>}
                    </Box>
                  )}
                  {!it.on && <div className="ie-offnote">ไม่เอารูปนี้</div>}
                </div>
                <div className="sku">รูป {cur + 1}/{items.length} · ลากกล่องเพื่อย้าย · ลากมุมขวาล่างเพื่อย่อ/ขยาย · × เพื่อเอาออก</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
