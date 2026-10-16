// ราคาที่จะลงร้าน Thaimart — ส่วนขยาย Chrome (extensions/thaimart-stock) ส่งรายการ SKU มา ได้ราคากลับไป
//
// ราคามาจากไฟล์ DC กลาง (central/DC.json ที่ Colab อัปทุกรอบ) — 1 สินค้ามี 2 แถว:
//   CF_LEVELNO 0 = ราคาเต็ม (CF_PRICE)   ·   CF_LEVELNO 1 = ราคาลด (CF_FMLPRICE อาจเป็นสตริง "1,080.00")
// Thaimart ยังไม่มีระบบส่วนลด (กำลังพัฒนา) ผู้ใช้สั่ง 2026-10-16 ให้ใส่ราคาตาม DC ไปก่อน
//   → ราคาที่ลง = ราคาลด ถ้าไม่มีราคาลดใช้ราคาเต็ม · ส่ง full กลับไปด้วย ไว้ใช้ตอน Thaimart มีส่วนลด
// SKU ที่ไม่มีใน DC ตอบ null — ส่วนขยายคงราคาเดิม
//
// ไฟล์ DC บีบอัดแล้ว ~1.6MB (~93,000 แถว) โหลดทุกครั้งไหว · เก็บไว้ในหน่วยความจำระหว่าง lambda ยังอุ่น (ไฟล์ไม่เปลี่ยน = ไม่โหลดใหม่)
// ป้องกันด้วย header x-key = MVP_STOCK_KEY (กุญแจเดียวกับ /api/mvp/stock)
import { NextResponse } from 'next/server';
import { fetchCentralMeta, fetchCentralRows } from '@/lib/central';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

let cache = null;   // { updated, fileAt, prices: Map(sku → { full, sale }) }

async function loadPrices() {
  const meta = await fetchCentralMeta('DC');
  if (cache && cache.updated === meta.updated) return cache;
  const rows = await fetchCentralRows('DC', meta);
  // หัวคอลัมน์ของ DC เป็นตัวใหญ่ (ST เป็นตัวเล็ก) — รับทั้งสองแบบเผื่อ Colab เปลี่ยน
  const get = (r, k) => r[k] ?? r[k.toLowerCase()];
  const prices = new Map();
  for (const r of rows) {
    if (!r) continue;
    const sku = String(get(r, 'CF_ITEMID') ?? '').trim();
    if (!sku) continue;
    let e = prices.get(sku);
    if (!e) { e = { full: null, sale: null }; prices.set(sku, e); }
    const level = Number(get(r, 'CF_LEVELNO'));
    if (level === 0) {
      const p = num(get(r, 'CF_PRICE')) || num(get(r, 'CF_ITEMPRICELEVEL_PRICE'));
      if (p > 0) e.full = p;
    } else if (level === 1) {
      const s = num(get(r, 'CF_FMLPRICE'));
      if (s > 0) e.sale = s;
    }
    // แถวระดับอื่น (เจอ 2 แถวแปลกๆ ในไฟล์) ไม่ใช้
  }
  cache = { updated: meta.updated, fileAt: meta.fileModified ? new Date(meta.fileModified).toISOString() : meta.updated, prices };
  return cache;
}

export async function POST(req) {
  const key = process.env.MVP_STOCK_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'ยังไม่ได้ตั้ง MVP_STOCK_KEY ที่ Netlify' }, { status: 503 });
  if (req.headers.get('x-key') !== key) return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const skus = [...new Set((body.skus || []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (!skus.length) return NextResponse.json({ ok: false, error: 'ไม่มี SKU' }, { status: 400 });
  if (skus.length > 20000) return NextResponse.json({ ok: false, error: 'SKU เยอะเกิน' }, { status: 400 });

  try {
    const { prices, fileAt } = await loadPrices();
    const price = {}, full = {};
    let inDc = 0, discounted = 0;
    for (const s of skus) {
      const e = prices.get(s);
      const p = e ? e.sale || e.full : null;
      if (!p) { price[s] = null; continue; }
      inDc++;
      if (e.sale && e.full && e.sale < e.full) discounted++;
      price[s] = p;
      full[s] = e.full || p;
    }
    return NextResponse.json({ ok: true, dc_file_at: fileAt, counts: { asked: skus.length, in_dc: inDc, discounted }, price, full });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'อ่านไฟล์ DC ไม่สำเร็จ: ' + String(e.message || e) }, { status: 500 });
  }
}
