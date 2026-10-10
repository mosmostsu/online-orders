// เทียบร้าน — เลือกร้านกี่ร้านก็ได้ ทุกร้านเท่ากัน ไม่มี "ร้านหลัก"
//
// ตะกร้าจากทุกร้านที่เลือกที่ SKU ทับกัน ≥ เกณฑ์ (ค่าเริ่มต้น 60% ของตะกร้าที่เล็กกว่า) ถูกรวมเป็นแถวเดียว
// แล้วดูว่าแต่ละร้านมี SKU ครบชุดรวมของแถวนั้นไหม — ร้านไหนขาดอะไร ราคาไม่ตรงกับร้านอื่นตรงไหน
// ร้านที่แตกตะกร้าเป็นหลายใบก็รวมให้อยู่แถวเดียวกัน (นับ SKU รวมทุกใบของร้านนั้น)
//
// อ่านอย่างเดียว — ไม่เขียนอะไรกลับแพลตฟอร์ม คำนวณจาก os_listings / os_listing_skus (ดู supabase/030)
// ข้อมูลทั้งร้านถูกจำไว้ในหน่วยความจำเซิร์ฟเวอร์ 5 นาที (เปิดซ้ำเร็ว) — ต่อ ?fresh=1 ท้าย URL เพื่อดึงใหม่
import Link from 'next/link';
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
const PAGE_SIZE = 30;
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
      .select('product_id, sku_id, seller_sku, variant, price', { count: 'exact' })
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
function buildRows(data, ratio) {
  const nodes = [];
  let noSku = 0;
  data.forEach((sd, si) => {
    for (const [pid, b] of sd.baskets) {
      if (!inListingTab(b.l, 'live')) continue;   // เทียบเฉพาะตะกร้าที่ขายอยู่
      if (b.skus.size === 0) { noSku += 1; continue; }
      nodes.push({ id: nodes.length, si, pid, l: b.l, skus: b.skus });
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
  return { rows, noSku };
}

export default async function ComparePage({ searchParams }) {
  const sp = await searchParams;
  const thr = THRESHOLDS.includes(Number(sp?.t)) ? Number(sp.t) : DEFAULT_THR;
  const f = FILTERS.some((x) => x.key === sp?.f) ? sp.f : 'all';
  const q = String(sp?.q || '').trim().toLowerCase();
  const page = Math.max(1, Number(sp?.page) || 1);
  const fresh = sp?.fresh === '1';

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
  const picked = shops.filter((s) => groupOf(s) === group);

  let rows = [];
  let noSku = 0;
  if (!err && picked.length >= 2) {
    try {
      const data = await Promise.all(picked.map((s) => cached(`shop:${keyOf(s)}`, fresh, () => loadShop(s))));
      ({ rows, noSku } = buildRows(data, thr / 100));
    } catch (e) {
      err = String(e.message || e);
    }
  }

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
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const cp = Math.min(page, pages);
  const pageRows = shown.slice((cp - 1) * PAGE_SIZE, cp * PAGE_SIZE);

  const qs = (o) => {
    const p = new URLSearchParams();
    const v = { g: group, t: thr, f, q: sp?.q || '', page: cp, ...o };
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
              <input name="q" defaultValue={sp?.q || ''} placeholder="ค้นหาด้วย ชื่อสินค้า, Parent SKU, รหัสสินค้า" autoComplete="off" inputMode="search" />
              {q && <Link prefetch={false} className="link" href={qs({ q: '', page: 1 })}>ล้าง</Link>}
              <button className="btn" type="submit">ค้นหา</button>
            </form>
          </div>

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
              <span className="sku">ทับ ≥</span>
              {THRESHOLDS.map((v) => (
                <Link prefetch={false} key={v} className="chip" data-on={thr === v ? '1' : '0'} href={qs({ t: v, page: 1 })}>{v}%</Link>
              ))}
            </span>
          </div>

          <div className="cmp-table">
            <div className="cmp-sum cmp-hdr" style={{ '--cols': cols }}>
              <div>ตะกร้า · {rows.length.toLocaleString('en-US')} แถว</div>
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
            {noSku > 0 && ` · ข้าม ${noSku} ตะกร้าที่ไม่มี SKU เลย`} ·{' '}
            <Link prefetch={false} className="link" href={qs({ fresh: '1' })}>ดึงข้อมูลใหม่</Link>
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
                    <td key={`${s.platform}:${s.shop}`} className="cmp-yn">
                      {has ? <span className="cmp-y">Y</span> : <span className="cmp-n">N</span>}
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
