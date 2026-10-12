// TikTok SOLID → Thaimart: สร้างไฟล์นำเข้า (Excel) ให้ตะกร้าที่ Thaimart ยังไม่มี — ผู้ใช้อัปโหลดเองที่ seller.thaimart.com
//
// กฎ (ดู memory never-recreate-baskets): สร้างเฉพาะตะกร้าที่ Thaimart "ยังไม่มี SKU ไหนเลย" (ทุกสถานะ)
// ไม่แตะตะกร้าที่มีอยู่แล้ว — ตรวจซ้ำตอนสร้างไฟล์ ไม่เชื่อรายการที่หน้าเว็บส่งมาอย่างเดียว
// สต็อก = Seniorsoft (os_st) ถ้ารหัสนั้นไม่อยู่ใน ST ใช้จำนวนบน TikTok · ราคา = ราคาขายบน TikTok
import { db } from './supabase.js';
import * as tiktok from './tiktok.js';
import { listShops, usableToken } from './tokens.js';
import { inListingTab } from './listings.js';
import { fromTikTok } from './productModel.js';
import { buildThaimartRows, thaimartCategory, MAX_ROWS } from './thaimartRows.js';
import { appendRows, b64ToBytes, bytesToB64 } from './xlsxPatch.js';
import { TEMPLATES } from './thaimartTemplates.js';

const SRC_SHOP = 'SOLID';
const MAX_IDS = 150;
const low = (s) => String(s || '').trim().toLowerCase();
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// อ่านทั้งตารางแบบขนาน (คำขอแรกขอจำนวนรวม แล้วยิงหน้าที่เหลือพร้อมกัน)
async function selectAllFast(make) {
  const first = await make(0, 999);
  if (first.error) throw first.error;
  const rows = first.data || [];
  const total = first.count || rows.length;
  const jobs = [];
  for (let from = 1000; from < total; from += 1000) jobs.push(make(from, from + 999));
  for (const r of await Promise.all(jobs)) {
    if (r.error) throw r.error;
    rows.push(...(r.data || []));
  }
  return rows;
}

// ตะกร้า TikTok SOLID ที่ขายอยู่ และไม่มี SKU ไหนเลยใน Thaimart
export async function thaimartCandidates() {
  const sb = db();
  const [ttList, ttSkus, tmSkus] = await Promise.all([
    selectAllFast((a, b) => sb.from('os_listings').select('product_id, title, status, thumb_url', { count: 'exact' })
      .eq('platform', 'tiktok').eq('shop', SRC_SHOP).order('product_id').range(a, b)),
    selectAllFast((a, b) => sb.from('os_listing_skus').select('product_id, seller_sku', { count: 'exact' })
      .eq('platform', 'tiktok').eq('shop', SRC_SHOP).order('sku_id').range(a, b)),
    selectAllFast((a, b) => sb.from('os_listing_skus').select('seller_sku', { count: 'exact' })
      .eq('platform', 'thaimart').order('sku_id').range(a, b)),
  ]);
  const onThaimart = new Set(tmSkus.map((r) => low(r.seller_sku)).filter(Boolean));
  const skus = new Map();
  for (const r of ttSkus) {
    const k = low(r.seller_sku);
    if (!k) continue;
    if (!skus.has(r.product_id)) skus.set(r.product_id, new Set());
    skus.get(r.product_id).add(k);
  }
  return ttList
    .filter((l) => inListingTab({ status: l.status }, 'live'))
    .filter((l) => skus.get(l.product_id)?.size && ![...skus.get(l.product_id)].some((k) => onThaimart.has(k)))
    .map((l) => ({ id: l.product_id, title: l.title, thumb: l.thumb_url, n: skus.get(l.product_id).size }))
    .sort((a, b) => String(a.title).localeCompare(String(b.title), 'th'));
}

async function pool(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  }));
  return out;
}

