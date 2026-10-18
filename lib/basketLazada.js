// แก้ตะกร้า Lazada ที่มีอยู่แล้ว: เพิ่มตัวเลือก (สี/ไซส์) + SKU ใหม่ — หน้าแก้ไขสินค้า (/product/lazada/[shop]/[id]/edit)
// ตรรกะเดาสี/ไซส์/รหัสจาก ST และการตรวจข้อมูลใช้ร่วมกับ Shopee (lib/basket.js addStPlan, checkAdd)
//
// ส่องจริงกับสินค้า [TEST] (2026-10-17 SOLID):
//   - /product/update เพิ่ม SKU ไม่ได้ (บังคับ SkuId ทุกตัว แม้ส่ง SKU เดิมครบ)
//   - ทางที่ใช้ได้: /product/create + AssociatedSku = SkuId ของ SKU เดิมในตะกร้า → SKU ใหม่เข้าตะกร้าเดิม
//     ต้องส่ง variation ครบทุกตัวเลือก (เดิม + ใหม่) รูปแบบ { Variation1: { name, hasImage, customize, options: { option: [...] } } }
//     (คีย์ "variation" ตัวเล็ก · options ห่อ option — แบบ Variation/options[] ได้ VARIATION_SALEPROP_ATTRIBUTE_INVALID)
//   - ตะกร้ายัง Active · SKU เดิม + SkuId ไม่เปลี่ยน · ไม่ต้องรอตรวจ
import * as lazada from './lazada.js';
import { listShops, storedToken } from './tokens.js';
import { db } from './supabase.js';
import { saveListings } from './listings.js';
import { shopGroup } from './shopGroups.js';
import { markCompareStale } from './compareSnap.js';
import { BasketError, addStPlan, checkAdd, checkImages, checkEdits, checkInfo, checkStructure, withSiblings } from './basket.js';

