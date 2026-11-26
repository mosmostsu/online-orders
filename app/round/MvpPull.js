'use client';
// ปุ่ม "ดึงออเดอร์ Shopee MVP" ในหน้ารอบจัดส่ง
// MVP ไม่มี API → ส่วนขยาย MVP + PACE Stock Sync (extensions/mvp-stock) บน Chrome ที่ล็อกอิน Seller Center ร้าน MVP
// อ่านหน้าคำสั่งซื้อแล้วส่งเข้า /api/mvp/orders · ร้านกดส่งวันละรอบ กดดึงครั้งเดียวหลังกดส่งก็พอ
//   เครื่องที่มีส่วนขยาย → สั่งส่วนขยายดึงตรงๆ
//   เครื่องอื่น → ฝากคำขอไว้ (/api/round/mvp-pull, supabase/070) ส่วนขยายเครื่อง MVP เช็คทุก 2 นาทีแล้วดึงให้
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const SHOP = 'MVP';
const hhmm = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'เมื่อกี้' : m < 60 ? `${m} นาทีก่อน` : hhmm(iso);
};
const WAIT_MS = 5 * 60000;

export default function MvpPull() {
  const router = useRouter();
  const [ext, setExt] = useState(null);   // null = ยังไม่รู้ · false = ไม่มี · { version }
  const [st, setSt] = useState(null);     // สถานะจาก /api/round/mvp-pull
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const waiter = useRef(null);
  const timer = useRef(null);

  const load = () => fetch(`/api/round/mvp-pull?shop=${SHOP}`).then((r) => r.json()).catch(() => null);

  useEffect(() => {
    const on = (e) => {
      if (e.source !== window || e.data?.source !== 'mvp-ext') return;
      if (e.data.type === 'mvp-pong') setExt({ version: e.data.version });
      if (e.data.type === 'mvp-result' && waiter.current?.id === e.data.id) { waiter.current.resolve(e.data.result); waiter.current = null; }
    };
    window.addEventListener('message', on);
    window.postMessage({ source: 'order-sync', type: 'mvp-ping', id: 'ping' }, location.origin);
    const t = setTimeout(() => setExt((x) => x || false), 1500);
    load().then((j) => { if (j) setSt(j); });
    return () => { window.removeEventListener('message', on); clearTimeout(t); clearTimeout(timer.current); };
  }, []);

  const direct = ext && /^(1\.(3|[4-9]|\d{2,})|[2-9])/.test(ext.version || '');

  // เครื่องที่มีส่วนขยาย — ดึงเองเลย
  async function pullHere() {
    setBusy(true); setMsg(null);
    try {
      const id = `mvp-orders-${Date.now()}`;
      const r = await new Promise((resolve) => {
        waiter.current = { id, resolve };
        window.postMessage({ source: 'order-sync', type: 'mvp-orders', id }, location.origin);
      });
      if (!r?.ok) throw new Error(r?.error || 'ส่วนขยายไม่ตอบ');
      setMsg({ ok: true, text: `ได้ ${r.sent} ใบ (รอส่ง ${r.counts?.toship ?? 0} · กดส่งแล้ว ${r.counts?.processed ?? 0})` });
      load().then((j) => { if (j) setSt(j); });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: String(e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  // เครื่องอื่น — ฝากคำขอ แล้วรอจนเครื่อง MVP ดึงเสร็จ
  async function ask() {
    setBusy(true); setMsg(null);
    try {
      const j = await fetch('/api/round/mvp-pull', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shop: SHOP }),
      }).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'ฝากคำขอไม่สำเร็จ');
      setSt(j);
      const until = Date.now() + WAIT_MS;
      const tick = async () => {
        const s = await load();
        if (s?.ok) setSt(s);
        if (s?.ok && !s.pending) {
          setBusy(false);
          if (s.done_ok) { setMsg({ ok: true, text: `ดึงแล้ว · ${s.message || ''}` }); router.refresh(); }
          else setMsg({ ok: false, text: s.message || 'ดึงไม่สำเร็จ' });
          return;
        }
        if (Date.now() > until) {
          setBusy(false);
          setMsg({ ok: false, text: 'เครื่อง MVP ยังไม่ได้ดึง — คำขอฝากไว้แล้ว จะดึงให้เมื่อเปิด Chrome เครื่องนั้น (รีเฟรชหน้านี้ทีหลัง)' });
          return;
        }
        timer.current = setTimeout(tick, 5000);
      };
      timer.current = setTimeout(tick, 3000);
    } catch (e) {
      setBusy(false);
      setMsg({ ok: false, text: String(e.message || e) });
    }
  }

  if (ext === null) return null;
  const last = st?.ok && st.done_at
    ? `ดึงล่าสุด ${hhmm(st.done_at)}${st.done_ok === false ? ` · ไม่สำเร็จ: ${st.message || ''}` : ''}`
    : '';
  const offline = st?.ok && !st.online && !direct;

  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
      {direct ? (
        <button className="btn" onClick={pullHere} disabled={busy}>
          {busy ? 'กำลังดึงจาก Seller Center…' : '📥 ดึงออเดอร์ Shopee MVP'}
        </button>
      ) : st && !st.ok ? null : (
        <button className="btn" onClick={ask} disabled={busy || !st}>
          {busy ? 'รอเครื่อง MVP ดึงให้… (ไม่เกิน 2-3 นาที)' : '📥 ขอดึงออเดอร์ Shopee MVP'}
        </button>
      )}
      {last && <span className="sub" style={{ margin: 0 }}>{last}</span>}
      {offline && (
        <span className="sub" style={{ margin: 0 }}>
          · Chrome เครื่อง MVP {st.seen_at ? `ไม่ได้เปิด (เห็นล่าสุด ${ago(st.seen_at)})` : 'ยังไม่เคยเชื่อม'} — กดขอไว้ได้ จะดึงให้เมื่อเปิด
        </span>
      )}
      {st && !st.ok && <span className="sub" style={{ margin: 0 }}>ปุ่มขอดึงจากเครื่องอื่นยังใช้ไม่ได้: {st.error}</span>}
      {msg && <span className={msg.ok ? 'sub' : 'note note-danger'} style={{ margin: 0 }}>{msg.text}</span>}
    </div>
  );
}
