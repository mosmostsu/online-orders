// หน้า /allsite แท็บ "ตามบิล" — บิลรับของล่าสุด 30 วัน ของในบิลลงขายร้านไหนแล้วบ้าง
//
// บิลมาจากไฟล์รายเดือนที่ samchai invoice เผยแพร่ (ตัวเดียวกับที่ใช้คิดต้นทุน ดู lib/costs.js)
// เทียบ scancode ในบิลกับ os_st_on (seller_sku ทุกร้าน แบบ lower(trim) — ดู supabase/036)
// ไม่ต้องมีตารางใหม่ ไม่ต้องรัน SQL เพิ่ม
import { fetchMonth, recentMonths } from './costs.js';
import { db } from './supabase.js';

export const BILL_DAYS = 30;
const CHUNK = 300;   // รหัสต่อคำขอ .in() — ยาวกว่านี้ลิงก์คำขอยาวเกิน

const lkey = (s) => String(s || '').trim().toLowerCase();
// ชื่อซัพพลายเออร์ใน Seniorsoft ยาวมาก ตัดคำนำหน้า/ท้ายออกให้พอดีแถว
const shortSupplier = (s) => String(s || '')
  .replace(/^บริษัท\s*/, '').replace(/\s*จำกัด.*$/, '').replace(/\s*\(สำนักงานใหญ่\)\s*$/, '').trim() || '—';

// วันที่ (YYYY-MM-DD) ย้อนไป n วันตามเวลาไทย
function sinceDate(days) {
  const t = new Date(Date.now() + 7 * 3600000 - days * 86400000);
  return t.toISOString().slice(0, 10);
}

// บรรทัดบิลหลายเดือน → แถวละบิล รหัสซ้ำในบิลเดียวกันรวมจำนวน
// ข้ามบรรทัดที่ไม่มีรหัสหรือจำนวน ≤ 0 (คืนของ/ของแถมติดลบ)
export function groupBills(lines, since) {
  const bills = new Map();
  for (const l of lines) {
    if (!l.date || l.date < since) continue;
    const code = String(l.scancode || '').trim();
    const qty = Number(l.qty) || 0;
    if (!code || qty <= 0) continue;
    const id = l.tranno || `${l.date}|${l.supplier}|${l.ref}`;
    let b = bills.get(id);
    if (!b) {
      b = { id, tranno: l.tranno || '', ref: l.ref || '', date: l.date, supplier: shortSupplier(l.supplier), items: new Map() };
      bills.set(id, b);
    }
    const k = lkey(code);
    const it = b.items.get(k);
    if (it) it.qty += qty;
    else b.items.set(k, { sku: code, name: l.itemname || '', qty });
  }
  return [...bills.values()]
    .map((b) => ({ ...b, items: [...b.items.values()].sort((x, y) => x.sku.localeCompare(y.sku)) }))
    .sort((a, b) => (b.date.localeCompare(a.date) || b.tranno.localeCompare(a.tranno)));
}

// ทุกอย่างที่หน้าใช้ — ไม่ขึ้นกับร้านที่เลือก (กรองร้านทีหลังในหน้า) จะได้จำผลไว้ชุดเดียว
//   bills: [{ id, tranno, ref, date, supplier, items: [{ sku, name, qty, st, on: ['shopee:SOLID', ...] }] }]
export async function loadBills(days = BILL_DAYS) {
  const since = sinceDate(days);
  // 30 วันย้อนหลังคร่อมได้มากสุด 2 เดือน · ไฟล์เดือนที่ยังไม่มี = null (ปกติ) อ่านพัง = แจ้ง error
  const months = recentMonths(2);
  const errors = [];
  const files = await Promise.all(months.map((m) => fetchMonth(m).catch((e) => { errors.push(e.message); return null; })));
  const bills = groupBills(files.flatMap((f) => f || []), since);

  const codes = [...new Set(bills.flatMap((b) => b.items.map((it) => it.sku)))];
  const lcodes = [...new Set(codes.map(lkey))];
  const sb = db();
  const chunks = (arr) => Array.from({ length: Math.ceil(arr.length / CHUNK) }, (_, i) => arr.slice(i * CHUNK, (i + 1) * CHUNK));

  const [onRes, stRes] = await Promise.all([
    Promise.all(chunks(lcodes).map((c) => sb.from('os_st_on').select('lsku, platform, shop').in('lsku', c))),
    // คงเหลือปัจจุบันจากไฟล์ ST — รหัสในบิลกับใน ST มาจาก Seniorsoft เหมือนกัน ตัวพิมพ์ตรงกัน
    Promise.all(chunks(codes).map((c) => sb.from('os_st').select('sku, qty').in('sku', c))),
  ]);
  const on = new Map();
  for (const r of onRes) {
    if (r.error) throw new Error('อ่าน os_st_on ไม่ได้: ' + r.error.message);
    for (const x of r.data || []) {
      if (!on.has(x.lsku)) on.set(x.lsku, []);
      on.get(x.lsku).push(`${x.platform}:${x.shop}`);
    }
  }
  const st = new Map();
  for (const r of stRes) {
    if (r.error) throw new Error('อ่าน os_st ไม่ได้: ' + r.error.message);
    for (const x of r.data || []) st.set(lkey(x.sku), Number(x.qty) || 0);
  }

  for (const b of bills) {
    for (const it of b.items) {
      const k = lkey(it.sku);
      it.on = on.get(k) || [];
      it.st = st.has(k) ? st.get(k) : null;
    }
  }
  return { bills, since, months, errors, loaded_at: new Date().toISOString() };
}

// สถานะบิลเทียบกับร้านที่เลือก (หรือร้านเดียวถ้า focus) — ตรรกะเดียวกับมุมมองรุ่น+สี
//   complete = ทุกร้านลงครบทุกรหัส · none = ไม่มีร้านไหนลงสักรหัส · partial = ที่เหลือ
export function billState(b, shopKeys) {
  const n = b.items.length;
  const per = shopKeys.map((k) => b.items.filter((it) => it.on.includes(k)).length);
  const min = Math.min(...per), max = Math.max(...per);
  return { per, n, state: min === n ? 'complete' : max === 0 ? 'none' : 'partial' };
}
