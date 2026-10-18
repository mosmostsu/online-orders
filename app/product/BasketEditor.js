'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import BasketImages from './BasketImages';
import BasketInfo from './BasketInfo';
import CrossShop from './CrossShop';

// หน้าแก้ไขสินค้า Shopee / Lazada / TikTok (หน้าตาตาม BigSeller) — /product/<platform>/[shop]/[id]/edit · บันทึกที่ /api/basket/<platform>
//   แถบบน: ← กลับ · สถานะ · ปุ่ม "อัปเดต"
//   ตัวเลือกสินค้า: กล่องละชั้น (สี / ไซส์) ตัวเลือกเดิมล็อกไว้ เพิ่มตัวใหม่ได้ · สีใหม่เลือกรูปได้ (Shopee บังคับถ้าสีเดิมมีรูป)
//   ข้อมูลสินค้า: app/product/BasketInfo.js (ชื่อ/รายละเอียด/หมวด — ปุ่ม "บันทึกข้อมูล")
//   รูปสินค้า: app/product/BasketImages.js (บันทึกแยก — ปุ่ม "บันทึกรูป")
//   จัดการตัวเลือกเดิม: เรียง / เปลี่ยนชื่อ / ลบตัวเลือก / ลบ SKU — บันทึกแยก (action 'structure') ลบต้องพิมพ์ยืนยัน
//   SKU, สต็อกและราคา: SKU เดิมแก้รหัส SKU / ราคาได้ (Lazada แก้ได้แค่ราคา · คลังให้ระบบซิงก์ดูแล)
//     แถวเหลือง = SKU ใหม่ แก้รหัส/คลัง/ราคาได้ · แก้เป็นชุดได้ · ปุ่ม "อัปเดต" บันทึกทั้งของที่แก้และของใหม่
//   children = ส่วนราคาพิเศษ (โปรส่วนลด — app/product/ItemPromo.js) วางต่อจากตาราง
//   "ร้านอื่นมี แต่ตะกร้านี้ยังไม่มี" (plan.siblings — lib/basket.js siblingSuggest): กดแล้วเพิ่มตัวเลือกใหม่ลงแบบร่าง
//     SKU ใช้รหัสที่ร้านอื่นลงไว้ · ราคา: ST ก่อน แล้วค่อยราคาร้านอื่น · ยังไม่เขียนลงร้านจนกด "อัปเดต"
//   "ใช้กับร้านอื่นด้วย" (app/product/CrossShop.js · lib/basketCross.js): หลังอัปเดตสำเร็จ ส่งต่อราคา / SKU ใหม่ / ชื่อตัวเลือกใหม่
//     ให้ตะกร้าเดียวกันในร้านอื่น — ดูตัวอย่างต่อร้านก่อน กดยืนยันค่อยเขียน
// ตรวจซ้ำกับตะกร้าสดที่เซิร์ฟเวอร์ทุกอย่าง (lib/basket.js) (lib/basket.js, /api/basket/shopee)
// SKU ใหม่ = รหัสสี + ไซส์ ต่อกันตรงๆ แบบรหัส Seniorsoft (062541000 + S) · รหัสสีเดาจาก SKU เดิมของตะกร้า
const up = (s) => String(s ?? '').trim().toUpperCase();
const BUFFER = 2;   // คลังเริ่มต้น = ST − 2 (ต้องตรงกับ ST_BUFFER ใน lib/basket.js)
const baht = (n) => (n === null || n === undefined || n === '' ? '—' : '฿' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }));

const LABEL = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok' };

