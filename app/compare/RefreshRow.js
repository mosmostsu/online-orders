'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// ปุ่ม ↻ ท้ายแถว — ดึงตะกร้าทุกใบในแถวนั้น (ทุกร้านพร้อมกัน) สดจากแพลตฟอร์ม แล้วโหลดหน้าใหม่
// วางอยู่ใน <summary> จึงกันไม่ให้แถวกาง/หุบตามตอนกด
// ระหว่างทำงาน: ปุ่มหมุน + ข้อความ "กำลังรีเฟรช…" + หรี่ทั้งแถว · จบแล้วโชว์ผลค้างไว้ 8 วินาที
// ร้านที่ไม่มี API (Shopee MVP, ThisShop, Thaimart) เซิร์ฟเวอร์ข้ามให้เอง
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop', thaimart: 'Thaimart' };

const KEEP_KEY = 'cmp-reopen';

export default function RefreshRow({ items, rowId }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // { ok: bool, text }
  const [secs, setSecs] = useState(0);
  const btn = useRef(null);
  const router = useRouter();

  useEffect(() => {
    if (!busy) return undefined;
    const t0 = Date.now();
    setSecs(0);
    const id = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    // ผลสำเร็จหายเองใน 8 วินาที · ข้อผิดพลาดค้างไว้จนกดอีกครั้ง/กด ✕ (จะได้ก๊อปข้อความไปส่งดูได้)
    if (!msg || !msg.ok) return undefined;
    const id = setTimeout(() => setMsg(null), 8000);
    return () => clearTimeout(id);
  }, [msg]);

  const rowEl = () => btn.current?.closest('details');

  // หลังรีเฟรชหน้า (router.refresh) แถวอาจถูกวาดใหม่ในสภาพหุบ/เลื่อนกลับบนสุด — จำไว้แล้วเปิดแถวเดิม เลื่อนมาให้เห็น
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEEP_KEY);
      if (!raw) return;
      const k = JSON.parse(raw);
      if (k.rowId !== rowId || Date.now() - k.at > 60000) return;
      sessionStorage.removeItem(KEEP_KEY);
      const el = rowEl();
      if (el) {
        el.open = true;
        el.scrollIntoView({ block: 'center' });
      }
      if (k.msg) setMsg(k.msg);
    } catch { /* ไม่มี sessionStorage — ไม่เป็นไร */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function go(e) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    rowEl()?.setAttribute('data-busy', '1');
    try {
      const res = await fetch('/api/sync/product-one', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status} (อาจหมดเวลา)` }));
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      const done = j.results.filter((r) => r.ok).length;
      const skipped = j.results.filter((r) => r.skipped).length;
      const bads = j.results.filter((r) => r.error);
      setMsg(bads.length
        ? {
          ok: false,
          text: `พลาด ${bads.length} ใบ (สำเร็จ ${done}): `
            + bads.map((r) => `${PLATFORM_LABEL[r.platform] || r.platform} ${r.shop} #${r.id} — ${r.error}`).join(' | '),
        }
        : { ok: true, text: `รีเฟรชแล้ว ${done} ใบ${skipped ? ` · ข้าม ${skipped} (ไม่มี API)` : ''}` });
      try {
        sessionStorage.setItem(KEEP_KEY, JSON.stringify({
          rowId, at: Date.now(),
          msg: bads.length ? null : { ok: true, text: `รีเฟรชแล้ว ${done} ใบ${skipped ? ` · ข้าม ${skipped} (ไม่มี API)` : ''}` },
        }));
      } catch { /* ข้าม */ }
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: `พลาด: ${err.message}` });
    } finally {
      setBusy(false);
      rowEl()?.removeAttribute('data-busy');
    }
  }

  if (!items.length) return null;
  return (
    <span className="cmp-rr" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      {(busy || msg) && (
        <span className="cmp-rmsg" data-ok={busy ? '' : msg.ok ? '1' : '0'} role="status">
          {busy ? `กำลังรีเฟรช… ${secs} วิ` : msg.text}
          {!busy && !msg.ok && (
            <button type="button" className="cmp-rx" aria-label="ปิดข้อความ" onClick={() => setMsg(null)}>✕</button>
          )}
        </span>
      )}
      <button ref={btn} type="button" className="cmp-rbtn" data-busy={busy ? '1' : '0'} onClick={go}
        title="รีเฟรชตะกร้าในแถวนี้จากแพลตฟอร์ม (ทุกร้านพร้อมกัน)" aria-label="รีเฟรชแถวนี้">↻</button>
    </span>
  );
}
