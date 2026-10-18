// แก้พร้อมกันทุกร้าน — แก้ตะกร้าหนึ่งเสร็จ แล้วกดใช้กับตะกร้าเดียวกันในร้านอื่น (หน้าแก้ไขสินค้า app/product/CrossShop.js)
//
// ตะกร้าปลายทาง = ตะกร้า Shopee/TikTok/Lazada ในร้านอื่น (ทุกกลุ่ม SOLID/REAL/MVP) ที่มีเลข SKU ร้านตรงกับตะกร้าต้นทาง ≥3 ตัวหรือ ≥ครึ่ง
//   (os_listing_skus — แบบเดียวกับ lib/basket.js siblingSuggest แต่ไม่จำกัดกลุ่มร้าน เพราะร้านต่างกลุ่มก็ลงตะกร้าเดียวกัน)
//
// คำสั่งที่ส่งต่อได้ (intent) — อ้างด้วยเลข SKU ร้าน (ตัวพิมพ์ไม่สนใจ) ไม่ใช่ model_id / ลำดับตัวเลือก เพราะข้ามร้านไม่ตรงกัน:
//   prices:  [{ sku, price }]                              ราคาปกติของ SKU เดิม
//   add:     [{ sku, opts: [ข้อความต่อชั้นของต้นทาง], price, stock }]   SKU ใหม่ (รวมตัวเลือกสี/ไซส์ใหม่)
//   renames: [{ ti, from, to, skus: [SKU ที่ใช้ตัวเลือกนี้] }]   เปลี่ยนชื่อตัวเลือก (ti = ชั้นของต้นทาง)
// src = ภาพตะกร้าต้นทาง "ก่อนแก้" { platform, shop, itemId, tiers: [ชื่อชั้น], models: [{ sku, opts }] } — ใช้จับคู่ชั้น/ตัวเลือกข้ามร้าน
//
// แปลงต่อร้าน (translate) กับตะกร้าสดของร้านนั้น:
//   ชั้น: ลองสลับชั้น (สี/ไซส์ อาจอยู่คนละลำดับ) เลือกแบบที่ SKU ชุดเดียวกันใช้ตัวเลือกตรงกันแบบหนึ่งต่อหนึ่ง — กำกวม/ขัดกัน = ไม่แปลง
//   ตัวเลือก: ข้อความต้นทาง → ข้อความของร้านนี้ จาก SKU ที่มีทั้งสองร้าน · ไม่มีคู่ = ข้อความเดียวกัน (ตัวเลือกใหม่ของร้านนี้)
//   ส่วนที่แปลงไม่ได้ → บอกเหตุผลแล้วข้าม ไม่เดา · ตรวจซ้ำด้วยตัวตรวจของแพลตฟอร์ม (checkAdd / checkEdits) ก่อนให้ดูตัวอย่าง
// ยืนยัน (applyCross): อ่านตะกร้าสดอีกรอบ แปลงใหม่ ต้องได้ผลเหมือนตัวอย่างที่ผู้ใช้เห็น (sig) ไม่งั้นไม่เขียน
//   เขียนผ่านฟังก์ชันเดิมของแต่ละแพลตฟอร์ม (*EditModels / *AddOptions / *SetStructure) ซึ่งอ่านตะกร้าสดและตรวจซ้ำอีกชั้น
import { createHash } from 'node:crypto';
import { db } from './supabase.js';
import { shopeeShops, lazadaShops, tiktokShops } from './discounts.js';
import { BasketError, checkAdd, checkEdits, shopeeBasketPlan, shopeeAddOptions, shopeeEditModels, shopeeSetStructure } from './basket.js';
import { lazadaBasketPlan, lazadaAddOptions, lazadaEditModels, lazadaSetStructure } from './basketLazada.js';
import { tiktokBasketPlan, tiktokAddOptions, tiktokEditModels, tiktokSetStructure } from './basketTiktok.js';

