'use client';
// สร้างปกใหม่ในหน้าแก้ไขสินค้า (เปิดจาก BasketImages) — ให้ปกแต่ละร้านไม่เหมือนกัน (ส่วนใหญ่ SOLID/REAL ต่างกันแค่โลโก้)
//   แบบที่ร้านทำอยู่ (เทียบปกกางเกง Shopee SOLID/REAL): โลโก้มุมซ้ายบน · ชื่อสินค้ามุมขวาบน (ไม่ใส่ก็ได้)
//   รูปสินค้าจัดได้ 6 แบบ: ใหญ่ซ้าย/ใหญ่ขวา = รูปแรก (คนใส่) เต็มสูงข้างหนึ่ง ที่เหลืออีกข้าง (วอร์ม Grand Sport 06-235 / 16-390)
//   · เรียงแถว (T400 SOLID) · เหลื่อมขึ้นลง (T400 REAL) · บนลงล่าง (PF15AJ REAL) · ตาราง 2 คอลัมน์
//   รูปเลือกเองจาก รูปสี / รูปสินค้าของตะกร้านี้ / รูปของร้านอื่นที่ขายตัวเดียวกัน — ลำดับที่กด = ลำดับที่วาง
//   รูปพื้นขาวตัดขอบขาวก่อนวาง (รูปมีพื้นหลังวางทั้งรูป) · 🪄 ตัดพื้นหลัง (ormbg) · ↻ หมุน · ✂ ครอป · ✋ ลากจัดเอง
//   รูปร้านอื่นโหลดให้เองตอนเปิด · อัปจากเครื่อง / ลากไฟล์มาวาง / Ctrl+V รูปที่คัดลอกจาก Google (ปุ่มเปิดค้นรูป)
//   ชื่อสินค้า: 1/2 บรรทัด · หนา/ปกติ/บาง · ฟอนต์ไทยจาก Google Fonts
// ยืนยัน → JPEG 1000×1000 ในเบราว์เซอร์ → onDone(File) ให้ BasketImages อัปแล้ววางเป็นรูปแรก (ยังไม่บันทึกลงร้าน)
// โลโก้: useShopLogo (จำในเบราว์เซอร์ → /logos/<ร้าน>.png) เหมือนหน้าแก้รูป
import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { Box, proxied, useShopLogo } from '../compare/ImageEditor';

const S = 1000;
const MAX = 4 * 1024 * 1024;   // ตรงกับเพดานอัปโหลดใน BasketImages
const LAYOUTS = [['heroL', 'ใหญ่ซ้าย'], ['heroR', 'ใหญ่ขวา'], ['row', 'เรียงแถว'], ['stagger', 'เหลื่อมขึ้นลง'], ['stack', 'บนลงล่าง'], ['grid', 'ตาราง']];
const autoLayout = (n) => (n <= 2 ? 'stack' : 'row');
const loadImg = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('โหลดรูปไม่ได้')); i.src = src; });

