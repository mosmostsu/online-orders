// ส่วนลด — โปรส่วนลดที่ตั้งไว้บนแพลตฟอร์ม แยกตามร้าน (ขั้นแรก: Shopee อ่านอย่างเดียว)
//
// ถามแพลตฟอร์มสดตอนเปิดหน้า (ยังไม่เก็บลงฐานข้อมูล) — จำไว้ 2 นาทีต่อร้าน+สถานะ กันเปิดซ้ำแล้วยิง API ทุกครั้ง
// กดชื่อโปร → หน้าสินค้าในโปร (app/discount/[platform]/[shop]/[id]) — โปรหนึ่งมีได้หลายร้อยตัวเลือก กางในหน้านี้ยาวเกิน
// Shopee MVP ไม่มี API จึงไม่ขึ้นในหน้านี้
import Link from 'next/link';
import { unstable_cache } from 'next/cache';
import { shopeeShops, shopeeDiscountList, fmtSec, endsSoon, STATUS_LABEL } from '@/lib/discounts';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../Nav';
import ShopBar from '../ShopBar';

export const dynamic = 'force-dynamic';

const STATUSES = ['ongoing', 'upcoming', 'expired'];
const EXPIRED_CAP = 100;   // = page_size ของ listDiscounts × maxPages 1

// error ไม่ถูกจำ — ถ้า Shopee พัง เปิดใหม่จะถามซ้ำจนกว่าจะหาย
const discountsOf = unstable_cache(async (shop, status) => {
  // หมดอายุมีสะสมเยอะมาก เอาแค่หน้าแรก
  const list = await shopeeDiscountList(shop, status, status === 'expired' ? 1 : 10);
  return { list, at: new Date().toISOString() };
}, ['shopee-discounts'], { revalidate: 120, tags: ['discounts'] });

export default async function DiscountPage({ searchParams }) {
  const sp = await searchParams;
  const shops = await shopeeShops().catch(() => []);
  const [, shArg] = String(sp?.s || '').split(':');
  const shop = shops.includes(shArg) ? shArg : shops[0];
  const status = STATUSES.includes(sp?.st) ? sp.st : 'ongoing';
  const href = (o) => {
    const p = new URLSearchParams({ s: `shopee:${o.shop ?? shop}` });
    const st = o.st ?? status;
    if (st !== 'ongoing') p.set('st', st);
    return `/discount?${p}`;
  };

  let err = null, data = null;
  if (shop) {
    try { data = await discountsOf(shop, status); } catch (e) { err = String(e.message || e); }
  } else err = 'ยังไม่มีร้าน Shopee ที่ผูก API';
  // ที่ยังไม่หมด: ใกล้หมดก่อน · หมดอายุแล้ว: เพิ่งหมดก่อน
  const byEnd = (a, b) => Number(a.end_time || 0) - Number(b.end_time || 0);
  const list = [...(data?.list || [])].sort(status === 'expired' ? (a, b) => byEnd(b, a) : byEnd);
  // หมดอายุดึงแค่หน้าแรก — ครบ 100 แปลว่าน่าจะมีมากกว่านี้ บอกไว้กันเข้าใจผิดว่าโปรหาย
  const capped = status === 'expired' && list.length >= EXPIRED_CAP;

  return (
    <>
      <Nav active="discount" />
      <div className="row">
        <div>
          <h1>ส่วนลด</h1>
          <div className="sub">
            โปรส่วนลดที่ตั้งไว้บน Shopee · ดึงสดจาก Shopee{data?.at ? ` เมื่อ ${fmtTimeTH(data.at)} น.` : ''} (จำไว้ 2 นาที)
          </div>
        </div>
      </div>

      <ShopBar items={shops.map((s) => ({ platform: 'shopee', shop: s, href: href({ shop: s }), on: s === shop }))} />

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
              แสดงแค่ {EXPIRED_CAP} รายการแรกที่ Shopee ส่งมา — โปรที่หมดอายุนานกว่านี้ไม่ได้หายไป ดูได้ที่หลังร้าน Shopee
            </div>
          )}
          {list.length === 0 ? (
            <div className="sku">ไม่มีโปรในสถานะนี้</div>
          ) : (
            <div className="skutable-wrap">
              <table className="dtable">
                <thead>
                  <tr><th>ชื่อโปรโมชัน</th><th>ID โปรโมชัน</th><th>เวลา</th><th /></tr>
                </thead>
                <tbody>
                  {list.map((d) => {
                    const to = `/discount/shopee/${encodeURIComponent(shop)}/${d.discount_id}`;
                    return (
                      <tr key={d.discount_id}>
                        <td><Link prefetch={false} href={to} className="dname">{d.discount_name || '(ไม่มีชื่อ)'}</Link></td>
                        <td className="mono">{d.discount_id}</td>
                        <td style={{ fontSize: 12 }}>
                          {fmtSec(d.start_time)}<br />→ {fmtSec(d.end_time)}
                          {status === 'ongoing' && endsSoon(d.end_time) && <div className="lowstock">หมดใน ≤3 วัน</div>}
                        </td>
                        <td><Link prefetch={false} href={to} className="link" style={{ whiteSpace: 'nowrap' }}>ดูสินค้า →</Link></td>
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
        ราคาโปรคือราคาที่ลูกค้าเห็นบน Shopee · หน้านี้อ่านอย่างเดียว ยังแก้โปรจากที่นี่ไม่ได้
      </div>
    </>
  );
}
