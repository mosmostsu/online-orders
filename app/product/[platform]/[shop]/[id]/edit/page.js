// แก้ไขสินค้า (Shopee) — หน้าตาตามหน้าแก้ไขสินค้าของ BigSeller
//   ข้อมูลการขาย: ตัวเลือกสินค้า + SKU, สต็อกและราคา (app/product/BasketEditor.js) — เพิ่มสี/ไซส์/SKU ใหม่ได้อย่างเดียว
//   ราคาพิเศษ: โปรส่วนลดของตะกร้า แก้ได้ในหน้านี้ (app/product/ItemPromo.js — ตัวเดียวกับป็อปอัพในหน้ารายการสินค้า)
// อ่านตะกร้าสดจาก Shopee ทุกครั้งที่เปิด ไม่ใช้ข้อมูลที่เก็บไว้ (ต้องตรงของจริงก่อนเขียน) · ต้องปลดล็อก SALES_PIN
import Link from 'next/link';
import { db } from '@/lib/supabase';
import { listingTone, listingLabel } from '@/lib/listings';
import { salesUnlocked } from '@/lib/pin';
import { shopeeItemPromo, shopeeShops } from '@/lib/discounts';
import { shopeeBasketPlan } from '@/lib/basket';
import Nav from '../../../../../Nav';
import PinBox from '../../../../../PinBox';
import BasketEditor from '../../../../BasketEditor';
import ItemPromo from '../../../../ItemPromo';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export default async function EditProduct({ params, searchParams }) {
  const p = await params;
  const sp = await searchParams;
  const shop = decodeURIComponent(p.shop);
  const id = decodeURIComponent(p.id);
  const detail = `/product/${p.platform}/${encodeURIComponent(shop)}/${encodeURIComponent(id)}`;
  const self = `${detail}/edit`;
  const back = `/product?s=${encodeURIComponent(`${p.platform}:${shop}`)}`;
  const fail = (text) => (
    <>
      <Nav active="product" />
      <Link className="sub" href={detail}>← กลับหน้าสินค้า</Link>
      <div className="note">{text}</div>
    </>
  );

  if (p.platform !== 'shopee') return fail('แก้ไขสินค้าจากเว็บทำได้เฉพาะ Shopee ตอนนี้');
  if (!/^\d+$/.test(id)) return fail('เลขตะกร้าไม่ถูกต้อง');
  if (!(await salesUnlocked())) {
    return (
      <>
        <Nav active="product" />
        <Link className="sub" href={detail}>← กลับหน้าสินค้า</Link>
        <div className="pcard"><PinBox unlocked={false} back={self} wrong={sp?.pin === 'wrong'} label="แก้ไขสินค้า" /></div>
      </>
    );
  }
  if (!(await shopeeShops()).includes(shop)) return fail(`ร้าน Shopee ${shop} ยังไม่ได้เชื่อม API — แก้ในหลังร้าน`);

  const [planR, promoR, dbR] = await Promise.allSettled([
    shopeeBasketPlan(shop, id),
    shopeeItemPromo(shop, id),
    db().from('os_listing_skus').select('sku_id, seller_sku, variant, price, promo_price, stock, sort')
      .eq('platform', 'shopee').eq('shop', shop).eq('product_id', id).order('sort'),
  ]);
  if (planR.status === 'rejected') return fail(`อ่านตะกร้าจาก Shopee ไม่ได้: ${planR.reason?.message || planR.reason}`);
  const plan = planR.value;
  const skus = dbR.status === 'fulfilled' ? dbR.value.data || [] : [];
  const promoOf = Object.fromEntries(skus.filter((s) => s.promo_price !== null).map((s) => [String(s.sku_id), s.promo_price]));
  const status = { status: plan.status };

  return (
    <>
      <Nav active="product" />
      <section className="pcard esec ehead">
        {plan.gallery[0]?.image_url ? <img className="thumb plg" src={plan.gallery[0].image_url} alt="" /> : <span className="thumb plg thumb-empty" />}
        <div style={{ minWidth: 0 }}>
          <b className="clamp2">{plan.title || '(ไม่มีชื่อ)'}</b>
          <div className="sku">รหัสสินค้า <span className="mono">{id}</span> · <Link prefetch={false} className="link" href={detail}>ดูรายละเอียด / ยอดขาย</Link></div>
        </div>
      </section>

      <BasketEditor shop={shop} itemId={id} plan={plan} promoOf={promoOf} back={back}
        statusLabel={listingLabel(plan.status)} statusTone={listingTone(status)}>
        <section className="pcard esec" id="promo">
          <h2 className="esec-h">ราคาพิเศษ (โปรส่วนลด)</h2>
          {promoR.status === 'rejected'
            ? <div className="note">ดึงโปรของตะกร้านี้ไม่ได้: {String(promoR.reason?.message || promoR.reason)}</div>
            : <ItemPromo shop={shop} itemId={id} skus={skus} promo={promoR.value} editable />}
        </section>
      </BasketEditor>
    </>
  );
}
