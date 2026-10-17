// แก้ตะกร้า TikTok ที่มีอยู่แล้ว: เพิ่มตัวเลือก (สี/ไซส์) + SKU ใหม่ — หน้าแก้ไขสินค้า (/product/tiktok/[shop]/[id]/edit)
// ตรรกะเดาสี/ไซส์/รหัสจาก ST และการตรวจข้อมูลใช้ร่วมกับ Shopee (lib/basket.js addStPlan, checkAdd)
//
// ส่องจริงกับสินค้า [TEST] ที่เปิดขาย (2026-10-17 SOLID):
//   - POST /product/202309/products/{id}/partial_edit { skus: [SKU ใหม่เท่านั้น] } → SKU เดิมไม่ถูกแตะ/ไม่หาย
//     SKU ใหม่ไม่ใส่ id · sales_attributes ใช้ชื่อชั้น + value_name (ตัวเลือกใหม่ = ชื่อใหม่) · รูปของชั้นแรกใส่ sku_img.uri
//   - ตะกร้าที่ขายอยู่ยังขายต่อ (status ACTIVATE) แต่การแก้ต้องรอ TikTok ตรวจ (audit AUDITING) — SKU ใหม่ขึ้นหลังผ่านตรวจ
//   - อ่านทันทีหลังแก้ยังเห็นแค่ SKU เดิม (ของใหม่อยู่ในฉบับที่รอตรวจ)
import * as tiktok from './tiktok.js';
import { listShops, storedToken } from './tokens.js';
import { BasketError, addStPlan, checkAdd } from './basket.js';

async function ttAuth(shop) {
  const row = (await listShops('tiktok')).find((r) => r.shop === shop);
  if (!row) throw new BasketError(`ร้าน TikTok ${shop} ยังไม่ได้เชื่อม API`);
  const tok = storedToken(row);
  return { accessToken: tok.access_token, shopCipher: tok.shop_cipher };
}

// ตะกร้าสด → รูปแบบเดียวกับ Shopee · รูปของ TikTok อ้างด้วย uri → image_id = uri
async function readItem(auth, productId) {
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

const auditing = (p) => /AUDITING|PENDING/i.test(String(p.audit?.status || '')) || p.status === 'PENDING';

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
    models: models.map(({ model_id, tier_index, sku, price, stock }) => ({ model_id, tier_index, sku, price, stock })),
    sizeTier: -1, codes: {}, prefix: null, st: [], suggest: { colors: [], sizes: [] },
    canUpload: false,
    // แก้ครั้งก่อนยังรอ TikTok ตรวจ — หน้าเว็บเตือน (แก้ซ้อนอาจทับของที่รอตรวจ)
    auditing: auditing(p),
  };
  if (!out.hasModel) return out;
  return addStPlan(out, tiers, models);
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
  const gallery = new Set([...(p.main_images || []).map((m) => m.uri), ...tiers[0].options.map((o) => o.image_id)].filter(Boolean));
  const { target, newImg, oldLen, todo } = checkAdd(tiers, before.models, add, models, {
    withImg, label: 'TikTok', imgOk: (x) => gallery.has(x), round: (x) => Math.round(x * 100) / 100,
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
  const r = await tiktok.call(`/product/202309/products/${encodeURIComponent(String(itemId))}/partial_edit`, { ...auth, method: 'POST', body: { skus } });
  const added = (r.skus || []).map((s) => ({ model_id: String(s.id), sku: s.seller_sku || null }));
  const warnings = [];
  if (/AUDITING/i.test(String(r.audit?.status || ''))) warnings.push('TikTok กำลังตรวจการแก้ไข — SKU ใหม่จะขึ้นในร้านหลังผ่านตรวจ (ตะกร้าเดิมยังขายต่อ)');
  if (added.length !== todo.length) warnings.push(`TikTok คืน SKU ใหม่ ${added.length} ตัว ≠ ที่ส่งไป ${todo.length}`);
  return { added, options: target, warnings };
}