// กรอบของตัวสินค้า (ส่วนที่ไม่ใช่พื้นขาว) ในส่วนที่ครอปไว้ — รูปจาก CDN โหลดผ่าน proxy จึงอ่านพิกเซลได้
// crop = { x, y, w, h } (0..1 ของรูป) หรือ null = ทั้งรูป
function trim(img, crop) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const r = crop ? { x: Math.round(crop.x * iw), y: Math.round(crop.y * ih), w: Math.max(1, Math.round(crop.w * iw)), h: Math.max(1, Math.round(crop.h * ih)) } : { x: 0, y: 0, w: iw, h: ih };
  const W = r.w;
  const H = r.h;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.drawImage(img, r.x, r.y, W, H, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = W; let y0 = H; let x1 = -1; let y1 = -1;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      if (Math.min(d[i], d[i + 1], d[i + 2]) < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return { sx: r.x, sy: r.y, sw: W, sh: H };
  return { sx: r.x + x0, sy: r.y + y0, sw: Math.min(W, x1 + 2) - x0, sh: Math.min(H, y1 + 2) - y0 };
}

// ช่องวางรูปตามแบบ (พิกเซลบนปก) · asp = กว้าง/สูง ของแต่ละรูปหลังตัดขอบ · align: 'top' | 'bottom' | 'center'
// รูปทรงกว้าง (รองเท้า) เรียงแนวตั้งแทนแนวนอน ไม่งั้นตัวเล็กมาก
const wide = (l) => l.length > 0 && l.reduce((a, b) => a + b, 0) / l.length > 1.3;
function slots(asp, layout, top) {
  const n = asp.length;
  const ax = 0.04 * S; const aw = 0.92 * S;
  const ay = top; const ah = 0.96 * S - top;
  if (n === 1) return [{ x: ax + 0.04 * S, y: ay, w: aw - 0.08 * S, h: ah, align: 'center' }];
  if (layout === 'heroL' || layout === 'heroR') {
    // รูปแรก (มักเป็นคนใส่) เต็มความสูงข้างหนึ่ง · ที่เหลือเรียงอีกข้าง (≤ 3 แถวเดียว · มากกว่านั้น 2 แถว · ทรงกว้างซ้อนบนลงล่าง)
    const hw = 0.42 * aw; const rw = aw - hw;
    const hx = layout === 'heroL' ? ax : ax + rw;
    const rx = layout === 'heroL' ? ax + hw : ax;
    const m = n - 1;
    const rows = wide(asp.slice(1)) ? m : m <= 3 ? 1 : 2;
    const cols = Math.ceil(m / rows);
    const rest = Array.from({ length: m }, (_, i) => {
      const q = Math.floor(i / cols);
      return { x: rx + (i % cols) * (rw / cols), y: ay + (rows === 1 ? 0.06 * ah : 0) + (q * ah) / rows, w: rw / cols, h: rows === 1 ? 0.88 * ah : ah / rows, align: 'center' };
    });
    return [{ x: hx, y: ay, w: hw, h: ah, align: 'bottom' }, ...rest];
  }
  if (layout === 'stack') return Array.from({ length: n }, (_, i) => ({ x: ax, y: ay + (i * ah) / n, w: aw, h: ah / n, align: 'center' }));
  if (layout === 'grid') {
    const rows = Math.ceil(n / 2);
    return Array.from({ length: n }, (_, i) => {
      const q = Math.floor(i / 2);
      const inRow = q === rows - 1 ? n - q * 2 : 2;
      return { x: ax + (aw - inRow * (aw / 2)) / 2 + (i % 2) * (aw / 2), y: ay + (q * ah) / rows, w: aw / 2, h: ah / rows, align: 'center' };
    });
  }
  // stagger ทรงกว้าง: ซ้าย-ขวาสลับกันไล่ลงมา ซ้อนกันนิดหน่อย (วาดแบบ multiply พื้นขาวไม่ทับกัน)
  if (layout === 'stagger' && wide(asp)) {
    const w = 0.72 * aw; const h = (ah / n) * 1.25;
    return Array.from({ length: n }, (_, i) => ({ x: ax + (i % 2 ? aw - w : 0), y: ay + (i * (ah - h)) / Math.max(1, n - 1), w, h, align: 'center' }));
  }
  // stagger: ตัวคู่ยกขึ้น ตัวคี่ลดลง (ตัวแรกใหญ่กว่านิดหน่อย) · row: สูงเท่ากันทั้งแถว
  const w = aw / n;
  return Array.from({ length: n }, (_, i) => (layout === 'stagger'
    ? { x: ax + i * w, y: ay + (i % 2 ? 0.18 * ah : 0), w, h: (i === 0 ? 0.86 : 0.8) * ah, align: i % 2 ? 'bottom' : 'top' }
    : { x: ax + i * w, y: ay + 0.04 * ah, w, h: 0.92 * ah, align: 'center' }));
}

// ชื่อสินค้ามุมขวาบน · lines 1 = บรรทัดเดียว (รวมทุกส่วน) · 2 = แยกที่ "/" หรือขึ้นบรรทัด · weight = น้ำหนักตัวอักษร
// font: ฟอนต์ไทยจาก Google Fonts (โหลดตอนเลือก) · '' = ฟอนต์ของเว็บ
const WEIGHTS = [['700', 'หนา'], ['500', 'ปกติ'], ['300', 'บาง']];
const FONTS = ['', 'Kanit', 'Prompt', 'Mitr', 'Sarabun', 'Noto Sans Thai'];
async function ensureFont(name, weight) {
  if (!name) return;
  const id = `gf-${name.replace(/\s+/g, '-')}`;
  if (!document.getElementById(id)) {
    const l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@300;500;700&display=swap`;
    document.head.appendChild(l);
    await new Promise((ok) => { l.onload = ok; l.onerror = ok; });
  }
  try { await document.fonts.load(`${weight} 40px "${name}"`, 'กขค ABC'); } catch { /* ใช้ฟอนต์สำรอง */ }
}
function drawTitle(g, title, { lines: nl = 2, weight = '700', font: fname = '' } = {}) {
  const parts = String(title || '').split(/\n|\//).map((s) => s.trim()).filter(Boolean);
  const lines = nl === 1 ? (parts.length ? [parts.join(' ')] : []) : parts.slice(0, 2);
  if (!lines.length) return 0;
  const font = fname ? `"${fname}", sans-serif` : (getComputedStyle(document.body).fontFamily || 'sans-serif');
  g.fillStyle = '#111111'; g.textAlign = 'right'; g.textBaseline = 'top';
  let y = 0.03 * S;
  lines.forEach((t, i) => {
    let px = i === 0 ? 44 : 34;
    g.font = `${weight} ${px}px ${font}`;
    while (px > 18 && g.measureText(t).width > 0.7 * S) { px -= 2; g.font = `${weight} ${px}px ${font}`; }
    g.fillText(t, 0.97 * S, y);
    y += px * 1.2;
  });
  return y;
}

// ตัดพื้นหลัง (สินค้า + คน) — ormbg (Apache-2.0, ตระกูล ISNet) ผ่าน transformers.js รันในเบราว์เซอร์ ไม่ส่งรูปออกไปไหน
//   โหลดโมเดล 44MB ครั้งแรก ~10 วินาที (เบราว์เซอร์จำไว้) · ตัดรูปละ ~8 วินาที (CPU — WebGPU ใช้กับโมเดลนี้ไม่ได้)
//   ทดสอบแล้ว: รองเท้าขาวบนพื้นขาว PF15AJ ตัดเนียน · โปสเตอร์วอร์ม 06-219 ได้แค่ตัวคน
//   ลองแล้วไม่ใช้: MediaPipe selfie (ตัดได้แค่คน รองเท้าหายทั้งคู่) · BiRefNet_lite (หน่วยความจำไม่พอ พังทั้ง WebGPU/CPU) · ISNet (AGPL)
const TF = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
let remover = null;
async function getRemover() {
  if (!remover) {
    remover = (async () => {
      const T = await import(/* webpackIgnore: true */ TF);
      return T.pipeline('background-removal', 'onnx-community/ormbg-ONNX', { dtype: 'uint8', device: 'wasm' });
    })();
    remover.catch(() => { remover = null; });
  }
  return remover;
}
// คืน blob URL ของ PNG พื้นโปร่ง ขนาดเท่ารูปเดิม (ครอปใช้พิกัดเดิมได้)
async function cutBg(src) {
  const rb = await getRemover();
  const out = await rb(new URL(src, location.href).href);
  const oc = (Array.isArray(out) ? out[0] : out).toCanvas();
  const blob = oc.convertToBlob ? await oc.convertToBlob({ type: 'image/png' }) : await new Promise((ok) => oc.toBlob(ok, 'image/png'));
  return URL.createObjectURL(blob);
}

// srcs: url → รูปที่ตัดพื้นหลังแล้ว (blob URL) · rots: url → องศาที่หมุน · pos: url → { x, y, w, h } (0..1 ของปก) ตำแหน่งที่ลากเอง
// คืน { c, placed: { url → { x, y, w, h } } } — placed ใช้ตั้งต้นโหมดลากจัดเอง
async function compose({ urls, srcs = {}, crops = {}, pos = {}, rots = {}, layout, title, lines, weight, font, mirror }, logoSrc) {
  const [imgs] = await Promise.all([Promise.all(urls.map((u) => loadImg(srcs[u] || proxied(u)))), ensureFont(font, weight)]);
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  const head = drawTitle(g, title, { lines, weight, font });
  let logoH = 0;
  let L = null;
  if (logoSrc) { L = await loadImg(logoSrc); logoH = 0.2 * S * (L.naturalHeight / L.naturalWidth); }
  const top = Math.max(0.12 * S, head + 0.02 * S, 0.016 * S + logoH + 0.02 * S);
  const ts = imgs.map((img, k) => trim(img, crops[urls[k]] || null));
  const placed = {};
  // multiply: พื้นขาวของรูปที่ซ้อนกันไม่ทับรูปข้างใต้ (พื้นปกขาวอยู่แล้ว รูปเดี่ยวออกมาเหมือนเดิม)
  g.globalCompositeOperation = 'multiply';
  slots(ts.map((t) => t.sw / t.sh), layout, top).forEach((b, k) => {
    const img = imgs[k];
    const t = ts[k];
    const p = pos[urls[k]];
    let x; let y; let w; let h;
    if (p) {
      // ลากเอง: วางพอดีกรอบ (กรอบล็อกสัดส่วนรูปไว้แล้ว)
      ({ x, y, w, h } = { x: p.x * S, y: p.y * S, w: p.w * S, h: p.h * S });
    } else {
      const f = Math.min((b.w * 0.94) / t.sw, (b.h * 0.94) / t.sh);
      w = t.sw * f; h = t.sh * f;
      x = b.x + (b.w - w) / 2;
      y = b.align === 'top' ? b.y : b.align === 'bottom' ? b.y + b.h - h : b.y + (b.h - h) / 2;
    }
    placed[urls[k]] = { x: x / S, y: y / S, w: w / S, h: h / S };
    // หมุนรอบจุดกลางรูป · พื้นขาวที่หมุนเอียงไม่เห็นเพราะวาดแบบ multiply บนปกขาว
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.rotate(((rots[urls[k]] || 0) * Math.PI) / 180);
    if (mirror) g.scale(-1, 1);
    g.drawImage(img, t.sx, t.sy, t.sw, t.sh, -w / 2, -h / 2, w, h);
    g.restore();
  });
  g.globalCompositeOperation = 'source-over';
  if (L) g.drawImage(L, 0.014 * S, 0.016 * S, 0.2 * S, logoH);
  return { c, placed };
}

// images: [{ url, label, group }] รูปให้เลือก · pre: url ที่เลือกไว้ตอนเปิด · title: ชื่อสินค้าเริ่มต้น · query: คำค้นรูปในเน็ต
// more: [{ label, load: () => Promise<[url]> }] ตะกร้าร้านอื่นที่ขายตัวเดียวกัน — โหลดรูปทุกรูปให้เองตอนเปิด (รูปคนใส่ / มุมอื่น)
export default function CoverMaker({ shop, images, more = [], pre = [], title: title0 = '', query = '', heading, onDone, onCancel }) {
  const { logo, pick } = useShopLogo(shop);
  const [extra, setExtra] = useState([]);       // รูปที่โหลดจากร้านอื่น / อัป / วาง [{ url, label, group }]
  const [loaded, setLoaded] = useState({});     // label → 'loading' | 'done' | ข้อความ error
  const [sel, setSel] = useState(() => pre.filter((u) => images.some((x) => x.url === u)));
  const [crops, setCrops] = useState({});       // url → { x, y, w, h } (0..1)
  const [cropping, setCropping] = useState(null);   // { url, b } รูปที่กำลังครอป
  const [cuts, setCuts] = useState({});         // url → blob URL รูปที่ตัดพื้นหลังแล้ว
  const [rots, setRots] = useState({});         // url → องศาที่หมุน (บวก = ตามเข็ม)
  const [cutting, setCutting] = useState('');   // url ที่กำลังตัด
  const [manual, setManual] = useState(false);  // โหมดลากจัดเอง
  const [pos, setPos] = useState({});           // url → { x, y, w, h } (0..1 ของปก) ตอนลากจัดเอง
  const [layout, setLayout] = useState(() => autoLayout(pre.length));
  const [title, setTitle] = useState(title0);
  const [lines, setLines] = useState(2);
  const [weight, setWeight] = useState('700');
  const [font, setFont] = useState('Kanit');
  const [mirror, setMirror] = useState(false);
  const [prev, setPrev] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const stage = useRef(null);
  const placed = useRef({});
  const pick1 = (o) => Object.fromEntries(sel.filter((u) => o[u]).map((u) => [u, o[u]]));
  const spec = { urls: sel, srcs: pick1(cuts), crops: pick1(crops), pos: manual ? pick1(pos) : {}, rots: pick1(rots), layout, title, lines, weight, font, mirror };
  const key = JSON.stringify({ ...spec, srcs: Object.keys(spec.srcs) });
  const pool = [...new Map([...images, ...extra].map((x) => [x.url, x])).values()];
  const groups = [...new Set(pool.map((x) => x.group))];
  const srcOf = (u) => cuts[u] || proxied(u);

  const addFiles = (files, group) => {
    const fs = [...files].filter((f) => /^image\//.test(f.type));
    if (!fs.length) return 0;
    setExtra((l) => [...l, ...fs.map((f) => ({ url: URL.createObjectURL(f), label: f.name || 'รูปที่วาง', group }))]);
    return fs.length;
  };

  const loadMore = async (m) => {
    setLoaded((o) => ({ ...o, [m.label]: 'loading' }));
    try {
      const urls = await m.load();
      setExtra((l) => [...l, ...urls.map((url, i) => ({ url, label: `${m.label} รูปที่ ${i + 1}${i === 0 ? ' (ปก)' : ''}`, group: `รูปสินค้าของ ${m.label}` }))]);
      setLoaded((o) => ({ ...o, [m.label]: 'done' }));
    } catch (e) { setLoaded((o) => ({ ...o, [m.label]: String(e.message || e) })); }
  };
  // รูปของร้านอื่นโหลดให้เลยตอนเปิด ไม่ต้องกดทีละร้าน
  useEffect(() => { more.forEach((m) => { loadMore(m); }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // วางรูปที่คัดลอกมา (Ctrl+V — เช่น คลิกขวา "คัดลอกรูปภาพ" จาก Google)
  useEffect(() => {
    const onPaste = (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
      const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
      if (addFiles(files, 'รูปที่อัป / วางเอง')) { e.preventDefault(); setErr(''); }
      else if (/^https?:\/\//.test(e.clipboardData?.getData('text') || '')) setErr('วางเป็นลิงก์ใช้ไม่ได้ — คลิกขวาที่รูป เลือก "คัดลอกรูปภาพ" แล้ววางใหม่');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    if (!sel.length) { setPrev(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      compose(spec, logo).then(({ c, placed: p }) => {
        if (!live) return;
        placed.current = p; setPrev(c.toDataURL('image/jpeg', 0.8)); setErr('');
        // ลากจัดเองอยู่แล้วเลือกรูปเพิ่ม → รูปใหม่ได้กรอบลากจากตำแหน่งที่จัดให้
        if (manual && sel.some((u) => !pos[u])) setPos((o) => ({ ...Object.fromEntries(sel.filter((u) => !o[u]).map((u) => [u, p[u]])), ...o }));
      }).catch((e) => { if (live) setErr(String(e.message || e)); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [key, logo]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (u) => setSel((l) => (l.includes(u) ? l.filter((x) => x !== u) : l.length >= 6 ? l : [...l, u]));
  const chooseLayout = (k) => { setLayout(k); setManual(false); setPos({}); };
  const startManual = () => { setPos({ ...placed.current }); setManual(true); };

  async function cut(u) {
    if (cuts[u]) { setCuts((o) => { const n = { ...o }; delete n[u]; return n; }); return; }
    setCutting(u); setErr('');
    try {
      const d = await cutBg(proxied(u));
      setCuts((o) => ({ ...o, [u]: d }));
    } catch (e) { setErr(`ตัดพื้นหลังไม่สำเร็จ: ${e.message || e}`); }
    finally { setCutting(''); }
  }

  async function confirm() {
    if (!logo) { setErr(`ยังไม่มีโลโก้ ${shop} — กด "อัปโลโก้" ก่อน`); return; }
    setErr('');
    try {
      setBusy('กำลังวาดปก…');
      const { c } = await compose(spec, logo);
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

  const q = (title.replace(/\//g, ' ').trim() || query).trim();
  return (
    <Modal title={heading || 'สร้างปกใหม่'} onClose={onCancel} busy={Boolean(busy)} wide>
      <div className="ie-main" onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer?.files || [], 'รูปที่อัป / วางเอง'); }}>
        <div className="sku">กดรูปเพื่อเลือก (สูงสุด 6 · ตัวเลข = ลำดับที่วาง) — เลือกรูปมุมอื่น / สีอื่น / จัดคนละแบบกับร้านอื่น ให้ปกไม่ซ้ำกัน</div>
        {groups.map((gname) => (
          <div key={gname}>
            <div className="sku" style={{ margin: '6px 0 2px' }}><b>{gname}</b></div>
            <div className="basket-img">
              {pool.filter((x) => x.group === gname).map((x) => {
                const n = sel.indexOf(x.url);
                return (
                  <button key={x.url} type="button" className={'pick' + (n >= 0 ? ' on' : '')} disabled={Boolean(busy)} onClick={() => toggle(x.url)} title={x.label} style={{ position: 'relative' }}>
                    <img src={x.url} alt="" loading="lazy" />
                    {n >= 0 && <span className="mimg-cover" style={{ left: 2, right: 'auto' }}>{n + 1}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {more.length > 0 && (
          <div className="ie-tools" style={{ marginTop: 6 }}>
            <span className="sku">รูปสินค้าของร้านที่ขายตัวเดียวกัน:</span>
            {more.map((m) => (
              <button key={m.label} type="button" className="chip" disabled={Boolean(busy) || loaded[m.label] === 'loading' || loaded[m.label] === 'done'} onClick={() => loadMore(m)}
                title={loaded[m.label] && !['loading', 'done'].includes(loaded[m.label]) ? loaded[m.label] : ''}>
                {loaded[m.label] === 'loading' ? `กำลังโหลด ${m.label}…` : loaded[m.label] === 'done' ? `✓ ${m.label}` : loaded[m.label] ? `✕ ${m.label} (ลองใหม่)` : `+ ${m.label}`}
              </button>
            ))}
          </div>
        )}
        <div className="ie-tools" style={{ marginTop: 6 }}>
          <label className="chip ie-upl">＋ อัปรูปจากเครื่อง
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={Boolean(busy)} onChange={(e) => { addFiles(e.target.files || [], 'รูปที่อัป / วางเอง'); e.target.value = ''; }} />
          </label>
          {q && <a className="chip" href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`} target="_blank" rel="noreferrer">🔍 หารูปใน Google</a>}
          <span className="sku">เจอรูปที่ชอบ → คลิกขวา &quot;คัดลอกรูปภาพ&quot; แล้วกด Ctrl+V ที่หน้านี้ · หรือลากไฟล์มาวาง</span>
        </div>
        {sel.length > 0 && (
          <div className="ie-tools" style={{ marginTop: 6 }}>
            <span className="sku">แต่ละรูป:</span>
            {sel.map((u, i) => (
              <span key={u} style={{ display: 'inline-flex', gap: 4 }}>
                <button type="button" className="chip" data-on={crops[u] ? '1' : '0'} disabled={Boolean(busy)}
                  onClick={() => setCropping({ url: u, b: crops[u] || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } })}>✂ ครอป {i + 1}</button>
                <button type="button" className="chip" data-on={cuts[u] ? '1' : '0'} disabled={Boolean(busy) || Boolean(cutting)} onClick={() => cut(u)}
                  title="ตัดพื้นหลัง สินค้าหรือคน (AI ในเบราว์เซอร์ ครั้งแรกโหลดโมเดล ~10 วินาที แล้วรูปละ ~8 วินาที) · กดอีกครั้ง = ใช้รูปเดิม">
                  {cutting === u ? 'กำลังตัด… (~8 วิ)' : cuts[u] ? `✓ ตัดพื้น ${i + 1}` : `🪄 ตัดพื้น ${i + 1}`}
                </button>
                <button type="button" className="chip" disabled={Boolean(busy)} onClick={() => setRots((o) => ({ ...o, [u]: ((o[u] || 0) - 15) % 360 }))} title="หมุนทวนเข็ม 15°">↺</button>
                <button type="button" className="chip" disabled={Boolean(busy)} onClick={() => setRots((o) => ({ ...o, [u]: ((o[u] || 0) + 15) % 360 }))}
                  title="หมุนตามเข็ม 15°">↻{rots[u] ? ` ${rots[u]}°` : ''}</button>
                {rots[u] ? <button type="button" className="chip" disabled={Boolean(busy)} onClick={() => setRots((o) => ({ ...o, [u]: 0 }))} title="กลับมาตรง">0°</button> : null}
              </span>
            ))}
          </div>
        )}
        <div className="ie-tools" style={{ marginTop: 8 }}>
          {LAYOUTS.map(([k, t]) => (
            <button key={k} type="button" className="chip" data-on={!manual && layout === k ? '1' : '0'} disabled={Boolean(busy)} onClick={() => chooseLayout(k)}>{t}</button>
          ))}
          <button type="button" className="chip" data-on={manual ? '1' : '0'} disabled={Boolean(busy) || !sel.length || Boolean(cropping)} onClick={() => (manual ? chooseLayout(layout) : startManual())}
            title="ลากย้าย / ลากมุมขวาล่างย่อขยายแต่ละรูปบนปก · กดแบบจัดวางอื่น = กลับไปจัดอัตโนมัติ">✋ ลากจัดเอง</button>
          <label className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={mirror} disabled={Boolean(busy)} onChange={() => setMirror((v) => !v)} title="ระวัง: ตัวหนังสือบนสินค้าจะกลับด้านด้วย" />กลับซ้าย-ขวา
          </label>
        </div>
        <div className="ie-tools" style={{ marginTop: 6 }}>
          <input className="bin" style={{ width: 280, textAlign: 'left' }} value={title} placeholder="ชื่อสินค้ามุมขวาบน (ไม่ใส่ก็ได้ · / = แบ่งบรรทัด)" disabled={Boolean(busy)} onChange={(e) => setTitle(e.target.value)} />
          {[1, 2].map((n) => <button key={n} type="button" className="chip" data-on={lines === n ? '1' : '0'} disabled={Boolean(busy)} onClick={() => setLines(n)}>{n} บรรทัด</button>)}
          {WEIGHTS.map(([w, t]) => <button key={w} type="button" className="chip" data-on={weight === w ? '1' : '0'} disabled={Boolean(busy)} onClick={() => setWeight(w)} style={{ fontWeight: Number(w) }}>{t}</button>)}
          <select className="bin" style={{ width: 150 }} value={font} disabled={Boolean(busy)} onChange={(e) => setFont(e.target.value)} title="ฟอนต์ชื่อสินค้า">
            {FONTS.map((f) => <option key={f} value={f}>{f || 'ฟอนต์ของเว็บ'}</option>)}
          </select>
          <span className="psep" />
          {logo && <img src={logo} alt="" className="ie-logo-prev" title={`โลโก้ ${shop}`} />}
          <label className="chip ie-upl">{logo ? 'เปลี่ยนโลโก้' : 'อัปโลโก้'} {shop}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f).catch((x) => setErr(x.message)); }} />
          </label>
        </div>
        {cropping ? (
          <>
            <div className="ie-stage" ref={stage}>
              <img src={srcOf(cropping.url)} alt="" crossOrigin="anonymous" draggable={false} />
              <Box stage={stage} b={cropping.b} label="ส่วนที่ใช้" onChange={(b) => setCropping((c) => ({ ...c, b }))} onRemove={() => setCropping(null)}>
                <div className="ie-fill" style={{ outline: '2px dashed #2563eb', background: 'rgba(37,99,235,.08)' }} />
              </Box>
            </div>
            <div className="etop-r" style={{ justifyContent: 'flex-end' }}>
              <span className="sku">ลากกรอบไปที่ส่วนที่จะใช้ · ลากมุมขวาล่างเพื่อย่อ/ขยาย</span>
              {crops[cropping.url] && <button type="button" className="btn" onClick={() => { setCrops((o) => { const n = { ...o }; delete n[cropping.url]; return n; }); setCropping(null); }}>ใช้ทั้งรูป</button>}
              <button type="button" className="btn" onClick={() => setCropping(null)}>ยกเลิก</button>
              <button type="button" className="btn dark" onClick={() => {
                const b = cropping.b;
                const x = Math.max(0, b.x); const y = Math.max(0, b.y);
                setCrops((o) => ({ ...o, [cropping.url]: { x, y, w: Math.min(1 - x, b.w), h: Math.min(1 - y, b.h) } }));
                setPos((o) => { const n = { ...o }; delete n[cropping.url]; return n; });   // สัดส่วนเปลี่ยน — ให้จัดตำแหน่งใหม่
                setCropping(null);
              }}>ใช้ส่วนนี้</button>
            </div>
          </>
        ) : (
          <div className="ie-stage" ref={stage}>
            {prev ? <img src={prev} alt="ตัวอย่างปก" draggable={false} /> : <div className="sku" style={{ padding: 40 }}>{sel.length ? 'กำลังวาด…' : 'เลือกรูปอย่างน้อย 1 รูป'}</div>}
            {manual && prev && sel.filter((u) => pos[u]).map((u) => (
              <Box key={u} stage={stage} b={pos[u]} ratio={pos[u].h / pos[u].w} label={`รูป ${sel.indexOf(u) + 1}`}
                onChange={(b) => setPos((o) => ({ ...o, [u]: b }))} onRemove={() => toggle(u)}>
                <div className="ie-fill" style={{ outline: '1px dashed #2563eb', transform: `rotate(${rots[u] || 0}deg)` }} />
              </Box>
            ))}
          </div>
        )}
        <div className="sku">{manual ? 'ลากกรอบเพื่อย้าย · ลากมุมขวาล่างเพื่อย่อ/ขยาย · × = เอารูปออก · ' : ''}ปกใหม่จะวางเป็นรูปแรก (รูปปก) · ยังไม่เขียนลงร้านจนกด &quot;บันทึกรูป&quot;</div>
        {err && <div className="note note-danger">{err}</div>}
        <div className="etop-r" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel} disabled={Boolean(busy)}>ยกเลิก</button>
          <button type="button" className="btn dark" onClick={confirm} disabled={Boolean(busy) || !sel.length || Boolean(cropping)}>{busy || 'ใช้เป็นปก'}</button>
        </div>
      </div>
    </Modal>
  );
}