// อ่านตะกร้า TikTok → แถวนำเข้า Thaimart ต่อหมวด (ใช้ทั้งไฟล์ Excel และการส่งตรงผ่านส่วนขยาย)
// คืน { byCat: Map(หมวด → [{ id, title, rows }]), skipped, warnings }
async function prepareRows(ids) {
  const want = [...new Set((ids || []).map(String))].slice(0, MAX_IDS);
  if (!want.length) throw new Error('ยังไม่ได้เลือกตะกร้า');

  // ตรวจซ้ำ: เอาเฉพาะตะกร้าที่ยังไม่มีใน Thaimart จริง ณ ตอนนี้
  const cand = new Map((await thaimartCandidates()).map((c) => [c.id, c]));
  const skipped = want.filter((id) => !cand.has(id)).map((id) => ({ id, title: '', why: 'มีใน Thaimart แล้ว หรือไม่ได้ขายอยู่ใน TikTok — ข้าม (ไม่แตะตะกร้าเดิม)' }));
  const todo = want.filter((id) => cand.has(id));

  const row = (await listShops('tiktok')).find((r) => r.shop === SRC_SHOP);
  if (!row) throw new Error('ไม่พบโทเคนของ TikTok SOLID');
  const tok = await usableToken(row);
  const auth = { accessToken: tok.access_token, shopCipher: tok.shop_cipher };

  const products = await pool(todo, 6, async (id) => {
    try {
      return fromTikTok(await tiktok.getProduct({ ...auth, productId: id }), SRC_SHOP);
    } catch (e) {
      skipped.push({ id, title: cand.get(id)?.title || '', why: `อ่านจาก TikTok ไม่ได้: ${String(e.message || e).slice(0, 120)}` });
      return null;
    }
  });

  // สต็อก Seniorsoft ของทุก SKU (เทียบแบบตัวพิมพ์เล็ก)
  const allSkus = [...new Set(products.filter(Boolean).flatMap((p) => p.variants.map((v) => v.sku)).filter(Boolean))];
  const forms = [...new Set(allSkus.flatMap((s) => [s, s.toLowerCase(), s.toUpperCase()]))];
  const stockBySku = new Map();
  for (const c of chunks(forms, 300)) {
    const { data, error } = await db().from('os_st').select('sku, qty').in('sku', c);
    if (error) throw new Error(error.message);
    for (const r of data || []) stockBySku.set(low(r.sku), Math.max(0, Number(r.qty) || 0));
  }

  const byCat = new Map();
  const warnings = [];
  for (const p of products) {
    if (!p) continue;
    const cat = thaimartCategory(p.categoryChain);
    const tpl = TEMPLATES[cat];
    if (!tpl) {
      skipped.push({ id: p.source.id, title: p.title, why: `หมวด "${p.categoryChain.slice(-1)[0] || cat}" ยังไม่มีเทมเพลต Thaimart (ออกกำลังกาย/ตกปลา) — ทำมือ` });
      continue;
    }
    const r = buildThaimartRows(p, { categoryPath: tpl.path, stockBySku });
    if (r.skipped) { skipped.push({ id: p.source.id, title: p.title, why: r.skipped }); continue; }
    if (r.rows.length > MAX_ROWS) { skipped.push({ id: p.source.id, title: p.title, why: `ตัวเลือกเกิน ${MAX_ROWS} แถว` }); continue; }
    if (r.warnings.length) warnings.push({ id: p.source.id, title: p.title, notes: r.warnings });
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push({ id: p.source.id, title: p.title, rows: r.rows });
  }
  return { byCat, skipped, warnings };
}

// สร้างไฟล์นำเข้า — คืน { files: [{ name, cat, label, baskets, rows, b64 }], skipped: [{ id, title, why }], warnings: [{ id, title, notes }] }
export async function buildThaimartFiles(ids) {
  const { byCat, skipped, warnings } = await prepareRows(ids);

  // 1 ไฟล์ = 1 หมวด ≤500 แถว ไม่ตัดกลางตะกร้า
  const files = [];
  const stamp = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  for (const [cat, list] of byCat) {
    let cur = [];
    let part = 1;
    const flush = async () => {
      if (!cur.length) return;
      const rows = cur.flatMap((x) => x.rows);
      const bytes = await appendRows(b64ToBytes(TEMPLATES[cat].b64), rows);
      files.push({
        name: `thaimart-${cat}-${stamp}-${part}.xlsx`, cat, label: TEMPLATES[cat].label,
        baskets: cur.length, ids: cur.map((x) => x.id), rows: rows.length, b64: bytesToB64(bytes),
      });
      part += 1;
      cur = [];
    };
    for (const b of list) {
      if (cur.reduce((s, x) => s + x.rows.length, 0) + b.rows.length > MAX_ROWS) await flush();
      cur.push(b);
    }
    await flush();
  }
  return { files, skipped, warnings };
}

