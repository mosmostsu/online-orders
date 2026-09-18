// ต้นทุนจากบิลรับของใน Seniorsoft — ไฟล์รายเดือนที่ samchai invoice เผยแพร่ไว้
//
//   https://samchaiinvoice.netlify.app/ss/seniorsoft-2569-09.js
//   เนื้อไฟล์: var SS_MONTH = [{ ref, tranno, date, supplier, scancode, itemname,
//                               qty, price, discount, amount, grandtotal, total, totalvat }, ...];
//
// ชื่อไฟล์ใช้ปี พ.ศ. · เดือนที่ยังไม่มีไฟล์ Netlify จะตอบหน้าเว็บ (HTML) กลับมาแทน ไม่ใช่ 404
// จึงต้องเช็คเนื้อไฟล์ ไม่ใช่แค่สถานะ
import { db } from './supabase.js';

const BASE = process.env.SS_COST_BASE || 'https://samchaiinvoice.netlify.app/ss';
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
  const res = await fetch(`${BASE}/seniorsoft-${month}.js`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  const txt = await res.text();
  if (!txt.startsWith('var SS_MONTH')) return null;   // เดือนที่ยังไม่มีไฟล์ = ได้หน้าเว็บกลับมา
  return JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
}

// รวมบรรทัดบิลหลายเดือน → ทุนล่าสุดต่อรหัส
// ข้ามบรรทัดที่จำนวน/ยอดเป็นศูนย์หรือติดลบ (ของแถม คืนของ) ไม่งั้นทุนจะกลายเป็นศูนย์
export function latestCosts(lines) {
  const best = new Map();
  for (const l of lines) {
    const code = String(l.scancode || '').trim();
    const qty = Number(l.qty) || 0;
    const amount = Number(l.amount) || 0;
    if (!code || qty <= 0 || amount <= 0) continue;
    const key = code.toLowerCase();
    const prev = best.get(key);
    if (!prev || l.date >= prev.bill_date) {
      best.set(key, {
        sku_key: key,
        sku: code,
        item_name: l.itemname || null,
        unit_cost: Math.round((amount / qty) * 100) / 100,
        list_price: Number(l.price) || null,
        discount: l.discount || null,
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
