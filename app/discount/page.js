// ส่วนลด — โปรส่วนลดที่ตั้งไว้บนแพลตฟอร์ม แยกตามร้าน · Shopee แก้ได้ (หน้าโปร) · TikTok / Lazada อ่านอย่างเดียว
//
// ถามแพลตฟอร์มสดตอนเปิดหน้า (ยังไม่เก็บลงฐานข้อมูล) — จำไว้ 2 นาทีต่อร้าน+สถานะ กันเปิดซ้ำแล้วยิง API ทุกครั้ง
// กดชื่อโปร → หน้าสินค้าในโปร (app/discount/[platform]/[shop]/[id]) — โปรหนึ่งมีได้หลายร้อยตัวเลือก กางในหน้านี้ยาวเกิน
// Shopee MVP ไม่มี API จึงไม่ขึ้นในหน้านี้ · TikTok ร้านที่แอปยังไม่มี scope Promotion จะขึ้นข้อความบอกวิธีแก้
// Lazada ไม่มีโปรส่วนลดให้อ่าน — แสดง "ราคาพิเศษ" ราย SKU จากที่ซิงก์ไว้เป็นโปรเดียว (lib/discounts.js)
import Link from 'next/link';
import { unstable_cache } from 'next/cache';
import { discountShops, discountList, DISCOUNT_PLATFORMS, PLATFORM_LABEL, TT_TYPE, fmtSec, endsSoon, STATUS_LABEL, sellerDiscountUrl } from '@/lib/discounts';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../Nav';
import ShopBar from '../ShopBar';

export const dynamic = 'force-dynamic';

const STATUSES = ['ongoing', 'upcoming', 'expired'];
const EXPIRED_CAP = 100;   // = page_size ของ listDiscounts / searchActivities × maxPages 1 (ต่อสถานะ)

// error ไม่ถูกจำ — ถ้า Shopee พัง เปิดใหม่จะถามซ้ำจนกว่าจะหาย
const discountsOf = unstable_cache(async (platform, shop, status) => {
  // หมดอายุมีสะสมเยอะมาก เอาแค่หน้าแรก
  const list = await discountList(platform, shop, status, status === 'expired' ? 1 : 10);
  return { list: [...list], truncated: Boolean(list.truncated), at: new Date().toISOString() };
}, ['discounts-list'], { revalidate: 120, tags: ['discounts'] });

