// รอบจัดส่ง — จับกลุ่มออเดอร์จากเวลาที่ร้านกดจัดส่ง (rts_at) แทนการ export รีพอร์ตไปวางในชีตทุกรอบตัด
//
// ร้านกดส่งเป็นชุดๆ ตอนตัดรอบ (แต่ละร้านไม่พร้อมกัน วันหนึ่ง 1-2 รอบ) จึงไม่ตั้งเวลารอบตายตัว
// เรียงตามเวลากดส่งของแต่ละร้าน ห่างจากใบก่อนหน้าเกิน ROUND_GAP_MIN = เริ่มรอบใหม่

export const ROUND_GAP_MIN = 45;

const TH_OFFSET = 7 * 3600000;

// วันที่ตามเวลาไทย 'YYYY-MM-DD' — เซิร์ฟเวอร์เป็น UTC ตัดวันตรงๆ จะเพี้ยนช่วงตี 0-7
export function thaiDay(d = new Date()) {
  return new Date(d.getTime() + TH_OFFSET).toISOString().slice(0, 10);
}

// ช่วงเวลาของวันนั้น (เที่ยงคืนถึงเที่ยงคืนเวลาไทย) เป็น ISO สำหรับถามฐานข้อมูล
export function dayRange(day) {
  const from = Date.parse(`${day}T00:00:00+07:00`);
  return { from: new Date(from).toISOString(), to: new Date(from + 86400000).toISOString() };
}

export function shiftDay(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

// orders = [{ platform, shop, status, rts_at, ... }] ของวันเดียว
// คืน [{ key, platform, shop, n, from, to, orders, cancelled }] เรียงตามเวลาเริ่มรอบ
// ใบที่ยกเลิกหลังกดส่งยังใช้ต่อรอบ (เพราะถูกกดพร้อมเพื่อน) แต่แยกไว้ใน cancelled ไม่นับในยอด
export function splitRounds(orders, gapMin = ROUND_GAP_MIN) {
  const byShop = new Map();
  for (const o of orders) {
    if (!o.rts_at) continue;
    const k = `${o.platform}:${o.shop}`;
    if (!byShop.has(k)) byShop.set(k, []);
    byShop.get(k).push(o);
  }

  const rounds = [];
  for (const [k, list] of byShop) {
    list.sort((a, b) => Date.parse(a.rts_at) - Date.parse(b.rts_at));
    let cur = null;
    for (const o of list) {
      if (!cur || Date.parse(o.rts_at) - Date.parse(cur.to) > gapMin * 60000) {
        const n = (cur?.n || 0) + 1;
        cur = { key: `${k}:${n}`, platform: o.platform, shop: o.shop, n, from: o.rts_at, to: o.rts_at, orders: [], cancelled: [] };
        rounds.push(cur);
      }
      cur.to = o.rts_at;
      (o.status === 'cancelled' ? cur.cancelled : cur.orders).push(o);
    }
  }
  return rounds.sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
}

// รวมชิ้นตาม SKU ของทั้งรอบ — ตัวเดียวกับที่ใช้เทียบกับ Seniorsoft
// ไม่มี SKU (ร้านลงไม่ครบ) ใช้ชื่อสินค้าแยกกลุ่มแทน จะได้ไม่หายไปจากยอด
export function sumSkus(orders) {
  const m = new Map();
  for (const o of orders) {
    for (const it of o.os_order_items || []) {
      const sku = it.sku || '';
      const k = sku || `name:${it.product_name || ''}`;
      const row = m.get(k) || { sku, name: it.product_name || '', qty: 0 };
      row.qty += Number(it.qty) || 0;
      m.set(k, row);
    }
  }
  return [...m.values()].sort((a, b) => b.qty - a.qty || a.sku.localeCompare(b.sku));
}
