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
import { inListingTab, listingTone, listingLabel, shopsFrom } from '@/lib/listings';
import { salesUnlocked, MASK } from '@/lib/pin';
import Nav from '../Nav';
import PinBox from '../PinBox';
import ShopBar from '../ShopBar';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop', thaimart: 'Thaimart' };
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

// TikTok: ถาม Analytics (ข้อมูลช้า ~2 วัน เปลี่ยนวันละครั้ง) จำไว้ 1 ชั่วโมง
// คืน {product_id: [ชิ้น, บาท]} ส่งต่อให้ฐานข้อมูลจัดอันดับ (os_summary_page, supabase/034)
const tiktokSales = unstable_cache(async (shop, days) => {
  const row = (await listShops('tiktok')).find((s) => s.shop === shop);
  if (!row) throw new Error(`ไม่พบร้าน TikTok ${shop}`);
  const tok = await usableToken(row);
  const m = await productSales({ accessToken: tok.access_token, shopCipher: tok.shop_cipher, days });
  return Object.fromEntries([...m.entries()].map(([id, v]) => [id, [v.units, v.gmv]]));
}, ['summary-tiktok-sales-v2'], { revalidate: 3600 });

const rangesOf = (platform) => RANGES[platform] || RANGES.shopee;

export default async function SummaryPage({ searchParams }) {
  const sp = await searchParams;
  const [pf, sh] = String(sp?.s || '').split(':');
  // ยังไม่รู้ร้านจริงจนกว่าฐานข้อมูลตอบ (ร้านที่ขอมาอาจไม่มี) — เดาจากลิงก์ก่อน ค่าเริ่มต้นคือ Shopee
  const guess = RANGES[pf] ? pf : 'shopee';
  const show = SHOWS.some((s) => s.key === sp?.show) ? sp.show : 'live';
  const dir = sp?.dir === 'asc' ? 'asc' : 'desc';
  const q = String(sp?.q || '').trim();
  const page = Math.max(1, Number(sp?.page) || 1);
  let rng = rangesOf(guess).find((r) => r.key === sp?.r) || rangesOf(guess)[0];
  // จำนวนชิ้นที่ขาย/ยอดขายบาท ส่งไปเบราว์เซอร์เฉพาะตอนใส่รหัสแล้ว (ดู lib/pin.js)
  // ลำดับขายดี/ขายไม่ออกยังเรียงได้ตามปกติ แต่ไม่เห็นตัวเลข
  const unlocked = await salesUnlocked();
  const hide = (v) => (unlocked ? v : MASK);

  // ถามครั้งเดียวได้ทุกอย่างของหน้า (supabase/034) — TikTok ถาม Analytics ก่อนแล้วส่งยอดไปให้จัดอันดับ
  let err = null, d = null;
  try {
    const sales = guess === 'tiktok' && sh ? await tiktokSales(sh, rng.days) : null;
    const res = await db().rpc('os_summary_page', {
      p_platform: pf || null, p_shop: sh || null, p_range: rng.key, p_show: show, p_dir: dir,
      p_q: q.replace(/[%_]/g, ' ').trim(), p_page: page, p_size: PAGE_SIZE, p_sales: sales,
    });
    if (res.error) throw new Error(res.error.message);
    d = res.data;
  } catch (e) {
    err = String(e.message || e);
  }

  const shops = shopsFrom(d?.shop_list);
  const cur = d?.platform ? { platform: d.platform, shop: d.shop } : shops[0];
  const ranges = rangesOf(cur?.platform);
  if (!ranges.some((r) => r.key === rng.key)) rng = ranges[0];
  const hasGmv = cur?.platform === 'tiktok';
  const rows = { length: d?.total || 0, some: () => (d?.missing || 0) > 0 };
  const shown = d?.rows || [];
  const totalUnits = d?.units || 0;
  const totalGmv = d?.gmv || 0;
  const zero = d?.zero || 0;
  if (!err && !cur) err = 'ยังไม่มีร้านที่ผูกไว้';

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

      <ShopBar
        prefetch
        items={shops.map((s) => {
          const k = `${s.platform}:${s.shop}`;
          return { ...s, href: qs({ s: k, r: '30', q: '', page: 1 }), on: Boolean(cur) && k === `${cur.platform}:${cur.shop}` };
        })}
      />

      {err && (
        <div className="note">
          <b>ดึงข้อมูลไม่ได้</b><br />{err}<br /><br />
          ถ้าขึ้นว่าไม่มีฟังก์ชัน ให้รัน <code>supabase/033</code> และ <code>034</code> ใน Supabase ก่อน
        </div>
      )}

      {!err && cur && (
        <>
          {/* ช่วงเวลา — คนละเจ้ามีข้อมูลย้อนหลังไม่เท่ากัน */}
          <div className="ptabs">
            {ranges.map((r) => (
              <Link prefetch key={r.key} className="ptab" data-on={rng.key === r.key ? '1' : '0'} href={qs({ r: r.key, page: 1 })}>
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
