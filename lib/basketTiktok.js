// แก้ตะกร้า TikTok ที่มีอยู่แล้ว: เพิ่มตัวเลือก (สี/ไซส์) + SKU ใหม่ — หน้าแก้ไขสินค้า (/product/tiktok/[shop]/[id]/edit)
// ตรรกะเดาสี/ไซส์/รหัสจาก ST และการตรวจข้อมูลใช้ร่วมกับ Shopee (lib/basket.js addStPlan, checkAdd)
//
// ส่องจริงกับสินค้า [TEST] ที่เปิดขาย (2026-10-17 SOLID):
//   - POST /product/202309/products/{id}/partial_edit { skus } = รายการ SKU ทั้งชุดหลังผ่านตรวจ
//     ⚠ ส่งแค่ SKU ใหม่ → ผ่านตรวจแล้ว SKU เดิมถูกลบทิ้งหมด (เจอจริงกับ [TEST]) → ต้องส่ง SKU เดิมครบทุกตัวด้วยเสมอ
//     SKU เดิม: ส่งแค่ id + sales_attributes + seller_sku (ไม่ส่งราคา/คลัง) → ผ่านตรวจแล้วราคา/คลังเดิมคงอยู่
//       (ทดสอบ: ตั้ง [TEST] ราคา 9999 คลัง 1 → เพิ่มสี → ผ่านตรวจ ยัง 9999 / 1 · id เดิมไม่เปลี่ยน)
//     SKU ใหม่ไม่ใส่ id · sales_attributes ใช้ชื่อชั้น + value_name (ตัวเลือกใหม่ = ชื่อใหม่) · รูปของชั้นแรกใส่ sku_img.uri
//   - ตะกร้าที่ขายอยู่ยังขายต่อ (status ACTIVATE) แต่การแก้ต้องรอ TikTok ตรวจ (audit AUDITING) — SKU ใหม่ขึ้นหลังผ่านตรวจ
//   - อ่านทันทีหลังแก้ยังเห็นแค่ SKU เดิม (ของใหม่อยู่ในฉบับที่รอตรวจ)
import * as tiktok from './tiktok.js';
import { listShops, storedToken } from './tokens.js';
import { BasketError, addStPlan, checkAdd, checkImages, checkEdits, checkInfo, checkStructure, withSiblings } from './basket.js';

// ชื่อ/รายละเอียด (HTML)/หมวด — หมวดเปลี่ยนจากเว็บไม่ได้ (partial_edit ไม่รับ ต้องแก้ทั้งก้อน เสี่ยงทับข้อมูลอื่น)
const infoOf = (p) => ({
  title: p.title || '', titleMax: 255,
  description: p.description || '', descEditable: true, descHtml: true, descMax: 10000,
  category: {
    id: (p.category_chains || []).find((c) => c.is_leaf)?.id ?? null,
    path: (p.category_chains || []).map((c) => c.local_name).filter(Boolean).join(' / ') || null,
    editable: false,
  },
});

// รหัสรูปของ TikTok = uri (เช่น tos-alisg-i-xxxx/abcd) — รูปที่ตะกร้ามีอยู่แล้ว หรือที่อัปจากเครื่องผ่าน tiktokUploadImage
const uriOk = (x) => /^[\w.~/-]{6,400}$/.test(x);

export async function ttAuth(shop) {
  const row = (await listShops('tiktok')).find((r) => r.shop === shop);
  if (!row) throw new BasketError(`ร้าน TikTok ${shop} ยังไม่ได้เชื่อม API`);
  const tok = storedToken(row);
  return { accessToken: tok.access_token, shopCipher: tok.shop_cipher };
}

