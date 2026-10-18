// แก้พร้อมกันทุกร้าน — แก้ตะกร้าหนึ่งเสร็จ แล้วกดใช้กับตะกร้าเดียวกันในร้านอื่น (หน้าแก้ไขสินค้า app/product/CrossShop.js)
//
// ตะกร้าปลายทาง = ตะกร้า Shopee/TikTok/Lazada ของ "กลุ่มร้านเดียวกัน" (SOLID → SOLID, REAL → REAL) บนแพลตฟอร์มอื่น
//   ที่มีเลข SKU ร้านตรงกับตะกร้าต้นทาง ≥3 ตัวหรือ ≥ครึ่ง (os_listing_skus — แบบเดียวกับ lib/basket.js siblingSuggest)
//   ข้ามกลุ่มไม่ส่ง เพราะแต่ละกลุ่มตั้งราคา/ชื่อ/รายละเอียดของตัวเอง
//
// คำสั่งที่ส่งต่อได้ (intent) — อ้างด้วยเลข SKU ร้าน (ตัวพิมพ์ไม่สนใจ) ไม่ใช่ model_id / ลำดับตัวเลือก เพราะข้ามร้านไม่ตรงกัน:
//   prices:  [{ sku, price }]                              ราคาปกติของ SKU เดิม
//   add:     [{ sku, opts: [ข้อความต่อชั้นของต้นทาง], price, stock }]   SKU ใหม่ (รวมตัวเลือกสี/ไซส์ใหม่)
//   renames: [{ ti, from, to, skus: [SKU ที่ใช้ตัวเลือกนี้] }]   เปลี่ยนชื่อตัวเลือก (ti = ชั้นของต้นทาง)
//   main / title / desc: true = ใช้รูปสินค้า (แทนทั้งชุด) / ชื่อ / รายละเอียด ของต้นทาง — ผู้ใช้ต้องติ๊กเองในหน้าจอ
// src = ภาพตะกร้าต้นทาง "ก่อนแก้" { platform, shop, itemId, tiers: [ชื่อชั้น], models: [{ sku, opts }] } — ใช้จับคู่ชั้น/ตัวเลือกข้ามร้าน
// ตะกร้าต้นทาง "หลังแก้" (live) อ่านสดจากแพลตฟอร์ม — รูปสีใหม่ / รูปสินค้า / ชื่อ / รายละเอียด เอาจากตรงนั้น ไม่รับลิงก์รูปจากหน้าเว็บ
//
// แปลงต่อร้าน (translate) กับตะกร้าสดของร้านนั้น:
//   ชั้น: ลองสลับชั้น (สี/ไซส์ อาจอยู่คนละลำดับ) เลือกแบบที่ SKU ชุดเดียวกันใช้ตัวเลือกตรงกันแบบหนึ่งต่อหนึ่ง — กำกวม/ขัดกัน = ไม่แปลง
//   ตัวเลือก: ข้อความต้นทาง → ข้อความของร้านนี้ จาก SKU ที่มีทั้งสองร้าน · ไม่มีคู่ = ข้อความเดียวกัน (ตัวเลือกใหม่ของร้านนี้)
//   รูปสีใหม่ (ร้านที่บังคับรูปสี): ใช้รูปของสีนั้นจากต้นทางอัตโนมัติ (อัปเข้าแพลตฟอร์มนี้ตอนยืนยัน) · ผู้ใช้เลือกรูปของร้านนี้แทนได้
//   ส่วนที่แปลงไม่ได้ → บอกเหตุผลแล้วข้าม ไม่เดา · ตรวจซ้ำด้วยตัวตรวจของแพลตฟอร์ม (checkAdd / checkEdits) ก่อนให้ดูตัวอย่าง
// ยืนยัน (applyCross): อ่านตะกร้าสดอีกรอบ แปลงใหม่ ต้องได้ผลเหมือนตัวอย่างที่ผู้ใช้เห็น (sig) ไม่งั้นไม่เขียน
//   เขียนผ่านฟังก์ชันเดิมของแต่ละแพลตฟอร์ม (*EditModels / *AddOptions / *SetStructure / *SetInfo / *SetImages) ซึ่งตรวจซ้ำอีกชั้น
import { createHash } from 'node:crypto';
import { db } from './supabase.js';
import { shopeeShops, lazadaShops, tiktokShops } from './discounts.js';
import { shopGroup } from './shopGroups.js';
import {
  BasketError, checkAdd, checkEdits, shopeeBasketPlan, shopeeAddOptions, shopeeEditModels, shopeeSetStructure,
  shopeeSetImages, shopeeSetInfo, uploadBasketImage,
} from './basket.js';
import { lazadaBasketPlan, lazadaAddOptions, lazadaEditModels, lazadaSetStructure, lazadaSetImages, lazadaSetInfo, lazadaUploadImage } from './basketLazada.js';
import { tiktokBasketPlan, tiktokAddOptions, tiktokEditModels, tiktokSetStructure, tiktokSetImages, tiktokSetInfo, tiktokUploadImage } from './basketTiktok.js';

