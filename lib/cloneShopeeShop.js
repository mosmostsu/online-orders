// โคลน Shopee → Shopee คนละร้าน (Shopee SOLID ↔ Shopee REAL)
//
// กฎ (ดู memory never-recreate-baskets): สร้างเฉพาะตะกร้าที่ร้านปลายทาง "ยังไม่มี SKU ไหนเลย" และไม่มีตะกร้าชื่อเดียวกัน
// ตรวจซ้ำทุกครั้งก่อนสร้าง + กันกดซ้ำด้วย os_clone_log · ขั้นใดพังหลังสร้างแล้ว → ลบเฉพาะตะกร้าที่เราเพิ่งสร้าง
//
// แพลตฟอร์มเดียวกัน → หมวด แบรนด์ แอตทริบิวต์ คำอธิบาย ตัวเลือก รูป คัดลอกจากตะกร้าต้นทางตรงๆ (ไม่ต้องเดา ไม่ต้องมีแผนที่)
// ที่ต่าง: ช่องขนส่งใช้ของร้านปลายทาง (กรองตามน้ำหนัก/ขนาด) · สต็อกตาม Seniorsoft · ราคาตามร้านต้นทาง
// ทดสอบ (test: true): ชื่อขึ้นต้น [TEST] · ซ่อน (UNLIST) · SKU ต่อท้าย -TEST · สต็อก 0 → ลบด้วย deleteTestItem ใน lib/cloneShopee.js
import { db } from './supabase.js';
import * as shopee from './shopee.js';
import { saveListings } from './listings.js';
import { shopGroup } from './shopGroups.js';
import { markCompareStale } from './compareSnap.js';
import { low, shopToken, candidates, blockedIds, stCounts, fetchImageBytes, pool, titleKey, titleTwins, twinMsg } from './cloneCommon.js';

export const ROUTES = { REAL: 'SOLID', SOLID: 'REAL' };   // ร้านปลายทาง → ร้านต้นทาง
const keyOf = (src, dst) => `shopee:${src}>shopee:${dst}`;

async function auth(shop) {
  const t = await shopToken('shopee', shop);
  return { accessToken: t.access_token, shopId: t.shop_id, partner: t };
}

// ช่องขนส่งที่รับน้ำหนัก/ขนาดนี้ได้ (Shopee ปฏิเสธทั้งตะกร้าถ้าเปิดช่องที่เกินขีดจำกัด)
function fitsChannel(c, kg, dims) {
  if (!c || !c.enabled) return false;
  const w = c.weight_limit || {};
  if (w.item_max_weight && !(kg >= (w.item_min_weight || 0) && kg <= w.item_max_weight)) return false;
  const m = c.item_max_dimension || {};
  const side = Math.max(m.length || 0, m.width || 0, m.height || 0);
  const sides = [dims.l, dims.w, dims.h];
  if (side && Math.max(...sides) > side) return false;
  if (m.dimension_sum && sides.reduce((a, b) => a + b, 0) > m.dimension_sum) return false;
  return true;
}

// ── วางแผน: ตะกร้า Shopee <ต้นทาง> ที่ Shopee <ปลายทาง> ยังไม่มี (อ่านจากฐานข้อมูลอย่างเดียว) ──
export async function planShopeeToShopee(dst) {
  const src = ROUTES[dst];
  if (!src) throw new Error(`ยังไม่รองรับโคลนไป Shopee ${dst}`);
  const cand = await candidates({ srcPlatform: 'shopee', dstPlatform: 'shopee', shop: src, dstShop: dst });
  const blocked = await blockedIds(keyOf(src, dst), cand.map((c) => c.id));
  const twins = await titleTwins('shopee', dst);
  const items = cand.map((c) => {
    const t = twins.get(titleKey(c.title));
    return {
      ...c, cloned: blocked.get(c.id) || null, category: '',
      shopeeCat: { id: null, name: 'หมวดเดียวกับต้นทาง', votes: 1, of: 1, sure: true },
      attrs: {}, brand: 'ตามต้นทาง',
      problem: t ? twinMsg(`Shopee ${dst}`, t) : null,
    };
  });
  return { items: items.sort((a, b) => String(a.title).localeCompare(String(b.title), 'th')), mapBuiltAt: null, src };
}

