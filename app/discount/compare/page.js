// เทียบส่วนลด — หน้าตาเดียวกับ "เทียบร้าน" (/compare) แต่ดูโปรส่วนลดแทนการลงสินค้า
//
// แถว = ตะกร้าเดียวกันข้ามร้าน (ใช้ผลสำเร็จรูปของ /compare — os_compare_snap ทับ ≥ 60% ซ่อนของหมด)
// ช่องของแต่ละร้าน = ตัวเลือกของตะกร้านั้นติดโปรที่กำลังดำเนินการกี่ตัว ลดกี่ % และราคาโปรตรงกับร้านอื่นไหม
// ราคาโปรดึงจากโปรจริงบนแพลตฟอร์ม (lib/discounts.js promoIndex) จำไว้ 10 นาทีต่อร้าน · Lazada = ราคาพิเศษที่ซิงก์ไว้
// ร้านที่ไม่มี API โปร (Thaimart / ThisShop / Shopee MVP) ขึ้น "ไม่มีข้อมูลโปร" และไม่นับในตัวกรอง
// อ่านอย่างเดียว — แก้โปรที่หน้าโปร (/discount/...) หรือหน้าสินค้า
import { Fragment } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { db } from '@/lib/supabase';
import { shopsFrom, sellerEditUrl } from '@/lib/listings';
import { shopGroup, GROUP_ORDER, PLATFORM_LABEL, GROUP_COOKIE } from '@/lib/shopGroups';
import { loadSnap, SNAP_BUILDING } from '@/lib/compareSnapLoad';
import { promoIndex, TT_TYPE, fmtSec } from '@/lib/discounts';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../../Nav';
import Pending from '../../Pending';
import HoverLink from '../../HoverLink';
import ExtLink from '../../compare/ExtLink';

export const dynamic = 'force-dynamic';

const THR = 60;   // เกณฑ์รวมตะกร้าเดียวกับค่าเริ่มต้นของ /compare (ใช้ก้อนสำเร็จรูปเดียวกัน)
const FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'ok', label: 'โปรครบทุกร้าน' },
  { key: 'gap', label: 'โปรไม่ครบ' },
  { key: 'price', label: 'ราคาโปรไม่ตรง' },
  { key: 'nopromo', label: 'ไม่ติดโปรเลย' },
];
const PAGE_SIZE = 15;
const PLATFORM_ORDER = ['shopee', 'tiktok', 'lazada', 'thaimart', 'thisshop'];

