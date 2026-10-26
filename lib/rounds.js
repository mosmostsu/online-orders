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

// ชื่อตัวเลือก → สี / ไซส์ แบบคอลัมน์ในชีต "tiktok SCS order"
//   Shopee "WP-สีขาวชมพู,41" · TikTok "กรม, L" · Lazada "Color family:Black, Size:L"
// ตัดที่จุลภาคตัวสุดท้าย (ไซส์อยู่ท้ายเสมอ) ไม่มีจุลภาค = ทั้งก้อนเป็นสี
export function splitVariant(v) {
  const s = String(v || '').trim();
  const i = s.lastIndexOf(',');
  const clean = (x) => x.replace(/^[^:]*:/, '').trim();
  return i < 0 ? { color: clean(s), size: '' } : { color: clean(s.slice(0, i)), size: clean(s.slice(i + 1)) };
}

// รวมชิ้นตาม SKU ของทั้งรอบ — ตัวเดียวกับที่ใช้เทียบกับ Seniorsoft
// เรียงตาม SKU แบบชีต (รุ่นเดียวกันอยู่ติดกัน หยิบของง่าย) ไม่สนตัวพิมพ์เล็กใหญ่
// ไม่มี SKU (ร้านลงไม่ครบ) ใช้ชื่อสินค้าแยกกลุ่มแทน จะได้ไม่หายไปจากยอด — ไว้ท้ายตาราง
export function sumSkus(orders) {
  const m = new Map();
  for (const o of orders) {
    for (const it of o.os_order_items || []) {
      const sku = it.sku || '';
      const k = sku || `name:${it.product_name || ''}|${it.variant || ''}`;
      const row = m.get(k) || { sku, name: it.product_name || '', ...splitVariant(it.variant), qty: 0 };
      row.qty += Number(it.qty) || 0;
      m.set(k, row);
    }
  }
  return [...m.values()].sort((a, b) =>
    !a.sku - !b.sku || a.sku.localeCompare(b.sku, 'en', { sensitivity: 'base', numeric: true }) || a.name.localeCompare(b.name));
}

// ไซส์ตัวอักษรเรียงตามขนาดจริง ไม่ใช่ตามตัวอักษร (ไม่งั้น L มาก่อน M)
const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', 'XXXL', '4XL', '5XL', '6XL'];
const sizeRank = (s) => {
  const i = LETTER_SIZES.indexOf(String(s).toUpperCase());   // เช็คก่อน — "2XL" ขึ้นต้นด้วยเลขแต่ไม่ใช่ไซส์ตัวเลข
  if (i >= 0) return [1, i];
  const n = parseFloat(s);
  return /^\d/.test(s) && !Number.isNaN(n) ? [0, n] : [2, 0];
};
export function compareSizes(a, b) {
  const [ga, va] = sizeRank(a), [gb, vb] = sizeRank(b);
  return ga - gb || va - vb || String(a).localeCompare(String(b));
}

// ส่วนต้นที่ทุก SKU มีร่วมกัน = รหัสรุ่น+สี (bk4BK37, bk4BK38 → bk4BK) ไว้โชว์ใต้ชื่อในตารางไซส์
function commonPrefix(skus) {
  if (!skus.length) return '';
  let p = skus[0];
  for (const s of skus) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}

// แบบตารางไซส์ (เหมือนแท็บ SCS ST23 ในชีต) — แถว = ชื่อสินค้า+สี · คอลัมน์ = ไซส์ที่มีในรอบนั้น
// แยกเป็นตารางตามชนิดไซส์ ไม่งั้นรองเท้า 37-45 กับเสื้อผ้า S-2XL มาต่อกันจนตารางกว้างเกิน
//   shoe  = ไซส์เลข (และไซส์แปลกๆ เช่น UK7/EU40.5/255 ซึ่งเป็นรองเท้าทั้งนั้น)
//   cloth = ไซส์ตัวอักษร S M L XL ...
//   none  = ไม่มีไซส์ (หมวก กระเป๋า) มีแต่ยอดรวม
// rows มาจาก sumSkus (เรียงตาม SKU แล้ว) แถวจึงเรียงตามลำดับที่เจอครั้งแรก รุ่นเดียวกันยังอยู่ติดกัน
export const SIZE_TABLES = [
  { key: 'shoe', title: 'รองเท้า · ไซส์เลข' },
  { key: 'cloth', title: 'เสื้อผ้า · ไซส์ S-XL' },
  { key: 'none', title: 'ไม่มีไซส์' },
];
const sizeKind = (size) => (!size ? 'none' : sizeRank(size)[0] === 1 ? 'cloth' : 'shoe');

export function pivotSizes(rows) {
  const groups = new Map();
  for (const r of rows) {
    // แถวเดียวกันแต่ไซส์คนละชนิด (ลงตัวเลือกไว้ปนกัน) แยกไปอยู่ตารางของชนิดนั้น
    const kind = sizeKind(r.size);
    const k = `${kind}|${r.name}|${r.color}`;
    const g = groups.get(k) || { kind, name: r.name, color: r.color, skus: [], cells: {}, total: 0 };
    if (r.sku) g.skus.push(r.sku);
    if (r.size) g.cells[r.size] = (g.cells[r.size] || 0) + r.qty;
    g.total += r.qty;
    groups.set(k, g);
  }
  return SIZE_TABLES.map((t) => {
    const list = [...groups.values()].filter((g) => g.kind === t.key);
    const sizes = [...new Set(list.flatMap((g) => Object.keys(g.cells)))].sort(compareSizes);
    const out = list.map(({ kind, ...g }) => ({ ...g, code: commonPrefix(g.skus) }));
    return { ...t, sizes, rows: out };
  }).filter((t) => t.rows.length);
}