// ── โคลนหนึ่งตะกร้า ──
export async function cloneShopeeToShopee({ id, dst, test = false }) {
  const src = ROUTES[dst];
  if (!src) throw new Error(`ยังไม่รองรับโคลนไป Shopee ${dst}`);
  id = String(id || '');
  if (!/^\d+$/.test(id)) throw new Error('เลขตะกร้า Shopee ไม่ถูกต้อง');
  const sb = db();
  const key = keyOf(src, dst);
  if (!test) {
    const b = (await blockedIds(key, [id])).get(id);
    if (b) throw new Error(b.status === 'ok' ? `โคลนไปแล้ว (Shopee ${dst} ${b.thisshop_spu_id})` : 'กำลังโคลนตะกร้านี้อยู่');
  }
  // ตรวจซ้ำ: ปลายทางต้องยังไม่มี SKU ไหนของตะกร้านี้ และไม่มีตะกร้าชื่อเดียวกัน
  const cand = await candidates({ srcPlatform: 'shopee', dstPlatform: 'shopee', shop: src, dstShop: dst });
  if (!cand.some((c) => c.id === id)) throw new Error(`Shopee ${dst} มี SKU ของตะกร้านี้แล้ว หรือตะกร้าไม่ได้ขายอยู่ใน Shopee ${src} — ไม่โคลน`);

  const sa = await auth(src);
  const [base] = await shopee.getItemBaseInfo({ ...sa, itemIds: [id] });
  if (!base) throw new Error(`ไม่พบตะกร้านี้ใน Shopee ${src}`);
  const models = base.has_model ? await shopee.getModelList({ ...sa, itemId: id }) : null;
  const twin = (await titleTwins('shopee', dst)).get(titleKey(base.item_name));
  if (twin) throw new Error(twinMsg(`Shopee ${dst}`, twin));
  const list = models?.model || [];
  const skus = base.has_model ? list.map((m) => String(m.model_sku || '').trim()) : [String(base.item_sku || '').trim()];
  if (skus.some((s) => !s)) throw new Error('มีตัวเลือกที่ไม่มีรหัส SKU');
  const dup = skus.filter((s, i) => skus.findIndex((x) => low(x) === low(s)) !== i);
  if (dup.length) throw new Error(`รหัส SKU ซ้ำกันในตะกร้า (${[...new Set(dup)].slice(0, 3).join(', ')})`);

  const da = await auth(dst);
  let logId = null;
  if (!test) {
    const { data, error } = await sb.from('os_clone_log')
      .insert({ shopee_shop: key, shopee_product_id: id, status: 'pending', title: base.item_name }).select('id').single();
    if (error) throw new Error(error.message);
    logId = data.id;
  }
  const finish = (patch) => (logId ? sb.from('os_clone_log').update(patch).eq('id', logId).then(() => null, () => null) : null);
  const skuOf = (s) => `${s}${test ? '-TEST' : ''}`;
  let itemId = null;
  try {
    const warnings = [];
    const kg = Number(base.weight) || 0.1;
    const dim = base.dimension || {};
    const dims = { l: Number(dim.package_length) || 1, w: Number(dim.package_width) || 1, h: Number(dim.package_height) || 1 };
    const logistic_info = (await shopee.getChannelList(da)).filter((c) => fitsChannel(c, kg, dims))
      .map((c) => ({ logistic_id: c.logistics_channel_id, enabled: true }));
    if (!logistic_info.length) throw new Error(`Shopee ${dst} ไม่มีช่องขนส่งที่รับน้ำหนัก ${kg} kg / ขนาด ${dims.l}×${dims.w}×${dims.h} cm`);

    // รูป: ลองใช้รหัสรูปเดิมของ Shopee (แพลตฟอร์มเดียวกัน) — ถ้าร้านปลายทางไม่รับ ค่อยดาวน์โหลดแล้วอัปโหลดใหม่ (useCopy = false)
    const optTiers = models?.tier_variation || [];
    const reupload = async (url) => {
      const { bytes, type } = await fetchImageBytes(url);
      return shopee.uploadImage({ bytes, contentType: type, filename: type.includes('png') ? 'a.png' : 'a.jpg', partner: da.partner });
    };
    const images = async (useCopy) => {
      if (useCopy) {
        return {
          gallery: base.image?.image_id_list || [],
          opt: optTiers.map((t) => (t.option_list || []).map((o) => o.image?.image_id || null)),
        };
      }
      const g = await pool(base.image?.image_url_list || [], 4, (u) => reupload(u).catch(() => null));
      const opt = [];
      for (const t of optTiers) opt.push(await pool(t.option_list || [], 4, (o) => (o.image?.image_url ? reupload(o.image.image_url).catch(() => null) : null)));
      return { gallery: g.filter(Boolean), opt };
    };

    let name = base.item_name;
    if (test) name = `[TEST] ลบได้ ${name}`.slice(0, 120);
    const stock = await stCounts(skus);
    const qtyOf = (s) => (test ? 0 : (stock.get(low(s)) ?? 0));
    const priceOf = (x) => Number(x?.price_info?.[0]?.original_price) || 0;
    const attribute_list = (base.attribute_list || []).map((a) => ({
      attribute_id: a.attribute_id,
      attribute_value_list: (a.attribute_value_list || []).map((v) => ({ value_id: v.value_id || 0, original_value_name: v.original_value_name || '', value_unit: v.value_unit || '' })),
    }));
    if (!base.has_model && !(priceOf(base) > 0)) throw new Error('ราคาเป็น 0');
    if (list.some((m) => !(priceOf(m) > 0))) throw new Error('มีตัวเลือกที่ราคาเป็น 0');
    if (base.size_chart_id && !base.size_chart) warnings.push('ตารางไซส์ของร้านต้นทางเป็นแบบเทมเพลตของร้าน — ไม่ได้คัดลอก ใส่เองในหลังร้าน');

    const bodyOf = (img) => ({
      item_name: name, category_id: base.category_id,
      ...(base.description_type === 'extended' && base.description_info ? { description_type: 'extended', description_info: base.description_info } : { description: base.description || name }),
      original_price: base.has_model ? priceOf(list[0]) : priceOf(base),
      seller_stock: [{ stock: base.has_model ? 0 : qtyOf(skus[0]) }],
      weight: kg, dimension: { package_length: dims.l, package_width: dims.w, package_height: dims.h },
      image: { image_id_list: img.gallery }, logistic_info, condition: base.condition || 'NEW',
      item_status: test ? 'UNLIST' : 'NORMAL',
      brand: { brand_id: base.brand?.brand_id || 0, original_brand_name: base.brand?.original_brand_name || 'NoBrand' },
      attribute_list,
      ...(base.pre_order ? { pre_order: { is_pre_order: !!base.pre_order.is_pre_order, days_to_ship: base.pre_order.days_to_ship || 2 } } : {}),
      ...(base.size_chart ? { size_chart: base.size_chart } : {}),
      ...(base.has_model ? {} : { item_sku: skuOf(skus[0]) }),
    });
    let img = await images(true);
    let r;
    try {
      r = await shopee.addItem({ ...da, body: bodyOf(img) });
    } catch (e) {
      if (!/image/i.test(String(e.message))) throw e;
      warnings.push('รหัสรูปเดิมใช้ไม่ได้ในร้านปลายทาง — อัปโหลดรูปใหม่');
      img = await images(false);
      if (!img.gallery.length) throw new Error('อัปโหลดรูปไม่ได้');
      r = await shopee.addItem({ ...da, body: bodyOf(img) });
    }
    itemId = r.item_id;
    if (!itemId) throw new Error('Shopee ไม่คืน item_id');

    let modelN = 1;
    if (base.has_model) {
      const tier_variation = optTiers.map((t, ti) => ({
        name: t.name,
        option_list: (t.option_list || []).map((o, oi) => ({ option: o.option, ...(img.opt[ti]?.[oi] ? { image: { image_id: img.opt[ti][oi] } } : {}) })),
      }));
      const model = list.map((m) => ({
        tier_index: m.tier_index, original_price: priceOf(m), model_sku: skuOf(String(m.model_sku).trim()),
        seller_stock: [{ stock: qtyOf(String(m.model_sku).trim()) }],
      }));
      await shopee.initTierVariation({ ...da, body: { item_id: itemId, tier_variation, model } });
      modelN = model.length;
    }

    // ตรวจหลังสร้าง + บันทึกลงฐานข้อมูลให้หน้า compare เห็น
    const [nb] = await shopee.getItemBaseInfo({ ...da, itemIds: [String(itemId)] });
    const nm = base.has_model ? await shopee.getModelList({ ...da, itemId }) : null;
    const got = base.has_model ? (nm?.model || []).length : 1;
    if (got !== modelN) warnings.push(`ตัวเลือกในร้านปลายทาง ${got} ≠ ต้นทาง ${modelN}`);
    if (!test && nb) {
      try {
        await saveListings([shopee.normalizeListing(nb, nm, dst)]);
        await markCompareStale(shopGroup('shopee', dst));
      } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
    }
    await finish({ status: 'ok', thisshop_spu_id: String(itemId), title: name, sku_n: modelN });
    return { itemId: String(itemId), status: nb?.item_status || null, name, categoryId: base.category_id, brand: base.brand?.original_brand_name || null, models: got, images: img.gallery.length, warnings };
  } catch (e) {
    if (itemId) { try { await shopee.deleteItem({ ...da, itemId }); } catch { /* ไม่เป็นไร */ } }
    await finish({ status: 'failed', error: String(e.message || e).slice(0, 500) });
    throw e;
  }
}
