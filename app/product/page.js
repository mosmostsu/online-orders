// สินค้า — รายการตะกร้าที่ลงขายอยู่ของแต่ละร้าน แบบเดียวกับหน้า "สินค้าของฉัน" หลังร้าน
// แต่เปิดดูได้ทุกร้านจากที่เดียว ไม่ต้องสลับล็อกอินทีละร้าน
//
// หนึ่งแถว = หนึ่งตะกร้า โชว์ตัวเลือกสี/ไซส์ 5 ตัวแรกไว้ในแถว กดเข้าไปดูครบทุกตัว
// ข้อมูลมาจาก os_listings (ดู supabase/030 และ app/api/sync/products) ไม่ได้ถามแพลตฟอร์มตอนเปิดหน้า
import Link from 'next/link';
import { db } from '@/lib/supabase';
import { listShops } from '@/lib/tokens';
import { listingGroup, listingLabel } from '@/lib/listings';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../Nav';
import SyncProducts from './SyncProducts';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 40;
const PREVIEW_SKUS = 5;
const LOW_STOCK = 2;   // เหลือ ≤2 = ควรระวัง (มาตรการกันชิ้นสุดท้ายใน CLAUDE.md)
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', thisshop: 'ThisShop' };
const TABS = [
  { key: 'live', label: 'ขายอยู่' },
  { key: 'out', label: 'หมด' },
  { key: 'low', label: `เหลือ ≤${LOW_STOCK}` },
  { key: 'off', label: 'ไม่แสดง' },
  { key: 'problem', label: 'มีปัญหา' },
  { key: 'all', label: 'ทั้งหมด' },
];
const SORTS = [
  { key: 'new', label: 'แก้ล่าสุด' },
  { key: 'stock', label: 'คลังน้อยก่อน' },
  { key: 'price', label: 'ราคาสูงก่อน' },
];

