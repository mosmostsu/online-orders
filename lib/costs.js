// ต้นทุนจากบิลรับของใน Seniorsoft (R04.201) — ไฟล์รายเดือนบน Firebase ส่วนกลาง
//
//   https://samchaiinvoice.netlify.app/central/ap/2569-09.json   (proxy ของ samchai invoice → central/ap_2569-09.json)
//   เนื้อไฟล์: { fileName, fileModified, savedAt, dataGz }
//     dataGz = base64 ของ gzip ของ [{ ref, tranno, date, supplier, scancode, itemname,
//                                     qty, price, discount, amount, grandtotal, total, totalvat }, ...]
//
// ผู้ใช้อัปไฟล์ R04.201 เองที่ sc2004stock.netlify.app/status.html (ตั้งแต่ 22 ต.ค. 69)
// เดิมอ่าน /ss/seniorsoft-<เดือน>.js ซึ่งหยุดอัปเดตแล้ว บิลเลยค้างอยู่ 16 ต.ค.
// ชื่อไฟล์ใช้ปี พ.ศ. · เดือนที่ยังไม่มีไฟล์ = 404
import { gunzipSync } from 'node:zlib';
import { db } from './supabase.js';

const BASE = process.env.SS_AP_BASE || 'https://samchaiinvoice.netlify.app/central/ap';
const FIRST_MONTH = '2568-01';   // ไฟล์แรกที่มี

