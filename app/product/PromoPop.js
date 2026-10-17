'use client';
import { useCallback, useState } from 'react';
import Modal from './Modal';
import ItemPromo from './ItemPromo';

// ป็อปอัพ "แก้โปร" ของตะกร้าเดียว (Shopee / TikTok) — กดลิงก์/ราคาโปรในหน้ารายการสินค้าแล้วแก้ได้เลย ไม่ต้องเข้าหน้ารายละเอียด
// เปิดแล้วถามโปรจากร้าน (/api/discount/<platform>/item) · บันทึกแล้วโหลดใหม่ในป็อปอัพให้เห็นผล
// TikTok: ไม่มี API ถามรายตะกร้า — อ่านจากดัชนีโปรที่จำไว้ 5 นาที (ครั้งแรก/หลังบันทึกช้าหน่อย)
// children = ตัวกดเปิด (ลิงก์/ราคา) · title = ชื่อตะกร้าที่หัวป็อปอัพ
const LABEL = { shopee: 'Shopee', tiktok: 'TikTok', lazada: 'Lazada' };

export default function PromoPop({ shop, itemId, title, className = 'link', children, platform = 'shopee' }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const q = new URLSearchParams({ shop, itemId });
      const res = await fetch(`/api/discount/${LABEL[platform] ? platform : 'shopee'}/item?${q}`);
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setData(j);
    } catch (e) { setErr(e.message); }
  }, [shop, itemId, platform]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button type="button" className={'linkbtn ' + className} onClick={() => { setOpen(true); setData(null); load(); }}>{children}</button>
      {open && (
        <Modal title="โปรโมชันส่วนลด" onClose={close} wide>
          {title && <div className="sku clamp2" style={{ marginBottom: 10 }}>{title} · <span className="mono">{itemId}</span></div>}
          {err ? <div className="danger">{err}</div>
            : !data ? <div className="sku">กำลังถามโปรจาก {LABEL[platform] || platform}…</div>
              : <ItemPromo shop={shop} itemId={String(itemId)} skus={data.skus} promo={data.promo} editable onChanged={load} platform={platform} />}
        </Modal>
      )}
    </>
  );
}
