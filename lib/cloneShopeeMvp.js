// โคลน TikTok MVP → Shopee MVP — Shopee MVP ไม่มี API (ร้านไม่ใช่ Managed/Mall) จึงสร้างผ่านหน้า Seller Center
// ด้วยส่วนขยาย extensions/mvp-stock (โปรไฟล์ Chrome ที่ล็อกอินร้าน MVP ไว้) — ฝั่งนี้แค่เตรียม product_info ให้
//
// กฎ (ดู memory never-recreate-baskets): สร้างเฉพาะตะกร้าที่ Shopee MVP "ยังไม่มี SKU ไหนเลย" และไม่มีตะกร้าชื่อเดียวกัน
//
// รูปแบบ product_info ของ POST /api/v3/product/create_product_info (แกะจากหน้า Seller Center ต.ค. 2569 — ไม่ใช่ API ทางการ):
//   name, description_info { description, description_type: 'normal' }, images [image_id], category_path [id แม่→ลูก],
//   brand_id, attributes [], condition 1, dangerous_goods 0, min_purchase_limit 1, weight { value: kg, unit: 1 },
//   dimension { width, length, height }, std_tier_variation_list [{ id: 0, group_id: '0', custom_value, value_list: [{ id: 0, custom_value, image_id? }] }],
//   model_list [{ id: 0, is_default, tier_index, sku, gtin_code: '', confirm_empty_gtin, price, stock_setting_list: [{ location_id, sellable_stock }] }],
//   unlisted, logistics_channels [{ channelid, enabled, sizeid, size, price, cover_shipping_fee }] ← ส่วนขยายเติมจากช่องขนส่งของร้าน
// รูป: อัปโหลดผ่าน Shopee Open API (media_space ไม่ผูกร้าน) ได้ image_id ที่ใช้ในร้าน MVP ได้
// แผนที่หมวด/แบรนด์ใช้ของ TikTok → Shopee (SOLID) — รหัสหมวด/แบรนด์ของทั้งสองแพลตฟอร์มใช้ร่วมกันทุกร้าน
import { db } from './supabase.js';
import * as tiktok from './tiktok.js';
import * as shopee from './shopee.js';
import { fromTikTok, htmlToText, cleanTitle, shortenValues } from './productModel.js';
import { low, norm, pool, shopToken, candidates, stCounts, fetchImageBytes, titleKey, titleTwins, twinMsg } from './cloneCommon.js';
import MAP from './cloneMaps/tiktok-shopee-solid.json';

const SHOP = 'MVP';
const MAX_IMAGES = 9;

async function tiktokAuth() {
  const t = await shopToken('tiktok', SHOP);
  return { accessToken: t.access_token, shopCipher: t.shop_cipher };
}

// เส้นทางหมวด Shopee (id แม่ → ลูก) — ต้นไม้หมวดทั้งหมดครั้งเดียวต่อชั่วโมง (ใช้โทเคน Shopee SOLID — หมวดเหมือนกันทุกร้าน)
let tree = { at: 0, byId: null };
async function categoryPath(leaf) {
  if (!tree.byId || Date.now() - tree.at > 3600000) {
    const t = await shopToken('shopee', 'SOLID');
    const d = await shopee.call('/api/v2/product/get_category', { accessToken: t.access_token, shopId: t.shop_id, partner: t, params: { language: 'th' } });
    tree = { at: Date.now(), byId: new Map((d.category_list || []).map((c) => [c.category_id, c])) };
  }
  const out = [];
  for (let c = tree.byId.get(Number(leaf)), g = 0; c && g < 6; g++) {
    out.unshift(c.category_id);
    c = c.parent_category_id ? tree.byId.get(c.parent_category_id) : null;
  }
  return out;
}

function pickBrand(m) {
  const byName = m.brand ? MAP.brands[norm(m.brand)] : null;
  if (byName) return byName;
  const t = norm(m.title);
  const hit = Object.entries(MAP.brands).find(([k]) => k.length >= 3 && t.includes(k));
  return hit ? hit[1] : { brand_id: 0, original_brand_name: 'NoBrand' };
}

function blocker(m) {
  if (!MAP.categories[m.categoryLeafId]) return 'ไม่รู้หมวดของ Shopee (ยังไม่มีตะกร้าหมวดนี้ที่ลงทั้ง TikTok และ Shopee)';
  const skus = m.variants.map((v) => v.sku);
  if (skus.some((s) => !s)) return 'มีตัวเลือกที่ไม่มีรหัส SKU';
  const dup = skus.filter((s, i) => skus.findIndex((x) => low(x) === low(s)) !== i);
  if (dup.length) return `รหัส SKU ซ้ำกันในตะกร้า (${[...new Set(dup)].slice(0, 3).join(', ')}) — แก้รหัสใน TikTok ก่อน`;
  if (m.variants.some((v) => !(v.price > 0))) return 'มีตัวเลือกที่ราคาเป็น 0';
  if (!m.images.length) return 'ไม่มีรูปสินค้า';
  if (Math.max(0, ...m.variants.map((v) => v.options.length)) > 2) return 'ตัวเลือกเกิน 2 ชั้น';
  return null;
}

