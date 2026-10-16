// สินค้าในโปรส่วนลดหนึ่งโปร — แยกหน้าเพราะโปรเดียวมีได้หลายร้อยตัวเลือก (อ่านอย่างเดียว)
//
// จัดกลุ่มเป็นตะกร้า พับไว้ (กดชื่อตะกร้าเพื่อกางตัวเลือก) · ค้นได้ด้วยชื่อ / ตัวเลือก / เลข SKU ร้าน / รหัสตะกร้า
// ถาม Shopee สด จำไว้ 2 นาทีต่อโปร · เลข SKU ร้าน ชื่อ/รูปตะกร้า เติมจากที่เก็บไว้ (lib/discounts.js)
import Link from 'next/link';
import { unstable_cache } from 'next/cache';
import { shopeeDiscountDetail, fmtSec, endsSoon, STATUS_LABEL, sellerDiscountUrl } from '@/lib/discounts';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../../../../Nav';

export const dynamic = 'force-dynamic';

const detailOf = unstable_cache(async (shop, id) => ({ ...(await shopeeDiscountDetail(shop, id)), at: new Date().toISOString() }),
  ['shopee-discount-detail'], { revalidate: 120, tags: ['discounts'] });

const baht = (n) => (n === null || n === undefined ? '—' : '฿' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const range = (xs, f = baht) => {
  const v = xs.filter((x) => x !== null && x !== undefined).map(Number);
  if (!v.length) return '—';
  const lo = Math.min(...v), hi = Math.max(...v);
  return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
};
const offOf = (r) => (r.price && r.promo ? Math.round((1 - r.promo / r.price) * 100) : null);
const pct = (n) => `${n}%`;
const STATUS_TONE = { ongoing: 'ok', upcoming: 'warn', expired: 'dim' };

export default async function DiscountDetail({ params, searchParams }) {
  const p = await params;
  const sp = await searchParams;
  const shop = decodeURIComponent(p.shop);
  const id = String(p.id);
  const q = String(sp?.q || '').trim();
  const back = `/discount?s=${encodeURIComponent(`shopee:${shop}`)}`;

  let err = null, d = null;
  if (p.platform !== 'shopee') err = 'ตอนนี้รองรับเฉพาะ Shopee';
  else if (!/^\d+$/.test(id)) err = 'รหัสโปรไม่ถูกต้อง';
  else {
    try { d = await detailOf(shop, id); } catch (e) { err = String(e.message || e); }
  }

  if (err) {
    return (
      <>
        <Nav active="discount" />
        <Link className="sub" href={back}>← กลับหน้าส่วนลด</Link>
        <div className="note"><b>เปิดโปรนี้ไม่ได้</b><br />{err}</div>
      </>
    );
  }

  const { head, rows, listings } = d;
  // จัดกลุ่มตามตะกร้า (Shopee ส่งมาเรียงตะกร้าอยู่แล้ว แต่จัดเองกันพลาด)
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.item_id)) groups.set(r.item_id, []);
    groups.get(r.item_id).push(r);
  }
  const needle = q.toLowerCase();
  const hit = (r) => [r.item_name, r.model_name, r.seller_sku, r.item_id, listings[r.item_id]?.item_sku]
    .some((x) => x && String(x).toLowerCase().includes(needle));
  const shown = [...groups.entries()]
    .map(([itemId, rs]) => [itemId, needle ? (rs.some((r) => String(r.item_name || '').toLowerCase().includes(needle)) ? rs : rs.filter(hit)) : rs])
    .filter(([, rs]) => rs.length);

  const offs = rows.map(offOf).filter((x) => x !== null);
  const outN = rows.filter((r) => Number(r.stock) === 0).length;
  const openAll = Boolean(q) || shown.length === 1;

  return (
    <>
      <Nav active="discount" />
      <Link className="sub" href={back}>← กลับหน้าส่วนลด Shopee {shop}</Link>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h1>{head.discount_name || '(ไม่มีชื่อ)'}</h1>
          <div className="pmeta">
            {head.status && <span className={`badge ${STATUS_TONE[head.status] || 'dim'}`}>{STATUS_LABEL[head.status] || head.status}</span>}
            <span className="plat" data-plat="shopee">Shopee</span>
            <span className="shop" data-shop={shop}>{shop}</span>
            <span className="mono">ID {head.discount_id || id}</span>
            <span>{fmtSec(head.start_time)} → {fmtSec(head.end_time)}</span>
            {head.status === 'ongoing' && endsSoon(head.end_time) && <span className="lowstock">หมดใน ≤3 วัน</span>}
            <a className="link" href={sellerDiscountUrl('shopee', head.discount_id || id)} target="_blank" rel="noreferrer"
              title="เปิดโปรนี้ในหลังร้าน Shopee (ต้องล็อกอินร้านนี้ไว้)">หลังร้าน ↗</a>
          </div>
        </div>
      </div>

      <div className="mcards">
        <div className="mcard"><span className="mlabel">ตะกร้า</span><b>{groups.size}</b></div>
        <div className="mcard"><span className="mlabel">ตัวเลือก</span><b>{rows.length}</b></div>
        <div className="mcard"><span className="mlabel">ลด</span><b>{offs.length ? range(offs, pct) : '—'}</b></div>
        <div className="mcard">
          <span className="mlabel">คลังหมด</span><b className={outN ? 'danger' : ''}>{outN}</b>
          {outN > 0 && <span className="mfoot">ตัวเลือกในโปรที่คลังเป็น 0</span>}
        </div>
      </div>

      <div className="pcard">
        <form className="search" action="" method="get" style={{ marginBottom: 10 }}>
          <input name="q" defaultValue={q} placeholder="ค้นหาด้วย ชื่อสินค้า, ตัวเลือก, เลข SKU, รหัสตะกร้า" autoComplete="off" inputMode="search" />
          {q && <Link prefetch={false} className="link" href="?">ล้าง</Link>}
          <button className="btn" type="submit">ค้นหา</button>
        </form>
        <div className="pbar">
          <b>{q ? `เจอ ${shown.length} ตะกร้า · ${shown.reduce((n, [, rs]) => n + rs.length, 0)} ตัวเลือก` : `${groups.size} ตะกร้า`}</b>
          <span className="sku">กดชื่อตะกร้าเพื่อดูตัวเลือก</span>
        </div>

        {shown.length === 0 ? (
          <div className="sku">ไม่เจอสินค้าที่ตรงกับ “{q}”</div>
        ) : shown.map(([itemId, rs]) => {
          const l = listings[itemId] || {};
          const gOffs = rs.map(offOf).filter((x) => x !== null);
          const gOut = rs.filter((r) => Number(r.stock) === 0).length;
          return (
            <details key={itemId} className="dgroup" open={openAll}>
              <summary>
                {l.thumb_url ? <img className="thumb sm" src={l.thumb_url} alt="" loading="lazy" /> : <span className="thumb sm thumb-empty" />}
                <span className="dg-main">
                  <span className="clamp2 dg-title">{rs[0].item_name || itemId}</span>
                  <span className="sku">
                    {l.item_sku ? <>Parent SKU <span className="mono">{l.item_sku}</span> · </> : null}
                    รหัสตะกร้า {itemId} · {rs.length} ตัวเลือก{gOut ? <span className="danger"> · หมด {gOut}</span> : null}
                  </span>
                </span>
                <span className="dg-price">
                  <span className="sku strike">{range(rs.map((r) => r.price))}</span>
                  <span className="promo">{range(rs.map((r) => r.promo))}</span>
                  {gOffs.length > 0 && <span className="doff">-{range(gOffs, pct)}</span>}
                </span>
              </summary>
              <div className="skutable-wrap">
                <table className="dopts">
                  <thead>
                    <tr><th>ตัวเลือก</th><th>SKU</th><th className="r">ราคาปกติ</th><th className="r">ราคาโปร</th><th className="r">ลด</th><th className="r">คลัง</th></tr>
                  </thead>
                  <tbody>
                    {rs.map((r) => {
                      const off = offOf(r);
                      const st = r.stock === null || r.stock === undefined ? null : Number(r.stock);
                      return (
                        <tr key={r.sku_id}>
                          <td>{r.model_name || <span className="sku">(ไม่มีตัวเลือก)</span>}</td>
                          <td className="mono">{r.seller_sku || <span className="sku">—</span>}</td>
                          <td className="num">{baht(r.price)}</td>
                          <td className="num promo">{baht(r.promo)}</td>
                          <td className="num doff">{off !== null ? `-${off}%` : '—'}</td>
                          <td className={'num ' + (st === 0 ? 'danger' : '')}>
                            {st === 0 ? 'หมด' : st ?? '—'}
                            {Number(r.promo_stock) > 0 && <div className="sku">กันโปร {r.promo_stock}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="dg-foot">
                <Link prefetch={false} className="link" href={`/product/shopee/${encodeURIComponent(shop)}/${encodeURIComponent(itemId)}`}>ดูตะกร้านี้ในหน้าสินค้า →</Link>
              </div>
            </details>
          );
        })}
      </div>

      <div className="sub" style={{ marginTop: 12 }}>
        ดึงสดจาก Shopee เมื่อ {fmtTimeTH(d.at)} น. (จำไว้ 2 นาที) · คลัง = คลังปกติของตัวเลือก · “กันโปร” โชว์เฉพาะตอนตั้งสต็อกโปรแยกไว้
        <br />หน้านี้อ่านอย่างเดียว ยังแก้ราคาโปรจากที่นี่ไม่ได้
      </div>
    </>
  );
}
