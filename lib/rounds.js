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

// ── ตาราง SKU ของรอบ ─────────────────────────────────────────────
// ไซส์ยึด ST ของ Seniorsoft (ไซส์ท้ายชื่อ = ไซส์บนป้ายสินค้า) เพราะไซส์บนแพลตฟอร์มลงไว้ไม่เหมือนกัน
//   "UK7/EU40.5/255" · "XL [เอว30-37" · "JMเด็ก" · TikTok ตัวเลือกชั้นเดียวมีแต่ไซส์ล้วน
// สียึดตัวเลือกบนแพลตฟอร์ม (ตัดชั้นไซส์ออก) เพราะคือสิ่งที่ลูกค้าเลือกในตะกร้า เช่น "สีดำ-ขาปล่อย"
// SKU ไม่มีใน ST (ร้านลงรหัสไม่ตรง) → เดาไซส์จากแพลตฟอร์ม แล้วติดป้าย inSt=false ให้เห็น

export const normSku = (s) => String(s || '').trim().toLowerCase();

// ไซส์ท้ายชื่อใน ST คั่นด้วย " - " (ต้องมีช่องว่างหน้าขีด ไม่งั้น "Spin-X" จะได้ไซส์ X)
export const stSize = (name) => /\s-\s*([^-]{1,6})$/.exec(String(name || '').trim())?.[1].trim() || '';

// ชื่อรุ่นใน ST = ตัดไซส์ท้ายชื่อ แล้วตัดตั้งแต่คำว่า " สี" (แบบที่ scan จับกลุ่มรุ่น) — สั้นกว่าชื่อตะกร้ามาก
// "กางเกงวอร์ม Fly Hawk b516 สีดำ B - S" → "กางเกงวอร์ม Fly Hawk b516"
export const stModel = (name) =>
  String(name || '').trim().replace(/\s-\s*[^-]{1,6}$/, '').replace(/\sสี.*$/, '').trim();

// คอลัมน์ไซส์ — ตัวพิมพ์เล็กใหญ่/ช่องว่าง/จุดไม่สน · nL = nXL (Warrix XL 2L 3L, Flyhawk XL XXL 4L) · XXL = 2XL
export function sizeKey(z) {
  const u = String(z || '').toUpperCase().replace(/[\s.]/g, '');
  if (u === 'XXL') return '2XL';
  if (u === 'XXXL') return '3XL';
  const l = /^(\d+)L$/.exec(u);
  return l && Number(l[1]) >= 2 ? `${l[1]}XL` : u;
}

// ลำดับไซส์ (ยกแนวคิดจาก sc2004stock/scan/lib/lookup.js): เลข → ไซส์เด็ก J → SS XS S M L XL 2XL 3XL… → อื่นๆ
const LETTERS = ['5S', '4S', '3S', '2S', 'SS', 'XXS', '2XS', 'XS', 'S', 'M', 'L', 'XL'];
const letterRank = (u) => {
  const i = LETTERS.indexOf(u);
  if (i >= 0) return i;
  const x = /^(\d+)XL$/.exec(u);
  return x ? LETTERS.length + Number(x[1]) : -1;
};
const sizeRank = (z) => {
  const u = sizeKey(z);
  if (/^\d+(\.\d+)?$/.test(u)) return [0, parseFloat(u)];
  const j = /^J(.+)$/.exec(u);
  if (j && letterRank(j[1]) >= 0) return [1, letterRank(j[1])];
  const r = letterRank(u);
  return r >= 0 ? [2, r] : [3, 0];
};
export function compareSizes(a, b) {
  const [ga, va] = sizeRank(a), [gb, vb] = sizeRank(b);
  return ga - gb || va - vb || String(a).localeCompare(String(b));
}

// ข้อความนี้ขึ้นต้นด้วยไซส์นั้นไหม — "JMเด็ก" ขึ้นต้นด้วย JM · "SILVER" ไม่ได้ขึ้นต้นด้วย S
const startsWithSize = (text, size) => {
  const t = String(text).toUpperCase().replace(/\s/g, '');
  const z = String(size).toUpperCase().replace(/\s/g, '');
  return !!z && t.startsWith(z) && !/[A-Z0-9]/.test(t[z.length] || '');
};
const looksLikeSize = (t) => /^(J?(\d?X{0,3}[SML]|SS|XS)|\d+(\.\d+)?L?|OSF[A-Z]?)(?![A-Z0-9])/i.test(String(t).replace(/\s/g, ''));
const cleanTier = (x) => String(x).replace(/^[^:]*:/, '').trim();   // Lazada "Color family:Black"

