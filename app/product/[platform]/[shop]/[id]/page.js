// ตะกร้าเดียว — ตัวเลือกสี/ไซส์ครบทุกตัว พร้อมราคา ราคาพิเศษ คลังบนแพลตฟอร์ม และขายไปกี่ชิ้นใน 30 วัน
import Link from 'next/link';
import { db } from '@/lib/supabase';
import { listShops } from '@/lib/tokens';
import { listingGroup, listingLabel } from '@/lib/listings';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../../../../Nav';

export const dynamic = 'force-dynamic';

const SOLD_DAYS = 30;   // ออเดอร์ที่จบแล้วถูกล้างหลัง 30 วัน (ดู supabase/005) ย้อนไกลกว่านี้ไม่ครบ
const LOW_STOCK = 2;
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', thisshop: 'ThisShop' };
const baht = (n) => (n === null || n === undefined ? '—' : '฿' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));

// fmtTimeTH ได้ "01 ก.ย. 09:40" — เติมปีไว้ด้วย ตะกร้าเก่าอาจสร้างข้ามปี
const fmtDate = (s) => (s ? `${fmtTimeTH(s)} ${new Date(new Date(s).getTime() + 7 * 3600000).getUTCFullYear() + 543}` : '—');

// ขายไปกี่ชิ้นต่อตัวเลือก — นับจากออเดอร์ที่ไม่ยกเลิก/ยังไม่จ่าย
// จับคู่ด้วยรหัสตัวเลือกของแพลตฟอร์มก่อน ตะกร้าที่ไม่มีตัวเลือก (Shopee model_id = 0) ใช้ SKU แทน
async function soldBySku(sb, platform, shop, skus) {
  const since = new Date(Date.now() - SOLD_DAYS * 86400000).toISOString();
  const base = () => sb.from('os_order_items')
    .select('platform_sku_id, sku, qty, os_orders!inner(platform, shop, status, ordered_at)')
    .eq('os_orders.platform', platform).eq('os_orders.shop', shop)
    .not('os_orders.status', 'in', '(cancelled,unpaid)')
    .gte('os_orders.ordered_at', since)
    .limit(5000);
  const ids = skus.map((s) => s.sku_id);
  const codes = skus.map((s) => s.seller_sku).filter(Boolean);
  const [a, b] = await Promise.all([
    base().in('platform_sku_id', ids),
    codes.length ? base().is('platform_sku_id', null).in('sku', codes) : { data: [] },
  ]);
  const out = new Map();
  const add = (k, n) => out.set(k, (out.get(k) || 0) + (Number(n) || 0));
  for (const r of a.data || []) add(`id:${r.platform_sku_id}`, r.qty);
  for (const r of b.data || []) add(`sku:${r.sku}`, r.qty);
  return (s) => (out.get(`id:${s.sku_id}`) || 0) + (out.get(`sku:${s.seller_sku}`) || 0);
}

