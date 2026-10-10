// เทียบร้านในกลุ่มเดียวกัน (SOLID / REAL / MVP) — ตะกร้าของร้านหลัก ↔ ตะกร้าของร้านอื่นในกลุ่ม
//
// ใช้ดูว่าร้านหลักลงอะไรไว้แล้วร้านอื่นยังลงไม่เหมือน (ขาดสี/ไซส์ไหน ราคาตรงไหม) ก่อนไปเพิ่มที่หลังร้าน
// จับคู่ตะกร้าด้วย seller_sku ที่ทับกัน: ทับ ≥ เกณฑ์ (ค่าเริ่มต้น 60%) ของ SKU ในตะกร้าร้านหลัก = ตะกร้าเดียวกัน
// ร้านอื่นแตกตะกร้าออกเป็นหลายใบ (ใบละไม่ถึงเกณฑ์ แต่รวมกันถึง) นับเป็น "กระจาย" ไม่ใช่ "ไม่พบ"
//
// อ่านอย่างเดียว — ไม่เขียนอะไรกลับแพลตฟอร์ม คำนวณตอนเปิดหน้าจาก os_listings / os_listing_skus (ดู supabase/030)
import Link from 'next/link';
import { db } from '@/lib/supabase';
import { inListingTab, listingLabel, shopsFrom, sellerEditUrl } from '@/lib/listings';
import { shopGroup, PLATFORM_LABEL } from '@/lib/shopGroups';
import Nav from '../../Nav';
import ShopBar from '../../ShopBar';
import ExtLink from './ExtLink';

export const dynamic = 'force-dynamic';

const THRESHOLDS = [40, 60, 80];
const DEFAULT_THR = 60;
const FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'part', label: 'ลงไม่ครบ' },
  { key: 'none', label: 'ไม่พบในร้านอื่น' },
  { key: 'price', label: 'ราคาไม่ตรง' },
];
const PAGE_SIZE = 30;
const SHOW_MAX = 40;   // รายการที่ขาด/ราคาต่าง โชว์ไม่เกินนี้ต่อร้าน — ที่เหลือบอกเป็นจำนวน
const PLATFORM_ORDER = ['shopee', 'tiktok', 'lazada', 'thaimart', 'thisshop'];

const key = (s) => String(s || '').trim().toLowerCase();
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const baht = (n) => (n === null || n === undefined ? '—' : '฿' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const shopLabel = (s) => `${PLATFORM_LABEL[s.platform] || s.platform} ${s.shop}`;
const detailHref = (platform, shop, id) => `/product/${platform}/${encodeURIComponent(shop)}/${encodeURIComponent(id)}`;

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
      .select('product_id, title, thumb_url, status, item_sku, sku_n, deboost', { count: 'exact' })
      .eq('platform', s.platform).eq('shop', s.shop).order('product_id').range(a, b)),
    readAll((a, b) => sb.from('os_listing_skus')
      .select('product_id, sku_id, seller_sku, variant, price, sort', { count: 'exact' })
      .eq('platform', s.platform).eq('shop', s.shop).order('sku_id').range(a, b)),
  ]);

  // baskets: product_id → { l, skus: Map(sku → ตัวเลือก) }   bySku: sku → Set(product_id)
  const baskets = new Map();
  for (const l of listings) baskets.set(l.product_id, { l, skus: new Map() });
  const bySku = new Map();
  for (const x of skus) {
    const b = baskets.get(x.product_id);
    if (!b) continue;
    const k = key(x.seller_sku);
    if (!k) continue;
    if (!b.skus.has(k)) b.skus.set(k, x);
    let set = bySku.get(k);
    if (!set) { set = new Set(); bySku.set(k, set); }
    set.add(x.product_id);
  }
  return { ...s, baskets, bySku };
}

