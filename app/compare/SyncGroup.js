'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// ปุ่ม "อัปเดตทั้งกลุ่ม" — ดึงสินค้าทุกร้านของกลุ่มที่เลือกจากแพลตฟอร์ม (ตัวเดียวกับปุ่ม "ดึงสินค้า" หน้า /product)
// หนึ่งรอบของเซิร์ฟเวอร์ ~17 วินาทีต่อร้าน จึงวนเรียกต่อเองจนครบ ร้านต่างๆ ทำพร้อมกัน
// ร้านที่ไม่มี API (Shopee MVP, Thaimart) ข้ามให้
const API_PLATFORMS = ['shopee', 'tiktok', 'lazada', 'thisshop'];
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop', thaimart: 'Thaimart' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function SyncGroup({ shops }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();

  const targets = shops.filter((s) => API_PLATFORMS.includes(s.platform) && !(s.platform === 'shopee' && s.shop === 'MVP'));
  const skipped = shops.length - targets.length;
  if (!targets.length) return null;

  async function syncShop(s, progress) {
    const maxRounds = s.platform === 'thisshop' ? 40 : 15;
    let saved = 0;
    for (let round = 1; round <= maxRounds; round++) {
      progress(s, `รอบ ${round} · ${saved} ตะกร้า`);
      const q = new URLSearchParams({ platform: s.platform, shop: s.shop });
      const res = await fetch(`/api/sync/products?${q}`, { method: 'POST' });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status} (อาจหมดเวลา)` }));
      if (!j.ok) throw new Error(j.error || 'ไม่สำเร็จ');
      const bad = (j.result || []).find((r) => r.error);
      if (bad) throw new Error(bad.error);
      saved += (j.result || []).reduce((n, r) => n + (r.saved || 0), 0);
      if (!j.more) break;
      if ((j.result || []).some((r) => r.skipped)) await sleep(5000);
    }
    return saved;
  }

  async function go() {
    if (busy) return;
    setBusy(true);
    const state = new Map();
    const show = () => setMsg([...state].map(([k, v]) => `${k}: ${v}`).join(' · '));
    const progress = (s, text) => {
      state.set(`${PLATFORM_LABEL[s.platform] || s.platform} ${s.shop}`, text);
      show();
    };
    let total = 0;
    const errors = [];
    try {
      await Promise.all(targets.map(async (s) => {
        try {
          const n = await syncShop(s, progress);
          total += n;
          progress(s, `เสร็จ ${n}`);
        } catch (e) {
          errors.push(`${PLATFORM_LABEL[s.platform] || s.platform} ${s.shop}: ${e.message}`);
          progress(s, 'สะดุด');
        }
      }));
      setMsg(errors.length
        ? `อัปเดต ${total} ตะกร้า · สะดุด ${errors.length} ร้าน (${errors[0]})`
        : `เสร็จ · อัปเดต ${total} ตะกร้า${skipped ? ` · ข้าม ${skipped} ร้านที่ไม่มี API` : ''}`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="btn" onClick={go} disabled={busy}
        title="ดึงสินค้าทุกร้านของกลุ่มนี้จากแพลตฟอร์มใหม่ทั้งหมด (ใช้เวลาหลายนาที)">
        {busy ? 'กำลังอัปเดต...' : 'อัปเดตทั้งกลุ่ม'}
      </button>
      {msg && <span className="sub" style={{ margin: 0 }}>{msg}</span>}
    </span>
  );
}
