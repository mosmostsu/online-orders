// โคลนสินค้า Shopee REAL → ThisShop (ปุ่ม "โคลนไป ThisShop" ในหน้า /allsite/report)
//
// หน่วยที่โคลนคือ "ตะกร้า" ของ Shopee (item_id) ทั้งตะกร้า — สี × ไซส์ ครบทุกตัวเลือก
// เลือกได้เฉพาะตะกร้าที่ไม่มีตัวเลือกไหนอยู่ใน ThisShop เลย (มีบางตัวแล้ว = ข้าม กันสินค้าซ้ำสองตะกร้า)
//
// ค่าที่ตั้ง (ผู้ใช้สั่ง 2026-10-12): ขายทันที · ราคา = ราคาป้ายเต็ม (original_price ไม่ใช่ราคาโปร)
// สต็อก = Seniorsoft (os_st) ถ้ารหัสนั้นไม่อยู่ใน ST ค่อยใช้เลขที่ตั้งไว้บน Shopee
import { db } from './supabase.js';
import * as shopee from './shopee.js';
import * as thisshop from './thisshop.js';
import { listShops, usableToken } from './tokens.js';

export const SRC_SHOP = 'REAL';
const IMG_LIMIT = 800 * 1024;     // ThisShop รับรูปไม่เกิน 800KB
const MAX_GALLERY = 9;
const MAX_DESC_IMAGES = 3;
const MAX_PLAN_LIVE = 300;        // ถามหมวด/แบรนด์สดจาก Shopee ไม่เกินกี่ตะกร้าต่อรอบ
const PENDING_MIN = 15;           // แถว pending เกินกี่นาทีถือว่าค้าง (ฟังก์ชันตาย) ให้โคลนซ้ำได้

const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const low = (s) => String(s || '').trim().toLowerCase();
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9฀-๿]/g, '');