const up = (s) => String(s ?? '').trim().toUpperCase();
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const baht = (n) => '฿' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const CROSS = {
  shopee: { label: 'Shopee', shops: shopeeShops, plan: shopeeBasketPlan, add: shopeeAddOptions, edit: shopeeEditModels, structure: shopeeSetStructure, round: Math.round, imgOk: (x) => /^[\w-]{6,80}$/.test(x) },
  tiktok: { label: 'TikTok', shops: tiktokShops, plan: tiktokBasketPlan, add: tiktokAddOptions, edit: tiktokEditModels, structure: tiktokSetStructure, round: (x) => Math.round(x * 100) / 100, imgOk: (x) => /^[\w.~/-]{6,400}$/.test(x) },
  lazada: { label: 'Lazada', shops: lazadaShops, plan: lazadaBasketPlan, add: lazadaAddOptions, edit: lazadaEditModels, structure: lazadaSetStructure, round: (x) => Math.round(x * 100) / 100, imgOk: (x) => /^https:\/\/[^\s"'<>]{8,600}$/.test(x) },
};

// ── ตะกร้าเดียวกันในร้านอื่น ──
export async function crossTargets(platform, shop, itemId) {
  const { data: mine, error } = await db().from('os_listing_skus').select('seller_sku')
    .eq('platform', platform).eq('shop', shop).eq('product_id', String(itemId));
  if (error) throw new Error(error.message);
  const skus = [...new Set((mine || []).map((r) => r.seller_sku).filter(Boolean))];
  if (!skus.length) return [];
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
  if (!tiers || !tiers.length || tiers.length > 2 || !models || models.length > 1000) throw new BasketError('ข้อมูลตะกร้าต้นทางไม่ถูกต้อง');
  const s = {
    tiers,
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
  if (prices.length > 200 || add.length > 200 || renames.length > 50) throw new BasketError('คำสั่งเยอะเกิน — ทำทีละน้อยลง');
  if (add.some((x) => x.opts.length !== tiers.length)) throw new BasketError('ตัวเลือกของ SKU ใหม่ไม่ครบทุกชั้น');
  if (renames.some((x) => !Number.isInteger(x.ti) || x.ti < 0 || x.ti >= tiers.length || !x.from || !x.to)) throw new BasketError('คำสั่งเปลี่ยนชื่อไม่ถูกต้อง');
  // เปลี่ยนชื่อ = ส่งโครงตัวเลือกทั้งชุด → ห้ามรวมกับเพิ่มตัวเลือกในรอบเดียว (โครงที่อ่านก่อนเพิ่มจะลบของที่เพิ่งเพิ่ม)
  if (renames.length && add.length) throw new BasketError('เปลี่ยนชื่อตัวเลือกกับเพิ่มตัวเลือกต้องส่งต่อแยกรอบกัน');
  if (!prices.length && !add.length && !renames.length) throw new BasketError('ไม่มีอะไรให้ส่งต่อ');
  return { src: s, intent: { prices, add, renames } };
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

const sigOf = (ops) => createHash('sha1').update(JSON.stringify(ops)).digest('hex').slice(0, 16);

// ── แปลงคำสั่งให้ตะกร้าปลายทาง (plan = ตะกร้าสดจาก *BasketPlan) ──
// imgs: { ข้อความตัวเลือกใหม่ชั้นแรก: รหัสรูปของร้านนี้ } (ร้านที่บังคับรูปสีใหม่)
// คืน { ops: { edits, add, structure }, lines, skipped, needImg, gallery, why, sig, empty }
export function translate(platform, src, intent, plan, imgs = {}) {
  const P = CROSS[platform];
  const out = { ops: {}, lines: [], skipped: [], needImg: [], gallery: [], why: null, sig: null, empty: true };
  const say = (why) => { out.why = why; return out; };
  if (!plan.hasModel || !plan.tiers.length) return say('ตะกร้านี้ไม่มีตัวเลือก หรือตั้งตัวเลือกแบบที่เว็บอ่านไม่ได้');
  const tiers = plan.tiers;
  const optsOf = (m) => m.tier_index.map((i, ti) => tiers[ti].options[i]?.text ?? null);
  const byS = new Map(plan.models.filter((m) => m.sku).map((m) => [up(m.sku), m]));
  const tgtOpts = new Map([...byS].map(([k, m]) => [k, optsOf(m)]));
  const map = mapTiers(src, plan, tgtOpts);

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
  }
  if (edits.length) out.ops.edits = edits;

  const needMap = intent.add.length || intent.renames.length;
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
      // ตัวเลือกใหม่ชั้นแรกของร้านที่บังคับรูป → ผู้ใช้เลือกรูปจากรูปของตะกร้านั้น (รหัสรูปข้ามร้าน/ข้ามแพลตฟอร์มใช้ไม่ได้)
      const withImg = Boolean(plan.needImage);
      if (withImg && newOpts[0].length) {
        out.needImg = newOpts[0].map((text) => ({ text, image_id: imgs[text] || null }));
        out.gallery = plan.gallery || [];
      }
      const add = tiers.map((_, tt) => newOpts[tt].map((text) => (tt === 0 && withImg ? { text, image_id: imgs[text] || null } : text)));
      const missImg = out.needImg.filter((x) => !x.image_id);
      try {
        if (missImg.length) {
          // ตรวจส่วนอื่นก่อนด้วยรูปชั่วคราว — ยังเขียนไม่ได้จนกว่าจะเลือกรูปครบ
          checkAdd(tiers, plan.models, tiers.map((_, tt) => newOpts[tt].map((text) => (tt === 0 ? { text, image_id: imgs[text] || 'pending-image' } : text))), models,
            { withImg, label: P.label, imgOk: () => true, round: P.round });
        } else {
          checkAdd(tiers, plan.models, add, models, { withImg, label: P.label, imgOk: P.imgOk, round: P.round });
        }
        out.ops.add = { add, models };
        newOpts.forEach((l, tt) => { if (l.length) out.lines.push(`เพิ่ม${tiers[tt].name}: ${l.join(', ')}`); });
        out.lines.push(`SKU ใหม่ ${models.length} ตัว: ${models.slice(0, 12).map((m) => `${m.sku} (${m.opts.join(' / ')} ${baht(m.price)} คลัง ${m.stock})`).join(', ')}${models.length > 12 ? ` …และอีก ${models.length - 12}` : ''}`);
        if (missImg.length) out.skipped.push(`ต้องเลือกรูปของ ${missImg.map((x) => x.text).join(', ')} ก่อน (${P.label} บังคับรูปสีใหม่)`);
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

  out.empty = !out.ops.edits && !out.ops.add && !out.ops.structure;
  out.sig = out.empty ? null : sigOf(out.ops);
  return out;
}

// รูปที่เลือกเปลี่ยน → sig เปลี่ยน → หน้าเว็บต้องขอตัวอย่างใหม่หลังเลือกรูป (ได้ sig ที่มีรูปแล้ว)
export async function previewCross(target, src, intent, imgs) {
  const P = CROSS[target.platform];
  const plan = await P.plan(target.shop, target.itemId);
  const { ops: _ops, ...t } = translate(target.platform, src, intent, plan, imgs);
  return { title: plan.title || null, ...t };
}

// ── เขียนลงร้านปลายทาง — ต้องตรงกับตัวอย่างที่ผู้ใช้เห็น (sig) ──
export async function applyCross(target, src, intent, imgs, sig) {
  const P = CROSS[target.platform];
  const plan = await P.plan(target.shop, target.itemId);
  const t = translate(target.platform, src, intent, plan, imgs);
  if (t.empty) throw new BasketError('ไม่มีอะไรให้เปลี่ยนในร้านนี้แล้ว');
  if (t.sig !== sig) throw new BasketError('ตะกร้าร้านนี้เปลี่ยนไปหลังดูตัวอย่าง — กดดูตัวอย่างใหม่ก่อน');
  if (t.needImg.some((x) => !x.image_id)) throw new BasketError('ยังเลือกรูปของสีใหม่ไม่ครบ');
  const base = { shop: target.shop, itemId: target.itemId };
  const done = [];
  const warnings = [];
  const step = async (name, fn) => {
    try {
      const r = await fn();
      warnings.push(...(r.warnings || []));
      return r;
    } catch (e) {
      e.message = done.length ? `${name}ไม่สำเร็จ: ${e.message} (ทำไปแล้ว: ${done.join(' · ')})` : `${name}ไม่สำเร็จ: ${e.message}`;
      throw e;
    }
  };
  if (t.ops.edits) {
    const r = await step('แก้ราคา', () => P.edit({ ...base, edits: t.ops.edits }));
    done.push(`แก้ราคา ${r.changed} SKU`);
  }
  if (t.ops.add) {
    const r = await step('เพิ่ม SKU', () => P.add({ ...base, add: t.ops.add.add, models: t.ops.add.models }));
    done.push(`เพิ่ม ${r.added?.length ?? t.ops.add.models.length} SKU`);
  }
  if (t.ops.structure) {
    await step('เปลี่ยนชื่อตัวเลือก', () => P.structure({ ...base, tiers: t.ops.structure.tiers, del: [] }));
    done.push('เปลี่ยนชื่อตัวเลือก');
  }
  return { done, warnings };
}
