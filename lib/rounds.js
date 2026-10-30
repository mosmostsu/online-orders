// รอบจัดส่ง — จับกลุ่มออเดอร์จากเวลาที่ร้านกดจัดส่ง (rts_at) แทนการ export รีพอร์ตไปวางในชีตทุกรอบตัด
//
// รอบตามเวลาตัดของร้าน (08:00 / 12:00 / 14:00 — ดู CLAUDE.md) ตัดด้วยเวลากดส่งตามเวลาไทย
//   รอบ 1 = ก่อน 12:00 · รอบ 2 = 12:00-13:59 · รอบ 3 = 14:00 ขึ้นไป
// กดส่งนอกช่วงปกติ (เช่น 10:30, 15:00) ก็ยังลงรอบตามนี้ ไม่หาย

export const ROUND_CUTS = [12 * 60, 14 * 60];   // นาทีของวันที่เริ่มรอบ 2 / รอบ 3

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

// เลขรอบของเวลากดส่ง (1-3) ตามเวลาไทย
export function roundNo(rts) {
  const d = new Date(Date.parse(rts) + TH_OFFSET);
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return 1 + ROUND_CUTS.filter((c) => min >= c).length;
}

// orders = [{ platform, shop, status, rts_at, ... }] ของวันเดียว
// คืน [{ n, from, to, shops: [{ key, platform, shop, from, to, orders, cancelled }] }]
//   รอบเรียง 1-2-3 · ร้านในรอบเรียงตามเวลาเริ่มกดส่ง · from/to = เวลากดส่งจริงแรก/สุดท้าย
// ใบที่ยกเลิกหลังกดส่งแยกไว้ใน cancelled ไม่นับในยอด
export function splitRounds(orders) {
  const rounds = new Map();
  const sorted = orders.filter((o) => o.rts_at).sort((a, b) => Date.parse(a.rts_at) - Date.parse(b.rts_at));
  for (const o of sorted) {
    const n = roundNo(o.rts_at);
    if (!rounds.has(n)) rounds.set(n, { n, from: o.rts_at, to: o.rts_at, shops: new Map() });
    const r = rounds.get(n);
    r.to = o.rts_at;
    const k = `${o.platform}:${o.shop}`;
    if (!r.shops.has(k)) r.shops.set(k, { key: k, platform: o.platform, shop: o.shop, from: o.rts_at, to: o.rts_at, orders: [], cancelled: [] });
    const s = r.shops.get(k);
    s.to = o.rts_at;
    (o.status === 'cancelled' ? s.cancelled : s.orders).push(o);
  }
  // เรียงตามเวลาแล้ว ร้านจึงเข้า Map ตามลำดับเวลาเริ่มกดส่ง
  return [...rounds.values()].sort((a, b) => a.n - b.n).map((r) => ({ ...r, shops: [...r.shops.values()] }));
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

// สีในชื่อ ST = ตั้งแต่คำว่า "สี" ถึงก่อนไซส์ (ส่วนที่ stModel ตัดทิ้ง)
export const stColor = (name) =>
  /\s(สี.*)$/.exec(String(name || '').trim().replace(/\s-\s*[^-]{1,6}$/, ''))?.[1].trim() || '';

// คอลัมน์ไซส์ — ไม่สนตัวพิมพ์เล็กใหญ่/ช่องว่าง/จุด ("xl" "X L" "XL." = XL) · XXL กับ 2XL คือไซส์เดียวกันเขียนต่างกัน → รวม
// ไซส์ต่างระบบไม่รวม: แต่ละยี่ห้อเทียบไม่เหมือนกัน (Warrix XL 2L 3L · Flyhawk 3L = 2XL) รวมแล้วคนจัดหยิบผิด
export const sizeKey = (z) => {
  const u = String(z || '').toUpperCase().replace(/[\s.]/g, '');
  return u === 'XXL' ? '2XL' : u;
};
const SIZE_LABEL = { '2XL': 'XXL/2XL' };

// ลำดับไซส์ (แนวเดียวกับ sc2004stock/scan/lib/lookup.js):
//   เลข → ไซส์เด็ก J → SS XS S M L XL XXL 2XL XXXL 3XL 4XL… → 2L 3L 4L… → อื่นๆ (OSFM ฯลฯ)
const LETTERS = ['5S', '4S', '3S', '2S', 'SS', 'XXS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXXL', '3XL'];
const letterRank = (u) => {
  const i = LETTERS.indexOf(u);
  if (i >= 0) return i;
  const x = /^(\d+)XL$/.exec(u);
  if (x) return LETTERS.length + Number(x[1]);
  const l = /^(\d+)L$/.exec(u);
  return l ? 100 + Number(l[1]) : -1;
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
// หรือมีไซส์เป็นท่อนหนึ่งของข้อความ — Mizuno "US8/EUR40.5/260" มี 260 อยู่ท้าย
const startsWithSize = (text, size) => {
  const t = String(text).toUpperCase().replace(/\s/g, '');
  const z = String(size).toUpperCase().replace(/\s/g, '');
  if (!z) return false;
  if (t.startsWith(z) && !/[A-Z0-9]/.test(t[z.length] || '')) return true;
  return t.split(/[/|,]/).includes(z);
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

// เสื้อผ้าแยกกลุ่มตามหมวดใน ST (ไม่มีใน ST ดูชื่อตะกร้า) — คนจัดหยิบจากคนละชั้นวาง
// เสื้อวอร์ม เป็นเสื้อ ไม่ใช่กางเกงวอร์ม → เช็คเสื้อก่อน
function clothGroup(cat, name) {
  const s = cat || name || '';
  if (/เสื้อ|แจ็ค|แจ๊ค/.test(s)) return 'top';
  if (/วอร์ม|วอม/.test(s)) return 'warm';
  if (/แทรคสูท|ผ้าร่ม.*ขายาว/.test(s)) return 'track';   // ร้านเก็บผ้าร่มขายาวไว้กับแทรคสูท
  if (/ขาสั้น|กางเกงกีฬา|กางเกงฟุตบอล/.test(s)) return 'shorts';
  if (/กางเกง/.test(s)) return 'pants';
  return 'cloth';
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
        // ตัวเลือกมีแต่ไซส์ (TikTok ชั้นเดียว) → เอาสีจากชื่อใน ST "… b516 สีดำ B - S" → "สีดำ B"
        const color = v.color || (rec ? stColor(rec.name) : '');
        row = {
          sku, name: it.product_name || '', color, size,
          kind: itemKind(rec?.cat, it.product_name), group: clothGroup(rec?.cat, it.product_name), code: skuCode(sku, size), inSt: !!rec, stName: rec?.name || '', qty: 0,
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
// คอลัมน์ = ไซส์ที่มีในตารางนั้น · แยกตารางตามชนิด รองเท้าแยกตามหน่วยไซส์ เสื้อผ้าแยกตามกลุ่มชั้นวาง ไม่ให้ตารางกว้าง/ปนจนงง
//   UK/US = เลข < 20 (Adidas 3-13) · EU = 20-99 และไซส์คู่ของแตะ 3536 · ซม. = 100 ขึ้นไป (Mizuno 225-300)
// ซม. → EU ของ Mizuno (ยกจาก sc2004stock/scan/lib/shoesize.js) ไว้เขียนกำกับใต้หัวคอลัมน์ — คนจัดเห็นแค่ 260 แล้วงง
const MIZUNO_CM_TO_EU = { 180: '28', 185: '29', 190: '30', 195: '31', 200: '32', 205: '33', 210: '34', 215: '34.5', 220: '35', 225: '36', 230: '37', 235: '37.5', 240: '38', 245: '39', 250: '39.5', 255: '40', 260: '40.5', 265: '41', 270: '42', 275: '42.5', 280: '43', 285: '44', 290: '44.5', 295: '45', 300: '46' };

export const SIZE_TABLES = [
  { key: 'shoe-uk', title: 'รองเท้า · ไซส์ UK/US' },
  { key: 'shoe-eu', title: 'รองเท้า · ไซส์ EU' },
  { key: 'shoe-cm', title: 'รองเท้า · ไซส์ ซม.' },
  // เสื้อผ้าแยกตามกลุ่ม · ไซส์เด็กอยู่ตารางเดียวกับผู้ใหญ่ (มีแค่กางเกงวอร์ม) คอลัมน์เรียง เลข → J… → SS S M…
  // กางเกงวอร์มตะกร้าหลัก (มีไซส์เด็ก) รวมไว้ตารางเดียว เรียงตะกร้าตาม WARM_MAIN · ที่เหลือแยกอีกตาราง
  { key: 'warm-main', title: 'กางเกงวอร์ม · b516/b517 · 06253/06254 · 06251/06252 · FBT · ขาวล้วน' },
  { key: 'warm', title: 'กางเกงวอร์มอื่นๆ' },
  { key: 'track', title: 'กางเกงแทรคสูท · ผ้าร่มขายาว' },
  { key: 'shorts', title: 'กางเกงขาสั้น' },
  { key: 'pants', title: 'กางเกงอื่นๆ' },
  { key: 'top', title: 'เสื้อ' },
  { key: 'cloth', title: 'เสื้อผ้าอื่นๆ' },
  { key: 'other', title: 'อื่นๆ' },
];
// กางเกงวอร์มตะกร้าหลัก (มีไซส์เด็ก) — [ลำดับที่โชว์ในตาราง, เงื่อนไข] เช็คตามลำดับในลิสต์ เจอข้อแรกจบ
// ขาวล้วนเป็นตะกร้ารวม FBT + Grand Sport สีขาว จึงเช็คก่อน ไม่งั้นหลุดไปตะกร้า FBT · แต่โชว์ท้ายสุด
const WARM_MAIN = [
  [4, (r) => /ขาวล้วน/.test(r.name) || (/FBT|Grand\s*Sport/i.test(r.stName) && /^(สี)?ขาว$/.test(stColor(r.stName)))],
  [0, (r) => /^bc?51[67]/i.test(r.sku)],                 // Flyhawk b516 / b517 (+ ไซส์เด็ก bc)
  [1, (r) => /^0625[34]/.test(r.sku)],                   // Grand Sport 06253 / 06254
  [2, (r) => /^0625[12]/.test(r.sku)],                   // Grand Sport 06251 / 06252
  [3, (r) => /FBT/i.test(r.stName || r.name)],            // วอร์ม FBT
];
const warmOrder = (r) => WARM_MAIN.find(([, hit]) => hit(r))?.[0] ?? -1;

function tableOf(r) {
  if (r.kind === 'cloth') return r.group === 'warm' && warmOrder(r) >= 0 ? 'warm-main' : r.group;
  if (r.kind !== 'shoe') return r.kind;
  const n = parseFloat(r.size);
  if (Number.isNaN(n) || /^\d{4}$/.test(r.size) || (n >= 20 && n < 100)) return 'shoe-eu';
  return n < 20 ? 'shoe-uk' : 'shoe-cm';
}
const loose = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// สีหลักขึ้นก่อนตามลำดับที่ร้านใช้ (แบบเดียวกับ scan) แล้วสีอื่นตามตัวอักษร — "สีดำ-ขาปล่อย" "ดำแดง" นับเป็นดำ
const FIRST_COLORS = ['ดำ', 'กรม', 'เทา', 'ขาว', 'น้ำเงิน'];
const colorRank = (c) => {
  const i = FIRST_COLORS.findIndex((x) => String(c).includes(x));
  return i >= 0 ? i : FIRST_COLORS.length;
};
// แถวของตะกร้าเดียวกันอยู่ติดกัน (ตะกร้าเรียงตามชื่อรุ่น) ในตะกร้าเรียงสี
// first / last = แถวแรก / สุดท้ายของตะกร้า ไว้ขีดเส้นเข้มแบ่งตะกร้า
function sortByBasket(list) {
  const byBasket = new Map();
  for (const g of list) {
    const k = loose(g.basket);
    if (!byBasket.has(k)) byBasket.set(k, []);
    byBasket.get(k).push(g);
  }
  const th = (a, b) => a.localeCompare(b, 'th');
  const baskets = [...byBasket.values()].map((rows) => rows.sort((a, b) =>
    colorRank(a.color) - colorRank(b.color) || th(a.color, b.color) || th(a.name, b.name)));
  // ตะกร้าเรียงตาม order (ลำดับตะกร้าหลักของกางเกงวอร์ม · ตารางอื่นเป็น 0 หมด) แล้วตามชื่อรุ่น
  const first = (rows) => rows.map((g) => g.name).sort(th)[0];
  const ord = (rows) => Math.min(...rows.map((g) => g.order));
  baskets.sort((a, b) => ord(a) - ord(b) || th(first(a), first(b)));
  return baskets.flatMap((rows) => rows.map((g, i) => ({ ...g, first: i === 0, last: i === rows.length - 1 })));
}

export function pivotSizes(rows) {
  const groups = new Map();
  for (const r of rows) {
    const table = tableOf(r);
    const k = `${table}|${loose(r.name)}|${loose(r.color)}`;
    const g = groups.get(k) || { table, order: table === 'warm-main' ? warmOrder(r) : 0, basket: r.name, color: r.color, models: new Map(), codes: [], cells: {}, total: 0, notInSt: false };
    const model = stModel(r.stName);
    if (model) g.models.set(model, (g.models.get(model) || 0) + 1);
    if (r.code && !g.codes.includes(r.code)) g.codes.push(r.code);
    if (r.size) {
      const z = sizeKey(r.size);
      g.cells[z] = (g.cells[z] || 0) + r.qty;
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
    const list = sortByBasket([...groups.values()].filter((g) => g.table === t.key));
    const keys = [...new Set(list.flatMap((g) => Object.keys(g.cells)))].sort(compareSizes);
    const sizes = keys.map((z) => (t.key === 'shoe-cm' && MIZUNO_CM_TO_EU[z]
      ? { key: z, label: z, note: `EU${MIZUNO_CM_TO_EU[z]}` } : { key: z, label: SIZE_LABEL[z] || z }));
    return { key: t.key, title: t.title, sizes, rows: list.map(({ table, order, ...g }) => g) };
  }).filter((t) => t.rows.length);
}
