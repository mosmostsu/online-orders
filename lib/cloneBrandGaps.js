// แบรนด์ที่ ThisShop ยังไม่ให้ร้านเราใช้ — ไว้ส่งรายการไปขอ ThisShop เพิ่ม (หน้า /clone-brands)
//
// ใช้ตรรกะเดียวกับตอนโคลนจริง (lib/clone.js → planClone):
//   ตะกร้า Shopee REAL ที่ขายอยู่ และยังไม่มีตัวเลือกไหนอยู่ใน ThisShop
//   → แบรนด์ + หมวดของตะกร้านั้นจาก Shopee (สด)
//   → หมวด ThisShop ที่จับคู่ไว้ใน os_clone_map
//   → รายชื่อแบรนด์ที่ร้านใช้ได้ในหมวดนั้น (thisshop.category.brand.get)
//   ชื่อไม่ตรง (เทียบด้วย norm แบบเดียวกับตอนโคลน) = ขาด
import { db } from './supabase.js';
import * as shopee from './shopee.js';
import * as thisshop from './thisshop.js';
import { SRC_SHOP, norm, shopeeAuth, thisshopPresence, cleanTitle } from './clone.js';
import { inListingTab } from './listings.js';

const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const NO_BRAND = new Set(['', 'nobrand', 'none']);

// ทำงานพร้อมกันทีละ n ก้อน — Shopee ถามทีละ 50 ตะกร้า ร้านมีหลายพันตะกร้า ถามต่อกันทีละก้อนไม่ทัน 60 วิ
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function liveShopeeIds(sb) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('os_listings').select('product_id, title, status')
      .eq('platform', 'shopee').eq('shop', SRC_SHOP).order('product_id').range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []).filter((r) => inListingTab({ status: r.status }, 'live')));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function brandGaps() {
  const sb = db();
  const t0 = Date.now();

  // 1) ตะกร้า Shopee REAL ที่ขายอยู่ และยังไม่มีใน ThisShop
  const live = await liveShopeeIds(sb);
  const present = await thisshopPresence(live.map((r) => r.product_id));
  const todo = live.filter((r) => !present.has(r.product_id));
  const titleOf = new Map(todo.map((r) => [r.product_id, cleanTitle(r.title)]));

  // 2) แบรนด์ + หมวดจาก Shopee (สด)
  const auth = await shopeeAuth();
  const bases = (await pool(chunks(todo.map((r) => r.product_id), 50), 5,
    (ids) => shopee.getItemBaseInfo({ ...auth, itemIds: ids }))).flat();

  // 3) หมวด ThisShop ที่จับคู่ไว้
  const catIds = [...new Set(bases.map((b) => String(b.category_id || '')).filter(Boolean))];
  const mapRows = new Map();
  for (const c of chunks(catIds, 200)) {
    const { data, error } = await sb.from('os_clone_map').select('*').in('shopee_cat', c);
    if (error) throw error;
    for (const r of data || []) mapRows.set(r.shopee_cat, r);
  }

  // 4) แบรนด์ที่ร้านใช้ได้ในแต่ละหมวด ThisShop (ถามทีละหมวด — ThisShop จำกัด QPS)
  const token = await thisshop.getToken();
  const brandsByCat = new Map();
  const catErrors = [];
  for (const tc of new Set([...mapRows.values()].map((r) => r.thisshop_cat))) {
    try {
      brandsByCat.set(tc, await thisshop.categoryBrands(token, tc));
    } catch (e) {
      catErrors.push({ cat: tc, error: String(e.message || e) });
    }
  }

  // 5) เทียบ
  const gaps = new Map();      // แบรนด์ (ตามชื่อ Shopee) → { brand, n, cats: Map(thisshop_cat → {name, n}), samples[] }
  const unmapped = new Map();  // หมวด Shopee ที่ยังไม่จับคู่ → n
  let noBrand = 0, ok = 0;
  for (const b of bases) {
    const brand = String(b.brand?.original_brand_name || '').trim();
    if (NO_BRAND.has(norm(brand))) { noBrand += 1; continue; }
    const m = mapRows.get(String(b.category_id || ''));
    if (!m) { unmapped.set(String(b.category_id), (unmapped.get(String(b.category_id)) || 0) + 1); continue; }
    const list = brandsByCat.get(m.thisshop_cat);
    if (!list) continue; // ถามหมวดนี้ไม่สำเร็จ — อยู่ใน catErrors
    const k = norm(brand);
    if (list.some((x) => norm(x.name) === k || norm(x.nameLocal) === k)) { ok += 1; continue; }
    if (!gaps.has(k)) gaps.set(k, { brand: brand.replace(/[(（][^)）]*[)）]/g, '').trim() || brand, n: 0, cats: new Map(), samples: [] });
    const g = gaps.get(k);
    g.n += 1;
    const cn = m.thisshop_cat_name || m.thisshop_cat;
    if (!g.cats.has(m.thisshop_cat)) g.cats.set(m.thisshop_cat, { id: m.thisshop_cat, name: cn, n: 0 });
    g.cats.get(m.thisshop_cat).n += 1;
    if (g.samples.length < 3) g.samples.push(titleOf.get(String(b.item_id)) || String(b.item_id));
  }

  // ThisShop มีแบรนด์นี้ในหมวดอื่นของเราไหม — ถ้ามี น่าจะแค่ขอเปิดหมวดเพิ่ม ไม่ใช่ขอเพิ่มแบรนด์ใหม่
  const anyCat = new Map();
  for (const [tc, list] of brandsByCat) for (const x of list) {
    for (const k of [norm(x.name), norm(x.nameLocal)]) if (k) { if (!anyCat.has(k)) anyCat.set(k, new Set()); anyCat.get(k).add(tc); }
  }

  const rows = [...gaps.entries()].map(([k, g]) => ({
    brand: g.brand, n: g.n, samples: g.samples,
    cats: [...g.cats.values()].sort((a, b) => b.n - a.n),
    elsewhere: anyCat.has(k),
  })).sort((a, b) => b.n - a.n || a.brand.localeCompare(b.brand));

  return {
    ok: true,
    ms: Date.now() - t0,
    counts: { live: live.length, onThisShop: present.size, checked: bases.length, ok, noBrand, gapProducts: rows.reduce((s, r) => s + r.n, 0), unmappedProducts: [...unmapped.values()].reduce((s, n) => s + n, 0) },
    rows,
    unmappedCats: unmapped.size,
    catErrors,
  };
}
