'use client';
import { useState } from 'react';
import Link from 'next/link';
import BasketEdit from '../discount/BasketEdit';

// โปรส่วนลดของตะกร้าเดียว (Shopee / TikTok) — อยู่ในป็อปอัพ "แก้โปร" (app/product/PromoPop.js) ใช้ตัวแก้ตัวเดียวกับหน้าโปร
//   อยู่ในโปรแล้ว → แก้ราคา / % / เอาออก / ใส่ตัวเลือกที่ยังไม่อยู่เพิ่ม
//   ยังไม่อยู่ → เลือกโปร (กำลังดำเนินการ / เร็วๆ นี้) แล้วตั้งราคาใส่เข้าไป
// promo มาจาก shopeeItemPromo / tiktokItemPromo (lib/discounts.js) · skus จาก os_listing_skus · onChanged = บันทึก/ยกเลิกแล้ว ให้ป็อปอัพโหลดโปรใหม่
// TikTok: โปรแบบ % แก้ช่อง % · โปรระดับตะกร้าทุกตัวเลือกค่าเดียว · โปรที่เริ่มแล้วแก้จำกัดการซื้อไม่ได้ (ซ่อนช่อง)
const fmtSec = (s) => {
  if (!s) return '—';
  const d = new Date(Number(s) * 1000 + 7 * 3600000);
  const M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
};

const PLAT = { shopee: 'Shopee', tiktok: 'TikTok' };
const TT_TYPE = { DIRECT_DISCOUNT: 'ส่วนลด %', FIXED_PRICE: 'ราคาตายตัว' };