// ตะกร้าสด → รูปแบบเดียวกับ Shopee · รูปของ TikTok อ้างด้วย uri → image_id = uri
export async function readItem(auth, productId) {
  const p = await tiktok.getProduct({ ...auth, productId });
  if (!p?.id) throw new BasketError('ไม่พบตะกร้านี้ใน TikTok');
  const skus = p.skus || [];
  const names = [];
  for (const s of skus) for (const a of s.sales_attributes || []) if (!names.includes(a.name)) names.push(a.name);
  const tiers = names.map((name) => ({ name, options: [] }));
  for (const s of skus) {
    for (const a of s.sales_attributes || []) {
      const t = tiers[names.indexOf(a.name)];
      let o = t.options.find((x) => x.text === a.value_name);
      if (!o) { o = { text: a.value_name, image_id: null, image_url: null }; t.options.push(o); }
      if (!o.image_id && a.sku_img?.uri) { o.image_id = a.sku_img.uri; o.image_url = (a.sku_img.urls || a.sku_img.thumb_urls || [])[0] || null; }
    }
  }
  const models = skus.map((s) => ({
    model_id: String(s.id),
    tier_index: tiers.map((t) => t.options.findIndex((o) => o.text === (s.sales_attributes || []).find((a) => a.name === t.name)?.value_name)),
    sku: s.seller_sku || '',
    price: s.price?.sale_price ?? s.price?.tax_exclusive_price ?? null,
    stock: (s.inventory || []).reduce((n, w) => n + (Number(w.quantity) || 0), 0),
    warehouses: (s.inventory || []).map((w) => String(w.warehouse_id)),
  }));
  return { p, tiers, models };
}

export const auditing = (p) => /AUDITING|PENDING/i.test(String(p.audit?.status || '')) || p.status === 'PENDING';

export async function tiktokBasketPlan(shop, itemId) {
  const auth = await ttAuth(shop);
  const { p, tiers, models } = await readItem(auth, itemId);
  const gallery = [...new Map([
    ...(p.main_images || []).map((m) => ({ image_id: m.uri, image_url: (m.urls || m.thumb_urls || [])[0] || null })),
    ...(tiers[0]?.options || []).filter((o) => o.image_id).map((o) => ({ image_id: o.image_id, image_url: o.image_url })),
  ].filter((x) => x.image_id && x.image_url).map((x) => [x.image_id, x])).values()];
  const out = {
    itemId: String(itemId), title: p.title || null, status: p.status || null,
    hasModel: tiers.length > 0 && !models.some((m) => m.tier_index.some((i) => i < 0)),
    tiers: tiers.map((t) => ({ name: t.name, options: t.options })),
    needImage: Boolean(tiers[0]?.options.length) && tiers[0].options.every((o) => o.image_id),
    gallery,
    main: (p.main_images || []).map((m) => ({ image_id: m.uri, image_url: (m.urls || m.thumb_urls || [])[0] || null })),
    maxImages: 9,
    models: models.map(({ model_id, tier_index, sku, price, stock }) => ({ model_id, tier_index, sku, price, stock })),
    sizeTier: -1, codes: {}, prefix: null, st: [], suggest: { colors: [], sizes: [] }, siblings: [],
    canUpload: true,
    // แก้ครั้งก่อนยังรอ TikTok ตรวจ — หน้าเว็บเตือน (แก้ซ้อนอาจทับของที่รอตรวจ)
    auditing: auditing(p),
    info: infoOf(p),
  };
  if (!out.hasModel) return out;
  return withSiblings(await addStPlan(out, tiers, models), 'tiktok', shop, tiers, models);
}