export default async function DiscountPage({ searchParams }) {
  const sp = await searchParams;
  // ร้านทุกแพลตฟอร์มที่ผูก API — แพลตฟอร์มไหนอ่านโทเคนไม่ได้ก็ข้ามไป ไม่ลากทั้งหน้า
  const all = (await Promise.all(DISCOUNT_PLATFORMS.map(async (pf) => (await discountShops[pf]().catch(() => [])).map((shop) => ({ platform: pf, shop })))))
    .flat();
  const [pfArg, shArg] = String(sp?.s || '').split(':');
  const cur = all.find((x) => x.platform === pfArg && x.shop === shArg) || all[0];
  const platform = cur?.platform || 'shopee';
  const shop = cur?.shop;
  const label = PLATFORM_LABEL[platform];
  const status = STATUSES.includes(sp?.st) ? sp.st : 'ongoing';
  const href = (o) => {
    const p = new URLSearchParams({ s: `${o.platform ?? platform}:${o.shop ?? shop}` });
    const st = o.st ?? status;
    if (st !== 'ongoing') p.set('st', st);
    return `/discount?${p}`;
  };

  let err = null, data = null;
  if (shop) {
    try { data = await discountsOf(platform, shop, status); } catch (e) { err = String(e.message || e); }
  } else err = 'ยังไม่มีร้านที่ผูก API';
  // ที่ยังไม่หมด: ใกล้หมดก่อน · หมดอายุแล้ว: เพิ่งหมดก่อน
  const byEnd = (a, b) => Number(a.end_time || 0) - Number(b.end_time || 0);
  const list = [...(data?.list || [])].sort(status === 'expired' ? (a, b) => byEnd(b, a) : byEnd);
  // หมดอายุดึงแค่หน้าแรก — ครบ 100 แปลว่าน่าจะมีมากกว่านี้ บอกไว้กันเข้าใจผิดว่าโปรหาย
  const capped = Boolean(data?.truncated) || (status === 'expired' && list.length >= EXPIRED_CAP);

  return (
    <>
      <Nav active="discount" />
      <div className="row">
        <div>
          <h1>ส่วนลด</h1>
          <div className="sub">
            {platform === 'lazada'
              ? <>ราคาพิเศษราย SKU บน Lazada · ตามรอบซิงก์สินค้าล่าสุด (ไม่ได้ดึงสด)</>
              : <>โปรส่วนลดที่ตั้งไว้บน {label} · ดึงสดจาก {label}{data?.at ? ` เมื่อ ${fmtTimeTH(data.at)} น.` : ''} (จำไว้ 2 นาที)</>}
          </div>
        </div>
      </div>

      <ShopBar items={all.map((x) => ({ platform: x.platform, shop: x.shop, href: href(x), on: x.platform === platform && x.shop === shop }))}
        lead={{ href: '/discount/compare', label: 'เทียบร้าน' }} />

      <div className="psort" style={{ marginBottom: 10 }}>
        {STATUSES.map((s) => (
          <Link key={s} prefetch={false} className="chip" data-on={status === s ? '1' : '0'} href={href({ st: s })}>{STATUS_LABEL[s]}</Link>
        ))}
      </div>

      {err && <div className="note"><b>ดึงโปรไม่ได้</b><br />{err}</div>}

      {!err && (
        <div className="pcard">
          <div className="pbar"><b>โปร {list.length} รายการ</b></div>
          {capped && (
            <div className="note" style={{ marginBottom: 10 }}>
              แสดงแค่ส่วนแรกที่ {label} ส่งมา — โปรที่เก่ากว่านี้ไม่ได้หายไป ดูได้ที่หลังร้าน {label}
            </div>
          )}
          {list.length === 0 ? (
            <div className="sku">{platform === 'lazada' && status !== 'ongoing'
              ? 'Lazada ไม่มีข้อมูลโปรเร็วๆ นี้ / หมดอายุ — เห็นเฉพาะราคาพิเศษที่ใช้อยู่ตอนซิงก์'
              : 'ไม่มีโปรในสถานะนี้'}</div>
          ) : (
            <div className="skutable-wrap">
              <table className="dtable">
                <thead>
                  <tr><th>ชื่อโปรโมชัน</th><th>ID โปรโมชัน</th><th>เวลา</th><th /></tr>
                </thead>
                <tbody>
                  {list.map((d) => {
                    const to = `/discount/${platform}/${encodeURIComponent(shop)}/${d.discount_id}`;
                    const seller = sellerDiscountUrl(platform, d.discount_id);
                    return (
                      <tr key={d.discount_id}>
                        <td>
                          <Link prefetch={false} href={to} className="dname">{d.discount_name || '(ไม่มีชื่อ)'}</Link>
                          {d.type && d.type !== 'DIRECT_DISCOUNT' && <div className="sku">{TT_TYPE[d.type] || d.type}</div>}
                          {d.count ? <div className="sku">{d.count} ตัวเลือก</div> : null}
                        </td>
                        <td className="mono">{d.discount_id}</td>
                        <td style={{ fontSize: 12 }}>
                          {d.start_time || d.end_time ? <>{fmtSec(d.start_time)}<br />→ {fmtSec(d.end_time)}</> : <span className="sku">ไม่ทราบช่วงเวลา</span>}
                          {status === 'ongoing' && endsSoon(d.end_time) && <div className="lowstock">หมดใน ≤3 วัน</div>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <Link prefetch={false} href={to} className="link">ดูสินค้า →</Link>
                          {seller && <><br /><a className="link sku" href={seller} target="_blank" rel="noreferrer">หลังร้าน ↗</a></>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="sub" style={{ marginTop: 12 }}>
        {platform === 'shopee'
          ? 'ราคาโปรคือราคาที่ลูกค้าเห็นบน Shopee · แก้ราคาโปรได้ในหน้าโปร (ต้องใส่รหัสก่อน)'
          : `${label}: หน้านี้อ่านอย่างเดียว ยังแก้โปรจากที่นี่ไม่ได้`}
      </div>
    </>
  );
}
