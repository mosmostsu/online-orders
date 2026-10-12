// โคลน TikTok → TikTok คนละร้าน (TikTok SOLID → TikTok MVP)
//
// กฎ (ดู memory never-recreate-baskets): สร้างเฉพาะตะกร้าที่ร้านปลายทาง "ยังไม่มี SKU ไหนเลย" — ไม่แตะตะกร้าที่มีอยู่แล้ว
// ตรวจซ้ำทุกครั้งก่อนสร้าง + กันกดซ้ำด้วย os_clone_log · ขั้นใดพังหลังสร้างแล้ว → ลบเฉพาะตะกร้าที่เราเพิ่งสร้าง
//
// แพลตฟอร์มเดียวกัน → หมวด/แบรนด์/แอตทริบิวต์/ตัวเลือก ใช้ของต้นทางได้ตรงๆ ไม่ต้องมีแผนที่
// แต่รูป (รวมรูปตัวเลือกและตารางไซส์) ต้องอัปโหลดใหม่ด้วยโทเคนของร้านปลายทาง (คนละแอป: MVP ใช้แอปของตัวเอง)
// คำอธิบายส่งเป็นข้อความล้วน (รูปในคำอธิบายของต้นทางเป็นของร้านต้นทาง) · คลังใช้คลังหลักของร้านปลายทาง
// ทดสอบ (test: true): แบบร่าง (DRAFT) · [TEST] · SKU -TEST · จำนวน 0 → ลบด้วย deleteTestProduct ใน lib/cloneTiktok.js
import { db } from './supabase.js';
import * as tiktok from './tiktok.js';
import { saveListings } from './listings.js';
import { shopGroup } from './shopGroups.js';
import { fromTikTok, htmlToText, cleanTitle } from './productModel.js';
import { low, pool, shopToken, skuSet, candidates, blockedIds, stCounts, fetchImageBytes } from './cloneCommon.js';

export const ROUTES = { MVP: 'SOLID' };   // ร้านปลายทาง → ร้านต้นทาง
const keyOf = (src, dst) => `tiktok:${src}>tiktok:${dst}`;
const MAX_IMAGES = 9;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toHtml = (text) => text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');
const firstUrl = (img) => (img?.urls || [])[0] || null;

async function auth(shop) {
  const t = await shopToken('tiktok', shop);
  return { accessToken: t.access_token, shopCipher: t.shop_cipher };
}

function blocker(p, m) {
  const skus = m.variants.map((v) => v.sku);
  if (!m.categoryLeafId) return 'ไม่มีหมวดในตะกร้าต้นทาง';
  if (skus.some((s) => !s)) return 'มีตัวเลือกที่ไม่มีรหัส SKU';
  const dup = skus.filter((s, i) => skus.findIndex((x) => low(x) === low(s)) !== i);
  if (dup.length) return `รหัส SKU ซ้ำกันในตะกร้า (${[...new Set(dup)].slice(0, 3).join(', ')}) — แก้รหัสใน TikTok ก่อน`;
  if (m.variants.some((v) => !(v.price > 0))) return 'มีตัวเลือกที่ราคาเป็น 0';
  if (!(p.main_images || []).some(firstUrl)) return 'ไม่มีรูปสินค้า';
  return null;
}

// อ่านจากฐานข้อมูลอย่างเดียว (ตะกร้าผู้สมัครหลายร้อยใบ ถาม TikTok ทีละใบไม่ทันเพดานเวลา) — หมวด/แบรนด์ใช้ของต้นทางอยู่แล้ว
// ปัญหาเฉพาะตะกร้า (SKU ว่าง/ซ้ำ ราคา 0 ไม่มีรูป) ตรวจตอนกดโคลนจริง แล้วขึ้นเป็นข้อผิดพลาดของแถวนั้น
export async function planTiktokToTiktok(dst) {
  const src = ROUTES[dst];
  if (!src) throw new Error(`ยังไม่รองรับโคลนไป TikTok ${dst}`);
  const cand = await candidates({ srcPlatform: 'tiktok', dstPlatform: 'tiktok', shop: src, dstShop: dst });
  const blocked = await blockedIds(keyOf(src, dst), cand.map((c) => c.id));
  const items = cand.map((c) => ({
    ...c, cloned: blocked.get(c.id) || null, category: '',
    tiktokCat: { id: null, name: 'หมวดเดียวกับต้นทาง', votes: 1, of: 1, sure: true },
    attrs: {}, brand: 'ตามต้นทาง', problem: null,
  }));
  return { items: items.sort((x, y) => String(x.title).localeCompare(String(y.title), 'th')), mapBuiltAt: null, src };
}

