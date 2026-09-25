// สินค้า — รายการตะกร้าที่ลงขายอยู่ของแต่ละร้าน หน้าตาตามหน้า "สินค้าของฉัน" หลังร้าน Shopee
// แต่เปิดดูได้ทุกร้านจากที่เดียว ไม่ต้องสลับล็อกอินทีละร้าน
//
// หนึ่งแถว = หนึ่งตะกร้า โชว์ตัวเลือกสี/ไซส์ 3 ตัวแรก กด "ดู SKU อื่น" กางที่เหลือในหน้าเดิม
// กดชื่อสินค้าเข้าหน้ารายละเอียด (มียอดขาย 30 วันต่อตัวเลือก)
// ข้อมูลมาจาก os_listings (ดู supabase/030 และ app/api/sync/products) ไม่ได้ถามแพลตฟอร์มตอนเปิดหน้า
import Link from 'next/link';
import { unstable_cache } from 'next/cache';
import { db } from '@/lib/supabase';
import { listShops } from '@/lib/tokens';
import { listingTab, listingLabel } from '@/lib/listings';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../Nav';
import SyncProducts from './SyncProducts';
import SkuRow from './SkuRow';
import SkuMore from './SkuMore';

export const dynamic = 'force-dynamic';

const PAGE_SIZES = [12, 24, 48];   // เหมือนหลังร้าน Shopee — หน้าเล็กโหลดเร็ว
const PREVIEW_SKUS = 3;
const LOW_STOCK = 2;   // เหลือ ≤2 = ควรระวัง (มาตรการกันชิ้นสุดท้ายใน CLAUDE.md)
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', thisshop: 'ThisShop' };
// แถบบนตามหลังร้าน Shopee
const TABS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'live', label: 'ขายอยู่' },
  { key: 'banned', label: 'การละเมิด' },
  { key: 'review', label: 'อยู่ระหว่างตรวจสอบ' },
  { key: 'unlisted', label: 'ยังไม่ลงขาย' },
];
// กรองคลังซ้อนในแท็บ — ของเราเพิ่มเอง หลังร้านไม่มี
const STOCKS = [
  { key: '', label: 'ทุกคลัง' },
  { key: 'out', label: 'หมด' },
  { key: 'low', label: `เหลือ ≤${LOW_STOCK}` },
];
const SORTS = [
  { key: 'new', label: 'แก้ล่าสุด' },
  { key: 'stock', label: 'คลังน้อยก่อน' },
  { key: 'price', label: 'ราคาสูงก่อน' },
];