// รายชื่อเดือน (พ.ศ.) ตั้งแต่ from ถึงเดือนปัจจุบัน
export function monthsUntilNow(from = FIRST_MONTH) {
  const now = new Date(Date.now() + 7 * 3600000);   // เดือนตามเวลาไทย
  let [y, m] = from.split('-').map(Number);
  const endY = now.getUTCFullYear() + 543;
  const endM = now.getUTCMonth() + 1;
  const out = [];
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// เดือนล่าสุด n เดือน (รวมเดือนนี้) — รอบรายวันดูแค่นี้พอ บิลเก่ากว่านั้นไม่ใช่ทุนล่าสุดอยู่แล้ว
export function recentMonths(n = 2) {
  return monthsUntilNow().slice(-n);
}

export async function fetchMonth(month) {
  // ไม่ให้ fetch ของ Next จำผลไว้ — ที่จำอยู่แล้วคือ unstable_cache ของหน้า (ล้างได้ด้วย tag)
  const res = await fetch(`${BASE}/${month}.json`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return null;   // เดือนที่ยังไม่มีไฟล์
  // สถานะอื่นที่ไม่ใช่ 200 = ส่วนกลางมีปัญหา ต้องรายงาน ไม่ใช่ทำเป็นไม่มีบิล
  if (!res.ok) throw new Error(`อ่านไฟล์ ${month} ไม่ได้: HTTP ${res.status}`);
  try {
    const { dataGz } = await res.json();
    return JSON.parse(gunzipSync(Buffer.from(dataGz, 'base64')).toString('utf8'));
  } catch (e) {
    throw new Error(`อ่านไฟล์ ${month} ไม่ได้: ${e.message}`);
  }
}

const billKey = (l) => `${l.date}|${l.supplier}|${l.ref}`;

// ส่วนลดท้ายบิลที่ไม่ได้ลงมาถึงรายบรรทัด — กู้คืนจากยอดรวมของบิลเอง
//
// บางใบทุกบรรทัดมีช่องส่วนลดว่าง และ amount เป็นราคาเต็ม แต่ grandtotal ท้ายบิล
// เป็นยอดหลังลดจริง ทุนจึงออกมาเท่าราคาป้าย (เสื้อวอร์ม GS ขึ้นทุน 655 เท่าที่ขาย
// หน้าเว็บเลยโชว์ขาดทุน −35% ทั้งที่จริงกำไร) อัตราที่หายไปอ่านได้จากบิลนั้นเอง:
//
//     grandtotal / ผลรวม amount ของทุกบรรทัดในใบเดียวกัน
//
// ไม่เดาอัตราเอง ไม่ยืมอัตราจากบิลใบอื่น และแตะเฉพาะใบที่ไม่มีส่วนลดรายบรรทัดเลย
// สักบรรทัด — ไล่ของจริง 14 เดือน 1,765 ใบ เข้าเงื่อนไขแค่ 3 ใบ (GS 43% · KSL 34.56%
// · WARRIX 33.87%) ส่วนใบที่ไม่ได้ลดจริงอัตราจะออกมา 1.000 พอดีจึงไม่โดนแตะ
export function billDiscountFactors(lines) {
  const bills = new Map();
  for (const l of lines) {
    const amount = Number(l.amount) || 0;
    if (!l.ref || amount <= 0) continue;
    const k = billKey(l);
    let b = bills.get(k);
    if (!b) { b = { sum: 0, grand: Number(l.grandtotal) || 0, hasLineDiscount: false }; bills.set(k, b); }
    b.sum += amount;
    if (String(l.discount || '').trim()) b.hasLineDiscount = true;
  }

  const out = new Map();
  for (const [k, b] of bills) {
    if (b.hasLineDiscount || !b.grand || !b.sum) continue;
    const ratio = b.grand / b.sum;
    // ≥ 0.98 คือใบที่ไม่ได้ลดจริง (ปกติได้ 1.000 บางใบ 1.07 เพราะ grandtotal รวม VAT)
    // < 0.2 เพี้ยนเกินกว่าจะเชื่อว่าเป็นส่วนลด ปล่อยไว้ตามเดิมดีกว่าแก้มั่ว
    if (ratio >= 0.98 || ratio < 0.2) continue;
    out.set(k, ratio);
  }
  return out;
}

// รวมบรรทัดบิลหลายเดือน → ทุนล่าสุดต่อรหัส
// ข้ามบรรทัดที่จำนวน/ยอดเป็นศูนย์หรือติดลบ (ของแถม คืนของ) ไม่งั้นทุนจะกลายเป็นศูนย์
export function latestCosts(lines) {
  const factors = billDiscountFactors(lines);
  const best = new Map();
  for (const l of lines) {
    const code = String(l.scancode || '').trim();
    const qty = Number(l.qty) || 0;
    const amount = Number(l.amount) || 0;
    if (!code || qty <= 0 || amount <= 0) continue;
    const key = code.toLowerCase();
    const prev = best.get(key);
    if (!prev || l.date >= prev.bill_date) {
      const factor = factors.get(billKey(l));
      best.set(key, {
        sku_key: key,
        sku: code,
        item_name: l.itemname || null,
        unit_cost: Math.round(((amount * (factor ?? 1)) / qty) * 100) / 100,
        list_price: Number(l.price) || null,
        // เขียนให้เห็นว่าอัตรานี้มาจากยอดท้ายบิล ไม่ใช่ช่องส่วนลดที่ซัพพลายเออร์ลงไว้
        discount: factor ? `${((1 - factor) * 100).toFixed(2)}/ (กู้จากยอดท้ายบิล)` : (l.discount || null),
        bill_date: l.date,
        supplier: l.supplier || null,
        tranno: l.tranno || null,
        synced_at: new Date().toISOString(),
      });
    }
  }
  return [...best.values()];
}

// ไม่ยอมให้บิลเก่าทับบิลใหม่ — upsert เขียนทับตรงๆ ไม่ได้ดูวันที่
// ถ้าดึงเดือนเก่าซ้ำ (เช่นเดือนที่ตกหล่นตอนเติมย้อนหลัง) ทุนล่าสุดจะถอยกลับไปเป็นทุนเก่า
export async function saveCosts(rows) {
  const sb = db();
  const have = new Map();
  const keys = rows.map((r) => r.sku_key);
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await sb.from('os_costs').select('sku_key, bill_date').in('sku_key', keys.slice(i, i + 200));
    if (error) throw new Error('อ่านต้นทุนเดิมไม่สำเร็จ: ' + error.message);
    for (const d of data || []) have.set(d.sku_key, d.bill_date);
  }
  const fresh = rows.filter((r) => !have.has(r.sku_key) || r.bill_date >= have.get(r.sku_key));

  let n = 0;
  for (let i = 0; i < fresh.length; i += 1000) {
    const chunk = fresh.slice(i, i + 1000);
    const { error } = await db().from('os_costs').upsert(chunk, { onConflict: 'sku_key' });
    if (error) throw new Error('บันทึกต้นทุนไม่สำเร็จ: ' + error.message);
    n += chunk.length;
  }
  return n;
}