// add / models รูปแบบเดียวกับ shopeeAddOptions · รูปของสีใหม่ = uri รูปที่ตะกร้ามีอยู่แล้ว (gallery)
export async function tiktokAddOptions({ shop, itemId, add = [], models = [] }) {
  const auth = await ttAuth(shop);
  const before = await readItem(auth, itemId);
  const { p, tiers } = before;
  if (!tiers.length) throw new BasketError('ตะกร้านี้ไม่มีตัวเลือก — เพิ่มตัวเลือกชั้นแรกในหลังร้าน TikTok');
  if (before.models.some((m) => m.tier_index.some((i) => i < 0))) throw new BasketError('มี SKU ที่จับคู่ตัวเลือกไม่ได้ — แก้ในหลังร้าน TikTok');
  if (auditing(p)) throw new BasketError('การแก้ไขครั้งก่อนของตะกร้านี้ยังรอ TikTok ตรวจ — รอผ่านก่อนค่อยเพิ่มอีก (แก้ซ้อนอาจทับของที่รอตรวจ)');
  if (add.length > tiers.length) throw new BasketError('จำนวนชั้นตัวเลือกไม่ตรงกับตะกร้า');
  const withImg = Boolean(tiers[0].options.length) && tiers[0].options.every((o) => o.image_id);
  const { target, newImg, oldLen, todo } = checkAdd(tiers, before.models, add, models, {
    withImg, label: 'TikTok', imgOk: uriOk, round: (x) => Math.round(x * 100) / 100,
  });
  if (todo.some((m) => !m.sku)) throw new BasketError('SKU ใหม่ต้องมีรหัส');
  // คลังสินค้า: ใช้คลังเดียวกับ SKU เดิม (มีหลายคลังไม่รู้จะแบ่งยังไง → ไม่ทำ)
  const wh = [...new Set(before.models.flatMap((m) => m.warehouses))];
  if (wh.length !== 1) throw new BasketError(`ตะกร้านี้ใช้ ${wh.length} คลังสินค้า — เพิ่ม SKU ในหลังร้าน TikTok`);
  const imgOf = (ix) => (!withImg ? null : ix[0] >= oldLen[0] ? newImg[ix[0] - oldLen[0]] : tiers[0].options[ix[0]].image_id);
  const skus = todo.map((m) => ({
    sales_attributes: tiers.map((t, ti) => ({
      name: t.name, value_name: target[ti][m.tier_index[ti]],
      ...(ti === 0 && imgOf(m.tier_index) ? { sku_img: { uri: imgOf(m.tier_index) } } : {}),
    })),
    seller_sku: m.sku,
    price: { amount: String(m.price), currency: 'THB' },
    inventory: [{ warehouse_id: wh[0], quantity: m.stock }],
  }));
  // SKU เดิมครบทุกตัว (id + ตัวเลือก + รหัส) — ไม่ส่งราคา/คลัง (คงค่าเดิม) · ขาดตัวไหน = ตัวนั้นถูกลบหลังผ่านตรวจ
  const keep = (p.skus || []).map((s) => ({
    id: String(s.id), seller_sku: s.seller_sku || '',
    sales_attributes: (s.sales_attributes || []).map((a) => ({ name: a.name, value_name: a.value_name, ...(a.sku_img?.uri ? { sku_img: { uri: a.sku_img.uri } } : {}) })),
  }));
  if (keep.length !== before.models.length) throw new Error('อ่าน SKU เดิมไม่ครบ — ไม่บันทึก กัน SKU เดิมถูกลบ');
  const r = await tiktok.call(`/product/202309/products/${encodeURIComponent(String(itemId))}/partial_edit`, { ...auth, method: 'POST', body: { skus: [...keep, ...skus] } });
  const oldIds = new Set(keep.map((s) => s.id));
  const added = (r.skus || []).filter((s) => !oldIds.has(String(s.id))).map((s) => ({ model_id: String(s.id), sku: s.seller_sku || null }));
  const warnings = [];
  const back = new Set((r.skus || []).map((s) => String(s.id)));
  const lost = keep.filter((s) => !back.has(s.id));
  if (lost.length) warnings.push(`⚠ TikTok ไม่คืน SKU เดิม ${lost.length} ตัว (${lost.slice(0, 3).map((s) => s.seller_sku).join(', ')}) — ตรวจในหลังร้านด่วน`);
  if (/AUDITING/i.test(String(r.audit?.status || ''))) warnings.push('TikTok กำลังตรวจการแก้ไข — SKU ใหม่จะขึ้นในร้านหลังผ่านตรวจ (ตะกร้าเดิมยังขายต่อ)');
  if (added.length !== todo.length) warnings.push(`TikTok คืน SKU ใหม่ ${added.length} ตัว ≠ ที่ส่งไป ${todo.length}`);
  return { added, options: target, warnings };
}

// อัปโหลดรูปจากเครื่องเข้าคลังรูป TikTok → uri (ยังไม่ผูกตะกร้าจนกดบันทึก) · use: 'main' = รูปสินค้า · 'option' = รูปตัวเลือก
export async function tiktokUploadImage(shop, bytes, type, use = 'main') {
  if (!/^image\/(jpeg|png)$/.test(type)) throw new BasketError('รูปต้องเป็น JPG หรือ PNG');
  if (bytes.length > 4 * 1024 * 1024) throw new BasketError('รูปใหญ่เกิน 4MB');
  const auth = await ttAuth(shop);
  return tiktok.uploadImage({ accessToken: auth.accessToken, bytes, contentType: type, useCase: use === 'option' ? 'ATTRIBUTE_IMAGE' : use === 'size_chart' ? 'SIZE_CHART_IMAGE' : 'MAIN_IMAGE' });
}

