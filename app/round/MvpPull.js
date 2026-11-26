'use client';
// ปุ่ม "ดึงออเดอร์ Shopee MVP" ในหน้ารอบจัดส่ง
// MVP/PACE ไม่มี API → ส่วนขยาย MVP + PACE Stock Sync (extensions/mvp-stock 1.3+) อ่านหน้าคำสั่งซื้อของ Seller Center
// แล้วส่งเข้า /api/mvp/orders · ร้านนี้กดส่งวันละรอบ กดดึงครั้งเดียวหลังกดส่งก็พอ
// ปุ่มขึ้นเฉพาะ Chrome โปรไฟล์ที่ติดตั้งส่วนขยายไว้ (ที่ล็อกอิน Seller Center ร้านนั้น) เครื่องอื่นไม่เห็น
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MvpPull() {
  const router = useRouter();
  const [ext, setExt] = useState(null);   // null = ยังไม่รู้ · false = ไม่มี · { version }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const waiter = useRef(null);

  useEffect(() => {
    const on = (e) => {
      if (e.source !== window || e.data?.source !== 'mvp-ext') return;
      if (e.data.type === 'mvp-pong') setExt({ version: e.data.version });
      if (e.data.type === 'mvp-result' && waiter.current?.id === e.data.id) { waiter.current.resolve(e.data.result); waiter.current = null; }
    };
    window.addEventListener('message', on);
    window.postMessage({ source: 'order-sync', type: 'mvp-ping', id: 'ping' }, location.origin);
    const t = setTimeout(() => setExt((x) => x || false), 1500);
    return () => { window.removeEventListener('message', on); clearTimeout(t); };
  }, []);

  if (!ext) return null;
  const old = !/^(1\.(3|[4-9]|\d{2,})|[2-9])/.test(ext.version || '');

  async function pull() {
    setBusy(true); setMsg(null);
    try {
      const id = `mvp-orders-${Date.now()}`;
      const r = await new Promise((resolve) => {
        waiter.current = { id, resolve };
        window.postMessage({ source: 'order-sync', type: 'mvp-orders', id }, location.origin);
      });
      if (!r?.ok) throw new Error(r?.error || 'ส่วนขยายไม่ตอบ');
      setMsg({ ok: true, text: `${r.label}: ได้ ${r.sent} ใบ (รอส่ง ${r.counts?.toship ?? 0} · กดส่งแล้ว ${r.counts?.processed ?? 0})` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: String(e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', margin: '6px 0' }}>
      {old ? (
        <span className="note">ส่วนขยาย MVP รุ่น {ext.version} ยังดึงออเดอร์ไม่ได้ — โหลดส่วนขยายรุ่นใหม่ (1.3) ก่อน</span>
      ) : (
        <button className="btn" onClick={pull} disabled={busy}>
          {busy ? 'กำลังดึงจาก Seller Center…' : '📥 ดึงออเดอร์ Shopee MVP'}
        </button>
      )}
      {msg && <span className={msg.ok ? 'sub' : 'note note-danger'} style={{ margin: 0 }}>{msg.text}</span>}
    </div>
  );
}