export default function BasketEditor({ shop, itemId, plan, promoOf = {}, back, statusLabel, statusTone, children, platform = 'shopee', sellerUrl = null }) {
  const label = LABEL[platform] || platform;
  const canUpload = plan.canUpload !== false;   // Lazada / TikTok: เลือกรูปที่ตะกร้ามีอยู่แล้วเท่านั้น
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [add, setAdd] = useState([[], []]);     // ตัวเลือกใหม่ต่อชั้น [{ text, code, image_id, image_url }]
  const [draft, setDraft] = useState(['', '']); // ช่องพิมพ์ต่อชั้น
  const [draftCode, setDraftCode] = useState('');
  const [st, setSt] = useState(() => new Map(plan.st.map((r) => [up(r.sku), r])));   // SKU ตัวใหญ่ → { qty, price }
  const [ovr, setOvr] = useState({});           // แก้เองในตาราง key → { sku, price, stock }
  const [bulk, setBulk] = useState({ price: '', stock: '' });
  const [edit, setEdit] = useState({});         // SKU เดิมที่แก้ model_id → { sku?, price? }
  const skuEditable = plan.skuEditable !== false;
  // โหมดจัดการตัวเลือกเดิม (เรียง/เปลี่ยนชื่อ/ลบ) — null = ปิด · ระหว่างนี้เพิ่มตัวเลือกใหม่/แก้ราคาไม่ได้ (บันทึกแยก)
  const [shape, setShape] = useState(null);     // { tiers: [{ name, options: [{ from, text, del }] }], del: [model_id] }
  // แก้พร้อมกันทุกร้าน: การแก้ล่าสุดที่สำเร็จ → ส่งต่อให้ตะกร้าเดียวกันในร้านอื่น (app/product/CrossShop.js) · null = ไม่แสดง
  const [cross, setCross] = useState(null);

  const tiers = plan.tiers;
  const sizeTier = plan.sizeTier;
  const colorTier = tiers.length === 2 && sizeTier >= 0 ? 1 - sizeTier : (tiers.length === 2 ? 0 : -1);
  const all = tiers.map((t, ti) => [
    ...t.options.map((o) => ({ text: o.text, old: true, image_url: o.image_url, code: ti === colorTier ? plan.codes[o.text] : undefined })),
    ...add[ti],
  ]);
  const oneCode = tiers.length === 1 ? plan.codes[''] : undefined;
  // ร้านอื่นมีคู่นี้แล้ว → ใช้เลข SKU / ราคาของร้านนั้นเป็นค่าเริ่มต้น (คีย์ = ข้อความตัวเลือกทุกชั้นตัวพิมพ์ใหญ่)
  const sibKey = (opts) => opts.map((t) => up(t)).join('\u0001');
  const sibOf = new Map((plan.siblings || []).map((x) => [sibKey(x.opts), x]));
  const have = new Set(plan.models.map((m) => m.tier_index.join(',')));
  const prices = plan.models.map((m) => Number(m.price)).filter((p) => p > 0);

  // ทุกคู่ที่มีตัวเลือกใหม่อย่างน้อย 1 ตัว
  const combos = (ti, acc) => (ti === tiers.length ? [acc] : all[ti].flatMap((_, i) => combos(ti + 1, [...acc, i])));
  const rows = combos(0, []).filter((ix) => ix.some((i, ti) => !all[ti][i].old) && !have.has(ix.join(','))).map((ix) => {
    const opts = ix.map((i, ti) => all[ti][i]);
    const key = opts.map((o) => o.text).join('\u0001');
    const size = sizeTier >= 0 ? opts[sizeTier].text : '';
    const code = colorTier >= 0 ? opts[colorTier].code : oneCode;
    // ไซส์แบบ "6L/5XL" → รหัสใช้ส่วนแรก (b516B + 6L) ตรงกับที่ร้านอื่นลงไว้
    const auto = code && size ? `${code}${size.split('/')[0].trim()}` : '';
    const o = ovr[key] || {};
    const sib = sibOf.get(sibKey(opts.map((x) => x.text)));
    const sku = o.sku ?? sib?.sku ?? auto;
    const s = st.get(up(sku));
    // ราคาเริ่มต้น: ST → ตัวเลือกเดิมไซส์เดียวกัน → ราคาสูงสุดของตะกร้า
    const sameSize = sizeTier >= 0 ? plan.models.find((m) => up(tiers[sizeTier].options[m.tier_index[sizeTier]]?.text) === up(size)) : null;
    const price = o.price ?? (s?.price || sib?.price || sameSize?.price || (prices.length ? Math.max(...prices) : ''));
    const stock = o.stock ?? (s ? Math.max(0, s.qty - BUFFER) : 0);
    return { key, opts, sku, s, price, stock, sib };
  });

  const api = (q) => `/api/basket/${platform}?${new URLSearchParams({ shop, itemId, ...q })}`;
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
  // ข้อเสนอจากร้านอื่น จัดกลุ่มตามตัวเลือกใหม่ (ชั้น + ข้อความ) — ตัวที่ใช้ตัวเลือกเดิมทุกชั้น (คู่ที่ขาด) เพิ่มจากหน้านี้ไม่ได้ ข้าม
  const sibGroups = (() => {
    const g = new Map();
    for (const x of plan.siblings || []) {
      const ti = x.opts.findIndex((t, i) => !tiers[i].options.some((o) => up(o.text) === up(t)));
      if (ti < 0) continue;
      const k = `${ti}\u0001${up(x.opts[ti])}`;
      if (!g.has(k)) g.set(k, { ti, text: x.opts[ti], skus: [], from: new Set() });
      g.get(k).skus.push(x.sku);
      x.from.forEach((f) => g.get(k).from.add(f));
    }
    return [...g.values()].filter((x) => !all[x.ti].some((o) => up(o.text) === up(x.text)));
  })();
  const addSib = (list) => {
    setAdd((a) => a.map((l, i) => {
      const more = list.filter((x) => x.ti === i && !l.some((o) => up(o.text) === up(x.text)) && !tiers[i].options.some((o) => up(o.text) === up(x.text)));
      return more.length ? [...l, ...more.map((x) => ({ text: x.text }))] : l;
    }));
    const skus = list.flatMap((x) => x.skus).filter((k) => !st.has(up(k)));
    // เซิร์ฟเวอร์ถาม ST ได้ครั้งละ 10 รหัส (stForCodes) → แบ่งยิง
    for (let i = 0; i < skus.length; i += 10) {
      fetch(api({ st: skus.slice(i, i + 10).join(',') })).then((r) => r.json()).then((j) => {
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
      const res = await fetch(`/api/basket/${platform}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'upload', shop, data, type: file.type, use: 'option' }) });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error);
      setImg(text, { image_id: j.image_id, image_url: /^https:/.test(j.image_id) ? j.image_id : URL.createObjectURL(file) });
    } catch (e) { setMsg({ ok: false, text: `อัปโหลดรูปไม่สำเร็จ: ${e.message}` }); }
    finally { setBusy(false); }
  }

  const noImg = plan.needImage ? add[0].filter((o) => !o.image_id).length : 0;
  const badRows = rows.filter((r) => !(Number(r.price) > 0) || r.stock === '' || !Number.isInteger(Number(r.stock)) || Number(r.stock) < 0).length;
  const nNewOpt = add.reduce((n, l) => n + l.length, 0);
  // SKU เดิมที่แก้จริง (ค่าไม่เท่าของเดิม)
  const byModel = new Map(plan.models.map((m) => [m.model_id, m]));
  const edits = Object.entries(edit).map(([id, e]) => {
    const m = byModel.get(id);
    if (!m) return null;
    const sku = e.sku !== undefined && e.sku.trim() !== (m.sku || '') ? e.sku.trim() : undefined;
    const price = e.price !== undefined && Number(e.price) !== Number(m.price) ? e.price : undefined;
    return sku === undefined && price === undefined ? null : { model_id: id, sku, price, m };
  }).filter(Boolean);
  const badEdits = edits.filter((x) => (x.price !== undefined && !(Number(x.price) > 0)) || (x.sku !== undefined && !x.sku)).length;
  const setE = (id, f, v) => setEdit((x) => ({ ...x, [id]: { ...(x[id] || {}), [f]: v } }));
  // ภาพตะกร้านี้ "ก่อนแก้" (เลข SKU + ข้อความตัวเลือกต่อชั้น) — ใช้จับคู่ชั้น/ตัวเลือกกับร้านอื่น
  const srcSnap = () => ({
    platform, shop, itemId, tiers: tiers.map((t) => t.name),
    models: plan.models.filter((m) => m.sku).map((m) => ({ sku: m.sku, opts: m.tier_index.map((i, ti) => tiers[ti].options[i]?.text ?? '') })),
  });

  async function save() {
    const lines = add.map((l, ti) => (l.length ? `${tiers[ti]?.name}: ${l.map((o) => o.text).join(', ')}` : null)).filter(Boolean);
    const eLines = edits.slice(0, 8).map((x) => `${x.m.sku || x.model_id}: ${x.sku !== undefined ? `รหัส → ${x.sku} ` : ''}${x.price !== undefined ? `ราคา ${baht(x.m.price)} → ${baht(x.price)}` : ''}`);
    if (edits.length > 8) eLines.push(`…และอีก ${edits.length - 8} ตัว`);
    const parts = [
      edits.length && `แก้ SKU เดิม ${edits.length} ตัว:\n${eLines.join('\n')}`,
      rows.length && `${lines.join('\n')}\nSKU ใหม่ ${rows.length} ตัว (ตัวเลือกเดิมไม่ถูกแตะ)`,
    ].filter(Boolean);
    if (!window.confirm(`อัปเดตตะกร้าจริงใน ${label} ${shop}?\n\n${parts.join('\n\n')}`)) return;
    setBusy(true); setMsg(null); setCross(null);
    const done = [];
    // ของที่ส่งต่อให้ร้านอื่นได้ (อ้างด้วยเลข SKU) — เก็บก่อนยิง เพราะหลังอัปเดตตะกร้าจะเปลี่ยน
    const src = srcSnap();
    const prices = edits.filter((x) => x.price !== undefined && x.m.sku).map((x) => ({ sku: x.m.sku, price: Number(x.price) }));
    const addI = rows.filter((r) => r.sku).map((r) => ({ sku: r.sku, opts: r.opts.map((o) => o.text), price: Number(r.price), stock: Number(r.stock) }));
    const notes = [
      edits.some((x) => x.sku !== undefined) && 'เปลี่ยนรหัส SKU',
      rows.some((r) => !r.sku) && 'SKU ใหม่ที่ไม่มีรหัส',
    ].filter(Boolean);
    const job = (withAdd) => {
      const add2 = withAdd ? addI : [];
      if (!prices.length && !add2.length) return null;
      const title = [
        prices.length && `ราคา ${prices.length} SKU`,
        add2.length && `${lines.join(' · ')}${lines.length ? ' · ' : ''}SKU ใหม่ ${add2.length} ตัว`,
      ].filter(Boolean);
      return { title, src, intent: { prices, add: add2, renames: [] }, notes };
    };
    try {
      if (edits.length) {
        const res = await fetch(`/api/basket/${platform}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          action: 'edit', shop, itemId,
          edits: edits.map((x) => ({ model_id: x.model_id, ...(x.sku !== undefined ? { sku: x.sku } : {}), ...(x.price !== undefined ? { price: Number(x.price) } : {}) })),
        }) });
        const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
        if (!j.ok) throw new Error(j.error);
        done.push(`แก้ SKU เดิม ${j.changed} ตัว${j.warnings?.length ? ' · ' + j.warnings.join(' · ') : ''}`);
        setEdit({});
      }
      if (!rows.length) {
        setMsg({ ok: true, text: `✓ ${done.join(' · ')}` });
        setCross(job(false));
        router.refresh();
        return;
      }
      const body = {
        shop, itemId,
        add: tiers.map((_, ti) => add[ti].map((o) => (ti === 0 && o.image_id ? { text: o.text, image_id: o.image_id } : o.text))),
        models: rows.map((r) => ({ opts: r.opts.map((o) => o.text), sku: r.sku, price: Number(r.price), stock: Number(r.stock) })),
      };
      const res = await fetch(`/api/basket/${platform}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error);
      setMsg({ ok: true, text: `✓ ${[...done, `เพิ่ม ${j.added.length} SKU แล้ว`].join(' · ')}${j.warnings?.length ? ' · ' + j.warnings.join(' · ') : ''}` });
      setAdd([[], []]); setOvr({});
      setCross(job(true));
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: done.length ? `✓ ${done.join(' · ')} — แต่เพิ่ม SKU ใหม่ไม่สำเร็จ: ${e.message}` : e.message });
      if (done.length) { setCross(job(false)); router.refresh(); }
    }
    finally { setBusy(false); }
  }

  // ── จัดการตัวเลือกเดิม ──
  const startShape = () => {
    setShape({ tiers: tiers.map((t) => ({ name: t.name, options: t.options.map((o, i) => ({ from: i, text: o.text, del: false })) })), del: [] });
    setMsg(null);
  };
  const patchTier = (ti, f) => setShape((s) => ({ ...s, tiers: s.tiers.map((t, i) => (i === ti ? f(t) : t)) }));
  const moveOpt = (ti, i, d) => patchTier(ti, (t) => {
    const n = [...t.options]; const j = i + d;
    if (j < 0 || j >= n.length) return t;
    [n[i], n[j]] = [n[j], n[i]];
    return { ...t, options: n };
  });
  const setOptText = (ti, i, text) => patchTier(ti, (t) => ({ ...t, options: t.options.map((o, k) => (k === i ? { ...o, text } : o)) }));
  const toggleOptDel = (ti, i) => patchTier(ti, (t) => ({ ...t, options: t.options.map((o, k) => (k === i ? { ...o, del: !o.del } : o)) }));
  const toggleModelDel = (id) => setShape((s) => ({ ...s, del: s.del.includes(id) ? s.del.filter((x) => x !== id) : [...s.del, id] }));
  // ตัวเลือกเดิม (ตามลำดับเดิม) → ข้อความใหม่ / ถูกลบไหม
  const shapeOpt = (ti, from) => shape?.tiers[ti].options.find((o) => o.from === from);
  const dropped = shape ? plan.models.filter((m) => shape.del.includes(m.model_id) || m.tier_index.some((i, ti) => shapeOpt(ti, i)?.del)) : [];
  const shapeDirty = Boolean(shape) && (dropped.length > 0 || shape.tiers.some((t, ti) => t.name.trim() !== tiers[ti].name
    || t.options.some((o, i) => o.from !== i || o.del || o.text.trim() !== tiers[ti].options[o.from].text)));
  const shapeBad = shape ? shape.tiers.reduce((n, t) => {
    const live = t.options.filter((o) => !o.del).map((o) => up(o.text));
    return n + (!t.name.trim() ? 1 : 0) + (!live.length ? 1 : 0) + live.filter((x, i) => !x || live.indexOf(x) !== i).length;
  }, 0) : 0;

  async function saveShape() {
    const ren = shape.tiers.flatMap((t, ti) => t.options.filter((o) => !o.del && o.text.trim() !== tiers[ti].options[o.from].text).map((o) => `${tiers[ti].options[o.from].text} → ${o.text.trim()}`));
    const delOpts = shape.tiers.flatMap((t) => t.options.filter((o) => o.del).map((o) => o.text));
    const lines = [
      ren.length && `เปลี่ยนชื่อ: ${ren.join(', ')}`,
      delOpts.length && `ลบตัวเลือก: ${delOpts.join(', ')}`,
      dropped.length && `ลบ SKU ${dropped.length} ตัว: ${dropped.slice(0, 10).map((m) => m.sku || m.model_id).join(', ')}${dropped.length > 10 ? ' …' : ''}`,
      'เรียงลำดับตัวเลือกตามที่จัดไว้',
    ].filter(Boolean);
    if (!window.confirm(`บันทึกการจัดการตัวเลือกลงตะกร้าจริงใน ${label} ${shop}?\n\n${lines.join('\n')}${platform === 'tiktok' ? '\n\nTikTok ต้องรอตรวจ' : ''}`)) return;
    if (dropped.length) {
      const typed = window.prompt(`ลบ SKU ${dropped.length} ตัว — ลบแล้วกู้คืนไม่ได้ ยอดขายของ SKU นั้นจะไม่ผูกกับตะกร้าอีก\nพิมพ์คำว่า ลบ เพื่อยืนยัน`);
      if ((typed || '').trim() !== 'ลบ') { setMsg({ ok: false, text: 'ยกเลิก — ยังไม่ได้ลบอะไร' }); return; }
    }
    setBusy(true); setMsg(null); setCross(null);
    // ส่งต่อได้เฉพาะเปลี่ยนชื่อตัวเลือก (อ้างด้วย SKU ที่ใช้ตัวเลือกนั้น) — เรียง/ลบ/ชื่อชั้น ไม่ส่งต่อ
    const src = srcSnap();
    const renames = shape.tiers.flatMap((t, ti) => t.options.filter((o) => !o.del && o.text.trim() !== tiers[ti].options[o.from].text).map((o) => ({
      ti, from: tiers[ti].options[o.from].text, to: o.text.trim(),
      skus: plan.models.filter((m) => m.tier_index[ti] === o.from && m.sku).map((m) => m.sku),
    }))).filter((r) => r.skus.length);
    const notes = [
      shape.tiers.some((t, ti) => t.options.some((o, i) => o.from !== i)) && 'ลำดับตัวเลือก',
      (delOpts.length > 0 || dropped.length > 0) && 'การลบ',
      shape.tiers.some((t, ti) => t.name.trim() !== tiers[ti].name) && 'ชื่อชั้น',
    ].filter(Boolean);
    try {
      const body = {
        action: 'structure', shop, itemId,
        tiers: shape.tiers.map((t) => ({ name: t.name.trim(), options: t.options.filter((o) => !o.del).map((o) => ({ from: o.from, text: o.text.trim() })) })),
        del: shape.del,
      };
      const res = await fetch(`/api/basket/${platform}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error);
      setMsg({ ok: true, text: `✓ บันทึกแล้ว${j.deleted ? ` · ลบ ${j.deleted} SKU` : ''}${j.warnings?.length ? ' · ' + j.warnings.join(' · ') : ''}` });
      setShape(null);
      if (renames.length) setCross({ title: [`เปลี่ยนชื่อ ${renames.map((r) => `${r.from} → ${r.to}`).join(', ')}`], src, intent: { prices: [], add: [], renames }, notes });
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  const sug = plan.suggest;
  const optText = (m, ti) => tiers[ti].options[m.tier_index[ti]]?.text ?? '—';
  const canSave = !busy && !shape && (rows.length > 0 || edits.length > 0) && badRows === 0 && badEdits === 0 && noImg === 0
    && !(plan.auditing && (rows.length > 0 || edits.some((x) => x.sku !== undefined)));

  return (
    <>
      <div className="etop">
        <div className="etop-l">
          <Link className="sub" style={{ margin: 0 }} href={back}>←</Link>
          <span>{label} &gt; <b>แก้ไขสินค้า</b></span>
          <span className="shop" data-shop={shop}>{shop}</span>
          {statusLabel && <span className={'badge ' + (statusTone || '')}>{statusLabel}</span>}
        </div>
        <div className="etop-r">
          {msg && <span className={msg.ok ? 'ok-t' : 'danger'}>{msg.text}</span>}
          {!msg && (nNewOpt > 0 || rows.length > 0 || edits.length > 0) && <span className="sku">{edits.length > 0 && `แก้ ${edits.length} SKU · `}ตัวเลือกใหม่ {nNewOpt} · SKU ใหม่ {rows.length} · ยังไม่ได้อัปเดต</span>}
          <button type="button" className="btn dark" onClick={save} disabled={!canSave}>{busy ? 'กำลังอัปเดต…' : 'อัปเดต'}</button>
        </div>
      </div>

      {cross && <CrossShop platform={platform} shop={shop} itemId={itemId} job={cross} onClose={() => setCross(null)} />}

      {plan.info && <BasketInfo platform={platform} shop={shop} itemId={itemId} info={plan.info} sellerUrl={sellerUrl} auditing={plan.auditing} />}

      <BasketImages platform={platform} shop={shop} itemId={itemId} plan={plan} />

      <section className="pcard esec">
        <h2 className="esec-h">ข้อมูลการขาย</h2>
        {plan.auditing && <div className="note" style={{ marginBottom: 12 }}>การแก้ไขครั้งก่อนของตะกร้านี้ยังรอ TikTok ตรวจ — เพิ่มได้หลังผ่านตรวจ</div>}
        {platform === 'tiktok' && !plan.auditing && <div className="sub" style={{ margin: '0 0 10px' }}>TikTok: เพิ่มแล้วต้องรอตรวจ SKU ใหม่ขึ้นหลังผ่าน (ตะกร้าเดิมยังขายต่อ)</div>}

        {(!plan.hasModel || !tiers.length) ? (
          <div className="sku">ตะกร้านี้ไม่มีตัวเลือก (หรือตั้งตัวเลือกแบบที่เว็บอ่านไม่ได้) — เพิ่มในหลังร้าน {label}</div>
        ) : (
          <>
            {!shape && sibGroups.length > 0 && (
              <div className="note" style={{ marginBottom: 12 }}>
                <b>ร้านอื่นมี แต่ตะกร้านี้ยังไม่มี</b>{' '}
                <span className="sku">— {sibGroups.reduce((n, x) => n + x.skus.length, 0)} SKU (จาก {[...new Set(sibGroups.flatMap((x) => [...x.from]))].join(', ')}) · กดเพื่อเพิ่มลงแบบร่าง</span>
                <div className="basket-opts" style={{ marginTop: 6 }}>
                  {sibGroups.map((x) => (
                    <button key={`${x.ti}-${x.text}`} type="button" className="opt sug" onClick={() => addSib([x])}
                      title={`${x.skus.join(', ')} · มีใน ${[...x.from].join(', ')}`}>
                      + {tiers[x.ti].name} {x.text} <span className="sku">({x.skus.length} SKU)</span>
                    </button>
                  ))}
                  {sibGroups.length > 1 && <button type="button" className="btn" onClick={() => addSib(sibGroups)}>เพิ่มทั้งหมด</button>}
                </div>
              </div>
            )}
            {!shape && (sug.colors.length > 0 || sug.sizes.length > 0) && (
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
                {!shape ? (
                  <div className="bedit-bar" style={{ margin: '0 0 8px' }}>
                    <button type="button" className="btn" onClick={startShape} disabled={busy || plan.auditing || nNewOpt > 0 || rows.length > 0 || edits.length > 0}>
                      จัดการตัวเลือกเดิม (เรียง / เปลี่ยนชื่อ / ลบ)
                    </button>
                    {(nNewOpt > 0 || rows.length > 0 || edits.length > 0) && <span className="sku">อัปเดตของที่ค้างอยู่ก่อน แล้วค่อยจัดการตัวเลือกเดิม</span>}
                  </div>
                ) : (
                  <div className="note shape-bar">
                    <span><b>จัดการตัวเลือกเดิม</b> <span className="sku">— ↑↓ เรียงลำดับ · พิมพ์ทับเพื่อเปลี่ยนชื่อ · 🗑 ลบตัวเลือก (SKU ที่ใช้ตัวเลือกนั้นถูกลบด้วย) · ติ๊ก "ลบ" ในตารางเพื่อลบ SKU รายตัว</span></span>
                    <span className="etop-r">
                      {dropped.length > 0 && <span className="danger">จะลบ {dropped.length} SKU</span>}
                      {shapeBad > 0 && <span className="danger">ชื่อว่าง/ซ้ำ หรือชั้นไม่เหลือตัวเลือก</span>}
                      <button type="button" className="btn" onClick={() => setShape(null)} disabled={busy}>ยกเลิก</button>
                      <button type="button" className="btn dark" onClick={saveShape} disabled={busy || !shapeDirty || shapeBad > 0}>{busy ? 'กำลังบันทึก…' : 'บันทึกการจัดการตัวเลือก'}</button>
                    </span>
                  </div>
                )}
                {shape && shape.tiers.map((t, ti) => (
                  <div key={ti} className="etier">
                    <div className="etier-h">
                      <input className={'bin' + (t.name.trim() !== tiers[ti].name ? ' chg' : '')} style={{ width: 160, textAlign: 'left', fontWeight: 600 }} value={t.name}
                        title="ชื่อชั้นตัวเลือก" onChange={(e) => patchTier(ti, (x) => ({ ...x, name: e.target.value }))} />
                      <span className="sku">{t.options.filter((o) => !o.del).length} ตัวเลือก</span>
                    </div>
                    <div className="shape-list">
                      {t.options.map((o, i) => {
                        const old = tiers[ti].options[o.from];
                        const n = plan.models.filter((m) => m.tier_index[ti] === o.from).length;
                        return (
                          <div key={o.from} className={'shape-row' + (o.del ? ' del' : '')}>
                            <button type="button" onClick={() => moveOpt(ti, i, -1)} disabled={i === 0 || o.del} title="เลื่อนขึ้น">↑</button>
                            <button type="button" onClick={() => moveOpt(ti, i, 1)} disabled={i === t.options.length - 1 || o.del} title="เลื่อนลง">↓</button>
                            {ti === 0 && old.image_url && <img src={old.image_url} alt="" loading="lazy" />}
                            <input className={'bin' + (o.text.trim() !== old.text ? ' chg' : '') + (!o.text.trim() ? ' bad' : '')} style={{ width: 170, textAlign: 'left' }}
                              value={o.text} disabled={o.del} maxLength={20} onChange={(e) => setOptText(ti, i, e.target.value)} />
                            {o.text.trim() !== old.text && <span className="sku">เดิม: {old.text}</span>}
                            <span className="sku">{n} SKU</span>
                            <button type="button" className={o.del ? 'undo' : 'trash'} onClick={() => toggleOptDel(ti, i)} title={o.del ? 'ไม่ลบ' : `ลบ "${old.text}" และ ${n} SKU`}>{o.del ? '↺ ไม่ลบ' : '🗑'}</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {!shape && tiers.map((t, ti) => (
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
                        <span className={o.image_id ? 'sku' : 'danger'}>รูปของ <b>{o.text}</b>{o.image_id ? ' ✓' : ` (${label} บังคับ)`}:</span>
                        {plan.gallery.map((g) => (
                          <button key={g.image_id} type="button" className={'pick' + (o.image_id === g.image_id ? ' on' : '')}
                            onClick={() => setImg(o.text, { image_id: g.image_id, image_url: g.image_url })} title="ใช้รูปนี้">
                            <img src={g.image_url} alt="" loading="lazy" />
                          </button>
                        ))}
                        {canUpload && (
                          <label className="btn" style={{ padding: '4px 10px' }}>อัปโหลด…
                            <input type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { upload(o.text, e.target.files?.[0]); e.target.value = ''; }} />
                          </label>
                        )}
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
                        {shape && <th>ลบ</th>}
                        <th>SKU ID</th>
                        {tiers.map((t, ti) => <th key={ti}>{t.name}</th>)}
                        <th>SKU</th><th className="r">ST</th><th className="r">สต็อก</th><th className="r">ราคา</th><th className="r">ราคาพิเศษ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.models.map((m) => {
                        const e = edit[m.model_id] || {};
                        const sku = e.sku ?? (m.sku || '');
                        const price = e.price ?? (m.price ?? '');
                        const skuCh = sku.trim() !== (m.sku || '');
                        const priceCh = Number(price) !== Number(m.price);
                        return (
                          <tr key={m.model_id} className={(skuCh || priceCh ? 'bedit' : '') + (dropped.includes(m) ? ' bdel' : '')}>
                            {shape && (
                              <td>
                                <input type="checkbox" checked={dropped.includes(m)} disabled={m.tier_index.some((i, ti) => shapeOpt(ti, i)?.del)}
                                  title={m.tier_index.some((i, ti) => shapeOpt(ti, i)?.del) ? 'ถูกลบเพราะลบตัวเลือก' : 'ลบ SKU นี้'} onChange={() => toggleModelDel(m.model_id)} />
                              </td>
                            )}
                            <td className="sku mono">{m.model_id}</td>
                            {tiers.map((_, ti) => {
                              const so = shape ? shapeOpt(ti, m.tier_index[ti]) : null;
                              const txt = so ? so.text.trim() : optText(m, ti);
                              return <td key={ti}>{txt}{so && txt !== optText(m, ti) && <span className="sku"> (เดิม {optText(m, ti)})</span>}</td>;
                            })}
                            <td>
                              {skuEditable
                                ? <input className={'bin mono ' + (skuCh ? (sku.trim() ? 'chg' : 'bad') : '')} style={{ width: 140, textAlign: 'left' }} value={sku} disabled={Boolean(shape)}
                                    title={skuCh ? `เดิม: ${m.sku || '(ว่าง)'}` : ''} onChange={(ev) => setE(m.model_id, 'sku', ev.target.value)} />
                                : <span className="mono" title={`${label} เปลี่ยนรหัส SKU เดิมไม่ได้`}>{m.sku || <span className="sku">—</span>}</span>}
                            </td>
                            <td className="num sku">{st.get(up(sku))?.qty ?? '—'}</td>
                            <td className={'num ' + (Number(m.stock) === 0 ? 'danger' : '')}>{Number(m.stock) === 0 ? 'หมด' : m.stock ?? '—'}</td>
                            <td className="num">
                              <input className={'bin ' + (priceCh ? (Number(price) > 0 ? 'chg' : 'bad') : '')} value={price} inputMode="numeric" disabled={Boolean(shape)}
                                title={priceCh ? `เดิม: ${baht(m.price)}` : ''} onChange={(ev) => setE(m.model_id, 'price', ev.target.value.replace(/[^\d.]/g, ''))} />
                            </td>
                            <td className="num">{promoOf[m.model_id] ? <span className="promo">{baht(promoOf[m.model_id])}</span> : <span className="sku">—</span>}</td>
                          </tr>
                        );
                      })}
                      {!shape && rows.map((r) => (
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
                  SKU เดิม: แก้{skuEditable ? 'รหัส SKU / ' : ''}ราคาได้ (คลังให้ระบบซิงก์ดูแล{skuEditable ? '' : ` · ${label} เปลี่ยนรหัส SKU เดิมไม่ได้`}) · เปลี่ยนรหัส SKU แล้วระบบซิงก์จะจับคู่ ST ด้วยรหัสใหม่
                  {platform === 'tiktok' && ' · TikTok เปลี่ยนรหัส SKU ต้องรอตรวจ (ราคาไม่ต้อง)'}
                  {' · '}แถวเหลือง = SKU ใหม่ คลังเริ่ม = ST − {BUFFER} · ไม่อยากขายคู่ไหนให้ใส่คลัง 0
                  {noImg > 0 && <span className="danger"> · ยังไม่ได้เลือกรูป {noImg} สี</span>}
                  {badRows > 0 && <span className="danger"> · ราคา/สต็อกไม่ถูก {badRows} แถว</span>}
                  {badEdits > 0 && <span className="danger"> · SKU เดิมที่แก้ไม่ถูก {badEdits} แถว</span>}
                  {edits.some((x) => x.price !== undefined && promoOf[x.model_id]) && <span className="danger"> · มี SKU ที่อยู่ในโปร — ถ้าราคาปกติต่ำกว่าราคาโปร แพลตฟอร์มอาจไม่ยอม</span>}
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