const up = (s) => String(s ?? '').trim().toUpperCase();
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const baht = (n) => '฿' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const short = (s, n = 60) => (s.length > n ? s.slice(0, n) + '…' : s);

export const CROSS = {
  shopee: {
    label: 'Shopee', shops: shopeeShops, plan: shopeeBasketPlan, add: shopeeAddOptions, edit: shopeeEditModels, structure: shopeeSetStructure,
    images: shopeeSetImages, info: shopeeSetInfo, upload: (shop, bytes, type) => uploadBasketImage(shop, bytes, type),
    round: Math.round, imgOk: (x) => /^[\w-]{6,80}$/.test(x),
  },
  tiktok: {
    label: 'TikTok', shops: tiktokShops, plan: tiktokBasketPlan, add: tiktokAddOptions, edit: tiktokEditModels, structure: tiktokSetStructure,
    images: tiktokSetImages, info: tiktokSetInfo, upload: (shop, bytes, type, use) => tiktokUploadImage(shop, bytes, type, use),
    round: (x) => Math.round(x * 100) / 100, imgOk: (x) => /^[\w.~/-]{6,400}$/.test(x),
  },
  lazada: {
    label: 'Lazada', shops: lazadaShops, plan: lazadaBasketPlan, add: lazadaAddOptions, edit: lazadaEditModels, structure: lazadaSetStructure,
    images: lazadaSetImages, info: lazadaSetInfo, upload: (shop, bytes, type) => lazadaUploadImage(shop, bytes, type),
    round: (x) => Math.round(x * 100) / 100, imgOk: (x) => /^https:\/\/[^\s"'<>]{8,600}$/.test(x),
  },
};

// ── ตะกร้าเดียวกันในร้านอื่น (กลุ่มร้านเดียวกันเท่านั้น) ──
export async function crossTargets(platform, shop, itemId) {
  const { data: mine, error } = await db().from('os_listing_skus').select('seller_sku')
    .eq('platform', platform).eq('shop', shop).eq('product_id', String(itemId));
  if (error) throw new Error(error.message);
  const skus = [...new Set((mine || []).map((r) => r.seller_sku).filter(Boolean))];
  if (!skus.length) return [];
  const group = shopGroup(platform, shop);
  const hits = [];
  for (const c of chunks(skus, 100)) {
    const { data, error: e } = await db().from('os_listing_skus').select('platform, shop, product_id, seller_sku').in('seller_sku', c).in('platform', Object.keys(CROSS));
    if (e) throw new Error(e.message);
    hits.push(...(data || []));
  }
  const connected = Object.fromEntries(await Promise.all(Object.entries(CROSS).map(async ([k, p]) => [k, await p.shops().catch(() => [])])));
  const overlap = new Map();
  for (const h of hits) {
    if (h.platform === platform && h.shop === shop) continue;   // ร้านเดียวกัน (ตะกร้าซ้ำในร้าน) ไม่แตะ
    if (shopGroup(h.platform, h.shop) !== group) continue;      // คนละกลุ่มร้าน (SOLID ↛ REAL) ไม่ส่ง
    if (!connected[h.platform]?.includes(h.shop)) continue;
    const k = `${h.platform}|${h.shop}|${h.product_id}`;
    const o = overlap.get(k) || { platform: h.platform, shop: h.shop, itemId: String(h.product_id), skus: new Set() };
    o.skus.add(up(h.seller_sku));
    overlap.set(k, o);
  }
  const list = [...overlap.values()].map((o) => ({ ...o, n: o.skus.size })).filter((o) => o.n >= 3 || o.n * 2 >= skus.length);
  if (!list.length) return [];
  const titles = new Map();
  for (const pf of [...new Set(list.map((o) => o.platform))]) {
    const ids = list.filter((o) => o.platform === pf);
    const { data } = await db().from('os_listings').select('shop, product_id, title, status, thumb_url, sku_n').eq('platform', pf).in('product_id', ids.map((o) => o.itemId));
    for (const r of data || []) titles.set(`${pf}|${r.shop}|${r.product_id}`, r);
  }
  const order = ['shopee', 'tiktok', 'lazada'];
  return list.map(({ skus: _s, ...o }) => {
    const t = titles.get(`${o.platform}|${o.shop}|${o.itemId}`) || {};
    return { ...o, label: `${CROSS[o.platform].label} ${o.shop}`, title: t.title || null, status: t.status || null, thumb: t.thumb_url || null, total: t.sku_n ?? null, mine: skus.length };
  }).sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform) || a.shop.localeCompare(b.shop) || b.n - a.n).slice(0, 20);
}

