// เทียบร้าน — เลือกร้านกี่ร้านก็ได้ ทุกร้านเท่ากัน ไม่มี "ร้านหลัก"
//
// ตะกร้าจากทุกร้านที่เลือกที่ SKU ทับกัน ≥ เกณฑ์ (ค่าเริ่มต้น 60% ของตะกร้าที่เล็กกว่า) ถูกรวมเป็นแถวเดียว
// แล้วดูว่าแต่ละร้านมี SKU ครบชุดรวมของแถวนั้นไหม — ร้านไหนขาดอะไร ราคาไม่ตรงกับร้านอื่นตรงไหน
// ร้านที่แตกตะกร้าเป็นหลายใบก็รวมให้อยู่แถวเดียวกัน (นับ SKU รวมทุกใบของร้านนั้น)
//
// อ่านอย่างเดียว — ไม่เขียนอะไรกลับแพลตฟอร์ม คำนวณจาก os_listings / os_listing_skus (ดู supabase/030)
// ทางหลัก: ฟังก์ชัน os_compare_page ในฐานข้อมูล (supabase/051) รวมตะกร้า/กรอง/เรียง/แบ่งหน้าแล้วตอบมาแค่หน้าที่โชว์
// ทางสำรอง (ยังไม่ได้รัน 051): ดึงทั้งกลุ่มมาคำนวณเองในเซิร์ฟเวอร์ — ช้ากว่ามาก จำไว้ในหน่วยความจำ 5 นาที
// ต่อ ?fresh=1 ท้าย URL เพื่อข้ามที่จำไว้
import Link from 'next/link';
import { unstable_cache } from 'next/cache';
import { db } from '@/lib/supabase';
import { inListingTab, shopsFrom, sellerEditUrl } from '@/lib/listings';
import { shopGroup, GROUP_ORDER, PLATFORM_LABEL } from '@/lib/shopGroups';
import Nav from '../Nav';
import ExtLink from './ExtLink';

export const dynamic = 'force-dynamic';

const THRESHOLDS = [40, 60, 80];
const DEFAULT_THR = 60;
const FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'ok', label: 'ลงครบแล้ว' },
  { key: 'part', label: 'ลงไม่ครบ' },
  { key: 'none', label: 'ไม่พบในบางร้าน' },
  { key: 'price', label: 'ราคาไม่ตรง' },
];
const PAGE_SIZE = 15;     // ตารางตัวเลือกของทุกแถวอยู่ใน HTML ตั้งแต่โหลด (กางด้วย <details>) — 30 แถว ≈ 2 MB จึงเหลือ 15
const MAX_PER_SKU = 12;     // SKU เดียวอยู่ในตะกร้าเกินนี้ = รหัสกลาง (ไม่ใช่ตัวเดียวกัน) ไม่เอามาจับคู่
const CACHE_MS = 5 * 60 * 1000;
const PLATFORM_ORDER = ['shopee', 'tiktok', 'lazada', 'thaimart', 'thisshop'];

