'use client';
import { useState } from 'react';
import Link from 'next/link';
import BasketEdit from '../discount/BasketEdit';

// โปรส่วนลดของตะกร้านี้ในหน้ารายละเอียดสินค้า (Shopee) — ใช้ตัวแก้ตัวเดียวกับหน้าโปร
//   อยู่ในโปรแล้ว → แก้ราคา / % / เอาออก / ใส่ตัวเลือกที่ยังไม่อยู่เพิ่ม
//   ยังไม่อยู่ → เลือกโปร (กำลังดำเนินการ / เร็วๆ นี้) แล้วตั้งราคาใส่เข้าไป
// promo มาจาก shopeeItemPromo (lib/discounts.js) · skus จาก os_listing_skus ของหน้านี้
const fmtSec = (s) => {
  if (!s) return '—';
  const d = new Date(Number(s) * 1000 + 7 * 3600000);
  const M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
};

export default function ItemPromo({ shop, itemId, skus, promo, editable }) {
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
  const usedIds = new Set(promo.in.map((p) => p.discount_id));
  const options = promo.options.filter((o) => !usedIds.has(o.discount_id));
  const addingOpt = promo.options.find((o) => o.discount_id === adding);

  return (
    <section className="pcard ipromo" id="promo">
      <h2 className="vh" style={{ margin: '0 0 8px' }}>โปรส่วนลด</h2>

      {promo.in.map((p) => (
        <div key={p.discount_id} className="ipromo-one">
          <div className="pmeta" style={{ marginBottom: 4 }}>
            <b>{p.name || `โปร ${p.discount_id}`}</b>
            <span className={`badge ${p.staging === 'ongoing' ? 'ok' : 'warn'}`}>{p.staging === 'ongoing' ? 'กำลังดำเนินการ' : 'เร็วๆ นี้'}</span>
            <span className="sku">{fmtSec(p.start_time)} → {fmtSec(p.end_time)}</span>
            <Link prefetch={false} className="link" href={`/discount/shopee/${encodeURIComponent(shop)}/${p.discount_id}`}>ดูทั้งโปร →</Link>
            <span className="sku">{Object.keys(p.models).length}/{skus.length} ตัวเลือกอยู่ในโปร</span>
          </div>
          <BasketEdit shop={shop} discountId={p.discount_id} itemId={String(itemId)} rows={rowsFor(p.models)}
            limit={p.limit ?? null} editable={editable} />
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
                {o.name} ({o.status === 'ongoing' ? 'กำลังดำเนินการ' : 'เร็วๆ นี้'} · ถึง {fmtSec(o.end_time)})
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={!pick} onClick={() => setAdding(pick)}>ตั้งราคา →</button>
        </div>
      )}
      {editable && !adding && options.length === 0 && promo.in.length === 0 && (
        <div className="sku">ไม่มีโปรที่กำลังดำเนินการหรือกำลังจะเริ่ม — สร้างโปรใหม่ในหลังร้าน Shopee ก่อน</div>
      )}

      {adding && (
        <div className="ipromo-one">
          <div className="pmeta" style={{ marginBottom: 4 }}>
            <b>ใส่เข้า: {addingOpt?.name || adding}</b>
            <span className="sku">เปิดสวิตช์ตัวเลือกที่จะใส่ แล้วตั้งราคาหรือ % (แก้เป็นชุดได้)</span>
          </div>
          <BasketEdit key={adding} shop={shop} discountId={adding} itemId={String(itemId)} rows={rowsFor(null)}
            limit={0} editable={editable} startEditing onDone={() => { setAdding(null); setPick(''); }} />
        </div>
      )}

      {promo.others.length > 0 && (
        <div className="sku" style={{ marginTop: 8 }}>
          โปรประเภทอื่นที่ตะกร้านี้อยู่ (แก้จากเว็บไม่ได้): {[...new Set(promo.others.map((o) => o.type))].join(', ')}
        </div>
      )}
      {!editable && <div className="sub" style={{ margin: '8px 0 0' }}>ใส่รหัสด้านบนเพื่อแก้โปร</div>}
    </section>
  );
}