// ── ส่งตรงเข้า Thaimart ผ่านส่วนขยาย Chrome (extensions/thaimart-stock) ──
// หน้า "อัปโหลดสินค้า (Excel)" ของ Thaimart อ่านไฟล์ในเบราว์เซอร์แล้วส่ง JSON ไป POST /v1/seller/products/batch { products }
// ส่วนขยายส่งก้อนเดียวกันจากแท็บที่ล็อกอินค้างไว้ — ฝั่งนี้แค่เตรียมก้อน (ไม่ได้ถือโทเคน Thaimart)
// แปลงจากแถวไฟล์นำเข้าเดิม ตามที่หน้าเว็บของ Thaimart แปลง (แกะจาก assets/upload-*.js ต.ค. 2569)
// categoryPath ต้องเป็นรายการ { id, code, name, level } ตามหมวดที่เลือก (อ่านจากสินค้าที่ลงไว้แล้ว)
export const THAIMART_CATEGORY_PATH = {
  shoes: [
    { id: '6a831ad1dd9445e29685aec9', code: 'sports_outdoors', name: 'กีฬาและกิจกรรม', level: 1 },
    { id: '6a831ad2dd9445e29685aecf', code: 'sports_equipment', name: 'อุปกรณ์กีฬา', level: 2 },
    { id: '6a831ad4dd9445e29685af08', code: 'sportswear', name: 'รองเท้ากีฬา / เสื้อผ้ากีฬา', level: 3 },
  ],
  balls: [
    { id: '6a831ad1dd9445e29685aec9', code: 'sports_outdoors', name: 'กีฬาและกิจกรรม', level: 1 },
    { id: '6a831ad2dd9445e29685aecf', code: 'sports_equipment', name: 'อุปกรณ์กีฬา', level: 2 },
    { id: '6a831ad4dd9445e29685af05', code: 'sports_accessories', name: 'ลูกฟุตบอล / ถุงเท้ากีฬา / อุปกรณ์กีฬา', level: 3 },
  ],
};

// แถว (คอลัมน์ A–X ของ thaimartRows.js) ของตะกร้าเดียว → ก้อนสินค้าแบบที่หน้าเว็บ Thaimart ส่ง
// test: ชื่อขึ้นต้น [TEST] · SKU ต่อท้าย -TEST · จำนวน 0 (สถานะยังไม่วางขายอยู่แล้ว)
export function rowsToThaimartProduct(rows, cat, { test = false } = {}) {
  const r0 = rows[0];
  const uniq = (a) => [...new Set(a.filter((x) => x !== ''))];
  const num = (x) => Math.max(0, Math.round(Number(x) || 0));
  const dims = (r) => ({ width: num(r[20]), height: num(r[21]), length: num(r[19]) });
  const name1 = r0[13] || 'ตัวเลือก';
  const name2 = r0[16] || '';
  const v1 = uniq(rows.map((r) => r[14]));
  const valueImages = v1.map((v) => {
    const r = rows.find((x) => x[14] === v && x[15]);
    return r ? { value: v, image: { id: '', url: r[15] } } : null;
  }).filter(Boolean);
  const options = [{ key: name1, values: v1, ...(valueImages.length ? { valueImages } : {}) }];
  if (name2) options.push({ key: name2, values: uniq(rows.map((r) => r[17])) });
  const skuOf = (s) => (s ? `${s}${test ? '-TEST' : ''}` : '');
  const variants = rows.map((r) => {
    const q = test ? 0 : num(r[23]);
    const attributes = [{ key: name1, value: r[14] }];
    if (name2 && r[17] !== '') attributes.push({ key: name2, value: r[17] });
    return { sku: skuOf(r[12]), price: String(num(r[22])), quantity: q, remainingQuantity: q, weight: num(r[18]), dimensions: dims(r), attributes };
  });
  return {
    status: 'PRODUCT_STATUS_ARCHIVED',
    name: test ? `[TEST] ลบได้ ${r0[1]}`.slice(0, 250) : r0[1],
    description: r0[2],
    categoryPath: THAIMART_CATEGORY_PATH[cat],
    requiredCompliances: [],
    images: r0.slice(3, 12).filter(Boolean).map((url) => ({ id: '', url })),
    ...(r0[12] ? { sku: skuOf(r0[12]) } : {}),
    quantity: variants[0].quantity,
    weight: num(r0[18]),
    dimensions: dims(r0),
    options,
    variants,
  };
}

// คืน { products: [{ id, title, cat, product }], skipped, warnings } — ส่วนขยายเติม shopId แล้วส่งเข้า Thaimart
export async function buildThaimartProducts(ids, { test = false } = {}) {
  const { byCat, skipped, warnings } = await prepareRows(ids);
  const products = [];
  for (const [cat, list] of byCat) {
    if (!THAIMART_CATEGORY_PATH[cat]) {
      for (const b of list) skipped.push({ id: b.id, title: b.title, why: `ยังไม่รู้หมวด ${cat} ของ Thaimart` });
      continue;
    }
    for (const b of list) products.push({ id: b.id, title: b.title, cat, product: rowsToThaimartProduct(b.rows, cat, { test }) });
  }
  return { products, skipped, warnings };
}