// ── ตรวจคำสั่งที่ส่งมา ──
export function checkIntent(src, intent) {
  const tiers = Array.isArray(src?.tiers) ? src.tiers.map((x) => String(x ?? '')) : null;
  const models = Array.isArray(src?.models) ? src.models : null;
  if (!tiers || tiers.length > 2 || !models || models.length > 1000) throw new BasketError('ข้อมูลตะกร้าต้นทางไม่ถูกต้อง');
  const platform = String(src?.platform ?? '');
  const shop = String(src?.shop ?? '');
  const itemId = String(src?.itemId ?? '');
  if (!CROSS[platform] || !shop || !/^\d+$/.test(itemId)) throw new BasketError('ข้อมูลตะกร้าต้นทางไม่ถูกต้อง');
  const s = {
    platform, shop, itemId, tiers,
    models: models.map((m) => ({ sku: String(m?.sku ?? '').trim(), opts: (Array.isArray(m?.opts) ? m.opts : []).map((x) => String(x ?? '').trim()) }))
      .filter((m) => m.sku && m.opts.length === tiers.length),
  };
  const prices = (Array.isArray(intent?.prices) ? intent.prices : []).map((x) => ({ sku: String(x?.sku ?? '').trim(), price: Number(x?.price) })).filter((x) => x.sku && x.price > 0);
  const add = (Array.isArray(intent?.add) ? intent.add : []).map((x) => ({
    sku: String(x?.sku ?? '').trim(), opts: (Array.isArray(x?.opts) ? x.opts : []).map((t) => String(t ?? '').trim()),
    price: Number(x?.price), stock: Number(x?.stock),
  }));
  const renames = (Array.isArray(intent?.renames) ? intent.renames : []).map((x) => ({
    ti: Number(x?.ti), from: String(x?.from ?? '').trim(), to: String(x?.to ?? '').trim(),
    skus: (Array.isArray(x?.skus) ? x.skus : []).map((k) => String(k ?? '').trim()).filter(Boolean),
  }));
  const main = intent?.main === true;
  const title = intent?.title === true;
  const desc = intent?.desc === true;
  if (prices.length > 200 || add.length > 200 || renames.length > 50) throw new BasketError('คำสั่งเยอะเกิน — ทำทีละน้อยลง');
  if ((add.length || renames.length) && !tiers.length) throw new BasketError('ตะกร้าต้นทางไม่มีตัวเลือก');
  if (add.some((x) => x.opts.length !== tiers.length)) throw new BasketError('ตัวเลือกของ SKU ใหม่ไม่ครบทุกชั้น');
  if (renames.some((x) => !Number.isInteger(x.ti) || x.ti < 0 || x.ti >= tiers.length || !x.from || !x.to)) throw new BasketError('คำสั่งเปลี่ยนชื่อไม่ถูกต้อง');
  // เปลี่ยนชื่อ = ส่งโครงตัวเลือกทั้งชุด → ห้ามรวมกับเพิ่มตัวเลือกในรอบเดียว (โครงที่อ่านก่อนเพิ่มจะลบของที่เพิ่งเพิ่ม)
  if (renames.length && add.length) throw new BasketError('เปลี่ยนชื่อตัวเลือกกับเพิ่มตัวเลือกต้องส่งต่อแยกรอบกัน');
  if (!prices.length && !add.length && !renames.length && !main && !title && !desc) throw new BasketError('ไม่มีอะไรให้ส่งต่อ — ติ๊กอย่างน้อยหนึ่งอย่าง');
  return { src: s, intent: { prices, add, renames, main, title, desc } };
}