const lc = (v) => String(v ?? '').toLowerCase();
const baht = (n) => (n === null || n === undefined ? '—' : '฿' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const offOf = (price, promo) => (price && promo !== null && promo !== undefined ? Math.round((1 - promo / price) * 100) : null);
const shopLabel = (s) => `${PLATFORM_LABEL[s.platform] || s.platform} ${s.shop}`;
const detailHref = (platform, shop, id) => `/product/${platform}/${encodeURIComponent(shop)}/${encodeURIComponent(id)}`;
const promoHref = (platform, shop, id) => `/discount/${platform}/${encodeURIComponent(shop)}/${encodeURIComponent(id)}`;
const rank = (s) => {
  const g = GROUP_ORDER.indexOf(shopGroup(s.platform, s.shop));
  return (g < 0 ? GROUP_ORDER.length : g) * 10 + PLATFORM_ORDER.indexOf(s.platform);
};
// ข้อความ error สั้นๆ ในหัวคอลัมน์ (ข้อความเต็มอยู่ใน title)
const shortErr = (e) => (/105005|Promotion/.test(e) ? 'แอปยังไม่มีสิทธิ์ Promotion' : /โทเคน/.test(e) ? 'ไม่มีโทเคน API' : 'ดึงโปรไม่ได้');

// แถวจากก้อนสำเร็จรูป + ดัชนีโปรของแต่ละร้าน → ช่องสรุปโปรต่อร้าน
// idx[i]: { by, promos } | { err } | null (ร้านไม่มีโปรให้อ่าน)
function promoRow(r, cols, idx) {
  const mx = r.mx || [];
  const cells = cols.map((s, i) => {
    const nodes = r.cells?.[i]?.nodes || [];
    if (!nodes.length) return { state: 'none', nodes, n: 0, inN: 0, ids: [], pd: 0 };
    const ix = idx[i];
    if (!ix?.by) return { state: 'nodata', nodes, n: 0, inN: 0, ids: [], pd: 0 };
    let n = 0;
    let inN = 0;
    let lo = null;
    let hi = null;
    const ids = new Set();
    for (const m of mx) {
      if (!m.has?.[i]) continue;
      n += 1;
      const x = ix.by[m.k];
      if (!x) continue;
      inN += 1;
      for (const id of x.ids) ids.add(id);
      const off = offOf(x.n ?? m.price?.[i], x.p);
      if (off !== null) { lo = lo === null ? off : Math.min(lo, off); hi = hi === null ? off : Math.max(hi, off); }
    }
    return { state: inN === 0 ? 'zero' : inN === n ? 'all' : 'some', nodes, n, inN, lo, hi, ids: [...ids], pd: 0 };
  });

  // ราคาโปรไม่ตรง: SKU ที่ติดโปร ≥ 2 ร้าน — ร้านที่ราคาโปรไม่เท่าราคาส่วนใหญ่ (เสมอกัน = ไม่ตรงทุกร้าน) แบบเดียวกับ /compare
  const diff = cols.map(() => new Set());
  for (const m of mx) {
    const have = [];
    cols.forEach((_, i) => { const x = idx[i]?.by?.[m.k]; if (m.has?.[i] && x) have.push({ i, p: Math.round(x.p * 100) }); });
    if (have.length < 2) continue;
    const tally = new Map();
    for (const h of have) tally.set(h.p, (tally.get(h.p) || 0) + 1);
    if (tally.size === 1) continue;
    const top = Math.max(...tally.values());
    const modes = [...tally].filter(([, c]) => c === top).map(([p]) => p);
    for (const h of have) if (!(modes.length === 1 && h.p === modes[0])) diff[h.i].add(m.k);
  }
  cells.forEach((c, i) => { c.pd = diff[i].size; });

  const data = cells.filter((c) => ['all', 'some', 'zero'].includes(c.state));
  const anyPromo = data.some((c) => c.state !== 'zero');
  const gaps = anyPromo ? data.filter((c) => c.state !== 'all').length : 0;
  return {
    cells, diff, gaps, anyPromo,
    ok: anyPromo && gaps === 0, gap: gaps > 0, price: cells.some((c) => c.pd > 0), nopromo: !anyPromo,
  };
}

export default async function DiscountComparePage({ searchParams }) {
  const sp = await searchParams;
  const f = FILTERS.some((x) => x.key === sp?.f) ? sp.f : 'all';
  const q = lc(sp?.q).trim();
  const page = Math.max(1, Number(sp?.page) || 1);
  const brand = String(sp?.b || '').trim();

  let err = null;
  let shops = [];
  try {
    const r = await db().rpc('os_listing_shops');
    if (r.error) throw new Error(r.error.message);
    shops = shopsFrom(r.data).sort((a, b) => rank(a) - rank(b));
  } catch (e) {
    err = String(e.message || e);
  }

  // กลุ่ม/มุมมองเหมือน /compare: SOLID / REAL / MVP · ?v=platform → ตามแพลตฟอร์ม · แท็บคู่ร้านหลัก TikTok SOLID ⇄ Shopee REAL
  const view = sp?.v === 'platform' || (!sp?.v && (await cookies()).get(GROUP_COOKIE)?.value === 'platform') ? 'platform' : 'shop';
  const groupOf = (s) => (view === 'platform' ? `P:${s.platform}` : shopGroup(s.platform, s.shop));
  const MAIN_PAIR = new Set(['tiktok:SOLID', 'shopee:REAL']);
  const inGroup = (s, g) => (g === 'X:main' ? MAIN_PAIR.has(`${s.platform}:${String(s.shop).toUpperCase()}`) : groupOf(s) === g);
  const groups = [...(view === 'platform'
    ? [...new Set(shops.map((s) => s.platform))].filter((p) => shops.filter((s) => s.platform === p).length >= 2).map((p) => `P:${p}`)
    : GROUP_ORDER.filter((g) => shops.some((s) => groupOf(s) === g))),
  ...(shops.filter((s) => inGroup(s, 'X:main')).length === 2 ? ['X:main'] : [])];
  const groupLabel = (g) => (g === 'X:main' ? 'TikTok SOLID ⇄ Shopee REAL' : g.startsWith('P:') ? PLATFORM_LABEL[g.slice(2)] || g.slice(2) : g);
  const group = groups.includes(sp?.g) ? sp.g : groups[0] || null;

  let cols = [];
  let idx = [];
  let rows = [];
  if (!err && group && shops.filter((s) => inGroup(s, group)).length >= 2) {
    try {
      // ก้อนแถว + ดัชนีโปรทุกร้านพร้อมกัน — ร้านไหนดึงโปรไม่ได้ ร้านอื่นยังขึ้น
      const [sd, ...ix] = await Promise.all([
        loadSnap(group, THR, true, true, false),
        ...shops.filter((s) => inGroup(s, group)).map((s) => promoIndex(s.platform, s.shop).catch((e) => ({ err: String(e.message || e) }))),
      ]);
      cols = sd.shops || [];
      // ดัชนีเรียงตามร้านใน shops — จับคู่กับคอลัมน์ของก้อนด้วยชื่อ
      const byShop = new Map(shops.filter((s) => inGroup(s, group)).map((s, i) => [`${s.platform}:${s.shop}`, ix[i]]));
      idx = cols.map((s) => byShop.get(`${s.platform}:${s.shop}`) ?? null);
      rows = sd.rows || [];
    } catch (e) {
      err = e?.message === SNAP_BUILDING
        ? `กำลังเตรียมข้อมูลตะกร้าของกลุ่ม ${group} — รอสักครู่ราว 10–20 วินาทีแล้วรีเฟรชหน้านี้อีกครั้ง`
        : String(e.message || e);
    }
  }

  // TikTok มาก่อน แล้ว REAL → SOLID → MVP (เหมือน /compare) — สลับเฉพาะตอนแสดงผล
  const SHOP_RANK = { REAL: 0, SOLID: 1, MVP: 2 };
  const shopRank = (s) => SHOP_RANK[String(s.shop).toUpperCase()] ?? 9;
  const order = cols.map((s, i) => i).sort((a, b) => (cols[a].platform === 'tiktok' ? 0 : 1) - (cols[b].platform === 'tiktok' ? 0 : 1) || shopRank(cols[a]) - shopRank(cols[b]) || a - b);
  const re = (arr) => order.map((i) => arr[i]);
  const picked = re(cols);
  const pIdx = re(idx);
  const reRow = (r) => ({ ...r, cells: re(r.cells || []), mx: (r.mx || []).map((m) => ({ ...m, has: re(m.has || []), price: re(m.price || []) })) });

  // ค้นหา + ยี่ห้อ (เหมือน fromSnapshot ของ /compare)
  let found = rows;
  if (q) {
    found = found.filter((r) => lc(r.rep?.item_sku).includes(q) || lc(r.rep?.product_id) === q
      || (r.cells || []).some((c) => (c.nodes || []).some((nd) => lc(nd.title).includes(q) || lc(nd.pid) === q))
      || (r.mx || []).some((m) => m.k === q));
  }
  const tally = new Map();
  for (const r of found) if (r.brand) tally.set(r.brand, (tally.get(r.brand) || 0) + 1);
  const brands = [...tally].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 40);
  const topSet = new Set(brands.map(([b]) => b));
  const brandOther = found.filter((r) => !r.brand || !topSet.has(r.brand)).length;
  if (brand === '__other__') found = found.filter((r) => !r.brand || !topSet.has(r.brand));
  else if (brand) found = found.filter((r) => lc(r.brand) === lc(brand));

  const all = found.map((r) => { const rr = reRow(r); return { r: rr, p: promoRow(rr, picked, pIdx) }; });
  const cnt = Object.fromEntries(FILTERS.map((x) => [x.key, x.key === 'all' ? all.length : all.filter((a) => a.p[x.key]).length]));
  const perShop = picked.map((_, i) => ({
    all: all.filter((a) => a.p.cells[i].state === 'all').length,
    some: all.filter((a) => a.p.cells[i].state === 'some').length,
    zero: all.filter((a) => a.p.cells[i].state === 'zero').length,
  }));
  // เรียง: โปรไม่ครบหลายร้านก่อน → ราคาโปรไม่ตรง → โปรครบ → ไม่ติดโปรเลยท้ายสุด
  const shown = (f === 'all' ? all : all.filter((a) => a.p[f]))
    .sort((a, b) => b.p.gaps - a.p.gaps || Number(b.p.price) - Number(a.p.price) || Number(b.p.anyPromo) - Number(a.p.anyPromo));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const cp = Math.min(page, pages);
  const pageRows = shown.slice((cp - 1) * PAGE_SIZE, cp * PAGE_SIZE);

  const qs = (o) => {
    const p = new URLSearchParams();
    const v = { v: view, g: group, f, q: sp?.q || '', b: brand, page: cp, ...o };
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === '') continue;
      if ((k === 'f' && x === 'all') || (k === 'page' && Number(x) === 1)) continue;
      p.set(k, String(x));
    }
    const s = p.toString();
    return s ? `/discount/compare?${s}` : '/discount/compare';
  };
  const gridCols = `minmax(0, 1.6fr) repeat(${Math.max(picked.length, 1)}, minmax(0, 1fr))`;
  const oldest = pIdx.filter((x) => x?.at).map((x) => x.at).sort()[0];

  return (
    <>
      <Nav active="discount" />
      <div className="row">
        <div>
          <HoverLink className="chip cmp-back" href="/discount">← กลับหน้าส่วนลด</HoverLink>
          <h1>เทียบส่วนลด</h1>
          <div className="sub">
            ตะกร้าเดียวกันข้ามร้าน (แบบหน้าเทียบร้าน) · ดูว่าแต่ละร้านติดโปรที่กำลังดำเนินการครบทุกตัวเลือกไหม ลดกี่ % ราคาโปรตรงกันไหม
            {oldest ? ` · ดึงโปรเมื่อ ${fmtTimeTH(oldest)} น. (จำไว้ 10 นาที)` : ''}
          </div>
        </div>
      </div>

      <div className="cmp-pick">
        <span className="psort">
          {groups.map((g) => (
            <Fragment key={g}>
              {g === 'X:main' && <span className="psep cmp-grp-sep" />}
              <HoverLink className={`chip cmp-grp${g === 'X:main' ? ' cmp-grp-main' : ''}`} data-on={g === group ? '1' : '0'} href={qs({ g, b: '', f: 'all', q: '', page: 1 })}>
                {groupLabel(g)}
                {g !== 'X:main' && <span className="cmp-grpn">{shops.filter((s) => groupOf(s) === g).map((s) => (view === 'platform' ? s.shop : PLATFORM_LABEL[s.platform] || s.platform)).join(' · ')}</span>}
                <Pending />
              </HoverLink>
            </Fragment>
          ))}
        </span>
        <HoverLink className="gtoggle" data-mode={view}
          href={qs({ v: view === 'platform' ? 'shop' : 'platform', g: '', b: '', f: 'all', q: '', page: 1 })}
          title="สลับการเทียบ: ตามร้าน (SOLID / REAL / MVP) หรือตามแพลตฟอร์ม (Shopee: SOLID · REAL · MVP)">
          <span className="gt-l">ร้าน</span>
          <span className="gt-track"><span className="gt-knob" /></span>
          <span className="gt-r">แพลตฟอร์ม</span>
          <Pending />
        </HoverLink>
      </div>

      {err && <div className="note"><b>ดึงข้อมูลไม่ได้</b><br />{err}</div>}

      {!err && picked.length < 2 && (
        <div className="note">กลุ่ม {group ? groupLabel(group) : '—'} มีร้านเดียวในระบบ ไม่มีร้านอื่นให้เทียบ</div>
      )}

      {!err && picked.length >= 2 && (
        <div className="pcard">
          <div className="ptools">
            <form className="search" action="/discount/compare" method="get">
              <input type="hidden" name="v" value={view} />
              <input type="hidden" name="g" value={group || ''} />
              {f !== 'all' && <input type="hidden" name="f" value={f} />}
              {brand && <input type="hidden" name="b" value={brand} />}
              <input name="q" defaultValue={sp?.q || ''} placeholder="ค้นหาด้วย ชื่อสินค้า, Parent SKU, รหัสสินค้า" autoComplete="off" inputMode="search" />
              {q && <HoverLink className="link" href={qs({ q: '', page: 1 })}>ล้าง</HoverLink>}
              <button className="btn" type="submit">ค้นหา</button>
            </form>
          </div>

          {(brands.length > 0 || brandOther > 0) && (
            <div className="pbar">
              <span className="psort">
                <span className="sku">ยี่ห้อ</span>
                <HoverLink className="chip" data-on={!brand ? '1' : '0'} href={qs({ b: '', page: 1 })}>ทุกยี่ห้อ<Pending /></HoverLink>
                {brands.map(([b, n]) => (
                  <HoverLink key={b} className="chip" data-on={lc(brand) === lc(b) ? '1' : '0'} href={qs({ b, page: 1 })}>{b} {n}<Pending /></HoverLink>
                ))}
                {brandOther > 0 && (
                  <HoverLink className="chip" data-on={brand === '__other__' ? '1' : '0'} href={qs({ b: '__other__', page: 1 })}
                    title="ยี่ห้อที่มี 1–4 แถว และตะกร้าที่หายี่ห้อใน ST ไม่เจอ">อื่นๆ {brandOther}<Pending /></HoverLink>
                )}
              </span>
            </div>
          )}

          <div className="pbar">
            <span className="psort">
              {FILTERS.map((x) => (
                <HoverLink key={x.key} className="chip" data-on={f === x.key ? '1' : '0'}
                  data-tone={x.key === 'ok' ? 'ok' : ['gap', 'price'].includes(x.key) && cnt[x.key] ? 'err' : undefined} href={qs({ f: x.key, page: 1 })}>
                  {x.label} {cnt[x.key]}<Pending />
                </HoverLink>
              ))}
            </span>
          </div>

          {pages > 1 && (
            <div className="ppager ppager-top">
              <HoverLink className="pgbtn" data-off={cp <= 1 ? '1' : '0'} href={qs({ page: Math.max(1, cp - 1) })}>‹<Pending /></HoverLink>
              <span><b>{cp}</b> / {pages}</span>
              <HoverLink className="pgbtn" data-off={cp >= pages ? '1' : '0'} href={qs({ page: Math.min(pages, cp + 1) })}>›<Pending /></HoverLink>
            </div>
          )}

          <div className="cmp-table">
            <div className="cmp-sum cmp-hdr" style={{ '--cols': gridCols }}>
              <div>ตะกร้า · {shown.length.toLocaleString('en-US')} แถว</div>
              {picked.map((s, i) => {
                const ix = pIdx[i];
                return (
                  <div key={`${s.platform}:${s.shop}`}>
                    <b>{shopLabel(s)}</b>
                    {ix?.err ? <div className="sku danger" title={ix.err}>{shortErr(ix.err)}</div>
                      : !ix ? <div className="sku">ไม่มีข้อมูลโปร (ไม่มี API)</div>
                        : (
                          <div className="sku">
                            โปรครบ {perShop[i].all} · ไม่ครบ {perShop[i].some} · ไม่ติดโปร {perShop[i].zero}
                            {' · '}{Object.keys(ix.promos || {}).length} โปร
                            {ix.truncated && <span className="danger" title="มีโปรที่ใหญ่เกินกว่าอ่านได้ครบ — ตัวที่ขึ้นว่าไม่ติดโปรอาจติดจริง"> · อ่านไม่ครบ</span>}
                          </div>
                        )}
                  </div>
                );
              })}
            </div>

            {pageRows.length === 0 && (
              <div className="note" style={{ margin: 12 }}>
                ไม่มีตะกร้าที่ตรงเงื่อนไข
                {(brand || f !== 'all' || q) && <> · <HoverLink className="link" href={qs({ b: '', f: 'all', q: '', page: 1 })}>ล้างตัวกรอง</HoverLink></>}
              </div>
            )}

            {pageRows.map(({ r, p }) => (
              <details key={`${r.rep?.platform}:${r.rep?.shop}:${r.rep?.product_id}`} className="cmp-row">
                <summary className="cmp-sum" style={{ '--cols': gridCols }}>
                  <div className="cmp-name">
                    {r.rep?.thumb_url ? <img className="thumb xs" src={r.rep.thumb_url} alt="" loading="lazy" /> : <span className="thumb xs thumb-empty" />}
                    <span className="pinfo">
                      <span className="clamp2 ptitle">{r.rep?.title || '(ไม่มีชื่อ)'}</span>
                      <span className="sku">{r.rep?.item_sku ? `Parent SKU: ${r.rep.item_sku} · ` : ''}รวม {r.n} SKU</span>
                    </span>
                  </div>
                  {p.cells.map((c, i) => <PromoCell key={`${picked[i].platform}:${picked[i].shop}`} c={c} ix={pIdx[i]} />)}
                </summary>
                <PromoMatrix r={r} p={p} picked={picked} idx={pIdx} />
              </details>
            ))}
          </div>

          <div className="ppager">
            <HoverLink className="pgbtn" data-off={cp <= 1 ? '1' : '0'} href={qs({ page: Math.max(1, cp - 1) })}>‹<Pending /></HoverLink>
            <span><b>{cp}</b> / {pages}</span>
            <HoverLink className="pgbtn" data-off={cp >= pages ? '1' : '0'} href={qs({ page: Math.min(pages, cp + 1) })}>›<Pending /></HoverLink>
          </div>

          <div className="sub" style={{ marginTop: 10 }}>
            นับเฉพาะโปรที่กำลังดำเนินการ · Shopee = โปรส่วนลด (ไม่รวม Flash Sale) · TikTok = ทุกโปรที่ใช้ API ได้ · Lazada = ราคาพิเศษตามรอบซิงก์สินค้า
            · ตะกร้าจากรอบดึงสินค้าล่าสุด (เกณฑ์ทับ {THR}% ซ่อนของหมด) ·{' '}
            <Link prefetch={false} className="link" href={`/api/discount/refresh?back=${encodeURIComponent(qs({}))}`}>ดึงโปรใหม่</Link>
          </div>
        </div>
      )}
    </>
  );
}