export default function ItemPromo({ shop, itemId, skus, promo, editable, onChanged = null, platform = 'shopee' }) {
  const tt = platform === 'tiktok';
  const [pick, setPick] = useState('');
  const [adding, setAdding] = useState(null);   // discount_id ที่กำลังใส่ตะกร้าเข้าไป

  const modelKey = (s) => (String(s.sku_id) === String(itemId) ? '0' : String(s.sku_id));
  const rowsFor = (models) => skus.map((s) => {
    const k = modelKey(s);
    const has = models && Object.prototype.hasOwnProperty.call(models, k);
    return {
      sku_id: String(s.sku_id), model_name: s.variant || null, seller_sku: s.seller_sku || null,
      price: s.price ?? null, stock: s.stock ?? null, promo: has ? models[k] : null, inPromo: Boolean(has),
    };
  });
  // TikTok: ค่าของตัวเลือกในโปร (p.product จาก tiktokItemPromo) → แถวของ BasketEdit (% เก็บใน off ราคาโปรคิดจากราคาปกติ)
  const ttRowsFor = (p) => skus.map((s) => {
    const v = !p?.product ? null : p.level === 'PRODUCT' ? p.product : p.product.skus?.[String(s.sku_id)] || null;
    const price = s.price ?? null;
    const promoPrice = !v ? null : v.a ?? (price && v.d ? Math.round(Number(price) * (1 - v.d / 100) * 100) / 100 : null);
    return {
      sku_id: String(s.sku_id), model_name: s.variant || null, seller_sku: s.seller_sku || null,
      price, stock: s.stock ?? null, promo: promoPrice, off: v && v.a === null ? v.d : null, inPromo: Boolean(v),
    };
  });
  const rowsOf = (p) => (tt ? ttRowsFor(p) : rowsFor(p ? p.models : null));
  const editProps = (p) => (tt ? { platform, pct: p.type === 'DIRECT_DISCOUNT', whole: p.level === 'PRODUCT' } : {});
  // จำกัดการซื้อ: TikTok โปรที่เริ่มแล้วแก้ไม่ได้ → null (ซ่อนช่อง) · -1/ไม่มี = ไม่จำกัด (0)
  const limitOf = (p, inIt) => {
    if (!tt) return inIt ? p.limit ?? null : 0;
    if (p.staging === 'ongoing') return null;
    return inIt && p.product?.q > 0 ? p.product.q : 0;
  };
  const statusOf = (x) => (tt ? x.staging : x.status);
  const usedIds = new Set(promo.in.map((p) => p.discount_id));
  const options = promo.options.filter((o) => !usedIds.has(o.discount_id));
  const addingOpt = promo.options.find((o) => o.discount_id === adding);

  return (
    <section className="ipromo">

      {promo.in.map((p) => (
        <div key={p.discount_id} className="ipromo-one">
          <div className="pmeta" style={{ marginBottom: 4 }}>
            <b>{p.name || `โปร ${p.discount_id}`}</b>
            <span className={`badge ${p.staging === 'ongoing' ? 'ok' : 'warn'}`}>{p.staging === 'ongoing' ? 'กำลังดำเนินการ' : 'เร็วๆ นี้'}</span>
            {tt && <span className="sku">{TT_TYPE[p.type] || p.type}{p.level === 'PRODUCT' ? ' · ทั้งตะกร้า' : ''}</span>}
            <span className="sku">{fmtSec(p.start_time)} → {fmtSec(p.end_time)}</span>
            <Link prefetch={false} className="link" href={`/discount/${platform}/${encodeURIComponent(shop)}/${p.discount_id}`}>ดูทั้งโปร →</Link>
            <span className="sku">{rowsOf(p).filter((r) => r.inPromo).length}/{skus.length} ตัวเลือกอยู่ในโปร</span>
          </div>
          <BasketEdit shop={shop} discountId={p.discount_id} itemId={String(itemId)} rows={rowsOf(p)}
            limit={limitOf(p, true)} editable={editable} onDone={onChanged} {...editProps(p)} />
        </div>
      ))}

      {promo.in.length === 0 && !adding && <div className="sku" style={{ marginBottom: 8 }}>ตะกร้านี้ยังไม่อยู่ในโปรส่วนลด</div>}

      {editable && !adding && options.length > 0 && (
        <div className="bedit-bar">
          <span className="sku">{promo.in.length ? 'ใส่เข้าโปรอื่นด้วย:' : 'ใส่เข้าโปร:'}</span>
          <select className="bin" style={{ width: 'auto', textAlign: 'left' }} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">— เลือกโปร —</option>
            {options.map((o) => (
              <option key={o.discount_id} value={o.discount_id}>
                {o.name} ({tt ? `${TT_TYPE[o.type] || o.type} · ` : ''}{statusOf(o) === 'ongoing' ? 'กำลังดำเนินการ' : 'เร็วๆ นี้'} · ถึง {fmtSec(o.end_time)})
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={!pick} onClick={() => setAdding(pick)}>ตั้งราคา →</button>
        </div>
      )}
      {editable && !adding && options.length === 0 && promo.in.length === 0 && (
        <div className="sku">ไม่มีโปรที่กำลังดำเนินการหรือกำลังจะเริ่ม — สร้างโปรใหม่ในหลังร้าน {PLAT[platform] || platform} ก่อน</div>
      )}

      {adding && (
        <div className="ipromo-one">
          <div className="pmeta" style={{ marginBottom: 4 }}>
            <b>ใส่เข้า: {addingOpt?.name || adding}</b>
            <span className="sku">เปิดสวิตช์ตัวเลือกที่จะใส่ แล้วตั้งราคาหรือ % (แก้เป็นชุดได้)</span>
          </div>
          <BasketEdit key={adding} shop={shop} discountId={adding} itemId={String(itemId)} rows={rowsOf(null)}
            limit={addingOpt ? limitOf(addingOpt, false) : 0} editable={editable} {...(addingOpt ? editProps(addingOpt) : {})}
            startEditing onDone={() => { setAdding(null); setPick(''); if (onChanged) onChanged(); }} />
        </div>
      )}

      {promo.others.length > 0 && (
        <div className="sku" style={{ marginTop: 8 }}>
          โปรประเภทอื่นที่ตะกร้านี้อยู่ (แก้จากเว็บไม่ได้): {[...new Set(promo.others.map((o) => o.label || o.type))].join(', ')}
        </div>
      )}
    </section>
  );
}