// ชื่อ Shopee ติดป้ายโปรหน้าชื่อ เช่น "💸ลด65.-ใส่โค้ดXXXX💸ไม้แบดมินตัน…" — ตัดคู่อีโมจิที่ล้อมข้อความออก
export function cleanTitle(s) {
  return String(s || '')
    .replace(/(\p{Extended_Pictographic}️?)[^\p{Extended_Pictographic}]{0,80}?\1/gu, ' ')
    .replace(/[\p{Extended_Pictographic}️]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ดึงทั้งตารางทีละ 1000 แถว (PostgREST ตัดที่ 1000) — make() ต้องสร้างคำถามใหม่ทุกครั้ง
async function selectAll(make) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const missingTable = (e) => /os_clone_(log|map)|42P01/.test(`${e?.code || ''} ${e?.message || ''}`);

async function shopeeAuth() {
  const row = (await listShops('shopee')).find((r) => String(r.shop).toUpperCase() === SRC_SHOP);
  if (!row) throw new Error(`ไม่พบร้าน Shopee ${SRC_SHOP} ในตารางโทเคน`);
  const u = await usableToken(row);
  return { accessToken: u.access_token, shopId: u.shop_id, partner: u };
}

// ── วางแผน: ตะกร้าไหนโคลนได้ ──────────────────────────────────────────────
// skus = รหัส ST ที่เลือก/กรองไว้ในรายงาน → หาตะกร้า Shopee REAL ที่มีรหัสเหล่านี้ → ดูว่าอยู่ใน ThisShop แล้วหรือยัง
// productIdList = เลขตะกร้า Shopee REAL ที่ส่งมาตรงๆ (หน้า /compare) — ไม่ต้องหาจาก SKU
export async function planClone(skuList, productIdList = []) {
  const sb = db();
  const skus = [...new Set((skuList || []).map((s) => String(s).trim()).filter(Boolean))];
  const forms = [...new Set(skus.flatMap((s) => [s, s.toLowerCase(), s.toUpperCase()]))];

  const productIds = new Set((productIdList || []).map((s) => String(s).trim()).filter(Boolean));
  for (const c of chunks(forms, 200)) {
    const { data, error } = await sb.from('os_listing_skus').select('product_id')
      .eq('platform', 'shopee').eq('shop', SRC_SHOP).in('seller_sku', c);
    if (error) throw error;
    for (const r of data || []) productIds.add(r.product_id);
  }
  const ids = [...productIds];
  if (!ids.length) return { ok: true, needsSql: false, counts: { ready: 0, partial: 0, on: 0, cloned: 0 }, cats: [], products: [] };

  const [variants, metas, onThis] = await Promise.all([
    (async () => {
      const out = [];
      for (const c of chunks(ids, 40)) {
        out.push(...await selectAll(() => sb.from('os_listing_skus')
          .select('product_id, sku_id, seller_sku, variant, price, stock, sort')
          .eq('platform', 'shopee').eq('shop', SRC_SHOP).in('product_id', c)
          .order('product_id').order('sort').order('sku_id')));
      }
      return out;
    })(),
    (async () => {
      const out = [];
      for (const c of chunks(ids, 100)) {
        const { data, error } = await sb.from('os_listings').select('product_id, title, thumb_url, status')
          .eq('platform', 'shopee').eq('shop', SRC_SHOP).in('product_id', c);
        if (error) throw error;
        out.push(...(data || []));
      }
      return out;
    })(),
    // ThisShop ทั้งร้าน — เทียบแบบ lower(trim) เหมือนที่ os_st_on ใช้ (ไม่เอาเฉพาะรหัสที่ถาม กันพลาดเรื่องตัวพิมพ์)
    selectAll(() => sb.from('os_listing_skus').select('seller_sku').eq('platform', 'thisshop').order('sku_id')),
  ]);
  const present = new Set(onThis.map((r) => low(r.seller_sku)).filter(Boolean));
  const meta = new Map(metas.map((m) => [m.product_id, m]));

  // ประวัติโคลน
  let needsSql = false;
  const logged = new Map();
  try {
    for (const c of chunks(ids, 100)) {
      const { data, error } = await sb.from('os_clone_log')
        .select('shopee_product_id, thisshop_spu_id, status, created_at')
        .eq('shopee_shop', SRC_SHOP).in('shopee_product_id', c).in('status', ['ok', 'pending']);
      if (error) throw error;
      for (const r of data || []) {
        const stale = r.status === 'pending' && Date.now() - new Date(r.created_at).getTime() > PENDING_MIN * 60000;
        if (!stale) logged.set(r.shopee_product_id, r);
      }
    }
  } catch (e) {
    if (!missingTable(e)) throw e;
    needsSql = true;
  }

  const byProduct = new Map();
  for (const v of variants) {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
    byProduct.get(v.product_id).push(v);
  }

  const products = ids.map((id) => {
    const vs = byProduct.get(id) || [];
    const m = meta.get(id) || {};
    const have = vs.filter((v) => present.has(low(v.seller_sku)));
    const prices = vs.map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
    let state = 'ready';
    if (logged.has(id)) state = 'cloned';
    else if (vs.length && have.length === vs.length) state = 'on';
    else if (have.length) state = 'partial';
    const noSku = vs.some((v) => !String(v.seller_sku || '').trim());
    return {
      id, title: m.title || '', clean: cleanTitle(m.title), thumb: m.thumb_url || null, status: m.status || null,
      state, n: vs.length, noSku,
      priceMin: prices.length ? Math.min(...prices) : null, priceMax: prices.length ? Math.max(...prices) : null,
      skus: vs.slice(0, 80).map((v) => ({ sku: v.seller_sku, variant: v.variant })),
      presentN: have.length,
      spuId: logged.get(id)?.thisshop_spu_id || null,
      catId: null, catName: null, brandName: null, thisCat: null, brandId: null, brandMatched: null,
    };
  });

  // หมวด/แบรนด์สด — เฉพาะตะกร้าที่โคลนได้ (ready) และไม่เกิน MAX_PLAN_LIVE
  const ready = products.filter((p) => p.state === 'ready' && !p.noSku && p.status === 'NORMAL').slice(0, MAX_PLAN_LIVE);
  let liveError = null;
  if (ready.length) {
    try {
      const auth = await shopeeAuth();
      const bases = await shopee.getItemBaseInfo({ ...auth, itemIds: ready.map((p) => p.id) });
      const catNames = await shopeeCategoryNames(auth).catch(() => new Map());
      const byId = new Map(bases.map((b) => [String(b.item_id), b]));
      for (const p of ready) {
        const b = byId.get(p.id);
        if (!b) continue;
        p.catId = b.category_id ? String(b.category_id) : null;
        p.catName = p.catId ? (catNames.get(p.catId) || `หมวด ${p.catId}`) : null;
        p.brandName = b.brand?.original_brand_name || null;
        p.imageN = (b.image?.image_url_list || []).length;
      }
    } catch (e) {
      liveError = String(e.message || e);
    }
  }

  // หมวดที่เคยจับคู่ไว้ + แบรนด์ที่ตรงชื่อ
  const catIds = [...new Set(ready.map((p) => p.catId).filter(Boolean))];
  const mapRows = new Map();
  if (catIds.length && !needsSql) {
    try {
      const { data, error } = await sb.from('os_clone_map').select('*').in('shopee_cat', catIds);
      if (error) throw error;
      for (const r of data || []) mapRows.set(r.shopee_cat, r);
    } catch (e) {
      if (!missingTable(e)) throw e;
      needsSql = true;
    }
  }
  const brandCache = new Map();
  if (mapRows.size) {
    const token = await thisshop.getToken();
    for (const r of mapRows.values()) {
      if (!brandCache.has(r.thisshop_cat)) {
        brandCache.set(r.thisshop_cat, await thisshop.categoryBrands(token, r.thisshop_cat).catch(() => []));
      }
    }
  }
  for (const p of ready) {
    const m = p.catId ? mapRows.get(p.catId) : null;
    if (!m) continue;
    p.thisCat = { id: m.thisshop_cat, name: m.thisshop_cat_name };
    const hit = (brandCache.get(m.thisshop_cat) || []).find((b) => p.brandName && (norm(b.name) === norm(p.brandName) || norm(b.nameLocal) === norm(p.brandName)));
    if (hit) { p.brandId = hit.id; p.brandMatched = hit.name; }
  }

  const cats = new Map();
  for (const p of ready) {
    if (!p.catId) continue;
    if (!cats.has(p.catId)) cats.set(p.catId, { id: p.catId, name: p.catName, count: 0, mapped: mapRows.get(p.catId) ? { id: mapRows.get(p.catId).thisshop_cat, name: mapRows.get(p.catId).thisshop_cat_name } : null });
    cats.get(p.catId).count += 1;
  }

  const counts = { ready: 0, partial: 0, on: 0, cloned: 0 };
  for (const p of products) counts[p.state] += 1;
  // เรียง: โคลนได้ก่อน แล้วชื่อ
  const order = { ready: 0, partial: 1, cloned: 2, on: 3 };
  products.sort((a, b) => order[a.state] - order[b.state] || a.clean.localeCompare(b.clean));
  return { ok: true, needsSql, liveError, counts, cats: [...cats.values()], products };
}

// ชื่อหมวด Shopee (ภาษาไทย) เป็นแบบเส้นทาง "แม่ › ลูก" — ทั้งต้นไม้ครั้งเดียว
let catCache = { at: 0, map: null };
async function shopeeCategoryNames(auth) {
  if (catCache.map && Date.now() - catCache.at < 3600000) return catCache.map;
  const d = await shopee.call('/api/v2/product/get_category', { ...auth, params: { language: 'th' } });
  const list = d.category_list || [];
  const byId = new Map(list.map((c) => [String(c.category_id), c]));
  const path = (c) => {
    const parts = [];
    for (let cur = c, g = 0; cur && g < 6; g++) {
      parts.unshift(cur.display_category_name || cur.original_category_name || String(cur.category_id));
      cur = cur.parent_category_id ? byId.get(String(cur.parent_category_id)) : null;
    }
    return parts.join(' › ');
  };
  const map = new Map(list.map((c) => [String(c.category_id), path(c)]));
  catCache = { at: Date.now(), map };
  return map;
}

// ── ลงมือโคลนหนึ่งตะกร้า ──────────────────────────────────────────────────
async function download(url) {
  const res = await fetch(url, { headers: { accept: 'image/jpeg,image/png,image/*;q=0.5' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`โหลดรูปจาก Shopee ไม่ได้ (${res.status})`);
  const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (/webp|avif/.test(type)) throw new Error(`รูปเป็น ${type} ThisShop ไม่รับ`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > IMG_LIMIT) throw new Error(`รูปใหญ่เกิน 800KB (${Math.round(buf.length / 1024)}KB)`);
  return { buf, type };
}
const extOf = (t) => (t.includes('png') ? 'png' : t.includes('gif') ? 'gif' : t.includes('bmp') ? 'bmp' : 'jpg');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const attNameOf = (n) => {
  const t = String(n || '').toLowerCase();
  if (/สี|colou?r/.test(t)) return 'color';          // ชื่อแบบที่สินค้าเดิมใน ThisShop ใช้
  if (/ไซส์|ไซด์|ขนาด|size/.test(t)) return 'Size';
  return String(n || 'Option').slice(0, 128);
};

function describe(base) {
  const fields = base.description_info?.extended_description?.field_list || [];
  const texts = [], images = [];
  for (const f of fields) {
    if (f.field_type === 'text' && f.text) texts.push(f.text);
    if (f.field_type === 'image') { const u = f.image_info?.image_url; if (u) images.push(u); }
  }
  if (!fields.length && base.description) texts.push(base.description);
  return { text: texts.join(' ').replace(/\s+/g, ' ').trim(), images: images.slice(0, MAX_DESC_IMAGES) };
}

export async function runClone({ productId, categoryId, categoryName = null, brandId, brandName = null, title = null }) {
  const sb = db();
  productId = String(productId || '');
  if (!productId || !categoryId || !brandId) throw new Error('ต้องระบุตะกร้า หมวด และแบรนด์ของ ThisShop');

  // กันกดซ้ำ/โคลนซ้ำ — จองแถวก่อนเริ่มทำงาน
  const { data: dup, error: e0 } = await sb.from('os_clone_log').select('id, status, created_at, thisshop_spu_id')
    .eq('shopee_shop', SRC_SHOP).eq('shopee_product_id', productId).in('status', ['ok', 'pending']);
  if (e0) {
    if (missingTable(e0)) throw new Error('ยังไม่ได้รัน supabase/054_clone_thisshop.sql ใน Supabase');
    throw e0;
  }
  for (const r of dup || []) {
    const stale = r.status === 'pending' && Date.now() - new Date(r.created_at).getTime() > PENDING_MIN * 60000;
    if (!stale) throw new Error(r.status === 'ok' ? `โคลนไปแล้ว (spuId ${r.thisshop_spu_id})` : 'กำลังโคลนตะกร้านี้อยู่');
  }
  const { data: logRow, error: e1 } = await sb.from('os_clone_log')
    .insert({ shopee_shop: SRC_SHOP, shopee_product_id: productId, status: 'pending' }).select('id').single();
  if (e1) throw e1;
  const finish = (patch) => sb.from('os_clone_log').update(patch).eq('id', logRow.id).then(() => null, () => null);

  try {
    const auth = await shopeeAuth();
    const [base] = await shopee.getItemBaseInfo({ ...auth, itemIds: [productId] });
    if (!base) throw new Error('Shopee ไม่ตอบข้อมูลตะกร้านี้ (อาจถูกลบแล้ว)');
    const models = base.has_model ? await shopee.getModelList({ ...auth, itemId: productId }) : null;

    // ── ตัวเลือก ──
    const tiers = models?.tier_variation || [];
    const rows = [];
    if (base.has_model && models?.model?.length) {
      for (const m of models.model) {
        const opts = (m.tier_index || []).map((ix, t) => tiers[t]?.option_list?.[ix]);
        rows.push({
          sku: String(m.model_sku || '').trim(),
          opts, tierNames: (m.tier_index || []).map((_, t) => tiers[t]?.name),
          price: Number(m.price_info?.[0]?.original_price ?? m.price_info?.[0]?.current_price ?? 0),
          shopeeStock: Number(m.stock_info_v2?.summary_info?.total_available_stock ?? 0),
          order: m.tier_index || [],
        });
      }
      rows.sort((a, b) => {
        for (let i = 0; i < Math.max(a.order.length, b.order.length); i++) if ((a.order[i] ?? 0) !== (b.order[i] ?? 0)) return (a.order[i] ?? 0) - (b.order[i] ?? 0);
        return 0;
      });
    } else {
      rows.push({
        sku: String(base.item_sku || '').trim(), opts: [], tierNames: [],
        price: Number(base.price_info?.[0]?.original_price ?? base.price_info?.[0]?.current_price ?? 0),
        shopeeStock: Number(base.stock_info_v2?.summary_info?.total_available_stock ?? 0), order: [],
      });
    }
    const noSku = rows.filter((r) => !r.sku);
    if (noSku.length) throw new Error(`มี ${noSku.length} ตัวเลือกที่ไม่มีรหัส SKU ใน Shopee — ใส่รหัสก่อนแล้วค่อยโคลน`);
    if (rows.some((r) => !(r.price > 0))) throw new Error('มีตัวเลือกที่ราคาเป็น 0 ใน Shopee');

    // สต็อกจริงจาก Seniorsoft
    const stForms = [...new Set(rows.flatMap((r) => [r.sku, r.sku.toLowerCase(), r.sku.toUpperCase()]))];
    const { data: stRows, error: eSt } = await sb.from('os_st').select('sku, qty').in('sku', stForms);
    if (eSt) throw eSt;
    const stQty = new Map((stRows || []).map((r) => [low(r.sku), Math.max(0, Number(r.qty) || 0)]));

    // ── รูป: โหลดจาก Shopee → อัปโหลดเข้า ThisShop ──
    const gallery = (base.image?.image_url_list || []).slice(0, MAX_GALLERY);
    if (!gallery.length) throw new Error('ตะกร้านี้ไม่มีรูปใน Shopee');
    const desc = describe(base);
    const colorUrls = rows.flatMap((r) => r.opts.map((o) => o?.image?.image_url).filter(Boolean));
    const urls = [...new Set([...gallery, ...colorUrls, ...desc.images])];

    const token = await thisshop.getToken();
    const up = new Map();   // url → { path, url } | Error
    for (const batch of chunks(urls, 5)) {
      const got = await Promise.allSettled(batch.map(async (u, i) => {
        const { buf, type } = await download(u);
        return thisshop.uploadImage(token, buf, `c${Date.now()}${i}.${extOf(type)}`, type);
      }));
      got.forEach((g, i) => up.set(batch[i], g.status === 'fulfilled' ? g.value : g.reason));
    }
    const warnings = [];
    const okImg = (u) => { const v = up.get(u); return v && !(v instanceof Error) ? v : null; };
    for (const [u, v] of up) if (v instanceof Error) warnings.push(`ข้ามรูป: ${v.message}`);
    const main = okImg(gallery[0]);
    if (!main) throw new Error(`รูปหลักอัปโหลดไม่ได้ — ${up.get(gallery[0])?.message || ''}`);
    const rest = gallery.slice(1).map(okImg).filter(Boolean).map((v) => v.path);

    // ── ข้อความ ──
    const name = String(title || cleanTitle(base.item_name) || base.item_name || '').trim();
    if (!name) throw new Error('ไม่มีชื่อสินค้า');
    const tags = desc.images.map(okImg).filter((v) => v?.url).map((v) => `<img style="width:100%" src="${v.url}">`);
    let text = esc(desc.text.slice(0, 350));
    if (text.length < 20) text = esc(`${name} ${desc.text}`.trim().slice(0, 350));
    if (text.length < 20) text = esc(`${name} ${name}`);
    let html = `<p>${text}</p>${tags.join('')}`;
    while (html.length > 1000 && tags.length) { tags.pop(); html = `<p>${text}</p>${tags.join('')}`; }
    if (html.length > 1000) html = `<p>${text.slice(0, 900)}</p>`;

    // ── SKU ──
    const skuList = rows.map((r) => {
      const label = r.opts.map((o) => o?.option).filter(Boolean).join(' ');
      const attList = r.opts.length
        ? r.opts.map((o, t) => {
          const img = okImg(o?.image?.image_url || '');
          return { attName: attNameOf(r.tierNames[t]), attValue: String(o?.option || '-').slice(0, 128), ...(img ? { imgUrl: img.path } : {}) };
        })
        : [{ attName: 'Size', attValue: 'Free Size' }];
      const price = Math.round(r.price * 100) / 100;
      return {
        itemName: name.slice(0, 256),
        itemTitle: `${name} ${label}`.trim().slice(0, 512),
        itemQrcode: thisshop.encodeSku(r.sku),
        amtPrice: price,
        amtPriceMarket: price,
        stockNum: stQty.has(low(r.sku)) ? stQty.get(low(r.sku)) : Math.max(0, r.shopeeStock),
        attList,
        isOnsale: 1,
      };
    });

    const data = {
      brandId, brandName: brandName || undefined,
      categoryId,
      itemName: name.slice(0, 256), itemTitle: name.slice(0, 512),
      mobileDetails: html, pcDetails: html,
      imageUrl: main.path,
      mediaList: rest.length ? rest : [main.path],
      typPublish: 1,
      skuList,
    };
    const spuId = await thisshop.addGoods(token, data);

    // ตรวจหลังสร้าง — ได้ตัวเลือกครบไหม
    let skuCount = null;
    try { skuCount = (await thisshop.goodsDetails(token, spuId))?.skuList?.length ?? null; } catch { /* ไม่กระทบผลหลัก */ }
    if (skuCount !== null && skuCount !== skuList.length) warnings.push(`ตัวเลือกใน ThisShop ${skuCount} ≠ ที่ส่งไป ${skuList.length}`);

    await finish({ status: 'ok', thisshop_spu_id: spuId, title: name, sku_n: skuList.length });
    if (base.category_id) {
      await sb.from('os_clone_map').upsert({
        shopee_cat: String(base.category_id), thisshop_cat: categoryId, thisshop_cat_name: categoryName,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'shopee_cat' }).then(() => null, () => null);
    }
    return { spuId, skuCount, sent: skuList.length, images: [...up.values()].filter((v) => !(v instanceof Error)).length, warnings };
  } catch (e) {
    await finish({ status: 'failed', error: String(e.message || e).slice(0, 500) });
    throw e;
  }
}