// ตัวเลือกบนแพลตฟอร์ม → { color, size }  ชั้นสุดท้ายคือไซส์ (สี, ไซส์) · ชั้นเดียวอาจเป็นสีหรือไซส์ก็ได้
function fromVariant(variant, stZ) {
  // ตัดชั้นที่จุลภาคนอกวงเล็บเท่านั้น — FBT "ดำ, XL [เอว30-37, ยาว20]" มีจุลภาคในวงเล็บ
  const tiers = String(variant || '').split(/,(?![^[(]*[\])])/).map(cleanTier).filter(Boolean);
  if (tiers.length >= 2) {
    const last = tiers[tiers.length - 1];
    return { color: tiers.slice(0, -1).join(', '), size: last.split(/[\s[(]/)[0] };
  }
  const t = tiers[0] || '';
  const isSize = stZ ? startsWithSize(t, stZ) : looksLikeSize(t);
  return isSize ? { color: '', size: t.split(/[\s[(]/)[0].replace(/[^\x20-\x7e]+$/, '') } : { color: t, size: '' };
}

// ชนิดสินค้า — หมวดใน ST ก่อน ไม่มีค่อยดูชื่อตะกร้า (ไซส์เลขไม่ได้แปลว่ารองเท้า: กางเกงเด็ก 4-12 ถุงมือ 4-11)
function itemKind(cat, name) {
  const s = cat || name || '';
  if (/รองเท้า|สตั๊ด/.test(s)) return 'shoe';
  if (/เสื้อ|กางเกง|ชุด|แจ็ค|แจ๊ค|เลกกิ้ง|กระโปรง|บรา/.test(s)) return 'cloth';
  return 'other';
}

// รหัสรุ่น+สี = SKU ตัดไซส์ท้ายออก (b516BS → b516B · F35543-7 → F35543)
function skuCode(sku, size) {
  const s = String(sku || '');
  const z = String(size || '').replace(/\s/g, '');
  const cut = z && s.toLowerCase().endsWith(z.toLowerCase()) ? s.slice(0, -z.length) : s;
  return cut.replace(/[-_\s]+$/, '') || s;
}

// รวมชิ้นตาม SKU ของทั้งรอบ — ใช้ทั้งแบบแถว (คัดลอกไปชีต / เทียบ Seniorsoft) และเป็นวัตถุดิบของ pivotSizes
// st = Map(normSku → { name, cat }) จาก os_st · เรียงตาม SKU ไม่มี SKU ไว้ท้าย
export function sumSkus(orders, st = new Map()) {
  const m = new Map();
  for (const o of orders) {
    for (const it of o.os_order_items || []) {
      const sku = it.sku || '';
      const k = sku ? normSku(sku) : `name:${it.product_name || ''}|${it.variant || ''}`;
      let row = m.get(k);
      if (!row) {
        const rec = sku ? st.get(normSku(sku)) : null;
        const stZ = rec ? stSize(rec.name) : '';
        const v = fromVariant(it.variant, stZ);
        const size = rec ? stZ : v.size;
        row = {
          sku, name: it.product_name || '', color: v.color, size,
          kind: itemKind(rec?.cat, it.product_name), code: skuCode(sku, size), inSt: !!rec, stName: rec?.name || '', qty: 0,
        };
        m.set(k, row);
      }
      row.qty += Number(it.qty) || 0;
    }
  }
  return [...m.values()].sort((a, b) =>
    !a.sku - !b.sku || a.sku.localeCompare(b.sku, 'en', { sensitivity: 'base', numeric: true }) || a.name.localeCompare(b.name));
}

// ── แบบตารางไซส์ (เหมือนแท็บ SCS ST23 ในชีต) ส่งให้คนจัดของ ──────────────
// แถว = ตะกร้า + สี (Flyhawk ที่ ST สะกด "Fly hawk"/"Fly Hawk" ปนกัน หรือ FBT ที่ ST แยกรหัสตามช่วงไซส์ ก็ยังเป็นแถวเดียว)
// คอลัมน์ = ไซส์ที่มีในตารางนั้น · แยกตารางตามชนิด และรองเท้าแยกตามหน่วยไซส์ไม่ให้ตารางกว้างเกิน
//   UK/US = เลข < 20 (Adidas 3-13) · EU = 20-99 และไซส์คู่ของแตะ 3536 · ซม. = 100 ขึ้นไป (Mizuno 225-300)
export const SIZE_TABLES = [
  { key: 'shoe-uk', title: 'รองเท้า · ไซส์ UK/US' },
  { key: 'shoe-eu', title: 'รองเท้า · ไซส์ EU' },
  { key: 'shoe-cm', title: 'รองเท้า · ไซส์ ซม.' },
  { key: 'cloth', title: 'เสื้อผ้า' },
  { key: 'other', title: 'อื่นๆ' },
];
function tableOf(r) {
  if (r.kind !== 'shoe') return r.kind;
  const n = parseFloat(r.size);
  if (Number.isNaN(n) || /^\d{4}$/.test(r.size) || (n >= 20 && n < 100)) return 'shoe-eu';
  return n < 20 ? 'shoe-uk' : 'shoe-cm';
}
const loose = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
// หัวคอลัมน์บอกทุกชื่อที่รวมไว้ "XXL/2XL/2L" — แบบตัวอักษรก่อน แบบเลขทีหลัง
const labelRank = (z) => (/^X+L$/.test(z) ? 0 : /^\d+XL$/.test(z) ? 1 : 2);

export function pivotSizes(rows) {
  const groups = new Map();
  const labels = new Map();   // table|sizeKey → Set(ไซส์ตามที่เขียน)
  for (const r of rows) {
    const table = tableOf(r);
    const k = `${table}|${loose(r.name)}|${loose(r.color)}`;
    const g = groups.get(k) || { table, basket: r.name, color: r.color, models: new Map(), codes: [], cells: {}, total: 0, notInSt: false };
    const model = stModel(r.stName);
    if (model) g.models.set(model, (g.models.get(model) || 0) + 1);
    if (r.code && !g.codes.includes(r.code)) g.codes.push(r.code);
    if (r.size) {
      const z = sizeKey(r.size);
      g.cells[z] = (g.cells[z] || 0) + r.qty;
      const lk = `${table}|${z}`;
      if (!labels.has(lk)) labels.set(lk, new Set());
      labels.get(lk).add(String(r.size).toUpperCase().replace(/[\s.]/g, ''));
    }
    g.total += r.qty;
    if (!r.inSt) g.notInSt = true;
    groups.set(k, g);
  }
  // ชื่อที่โชว์ = ชื่อรุ่นใน ST ที่เจอบ่อยสุดในแถว (ST สะกดไม่เหมือนกันทุกไซส์ "Fly hawk"/"Fly Hawk")
  // แถวหนึ่งอาจมีหลายรหัสรุ่น (FBT 20724 / 22724) ช่องรหัสบอกครบ · ไม่มีใน ST เลยใช้ชื่อตะกร้า
  for (const g of groups.values()) {
    g.name = [...g.models].sort((a, b) => b[1] - a[1])[0]?.[0] || g.basket;
    delete g.models;
  }
  return SIZE_TABLES.map((t) => {
    const list = [...groups.values()].filter((g) => g.table === t.key)
      .sort((a, b) => a.name.localeCompare(b.name, 'th') || a.color.localeCompare(b.color, 'th'));
    const keys = [...new Set(list.flatMap((g) => Object.keys(g.cells)))].sort(compareSizes);
    const sizes = keys.map((z) => ({
      key: z,
      label: [...labels.get(`${t.key}|${z}`)].sort((a, b) => labelRank(a) - labelRank(b) || a.localeCompare(b)).join('/'),
    }));
    return { key: t.key, title: t.title, sizes, rows: list.map(({ table, ...g }) => g) };
  }).filter((t) => t.rows.length);
}