const baht = (n) => (n === null || n === undefined ? '—' : '฿' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const range = (a, b) => (a === null || a === undefined ? '—' : Number(a) === Number(b) ? baht(a) : `${baht(a)} - ${baht(b)}`);
const TONE = { live: 'ok', banned: 'err', review: 'warn', unlisted: 'dim' };

const inTab = (r, tab) => tab === 'all' || listingTab(r.status) === tab;
function inStock(r, stock) {
  if (stock === 'out') return Number(r.stock) === 0;
  // บางไซส์เหลือน้อยแม้คลังรวมเยอะ — ดูคลังต่ำสุดของตัวเลือก (min_stock, ดู supabase/031)
  if (stock === 'low') return Number(r.stock) > 0 && r.min_stock !== null && Number(r.min_stock) <= LOW_STOCK;
  return true;
}

// ทุกตะกร้าของร้าน เฉพาะคอลัมน์ที่ใช้นับแท็บ/เรียง — ข้อมูลเต็ม (ชื่อ รูป ราคา) ดึงเฉพาะแถวที่โชว์
// ชื่อ/Parent SKU ดึงมาด้วยเฉพาะตอนค้น
async function allListings(sb, platform, shop, withText) {
  const cols = 'product_id, status, stock, min_stock, price_max, remote_updated_at' + (withText ? ', title, item_sku' : '');
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('os_listings')
      .select(cols)
      .eq('platform', platform).eq('shop', shop)
      .order('remote_updated_at', { ascending: false, nullsFirst: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ร้านทั้งหมด + จำนวนตะกร้าต่อร้าน (แท็บร้าน)
async function shopsWithCounts() {
  const sb = db();
  const [shopee, tiktok] = await Promise.all([listShops('shopee'), listShops('tiktok')]);
  const shops = [
    ...shopee.map((s) => ({ platform: 'shopee', shop: s.shop })).sort((a, b) => a.shop.localeCompare(b.shop)),
    ...tiktok.map((s) => ({ platform: 'tiktok', shop: s.shop })),
    // ThisShop ไม่มีแถวโทเคน (ขอสดทุกครั้ง) — มีคีย์ตั้งไว้ = มีร้าน
    ...(process.env.THISSHOP_APP_ID ? [{ platform: 'thisshop', shop: 'THISSHOP' }] : []),
  ];
  const heads = await Promise.all(shops.map((s) => sb.from('os_listings')
    .select('product_id', { count: 'exact', head: true })
    .eq('platform', s.platform).eq('shop', s.shop)));
  return shops.map((s, i) => ({ ...s, n: heads[i].count || 0 }));
}

// ข้อมูลเปลี่ยนแค่ตอนรอบดึงสินค้า — จำไว้ 2 นาทีแบบเดียวกับหน้าเงินเข้า
// /api/sync/products ล้างที่จำด้วย revalidateTag('listings') ทันทีที่บันทึกของใหม่
const CACHE = { revalidate: 120, tags: ['listings'] };
const cachedShops = unstable_cache(shopsWithCounts, ['listings-shops'], CACHE);
const cachedList = unstable_cache(
  (platform, shop, withText) => allListings(db(), platform, shop, withText),
  ['listings-list'], CACHE,
);

export default async function ProductPage({ searchParams }) {
  const sp = await searchParams;
  const sb = db();

  // ร้านที่ขอมาในลิงก์ถามพร้อมกับรายชื่อร้านได้เลย ไม่ต้องรอรายชื่อร้านก่อน
  const [pf, sh] = String(sp?.s || '').split(':');
  const q = String(sp?.q || '').trim();
  const early = pf && sh ? cachedList(pf, sh, Boolean(q)).catch(() => null) : null;
  const shopRows = await cachedShops();
  const shops = shopRows.map(({ platform, shop }) => ({ platform, shop }));
  const cur = shops.find((s) => s.platform === pf && s.shop === sh) || shops[0];
  const tab = TABS.some((t) => t.key === sp?.tab) ? sp.tab : 'live';
  const stock = STOCKS.some((s) => s.key === sp?.stock) ? sp.stock : '';
  const sort = SORTS.some((s) => s.key === sp?.sort) ? sp.sort : 'new';
  const size = PAGE_SIZES.includes(Number(sp?.n)) ? Number(sp.n) : PAGE_SIZES[0];
  const page = Math.max(1, Number(sp?.page) || 1);

  const qs = (o) => {
    const p = new URLSearchParams();
    const v = { s: cur ? `${cur.platform}:${cur.shop}` : null, tab, stock, sort, q, n: size, page, ...o };
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === '') continue;
      if ((k === 'tab' && x === 'live') || (k === 'sort' && x === 'new') || (k === 'page' && Number(x) === 1)
        || (k === 'n' && Number(x) === PAGE_SIZES[0])) continue;
      p.set(k, String(x));
    }
    const s = p.toString();
    return s ? `/product?${s}` : '/product';
  };

  let err = null, rows = [], counts = {}, stockCounts = {}, shopCounts = {}, preview = new Map(), lastRun = null;
  try {
    if (!cur) throw new Error('ยังไม่มีร้านที่ผูกไว้');
    for (const s of shopRows) shopCounts[`${s.platform}:${s.shop}`] = s.n;

    const sameShop = cur.platform === pf && cur.shop === sh;
    const [listed, logRes] = await Promise.all([
      (sameShop && early) || cachedList(cur.platform, cur.shop, Boolean(q)),
      sb.from('os_sync_log').select('started_at, finished_at, ok, error')
        .eq('platform', `listings:${cur.platform}`).eq('shop', cur.shop)
        .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    lastRun = logRes.data;
    // สำเนาใหม่ทุกครั้ง — ข้างล่างเติมชื่อ/รูปลงแถว ห้ามไปแก้ก้อนที่จำไว้
    const all = (listed || []).map((r) => ({ ...r }));

    // ค้นทั้งชื่อ, รหัสสินค้า, Parent SKU และเลข SKU ของตัวเลือก (เช่นยิงรหัส 163981000XL มาก็เจอ)
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

    for (const t of TABS) counts[t.key] = pool.filter((r) => inTab(r, t.key)).length;
    const inThisTab = pool.filter((r) => inTab(r, tab));
    for (const s of STOCKS) stockCounts[s.key] = inThisTab.filter((r) => inStock(r, s.key)).length;
    rows = inThisTab.filter((r) => inStock(r, stock));
    if (sort === 'stock') rows.sort((a, b) => (a.min_stock ?? 1e9) - (b.min_stock ?? 1e9) || (a.stock ?? 0) - (b.stock ?? 0));
    if (sort === 'price') rows.sort((a, b) => (Number(b.price_max) || 0) - (Number(a.price_max) || 0));

    // ข้อมูลเต็ม + ตัวเลือก 3 ตัวแรก เฉพาะแถวที่อยู่ในหน้านี้
    // กรอง sort < 3 ในฐานข้อมูลเลย — ดึงทุกตัวเลือกเกินเพดาน 1,000 แถว (ตะกร้าละ 60+ ตัว)
    const pageIds = rows.slice((page - 1) * size, page * size).map((r) => r.product_id);
    if (pageIds.length) {
      const [{ data: full, error: e1 }, { data: skus, error: e2 }] = await Promise.all([
        sb.from('os_listings')
          .select('product_id, title, thumb_url, item_sku, sku_n, price_min, price_max, promo_min, promo_max')
          .eq('platform', cur.platform).eq('shop', cur.shop).in('product_id', pageIds),
        sb.from('os_listing_skus')
          .select('product_id, sku_id, seller_sku, variant, price, promo_price, stock, image_url, sort')
          .eq('platform', cur.platform).eq('shop', cur.shop).in('product_id', pageIds)
          .lt('sort', PREVIEW_SKUS)
          .order('sort'),
      ]);
      if (e1 || e2) throw new Error((e1 || e2).message);
      const byId = new Map((full || []).map((f) => [f.product_id, f]));
      for (const r of rows) if (byId.has(r.product_id)) Object.assign(r, byId.get(r.product_id));
      for (const s of skus || []) {
        if (!preview.has(s.product_id)) preview.set(s.product_id, []);
        preview.get(s.product_id).push(s);
      }
    }
  } catch (e) {
    err = String(e.message || e);
  }

  const pages = Math.max(1, Math.ceil(rows.length / size));
  const shown = rows.slice((page - 1) * size, page * size);
  const detailHref = (id) => `/product/${cur.platform}/${encodeURIComponent(cur.shop)}/${encodeURIComponent(id)}`;

  return (
    <>
      <Nav active="product" />

      <div className="row">
        <div>
          <h1>สินค้าของฉัน</h1>
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

      {/* สลับร้าน — คนละร้าน คนละรหัสสินค้า ไม่รวมกัน */}
      <div className="chans">
        {shops.map((s) => {
          const k = `${s.platform}:${s.shop}`;
          return (
            // โหลดร้านอื่นรอไว้ตั้งแต่เปิดหน้า — กดสลับแล้วขึ้นเร็ว (ฝั่งเซิร์ฟเวอร์ใช้ที่จำไว้ ไม่หนัก)
            <Link
              prefetch
              key={k}
              className="chan"
              data-plat={s.platform}
              data-shop={s.shop}
              data-on={cur && k === `${cur.platform}:${cur.shop}` ? '1' : '0'}
              href={qs({ s: k, tab: 'live', stock: '', q: '', page: 1 })}
            >
              {PLATFORM_LABEL[s.platform]} <b>{s.shop}</b> {shopCounts[k] ?? ''}
            </Link>
          );
        })}
      </div>

      {err && (
        <div className="note">
          <b>ดึงข้อมูลไม่ได้</b><br />{err}<br /><br />
          รัน <code>supabase/030_listings.sql</code> และ <code>031_listing_min_stock.sql</code> ใน Supabase ก่อน แล้วกด “ดึงสินค้า”
        </div>
      )}

      {!err && cur && (
        <>
          {/* แถบสถานะแบบหลังร้าน Shopee */}
          <div className="ptabs">
            {TABS.map((t) => (
              <Link
                prefetch={false}
                key={t.key}
                className="ptab"
                data-on={tab === t.key ? '1' : '0'}
                href={qs({ tab: t.key, stock: '', page: 1 })}
              >
                {t.label}{t.key !== 'all' && ` (${(counts[t.key] ?? 0).toLocaleString('en-US')})`}
              </Link>
            ))}
          </div>

          <div className="pcard">
            <div className="ptools">
              <form className="search" action="/product" method="get">
                <input type="hidden" name="s" value={`${cur.platform}:${cur.shop}`} />
                {tab !== 'live' && <input type="hidden" name="tab" value={tab} />}
                {sort !== 'new' && <input type="hidden" name="sort" value={sort} />}
                {size !== PAGE_SIZES[0] && <input type="hidden" name="n" value={size} />}
                <input name="q" defaultValue={q} placeholder="ค้นหาด้วย ชื่อสินค้า, Parent SKU, เลข SKU, รหัสสินค้า" autoComplete="off" inputMode="search" />
                {q && <Link prefetch={false} className="link" href={qs({ q: '', page: 1 })}>ล้าง</Link>}
                <button className="btn" type="submit">ค้นหา</button>
              </form>
            </div>

            <div className="pbar">
              <b>สินค้า {rows.length.toLocaleString('en-US')} รายการ</b>
              <span className="psort">
                {STOCKS.map((s) => (
                  <Link prefetch={false} key={s.key || 'any'} className="chip" data-on={stock === s.key ? '1' : '0'}
                    data-tone={s.key && stockCounts[s.key] ? 'err' : undefined} href={qs({ stock: s.key, page: 1 })}>
                    {s.label}{s.key ? ` ${stockCounts[s.key] ?? 0}` : ''}
                  </Link>
                ))}
                <span className="psep" />
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
              <div className="ptable">
                <div className="ptrow phdr">
                  <div>สินค้า</div>
                  <div className="pcell-price">ราคา</div>
                  <div className="pcell-stock">คลัง</div>
                  <div className="pcell-status">สถานะ</div>
                </div>

                {shown.map((r) => {
                  const vs = preview.get(r.product_id) || [];
                  const t = listingTab(r.status);
                  return (
                    <section key={r.product_id} className="pgroup">
                      <div className="ptrow pmain">
                        <Link prefetch={false} href={detailHref(r.product_id)} className="pcell-name">
                          {r.thumb_url
                            ? <img className="thumb plg" src={r.thumb_url} alt="" loading="lazy" />
                            : <span className="thumb plg thumb-empty" />}
                          <span className="pinfo">
                            <span className="clamp2 ptitle">{r.title || '(ไม่มีชื่อ)'}</span>
                            <span className="sku">Parent SKU: {r.item_sku || '-'}</span>
                            <span className="sku">รหัสสินค้า: {r.product_id}</span>
                          </span>
                        </Link>
                        <div className="pcell-price">
                          {r.promo_min !== null && r.promo_min !== undefined ? (
                            <><span className="promo">{range(r.promo_min, r.promo_max)}</span><div className="sku strike">{range(r.price_min, r.price_max)}</div></>
                          ) : range(r.price_min, r.price_max)}
                        </div>
                        <div className={'pcell-stock ' + (Number(r.stock) === 0 ? 'danger' : '')}>
                          {Number(r.stock) === 0 ? 'หมด' : (r.stock ?? '—')}
                        </div>
                        <div className="pcell-status">
                          <span className={'badge ' + TONE[t]}>{listingLabel(r.status)}</span>
                        </div>
                      </div>

                      {vs.length > 0 && (
                        <div className="psubs">
                          {vs.map((v) => <SkuRow key={v.sku_id} v={v} />)}
                          {r.sku_n > PREVIEW_SKUS && (
                            <SkuMore platform={cur.platform} shop={cur.shop} id={r.product_id} skip={PREVIEW_SKUS} total={r.sku_n} />
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}

            <div className="ppager">
              <Link prefetch={false} className="pgbtn" data-off={page <= 1 ? '1' : '0'} href={qs({ page: Math.max(1, page - 1) })}>‹</Link>
              <span><b>{Math.min(page, pages)}</b> / {pages}</span>
              <Link prefetch={false} className="pgbtn" data-off={page >= pages ? '1' : '0'} href={qs({ page: Math.min(pages, page + 1) })}>›</Link>
              <span className="psizes">
                {PAGE_SIZES.map((n) => (
                  <Link prefetch={false} key={n} className="chip" data-on={size === n ? '1' : '0'} href={qs({ n, page: 1 })}>{n} / หน้า</Link>
                ))}
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
