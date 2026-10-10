// สินค้า — รายการตะกร้าที่ลงขายอยู่ของแต่ละร้าน หน้าตาตามหน้า "สินค้าของฉัน" หลังร้าน Shopee
// แต่เปิดดูได้ทุกร้านจากที่เดียว ไม่ต้องสลับล็อกอินทีละร้าน
//
// หนึ่งแถว = หนึ่งตะกร้า โชว์ตัวเลือกสี/ไซส์ 3 ตัวแรก กด "ดู SKU อื่น" กางที่เหลือในหน้าเดิม
// กดชื่อสินค้าเข้าหน้ารายละเอียด (มียอดขาย 30 วันต่อตัวเลือก)
// ข้อมูลมาจาก os_listings (ดู supabase/030 และ app/api/sync/products) ไม่ได้ถามแพลตฟอร์มตอนเปิดหน้า
import Link from 'next/link';
import { db } from '@/lib/supabase';
import { listingTone, listingLabel, shopsFrom } from '@/lib/listings';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../Nav';
import SyncProducts from './SyncProducts';
import SkuRow from './SkuRow';
import SkuMore from './SkuMore';
import ShopBar from '../ShopBar';

export const dynamic = 'force-dynamic';

const PAGE_SIZES = [12, 24, 48];   // เหมือนหลังร้าน Shopee — หน้าเล็กโหลดเร็ว
const PREVIEW_SKUS = 3;
const LOW_STOCK = 2;   // เหลือ ≤2 = ควรระวัง (มาตรการกันชิ้นสุดท้ายใน CLAUDE.md) — ตัวเลขเดียวกับใน supabase/034
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop', thaimart: 'Thaimart' };
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

export default async function ProductPage({ searchParams }) {
  const sp = await searchParams;
  const [pf, sh] = String(sp?.s || '').split(':');
  const tab = TABS.some((t) => t.key === sp?.tab) ? sp.tab : 'live';
  const stock = STOCKS.some((s) => s.key === sp?.stock) ? sp.stock : '';
  const sort = SORTS.some((s) => s.key === sp?.sort) ? sp.sort : 'new';
  const q = String(sp?.q || '').trim();
  const size = PAGE_SIZES.includes(Number(sp?.n)) ? Number(sp.n) : PAGE_SIZES[0];
  const page = Math.max(1, Number(sp?.page) || 1);

  // ถามครั้งเดียวได้ทุกอย่างของหน้า (supabase/034) — เซิร์ฟเวอร์อยู่อเมริกา ฐานข้อมูลอยู่เอเชีย
  // ถามหนึ่งครั้ง ~0.3 วินาที เดิมถาม 3-5 ครั้งต่อกัน
  let err = null, d = null;
  try {
    const res = await db().rpc('os_product_page', {
      p_platform: pf || null, p_shop: sh || null, p_tab: tab, p_stock: stock, p_sort: sort,
      // % กับ _ เป็นอักขระพิเศษของ ilike — ตัดออกให้ค้นตรงตัว
      p_q: q.replace(/[%_]/g, ' ').trim(), p_page: page, p_size: size, p_preview: PREVIEW_SKUS,
    });
    if (res.error) throw new Error(res.error.message);
    d = res.data;
  } catch (e) {
    err = String(e.message || e);
  }

  const shops = shopsFrom(d?.shop_list);
  const cur = d?.platform ? { platform: d.platform, shop: d.shop } : shops[0];
  const shopCounts = Object.fromEntries(shops.map((s) => [`${s.platform}:${s.shop}`, s.n]));
  const counts = d?.counts || {};
  const stockCounts = { '': d?.stock_counts?.any, out: d?.stock_counts?.out, low: d?.stock_counts?.low };
  const total = d?.total || 0;
  const shown = d?.rows || [];
  const preview = new Map(shown.map((r) => [r.product_id, r.preview || []]));
  const lastRun = d?.last_run || null;
  const rows = { length: total };   // ใช้ในข้อความ "สินค้า n รายการ"
  if (!err && !cur) err = 'ยังไม่มีร้านที่ผูกไว้';

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

  const pages = Math.max(1, Math.ceil(total / size));
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
      {/* โหลดร้านอื่นรอไว้ตั้งแต่เปิดหน้า (prefetch) — กดสลับแล้วขึ้นเร็ว (ฝั่งเซิร์ฟเวอร์ใช้ที่จำไว้ ไม่หนัก) */}
      <ShopBar
        prefetch
        items={shops.map((s) => {
          const k = `${s.platform}:${s.shop}`;
          return { ...s, href: qs({ s: k, tab: 'live', stock: '', q: '', page: 1 }), on: Boolean(cur) && k === `${cur.platform}:${cur.shop}`, count: shopCounts[k] ?? null };
        })}
      />

      {err && (
        <div className="note">
          <b>ดึงข้อมูลไม่ได้</b><br />{err}<br /><br />
          รัน <code>supabase/030</code> ถึง <code>034</code> ใน Supabase ก่อน แล้วกด “ดึงสินค้า”
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
            {/* เทียบกับร้านอื่นในกลุ่มเดียวกัน (ดู app/product/compare) */}
            <Link prefetch={false} className="ptab" data-on="0" href={`/product/compare?s=${encodeURIComponent(`${cur.platform}:${cur.shop}`)}`}>
              เทียบร้านอื่น
            </Link>
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
                          <span className={'badge ' + listingTone(r)}>{listingLabel(r.status)}</span>
                          {r.deboost && <div><span className="badge err" style={{ marginTop: 4 }}>ถูกลดการมองเห็น</span></div>}
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