const pctText = (lo, hi) => (lo === null ? '' : lo === hi ? `-${lo}%` : `-${lo}–${hi}%`);

function PromoCell({ c, ix }) {
  return (
    <div className="cmp-cell">
      {c.state === 'all' && <span className="badge ok">โปรครบ {c.inN}/{c.n}</span>}
      {c.state === 'some' && <span className="badge warn">โปร {c.inN}/{c.n}</span>}
      {c.state === 'zero' && <span className="badge dim">ไม่ติดโปร</span>}
      {c.state === 'none' && <span className="badge err">ไม่พบตะกร้า</span>}
      {c.state === 'nodata' && <span className="sku">ไม่มีข้อมูลโปร</span>}
      {(c.state === 'all' || c.state === 'some') && <span className="cmp-pct">{pctText(c.lo, c.hi)}</span>}
      {c.pd > 0 && <span className="cmp-pd">ราคาโปรต่าง {c.pd}</span>}
      {c.ids.length > 0 && (
        <span className="sku clamp1" title={c.ids.map((id) => ix?.promos?.[id]?.name || id).join('\n')}>
          {ix?.promos?.[c.ids[0]]?.name || c.ids[0]}{c.ids.length > 1 ? ` +${c.ids.length - 1}` : ''}
        </span>
      )}
      {c.nodes.length > 1 && <span className="sku">{c.nodes.length} ใบ</span>}
    </div>
  );
}