const key = (s) => String(s || '').trim().toLowerCase();
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const baht = (n) => (n === null || n === undefined ? '—' : '฿' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const shopLabel = (s) => `${PLATFORM_LABEL[s.platform] || s.platform} ${s.shop}`;
const detailHref = (platform, shop, id) => `/product/${platform}/${encodeURIComponent(shop)}/${encodeURIComponent(id)}`;
const rank = (s) => {
  const g = GROUP_ORDER.indexOf(shopGroup(s.platform, s.shop));
  return (g < 0 ? GROUP_ORDER.length : g) * 10 + PLATFORM_ORDER.indexOf(s.platform);
};

// ── อ่านข้อมูล + จำไว้ ──────────────────────────────────────────────────
// อ่านทั้งตารางทีละ 1,000 แถว (เพดานของ Supabase) — คำขอแรกขอจำนวนรวมมาด้วย แล้วยิงหน้าที่เหลือพร้อมกัน
async function readAll(make) {
  const first = await make(0, 999);
  if (first.error) throw new Error(first.error.message);
  const rows = first.data || [];
  const total = first.count || rows.length;
  if (total > rows.length) {
    const jobs = [];
    for (let from = 1000; from < total; from += 1000) jobs.push(make(from, from + 999));
    for (const r of await Promise.all(jobs)) {
      if (r.error) throw new Error(r.error.message);
      rows.push(...(r.data || []));
    }
  }
  return rows;
}

async function loadShop(s) {
  const sb = db();
  const [listings, skus] = await Promise.all([
    readAll((a, b) => sb.from('os_listings')
      .select('product_id, title, thumb_url, status, item_sku, sku_n', { count: 'exact' })
      .eq('platform', s.platform).eq('shop', s.shop).order('product_id').range(a, b)),
    readAll((a, b) => sb.from('os_listing_skus')
      .select('product_id, sku_id, seller_sku, variant, price, stock', { count: 'exact' })
      .eq('platform', s.platform).eq('shop', s.shop).order('sku_id').range(a, b)),
  ]);
  // baskets: product_id → { l, skus: Map(sku → ตัวเลือก) }
  const baskets = new Map();
  for (const l of listings) baskets.set(l.product_id, { l, skus: new Map() });
  for (const x of skus) {
    const b = baskets.get(x.product_id);
    const k = key(x.seller_sku);
    if (b && k && !b.skus.has(k)) b.skus.set(k, x);
  }
  return { ...s, baskets };
}

// จำผลไว้ในหน่วยความจำของเซิร์ฟเวอร์ (ใช้ซ้ำข้ามคำขอตราบที่เครื่องยังอุ่นอยู่) — เก็บ promise กันสองคำขอยิงซ้ำพร้อมกัน
const cache = new Map();
function cached(name, fresh, load) {
  const hit = cache.get(name);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const p = load().catch((e) => { cache.delete(name); throw e; });
  cache.set(name, { at: Date.now(), p });
  return p;
}

// ── รวมตะกร้าข้ามร้าน ───────────────────────────────────────────────────
// เชื่อมสองตะกร้าต่างร้านเมื่อ SKU ทับกัน ≥ ratio ของใบที่เล็กกว่า แล้วรวมที่เชื่อมถึงกันเป็นแถวเดียว (union-find)
function buildRows(data, ratio, hideSkus, hideRows) {
  const nodes = [];
  let noSku = 0;
  let hiddenOut = 0;
  // alive = SKU ที่มีของอย่างน้อยหนึ่งร้านในกลุ่ม (คลังว่าง = ไม่รู้ นับว่ามี)
  // hideSkus: ตัด SKU ที่หมดทุกร้านออก (ตะกร้าที่เหลือ 0 ตัวเลือกก็หายไปด้วย)
  // hideRows: ซ่อนทั้งแถวที่ทุก SKU หมดทุกร้าน (ไม่ตัด SKU ที่หมดในแถวที่ยังมีของ)
  const alive = new Set();
  for (const sd of data) {
    for (const b of sd.baskets.values()) {
      for (const [k, x] of b.skus) if (x.stock === null || x.stock === undefined || Number(x.stock) > 0) alive.add(k);
    }
  }
  data.forEach((sd, si) => {
    for (const [pid, b] of sd.baskets) {
      if (!inListingTab(b.l, 'live')) continue;   // เทียบเฉพาะตะกร้าที่ขายอยู่
      if (b.skus.size === 0) { noSku += 1; continue; }
      let skus = b.skus;
      if (hideSkus) {
        skus = new Map([...b.skus].filter(([k]) => alive.has(k)));
        if (skus.size === 0) { hiddenOut += 1; continue; }
      }
      nodes.push({ id: nodes.length, si, pid, l: b.l, skus });
    }
  });

  const bySku = new Map();
  for (const nd of nodes) {
    for (const k of nd.skus.keys()) {
      let a = bySku.get(k);
      if (!a) { a = []; bySku.set(k, a); }
      a.push(nd.id);
    }
  }
  const N = Math.max(nodes.length, 1);
  const pair = new Map();   // a*N+b → จำนวน SKU ที่ทับกัน
  for (const ids of bySku.values()) {
    if (ids.length < 2 || ids.length > MAX_PER_SKU) continue;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];
        if (nodes[a].si === nodes[b].si) continue;
        const pk = a < b ? a * N + b : b * N + a;
        pair.set(pk, (pair.get(pk) || 0) + 1);
      }
    }
  }
  const parent = nodes.map((_, i) => i);
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx; }
    return r;
  };
  for (const [pk, c] of pair) {
    const a = Math.floor(pk / N);
    const b = pk % N;
    if (c / Math.min(nodes[a].skus.size, nodes[b].skus.size) >= ratio) parent[find(a)] = find(b);
  }

  const groups = new Map();
  for (const nd of nodes) {
    const r = find(nd.id);
    let g = groups.get(r);
    if (!g) { g = []; groups.set(r, g); }
    g.push(nd);
  }

  const rows = [];
  for (const members of groups.values()) {
    const U = new Map();                                   // SKU รวมของแถว → { variant }
    const per = data.map(() => ({ nodes: [], keys: new Map() }));
    for (const nd of members) {
      per[nd.si].nodes.push(nd);
      for (const [k, x] of nd.skus) {
        if (!U.has(k)) U.set(k, { variant: x.variant });
        if (!per[nd.si].keys.has(k)) per[nd.si].keys.set(k, num(x.price));
      }
    }

    // ราคา: ตัวเลือกที่อยู่ ≥2 ร้าน — ร้านที่ราคาไม่เท่าราคาส่วนใหญ่ถือว่าไม่ตรง (เสมอกัน = ไม่ตรงทุกร้าน)
    const diff = data.map(() => []);
    for (const [k, meta] of U) {
      const have = [];
      per.forEach((p, i) => { if (p.keys.has(k) && p.keys.get(k) !== null) have.push({ i, price: p.keys.get(k) }); });
      if (have.length < 2) continue;
      const tally = new Map();
      for (const h of have) tally.set(h.price, (tally.get(h.price) || 0) + 1);
      if (tally.size === 1) continue;
      let top = 0;
      for (const c of tally.values()) top = Math.max(top, c);
      const modes = [...tally].filter(([, c]) => c === top).map(([p]) => p);
      for (const h of have) {
        if (modes.length === 1 && h.price === modes[0]) continue;
        const others = [...new Set(have.filter((o) => o.i !== h.i).map((o) => o.price))];
        diff[h.i].push({ sku: k, variant: meta.variant, own: h.price, others });
      }
    }

    const cells = per.map((p, i) => {
      if (!p.nodes.length) return { state: 'none', nodes: [], missing: [], priceDiff: [], n: U.size, have: 0 };
      const missing = [];
      for (const [k, meta] of U) if (!p.keys.has(k)) missing.push({ sku: k, variant: meta.variant });
      return {
        state: missing.length ? 'part' : 'ok', nodes: p.nodes, missing, priceDiff: diff[i],
        n: U.size, have: U.size - missing.length,
      };
    });
    const rep = members.reduce((a, b) => (b.skus.size > a.skus.size ? b : a));
    rows.push({ id: `${rep.si}:${rep.pid}`, rep, n: U.size, cells, U, keys: per.map((p) => p.keys) });
  }
  let hiddenRows = 0;
  if (hideRows) {
    const keep = rows.filter((r) => [...r.U.keys()].some((k) => alive.has(k)));
    hiddenRows = rows.length - keep.length;
    rows.length = 0;
    rows.push(...keep);
  }
  let hiddenSkus = 0;
  if (hideSkus) {
    const all = new Set();
    for (const sd of data) for (const b of sd.baskets.values()) for (const k of b.skus.keys()) all.add(k);
    for (const k of all) if (!alive.has(k)) hiddenSkus += 1;
  }
  return { rows, noSku, hiddenOut, hiddenRows, hiddenSkus };
}

