'use client';
import { Fragment, useState } from 'react';

// แถวโปรหนึ่งแถว + ปุ่ม "ดูสินค้า" → โหลดสินค้าในโปร (รายตัวเลือก) มากางใต้แถว
// โหลดครั้งเดียวแล้วจำไว้ กดซ่อน/กางซ้ำไม่ต้องโหลดใหม่
// คลัง = คลังปกติของตัวเลือก · "กันโปร" โชว์เฉพาะตอนตั้งสต็อกโปรแยกไว้ (Shopee ส่ง 0 = ไม่กัน)
const baht = (n) => (n === null || n === undefined ? '—' : '฿' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));

export default function DiscountItems({ shop, id, children }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (rows) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/discount/items?${new URLSearchParams({ shop, id })}`);
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setRows(j.rows);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const items = rows ? new Set(rows.map((r) => r.item_id)).size : null;
  return (
    <Fragment>
      <tr>
        {children}
        <td>
          <button type="button" className="dbtn" onClick={toggle}>
            {busy ? 'กำลังโหลด…' : open ? 'ซ่อน ⌃' : rows ? `${items} ตะกร้า · ${rows.length} ตัวเลือก ⌄` : 'ดูสินค้า ⌄'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="ddetail">
          <td colSpan={4}>
            {err && <div className="sku danger">{err}</div>}
            {rows && rows.length === 0 && <div className="sku">โปรนี้ไม่มีสินค้า</div>}
            {rows && rows.length > 0 && (
              <table>
                <thead>
                  <tr><th>สินค้า</th><th>SKU</th><th className="r">ราคาปกติ</th><th className="r">ราคาโปร</th><th className="r">ลด</th><th className="r">คลัง</th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const first = i === 0 || rows[i - 1].item_id !== r.item_id;
                    const off = r.price && r.promo ? Math.round((1 - r.promo / r.price) * 100) : null;
                    return (
                      <tr key={`${r.item_id}:${r.sku_id}`} className={first ? 'dfirst' : ''}>
                        <td>
                          {first && <div className="clamp2" style={{ fontWeight: 500 }}>{r.item_name || r.item_id}</div>}
                          {r.model_name && <div className="sku">{r.model_name}</div>}
                        </td>
                        <td className="mono">{r.seller_sku || <span className="sku">—</span>}</td>
                        <td className="num">{baht(r.price)}</td>
                        <td className="num promo">{baht(r.promo)}</td>
                        <td className="num doff">{off !== null ? `-${off}%` : '—'}</td>
                        <td className={'num ' + (Number(r.stock) === 0 ? 'danger' : '')}>
                          {Number(r.stock) === 0 ? 'หมด' : r.stock ?? '—'}
                          {Number(r.promo_stock) > 0 && <div className="sku">กันโปร {r.promo_stock}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}