// SKU เดิมทุกตัวในรูปแบบ partial_edit (id + ตัวเลือก + รหัส + รูปชั้นแรก) — ขาดตัวไหน = ตัวนั้นถูกลบหลังผ่านตรวจ
// optImg: รูปใหม่ต่อตัวเลือกชั้นแรก (ตามลำดับ tiers[0]) · skuOf: model_id → รหัส SKU ใหม่
function keepSkus(p, tiers, { optImg = null, skuOf = new Map() } = {}) {
  return (p.skus || []).map((s) => ({
    id: String(s.id),
    seller_sku: skuOf.get(String(s.id)) ?? (s.seller_sku || ''),
    sales_attributes: (s.sales_attributes || []).map((a) => {
      const i = optImg && a.name === tiers[0].name ? tiers[0].options.findIndex((o) => o.text === a.value_name) : -1;
      const uri = i >= 0 ? optImg[i] : a.sku_img?.uri;
      return { name: a.name, value_name: a.value_name, ...(uri ? { sku_img: { uri } } : {}) };
    }),
  }));
}

function checkWritable(p, before) {
  if (auditing(p)) throw new BasketError('การแก้ไขครั้งก่อนของตะกร้านี้ยังรอ TikTok ตรวจ — รอผ่านก่อนค่อยแก้อีก (แก้ซ้อนอาจทับของที่รอตรวจ)');
  if (before.models.some((m) => m.tier_index.some((i) => i < 0))) throw new BasketError('มี SKU ที่จับคู่ตัวเลือกไม่ได้ — แก้ในหลังร้าน TikTok');
}

export async function partialEdit(auth, itemId, body, keepCount) {
  const r = await tiktok.call(`/product/202309/products/${encodeURIComponent(String(itemId))}/partial_edit`, { ...auth, method: 'POST', body });
  const warnings = [];
  if (body.skus) {
    const back = new Set((r.skus || []).map((s) => String(s.id)));
    const lost = body.skus.filter((s) => !back.has(s.id));
    if (r.skus && lost.length) warnings.push(`⚠ TikTok ไม่คืน SKU เดิม ${lost.length} ตัว (${lost.slice(0, 3).map((s) => s.seller_sku).join(', ')}) — ตรวจในหลังร้านด่วน`);
    if (body.skus.length !== keepCount) warnings.push('จำนวน SKU ที่ส่งไม่ตรงกับตะกร้า — ตรวจในหลังร้าน');
  }
  if (/AUDITING/i.test(String(r.audit?.status || ''))) warnings.push('TikTok กำลังตรวจการแก้ไข — ของใหม่จะขึ้นในร้านหลังผ่านตรวจ (ตะกร้าเดิมยังขายต่อ)');
  return warnings;
}

// รูปสินค้า (main_images) + รูปตัวเลือกชั้นแรก (sku_img) — partial_edit ครั้งเดียว · ส่ง skus เฉพาะตอนแก้รูปตัวเลือก (ครบทุกตัว)
export async function tiktokSetImages({ shop, itemId, main = null, options = null }) {
  const auth = await ttAuth(shop);
  const before = await readItem(auth, itemId);
  const { p, tiers } = before;
  checkWritable(p, before);
  const { mainIds, optImg } = checkImages(tiers, (p.main_images || []).map((m) => m.uri), { main, options }, { max: 9, label: 'TikTok', imgOk: uriOk });
  const body = {};
  if (mainIds) body.main_images = mainIds.map((uri) => ({ uri }));
  if (optImg) {
    body.skus = keepSkus(p, tiers, { optImg });
    if (body.skus.length !== before.models.length) throw new Error('อ่าน SKU เดิมไม่ครบ — ไม่บันทึก กัน SKU เดิมถูกลบ');
  }
  const warnings = await partialEdit(auth, itemId, body, before.models.length);
  return { main: Boolean(mainIds), options: optImg ? optImg.filter((x, i) => x !== (tiers[0].options[i].image_id || null)).length : 0, warnings };
}