// ── ทางหลัก: ฟังก์ชันในฐานข้อมูล ───────────────────────────────────────
async function rawCompare(args) {
  const { data, error } = await db().rpc('os_compare_page', args);
  if (error) throw new Error(error.message);
  return data;
}
// จำผลต่อชุดตัวกรอง 6 ชั่วโมง (ข้ามเครื่องเซิร์ฟเวอร์) — ข้อมูลไม่ค่อยเปลี่ยน และถูกล้างเองทุกครั้งที่รอบดึงสินค้า/ไฟล์ ST
// เสร็จ (revalidateTag 'listings' / 'allsite') · ล้างเองได้ด้วยปุ่ม "ดึงข้อมูลใหม่" → /api/compare/refresh
const cachedCompare = unstable_cache(rawCompare, ['compare-rpc'], { revalidate: 21600, tags: ['listings', 'allsite'] });

// แปลงผลจากฐานข้อมูลให้เป็นรูปเดียวกับที่ทางสำรองสร้าง (หน้าจอวาดจากรูปนี้)
function fromRpc(d) {
  const cols = d.shops || [];
  const pageRows = (d.rows || []).map((r) => {
    const U = new Map();
    const keys = cols.map(() => new Map());
    const cells = (r.cells || []).map((c) => ({
      state: c.state, n: c.n, have: c.have, missing: [], priceDiff: [],
      nodes: (c.nodes || []).map((nd) => ({ pid: nd.pid, l: { title: nd.title, status: nd.status }, skus: { size: nd.size } })),
    }));
    for (const m of r.mx || []) {
      U.set(m.k, { variant: m.variant });
      (m.has || []).forEach((h, i) => {
        if (h && keys[i]) keys[i].set(m.k, m.price[i] === null || m.price[i] === undefined ? null : Number(m.price[i]));
      });
      (m.diff || []).forEach((x, i) => { if (x && cells[i]) cells[i].priceDiff.push({ sku: m.k }); });
    }
    return {
      id: `${r.rep.platform}:${r.rep.shop}:${r.rep.product_id}`,
      rep: { l: { title: r.rep.title, thumb_url: r.rep.thumb_url, item_sku: r.rep.item_sku } },
      n: r.n, cells, U, keys,
    };
  });
  const c = d.counts || {};
  return {
    pickedCols: cols, pageRows, total: d.total || 0,
    cnt: { all: c.all || 0, ok: c.ok || 0, part: c.part || 0, none: c.none || 0, price: c.price || 0 },
    perShop: (d.per_shop || []).map((x) => ({ ok: x.ok || 0, part: x.part || 0, none: x.none || 0 })),
    noSku: d.no_sku || 0,
    hiddenOut: d.hidden_out || 0,
    hiddenRows: d.hidden_rows || 0,
    hiddenSkus: d.hidden_skus || 0,
    brands: (d.brands || []).map((b) => ({ brand: b.brand, n: b.n })),
    brandOther: d.brand_other || 0,
  };
}

