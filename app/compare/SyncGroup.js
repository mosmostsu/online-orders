'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// ปุ่ม "อัปเดตทั้งกลุ่ม" — ดึงสินค้าทุกร้านของกลุ่มที่เลือกจากแพลตฟอร์ม (ตัวเดียวกับปุ่ม "ดึงสินค้า" หน้า /product)
// หนึ่งรอบของเซิร์ฟเวอร์ ~17 วินาทีต่อร้าน จึงวนเรียกต่อเองจนครบ ร้านต่างๆ ทำพร้อมกัน
// ร้านที่ไม่มี API (Shopee MVP, Thaimart) ข้ามให้
// เลือกได้ว่าจะดึงร้านไหน (เมนูดรอปดาวน์: ติ๊กร้าน แล้วกด "ซิงก์") — ดึงทั้งกลุ่มนานเกินถ้าต้องการแค่บางแพลตฟอร์ม
// ระหว่างทำงานโชว์แผงความคืบหน้าเต็มความกว้าง (ตัวหมุน + สถานะต่อร้าน + เวลาที่ผ่านไป) ไม่ให้เหมือนค้าง
const API_PLATFORMS = ['shopee', 'tiktok', 'lazada', 'thisshop'];
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop', thaimart: 'Thaimart' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const labelOf = (s) => `${PLATFORM_LABEL[s.platform] || s.platform} ${s.shop}`;
const keyOf = (s) => `${s.platform}:${s.shop}`;
// เวลาดึงล่าสุด: วันนี้ → "14:32" · วันอื่น → "14 ต.ค. 14:32" (เวลาไทย)
function when(iso) {
  if (!iso) return 'ยังไม่เคยดึง';
  const d = new Date(iso);
  const day = (x) => x.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
  const hm = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  return day(d) === day(new Date()) ? `วันนี้ ${hm}` : `${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })} ${hm}`;
}
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// ใช้ทั้งหน้า /compare (ร้านในกลุ่ม ติ๊กทุกร้านไว้) และหน้า /product (ทุกร้าน ติ๊กเฉพาะร้านที่เปิดดูอยู่ — initial)
// initial: คีย์ 'platform:shop' ที่ติ๊กไว้ตอนเริ่ม (ไม่ใส่ = ทุกร้าน) · allLabel: ชื่อปุ่มตอนเลือกครบ
export default function SyncGroup({ shops, initial = null, allLabel = 'ทั้งกลุ่ม' }) {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState({});   // ชื่อร้าน → { text, state: 'run' | 'ok' | 'err' }
  const [summary, setSummary] = useState(null);   // { ok: bool, text }
  const [secs, setSecs] = useState(0);
  // ร้านที่ไม่เอา (labelOf)
  const [off, setOff] = useState(() => new Set(initial ? shops.filter((s) => !initial.includes(`${s.platform}:${s.shop}`)).map(labelOf) : []));
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState(null);   // { 'shopee:SOLID': iso | null } — เวลาดึงล่าสุดของแต่ละร้าน
  const box = useRef(null);
  useEffect(() => {   // คลิกนอกเมนู → ปิด
    if (!open) return undefined;
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [open]);
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
  const loadLast = () => {
    fetch(`/api/sync/last?shops=${able.map(keyOf).join(',')}`).then((r) => r.json())
      .then((j) => { if (j.ok) setLast(j.last); }).catch(() => {});
  };
  const toggle = (s) => setOff((o) => { const n = new Set(o); if (n.has(labelOf(s))) n.delete(labelOf(s)); else n.add(labelOf(s)); return n; });

  const setLine = (s, text, state) => setLines((prev) => ({ ...prev, [labelOf(s)]: { text, state } }));

  // ความคืบหน้า "อัปเดต xx/yy ตะกร้า"
  //   Shopee/TikTok: รอบแรกบอกจำนวนที่ต้องดึง (todo) แต่ละรอบบอกที่เหลือ (left) → ทำแล้ว = todo รอบแรก − left
  //   Lazada/ThisShop: ไล่ทุกหน้า → นับตะกร้าที่ได้สะสม เทียบกับจำนวนในร้าน (expect / total)
  async function syncShop(s) {
    const maxRounds = s.platform === 'thisshop' ? 40 : 15;
    let saved = 0;
    let base = null;   // todo รอบแรก (Shopee/TikTok)
    let done = 0;
    let got = 0;       // ตะกร้าที่ได้สะสม (Lazada/ThisShop)
    let expect = null;
    let total = null;
    const progress = () => (base != null
      ? (base === 0 ? `ข้อมูลล่าสุดอยู่แล้ว${total ? ` · ทั้งร้าน ${total} ตะกร้า` : ''}` : `อัปเดต ${done}/${base} ตะกร้า${total ? ` · ทั้งร้าน ${total}` : ''}`)
      : `อัปเดต ${got}${expect ? `/${expect}` : ''} ตะกร้า`);
    for (let round = 1; round <= maxRounds; round++) {
      setLine(s, round === 1 ? 'กำลังเช็ครายการตะกร้า...' : `กำลังดึง · ${progress()}`, 'run');
      const q = new URLSearchParams({ platform: s.platform, shop: s.shop });
      const res = await fetch(`/api/sync/products?${q}`, { method: 'POST' });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status} (อาจหมดเวลา)` }));
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      const bad = (j.result || []).find((r) => r.error);
      if (bad) throw new Error(bad.error);
      saved += (j.result || []).reduce((n, r) => n + (r.saved || 0), 0);
      const r = (j.result || []).find((x) => x.platform === s.platform && x.shop === s.shop && !x.skipped);
      if (r) {
        if (r.todo != null) {
          if (base == null) base = r.todo;
          done = Math.max(0, base - (r.left ?? 0));
          total = r.total ?? total;
        } else {
          got += s.platform === 'thisshop' ? (r.saved || 0) : (r.total || 0);
          expect = r.expect ?? (s.platform === 'thisshop' ? r.total : null) ?? expect;
        }
      }
      if (!j.more) break;
      if ((j.result || []).some((x) => x.skipped)) {
        setLine(s, `รอร้านนี้ว่าง (มีรอบอื่นกำลังดึงอยู่) · ${progress()}`, 'run');
        await sleep(5000);
      }
    }
    return { saved, text: progress() };
  }

  async function go() {
    if (busy || !targets.length) return;
    setOpen(false);
    setBusy(true);
    setSummary(null);
    setLines(Object.fromEntries(targets.map((s) => [labelOf(s), { text: 'รอคิว...', state: 'run' }])));
    let total = 0;
    const errors = [];
    try {
      await Promise.all(targets.map(async (s) => {
        try {
          const n = await syncShop(s);
          total += n.saved;
          setLine(s, `เสร็จ · ${n.text}`, 'ok');
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
      setLast(null);
      router.refresh();
    }
  }

  const entries = Object.entries(lines);
  return (
    <>
      <span className="cmp-sync-dd" ref={box}>
        <button className="btn cmp-syncbtn" onClick={() => { if (!open && !last) loadLast(); setOpen((o) => !o); }} disabled={busy} data-busy={busy ? '1' : '0'}
          title="เลือกร้านที่จะดึงสินค้าจากแพลตฟอร์มใหม่ (ใช้เวลาหลายนาที)" aria-expanded={open}>
          {busy ? <><span className="cmp-spin" aria-hidden="true" /> กำลังซิงก์... {mmss(secs)}</> : <>🔄 ซิงก์สินค้า ▾</>}
        </button>
        {open && !busy && (
          <div className="cmp-sync-menu" role="menu">
            <div className="sku">ดึงสินค้าจากแพลตฟอร์มใหม่ — เลือกร้าน</div>
            {able.map((s) => (
              <label key={labelOf(s)} className="cmp-sync-opt">
                <input type="checkbox" checked={!off.has(labelOf(s))} onChange={() => toggle(s)} /> {labelOf(s)}
                <span className="cmp-sync-when" title="ดึงสินค้าล่าสุด">{last ? when(last[keyOf(s)]) : '…'}</span>
              </label>
            ))}
            {able.length > 1 && (
              <div className="cmp-sync-quick">
                <button type="button" className="link" onClick={() => setOff(new Set())}>เลือกทั้งหมด</button>
                <button type="button" className="link" onClick={() => setOff(new Set(able.map(labelOf)))}>ล้าง</button>
              </div>
            )}
            <button type="button" className="btn ast-open" disabled={!targets.length} onClick={go}>
              {targets.length ? `ซิงก์ ${targets.length === able.length ? allLabel : targets.length === 1 ? labelOf(targets[0]) : `${targets.length} ร้าน`}` : 'เลือกร้านก่อน'}
            </button>
          </div>
        )}
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