// ราคา: prices/update (ไม่ต้องรอตรวจ) · รหัส SKU: partial_edit ส่ง SKU ครบทุกตัว (ต้องรอตรวจ)
export async function tiktokEditModels({ shop, itemId, edits }) {
  const auth = await ttAuth(shop);
  const before = await readItem(auth, itemId);
  const { p, tiers } = before;
  const todo = checkEdits(before.models, edits, { label: 'TikTok', round: (x) => Math.round(x * 100) / 100 });
  const warnings = [];
  const priceList = todo.filter((x) => x.price !== null);
  if (priceList.length) {
    await tiktok.call(`/product/202309/products/${encodeURIComponent(String(itemId))}/prices/update`, {
      ...auth, method: 'POST', body: { skus: priceList.map((x) => ({ id: x.model_id, price: { amount: String(x.price), currency: 'THB' } })) },
    });
  }
  const skuList = todo.filter((x) => x.sku !== null);
  if (skuList.length) {
    try {
      checkWritable(p, before);
      const skus = keepSkus(p, tiers, { skuOf: new Map(skuList.map((x) => [x.model_id, x.sku])) });
      if (skus.length !== before.models.length) throw new Error('อ่าน SKU เดิมไม่ครบ — ไม่บันทึก กัน SKU เดิมถูกลบ');
      warnings.push(...(await partialEdit(auth, itemId, { skus }, before.models.length)));
    } catch (e) {
      if (priceList.length) e.message = `${e.message} (ราคาเปลี่ยนแล้ว ${priceList.length} ตัว แต่รหัส SKU ยังไม่เปลี่ยน)`;
      throw e;
    }
  }
  return { changed: todo.length, warnings };
}

// ชื่อ/รายละเอียด — partial_edit (ต้องรอตรวจ)
export async function tiktokSetInfo({ shop, itemId, title = null, description = null, category = null }) {
  if (category) throw new BasketError('TikTok เปลี่ยนหมวดจากเว็บไม่ได้ — เปลี่ยนในหลังร้าน TikTok');
  const auth = await ttAuth(shop);
  const before = await readItem(auth, itemId);
  if (auditing(before.p)) throw new BasketError('การแก้ไขครั้งก่อนของตะกร้านี้ยังรอ TikTok ตรวจ — รอผ่านก่อนค่อยแก้อีก');
  const { title: t, description: d } = checkInfo(infoOf(before.p), { title, description }, { titleMax: 255, descMax: 10000, label: 'TikTok' });
  if (!t && !d) throw new BasketError('ไม่มีอะไรเปลี่ยน — ไม่มีอะไรให้บันทึก');
  const warnings = await partialEdit(auth, itemId, { ...(t ? { title: t } : {}), ...(d ? { description: d } : {}) }, before.models.length);
  return { title: Boolean(t), description: Boolean(d), category: false, warnings };
}

// เรียง/เปลี่ยนชื่อ/ลบตัวเลือก + ลบ SKU — partial_edit ส่ง SKU ที่เหลือครบทุกตัว (ชื่อใหม่ เรียงตามลำดับใหม่)
// SKU ที่ไม่ส่ง = ถูกลบหลังผ่านตรวจ (นี่คือวิธีลบของ TikTok) · ราคา/คลังไม่ส่ง → คงค่าเดิม
export async function tiktokSetStructure({ shop, itemId, tiers: want, del = [] }) {
  const auth = await ttAuth(shop);
  const before = await readItem(auth, itemId);
  const { p } = before;
  checkWritable(p, before);
  const { tiers, keep, drop } = checkStructure(before.tiers, before.models, { tiers: want, del }, { label: 'TikTok' });
  const byId = new Map((p.skus || []).map((s) => [String(s.id), s]));
  const order = [...keep].sort((a, b) => {
    for (let ti = 0; ti < tiers.length; ti += 1) if (a.tier_index[ti] !== b.tier_index[ti]) return a.tier_index[ti] - b.tier_index[ti];
    return 0;
  });
  const skus = order.map(({ m, tier_index }) => {
    const s = byId.get(m.model_id);
    if (!s) throw new Error('อ่าน SKU เดิมไม่ครบ — ไม่บันทึก');
    return {
      id: String(s.id), seller_sku: s.seller_sku || '',
      sales_attributes: before.tiers.map((t, ti) => {
        const old = (s.sales_attributes || []).find((a) => a.name === t.name);
        const o = tiers[ti].options[tier_index[ti]];
        return { name: tiers[ti].name, value_name: o.text, ...(old?.sku_img?.uri ? { sku_img: { uri: old.sku_img.uri } } : {}) };
      }),
    };
  });
  if (skus.length + drop.length !== (p.skus || []).length) throw new Error('จำนวน SKU ไม่ตรงกับตะกร้า — ไม่บันทึก');
  const warnings = await partialEdit(auth, itemId, { skus }, keep.length);
  if (drop.length) warnings.push(`SKU ที่ลบ ${drop.length} ตัวจะหายหลัง TikTok ตรวจผ่าน`);
  return { deleted: drop.length, reshaped: true, warnings };
}