// ทางสำรอง — คำนวณเองในเซิร์ฟเวอร์ (ใช้เมื่อยังไม่ได้รัน supabase/051)
async function viaJs({ picked, thr, f, q, page, fresh, hideSkus, hideRows }) {
  const keyOf = (s) => `${s.platform}:${s.shop}`;
  const data = await Promise.all(picked.map((s) => cached(`shop:${keyOf(s)}`, fresh, () => loadShop(s))));
  let { rows, noSku, hiddenOut, hiddenRows, hiddenSkus } = buildRows(data, thr / 100, hideSkus, hideRows);

  if (q) {
    // ค้นจากชื่อ / Parent SKU / รหัสตะกร้า ของทุกตะกร้าในแถว
    rows = rows.filter((r) => r.cells.some((c) => c.nodes.some((nd) => String(nd.l.title || '').toLowerCase().includes(q)
      || key(nd.l.item_sku).includes(q) || key(nd.pid).includes(q))));
  }

  // ตัวเลขหัวคอลัมน์ + ตัวนับของชิปกรอง (นับก่อนกรองชิป)
  const perShop = picked.map(() => ({ ok: 0, part: 0, none: 0 }));
  const cnt = { all: rows.length, ok: 0, part: 0, none: 0, price: 0 };
  for (const r of rows) {
    r.cells.forEach((c, i) => { perShop[i][c.state] += 1; });
    if (r.cells.every((c) => c.state === 'ok')) cnt.ok += 1;   // ลงครบทุกร้านที่เลือก
    if (r.cells.some((c) => c.state === 'part')) cnt.part += 1;
    if (r.cells.some((c) => c.state === 'none')) cnt.none += 1;
    if (r.cells.some((c) => c.priceDiff.length)) cnt.price += 1;
  }
  const keep = (r) => (f === 'ok' ? r.cells.every((c) => c.state === 'ok')
    : f === 'part' ? r.cells.some((c) => c.state === 'part')
    : f === 'none' ? r.cells.some((c) => c.state === 'none')
      : f === 'price' ? r.cells.some((c) => c.priceDiff.length) : true);
  const gaps = (r) => r.cells.filter((c) => c.state !== 'ok').length;
  const shown = rows.filter(keep).sort((a, b) => gaps(b) - gaps(a)
    || String(a.rep.l.title || '').localeCompare(String(b.rep.l.title || ''), 'th'));
  const cp = Math.max(1, Math.min(page, Math.ceil(shown.length / PAGE_SIZE)));
  const pageRows = shown.slice((cp - 1) * PAGE_SIZE, cp * PAGE_SIZE);
  return { pickedCols: picked, pageRows, total: shown.length, cnt, perShop, noSku, hiddenOut, hiddenRows, hiddenSkus };
}

