// แถวตัวเลือกหนึ่งตัว (สี/ไซส์) ใต้ตะกร้า — ใช้ทั้งฝั่งเซิร์ฟเวอร์ (3 ตัวแรก) และตอนกด "ดู SKU อื่น"
// ไม่มี 'use client' / hook ใดๆ จึงใช้ได้ทั้งสองฝั่ง
const LOW_STOCK = 2;
const baht = (n) => (n === null || n === undefined ? '—' : '฿' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));

export default function SkuRow({ v }) {
  const st = v.stock === null || v.stock === undefined ? null : Number(v.stock);
  return (
    <div className="ptrow psub">
      <div className="pcell-name">
        {v.image_url ? <img className="thumb xs" src={v.image_url} alt="" loading="lazy" /> : <span className="thumb xs thumb-empty" />}
        <div style={{ minWidth: 0 }}>
          <div className="pvar">{v.variant || '—'}</div>
          <div className="sku">เลข SKU: <span className="mono">{v.seller_sku || '—'}</span></div>
          <div className="sku">SKU ID: {v.sku_id}</div>
        </div>
      </div>
      <div className="pcell-price">
        {v.promo_price !== null && v.promo_price !== undefined ? (
          <><span className="promo">{baht(v.promo_price)}</span><div className="sku strike">{baht(v.price)}</div></>
        ) : baht(v.price)}
      </div>
      <div className={'pcell-stock ' + (st === 0 ? 'danger' : st !== null && st <= LOW_STOCK ? 'lowstock' : '')}>
        {st === 0 ? 'หมด' : st ?? '—'}
      </div>
      <div className="pcell-status" />
    </div>
  );
}