// ชื่อ/รายละเอียด (HTML)/หมวด — หมวดเปลี่ยนจากเว็บไม่ได้ (Lazada ไม่ให้ย้ายหมวดตะกร้าที่สร้างแล้วผ่าน API)
const infoOf = (it) => ({
  title: it.attributes?.name || '', titleMax: 255,
  description: it.attributes?.description || '', descEditable: true, descHtml: true, descMax: 25000,
  category: { id: it.primary_category ?? null, path: null, editable: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// รูปของ Lazada อ้างด้วย URL — รูปที่ตะกร้ามีอยู่แล้ว หรือที่อัปจากเครื่องผ่าน lazadaUploadImage (url คลังรูป Lazada)
const urlOk = (x) => /^https:\/\/[^\s"'<>]{8,600}$/.test(x);
const VARS = ['Variation1', 'Variation2'];

async function lzAuth(shop) {
  const row = (await listShops('lazada')).find((r) => r.shop === shop);
  if (!row) throw new BasketError(`ร้าน Lazada ${shop} ยังไม่ได้เชื่อม API`);
  return { accessToken: storedToken(row).access_token };
}

// Lazada แบนสั้นๆ เมื่อยิงถี่ (ApiCallLimit) — คำขอที่โดนแบนไม่ถูกทำ ส่งซ้ำได้
async function retry(fn, tries = 4) {
  for (let i = 1; ; i += 1) {
    try { return await fn(); } catch (e) {
      if (i >= tries || !/ApiCallLimit/.test(String(e.message))) throw e;
      await sleep(1500 * i);
    }
  }
}

// ตะกร้าสด → รูปแบบเดียวกับ Shopee: tiers [{ name, options: [{ text, image_id, image_url }] }] · models [{ model_id, tier_index, sku, price, stock }]
// รูปของ Lazada เป็น URL (ไม่มีรหัสรูป) → image_id = URL
async function readItem(auth, itemId) {
  const it = await retry(() => lazada.getProductItem({ ...auth, itemId }));
  if (!it) throw new BasketError('ไม่พบตะกร้านี้ใน Lazada');
  const vs = VARS.map((k) => it.variation?.[k]).filter(Boolean);
  const tiers = vs.map((v) => ({ name: v.name, hasImage: Boolean(v.hasImage), options: (v.options || []).map((text) => ({ text: String(text), image_id: null, image_url: null })) }));
  const models = (it.skus || []).map((s) => ({
    model_id: String(s.SkuId),
    tier_index: tiers.map((t) => t.options.findIndex((o) => o.text === String(s.saleProp?.[t.name] ?? ''))),
    sku: s.SellerSku || '',
    price: s.price ?? null,
    stock: s.quantity ?? null,
    image: (s.Images || [])[0] || null,
  }));
  // รูปของตัวเลือกชั้นแรก = รูปแรกของ SKU ที่ใช้ตัวเลือกนั้น
  if (tiers[0]) for (const m of models) { const o = tiers[0].options[m.tier_index[0]]; if (o && !o.image_url && m.image) { o.image_url = m.image; o.image_id = m.image; } }
  return { it, tiers, models };
}

// SKU เรียงตามลำดับตัวเลือกเดิม (tier_index) — /product/item/get คืน SKU ไม่ตรงลำดับตัวเลือก
// แต่ /product/update จัดลำดับตัวเลือกบนหน้าร้านใหม่ตามลำดับ SKU ที่ส่ง (เจอกับ [TEST] 2026-10-18) → ส่ง Skus ต้องผ่านตัวนี้เสมอ
const byOptionOrder = (models) => [...models].sort((a, b) => {
  for (let ti = 0; ti < a.tier_index.length; ti += 1) if (a.tier_index[ti] !== b.tier_index[ti]) return a.tier_index[ti] - b.tier_index[ti];
  return 0;
});

export async function lazadaBasketPlan(shop, itemId) {
  const auth = await lzAuth(shop);
  const { it, tiers, models } = await readItem(auth, itemId);
  const bad = models.some((m) => m.tier_index.some((i) => i < 0));
  const gallery = [...new Map([...(it.images || []), ...models.map((m) => m.image)].filter(Boolean).map((u) => [u, { image_id: u, image_url: u }])).values()];
  const out = {
    itemId: String(itemId), title: it.attributes?.name || null, status: it.status || null,
    // ไม่มี variation (ตะกร้ารุ่นเก่าตั้งตัวเลือกด้วยแอตทริบิวต์) หรือ SKU จับคู่ตัวเลือกไม่ได้ → เพิ่มจากเว็บไม่ได้
    hasModel: tiers.length > 0 && !bad,
    tiers: tiers.map((t) => ({ name: t.name, options: t.options })),
    needImage: Boolean(tiers[0]?.hasImage),
    gallery,
    main: (it.images || []).filter(Boolean).map((u) => ({ image_id: u, image_url: u })),
    maxImages: 8,
    // Lazada เปลี่ยนรหัส SellerSku ของ SKU เดิมไม่ได้ — แก้ได้แค่ราคา
    skuEditable: false,
    models: models.map(({ model_id, tier_index, sku, price, stock }) => ({ model_id, tier_index, sku, price, stock })),
    sizeTier: -1, codes: {}, prefix: null, st: [], suggest: { colors: [], sizes: [] }, siblings: [],
    canUpload: true,
    info: infoOf(it),
  };
  if (!out.hasModel) return out;
  return withSiblings(await addStPlan(out, tiers, models), 'lazada', shop, tiers, models);
}

// add / models รูปแบบเดียวกับ shopeeAddOptions · รูปของสีใหม่ = URL รูปที่ตะกร้ามีอยู่แล้ว (gallery)
export async function lazadaAddOptions({ shop, itemId, add = [], models = [] }) {
  const auth = await lzAuth(shop);
  const before = await readItem(auth, itemId);
  const { it, tiers } = before;
  if (!tiers.length) throw new BasketError('ตะกร้านี้ไม่มีตัวเลือกแบบ variation — เพิ่มในหลังร้าน Lazada');
  if (before.models.some((m) => m.tier_index.some((i) => i < 0))) throw new BasketError('มี SKU ที่จับคู่ตัวเลือกไม่ได้ — แก้ในหลังร้าน Lazada');
  if (add.length > tiers.length) throw new BasketError('จำนวนชั้นตัวเลือกไม่ตรงกับตะกร้า');
  const { target, newImg, oldLen, todo } = checkAdd(tiers, before.models, add, models, {
    withImg: Boolean(tiers[0].hasImage), label: 'Lazada', imgOk: urlOk, round: (x) => Math.round(x * 100) / 100,
  });
  // ขนาดพัสดุ: ลอกจาก SKU เดิมตัวแรก (Lazada บังคับ)
  const ref = (it.skus || [])[0] || {};
  const pkg = Object.fromEntries(['package_weight', 'package_length', 'package_width', 'package_height'].filter((k) => ref[k] !== undefined && ref[k] !== '').map((k) => [k, String(ref[k])]));
  const imgOf = (ix) => {
    if (!tiers[0].hasImage) return null;
    return ix[0] >= oldLen[0] ? newImg[ix[0] - oldLen[0]] : tiers[0].options[ix[0]].image_url;
  };
  const skuSent = todo.map((m) => {
    const img = imgOf(m.tier_index) || (it.images || [])[0] || null;
    return {
      SellerSku: m.sku, quantity: String(m.stock), price: String(m.price), ...pkg,
      saleProp: Object.fromEntries(tiers.map((t, ti) => [t.name, target[ti][m.tier_index[ti]]])),
      ...(img ? { Images: { Image: [img] } } : {}),
    };
  });
  if (skuSent.some((s) => !s.SellerSku)) throw new BasketError('SKU ใหม่ต้องมีรหัส (Lazada บังคับ SellerSku)');
  const product = {
    AssociatedSku: before.models[0].model_id,
    PrimaryCategory: String(it.primary_category),
    Attributes: { name: it.attributes?.name, ...(it.attributes?.brand ? { brand: it.attributes.brand } : {}) },
    variation: Object.fromEntries(tiers.map((t, ti) => [VARS[ti], { name: t.name, hasImage: t.hasImage, customize: true, options: { option: target[ti] } }])),
    Skus: { Sku: skuSent },
  };
  const r = await retry(() => lazada.callPost('/product/create', { ...auth, body: { payload: JSON.stringify({ Request: { Product: product } }) } }));
  const list = r.data?.sku_list || [];
  const added = todo.map((m) => ({ model_id: String(list.find((x) => x.seller_sku === m.sku)?.sku_id ?? ''), sku: m.sku }));

  // อ่านซ้ำ: SKU เดิมต้องอยู่ครบ · เก็บลงฐานข้อมูลให้หน้าเว็บเห็นทันที
  await sleep(1500);
  const after = await retry(() => lazada.getProductItem({ ...auth, itemId }));
  const warnings = [];
  const ids = new Set((after?.skus || []).map((s) => String(s.SkuId)));
  const lost = before.models.filter((m) => !ids.has(m.model_id));
  if (lost.length) warnings.push(`⚠ SKU เดิมหายไป ${lost.length} ตัว (${lost.slice(0, 3).map((m) => m.sku).join(', ')}) — ตรวจในหลังร้านด่วน`);
  const miss = todo.filter((m) => !(after?.skus || []).some((s) => s.SellerSku === m.sku));
  if (miss.length) warnings.push(`Lazada ยังไม่มี SKU ใหม่ ${miss.length} ตัว (อาจยังอัปเดตไม่ทัน — รีเฟรชดูอีกครั้ง)`);
  try {
    const { data: l } = await db().from('os_listings').select('status').eq('platform', 'lazada').eq('shop', shop).eq('product_id', String(itemId)).maybeSingle();
    if (after && l) {
      await saveListings([lazada.normalizeListing(after, shop, l.status)]);
      await markCompareStale(shopGroup('lazada', shop));
    }
  } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
  return { added, options: target, warnings };
}

// อัปโหลดรูปจากเครื่องเข้าคลังรูป Lazada → url (ยังไม่ผูกตะกร้าจนกดบันทึก)
export async function lazadaUploadImage(shop, bytes, type) {
  if (!/^image\/(jpeg|png)$/.test(type)) throw new BasketError('รูปต้องเป็น JPG หรือ PNG');
  if (bytes.length > 4 * 1024 * 1024) throw new BasketError('รูปใหญ่เกิน 4MB');
  const auth = await lzAuth(shop);
  return retry(() => lazada.uploadImage({ ...auth, bytes, contentType: type }));
}

async function refreshListing(auth, shop, itemId) {
  try {
    const after = await retry(() => lazada.getProductItem({ ...auth, itemId }));
    const { data: l } = await db().from('os_listings').select('status').eq('platform', 'lazada').eq('shop', shop).eq('product_id', String(itemId)).maybeSingle();
    if (after && l) {
      await saveListings([lazada.normalizeListing(after, shop, l.status)]);
      await markCompareStale(shopGroup('lazada', shop));
    }
    return after;
  } catch { return null; }   // รอบดึงสินค้าจะตามมาเอง
}

// รูปสินค้า (Images ระดับตะกร้า) + รูปตัวเลือกชั้นแรก (= รูปแรกของทุก SKU ที่ใช้ตัวเลือกนั้น) — /product/update ครั้งเดียว
// SKU ส่งแค่ ItemId + SkuId + SellerSku (+ Images ถ้าเปลี่ยน) ไม่ส่งราคา/คลัง → ค่าเดิมคงอยู่
export async function lazadaSetImages({ shop, itemId, main = null, options = null }) {
  const auth = await lzAuth(shop);
  const before = await readItem(auth, itemId);
  const { it, tiers } = before;
  if (before.models.some((m) => m.tier_index.some((i) => i < 0))) throw new BasketError('มี SKU ที่จับคู่ตัวเลือกไม่ได้ — แก้ในหลังร้าน Lazada');
  const { mainIds, optImg } = checkImages(tiers, (it.images || []).filter(Boolean), { main, options }, { max: 8, label: 'Lazada', imgOk: urlOk, allOrNone: false });
  const byId = new Map((it.skus || []).map((s) => [String(s.SkuId), s]));
  const skus = byOptionOrder(before.models).map((m) => {
    const s = byId.get(m.model_id);
    const i = optImg ? m.tier_index[0] : -1;
    const changed = i >= 0 && optImg[i] && optImg[i] !== tiers[0].options[i].image_url;
    const old = (s.Images || []).filter(Boolean);
    const imgs = changed ? [optImg[i], ...old.filter((u) => u !== tiers[0].options[i].image_url && u !== optImg[i])].slice(0, 8) : null;
    return { ItemId: String(itemId), SkuId: String(s.SkuId), SellerSku: s.SellerSku, ...(imgs ? { Images: { Image: imgs } } : {}) };
  });
  if (skus.length !== before.models.length || skus.some((s) => !/^\d+$/.test(s.SkuId))) throw new Error('อ่าน SKU เดิมไม่ครบ — ไม่บันทึก');
  const product = { ItemId: String(itemId), ...(mainIds ? { Images: { Image: mainIds } } : {}), Skus: { Sku: skus } };
  await retry(() => lazada.callPost('/product/update', { ...auth, body: { payload: JSON.stringify({ Request: { Product: product } }) } }));
  await sleep(1500);
  const after = await refreshListing(auth, shop, itemId);
  const warnings = [];
  if (after) {
    const ids = new Set((after.skus || []).map((s) => String(s.SkuId)));
    const lost = before.models.filter((m) => !ids.has(m.model_id));
    if (lost.length) warnings.push(`⚠ SKU เดิมหายไป ${lost.length} ตัว — ตรวจในหลังร้านด่วน`);
  }
  return { main: Boolean(mainIds), options: optImg ? optImg.filter((x, i) => x !== (tiers[0].options[i].image_id || null)).length : 0, warnings };
}

// ราคาปกติของ SKU เดิม — /product/price_quantity/update (ไม่แตะคลัง) · รหัส SellerSku เปลี่ยนไม่ได้
export async function lazadaEditModels({ shop, itemId, edits }) {
  const auth = await lzAuth(shop);
  const before = await readItem(auth, itemId);
  const todo = checkEdits(before.models, edits, { label: 'Lazada', round: (x) => Math.round(x * 100) / 100, skuEditable: false });
  for (let i = 0; i < todo.length; i += 50) {
    const c = todo.slice(i, i + 50);
    await retry(() => lazada.setPrice({ ...auth, itemId: String(itemId), prices: c.map((x) => ({ skuId: x.model_id, price: x.price })) }));
  }
  await sleep(1500);
  await refreshListing(auth, shop, itemId);
  return { changed: todo.length, warnings: [] };
}

// SKU เดิมแบบที่ /product/update ต้องการ (ItemId + SkuId + SellerSku) — ไม่ส่งราคา/คลัง → ค่าเดิมคงอยู่
const skuRef = (itemId, s) => ({ ItemId: String(itemId), SkuId: String(s.SkuId), SellerSku: s.SellerSku });

// ชื่อ/รายละเอียด — /product/update Attributes
export async function lazadaSetInfo({ shop, itemId, title = null, description = null, category = null }) {
  if (category) throw new BasketError('Lazada เปลี่ยนหมวดจากเว็บไม่ได้ — เปลี่ยนในหลังร้าน Lazada');
  const auth = await lzAuth(shop);
  const { it, models } = await readItem(auth, itemId);
  const { title: t, description: d } = checkInfo(infoOf(it), { title, description }, { titleMax: 255, descMax: 25000, label: 'Lazada' });
  if (!t && !d) throw new BasketError('ไม่มีอะไรเปลี่ยน — ไม่มีอะไรให้บันทึก');
  // SKU ที่จับคู่ตัวเลือกไม่ได้ (tier_index -1) เรียงไว้หน้าสุด — ตัวเลือกที่จับคู่ได้ยังคงลำดับเดิม
  const byId = new Map((it.skus || []).map((s) => [String(s.SkuId), s]));
  const skus = byOptionOrder(models).map((m) => skuRef(itemId, byId.get(m.model_id)));
  if (skus.length !== models.length || skus.some((s) => !/^\d+$/.test(s.SkuId))) throw new Error('อ่าน SKU เดิมไม่ครบ — ไม่บันทึก');
  const product = { ItemId: String(itemId), Attributes: { ...(t ? { name: t } : {}), ...(d ? { description: d } : {}) }, Skus: { Sku: skus } };
  await retry(() => lazada.callPost('/product/update', { ...auth, body: { payload: JSON.stringify({ Request: { Product: product } }) } }));
  await sleep(1500);
  await refreshListing(auth, shop, itemId);
  return { title: Boolean(t), description: Boolean(d), category: false, warnings: [] };
}

// ลบ SKU = /product/remove · เรียง/เปลี่ยนชื่อ/ลบตัวเลือก = /product/update variation ใหม่ + saleProp ใหม่ของ SKU ที่เหลือ
export async function lazadaSetStructure({ shop, itemId, tiers: want, del = [] }) {
  const auth = await lzAuth(shop);
  const before = await readItem(auth, itemId);
  const { it } = before;
  if (!before.tiers.length) throw new BasketError('ตะกร้านี้ไม่มีตัวเลือกแบบ variation — แก้ในหลังร้าน Lazada');
  if (before.models.some((m) => m.tier_index.some((i) => i < 0))) throw new BasketError('มี SKU ที่จับคู่ตัวเลือกไม่ได้ — แก้ในหลังร้าน Lazada');
  const { tiers, keep, drop, shape } = checkStructure(before.tiers, before.models, { tiers: want, del }, { label: 'Lazada' });
  if (drop.length) await retry(() => lazada.removeSkus({ ...auth, itemId: String(itemId), skuIds: drop.map((m) => m.model_id) }));
  if (shape) {
    const byId = new Map((it.skus || []).map((s) => [String(s.SkuId), s]));
    const order = [...keep].sort((a, b) => {
      for (let ti = 0; ti < tiers.length; ti += 1) if (a.tier_index[ti] !== b.tier_index[ti]) return a.tier_index[ti] - b.tier_index[ti];
      return 0;
    });
    const product = {
      ItemId: String(itemId),
      variation: Object.fromEntries(tiers.map((t, ti) => [VARS[ti], { name: t.name, hasImage: Boolean(before.tiers[ti].hasImage), customize: true, options: { option: t.options.map((o) => o.text) } }])),
      Skus: { Sku: order.map(({ m, tier_index }) => ({ ...skuRef(itemId, byId.get(m.model_id)), saleProp: Object.fromEntries(tiers.map((t, ti) => [t.name, t.options[tier_index[ti]].text])) })) },
    };
    try {
      await retry(() => lazada.callPost('/product/update', { ...auth, body: { payload: JSON.stringify({ Request: { Product: product } }) } }));
    } catch (e) {
      if (drop.length) e.message = `${e.message} (ลบ SKU ไปแล้ว ${drop.length} ตัว แต่เรียง/เปลี่ยนชื่อตัวเลือกไม่สำเร็จ)`;
      throw e;
    }
  }
  await sleep(1500);
  const after = await refreshListing(auth, shop, itemId);
  const warnings = [];
  if (after) {
    const ids = new Set((after.skus || []).map((s) => String(s.SkuId)));
    const lost = keep.filter((k) => !ids.has(k.m.model_id));
    if (lost.length) warnings.push(`⚠ SKU ที่ควรเหลือหายไป ${lost.length} ตัว — ตรวจในหลังร้านด่วน`);
    const left = drop.filter((m) => ids.has(m.model_id));
    if (left.length) warnings.push(`SKU ที่สั่งลบยังอยู่ ${left.length} ตัว (อาจยังอัปเดตไม่ทัน — รีเฟรชดูอีกครั้ง)`);
  }
  return { deleted: drop.length, reshaped: shape, warnings };
}