export default async function ListingDetail({ params }) {
  const p = await params;
  const platform = p.platform;
  const shop = decodeURIComponent(p.shop);
  const id = decodeURIComponent(p.id);
  const sb = db();
  const back = `/product?s=${encodeURIComponent(`${platform}:${shop}`)}`;

  const [{ data: l }, { data: skus }] = await Promise.all([
    sb.from('os_listings').select('*').eq('platform', platform).eq('shop', shop).eq('product_id', id).maybeSingle(),
    sb.from('os_listing_skus').select('*').eq('platform', platform).eq('shop', shop).eq('product_id', id).order('sort'),
  ]);

  if (!l) {
    return (
      <>
        <Nav active="product" />
        <Link className="sub" href={back}>← กลับหน้าสินค้า</Link>
        <h1>ไม่พบสินค้า {id}</h1>
      </>
    );
  }

  const list = skus || [];
  const sold = await soldBySku(sb, platform, shop, list).catch(() => () => null);
  const soldTotal = list.reduce((n, s) => n + (sold(s) || 0), 0);
  const outN = list.filter((s) => Number(s.stock) === 0).length;
  const lowN = list.filter((s) => Number(s.stock) > 0 && Number(s.stock) <= LOW_STOCK).length;
  const g = listingGroup(l.status);

  // ลิงก์ไปหน้าสินค้าบนแพลตฟอร์ม — Shopee ต้องใช้ shop_id ของร้านประกอบ
  let platformUrl = null;
  if (platform === 'shopee') {
    const row = (await listShops('shopee')).find((s) => s.shop === shop);
    if (row?.shop_id) platformUrl = `https://shopee.co.th/product/${row.shop_id}/${l.product_id}`;
  }

  return (
    <>
      <Nav active="product" />
      <Link className="sub" href={back}>← กลับหน้าสินค้า {PLATFORM_LABEL[platform]} {shop}</Link>

      <div className="phero">
        {l.thumb_url ? <img className="thumb" src={l.thumb_url} alt="" /> : <span className="thumb thumb-empty" />}
        <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
          <h1 style={{ fontSize: 17, lineHeight: 1.4, margin: 0 }}>{l.title || '(ไม่มีชื่อ)'}</h1>
          <div className="pmeta">
            <span className={'badge ' + (g === 'live' ? 'ok' : g === 'off' ? 'dim' : 'err')}>{listingLabel(l.status)}</span>
            <span className="plat" data-plat={platform}>{PLATFORM_LABEL[platform]}</span>
            <span className="shop" data-shop={shop}>{shop}</span>
            <span className="mono">ID {l.product_id}</span>
            {l.item_sku && <span>Parent SKU <b className="mono">{l.item_sku}</b></span>}
            {platformUrl && <a href={platformUrl} target="_blank" rel="noreferrer">เปิดบน Shopee ↗</a>}
          </div>
        </div>
      </div>

      <div className="mcards">
        <div className="mcard"><span className="mlabel">ตัวเลือก</span><b>{list.length}</b></div>
        <div className="mcard">
          <span className="mlabel">คลังรวม (บนแพลตฟอร์ม)</span><b>{l.stock ?? '—'}</b>
          {(outN > 0 || lowN > 0) && (
            <span className="mfoot">
              {outN > 0 && <span className="danger">หมด {outN} ตัว</span>}
              {outN > 0 && lowN > 0 && ' · '}
              {lowN > 0 && <span className="lowstock">เหลือ ≤{LOW_STOCK} {lowN} ตัว</span>}
            </span>
          )}
        </div>
        <div className="mcard">
          <span className="mlabel">ราคา</span>
          <b style={{ fontSize: 17 }}>{Number(l.price_min) === Number(l.price_max) ? baht(l.price_min) : `${baht(l.price_min)}–${baht(l.price_max)}`}</b>
          {l.promo_min !== null && (
            <span className="mfoot promo">
              โปร {Number(l.promo_min) === Number(l.promo_max) ? baht(l.promo_min) : `${baht(l.promo_min)}–${baht(l.promo_max)}`}
            </span>
          )}
        </div>
        <div className="mcard"><span className="mlabel">ขาย {SOLD_DAYS} วัน (ชิ้น)</span><b>{soldTotal}</b></div>
      </div>

      <div className="skutable-wrap">
        <table className="skutable">
          <thead>
            <tr>
              <th>ตัวเลือก</th>
              <th>SKU</th>
              <th className="r">ราคา</th>
              <th className="r">ราคาพิเศษ</th>
              <th className="r">คลัง</th>
              <th className="r">ขาย {SOLD_DAYS} วัน</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => {
              const st = Number(s.stock);
              const n = sold(s);
              return (
                <tr key={s.sku_id} className={st === 0 ? 'out' : ''}>
                  <td>
                    <div className="line" style={{ marginBottom: 0, alignItems: 'center' }}>
                      {s.image_url ? <img className="thumb sm" src={s.image_url} alt="" loading="lazy" /> : null}
                      <span>{s.variant || '—'}</span>
                    </div>
                  </td>
                  <td>
                    <div className="mono">{s.seller_sku || '—'}</div>
                    <div className="sku">SKU ID: {s.sku_id}</div>
                  </td>
                  <td className="num">{baht(s.price)}</td>
                  <td className="num">{s.promo_price !== null ? <span className="promo">{baht(s.promo_price)}</span> : '—'}</td>
                  <td className={'num ' + (st === 0 ? 'danger' : st <= LOW_STOCK ? 'lowstock' : '')}>{s.stock ?? '—'}</td>
                  <td className="num">{n === null ? '—' : n || <span className="sku">0</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sub" style={{ marginTop: 12 }}>
        สร้างบนแพลตฟอร์ม {fmtDate(l.remote_created_at)} · แก้ไขล่าสุด {fmtDate(l.remote_updated_at)} · ดึงมาเมื่อ {fmtDate(l.synced_at)}
        <br />คลังคือตัวเลขที่ตั้งไว้บนแพลตฟอร์ม ไม่ใช่สต็อกจริงใน Seniorsoft
      </div>
    </>
  );
}
