// ยอดขาย — แต่ละตะกร้าขายไปกี่ชิ้น เรียงขายดี/ขายไม่ออก แยกร้าน
//
// แต่ละเจ้าใช้ข้อมูลคนละแหล่ง (ดู supabase/033):
//   TikTok   ถาม Analytics ตอนเปิดหน้า — ตรงกับ "ผลการดำเนินงาน" หลังร้าน ย้อนได้ 180 วัน มียอดขายบาทด้วย
//   Shopee   ทั้งหมด = ยอดสะสมที่ Shopee นับเอง (sold_total) · 1 เดือน = นับจากออเดอร์ในระบบ
//   ThisShop 1 เดือน = นับจากออเดอร์ในระบบ
// ออเดอร์ที่จบแล้วในระบบเราถูกล้างหลัง 30 วัน (ดู 005) จึงย้อนจากออเดอร์ได้แค่ 1 เดือน
import Link from 'next/link';
import { unstable_cache } from 'next/cache';
import { db } from '@/lib/supabase';
import { listShops, usableToken } from '@/lib/tokens';
import { productSales, SALES_LOOKBACK_DAYS } from '@/lib/tiktok';
import { inListingTab, listingTone, listingLabel } from '@/lib/listings';
import { salesUnlocked, MASK } from '@/lib/pin';
import Nav from '../Nav';
import PinBox from '../PinBox';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', thisshop: 'ThisShop' };
// ช่วงที่แต่ละเจ้ามีข้อมูลจริง — ไม่โชว์ปุ่มที่ไม่มีข้อมูลรองรับ
const RANGES = {
  tiktok: [
    { key: '30', label: '1 เดือน', days: 30 },
    { key: '90', label: '3 เดือน', days: 90 },
    { key: '180', label: '6 เดือน', days: SALES_LOOKBACK_DAYS },
  ],
  shopee: [
    { key: '30', label: '1 เดือน', days: 30 },
    { key: 'all', label: 'ทั้งหมด' },
  ],
  thisshop: [
    { key: '30', label: '1 เดือน', days: 30 },
  ],
};
const SHOWS = [
  { key: 'live', label: 'เฉพาะที่ขายอยู่' },
  { key: 'all', label: 'ทุกสถานะ' },
];

const baht = (n) => (n === null || n === undefined ? '—' : '฿' + Math.round(Number(n)).toLocaleString('en-US'));
const num = (n) => Number(n || 0).toLocaleString('en-US');
const range = (a, b) => (a === null || a === undefined ? '—' : Number(a) === Number(b) ? baht(a) : `${baht(a)} - ${baht(b)}`);

async function shopList() {
  const [shopee, tiktok] = await Promise.all([listShops('shopee'), listShops('tiktok')]);
  return [
    ...shopee.map((s) => ({ platform: 'shopee', shop: s.shop })).sort((a, b) => a.shop.localeCompare(b.shop)),
    ...tiktok.map((s) => ({ platform: 'tiktok', shop: s.shop })),
    ...(process.env.THISSHOP_APP_ID ? [{ platform: 'thisshop', shop: 'THISSHOP' }] : []),
  ];
}

// ทุกตะกร้าของร้าน เฉพาะคอลัมน์ที่ใช้จัดอันดับ — ชื่อ/รูป/ราคาดึงเฉพาะแถวที่โชว์
async function lightListings(platform, shop) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('os_listings')
      .select('product_id, status, deboost, stock, sold_total')
      .eq('platform', platform).eq('shop', shop)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// TikTok: ถาม Analytics (ข้อมูลช้า ~2 วัน เปลี่ยนวันละครั้ง) จำไว้ 1 ชั่วโมง
// ต้องแปลง Map เป็น array — unstable_cache เก็บได้แค่ข้อมูลแบบ JSON
const tiktokSales = unstable_cache(async (shop, days) => {
  const row = (await listShops('tiktok')).find((s) => s.shop === shop);
  if (!row) throw new Error(`ไม่พบร้าน TikTok ${shop}`);
  const tok = await usableToken(row);
  const m = await productSales({ accessToken: tok.access_token, shopCipher: tok.shop_cipher, days });
  return [...m.entries()];
}, ['summary-tiktok-sales'], { revalidate: 3600 });

// Shopee/ThisShop 1 เดือน: นับจากออเดอร์ในระบบ — ออเดอร์เข้าตลอด จำไว้ 5 นาที
const orderSales = unstable_cache(async (platform, shop) => {
  const { data, error } = await db().rpc('os_listing_sales', { p_platform: platform, p_shop: shop, p_days: 30 });
  if (error) throw new Error(error.message);
  const by = {};
  for (const x of data || []) by[x.product_id] = (by[x.product_id] || 0) + Number(x.qty);
  return by;
}, ['summary-order-sales'], { revalidate: 300 });

