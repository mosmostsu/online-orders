'use client';
// สร้างปกใหม่ในหน้าแก้ไขสินค้า (เปิดจาก BasketImages) — โลโก้ร้านมุมซ้ายบน + รูปทุกสีเรียงกัน แบบปกร้าน REAL
//   ใช้แทนการเอาปกของร้านอื่นมาใช้ตรงๆ (ปกแต่ละร้านต้องไม่เหมือนกัน) · รูปสีเป็นรูปรองเท้าเปล่า ตัดขอบขาวก่อนวาง
//   1–2 สี = เรียงบนลงล่าง · 3 สีขึ้นไป = ตาราง 2 คอลัมน์ · เลือกได้ว่าเอาสีไหน
// ยืนยัน → JPEG 1000×1000 ในเบราว์เซอร์ → onDone(File) ให้ BasketImages อัปแล้ววางเป็นรูปแรก (ยังไม่บันทึกลงร้าน)
// โลโก้: useShopLogo (จำในเบราว์เซอร์ → /logos/<ร้าน>.png) เหมือนหน้าแก้รูป
import { useEffect, useState } from 'react';
import Modal from './Modal';
import { proxied, useShopLogo } from '../compare/ImageEditor';

const S = 1000;
const MAX = 4 * 1024 * 1024;   // ตรงกับเพดานอัปโหลดใน BasketImages
const loadImg = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('โหลดรูปไม่ได้')); i.src = src; });

// กรอบของตัวสินค้า (ส่วนที่ไม่ใช่พื้นขาว) — รูปจาก CDN โหลดผ่าน proxy จึงอ่านพิกเซลได้
function trim(img) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = W; let y0 = H; let x1 = -1; let y1 = -1;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      if (Math.min(d[i], d[i + 1], d[i + 2]) < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return { sx: 0, sy: 0, sw: W, sh: H };
  return { sx: x0, sy: y0, sw: Math.min(W, x1 + 2) - x0, sh: Math.min(H, y1 + 2) - y0 };
}

async function compose(urls, logoSrc) {
  const imgs = await Promise.all(urls.map((u) => loadImg(proxied(u))));
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  const n = imgs.length;
  const cols = n <= 2 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  // พื้นที่วางสินค้า: เว้นแถบบนให้โลโก้
  const ax = 0.06 * S; const ay = (n === 1 ? 0.16 : 0.12) * S;
  const aw = 0.88 * S; const ah = (n === 1 ? 0.74 : 0.84) * S;
  const cw = aw / cols; const ch = ah / rows;
  imgs.forEach((img, k) => {
    const t = trim(img);
    const r = k % cols; const q = Math.floor(k / cols);
    const pw = cw * 0.94; const ph = ch * 0.9;
    const f = Math.min(pw / t.sw, ph / t.sh);
    const w = t.sw * f; const h = t.sh * f;
    // แถวสุดท้ายที่ไม่เต็ม → จัดกลาง
    const inRow = q === rows - 1 ? n - q * cols : cols;
    const ox = ax + (aw - inRow * cw) / 2;
    g.drawImage(img, t.sx, t.sy, t.sw, t.sh, ox + r * cw + (cw - w) / 2, ay + q * ch + (ch - h) / 2, w, h);
  });
  if (logoSrc) {
    const L = await loadImg(logoSrc);
    const lw = 0.2 * S;
    g.drawImage(L, 0.014 * S, 0.016 * S, lw, lw * (L.naturalHeight / L.naturalWidth));
  }
  return c;
}

// images: [{ text, url }] รูปของแต่ละสี (ตามลำดับตัวเลือก)
export default function CoverMaker({ shop, images, title, onDone, onCancel }) {
  const { logo, pick } = useShopLogo(shop);
  const [on, setOn] = useState(() => images.map(() => true));
  const [prev, setPrev] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const urls = images.filter((_, i) => on[i]).map((x) => x.url);
  const key = urls.join('\u0001');

  useEffect(() => {
    if (!urls.length) { setPrev(null); return undefined; }
    let live = true;
    compose(urls, logo).then((c) => { if (live) { setPrev(c.toDataURL('image/jpeg', 0.8)); setErr(''); } }).catch((e) => { if (live) setErr(String(e.message || e)); });
    return () => { live = false; };
  }, [key, logo]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function confirm() {
    if (!logo) { setErr(`ยังไม่มีโลโก้ ${shop} — กด "อัปโลโก้" ก่อน`); return; }
    setErr('');
    try {
      setBusy('กำลังวาดปก…');
      const c = await compose(urls, logo);
      let blob = null;
      for (const q of [0.92, 0.8, 0.65]) {
        blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', q));
        if (blob && blob.size <= MAX) break;
      }
      setBusy('กำลังอัปรูป…');
      await onDone(new File([blob], 'cover.jpg', { type: 'image/jpeg' }));
    } catch (e) {
      setErr(String(e.message || e));
      setBusy('');
    }
  }

  return (
    <Modal title={title || 'สร้างปกใหม่'} onClose={onCancel} busy={Boolean(busy)} wide>
      <div className="ie-main">
        <div className="ie-tools">
          {images.map((x, i) => (
            <label key={x.text} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={on[i]} disabled={Boolean(busy)} onChange={() => setOn((l) => l.map((v, j) => (j === i ? !v : v)))} />
              {x.text}
            </label>
          ))}
          <span className="psep" />
          {logo && <img src={logo} alt="" className="ie-logo-prev" title={`โลโก้ ${shop}`} />}
          <label className="chip ie-upl">{logo ? 'เปลี่ยนโลโก้' : 'อัปโลโก้'} {shop}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f).catch((x) => setErr(x.message)); }} />
          </label>
        </div>
        <div className="ie-stage">
          {prev ? <img src={prev} alt="ตัวอย่างปก" draggable={false} /> : <div className="sku" style={{ padding: 40 }}>{urls.length ? 'กำลังวาด…' : 'เลือกสีอย่างน้อย 1 สี'}</div>}
        </div>
        <div className="sku">ปกใหม่จะวางเป็นรูปแรก (รูปปก) · ยังไม่เขียนลงร้านจนกด &quot;บันทึกรูป&quot;</div>
        {err && <div className="note note-danger">{err}</div>}
        <div className="etop-r" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel} disabled={Boolean(busy)}>ยกเลิก</button>
          <button type="button" className="btn dark" onClick={confirm} disabled={Boolean(busy) || !urls.length}>{busy || 'ใช้เป็นปก'}</button>
        </div>
      </div>
    </Modal>
  );
}
