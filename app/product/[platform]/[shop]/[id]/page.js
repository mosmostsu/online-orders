// ตะกร้าเดียว — ตัวเลือกสี/ไซส์ครบทุกตัว พร้อมราคา ราคาพิเศษ คลังบนแพลตฟอร์ม และขายไปกี่ชิ้นใน 30 วัน
// Shopee: ปุ่ม "แก้ไขสินค้า" (หน้า ./edit แบบ BigSeller) และ "แก้โปร" (ป็อปอัพ app/product/PromoPop.js) เมื่อใส่รหัสแล้ว
// TikTok / Lazada (ราคาพิเศษ): ปุ่ม "แก้โปร" (ป็อปอัพเดียวกัน) · Lazada บอกด้วยว่ามีราคาพิเศษกี่ตัวเลือก (ตามรอบซิงก์)
import Link from 'next/link';
import { db } from '@/lib/supabase';
import { listingTone, listingLabel } from '@/lib/listings';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../../../../Nav';
import { salesUnlocked, MASK } from '@/lib/pin';
import { LAZADA_SPECIAL } from '@/lib/discounts';
import PinBox from '../../../../PinBox';
import PromoPop from '../../../PromoPop';

export const dynamic = 'force-dynamic';

const SOLD_DAYS = 30;   // ต้องตรงกับ os_listing_detail (supabase/034)
const LOW_STOCK = 2;
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop', thaimart: 'Thaimart' };
const baht = (n) => (n === null || n === undefined ? '—' : '฿' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }));

// fmtTimeTH ได้ "01 ก.ย. 09:40" — เติมปีไว้ด้วย ตะกร้าเก่าอาจสร้างข้ามปี
const fmtDate = (s) => (s ? `${fmtTimeTH(s)} ${new Date(new Date(s).getTime() + 7 * 3600000).getUTCFullYear() + 543}` : '—');