// เทียบตะกร้าหนึ่งใบของร้านหลัก (refSkus = [{ k, variant, price }]) กับทั้งร้านปลายทาง
function matchShop(refSkus, t, thr) {
  const n = refSkus.length;
  const counts = new Map();   // product_id ของร้านปลายทาง → มี SKU ของเราอยู่กี่ตัว
  let inShop = 0;             // SKU ของเราที่ไปอยู่ที่ไหนสักใบในร้านนั้น
  for (const r of refSkus) {
    const set = t.bySku.get(r.k);
    if (!set) continue;
    inShop += 1;
    for (const pid of set) counts.set(pid, (counts.get(pid) || 0) + 1);
  }

  // ใบที่ทับมากสุด — เท่ากันเลือกใบที่ขายอยู่
  const isLive = (pid) => inListingTab(t.baskets.get(pid).l, 'live');
  let best = null;
  let bestN = 0;
  for (const [pid, c] of counts) {
    if (c > bestN || (c === bestN && best !== null && isLive(pid) && !isLive(best))) { best = pid; bestN = c; }
  }

  const ratio = thr / 100;
  let state;
  if (bestN === n) state = 'ok';
  else if (bestN / n >= ratio) state = 'part';
  else if (counts.size > 1 && inShop / n >= ratio) state = 'spread';
  else state = 'none';

  const b = best === null ? null : t.baskets.get(best);
  const missing = [];
  const priceDiff = [];
  if (b && (state === 'ok' || state === 'part')) {
    for (const r of refSkus) {
      const x = b.skus.get(r.k);
      if (!x) {
        missing.push({ variant: r.variant, sku: r.k, elsewhere: t.bySku.has(r.k) });
        continue;
      }
      const a = num(r.price);
      const c = num(x.price);
      if (a !== null && c !== null && Math.abs(a - c) > 0.001) priceDiff.push({ variant: r.variant, sku: r.k, ref: a, other: c });
    }
  }
  const parts = state === 'spread'
    ? [...counts].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([pid, c]) => ({ pid, c, title: t.baskets.get(pid).l.title }))
    : [];

  return {
    state, n, bestN, inShop, nb: counts.size, pid: best, title: b ? b.l.title : null,
    status: b ? b.l.status : null, missing, priceDiff, parts,
  };
}