export default async function ComparePage({ searchParams }) {
  const sp = await searchParams;
  const thr = THRESHOLDS.includes(Number(sp?.t)) ? Number(sp.t) : DEFAULT_THR;
  const f = FILTERS.some((x) => x.key === sp?.f) ? sp.f : 'all';
  const q = String(sp?.q || '').trim().toLowerCase();
  const page = Math.max(1, Number(sp?.page) || 1);
  const fresh = sp?.fresh === '1';
  // ซ่อนของหมด แยกสองระดับ (ค่าเริ่มต้นเปิดทั้งคู่ — ?hr=0 / ?hs=0 เพื่อปิด)
  const hideRows = sp?.hr !== '0';   // ตะกร้าที่ของหมดจริงๆ: ทุก SKU หมดทุกร้าน
  const hideSkus = sp?.hs !== '0';   // SKU ที่หมดทุกร้านในกลุ่ม
  const brand = String(sp?.b || '').trim();   // ยี่ห้อ (os_st.brand) · '__other__' = อื่นๆ · ว่าง = ทั้งหมด

  let err = null;
  let shops = [];
  try {
    const res = await cached('shops', fresh, async () => {
      const r = await db().rpc('os_listing_shops');
      if (r.error) throw new Error(r.error.message);
      return r.data;
    });
    shops = shopsFrom(res).sort((a, b) => rank(a) - rank(b));
  } catch (e) {
    err = String(e.message || e);
  }

  // เลือกได้แค่ระดับกลุ่ม SOLID / REAL / MVP (?g=REAL) — กดแล้วเทียบทุกร้านในกลุ่มนั้นพร้อมกัน ไม่เลือกร้านย่อย
  const keyOf = (s) => `${s.platform}:${s.shop}`;
  const groupOf = (s) => shopGroup(s.platform, s.shop);
  const groups = GROUP_ORDER.filter((g) => shops.some((s) => groupOf(s) === g));
  const group = groups.includes(sp?.g) ? sp.g : groups[0] || null;
  let picked = shops.filter((s) => groupOf(s) === group);
  let pageRows = [];
  let total = 0;
  let cnt = { all: 0, ok: 0, part: 0, none: 0, price: 0 };
  let perShop = [];
  let noSku = 0;
  let hiddenOut = 0;
  let hiddenRows = 0;
  let hiddenSkus = 0;
  let brands = [];      // ยี่ห้อที่มีแถวมากสุด 40 อันดับ (จาก ST) — ใช้ทำปุ่ม
  let brandOther = 0;   // แถวของยี่ห้ออื่น/ไม่ทราบยี่ห้อ → ปุ่ม "อื่นๆ"
  let slow = false;   // true = ใช้ทางสำรอง (ยังไม่ได้รัน 051)
  if (!err && group && picked.length >= 2) {
    let d = null;
    try {
      const args = { p_group: group, p_thr: thr, p_filter: f, p_q: String(sp?.q || '').trim(), p_page: page, p_size: PAGE_SIZE, p_hide_skus: hideSkus, p_hide_rows: hideRows, p_brand: brand };
      d = fresh ? await rawCompare(args) : await cachedCompare(args);
    } catch (e) {
      d = null;
    }
    try {
      if (d) {
        ({ pickedCols: picked, pageRows, total, cnt, perShop, noSku, hiddenOut, hiddenRows, hiddenSkus, brands, brandOther } = fromRpc(d));
      } else {
        slow = true;
        ({ pickedCols: picked, pageRows, total, cnt, perShop, noSku, hiddenOut, hiddenRows, hiddenSkus } = await viaJs({ picked, thr, f, q, page, fresh, hideSkus, hideRows }));
      }
    } catch (e) {
      err = String(e.message || e);
    }
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cp = Math.min(page, pages);

  const qs = (o) => {
    const p = new URLSearchParams();
    const v = { g: group, t: thr, f, q: sp?.q || '', hr: hideRows ? '' : '0', hs: hideSkus ? '' : '0', b: brand, page: cp, ...o };
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === '') continue;
      if ((k === 't' && Number(x) === DEFAULT_THR) || (k === 'f' && x === 'all') || (k === 'page' && Number(x) === 1)) continue;
      p.set(k, String(x));
    }
    const s = p.toString();
    return s ? `/compare?${s}` : '/compare';
  };
  const cols = `minmax(0, 1.6fr) repeat(${Math.max(picked.length, 1)}, minmax(0, 1fr))`;

  return (
    <>
      <Nav active="product" />
      <div className="row">
        <div>
          <h1>เทียบร้าน</h1>
          <div className="sub">
            เลือกกลุ่ม SOLID / REAL / MVP แล้วเทียบทุกร้านในกลุ่ม · ตะกร้าเดียวกันเมื่อ SKU ทับ ≥ {thr}% ของใบที่เล็กกว่า · ข้อมูลจากรอบดึงสินค้าล่าสุด
          </div>
        </div>
      </div>

      <div className="cmp-pick">
        <span className="psort">
          {groups.map((g) => (
            <Link prefetch={false} key={g} className="chip cmp-grp" data-on={g === group ? '1' : '0'} href={qs({ g, page: 1 })}>
              {g}
              <span className="cmp-grpn">{shops.filter((s) => groupOf(s) === g).map((s) => PLATFORM_LABEL[s.platform] || s.platform).join(' · ')}</span>
            </Link>
          ))}
        </span>
      </div>

      {err && <div className="note"><b>ดึงข้อมูลไม่ได้</b><br />{err}</div>}

      {!err && picked.length < 2 && (
        <div className="note">กลุ่ม {group || '—'} มีร้านเดียวในระบบ ไม่มีร้านอื่นให้เทียบ</div>
      )}

      {!err && picked.length >= 2 && (
        <div className="pcard">
          <div className="ptools">
            <form className="search" action="/compare" method="get">
              <input type="hidden" name="g" value={group || ''} />
              {thr !== DEFAULT_THR && <input type="hidden" name="t" value={thr} />}
              {f !== 'all' && <input type="hidden" name="f" value={f} />}
              {!hideRows && <input type="hidden" name="hr" value="0" />}
              {!hideSkus && <input type="hidden" name="hs" value="0" />}
              {brand && <input type="hidden" name="b" value={brand} />}
              <input name="q" defaultValue={sp?.q || ''} placeholder="ค้นหาด้วย ชื่อสินค้า, Parent SKU, รหัสสินค้า" autoComplete="off" inputMode="search" />
              {q && <Link prefetch={false} className="link" href={qs({ q: '', page: 1 })}>ล้าง</Link>}
              <button className="btn" type="submit">ค้นหา</button>
            </form>
          </div>

          {(brands.length > 0 || brandOther > 0) && (
            <div className="pbar">
              <span className="psort">
                <span className="sku">ยี่ห้อ</span>
                <Link prefetch={false} className="chip" data-on={!brand ? '1' : '0'} href={qs({ b: '', page: 1 })}>
                  ทุกยี่ห้อ
                </Link>
                {brands.map((x) => (
                  <Link prefetch={false} key={x.brand} className="chip" data-on={brand.toLowerCase() === x.brand.toLowerCase() ? '1' : '0'}
                    href={qs({ b: x.brand, page: 1 })}>{x.brand} {x.n}</Link>
                ))}
                {brandOther > 0 && (
                  <Link prefetch={false} className="chip" data-on={brand === '__other__' ? '1' : '0'}
                    href={qs({ b: '__other__', page: 1 })} title="ยี่ห้ออื่นที่มีแถวน้อย และตะกร้าที่หายี่ห้อใน ST ไม่เจอ">อื่นๆ {brandOther}</Link>
                )}
              </span>
            </div>
          )}

          <div className="pbar">
            <span className="psort">
              {FILTERS.map((x) => (
                <Link prefetch={false} key={x.key} className="chip" data-on={f === x.key ? '1' : '0'}
                  data-tone={x.key === 'ok' ? 'ok' : x.key !== 'all' && cnt[x.key] ? 'err' : undefined} href={qs({ f: x.key, page: 1 })}>
                  {x.label} {cnt[x.key]}
                </Link>
              ))}
            </span>
            <span className="psort">
              <Link prefetch={false} className="chip" data-on={hideRows ? '1' : '0'} href={qs({ hr: hideRows ? '0' : '', page: 1 })}
                title="ซ่อนตะกร้า (แถว) ที่ทุกตัวเลือกหมดทุกร้านในกลุ่ม — แถวที่ยังมีของอยู่บางตัวไม่ถูกซ่อน">ซ่อนตะกร้าที่หมด</Link>
              <Link prefetch={false} className="chip" data-on={hideSkus ? '1' : '0'} href={qs({ hs: hideSkus ? '0' : '', page: 1 })}
                title="ซ่อนตัวเลือก (SKU) ที่หมดทุกร้านในกลุ่ม — ไม่ต้องเติมที่ร้านไหน">ซ่อน SKU ที่หมด</Link>
              <span className="psep" />
              <span className="sku">ทับ ≥</span>
              {THRESHOLDS.map((v) => (
                <Link prefetch={false} key={v} className="chip" data-on={thr === v ? '1' : '0'} href={qs({ t: v, page: 1 })}>{v}%</Link>
              ))}
            </span>
          </div>

          <div className="cmp-table">
            <div className="cmp-sum cmp-hdr" style={{ '--cols': cols }}>
              <div>ตะกร้า · {total.toLocaleString('en-US')} แถว</div>
              {picked.map((s, i) => (
                <div key={keyOf(s)}>
                  <b>{shopLabel(s)}</b>
                  <div className="sku">ครบ {perShop[i].ok} · ไม่ครบ {perShop[i].part} · ไม่พบ {perShop[i].none}</div>
                </div>
              ))}
            </div>

            {pageRows.length === 0 && <div className="note" style={{ margin: 12 }}>ไม่มีตะกร้าที่ตรงเงื่อนไข</div>}

            {pageRows.map((r) => (
              <details key={r.id} className="cmp-row">
                <summary className="cmp-sum" style={{ '--cols': cols }}>
                  <div className="cmp-name">
                    {r.rep.l.thumb_url ? <img className="thumb xs" src={r.rep.l.thumb_url} alt="" loading="lazy" /> : <span className="thumb xs thumb-empty" />}
                    <span className="pinfo">
                      <span className="clamp2 ptitle">{r.rep.l.title || '(ไม่มีชื่อ)'}</span>
                      <span className="sku">
                        {r.rep.l.item_sku ? `Parent SKU: ${r.rep.l.item_sku} · ` : ''}รวม {r.n} SKU
                      </span>
                    </span>
                  </div>
                  {r.cells.map((c, i) => <CellSummary key={keyOf(picked[i])} c={c} shop={picked[i]} />)}
                </summary>

                <Matrix r={r} picked={picked} />
              </details>
            ))}
          </div>

          <div className="ppager">
            <Link prefetch={false} className="pgbtn" data-off={cp <= 1 ? '1' : '0'} href={qs({ page: Math.max(1, cp - 1) })}>‹</Link>
            <span><b>{cp}</b> / {pages}</span>
            <Link prefetch={false} className="pgbtn" data-off={cp >= pages ? '1' : '0'} href={qs({ page: Math.min(pages, cp + 1) })}>›</Link>
          </div>

          <div className="sub" style={{ marginTop: 10 }}>
            เทียบเฉพาะตะกร้าที่ขายอยู่ · จับคู่ด้วยรหัส SKU ของแต่ละตัวเลือก (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
            {noSku > 0 && ` · ข้าม ${noSku} ตะกร้าที่ไม่มี SKU เลย`}
            {hideRows && hiddenRows > 0 && ` · ซ่อน ${hiddenRows} ตะกร้าที่ของหมดทั้งแถว`}
            {hideSkus && hiddenSkus > 0 && ` · ซ่อน ${hiddenSkus} SKU ที่หมด`} ·{' '}
            <Link prefetch={false} className="link" href={`/api/compare/refresh?back=${encodeURIComponent(qs({}))}`}>ดึงข้อมูลใหม่</Link>
            {slow && ' · โหมดสำรอง (ช้ากว่า): ยังไม่ได้รัน supabase/051_compare.sql'}
          </div>
        </div>
      )}
    </>
  );
}