// ตาราง SKU × ร้าน: ราคาโปร (−%) · ไม่ติดโปร = ราคาปกติสีจาง · ไม่มีตะกร้า/SKU = N
// แถวที่บางร้านติดโปรแต่บางร้านไม่ติดขึ้นก่อน
function PromoMatrix({ r, p, picked, idx }) {
  const list = (r.mx || []).map((m) => {
    const st = picked.map((_, i) => (!m.has?.[i] ? 'n' : !idx[i]?.by ? '?' : idx[i].by[m.k] ? 'p' : '0'));
    return { m, st, gap: st.includes('p') && st.includes('0') };
  });
  list.sort((a, b) => Number(b.gap) - Number(a.gap));
  const gapN = list.filter((x) => x.gap).length;
  return (
    <div className="cmp-det">
      <div className="cmp-mxhead">
        {gapN > 0 ? <b className="danger">{gapN} SKU ที่ติดโปรไม่ครบทุกร้าน</b>
          : p.anyPromo ? <b className="cmp-allok">ติดโปรครบทุกร้านที่มีข้อมูล</b> : <b>ยังไม่มีร้านไหนติดโปร</b>}
        <span className="sku"> · ทั้งหมด {list.length} ตัวเลือก</span>
      </div>
      <div className="cmp-mxwrap">
        <table className="cmp-mx">
          <thead>
            <tr>
              <th>SKU</th>
              <th>ตัวเลือก</th>
              {picked.map((s, i) => {
                const c = p.cells[i];
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
                    {c.ids.map((id) => {
                      const pr = idx[i]?.promos?.[id];
                      return (
                        <div key={id} className="cmp-hl cmp-promo">
                          <Link prefetch={false} href={promoHref(s.platform, s.shop, id)} title={pr?.end ? `ถึง ${fmtSec(pr.end)}` : undefined}>
                            {pr?.name || id}{pr?.type && pr.type !== 'DIRECT_DISCOUNT' ? ` (${TT_TYPE[pr.type] || pr.type})` : ''}
                          </Link>
                        </div>
                      );
                    })}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {list.map(({ m, st }) => (
              <tr key={m.k}>
                <td className="mono">{m.k}</td>
                <td>{m.variant || '—'}</td>
                {picked.map((s, i) => {
                  const x = idx[i]?.by?.[m.k];
                  const normal = x?.n ?? m.price?.[i] ?? null;
                  return (
                    <td key={`${s.platform}:${s.shop}`} className="cmp-yn" data-y={st[i] === 'n' ? '0' : '1'}>
                      {st[i] === 'n' && <span className="cmp-n">N</span>}
                      {st[i] === '?' && <span className="cmp-price">{baht(normal)}</span>}
                      {st[i] === '0' && <span className="cmp-price" title="ไม่ติดโปร — ราคาปกติ">{baht(normal)}</span>}
                      {st[i] === 'p' && (
                        <>
                          <span className={p.diff[i].has(m.k) ? 'cmp-price diff' : 'cmp-y'}>{baht(x.p)}</span>
                          {offOf(normal, x.p) !== null && <span className="cmp-price">-{offOf(normal, x.p)}%</span>}
                        </>
                      )}
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