const baht = (n) => (n === null || n === undefined ? '—' : '฿' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const range = (a, b) => (a === null || a === undefined ? '—' : Number(a) === Number(b) ? baht(a) : `${baht(a)} – ${baht(b)}`);

// แถวไหนอยู่แท็บไหน — "หมด" กับ "เหลือน้อย" นับเฉพาะตัวที่ขายอยู่ (ตัวที่ปิดไว้ คลังเป็นศูนย์ก็ไม่ใช่ปัญหา)
function inTab(r, tab) {
  const g = listingGroup(r.status);
  if (tab === 'all') return true;
  if (tab === 'out') return g === 'live' && Number(r.stock) === 0;
  if (tab === 'low') return g === 'live' && Number(r.stock) > 0 && Number(r.minStock) <= LOW_STOCK;
  return g === tab;
}

async function allListings(sb, platform, shop) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('os_listings')
      .select('product_id, title, thumb_url, status, item_sku, sku_n, price_min, price_max, promo_min, promo_max, stock, remote_updated_at, synced_at')
      .eq('platform', platform).eq('shop', shop)
      .order('remote_updated_at', { ascending: false, nullsFirst: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export default async function ProductPage({ searchParams }) {
  const sp = await searchParams;
  const sb = db();

  const [shopee, tiktok] = await Promise.all([listShops('shopee'), listShops('tiktok')]);
  const shops = [
    ...shopee.map((s) => ({ platform: 'shopee', shop: s.shop })).sort((a, b) => a.shop.localeCompare(b.shop)),
    ...tiktok.map((s) => ({ platform: 'tiktok', shop: s.shop })),
    // ThisShop ไม่มีแถวโทเคน (ขอสดทุกครั้ง) — มีคีย์ตั้งไว้ = มีร้าน
    ...(process.env.THISSHOP_APP_ID ? [{ platform: 'thisshop', shop: 'THISSHOP' }] : []),
  ];
  const [pf, sh] = String(sp?.s || '').split(':');
  const cur = shops.find((s) => s.platform === pf && s.shop === sh) || shops[0];
  const tab = TABS.some((t) => t.key === sp?.tab) ? sp.tab : 'live';
  const sort = SORTS.some((s) => s.key === sp?.sort) ? sp.sort : 'new';
  const q = String(sp?.q || '').trim();
  const page = Math.max(1, Number(sp?.page) || 1);

  const qs = (o) => {
    const p = new URLSearchParams();
    const v = { s: cur ? `${cur.platform}:${cur.shop}` : null, tab, sort, q, page, ...o };
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === '') continue;
      if ((k === 'tab' && x === 'live') || (k === 'sort' && x === 'new') || (k === 'page' && Number(x) === 1)) continue;
      p.set(k, String(x));
    }
    const s = p.toString();
    return s ? `/product?${s}` : '/product';
  };

  let err = null, rows = [], counts = {}, shopCounts = {}, preview = new Map(), lastRun = null;
  try {
    if (!cur) throw new Error('ยังไม่มีร้านที่ผูกไว้');

    // จำนวนตะกร้าต่อร้าน ไว้โชว์บนแท็บร้าน
    const heads = await Promise.all(shops.map((s) => sb.from('os_listings')
      .select('product_id', { count: 'exact', head: true })
      .eq('platform', s.platform).eq('shop', s.shop)));
    heads.forEach((h, i) => { shopCounts[`${shops[i].platform}:${shops[i].shop}`] = h.count || 0; });

    const [all, logRes] = await Promise.all([
      allListings(sb, cur.platform, cur.shop),
      sb.from('os_sync_log').select('started_at, finished_at, ok, error')
        .eq('platform', `listings:${cur.platform}`).eq('shop', cur.shop)
        .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    lastRun = logRes.data;

    // ค้นทั้งชื่อ, รหัสตะกร้า, Parent SKU และ SKU ของตัวเลือก (เช่นยิงรหัส 163981000XL มาก็เจอ)
    let hit = null;
    if (q) {
      const like = `%${q.replace(/[%_,()]/g, ' ')}%`;
      const { data: bySku } = await sb.from('os_listing_skus').select('product_id')
        .eq('platform', cur.platform).eq('shop', cur.shop).ilike('seller_sku', like).limit(2000);
      hit = new Set((bySku || []).map((r) => r.product_id));
      const ql = q.toLowerCase();
      for (const r of all) {
        if ((r.title || '').toLowerCase().includes(ql) || r.product_id === q || (r.item_sku || '').toLowerCase().includes(ql)) hit.add(r.product_id);
      }
    }
    const pool = hit ? all.filter((r) => hit.has(r.product_id)) : all;

    // คลังต่ำสุดของตัวเลือก — ใช้กับแท็บ "เหลือน้อย" (รวมทั้งตะกร้าเยอะ แต่บางไซส์อาจเหลือชิ้นเดียว)
    const liveIds = pool.filter((r) => listingGroup(r.status) === 'live').map((r) => r.product_id);
    const minStock = new Map();
    for (let i = 0; i < liveIds.length; i += 300) {
      const { data } = await sb.from('os_listing_skus').select('product_id, stock')
        .eq('platform', cur.platform).eq('shop', cur.shop).in('product_id', liveIds.slice(i, i + 300));
      for (const s of data || []) {
        const v = Number(s.stock ?? 0);
        if (!minStock.has(s.product_id) || v < minStock.get(s.product_id)) minStock.set(s.product_id, v);
      }
    }
    for (const r of pool) r.minStock = minStock.get(r.product_id) ?? r.stock;

    for (const t of TABS) counts[t.key] = pool.filter((r) => inTab(r, t.key)).length;
    rows = pool.filter((r) => inTab(r, tab));
    if (sort === 'stock') rows.sort((a, b) => (a.minStock ?? 1e9) - (b.minStock ?? 1e9) || (a.stock ?? 0) - (b.stock ?? 0));
    if (sort === 'price') rows.sort((a, b) => (Number(b.price_max) || 0) - (Number(a.price_max) || 0));

    // ตัวเลือก 5 ตัวแรกของแถวที่อยู่ในหน้านี้
    const pageIds = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => r.product_id);
    if (pageIds.length) {
      const { data: skus } = await sb.from('os_listing_skus')
        .select('product_id, sku_id, seller_sku, variant, price, promo_price, stock, sort')
        .eq('platform', cur.platform).eq('shop', cur.shop).in('product_id', pageIds)
        .order('sort');
      for (const s of skus || []) {
        if (!preview.has(s.product_id)) preview.set(s.product_id, []);
        preview.get(s.product_id).push(s);
      }
    }
  } catch (e) {
    err = String(e.message || e);
  }

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const detailHref = (id) => `/product/${cur.platform}/${encodeURIComponent(cur.shop)}/${encodeURIComponent(id)}`;

  return (
    <>
      <Nav active="product" />

      <div className="row">
        <div>
          <h1>สินค้า</h1>
          <div className="sub">
            {cur ? <>{PLATFORM_LABEL[cur.platform]} · {cur.shop}</> : 'ยังไม่มีร้าน'}
            {lastRun && (
              <> · ดึงล่าสุด {fmtTimeTH(lastRun.finished_at || lastRun.started_at)} น.
                {lastRun.ok === false && <span className="stale"> (รอบล่าสุดพลาด: {String(lastRun.error || '').slice(0, 80)})</span>}
              </>
            )}
          </div>
        </div>
        {cur && <SyncProducts platform={cur.platform} shop={cur.shop} />}
      </div>

      {/* สลับร้าน — คนละร้าน คนละรหัสตะกร้า ไม่รวมกัน */}
      <div className="chans">
        {shops.map((s) => {
          const k = `${s.platform}:${s.shop}`;
          return (
            <Link
              prefetch={false}
              key={k}
              className="chan"
              data-plat={s.platform}
              data-shop={s.shop}
              data-on={cur && k === `${cur.platform}:${cur.shop}` ? '1' : '0'}
              href={qs({ s: k, tab: 'live', q: '', page: 1 })}
            >
              {PLATFORM_LABEL[s.platform]} <b>{s.shop}</b> {shopCounts[k] ?? ''}
            </Link>
          );
        })}
      </div>

      {err && (
        <div className="note">
          <b>ดึงข้อมูลไม่ได้</b><br />{err}<br /><br />
          รัน <code>supabase/030_listings.sql</code> ใน Supabase ก่อน แล้วกด “ดึงสินค้า”
        </div>
      )}

      {!err && cur && (
        <>
          <div className="tabs">
            {TABS.map((t) => (
              <Link
                prefetch={false}
                key={t.key}
                className="tab"
                data-on={tab === t.key ? '1' : '0'}
                data-tone={(t.key === 'out' || t.key === 'problem') && counts[t.key] ? 'err' : undefined}
                href={qs({ tab: t.key, page: 1 })}
              >
                {t.label} <b>{counts[t.key] ?? 0}</b>
              </Link>
            ))}
          </div>

          <div className="row2 ptools">
            <form className="search" action="/product" method="get">
              <input type="hidden" name="s" value={`${cur.platform}:${cur.shop}`} />
              {tab !== 'live' && <input type="hidden" name="tab" value={tab} />}
              {sort !== 'new' && <input type="hidden" name="sort" value={sort} />}
              <input name="q" defaultValue={q} placeholder="ค้นชื่อสินค้า / SKU / รหัสตะกร้า" autoComplete="off" inputMode="search" />
              {q && <Link prefetch={false} className="link" href={qs({ q: '', page: 1 })}>ล้าง</Link>}
              <button className="btn" type="submit">ค้นหา</button>
            </form>
            <span className="psort">
              {SORTS.map((s) => (
                <Link prefetch={false} key={s.key} className="chip" data-on={sort === s.key ? '1' : '0'} href={qs({ sort: s.key, page: 1 })}>
                  {s.label}
                </Link>
              ))}
            </span>
          </div>

          {shopCounts[`${cur.platform}:${cur.shop}`] === 0 ? (
            <div className="note">ร้านนี้ยังไม่มีข้อมูลสินค้า — กด “ดึงสินค้า” ด้านบน (ครั้งแรกใช้เวลาหลายรอบ ระบบวนต่อให้เอง)</div>
          ) : shown.length === 0 ? (
            <div className="note">ไม่มีสินค้าในแท็บนี้{q ? ` ที่ตรงกับ “${q}”` : ''}</div>
          ) : (
            <div className="plist">
              {shown.map((r) => {
                const vs = preview.get(r.product_id) || [];
                return (
                  <section key={r.product_id} className="pitem">
                    <Link prefetch={false} href={detailHref(r.product_id)} className="phead">
                      {r.thumb_url
                        ? <img className="thumb plg" src={r.thumb_url} alt="" loading="lazy" />
                        : <span className="thumb plg thumb-empty" />}
                      <span className="pinfo">
                        <span className="clamp2 ptitle">{r.title || '(ไม่มีชื่อ)'}</span>
                        <span className="sku">
                          ID {r.product_id}{r.item_sku ? ` · Parent SKU ${r.item_sku}` : ''}
                        </span>
                        <span className="pmeta">
                          <span className={'badge ' + (listingGroup(r.status) === 'live' ? 'ok' : listingGroup(r.status) === 'off' ? 'dim' : 'err')}>
                            {listingLabel(r.status)}
                          </span>
                          <span>{r.sku_n} ตัวเลือก</span>
                          <span>{range(r.price_min, r.price_max)}</span>
                          {r.promo_min !== null && <span className="promo">โปร {range(r.promo_min, r.promo_max)}</span>}
                          <span className={Number(r.stock) === 0 ? 'danger' : ''}>คลังรวม <b>{r.stock ?? '—'}</b></span>
                        </span>
                      </span>
                    </Link>

                    {vs.length > 0 && (
                      <table className="mini pskus">
                        <tbody>
                          {vs.slice(0, PREVIEW_SKUS).map((v) => (
                            <tr key={v.sku_id}>
                              <td>
                                <div className="mono">{v.seller_sku || '—'}</div>
                                {v.variant && <div className="sku">{v.variant}</div>}
                              </td>
                              <td className="num">{baht(v.price)}</td>
                              <td className="num">{v.promo_price !== null ? <span className="promo">{baht(v.promo_price)}</span> : <span className="sku">—</span>}</td>
                              <td className={'num ' + (Number(v.stock) === 0 ? 'danger' : Number(v.stock) <= LOW_STOCK ? 'lowstock' : '')}>
                                {v.stock ?? '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {r.sku_n > PREVIEW_SKUS && (
                      <Link prefetch={false} className="pmore" href={detailHref(r.product_id)}>
                        แสดงตัวเลือกทั้งหมด ({r.sku_n}) →
                      </Link>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {pages > 1 && (
            <div className="pager">
              <Link prefetch={false} data-off={page <= 1 ? '1' : '0'} href={qs({ page: Math.max(1, page - 1) })}>← ก่อนหน้า</Link>
              <span className="sub" style={{ margin: 0 }}>หน้า {page} / {pages} · {rows.length} ตะกร้า</span>
              <Link prefetch={false} data-off={page >= pages ? '1' : '0'} href={qs({ page: Math.min(pages, page + 1) })}>ถัดไป →</Link>
            </div>
          )}
        </>
      )}
    </>
  );
}
