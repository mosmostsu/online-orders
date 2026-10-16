'use client';
import { useCallback, useState } from 'react';
import Modal from './Modal';
import ItemPromo from './ItemPromo';

// ป็อปอัพ "แก้โปร" ของตะกร้าเดียว (Shopee) — กดลิงก์/ราคาโปรในหน้ารายการสินค้าแล้วแก้ได้เลย ไม่ต้องเข้าหน้ารายละเอียด
// เปิดแล้วถามโปรสดจาก Shopee (/api/discount/shopee/item) · บันทึกแล้วโหลดใหม่ในป็อปอัพให้เห็นผล
// children = ตัวกดเปิด (ลิงก์/ราคา) · title = ชื่อตะกร้าที่หัวป็อปอัพ
export default function PromoPop({ shop, itemId, title, className = 'link', children }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const q = new URLSearchParams({ shop, itemId });
      const res = await fetch(`/api/discount/shopee/item?${q}`);
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setData(j);
    } catch (e) { setErr(e.message); }
  }, [shop, itemId]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button type="button" className={'linkbtn ' + className} onClick={() => { setOpen(true); setData(null); load(); }}>{children}</button>
      {open && (
        <Modal title="โปรโมชันส่วนลด" onClose={close} wide>
          {title && <div className="sku clamp2" style={{ marginBottom: 10 }}>{title} · <span className="mono">{itemId}</span></div>}
          {err ? <div className="danger">{err}</div>
            : !data ? <div className="sku">กำลังถามโปรจาก Shopee…</div>
              : <ItemPromo shop={shop} itemId={String(itemId)} skus={data.skus} promo={data.promo} editable onChanged={load} />}
        </Modal>
      )}
    </>
  );
}