function CellSummary({ c, shop }) {
  const first = c.nodes[0];
  const url = first ? sellerEditUrl(shop.platform, first.pid) : null;
  return (
    <div className="cmp-cell">
      {c.state === 'ok' && <span className="badge ok">ครบ {c.n}/{c.n}</span>}
      {c.state === 'part' && <span className="badge warn">ไม่ครบ {c.have}/{c.n}</span>}
      {c.state === 'none' && <span className="badge err">ไม่พบ</span>}
      {c.nodes.length > 1 && <span className="sku">{c.nodes.length} ใบ</span>}
      {c.priceDiff.length > 0 && <span className="cmp-pd">ราคาต่าง {c.priceDiff.length}</span>}
      {url && <ExtLink href={url} title="เปิดหลังบ้านตะกร้านี้">↗</ExtLink>}
    </div>
  );
}

// ตาราง SKU × ร้าน หน้าตาเดียวกับมุมมอง "รุ่น + สี" ของ /allsite — Y เขียว = มี, N แดง = ขาด
// ตัวเลือกที่ขาดขึ้นก่อน · ถ้าราคาไม่ตรงกับร้านอื่น โชว์ราคาเล็กๆ สีส้มต่อท้าย Y
function Matrix({ r, picked }) {
  const diff = r.cells.map((c) => new Set(c.priceDiff.map((p) => p.sku)));
  const list = [...r.U].map(([k, meta]) => ({ k, variant: meta.variant, miss: r.keys.some((m) => !m.has(k)) }));
  list.sort((a, b) => Number(b.miss) - Number(a.miss));   // sort เสถียร — ที่ขาดขึ้นก่อน ที่เหลือคงลำดับเดิม
  const missN = list.filter((x) => x.miss).length;
  return (
    <div className="cmp-det">
      <div className="cmp-mxhead">
        {missN > 0 ? <b className="danger">{missN} ตัวเลือกที่ยังลงไม่ครบทุกร้าน</b> : <b className="cmp-allok">ลงครบทุกร้านแล้ว</b>}
        <span className="sku"> · ทั้งหมด {list.length} ตัวเลือก</span>
      </div>
      <div className="cmp-mxwrap">
        <table className="cmp-mx">
          <thead>
            <tr>
              <th>SKU</th>
              <th>ตัวเลือก</th>
              {picked.map((s, i) => {
                const c = r.cells[i];
                return (
                  <th key={`${s.platform}:${s.shop}`} className="cmp-mxs">
                    <div>{shopLabel(s)}</div>
                    {c.state === 'none' && <div className="cmp-hl">ยังไม่ได้ลง</div>}
                    {c.nodes.map((nd) => {
                      const url = sellerEditUrl(s.platform, nd.pid);
                      return (
                        <div key={nd.pid} className="cmp-hl">
                          <Link prefetch={false} href={detailHref(s.platform, s.shop, nd.pid)}>ดูในระบบ</Link>
                          {url && <ExtLink href={url}>หลังบ้าน ↗</ExtLink>}
                        </div>
                      );
                    })}
                    {c.nodes.length > 1 && <div className="cmp-hl">แตกเป็น {c.nodes.length} ตะกร้า</div>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.k}>
                <td className="mono">{x.k}</td>
                <td>{x.variant || '—'}</td>
                {picked.map((s, i) => {
                  const has = r.keys[i].has(x.k);
                  const p = r.keys[i].get(x.k);
                  const d = has && diff[i].has(x.k) && p !== null && p !== undefined;
                  return (
                    <td key={`${s.platform}:${s.shop}`} className="cmp-yn" data-y={has ? '1' : '0'}>
                      {has ? 'Y' : 'N'}
                      {d && <span className="cmp-price diff">{baht(p)}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