// ── ตะกร้าต้นทางหลังแก้ (อ่านสด) — รูปสีใหม่ / รูปสินค้า / ชื่อ / รายละเอียด ──
export async function readSource(src, intent) {
  if (!intent.add.length && !intent.main && !intent.title && !intent.desc) return null;
  const plan = await CROSS[src.platform].plan(src.shop, src.itemId);
  // รูป = { id: รหัสรูปต้นทาง (คงที่ ใช้ทำ sig), url: ลิงก์ดาวน์โหลด (TikTok มีลายเซ็น เปลี่ยนทุกครั้งที่อ่าน) }
  const img = (x) => (x?.image_url && /^https:\/\//.test(x.image_url) ? { id: String(x.image_id || x.image_url), url: x.image_url } : null);
  const optImg = new Map();
  for (const o of plan.tiers?.[0]?.options || []) { const g = img(o); if (g) optImg.set(up(o.text), g); }
  return {
    platform: src.platform,
    optImg,
    main: (plan.main || []).map(img).filter(Boolean),
    info: plan.info || null,
  };
}

// รายละเอียด: HTML (TikTok/Lazada) ↔ ข้อความล้วน (Shopee)
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function htmlToText(h) {
  return String(h || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
      if (ENT[e.toLowerCase()] !== undefined) return ENT[e.toLowerCase()];
      if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (/^#/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
      return m;
    })
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export function textToHtml(t) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return String(t || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');
}

// ── จับคู่ชั้นตัวเลือกต้นทาง → ปลายทาง ด้วย SKU ที่มีทั้งสองร้าน ──
// คืน { perm: [ชั้นปลายทางของชั้นต้นทางแต่ละชั้น], maps: [Map(ข้อความต้นทางตัวใหญ่ → ข้อความปลายทาง)] } หรือ { why }
function mapTiers(src, tgt, tgtOpts) {
  if (src.tiers.length !== tgt.tiers.length) return { why: `ชั้นตัวเลือกไม่เท่ากัน (ต้นทาง ${src.tiers.length} ชั้น · ร้านนี้ ${tgt.tiers.length} ชั้น)` };
  const common = src.models.filter((m) => tgtOpts.has(up(m.sku)));
  if (!common.length) return { why: 'ไม่มี SKU ที่ตรงกันเลย' };
  const perms = src.tiers.length === 1 ? [[0]] : [[0, 1], [1, 0]];
  const tryPerm = (perm) => {
    const maps = [];
    for (let ts = 0; ts < src.tiers.length; ts += 1) {
      const fwd = new Map();
      const back = new Map();
      for (const m of common) {
        const a = up(m.opts[ts]);
        const b = tgtOpts.get(up(m.sku))[perm[ts]];
        if ((fwd.has(a) && up(fwd.get(a)) !== up(b)) || (back.has(up(b)) && back.get(up(b)) !== a)) return null;
        fwd.set(a, b);
        back.set(up(b), a);
      }
      maps.push(fwd);
    }
    return { perm, maps };
  };
  const ok = perms.map(tryPerm).filter(Boolean);
  if (!ok.length) return { why: 'SKU ชุดเดียวกันใช้ตัวเลือกไม่ตรงกันระหว่างสองร้าน — จับคู่ตัวเลือกไม่ได้' };
  if (ok.length === 1) return ok[0];
  // สลับชั้นแล้วก็ยังเข้ากันได้ (เช่นทุกชั้นมีตัวเลือกเดียว) → ใช้ชื่อชั้นตัดสิน ตัดสินไม่ได้ = ไม่เดา
  const named = ok.filter((r) => r.perm.every((tt, ts) => up(tgt.tiers[tt].name) === up(src.tiers[ts])));
  if (named.length === 1) return named[0];
  return { why: 'จับคู่ชั้นตัวเลือก (สี/ไซส์) ไม่ได้ชัดเจน — SKU ที่ตรงกันน้อยเกินไป' };
}

// ไม่รวมลิงก์รูป (url) — ลิงก์ TikTok เปลี่ยนทุกครั้งที่อ่าน ใช้รหัสรูปต้นทาง (id) แทน
const sigOf = (ops) => createHash('sha1').update(JSON.stringify(ops, (k, v) => (k === 'url' ? undefined : v))).digest('hex').slice(0, 16);

// ── แปลงคำสั่งให้ตะกร้าปลายทาง (plan = ตะกร้าสดจาก *BasketPlan) ──
// imgs: { ข้อความตัวเลือกใหม่ชั้นแรก: รหัสรูปของร้านนี้ } — ผู้ใช้เลือกแทนรูปจากต้นทาง
// live: ตะกร้าต้นทางหลังแก้ (readSource) · promo: Map(model_id → ราคาโปร) ของร้านนี้
// คืน { ops: { edits, add, structure, info, main }, lines, skipped, warns, needImg, gallery, mainPrev, descPrev, why, sig, empty }
//   ops.add.add ชั้นแรกเป็น { text, image_id } หรือ { text, image_src: { id, url } รูปต้นทาง } (อัปตอนยืนยัน)
export function translate(platform, src, intent, plan, imgs = {}, live = null, promo = new Map()) {
  const P = CROSS[platform];
  const out = { ops: {}, lines: [], skipped: [], warns: [], needImg: [], gallery: [], mainPrev: null, descPrev: null, why: null, sig: null, empty: true };
  const hasOpts = Boolean(plan.hasModel && plan.tiers?.length);
  const tiers = hasOpts ? plan.tiers : [];
  const optsOf = (m) => m.tier_index.map((i, ti) => tiers[ti].options[i]?.text ?? null);
  const byS = new Map((hasOpts ? plan.models : []).filter((m) => m.sku).map((m) => [up(m.sku), m]));
  const tgtOpts = new Map([...byS].map(([k, m]) => [k, optsOf(m)]));
  const needMap = intent.add.length || intent.renames.length;
  const onlyOpts = !intent.main && !intent.title && !intent.desc;
  if (!hasOpts && onlyOpts) {
    out.why = 'ตะกร้านี้ไม่มีตัวเลือก หรือตั้งตัวเลือกแบบที่เว็บอ่านไม่ได้';
    return out;
  }
  const map = hasOpts && needMap ? mapTiers(src, plan, tgtOpts) : { why: 'ตะกร้านี้ไม่มีตัวเลือก' };

  // 1. ราคาปกติ
  const edits = [];
  for (const p of intent.prices) {
    const m = byS.get(up(p.sku));
    if (!m) { out.skipped.push(`ราคา ${p.sku}: ร้านนี้ไม่มี SKU นี้`); continue; }
    const price = P.round(p.price);
    if (Number(m.price) === price) { out.skipped.push(`ราคา ${p.sku}: ${baht(price)} อยู่แล้ว`); continue; }
    // ตรวจทีละตัว (ช่วงราคา ×0.3–×3 ของตะกร้านี้) — ตัวที่ไม่ผ่านข้ามไป ตัวอื่นยังไปต่อ
    try { checkEdits(plan.models, [{ model_id: m.model_id, price }], { label: P.label, round: P.round }); } catch (e) { out.skipped.push(`ราคา ${e.message}`); continue; }
    edits.push({ model_id: m.model_id, price });
    out.lines.push(`ราคา ${m.sku}: ${m.price === null ? '—' : baht(m.price)} → ${baht(price)}`);
    const pp = promo.get(String(m.model_id));
    if (pp !== undefined && pp !== null) {
      out.warns.push(`${m.sku} ติดโปรอยู่ (ราคาโปร ${baht(pp)}) — ราคาปกติจะเปลี่ยน แต่ราคาโปรไม่เปลี่ยน${price <= Number(pp) ? ' · ราคาปกติใหม่ไม่สูงกว่าราคาโปร แพลตฟอร์มอาจไม่ยอม' : ''}`);
    }
  }
  if (edits.length) out.ops.edits = edits;

  if (needMap && map.why) out.skipped.push(`${intent.add.length ? 'เพิ่มตัวเลือก' : 'เปลี่ยนชื่อ'}: ${map.why}`);
  else if (needMap && plan.auditing) out.skipped.push(`${intent.add.length ? 'เพิ่มตัวเลือก' : 'เปลี่ยนชื่อ'}: การแก้ครั้งก่อนของตะกร้านี้ยังรอ TikTok ตรวจ — รอผ่านก่อน`);

  // 2. เพิ่มสี/ไซส์ + SKU ใหม่
  if (intent.add.length && !map.why && !plan.auditing) {
    const { perm, maps } = map;
    const have = new Set(plan.models.map((m) => m.tier_index.join(',')));
    const newOpts = tiers.map(() => []);
    const models = [];
    for (const a of intent.add) {
      if (!a.sku) { out.skipped.push(`SKU ใหม่ ${a.opts.join(' / ')}: ไม่มีรหัส SKU — จับคู่ข้ามร้านไม่ได้`); continue; }
      if (byS.has(up(a.sku))) { out.skipped.push(`${a.sku}: ร้านนี้มีอยู่แล้ว`); continue; }
      const opts = new Array(tiers.length).fill(null);
      a.opts.forEach((text, ts) => {
        const tt = perm[ts];
        const mapped = maps[ts].get(up(text));
        const same = tiers[tt].options.find((o) => up(o.text) === up(text));
        opts[tt] = mapped ?? same?.text ?? (newOpts[tt].find((x) => up(x) === up(text)) || text);
        if (mapped === undefined && !same && !newOpts[tt].some((x) => up(x) === up(text))) newOpts[tt].push(text);
      });
      const ix = opts.map((t, tt) => tiers[tt].options.findIndex((o) => o.text === t));
      if (ix.every((i) => i >= 0) && have.has(ix.join(','))) {
        const m = plan.models.find((x) => x.tier_index.join(',') === ix.join(','));
        out.skipped.push(`${a.sku}: ร้านนี้มีคู่ ${opts.join(' / ')} อยู่แล้ว (SKU ${m?.sku || m?.model_id})`);
        continue;
      }
      models.push({ opts, sku: a.sku, price: P.round(a.price), stock: a.stock });
    }
    if (models.length) {
      // สีใหม่ของร้านที่บังคับรูป (สีเดิมมีรูปทุกตัว): รูปที่ผู้ใช้เลือกของร้านนี้ > รูปของสีนั้นจากต้นทาง (อัปตอนยืนยัน)
      const withImg = Boolean(plan.needImage);
      if (withImg && newOpts[0].length) {
        out.needImg = newOpts[0].map((text) => ({ text, image_id: imgs[text] || null, src: imgs[text] ? null : live?.optImg.get(up(text)) || null }));
        out.gallery = plan.gallery || [];
      } else if (!withImg && newOpts[0].some((t) => live?.optImg.has(up(t)))) {
        out.warns.push('สีเดิมของร้านนี้ไม่มีรูป — เพิ่มสีใหม่แบบไม่มีรูป (รูปต้องมีทุกสีหรือไม่มีเลย)');
      }
      const byText = new Map(out.needImg.map((x) => [x.text, x]));
      const imgOf = (text) => {
        const x = byText.get(text);
        if (x?.image_id) return { text, image_id: x.image_id };
        if (x?.src) return { text, image_src: x.src };
        return { text, image_id: null };
      };
      const add = tiers.map((_, tt) => newOpts[tt].map((text) => (tt === 0 && withImg ? imgOf(text) : text)));
      const missImg = out.needImg.filter((x) => !x.image_id && !x.src);
      try {
        // รูปจากต้นทาง / ที่ยังไม่มี ตรวจด้วยรหัสชั่วคราว — รูปจากต้นทางได้รหัสจริงตอนอัปก่อนเขียน
        const forCheck = tiers.map((_, tt) => newOpts[tt].map((text) => (tt === 0 && withImg ? { text, image_id: imgOf(text).image_id || 'pending-image' } : text)));
        checkAdd(tiers, plan.models, forCheck, models, { withImg, label: P.label, imgOk: (x) => x === 'pending-image' || P.imgOk(x), round: P.round });
        out.ops.add = { add, models };
        newOpts.forEach((l, tt) => { if (l.length) out.lines.push(`เพิ่ม${tiers[tt].name}: ${l.join(', ')}`); });
        out.lines.push(`SKU ใหม่ ${models.length} ตัว: ${models.slice(0, 12).map((m) => `${m.sku} (${m.opts.join(' / ')} ${baht(m.price)} คลัง ${m.stock})`).join(', ')}${models.length > 12 ? ` …และอีก ${models.length - 12}` : ''}`);
        const fromSrc = out.needImg.filter((x) => !x.image_id && x.src).map((x) => x.text);
        if (fromSrc.length) out.lines.push(`รูปสีใหม่ใช้รูปจากต้นทาง: ${fromSrc.join(', ')}`);
        if (missImg.length) out.skipped.push(`ต้องเลือกรูปของ ${missImg.map((x) => x.text).join(', ')} ก่อน (ต้นทางไม่มีรูปสีนี้ · ${P.label} บังคับรูปสีใหม่)`);
      } catch (e) {
        out.skipped.push(`เพิ่มตัวเลือก: ${e.message}`);
        out.needImg = []; out.gallery = [];   // เพิ่มไม่ได้อยู่แล้ว ไม่ต้องให้เลือกรูป
      }
    }
  }

  // 3. เปลี่ยนชื่อตัวเลือก — หาตัวเลือกของร้านนี้ที่ SKU ชุดเดียวกันใช้
  if (intent.renames.length && !map.why && !plan.auditing) {
    const { perm } = map;
    const next = tiers.map((t) => t.options.map((o) => o.text));
    const ren = [];
    for (const r of intent.renames) {
      const tt = perm[r.ti];
      const set = new Set(r.skus.map(up));
      const used = [...new Set(r.skus.map((k) => tgtOpts.get(up(k))?.[tt]).filter((x) => x !== undefined && x !== null))];
      const tag = `"${r.from}" → "${r.to}"`;
      if (!used.length) { out.skipped.push(`${tag}: ร้านนี้ไม่มี SKU ของตัวเลือกนี้`); continue; }
      if (used.length > 1) { out.skipped.push(`${tag}: SKU ชุดนี้ในร้านนี้อยู่หลายตัวเลือก (${used.join(', ')}) — ไม่เดา`); continue; }
      const k = tiers[tt].options.findIndex((o) => o.text === used[0]);
      // SKU อื่นของต้นทางที่อยู่ตัวเลือกนี้ในร้านนี้ แต่ต้นทางอยู่คนละตัวเลือก → ชื่อใหม่จะผิดกับ SKU พวกนั้น
      const clash = plan.models.filter((m) => m.tier_index[tt] === k && m.sku && !set.has(up(m.sku)) && src.models.some((s) => up(s.sku) === up(m.sku)));
      if (clash.length) { out.skipped.push(`${tag}: ตัวเลือก "${used[0]}" ของร้านนี้มี SKU อื่นปนอยู่ (${clash.slice(0, 3).map((m) => m.sku).join(', ')}) — ไม่เดา`); continue; }
      if (used[0] === r.to) { out.skipped.push(`${tag}: ร้านนี้ชื่อ "${r.to}" อยู่แล้ว`); continue; }
      if (next[tt].some((t, i) => i !== k && up(t) === up(r.to))) { out.skipped.push(`${tag}: ร้านนี้มีตัวเลือกชื่อ "${r.to}" อยู่แล้ว`); continue; }
      next[tt][k] = r.to;
      ren.push(`${tiers[tt].name}: "${used[0]}" → "${r.to}"`);
    }
    if (ren.length) {
      // โครงเดิมครบทุกตัว ลำดับเดิม เปลี่ยนแค่ชื่อ — ไม่มีการลบ
      out.ops.structure = { tiers: tiers.map((t, tt) => ({ name: t.name, options: next[tt].map((text, i) => ({ from: i, text })) })) };
      out.lines.push(...ren.map((x) => `เปลี่ยนชื่อ ${x}`));
    }
  }

  // 4. ชื่อ / รายละเอียด (ผู้ใช้ติ๊กเอง) — เอาจากต้นทางหลังแก้
  const tInfo = plan.info;
  const sInfo = live?.info;
  const tiktokWait = platform === 'tiktok' && plan.auditing;
  const info = {};
  if (intent.title) {
    const t = String(sInfo?.title || '').replace(/\s+/g, ' ').trim();
    if (!tInfo || !sInfo) out.skipped.push('ชื่อสินค้า: อ่านข้อมูลสินค้าไม่ได้');
    else if (tiktokWait) out.skipped.push('ชื่อสินค้า: การแก้ครั้งก่อนยังรอ TikTok ตรวจ');
    else if (!t) out.skipped.push('ชื่อสินค้า: ต้นทางไม่มีชื่อ');
    else if (t === String(tInfo.title || '').trim()) out.skipped.push('ชื่อสินค้า: เหมือนกันอยู่แล้ว');
    else if (t.length > tInfo.titleMax) out.skipped.push(`ชื่อสินค้า: ยาว ${t.length} ตัวอักษร เกินที่ ${P.label} รับ (${tInfo.titleMax})`);
    else {
      info.title = t;
      out.lines.push(`ชื่อ: "${short(tInfo.title || '')}" → "${short(t)}"`);
    }
  }
  if (intent.desc) {
    if (!tInfo || !sInfo) out.skipped.push('รายละเอียด: อ่านข้อมูลสินค้าไม่ได้');
    else if (tiktokWait) out.skipped.push('รายละเอียด: การแก้ครั้งก่อนยังรอ TikTok ตรวจ');
    else if (!sInfo.descEditable) out.skipped.push('รายละเอียด: ต้นทางเป็นแบบมีรูปแทรก — ส่งต่อไม่ได้');
    else if (!tInfo.descEditable) out.skipped.push('รายละเอียด: ร้านนี้เป็นแบบมีรูปแทรก — แก้จากเว็บไม่ได้');
    else {
      const raw = String(sInfo.description || '');
      let d = raw;
      let how = '';
      if (sInfo.descHtml && !tInfo.descHtml) { d = htmlToText(raw); how = ' · แปลง HTML เป็นข้อความล้วน'; }
      else if (!sInfo.descHtml && tInfo.descHtml) { d = textToHtml(raw); how = ' · แปลงข้อความเป็น HTML'; }
      d = d.trim();
      if (!d) out.skipped.push('รายละเอียด: ต้นทางว่าง');
      else if (d === String(tInfo.description || '').trim()) out.skipped.push('รายละเอียด: เหมือนกันอยู่แล้ว');
      else if (d.length > tInfo.descMax) out.skipped.push(`รายละเอียด: ยาว ${d.length} ตัวอักษร เกินที่ ${P.label} รับ (${tInfo.descMax})`);
      else {
        info.description = d;
        out.lines.push(`รายละเอียด: แทนด้วยของต้นทาง (${d.length} ตัวอักษร${how})`);
        if (sInfo.descHtml && !tInfo.descHtml && /<img/i.test(raw)) out.warns.push('รายละเอียดต้นทางมีรูปแทรก — ร้านนี้เป็นข้อความล้วน รูปในรายละเอียดจะไม่ไปด้วย');
        out.descPrev = { from: String(tInfo.description || ''), to: d, html: Boolean(tInfo.descHtml) };
      }
    }
  }
  if (info.title !== undefined || info.description !== undefined) out.ops.info = info;

  // 5. รูปสินค้า (ผู้ใช้ติ๊กเอง) — แทนทั้งชุดด้วยรูปของต้นทาง ตามลำดับ (รูปแรก = ปก) อัปเข้าแพลตฟอร์มนี้ตอนยืนยัน
  if (intent.main) {
    const max = plan.maxImages || 8;
    const urls = (live?.main || []).slice(0, max);
    if (!live) out.skipped.push('รูปสินค้า: อ่านตะกร้าต้นทางไม่ได้');
    else if (tiktokWait) out.skipped.push('รูปสินค้า: การแก้ครั้งก่อนยังรอ TikTok ตรวจ');
    else if (!urls.length) out.skipped.push('รูปสินค้า: ต้นทางไม่มีรูป');
    else {
      out.ops.main = urls;
      out.lines.push(`รูปสินค้า: แทนทั้งชุดด้วย ${urls.length} รูปจากต้นทาง (เดิม ${(plan.main || []).length} รูป)`);
      if (live.main.length > max) out.warns.push(`ต้นทางมี ${live.main.length} รูป — ${P.label} ใส่ได้ ${max} รูป ใช้ ${max} รูปแรก`);
      out.mainPrev = { from: (plan.main || []).map((x) => x.image_url).filter(Boolean), to: urls.map((g) => g.url) };
    }
  }

  out.empty = !out.ops.edits && !out.ops.add && !out.ops.structure && !out.ops.info && !out.ops.main;
  out.sig = out.empty ? null : sigOf(out.ops);
  return out;
}

async function promoOf(target) {
  const { data } = await db().from('os_listing_skus').select('sku_id, promo_price')
    .eq('platform', target.platform).eq('shop', target.shop).eq('product_id', String(target.itemId));
  return new Map((data || []).filter((r) => r.promo_price !== null).map((r) => [String(r.sku_id), r.promo_price]));
}

// รูปที่เลือกเปลี่ยน → sig เปลี่ยน → หน้าเว็บต้องขอตัวอย่างใหม่หลังเลือกรูป (ได้ sig ที่มีรูปแล้ว)
export async function previewCross(target, src, intent, imgs) {
  const P = CROSS[target.platform];
  const [plan, live, promo] = await Promise.all([P.plan(target.shop, target.itemId), readSource(src, intent), promoOf(target).catch(() => new Map())]);
  const { ops: _ops, ...t } = translate(target.platform, src, intent, plan, imgs, live, promo);
  return { title: plan.title || null, ...t };
}

// รูปจากต้นทาง (ลิงก์ที่อ่านจาก API แพลตฟอร์มต้นทาง) → อัปเข้าคลังรูปของร้านปลายทาง → รหัสรูปของร้านนั้น
async function carryImage(P, shop, url, use) {
  if (!/^https:\/\//.test(url)) throw new BasketError('ลิงก์รูปต้นทางไม่ถูกต้อง');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`โหลดรูปต้นทางไม่ได้ (${r.status})`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const type = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
    : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? 'image/png' : null;
  if (!type) throw new BasketError('รูปต้นทางไม่ใช่ JPG/PNG (เช่น webp) — อัปรูปเองในร้านนี้');
  if (bytes.length > 4 * 1024 * 1024) throw new BasketError('รูปต้นทางใหญ่เกิน 4MB — อัปรูปเองในร้านนี้');
  return P.upload(shop, bytes, type, use);
}

// ── เขียนลงร้านปลายทาง — ต้องตรงกับตัวอย่างที่ผู้ใช้เห็น (sig) ──
export async function applyCross(target, src, intent, imgs, sig) {
  const P = CROSS[target.platform];
  const [plan, live] = await Promise.all([P.plan(target.shop, target.itemId), readSource(src, intent)]);
  const t = translate(target.platform, src, intent, plan, imgs, live);
  if (t.empty) throw new BasketError('ไม่มีอะไรให้เปลี่ยนในร้านนี้แล้ว');
  if (t.sig !== sig) throw new BasketError('ตะกร้าร้านนี้ (หรือต้นทาง) เปลี่ยนไปหลังดูตัวอย่าง — กดดูตัวอย่างใหม่ก่อน');
  if (t.needImg.some((x) => !x.image_id && !x.src)) throw new BasketError('ยังเลือกรูปของสีใหม่ไม่ครบ');
  const base = { shop: target.shop, itemId: target.itemId };
  const done = [];
  const warnings = [];
  const step = async (name, fn) => {
    try {
      const r = await fn();
      warnings.push(...(r?.warnings || []));
      return r;
    } catch (e) {
      e.message = done.length ? `${name}ไม่สำเร็จ: ${e.message} (ทำไปแล้ว: ${done.join(' · ')})` : `${name}ไม่สำเร็จ: ${e.message}`;
      throw e;
    }
  };
  if (t.ops.edits) {
    const r = await step('แก้ราคา', () => P.edit({ ...base, edits: t.ops.edits }));
    done.push(`แก้ราคา ${r.changed?.length ?? r.changed ?? t.ops.edits.length} SKU`);
  }
  if (t.ops.add) {
    const add = await step('อัปรูปสีใหม่', async () => Promise.all(t.ops.add.add.map((l) => Promise.all(l.map(async (o) => {
      if (typeof o !== 'object' || !o.image_src) return o;
      try { return { text: o.text, image_id: await carryImage(P, target.shop, o.image_src.url, 'option') }; } catch (e) { e.message = `รูปของ ${o.text}: ${e.message}`; throw e; }
    })))));
    const r = await step('เพิ่ม SKU', () => P.add({ ...base, add, models: t.ops.add.models }));
    done.push(`เพิ่ม ${r.added?.length ?? t.ops.add.models.length} SKU`);
  }
  if (t.ops.structure) {
    await step('เปลี่ยนชื่อตัวเลือก', () => P.structure({ ...base, tiers: t.ops.structure.tiers, del: [] }));
    done.push('เปลี่ยนชื่อตัวเลือก');
  }
  if (t.ops.info) {
    await step('แก้ชื่อ/รายละเอียด', () => P.info({ ...base, title: t.ops.info.title ?? null, description: t.ops.info.description ?? null, category: null }));
    done.push([t.ops.info.title !== undefined && 'ชื่อ', t.ops.info.description !== undefined && 'รายละเอียด'].filter(Boolean).join('+'));
  }
  if (t.ops.main) {
    const ids = await step('อัปรูปสินค้า', () => Promise.all(t.ops.main.map((g) => carryImage(P, target.shop, g.url, 'main'))));
    // แพลตฟอร์มจำรูปซ้ำได้ (Lazada อัปรูปเดิมคืนลิงก์เดิม) → ได้ชุดเดิมทุกรูป = เหมือนอยู่แล้ว ไม่ใช่ข้อผิดพลาด
    if (ids.join('\u0001') === (plan.main || []).map((x) => x.image_id).join('\u0001')) done.push('รูปสินค้าเหมือนต้นทางอยู่แล้ว');
    else {
      await step('เปลี่ยนรูปสินค้า', () => P.images({ ...base, main: ids, options: null }));
      done.push(`รูปสินค้า ${ids.length} รูป`);
    }
  }
  return { done, warnings };
}
