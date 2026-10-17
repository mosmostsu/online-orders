// แถวตัวเลือกหนึ่งตัว (สี/ไซส์) ใต้ตะกร้า — ใช้ทั้งฝั่งเซิร์ฟเวอร์ (3 ตัวแรก) และตอนกด "ดู SKU อื่น"
// ไม่มี 'use client' / hook ใดๆ จึงใช้ได้ทั้งสองฝั่ง (PromoPop เป็น client component — ฝังได้ทั้งสองฝั่ง)
// promo = { platform, shop, itemId, title } เมื่อแก้โปรได้ (ปลดรหัสแล้ว) → กดช่องลดราคา (ราคาโปร หรือ — ) เปิดป็อปอัพแก้โปรของตะกร้า (แบบ BigSeller)
import PromoPop from './PromoPop';
const LOW_STOCK = 2;
const baht = (n) => (n === null || n === undefined ? '—' : '฿' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }));

export default function SkuRow({ v, promo = null }) {
  const st = v.stock === null || v.stock === undefined ? null : Number(v.stock);
  return (
    <div className="ptrow pt5 psub">
      <div className="pcell-name">
        {v.image_url ? <img className="thumb xs" src={v.image_url} alt="" loading="lazy" /> : <span className="thumb xs thumb-empty" />}
        <div style={{ minWidth: 0 }}>
          <div className="pvar">{v.variant || '—'}</div>
          <div className="sku">เลข SKU: <span className="mono">{v.seller_sku || '—'}</span></div>
          <div className="sku">SKU ID: {v.sku_id}</div>
        </div>
      </div>
      <div className="pcell-price">{baht(v.price)}</div>
      {/* ลดราคา: ไม่มี = ขีด · promo (ปลดรหัสแล้ว) = กดเปิดป็อปอัพแก้/เพิ่มราคาโปร */}
      <div className="pcell-promo">
        {(() => {
          const has = v.promo_price !== null && v.promo_price !== undefined;
          const txt = has ? baht(v.promo_price) : '—';
          return promo
            ? <PromoPop {...promo} className={has ? 'promo' : 'pdash'}>{txt}</PromoPop>
            : <span className={has ? 'promo' : 'sku'}>{txt}</span>;
        })()}
      </div>
      <div className={'pcell-stock ' + (st === 0 ? 'danger' : st !== null && st <= LOW_STOCK ? 'lowstock' : '')}>
        {st === 0 ? 'หมด' : st ?? '—'}
      </div>
      <div className="pcell-status" />
    </div>
  );
}