export default async function ListingDetail({ params, searchParams }) {
  const p = await params;
  const sp = await searchParams;
  const platform = p.platform;
  const shop = decodeURIComponent(p.shop);
  const id = decodeURIComponent(p.id);
  const back = `/product?s=${encodeURIComponent(`${platform}:${shop}`)}`;

  // ขายกี่ชิ้นซ่อนไว้จนกว่าจะใส่รหัส (ดู lib/pin.js) — ไม่ปลดฐานข้อมูลก็ไม่คิดยอดเลย
  const unlocked = await salesUnlocked();
  // ถามครั้งเดียวได้ตะกร้า + ตัวเลือก + ขาย 30 วัน + shop_id (supabase/034) เดิมถาม 3 ครั้งต่อกัน
  // ขาย 30 วันนับจากออเดอร์ที่ไม่ยกเลิก/ยังไม่จ่าย — ออเดอร์ที่จบแล้วถูกล้างหลัง 30 วัน (ดู 005)
  const { data: d } = await db().rpc('os_listing_detail', {
    p_platform: platform, p_shop: shop, p_id: id, p_with_sold: unlocked,
  });
  const l = d?.listing;

  if (!l) {
    return (
      <>
        <Nav active="product" />
        <Link className="sub" href={back}>← กลับหน้าสินค้า</Link>
        <h1>ไม่พบสินค้า {id}</h1>
      </>
    );
  }

  const list = d.skus || [];
  const self = `/product/${platform}/${encodeURIComponent(shop)}/${encodeURIComponent(id)}`;
  const sold = (s) => (unlocked ? s.sold ?? null : null);
  const soldTotal = list.reduce((n, s) => n + (sold(s) || 0), 0);
  // เรียงตัวเลือก: ลำดับเดิมที่ร้านตั้ง (สี → ไซส์) หรือขายมากสุด 30 วัน — อย่างหลังต้องปลดรหัสก่อน
  // (เรียงตามยอดก็บอกได้ว่าตัวไหนขายดี จึงไม่ให้เลือกตอนยังล็อก)
  const order = unlocked && sp?.sort === 'sold' ? 'sold' : 'default';
  const rows = order === 'sold'
    ? [...list].sort((a, b) => (sold(b) || 0) - (sold(a) || 0) || a.sort - b.sort)
    : list;
  const sortHref = (k) => `?${new URLSearchParams(k === 'sold' ? { sort: 'sold' } : {})}`;
  const outN = list.filter((s) => Number(s.stock) === 0).length;
  const lowN = list.filter((s) => Number(s.stock) > 0 && Number(s.stock) <= LOW_STOCK).length;

  // ลิงก์ไปหน้าสินค้าบนแพลตฟอร์ม — Shopee ต้องใช้ shop_id ของร้านประกอบ
  const platformUrl = platform === 'shopee' && d.shop_id ? `https://shopee.co.th/product/${d.shop_id}/${l.product_id}` : null;

  return (
    <>
      <Nav active="product" />
      <Link className="sub" href={back}>← กลับหน้าสินค้า {PLATFORM_LABEL[platform]} {shop}</Link>

      <div className="phero">
        {l.thumb_url ? <img className="thumb" src={l.thumb_url} alt="" /> : <span className="thumb thumb-empty" />}
        <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
          <h1 style={{ fontSize: 17, lineHeight: 1.4, margin: 0 }}>{l.title || '(ไม่มีชื่อ)'}</h1>
          <div className="pmeta">
            <span className={'badge ' + listingTone(l)}>{listingLabel(l.status)}</span>
            {l.deboost && <span className="badge err">ถูกลดการมองเห็น</span>}
            <span className="plat" data-plat={platform}>{PLATFORM_LABEL[platform]}</span>
            <span className="shop" data-shop={shop}>{shop}</span>
            <span className="mono">ID {l.product_id}</span>
            {l.item_sku && <span>Parent SKU <b className="mono">{l.item_sku}</b></span>}
            {platformUrl && <a href={platformUrl} target="_blank" rel="noreferrer">เปิดบน Shopee ↗</a>}
          </div>
          {['shopee', 'tiktok', 'lazada'].includes(platform) && unlocked && (
            <div className="pmeta">
              {platform === 'shopee' && <Link prefetch={false} className="btn" href={`${self}/edit`}>แก้ไขสินค้า / เพิ่ม SKU</Link>}
              <PromoPop platform={platform} shop={shop} itemId={String(l.product_id)} title={l.title} className="btn">แก้โปร</PromoPop>
            </div>
          )}
        </div>
      </div>

      {/* เหตุผลที่ติดการละเมิด จาก Shopee (get_item_violation_info) — ต้องแก้ตามนี้ถึงจะกลับมาปกติ */}
      {Array.isArray(l.violation) && l.violation.length > 0 && (
        <section className="note note-danger" style={{ display: 'grid', gap: 10 }}>
          {l.violation.map((v, i) => (
            <div key={i}>
              <b className="danger">การละเมิด{v.type ? `: ${v.type}` : ''}</b>
              {v.reason && <div style={{ marginTop: 4 }}>{v.reason}</div>}
              {v.suggestion && <div className="sku" style={{ marginTop: 4 }}>คำแนะนำ: {v.suggestion}</div>}
            </div>
          ))}
        </section>
      )}

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
        <div className="mcard"><span className="mlabel">ขาย {SOLD_DAYS} วัน (ชิ้น)</span><b>{unlocked ? soldTotal : MASK}</b></div>
      </div>

      {['shopee', 'tiktok', 'lazada'].includes(platform) && !unlocked && (
        <div className="pcard" style={{ marginBottom: 12 }}>
          <PinBox unlocked={false} back={self} wrong={sp?.pin === 'wrong'} label={platform === 'shopee' ? 'แก้ไขสินค้า / แก้โปร / ดูยอดขาย' : 'แก้โปร / ดูยอดขาย'} />
        </div>
      )}
      {platform === 'lazada' && (() => {
        const n = list.filter((s) => s.promo_price !== null && s.promo_price !== undefined).length;
        return (
          <div className="pcard" style={{ marginBottom: 12 }}>
            <div className="pmeta">
              <b>โปรส่วนลด</b>
              {n ? <span>ราคาพิเศษ (Special Price) {n}/{list.length} ตัวเลือก — ดูช่อง “ราคาพิเศษ” ในตาราง</span> : <span className="sku">ตะกร้านี้ไม่มีราคาพิเศษ</span>}
              {n > 0 && <Link prefetch={false} className="link" href={`/discount/lazada/${encodeURIComponent(shop)}/${LAZADA_SPECIAL}?q=${encodeURIComponent(l.product_id)}`}>ดูในหน้าส่วนลด →</Link>}
            </div>
            <div className="sub" style={{ margin: '6px 0 0' }}>ตารางตามรอบซิงก์สินค้าล่าสุด · กด “แก้โปร” (ใส่รหัสแล้ว) เพื่อดูสดจาก Lazada และตั้ง/แก้/ปิดราคาพิเศษ</div>
          </div>
        );
      })()}

      {unlocked && (
        <div className="psort" style={{ marginBottom: 8 }}>
          <span className="sku">เรียงตัวเลือก:</span>
          <Link prefetch={false} className="chip" data-on={order === 'default' ? '1' : '0'} href={sortHref('default')}>ลำดับเดิม</Link>
          <Link prefetch={false} className="chip" data-on={order === 'sold' ? '1' : '0'} href={sortHref('sold')}>ขายมากสุด {SOLD_DAYS} วัน</Link>
        </div>
      )}

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
            {rows.map((s) => {
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
                  <td className="num">{!unlocked ? <span className="sku">{MASK}</span> : n === null ? '—' : n || <span className="sku">0</span>}</td>
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