// ── วางแผน: ตะกร้า TikTok MVP ที่ Shopee MVP ยังไม่มี ──
export async function planTiktokToShopeeMvp() {
  const cand = await candidates({ srcPlatform: 'tiktok', dstPlatform: 'shopee', shop: SHOP });
  const twins = await titleTwins('shopee', SHOP);
  const auth = await tiktokAuth();
  const items = await pool(cand, 6, async (c) => {
    const t = twins.get(titleKey(c.title));
    if (t) return { ...c, problem: twinMsg('Shopee MVP', t) };
    try {
      const m = fromTikTok(await tiktok.getProduct({ ...auth, productId: c.id }), SHOP);
      const cat = MAP.categories[m.categoryLeafId];
      return {
        ...c, category: m.categoryChain.join(' / '),
        shopeeCat: cat ? { id: cat.shopee, name: cat.shopeeName || String(cat.shopee), votes: cat.votes, of: cat.of, sure: cat.votes / cat.of >= 0.6 } : null,
        brand: pickBrand(m).original_brand_name,
        problem: blocker(m),
      };
    } catch (e) {
      return { ...c, problem: `อ่านจาก TikTok ไม่ได้: ${String(e.message || e).slice(0, 120)}` };
    }
  });
  return { items: items.sort((a, b) => String(a.title).localeCompare(String(b.title), 'th')), mapBuiltAt: MAP.builtAt };
}

