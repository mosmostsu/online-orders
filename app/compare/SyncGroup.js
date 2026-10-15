'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// ปุ่ม "อัปเดตทั้งกลุ่ม" — ดึงสินค้าทุกร้านของกลุ่มที่เลือกจากแพลตฟอร์ม (ตัวเดียวกับปุ่ม "ดึงสินค้า" หน้า /product)
// หนึ่งรอบของเซิร์ฟเวอร์ ~17 วินาทีต่อร้าน จึงวนเรียกต่อเองจนครบ ร้านต่างๆ ทำพร้อมกัน
// ร้านที่ไม่มี API (Shopee MVP, Thaimart) ข้ามให้
// เลือกได้ว่าจะดึงร้านไหน (ติ๊กชิปข้างปุ่ม) — ดึงทั้งกลุ่มนานเกินถ้าต้องการแค่บางแพลตฟอร์ม
// ระหว่างทำงานโชว์แผงความคืบหน้าเต็มความกว้าง (ตัวหมุน + สถานะต่อร้าน + เวลาที่ผ่านไป) ไม่ให้เหมือนค้าง
const API_PLATFORMS = ['shopee', 'tiktok', 'lazada', 'thisshop'];
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop', thaimart: 'Thaimart' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const labelOf = (s) => `${PLATFORM_LABEL[s.platform] || s.platform} ${s.shop}`;
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export default function SyncGroup({ shops }) {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState({});   // ชื่อร้าน → { text, state: 'run' | 'ok' | 'err' }
  const [summary, setSummary] = useState(null);   // { ok: bool, text }
  const [secs, setSecs] = useState(0);
  const [off, setOff] = useState(() => new Set());   // ร้านที่ไม่เอา (labelOf)
  const router = useRouter();

  useEffect(() => {
    if (!busy) return undefined;
    const t0 = Date.now();
    setSecs(0);
    const id = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const able = shops.filter((s) => API_PLATFORMS.includes(s.platform) && !(s.platform === 'shopee' && s.shop === 'MVP'));
  const targets = able.filter((s) => !off.has(labelOf(s)));
  const skipped = shops.length - able.length;
  if (!able.length) return null;
  const toggle = (s) => setOff((o) => { const n = new Set(o); if (n.has(labelOf(s))) n.delete(labelOf(s)); else n.add(labelOf(s)); return n; });

  const setLine = (s, text, state) => setLines((prev) => ({ ...prev, [labelOf(s)]: { text, state } }));

  async function syncShop(s) {
    const maxRounds = s.platform === 'thisshop' ? 40 : 15;
    let saved = 0;
    for (let round = 1; round <= maxRounds; round++) {
      setLine(s, `กำลังดึง · รอบ ${round} · ได้แล้ว ${saved} ตะกร้า`, 'run');
      const q = new URLSearchParams({ platform: s.platform, shop: s.shop });
      const res = await fetch(`/api/sync/products?${q}`, { method: 'POST' });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status} (อาจหมดเวลา)` }));
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      const bad = (j.result || []).find((r) => r.error);
      if (bad) throw new Error(bad.error);
      saved += (j.result || []).reduce((n, r) => n + (r.saved || 0), 0);
      if (!j.more) break;
      if ((j.result || []).some((r) => r.skipped)) {
        setLine(s, `รอร้านนี้ว่าง (มีรอบอื่นกำลังดึงอยู่) · ได้แล้ว ${saved} ตะกร้า`, 'run');
        await sleep(5000);
      }
    }
    return saved;
  }

  async function go() {
    if (busy || !targets.length) return;
    setBusy(true);
    setSummary(null);
    setLines(Object.fromEntries(targets.map((s) => [labelOf(s), { text: 'รอคิว...', state: 'run' }])));
    let total = 0;
    const errors = [];
    try {
      await Promise.all(targets.map(async (s) => {
        try {
          const n = await syncShop(s);
          total += n;
          setLine(s, `เสร็จ · อัปเดต ${n} ตะกร้า`, 'ok');
        } catch (e) {
          errors.push(`${labelOf(s)}: ${e.message}`);
          setLine(s, `สะดุด: ${e.message}`, 'err');
        }
      }));
      setSummary(errors.length
        ? { ok: false, text: `อัปเดต ${total} ตะกร้า · สะดุด ${errors.length} ร้าน (กดอีกครั้งเพื่อทำต่อ)` }
        : { ok: true, text: `เสร็จแล้ว · อัปเดต ${total} ตะกร้า (${targets.length} ร้าน)${skipped ? ` · ข้าม ${skipped} ร้านที่ไม่มี API` : ''}` });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const entries = Object.entries(lines);
  return (
    <>
      <span className="cmp-sync-pick">
        {able.length > 1 && able.map((s) => (
          <button key={labelOf(s)} type="button" className="chip" data-on={off.has(labelOf(s)) ? '0' : '1'} disabled={busy}
            onClick={() => toggle(s)} title="กดเพื่อเลือก/ไม่เลือกร้านนี้">{off.has(labelOf(s)) ? '' : '✓ '}{labelOf(s)}</button>
        ))}
        <button className="btn cmp-syncbtn" onClick={go} disabled={busy || !targets.length} data-busy={busy ? '1' : '0'}
          title="ดึงสินค้าของร้านที่เลือกจากแพลตฟอร์มใหม่ทั้งหมด (ใช้เวลาหลายนาที)">
          {busy ? <><span className="cmp-spin" aria-hidden="true" /> กำลังอัปเดต... {mmss(secs)}</>
            : targets.length === able.length ? 'อัปเดตทั้งกลุ่ม' : targets.length ? `อัปเดต ${targets.length} ร้าน` : 'เลือกร้านก่อน'}
        </button>
      </span>

      {(busy || summary) && (
        <div className="cmp-sync-panel" data-ok={summary ? (summary.ok ? '1' : '0') : ''} role="status" aria-live="polite">
          <div className="cmp-sync-head">
            {busy
              ? <><span className="cmp-spin" aria-hidden="true" /> <b>กำลังอัปเดตสินค้าจากแพลตฟอร์ม</b> · {mmss(secs)} · ใช้เวลาหลายนาที ห้ามปิดหน้านี้</>
              : <b>{summary.text}</b>}
          </div>
          <div className="cmp-sync-lines">
            {entries.map(([name, l]) => (
              <div key={name} className="cmp-sync-line" data-state={l.state}>
                <span className="cmp-sync-mark">{l.state === 'ok' ? '✓' : l.state === 'err' ? '✗' : <span className="cmp-spin" aria-hidden="true" />}</span>
                <b>{name}</b> <span>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