export default async function ComparePage({ searchParams }) {
  const sp = await searchParams;
  const thr = THRESHOLDS.includes(Number(sp?.t)) ? Number(sp.t) : DEFAULT_THR;
  const f = FILTERS.some((x) => x.key === sp?.f) ? sp.f : 'all';
  const q = String(sp?.q || '').trim().toLowerCase();
  const page = Math.max(1, Number(sp?.page) || 1);

  let err = null;
  let shops = [];
  try {
    const res = await db().rpc('os_listing_shops');
    if (res.error) throw new Error(res.error.message);
    shops = shopsFrom(res.data);
  } catch (e) {
    err = String(e.message || e);
  }

  // ร้านหลัก: ที่เลือกจากแถบร้าน ไม่เลือก = TikTok SOLID (ถ้าไม่มีใช้ร้านแรกของกลุ่ม SOLID)
  const [pf, sh] = String(sp?.s || '').split(':');
  const solid = shops.filter((s) => shopGroup(s.platform, s.shop) === 'SOLID');
  const cur = shops.find((s) => s.platform === pf && s.shop === sh)
    || solid.find((s) => s.platform === 'tiktok') || solid[0] || shops[0] || null;
  const group = cur ? shopGroup(cur.platform, cur.shop) : null;
  const others = cur
    ? shops.filter((s) => shopGroup(s.platform, s.shop) === group && !(s.platform === cur.platform && s.shop === cur.shop))
      .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform))
    : [];

  let rows = [];
  if (!err && cur && others.length) {
    try {
      const [ref, ...targets] = await Promise.all([cur, ...others].map(loadShop));
      for (const [pid, b] of ref.baskets) {
        if (!inListingTab(b.l, 'live')) continue;   // เทียบเฉพาะตะกร้าที่ขายอยู่ของร้านหลัก
        const refSkus = [...b.skus].map(([k, x]) => ({ k, variant: x.variant, price: num(x.price) }));
        const blank = Math.max(0, (b.l.sku_n || 0) - refSkus.length);   // ตัวเลือกที่ไม่ได้ใส่ SKU — จับคู่ไม่ได้
        const cells = targets.map((t) => (refSkus.length
          ? { shop: t, ...matchShop(refSkus, t, thr) }
          : { shop: t, state: 'nosku', n: 0, missing: [], priceDiff: [], parts: [] }));
        rows.push({ id: pid, l: b.l, n: refSkus.length, blank, cells });
      }
    } catch (e) {
      err = String(e.message || e);
    }
  }

  if (q) {
    // ค้นจากชื่อ / Parent SKU / รหัสตะกร้า — SKU ของตัวเลือกค้นผ่านหน้า /product เดิมได้
    rows = rows.filter((r) => String(r.l.title || '').toLowerCase().includes(q)
      || key(r.l.item_sku).includes(q) || key(r.id).includes(q));
  }

  // ตัวเลขหัวคอลัมน์ + ตัวนับของชิปกรอง (นับก่อนกรอง)
  const perShop = others.map(() => ({ ok: 0, part: 0, spread: 0, none: 0, nosku: 0 }));
  const cnt = { all: rows.length, part: 0, none: 0, price: 0 };
  for (const r of rows) {
    r.cells.forEach((c, i) => { perShop[i][c.state] += 1; });
    if (r.cells.some((c) => c.state === 'part')) cnt.part += 1;
    if (r.cells.some((c) => c.state === 'none')) cnt.none += 1;
    if (r.cells.some((c) => c.priceDiff.length)) cnt.price += 1;
  }
  const keep = (r) => (f === 'part' ? r.cells.some((c) => c.state === 'part')
    : f === 'none' ? r.cells.some((c) => c.state === 'none')
      : f === 'price' ? r.cells.some((c) => c.priceDiff.length) : true);
  const gaps = (r) => r.cells.filter((c) => c.state !== 'ok').length;
  const shown = rows.filter(keep).sort((a, b) => gaps(b) - gaps(a) || String(a.l.title || '').localeCompare(String(b.l.title || ''), 'th'));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const cp = Math.min(page, pages);
  const pageRows = shown.slice((cp - 1) * PAGE_SIZE, cp * PAGE_SIZE);

  const curKey = cur ? `${cur.platform}:${cur.shop}` : null;
  const qs = (o) => {
    const p = new URLSearchParams();
    const v = { s: curKey, t: thr, f, q: sp?.q || '', page: cp, ...o };
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === '') continue;
      if ((k === 't' && Number(x) === DEFAULT_THR) || (k === 'f' && x === 'all') || (k === 'page' && Number(x) === 1)) continue;
      p.set(k, String(x));
    }
    const s = p.toString();
    return s ? `/product/compare?${s}` : '/product/compare';
  };
  const cols = `minmax(0, 1.7fr) repeat(${Math.max(others.length, 1)}, minmax(0, 1fr))`;

  return (
    <>
      <Nav active="product" />
      <div className="row">
        <div>
          <h1>เทียบร้านในกลุ่ม</h1>
          <div className="sub">
            {cur ? <>ร้านหลัก {shopLabel(cur)} · กลุ่ม {group}</> : 'ยังไม่มีร้าน'}
            {' '}· ตะกร้าเดียวกันเมื่อ SKU ทับ ≥ {thr}% · กดชื่อร้านด้านล่างเพื่อเปลี่ยนร้านหลัก
          </div>
        </div>
      </div>

      <ShopBar
        items={shops.map((s) => {
          const k = `${s.platform}:${s.shop}`;
          return { ...s, href: qs({ s: k, f: 'all', q: '', page: 1 }), on: k === curKey, count: s.n ?? null };
        })}
      />

      <div className="ptabs">
        <Link prefetch={false} className="ptab" data-on="0" href={curKey ? `/product?s=${encodeURIComponent(curKey)}` : '/product'}>รายการสินค้า</Link>
        <span className="ptab" data-on="1">เทียบร้านอื่น</span>
      </div>

      {err && (
        <div className="note"><b>ดึงข้อมูลไม่ได้</b><br />{err}</div>
      )}

      {!err && cur && others.length === 0 && (
        <div className="note">กลุ่ม {group} มีร้านเดียวในระบบ ({shopLabel(cur)}) ไม่มีร้านอื่นให้เทียบ</div>
      )}

      {!err && cur && others.length > 0 && (
        <div className="pcard">
          <div className="ptools">
            <form className="search" action="/product/compare" method="get">
              <input type="hidden" name="s" value={curKey} />
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
                  data-tone={x.key !== 'all' && cnt[x.key] ? 'err' : undefined} href={qs({ f: x.key, page: 1 })}>
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
              <div>ตะกร้า ({PLATFORM_LABEL[cur.platform]} {cur.shop}) · {rows.length.toLocaleString('en-US')} ใบที่ขายอยู่</div>
              {others.map((o, i) => (
                <div key={`${o.platform}:${o.shop}`}>
                  <b>{shopLabel(o)}</b>
                  <div className="sku">
                    ตรง {perShop[i].ok} · ไม่ครบ {perShop[i].part}
                    {perShop[i].spread > 0 && <> · กระจาย {perShop[i].spread}</>} · ไม่พบ {perShop[i].none}
                  </div>
                </div>
              ))}
            </div>

            {pageRows.length === 0 && (
              <div className="note" style={{ margin: 12 }}>ไม่มีตะกร้าที่ตรงเงื่อนไข</div>
            )}

            {pageRows.map((r) => {
              const refUrl = sellerEditUrl(cur.platform, r.id);
              return (
                <details key={r.id} className="cmp-row">
                  <summary className="cmp-sum" style={{ '--cols': cols }}>
                    <div className="cmp-name">
                      {r.l.thumb_url ? <img className="thumb xs" src={r.l.thumb_url} alt="" loading="lazy" /> : <span className="thumb xs thumb-empty" />}
                      <span className="pinfo">
                        <span className="clamp2 ptitle">{r.l.title || '(ไม่มีชื่อ)'}</span>
                        <span className="sku">
                          {r.l.item_sku ? `Parent SKU: ${r.l.item_sku} · ` : ''}{r.n} ตัวเลือก
                          {r.blank > 0 && ` · ไม่มี SKU ${r.blank}`}
                        </span>
                      </span>
                    </div>
                    {r.cells.map((c) => <CellSummary key={`${c.shop.platform}:${c.shop.shop}`} c={c} />)}
                  </summary>

                  <div className="cmp-det">
                    <div className="cmp-links">
                      <b>{shopLabel(cur)}</b>
                      <Link prefetch={false} href={detailHref(cur.platform, cur.shop, r.id)}>ดูในระบบ</Link>
                      {refUrl && <ExtLink href={refUrl}>เปิดหลังบ้าน ↗</ExtLink>}
                    </div>
                    {r.cells.map((c) => <CellDetail key={`${c.shop.platform}:${c.shop.shop}`} c={c} thr={thr} />)}
                  </div>
                </details>
              );
            })}
          </div>

          <div className="ppager">
            <Link prefetch={false} className="pgbtn" data-off={cp <= 1 ? '1' : '0'} href={qs({ page: Math.max(1, cp - 1) })}>‹</Link>
            <span><b>{cp}</b> / {pages}</span>
            <Link prefetch={false} className="pgbtn" data-off={cp >= pages ? '1' : '0'} href={qs({ page: Math.min(pages, cp + 1) })}>›</Link>
          </div>

          <div className="sub" style={{ marginTop: 10 }}>
            จับคู่ด้วยรหัส SKU ที่ตั้งไว้ในแต่ละตัวเลือก (ไม่สนตัวพิมพ์เล็ก/ใหญ่) · ตัวเลือกที่ไม่ได้ใส่ SKU จับคู่ไม่ได้ ·
            ข้อมูลมาจากรอบดึงสินค้าล่าสุด ไม่ได้ถามแพลตฟอร์มตอนเปิดหน้า
          </div>
        </div>
      )}
    </>
  );
}

