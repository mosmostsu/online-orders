// ส่วนลด — โปรส่วนลดที่ตั้งไว้บนแพลตฟอร์ม แยกตามร้าน (ขั้นแรก: Shopee อ่านอย่างเดียว)
//
// ถามแพลตฟอร์มสดตอนเปิดหน้า (ยังไม่เก็บลงฐานข้อมูล) — จำไว้ 2 นาทีต่อร้าน+สถานะ กันเปิดซ้ำแล้วยิง API ทุกครั้ง
// กด "ดูสินค้า" ในแถว → โหลดสินค้าในโปรนั้นมากาง (app/discount/DiscountItems.js)
// Shopee MVP ไม่มี API จึงไม่ขึ้นในหน้านี้
import Link from 'next/link';
import { unstable_cache } from 'next/cache';
import { listDiscounts } from '@/lib/shopee';
import { listShops, usableToken } from '@/lib/tokens';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../Nav';
import ShopBar from '../ShopBar';
import DiscountItems from './DiscountItems';

export const dynamic = 'force-dynamic';

const STATUSES = [
  { key: 'ongoing', label: 'กำลังดำเนินการ' },
  { key: 'upcoming', label: 'เร็วๆ นี้' },
  { key: 'expired', label: 'หมดอายุ' },
];

const discountsOf = unstable_cache(async (shop, status) => {
  const row = (await listShops('shopee')).find((r) => r.shop === shop);
  if (!row) throw new Error(`ไม่พบโทเคนของร้าน Shopee ${shop}`);
  const tok = await usableToken(row);
  // หมดอายุมีสะสมเยอะมาก เอาแค่หน้าแรก (100 รายการล่าสุด)
  const list = await listDiscounts({ accessToken: tok.access_token, shopId: tok.shop_id, partner: tok, status, maxPages: status === 'expired' ? 1 : 10 });
  return { list, at: new Date().toISOString() };
}, ['shopee-discounts'], { revalidate: 120, tags: ['discounts'] });

// Shopee ให้เวลาเป็นวินาที (unix) — โชว์ "26 พ.ย. 15:00 2569"
const fmtSec = (s) => {
  if (!s) return '—';
  const ms = Number(s) * 1000;
  return `${fmtTimeTH(new Date(ms).toISOString())} ${new Date(ms + 7 * 3600000).getUTCFullYear() + 543}`;
};
const endsSoon = (s) => s && Number(s) * 1000 > Date.now() && Number(s) * 1000 - Date.now() < 3 * 86400000;

export default async function DiscountPage({ searchParams }) {
  const sp = await searchParams;
  const shops = (await listShops('shopee').catch(() => [])).map((r) => r.shop).sort();
  const [, shArg] = String(sp?.s || '').split(':');
  const shop = shops.includes(shArg) ? shArg : shops[0];
  const status = STATUSES.some((s) => s.key === sp?.st) ? sp.st : 'ongoing';
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
  // ใกล้หมดก่อน
  const list = [...(data?.list || [])].sort((a, b) => Number(a.end_time || 0) - Number(b.end_time || 0));

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
          <Link key={s.key} prefetch={false} className="chip" data-on={status === s.key ? '1' : '0'} href={href({ st: s.key })}>{s.label}</Link>
        ))}
      </div>

      {err && <div className="note"><b>ดึงโปรไม่ได้</b><br />{err}</div>}

      {!err && (
        <div className="pcard">
          <div className="pbar"><b>โปร {list.length} รายการ</b></div>
          {list.length === 0 ? (
            <div className="sku">ไม่มีโปรในสถานะนี้</div>
          ) : (
            <div className="skutable-wrap">
              <table className="dtable">
                <thead>
                  <tr><th>ชื่อโปรโมชัน</th><th>ID โปรโมชัน</th><th>เวลา</th><th>สินค้า</th></tr>
                </thead>
                <tbody>
                  {list.map((d) => (
                    <DiscountItems key={d.discount_id} shop={shop} id={String(d.discount_id)}>
                      <td><b>{d.discount_name || '(ไม่มีชื่อ)'}</b></td>
                      <td className="mono">{d.discount_id}</td>
                      <td style={{ fontSize: 12 }}>
                        {fmtSec(d.start_time)}<br />→ {fmtSec(d.end_time)}
                        {status === 'ongoing' && endsSoon(d.end_time) && <div className="lowstock">หมดใน ≤3 วัน</div>}
                      </td>
                    </DiscountItems>
                  ))}
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
