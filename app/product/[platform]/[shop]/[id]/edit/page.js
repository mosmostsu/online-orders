// แก้ไขสินค้า (Shopee / Lazada / TikTok) — หน้าตาตามหน้าแก้ไขสินค้าของ BigSeller
//   ข้อมูลสินค้า: ชื่อ / รายละเอียด / หมวด (app/product/BasketInfo.js) · รูปสินค้า (app/product/BasketImages.js)
//   ข้อมูลการขาย: ตัวเลือกสินค้า + SKU, สต็อกและราคา (app/product/BasketEditor.js) — เพิ่ม / เรียง / เปลี่ยนชื่อ / ลบ ตัวเลือกและ SKU
//   ลิงก์ "เปิดในหลังร้าน" ไปหน้าแก้ไขตะกร้านี้ใน Seller Center (lib/listings.js sellerEditUrl)
//   ราคาพิเศษ: โปรส่วนลดของตะกร้า แก้ได้ในหน้านี้ (app/product/ItemPromo.js — ตัวเดียวกับป็อปอัพในหน้ารายการสินค้า)
// อ่านตะกร้าสดจากร้านทุกครั้งที่เปิด ไม่ใช้ข้อมูลที่เก็บไว้ (ต้องตรงของจริงก่อนเขียน) · ต้องปลดล็อก SALES_PIN
// Lazada: เพิ่ม SKU ผ่าน /product/create + AssociatedSku (lib/basketLazada.js) · TikTok: lib/basketTiktok.js
import Link from 'next/link';
import { db } from '@/lib/supabase';
import { listingTone, listingLabel, sellerEditUrl } from '@/lib/listings';
import { salesUnlocked } from '@/lib/pin';
import { shopeeItemPromo, shopeeShops, tiktokItemPromo, tiktokShops, lazadaItemPromo, lazadaShops } from '@/lib/discounts';
import { shopeeBasketPlan } from '@/lib/basket';
import { lazadaBasketPlan } from '@/lib/basketLazada';
import { tiktokBasketPlan } from '@/lib/basketTiktok';

const PF = {
  shopee: { label: 'Shopee', shops: shopeeShops, plan: shopeeBasketPlan, promo: shopeeItemPromo },
  lazada: { label: 'Lazada', shops: lazadaShops, plan: lazadaBasketPlan, promo: lazadaItemPromo },
  tiktok: { label: 'TikTok', shops: tiktokShops, plan: tiktokBasketPlan, promo: tiktokItemPromo },
};
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

  const pf = PF[p.platform];
  if (!pf) return fail('แก้ไขสินค้าจากเว็บทำได้เฉพาะ Shopee / Lazada / TikTok');
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
  if (!(await pf.shops()).includes(shop)) return fail(`ร้าน ${pf.label} ${shop} ยังไม่ได้เชื่อม API — แก้ในหลังร้าน`);

  const [planR, promoR, dbR] = await Promise.allSettled([
    pf.plan(shop, id),
    pf.promo(shop, id),
    db().from('os_listing_skus').select('sku_id, seller_sku, variant, price, promo_price, stock, sort')
      .eq('platform', p.platform).eq('shop', shop).eq('product_id', id).order('sort'),
  ]);
  if (planR.status === 'rejected') return fail(`อ่านตะกร้าจาก ${pf.label} ไม่ได้: ${planR.reason?.message || planR.reason}`);
  const plan = planR.value;
  const skus = dbR.status === 'fulfilled' ? dbR.value.data || [] : [];
  const promoOf = Object.fromEntries(skus.filter((s) => s.promo_price !== null).map((s) => [String(s.sku_id), s.promo_price]));
  const status = { status: plan.status };

  return (
    <>
      <Nav active="product" />
      <BasketEditor platform={p.platform} shop={shop} itemId={id} plan={plan} promoOf={promoOf} back={back} sellerUrl={sellerEditUrl(p.platform, id)}
        statusLabel={listingLabel(plan.status)} statusTone={listingTone(status)}
        head={(
          <>
            {plan.gallery[0]?.image_url ? <img className="thumb" src={plan.gallery[0].image_url} alt="" /> : <span className="thumb thumb-empty" />}
            <div style={{ minWidth: 0 }}>
              <b className="clamp1">{plan.title || '(ไม่มีชื่อ)'}</b>
              <div className="sku"><span className="mono">{id}</span> · <Link prefetch={false} className="link" href={detail}>ดูรายละเอียด / ยอดขาย</Link>
                {' · '}<a className="link" href={sellerEditUrl(p.platform, id)} target="_blank" rel="noreferrer"
                  title={`ต้องล็อกอินร้าน ${shop} ไว้ในเบราว์เซอร์นี้`}>เปิดในหลังร้าน {pf.label} ↗</a></div>
            </div>
          </>
        )}>
        <section className="pcard esec" id="promo">
          <h2 className="esec-h">ราคาพิเศษ (โปรส่วนลด)</h2>
          {promoR.status === 'rejected'
            ? <div className="note">ดึงโปรของตะกร้านี้ไม่ได้: {String(promoR.reason?.message || promoR.reason)}</div>
            : <ItemPromo platform={p.platform} shop={shop} itemId={id} skus={skus} promo={promoR.value} editable />}
        </section>
      </BasketEditor>
    </>
  );
}