export default async function SummaryPage({ searchParams }) {
  const sp = await searchParams;
  const shops = await shopList();
  const [pf, sh] = String(sp?.s || '').split(':');
  const cur = shops.find((s) => s.platform === pf && s.shop === sh) || shops[0];
  const ranges = RANGES[cur?.platform] || RANGES.thisshop;
  const rng = ranges.find((r) => r.key === sp?.r) || ranges[0];
  const show = SHOWS.some((s) => s.key === sp?.show) ? sp.show : 'live';
  const dir = sp?.dir === 'asc' ? 'asc' : 'desc';
  const q = String(sp?.q || '').trim();
  const page = Math.max(1, Number(sp?.page) || 1);
  const hasGmv = cur?.platform === 'tiktok';
  // จำนวนชิ้นที่ขาย/ยอดขายบาท ส่งไปเบราว์เซอร์เฉพาะตอนใส่รหัสแล้ว (ดู lib/pin.js)
  // ลำดับขายดี/ขายไม่ออกยังเรียงได้ตามปกติ แต่ไม่เห็นตัวเลข
  const unlocked = await salesUnlocked();
  const hide = (v) => (unlocked ? v : MASK);

  const qs = (o) => {
    const p = new URLSearchParams();
    const v = { s: cur ? `${cur.platform}:${cur.shop}` : null, r: rng.key, show, dir, q, page, ...o };
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === '') continue;
      if ((k === 'r' && x === '30') || (k === 'show' && x === 'live') || (k === 'dir' && x === 'desc') || (k === 'page' && Number(x) === 1)) continue;
      p.set(k, String(x));
    }
    const s = p.toString();
    return s ? `/summary?${s}` : '/summary';
  };

  let err = null, rows = [], totalUnits = 0, totalGmv = 0, zero = 0, shown = [];
  try {
    if (!cur) throw new Error('ยังไม่มีร้านที่ผูกไว้');
    const sb = db();

    const [all, sales] = await Promise.all([
      lightListings(cur.platform, cur.shop),
      cur.platform === 'tiktok' ? tiktokSales(cur.shop, rng.days).then((e) => new Map(e))
        : rng.key === 'all' ? null
          : orderSales(cur.platform, cur.shop).then((o) => new Map(Object.entries(o))),
    ]);

    // ยอดของแต่ละตะกร้าในช่วงที่เลือก
    const unitsOf = (r) => {
      if (cur.platform === 'tiktok') return sales.get(r.product_id)?.units ?? 0;
      if (rng.key === 'all') return r.sold_total;   // null = รอบดึงสินค้ายังไม่ได้อ่านตัวเลขนี้
      return sales.get(r.product_id) || 0;
    };
    let pool = all
      .filter((r) => show === 'all' || inListingTab(r, 'live'))
      .map((r) => ({ ...r, units: unitsOf(r), gmv: hasGmv ? (sales.get(r.product_id)?.gmv ?? 0) : null }));

    // ค้นชื่อ/รหัสสินค้า/เลข SKU — ชื่อไม่ได้อยู่ในก้อนเบา ถามฐานข้อมูลตรงๆ
    if (q) {
      const like = `%${q.replace(/[%_,()"]/g, ' ')}%`;
      const idQ = q.replace(/[^0-9]/g, '');
      // ค่าใน .or() ต้องครอบเครื่องหมายคำพูด — ชื่อสินค้ามีวรรค/จุลภาคได้
      const ors = [`title.ilike."${like}"`, ...(idQ ? [`product_id.eq.${idQ}`] : [])].join(',');
      const [{ data: byTitle }, { data: bySku }] = await Promise.all([
        sb.from('os_listings').select('product_id').eq('platform', cur.platform).eq('shop', cur.shop)
          .or(ors).limit(2000),
        sb.from('os_listing_skus').select('product_id').eq('platform', cur.platform).eq('shop', cur.shop)
          .ilike('seller_sku', like).limit(2000),
      ]);
      const hit = new Set([...(byTitle || []), ...(bySku || [])].map((r) => r.product_id));
      pool = pool.filter((r) => hit.has(r.product_id));
    }

    for (const r of pool) {
      totalUnits += Number(r.units) || 0;
      totalGmv += Number(r.gmv) || 0;
      if (!r.units) zero++;
    }
    // ไม่มีตัวเลข (null) ไปท้ายเสมอ ไม่ว่าเรียงทางไหน · เท่ากันให้คลังมากขึ้นก่อน (ของจมทุน)
    const val = (r) => (r.units === null || r.units === undefined ? null : Number(r.units));
    rows = pool.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (dir === 'asc' ? x - y : y - x) || (Number(b.stock) || 0) - (Number(a.stock) || 0);
    });
    rows.forEach((r, i) => { r.rank = i + 1; });

    shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (shown.length) {
      const { data: full, error: e1 } = await sb.from('os_listings')
        .select('product_id, title, thumb_url, item_sku, sku_n, price_min, price_max, promo_min, promo_max')
        .eq('platform', cur.platform).eq('shop', cur.shop).in('product_id', shown.map((r) => r.product_id));
      if (e1) throw new Error(e1.message);
      const byId = new Map((full || []).map((f) => [f.product_id, f]));
      shown = shown.map((r) => ({ ...r, ...byId.get(r.product_id) }));
    }
  } catch (e) {
    err = String(e.message || e);
  }

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const detailHref = (id) => `/product/${cur.platform}/${encodeURIComponent(cur.shop)}/${encodeURIComponent(id)}`;
  const source = cur?.platform === 'tiktok'
    ? 'จาก TikTok Analytics (ตรงกับหลังร้าน ข้อมูลช้า ~2 วัน)'
    : rng.key === 'all' ? 'ยอดสะสมที่ Shopee นับเอง' : 'นับจากออเดอร์ในระบบ (ไม่นับยกเลิก)';

  return (
    <>
      <Nav active="summary" />

      <div className="row">
        <div>
          <h1>ยอดขายรายตะกร้า</h1>
          <div className="sub">{cur ? `${PLATFORM_LABEL[cur.platform]} · ${cur.shop} · ${rng.label} · ${source}` : 'ยังไม่มีร้าน'}</div>
        </div>
        <PinBox unlocked={unlocked} back={qs({})} wrong={sp?.pin === 'wrong'} />
      </div>

      <div className="chans">
        {shops.map((s) => {
          const k = `${s.platform}:${s.shop}`;
          return (
            <Link prefetch={false} key={k} className="chan" data-plat={s.platform} data-shop={s.shop}
              data-on={cur && k === `${cur.platform}:${cur.shop}` ? '1' : '0'}
              href={qs({ s: k, r: '30', q: '', page: 1 })}>
              {PLATFORM_LABEL[s.platform]} <b>{s.shop}</b>
            </Link>
          );
        })}
      </div>

      {err && (
        <div className="note">
          <b>ดึงข้อมูลไม่ได้</b><br />{err}<br /><br />
          ถ้าขึ้นว่าไม่มีฟังก์ชัน os_listing_sales ให้รัน <code>supabase/033_listing_sales.sql</code> ใน Supabase ก่อน
        </div>
      )}

      {!err && cur && (
        <>
          {/* ช่วงเวลา — คนละเจ้ามีข้อมูลย้อนหลังไม่เท่ากัน */}
          <div className="ptabs">
            {ranges.map((r) => (
              <Link prefetch={false} key={r.key} className="ptab" data-on={rng.key === r.key ? '1' : '0'} href={qs({ r: r.key, page: 1 })}>
                {r.label}
              </Link>
            ))}
          </div>

          <div className="mcards">
            <div className="mcard hero"><span className="mlabel">ขายรวม ({rng.label})</span><b>{hide(`${num(totalUnits)} ชิ้น`)}</b></div>
            {hasGmv && <div className="mcard"><span className="mlabel">ยอดขาย</span><b>{hide(baht(totalGmv))}</b></div>}
            <div className="mcard"><span className="mlabel">ตะกร้าที่นับ</span><b>{num(rows.length)}</b></div>
            <div className="mcard">
              <span className="mlabel">ขายไม่ได้เลยในช่วงนี้</span><b className={zero ? 'danger' : ''}>{num(zero)}</b>
              {zero > 0 && <Link prefetch={false} className="mfoot" href={qs({ dir: 'asc', page: 1 })}>ดูตัวที่ขายไม่ออก →</Link>}
            </div>
          </div>

          <div className="pcard">
            <div className="ptools">
              <form className="search" action="/summary" method="get">
                <input type="hidden" name="s" value={`${cur.platform}:${cur.shop}`} />
                {rng.key !== '30' && <input type="hidden" name="r" value={rng.key} />}
                {show !== 'live' && <input type="hidden" name="show" value={show} />}
                {dir !== 'desc' && <input type="hidden" name="dir" value={dir} />}
                <input name="q" defaultValue={q} placeholder="ค้นหาด้วย ชื่อสินค้า, เลข SKU, รหัสสินค้า" autoComplete="off" inputMode="search" />
                {q && <Link prefetch={false} className="link" href={qs({ q: '', page: 1 })}>ล้าง</Link>}
                <button className="btn" type="submit">ค้นหา</button>
              </form>
            </div>

            <div className="pbar">
              <span className="psort">
                <Link prefetch={false} className="chip" data-on={dir === 'desc' ? '1' : '0'} href={qs({ dir: 'desc', page: 1 })}>ขายดีก่อน</Link>
                <Link prefetch={false} className="chip" data-on={dir === 'asc' ? '1' : '0'} href={qs({ dir: 'asc', page: 1 })}>ขายน้อยก่อน</Link>
                <span className="psep" />
                {SHOWS.map((s) => (
                  <Link prefetch={false} key={s.key} className="chip" data-on={show === s.key ? '1' : '0'} href={qs({ show: s.key, page: 1 })}>{s.label}</Link>
                ))}
              </span>
            </div>

            {rows.length === 0 ? (
              <div className="note">ไม่มีสินค้า{q ? `ที่ตรงกับ “${q}”` : ' — ไปที่หน้าสินค้าแล้วกด “ดึงสินค้า” ก่อน'}</div>
            ) : (
              <div className="ptable">
                <div className={'ptrow phdr srow' + (hasGmv ? ' gmv' : '')}>
                  <div className="pcell-rank">#</div>
                  <div>สินค้า</div>
                  <div className="pcell-price">ราคา</div>
                  <div className="pcell-stock">คลัง</div>
                  <div className="pcell-sold">ขาย (ชิ้น)</div>
                  {hasGmv && <div className="pcell-sold">ยอดขาย</div>}
                </div>
                {shown.map((r) => (
                  <section key={r.product_id} className="pgroup">
                    <div className={'ptrow pmain srow' + (hasGmv ? ' gmv' : '')}>
                      <div className="pcell-rank">{r.rank}</div>
                      <Link prefetch={false} href={detailHref(r.product_id)} className="pcell-name">
                        {r.thumb_url ? <img className="thumb plg" src={r.thumb_url} alt="" loading="lazy" /> : <span className="thumb plg thumb-empty" />}
                        <span className="pinfo">
                          <span className="clamp2 ptitle">{r.title || '(ไม่มีชื่อ)'}</span>
                          <span className="sku">รหัสสินค้า: {r.product_id} · {r.sku_n ?? '—'} ตัวเลือก</span>
                          {!inListingTab(r, 'live') || r.deboost ? (
                            <span><span className={'badge ' + listingTone(r)}>{r.deboost ? 'ถูกลดการมองเห็น' : listingLabel(r.status)}</span></span>
                          ) : null}
                        </span>
                      </Link>
                      <div className="pcell-price">
                        {r.promo_min !== null && r.promo_min !== undefined
                          ? <><span className="promo">{range(r.promo_min, r.promo_max)}</span><div className="sku strike">{range(r.price_min, r.price_max)}</div></>
                          : range(r.price_min, r.price_max)}
                      </div>
                      <div className={'pcell-stock ' + (Number(r.stock) === 0 ? 'danger' : '')}>{Number(r.stock) === 0 ? 'หมด' : (r.stock ?? '—')}</div>
                      <div className="pcell-sold">
                        {!unlocked ? <span className="sku">{MASK}</span>
                          : r.units === null || r.units === undefined ? <span className="sku">—</span>
                            : r.units ? <b>{num(r.units)}</b> : <span className="danger">0</span>}
                      </div>
                      {hasGmv && <div className="pcell-sold">{!unlocked ? <span className="sku">{MASK}</span> : r.gmv ? baht(r.gmv) : <span className="sku">—</span>}</div>}
                    </div>
                  </section>
                ))}
              </div>
            )}

            {pages > 1 && (
              <div className="ppager">
                <Link prefetch={false} className="pgbtn" data-off={page <= 1 ? '1' : '0'} href={qs({ page: Math.max(1, page - 1) })}>‹</Link>
                <span><b>{Math.min(page, pages)}</b> / {pages}</span>
                <Link prefetch={false} className="pgbtn" data-off={page >= pages ? '1' : '0'} href={qs({ page: Math.min(pages, page + 1) })}>›</Link>
              </div>
            )}
          </div>

          {cur.platform === 'shopee' && rng.key === 'all' && rows.some((r) => r.units === null) && (
            <div className="sub" style={{ marginTop: 10 }}>
              ตะกร้าที่ขึ้น — ยังไม่ได้อ่านยอดสะสมจาก Shopee — จะครบเองในรอบดึงสินค้าถัดไป (ทุกชั่วโมง)
            </div>
          )}
        </>
      )}
    </>
  );
}