function CellSummary({ c }) {
  const url = c.pid ? sellerEditUrl(c.shop.platform, c.pid) : null;
  return (
    <div className="cmp-cell">
      {c.state === 'ok' && <span className="badge ok">ตรง {c.n}/{c.n}</span>}
      {c.state === 'part' && <span className="badge warn">ไม่ครบ {c.bestN}/{c.n}</span>}
      {c.state === 'spread' && <span className="badge hot">กระจาย {c.nb} ใบ</span>}
      {c.state === 'none' && <span className="badge err">ไม่พบ</span>}
      {c.state === 'nosku' && <span className="badge dim">ไม่มี SKU</span>}
      {c.priceDiff.length > 0 && <span className="cmp-pd">ราคาต่าง {c.priceDiff.length}</span>}
      {url && (c.state === 'ok' || c.state === 'part') && <ExtLink href={url} title="เปิดหลังบ้านตะกร้านี้">↗</ExtLink>}
    </div>
  );
}

function CellDetail({ c, thr }) {
  const s = c.shop;
  const url = c.pid ? sellerEditUrl(s.platform, c.pid) : null;
  const more = (arr) => (arr.length > SHOW_MAX ? <span className="sku"> +{arr.length - SHOW_MAX} ตัว</span> : null);
  return (
    <div className="cmp-dcell">
      <div className="cmp-links">
        <b>{shopLabel(s)}</b>
        {c.state === 'ok' && <span className="badge ok">ตรง {c.n}/{c.n}</span>}
        {c.state === 'part' && <span className="badge warn">ไม่ครบ {c.bestN}/{c.n} · ขาด {c.missing.length}</span>}
        {c.state === 'spread' && <span className="badge hot">กระจาย {c.nb} ใบ</span>}
        {c.state === 'none' && <span className="badge err">ไม่พบ</span>}
        {c.state === 'nosku' && <span className="badge dim">ตัวเลือกของร้านหลักไม่มี SKU</span>}
        {c.pid && (c.state === 'ok' || c.state === 'part') && (
          <>
            <Link prefetch={false} href={detailHref(s.platform, s.shop, c.pid)}>ดูในระบบ</Link>
            {url && <ExtLink href={url}>เปิดหลังบ้าน ↗</ExtLink>}
          </>
        )}
      </div>

      {c.title && (c.state === 'ok' || c.state === 'part') && (
        <div className="sku">ตะกร้า: {c.title} ({listingLabel(c.status)}) · ID {c.pid}</div>
      )}

      {c.state === 'none' && (
        <div className="sku">
          {c.bestN > 0
            ? `ใบที่ทับมากสุดทับแค่ ${c.bestN}/${c.n} (${Math.round((c.bestN / c.n) * 100)}%) ต่ำกว่าเกณฑ์ ${thr}% — ลองลดเกณฑ์ดู`
            : 'ไม่มี SKU ของตะกร้านี้ในร้านนี้เลย'}
        </div>
      )}

      {c.state === 'spread' && (
        <div className="cmp-list">
          <div className="sku">ร้านนี้แตกเป็น {c.nb} ตะกร้า รวมกันมี SKU ของตะกร้านี้ {c.inShop}/{c.n}</div>
          {c.parts.map((p) => (
            <div key={p.pid} className="cmp-part">
              <span>{p.title || '(ไม่มีชื่อ)'} <span className="sku">· {p.c} ตัว</span></span>
              <Link prefetch={false} href={detailHref(s.platform, s.shop, p.pid)}>ดูในระบบ</Link>
              {sellerEditUrl(s.platform, p.pid) && <ExtLink href={sellerEditUrl(s.platform, p.pid)}>หลังบ้าน ↗</ExtLink>}
            </div>
          ))}
        </div>
      )}

      {c.missing.length > 0 && (
        <div className="cmp-list">
          <div className="sku">ตัวเลือกที่ขาด</div>
          <div className="cmp-chips">
            {c.missing.slice(0, SHOW_MAX).map((m) => (
              <span key={m.sku} className="cmp-miss" title={m.elsewhere ? 'มี SKU นี้ในตะกร้าอื่นของร้านนี้' : undefined}>
                {m.variant || m.sku}{m.elsewhere ? ' *' : ''}
              </span>
            ))}
            {more(c.missing)}
          </div>
          {c.missing.some((m) => m.elsewhere) && <div className="sku">* มี SKU นี้อยู่ในอีกตะกร้าของร้านนี้</div>}
        </div>
      )}

      {c.priceDiff.length > 0 && (
        <div className="cmp-list">
          <div className="sku">ราคาไม่ตรงกับร้านหลัก</div>
          {c.priceDiff.slice(0, SHOW_MAX).map((p) => (
            <div key={p.sku} className="cmp-pdrow">
              <span>{p.variant || p.sku}</span>
              <span className="mono">{baht(p.ref)} → <b>{baht(p.other)}</b></span>
            </div>
          ))}
          {more(c.priceDiff)}
        </div>
      )}
    </div>
  );
}