export async function cloneTiktokToTiktok({ id, dst, test = false }) {
  const src = ROUTES[dst];
  if (!src) throw new Error(`ยังไม่รองรับโคลนไป TikTok ${dst}`);
  id = String(id || '');
  if (!/^\d+$/.test(id)) throw new Error('เลขตะกร้า TikTok ไม่ถูกต้อง');
  const sb = db();
  const key = keyOf(src, dst);
  if (!test) {
    const b = (await blockedIds(key, [id])).get(id);
    if (b) throw new Error(b.status === 'ok' ? `โคลนไปแล้ว (TikTok ${dst} ${b.thisshop_spu_id})` : 'กำลังโคลนตะกร้านี้อยู่');
  }
  const sa = await auth(src);
  const p = await tiktok.getProduct({ ...sa, productId: id });
  const m = fromTikTok(p, src);
  const why = blocker(p, m);
  if (why) throw new Error(why);
  const onDst = await skuSet('tiktok', dst);
  const clash = m.variants.map((v) => v.sku).filter((s) => onDst.has(low(s)));
  if (clash.length) throw new Error(`TikTok ${dst} มี SKU นี้แล้ว (${clash.slice(0, 3).join(', ')}) — ไม่โคลน`);

  const da = await auth(dst);
  const wh = ((await tiktok.call('/logistics/202309/warehouses', da)).warehouses || [])
    .filter((w) => w.type === 'SALES_WAREHOUSE' && w.effect_status === 'ENABLED');
  const warehouseId = (wh.find((w) => w.is_default) || wh[0])?.id;
  if (!warehouseId) throw new Error(`ไม่พบคลังสินค้าของ TikTok ${dst}`);

  let logId = null;
  if (!test) {
    const { data, error } = await sb.from('os_clone_log')
      .insert({ shopee_shop: key, shopee_product_id: id, status: 'pending', title: m.title }).select('id').single();
    if (error) throw new Error(error.message);
    logId = data.id;
  }
  const finish = (patch) => (logId ? sb.from('os_clone_log').update(patch).eq('id', logId).then(() => null, () => null) : null);
  const skuOf = (v) => `${v.sku}${test ? '-TEST' : ''}`;
  let productId = null;
  try {
    // รูปทั้งหมด → อัปโหลดใหม่ด้วยโทเคนร้านปลายทาง
    const gallery = (p.main_images || []).map(firstUrl).filter(Boolean).slice(0, MAX_IMAGES);
    const skuImgs = (p.skus || []).flatMap((s) => (s.sales_attributes || []).map((x) => firstUrl(x.sku_img))).filter(Boolean);
    const chart = firstUrl(p.size_chart?.image);
    const jobs = [
      ...[...new Set(gallery)].map((u) => [u, 'MAIN_IMAGE']),
      ...[...new Set(skuImgs)].filter((u) => !gallery.includes(u)).map((u) => [u, 'ATTRIBUTE_IMAGE']),
      ...(chart ? [[chart, 'SIZE_CHART_IMAGE']] : []),
    ];
    const up = new Map();
    await pool(jobs, 4, async ([u, useCase]) => {
      try {
        const { bytes, type } = await fetchImageBytes(u, 'image/jpeg,image/png,image/webp');
        up.set(u, await tiktok.uploadImage({ accessToken: da.accessToken, bytes, contentType: type, useCase }));
      } catch (e) { up.set(u, e); }
    });
    const okUri = (u) => { const v = up.get(u); return v && !(v instanceof Error) ? v : null; };
    if (!okUri(gallery[0])) throw new Error(`รูปหลักอัปโหลดเข้า TikTok ${dst} ไม่ได้: ${up.get(gallery[0])?.message || ''}`);
    if (chart && !okUri(chart)) throw new Error(`ตารางไซส์อัปโหลดไม่ได้: ${up.get(chart)?.message || ''}`);
    const warnings = [...up.values()].filter((v) => v instanceof Error).map((e) => `ข้ามรูป: ${e.message}`);

    let title = cleanTitle(m.title) || m.title;
    if (test) title = `[TEST] ลบได้ ${title}`;
    title = title.slice(0, 255);
    const text = htmlToText(m.descriptionHtml, 9000) || title;
    const stock = await stCounts(m.variants.map((v) => v.sku));
    const qtyOf = (v) => (test ? 0 : (stock.has(low(v.sku)) ? stock.get(low(v.sku)) : Math.max(0, Math.round(v.qty || 0))));

    const skus = (p.skus || []).map((s, i) => {
      const v = m.variants[i];
      const sales_attributes = (s.sales_attributes || []).map((x) => {
        const img = okUri(firstUrl(x.sku_img));
        return { name: x.name, value_name: x.value_name, ...(img ? { sku_img: { uri: img } } : {}) };
      });
      return {
        ...(sales_attributes.length ? { sales_attributes } : {}),
        seller_sku: skuOf(v),
        price: { amount: String(v.price), currency: 'THB' },
        inventory: [{ warehouse_id: warehouseId, quantity: qtyOf(v) }],
      };
    });
    const pw = p.package_weight || {};
    const pd = p.package_dimensions || {};
    const body = {
      ...(test ? { save_mode: 'AS_DRAFT' } : {}),
      category_version: 'v2',
      category_id: m.categoryLeafId,
      title,
      description: toHtml(text),
      main_images: gallery.map(okUri).filter(Boolean).map((uri) => ({ uri })),
      skus,
      ...(pw.value ? { package_weight: { value: String(pw.value), unit: pw.unit || 'KILOGRAM' } } : {}),
      ...(pd.length ? { package_dimensions: { length: String(pd.length), width: String(pd.width), height: String(pd.height), unit: pd.unit || 'CENTIMETER' } } : {}),
      ...(p.brand?.id ? { brand_id: p.brand.id } : {}),
      ...(chart ? { size_chart: { image: { uri: okUri(chart) } } } : {}),
      ...((p.product_attributes || []).length ? {
        product_attributes: p.product_attributes.map((x) => ({
          id: x.id, values: (x.values || []).map((v) => (v.id ? { id: v.id, name: v.name } : { name: v.name })),
        })),
      } : {}),
    };
    let res;
    try {
      res = await tiktok.createProduct({ ...da, body });
    } catch (e) {
      // แบรนด์ที่ร้านต้นทางได้รับอนุญาต ร้านปลายทางอาจยังไม่ได้ → ลองใหม่แบบไม่ใส่แบรนด์ (บอกในคำเตือน)
      if (!body.brand_id || !/brand/i.test(String(e.message))) throw e;
      delete body.brand_id;
      warnings.push(`ไม่ใส่แบรนด์ ${p.brand.name} (ร้าน ${dst} ใช้แบรนด์นี้ไม่ได้: ${String(e.message).slice(0, 120)})`);
      res = await tiktok.createProduct({ ...da, body });
    }
    productId = res.product_id ? String(res.product_id) : null;
    if (!productId) throw new Error('TikTok ไม่คืน product_id');

    let status = test ? 'DRAFT' : null;
    if (!test) {
      try {
        const np = await tiktok.getProduct({ ...da, productId });
        status = np.status || null;
        await saveListings([tiktok.normalizeListing(np, dst)]);
        await sb.from('os_compare_snap').delete().eq('grp', shopGroup('tiktok', dst));
      } catch { /* รอบดึงสินค้าจะตามมาเอง */ }
    }
    await finish({ status: 'ok', thisshop_spu_id: productId, title, sku_n: skus.length });
    return {
      itemId: productId, status, name: title, categoryId: m.categoryLeafId, brand: body.brand_id ? p.brand.name : null,
      sizeChart: Boolean(chart), skus: skus.map((s) => s.seller_sku), models: (res.skus || []).length || skus.length,
      images: body.main_images.length, warnings,
    };
  } catch (e) {
    if (productId) { try { await tiktok.deleteProducts({ ...da, productIds: [productId] }); } catch { /* ไม่เป็นไร */ } }
    await finish({ status: 'failed', error: String(e.message || e).slice(0, 500) });
    throw e;
  }
}