// ── เตรียม product_info ของตะกร้าเดียว (ส่วนขยายเติม logistics_channels แล้วส่งเข้า Seller Center) ──
// catPick: หมวด Shopee ที่ผู้ใช้เลือกเอง · test: [TEST] + SKU -TEST + จำนวน 0 + ซ่อน (unlisted)
export async function buildShopeeMvpProduct({ id, test = false, catPick = null }) {
  id = String(id || '');
  if (!/^\d+$/.test(id)) throw new Error('เลขตะกร้า TikTok ไม่ถูกต้อง');
  // ตรวจซ้ำ: ต้องยังไม่มีใน Shopee MVP (SKU และชื่อ)
  const cand = await candidates({ srcPlatform: 'tiktok', dstPlatform: 'shopee', shop: SHOP });
  if (!cand.some((c) => c.id === id)) throw new Error('Shopee MVP มี SKU ของตะกร้านี้แล้ว หรือตะกร้าไม่ได้ขายอยู่ใน TikTok MVP — ไม่โคลน');
  const m = fromTikTok(await tiktok.getProduct({ ...(await tiktokAuth()), productId: id }), SHOP);
  const twin = (await titleTwins('shopee', SHOP)).get(titleKey(m.title));
  if (twin) throw new Error(twinMsg('Shopee MVP', twin));
  const why = catPick && /^ไม่รู้หมวด/.test(blocker(m) || '') ? null : blocker(m);
  if (why) throw new Error(why);
  const leaf = catPick ? Number(catPick) : MAP.categories[m.categoryLeafId].shopee;
  const category_path = await categoryPath(leaf);
  if (!category_path.length) throw new Error(`ไม่พบหมวด Shopee ${leaf}`);

  // รูป → Shopee (สินค้า ≤9 + รูปของตัวเลือกชั้นแรก)
  const sp = await shopToken('shopee', 'SOLID');
  const depth = Math.max(0, ...m.variants.map((v) => v.options.length));
  const optImg = new Map();
  if (depth >= 1) for (const v of m.variants) if (v.options[0]?.image && !optImg.has(v.options[0].value)) optImg.set(v.options[0].value, v.options[0].image);
  const gallery = m.images.slice(0, MAX_IMAGES);
  const up = new Map();
  await pool([...new Set([...gallery, ...optImg.values()])], 4, async (u) => {
    try {
      const { bytes, type } = await fetchImageBytes(u);
      up.set(u, await shopee.uploadImage({ bytes, contentType: type, filename: type.includes('png') ? 'a.png' : 'a.jpg', partner: sp }));
    } catch (e) { up.set(u, e); }
  });
  const okId = (u) => { const v = up.get(u); return v && !(v instanceof Error) ? v : null; };
  if (!okId(gallery[0])) throw new Error(`รูปหลักอัปโหลดไม่ได้: ${up.get(gallery[0])?.message || ''}`);
  const warnings = [...up.values()].filter((v) => v instanceof Error).map((e) => `ข้ามรูป: ${e.message}`);

  let name = cleanTitle(m.title) || m.title;
  if (test) name = `[TEST] ลบได้ ${name}`;
  if (name.length < 20) name = `${name} ${m.categoryChain.slice(-1)[0] || ''}`.trim();
  name = name.slice(0, 120);
  let description = htmlToText(m.descriptionHtml, 3000);
  if (description.length < 60) description = `${description}\n${name}\n${m.categoryChain.join(' / ')}`.trim().padEnd(60, '.');

  const kg = Math.max(0.01, Math.round((m.weightG / 1000) * 1000) / 1000);
  const dims = { l: Math.max(1, Math.round(m.dims.l)), w: Math.max(1, Math.round(m.dims.w)), h: Math.max(1, Math.round(m.dims.h)) };
  const stock = await stCounts(m.variants.map((v) => v.sku));
  const qtyOf = (v) => (test ? 0 : (stock.has(low(v.sku)) ? stock.get(low(v.sku)) : Math.max(0, Math.round(v.qty || 0))));
  const skuOf = (v) => `${v.sku}${test ? '-TEST' : ''}`;

  // ตัวเลือก: ชื่อ ≤14 · ค่า ≤20 ตัวอักษร (ขีดจำกัดเดียวกับ Shopee Open API) · Shopee ต้องครบทุกคู่ → เติมคู่ที่ขาด จำนวน 0 ไม่มี SKU
  const v1 = [...new Set(m.variants.map((v) => v.options[0]?.value ?? ''))];
  const v2 = depth >= 2 ? [...new Set(m.variants.map((v) => v.options[1]?.value ?? ''))] : [];
  const s1 = shortenValues(v1);
  const s2 = shortenValues(v2);
  const names = [String(m.optionNames[0] || 'ตัวเลือก').slice(0, 14), String(m.optionNames[1] || 'ขนาด').slice(0, 14)];
  const std_tier_variation_list = depth ? [{
    id: 0, group_id: '0', custom_value: names[0],
    value_list: v1.map((a) => ({ id: 0, custom_value: s1.get(a) ?? a, ...(okId(optImg.get(a)) ? { image_id: okId(optImg.get(a)) } : {}) })),
  }] : [];
  if (depth >= 2) std_tier_variation_list.push({ id: 0, group_id: '0', custom_value: names[1], value_list: v2.map((b) => ({ id: 0, custom_value: s2.get(b) ?? b })) });

  const model = (v, tier_index) => ({
    id: 0, is_default: !depth, tier_index, sku: v ? skuOf(v) : '', gtin_code: '', confirm_empty_gtin: false,
    price: String(v ? v.price : 0), stock_setting_list: [{ location_id: '__LOCATION__', sellable_stock: v ? qtyOf(v) : 0 }],
  });
  let model_list;
  let filled = 0;
  if (!depth) model_list = [model(m.variants[0], [])];
  else {
    const by = new Map(m.variants.map((v) => [`${v.options[0]?.value ?? ''}\u0001${depth >= 2 ? (v.options[1]?.value ?? '') : ''}`, v]));
    model_list = [];
    v1.forEach((a, i) => (depth >= 2 ? v2 : ['']).forEach((b, j) => {
      const v = by.get(`${a}\u0001${b}`);
      if (!v) filled += 1;
      const base = v || m.variants.find((x) => (x.options[0]?.value ?? '') === a);
      model_list.push({ ...model(v, depth >= 2 ? [i, j] : [i]), price: String(base.price) });
    }));
  }
  if (filled) warnings.push(`เติมคู่ตัวเลือกที่ขาด ${filled} ตัว (จำนวน 0)`);
  const brand = pickBrand(m);

  // ตะกร้าที่มีอยู่แล้วในร้าน MVP — ส่วนขยายใช้อ่านช่องขนส่ง/คลัง (location) ของร้าน (อ่านอย่างเดียว ไม่แก้)
  const { data: tpl } = await db().from('os_listings').select('product_id').eq('platform', 'shopee').eq('shop', SHOP).eq('status', 'NORMAL').limit(1);
  return {
    id, title: m.title, skus: m.variants.map(skuOf), weightKg: kg, dims, warnings, templateId: tpl?.[0]?.product_id || null,
    product_info: {
      name, description_info: { description, description_type: 'normal' },
      images: gallery.map(okId).filter(Boolean), long_images: [],
      category_path, brand_id: brand.brand_id || 0, attributes: [],
      condition: 1, dangerous_goods: 0, min_purchase_limit: 1,
      weight: { value: String(kg), unit: 1 },
      dimension: { width: String(dims.w), length: String(dims.l), height: String(dims.h) },
      size_chart_info: { size_chart: '', size_chart_id: 0 }, wholesale_list: [],
      pre_order_info: { pre_order: false, days_to_ship: 2 },
      std_tier_variation_list, model_list, unlisted: test,
    },
  };
}
