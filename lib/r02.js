// รีพอร์ต R02.102 ของ Seniorsoft (ความเคลื่อนไหวสินค้า) → รายการที่ "ยิงออก" ไว้เช็คกับใบจัดของ (app/round)
// แทนแท็บ SNS + สรุป ในชีต "tiktok SCS order" — อ่านในเบราว์เซอร์ ไม่ส่งไฟล์ขึ้นเซิร์ฟเวอร์
// ใช้แค่ใบขาย OSVS ที่ตัดสต็อก (CF_FSTOCKMAIN = -1) ของช่องทางออนไลน์ · เงินสด (หน้าร้าน) ไม่นับ
// กฎอ่านไฟล์แนวเดียวกับ sc2004stock/report-r02102.js
import { readZip } from './xlsxPatch.js';
import { normSku as norm } from './rounds.js';   // ไม่สนตัวพิมพ์ / เลข 0 นำหน้า

// ชื่อลูกค้า (CF_PERSON_FNAME) → แพลตฟอร์ม · ไม่ตรงอันไหน = ไม่นับ
// เงินสด (หน้าร้าน) = 'cash' — ไม่นับเข้ารอบไหน แต่เก็บไว้ เผื่อออเดอร์ออนไลน์ถูกยิงเป็นเงินสด (เลือกย้ายเองทีละตัว/ทีละใบ)
export function r02Platform(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('tiktok')) return 'tiktok';
  if (s.includes('shopee')) return 'shopee';
  if (s.includes('lazada')) return 'lazada';
  // เว็บ ThisShop รับเงินผ่าน "ไทย ฟินเทค จำกัด" — ใบขายของ ThisShop ใน Seniorsoft จึงลงชื่อลูกค้านี้
  if (s.includes('thisshop') || s.includes('ฟินเทค')) return 'thisshop';
  if (s.includes('เงินสด')) return CASH;
  return null;
}

export const CASH = 'cash';

// TRANDATE เป็น serial ของ Excel ตามเวลาไทย → ISO
export const serialToIso = (v) => new Date(Math.round((Number(v) - 25569) * 86400000) - 7 * 3600000).toISOString();

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIdx = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

// xlsx (ชีตแรก) → array ของ object ตามหัวคอลัมน์แถวแรก
export async function readSheetRows(bytes) {
  const zip = readZip(bytes);
  const get = (name) => zip.entries.find((e) => e.name === name);
  const ss = get('xl/sharedStrings.xml');
  const strings = ss
    ? [...(await zip.text(ss)).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))
    : [];
  const sheet = get('xl/worksheets/sheet1.xml') || zip.entries.find((e) => /^xl\/worksheets\/sheet\d*\.xml$/.test(e.name));
  if (!sheet) throw new Error('ไม่พบชีตในไฟล์');
  const xml = await zip.text(sheet);
  const grid = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+\d+)"/.exec(c[1])?.[1];
      const type = /t="(\w+)"/.exec(c[1])?.[1];
      const body = c[2] || '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = null;
      if (type === 's') val = strings[Number(v)] ?? null;
      else if (type === 'inlineStr') val = unxml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      else if (type === 'str') val = v != null ? unxml(v) : null;
      else if (v != null) val = Number(v);
      row[ref ? colIdx(ref) : row.length] = val;
    }
    grid.push(row);
  }
  const head = (grid[0] || []).map((h) => String(h ?? '').trim());
  return grid.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? null])));
}

// แถวของ R02.102 → [{ doc, at, platform, sku, name, qty }]
export function parseR02(rows) {
  const out = [];
  for (const x of rows) {
    const doc = String(x.CF_TRANNO || '');
    if (!doc.startsWith('OSVS') || Number(x.CF_FSTOCKMAIN) !== -1) continue;
    const platform = r02Platform(x.CF_PERSON_FNAME);
    const qty = Math.trunc(Math.abs(Number(x.CF_TDBASEQUANTITY) || 0));
    if (!platform || !qty || typeof x.TRANDATE !== 'number') continue;
    out.push({ doc, at: serialToIso(x.TRANDATE), platform, cust: String(x.CF_PERSON_FNAME ?? ''), sku: String(x.CF_ITEMID ?? '').trim(), name: String(x.CF_ITEMNAME ?? ''), qty });
  }
  return out;
}


// ใบยิงออกแต่ละใบลงรอบไหน — รอบล่าสุดของแพลตฟอร์มนั้นที่เริ่มปริ้น/กดส่งก่อนเวลายิง
// (ยิงหลังจัดของเสร็จเสมอ) ยิงก่อนรอบแรกเริ่ม = รอบแรก · คืน Map(`${n}|${platform}` → lines)
// ยกเว้น ANY_TIME ด้านล่าง
// แพลตฟอร์มที่ไม่ดูเวลายิง — ThisShop ยิงตอนไหนก็ได้ทั้งวัน ใบยิงทั้งวันรวมไว้ที่ `*|thisshop`
// (หน้าเช็คเทียบแต่ละรอบกับใบยิงทั้งวัน โดยหักออเดอร์ ThisShop ของรอบอื่นออกก่อน)
export const ANY_TIME = new Set(['thisshop']);

export function assignSns(rounds, lines) {
  const out = new Map();
  for (const l of lines) {
    if (ANY_TIME.has(l.platform)) {
      const k = `*|${l.platform}`;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(l);
      continue;
    }
    const cands = rounds
      .map((r) => ({ n: r.n, from: r.shops.filter((s) => s.platform === l.platform).map((s) => s.from).sort()[0] }))
      .filter((c) => c.from);
    if (!cands.length) continue;
    const hit = (l.round && cands.find((c) => c.n === l.round)) || [...cands].reverse().find((c) => Date.parse(c.from) <= Date.parse(l.at)) || cands[0];
    const k = `${hit.n}|${l.platform}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(l);
  }
  return out;
}

// เทียบใบจัดของร้านหนึ่งกับที่ยิงออก
//   rows = sumSkus ของร้านนี้ · others = ร้านอื่นของแพลตฟอร์มเดียวกันในรอบเดียวกัน [{ sku, qty }]
//   (Seniorsoft ไม่แยกร้าน Shopee — ยอดที่ยิงของ SKU เดียวกันจึงหักส่วนของร้านอื่นออกก่อน)
// คืน { rows: [...rows + sns], extra: [{ sku, name, qty }] (ยิงแต่ไม่มีในใบจัดของร้านไหนเลย), bad, snsTotal }
export function compareSns(rows, others, lines) {
  const sns = new Map();
  for (const l of lines) {
    const k = norm(l.sku);
    const x = sns.get(k) || { sku: l.sku, name: l.name, qty: 0, docs: [] };
    x.qty += l.qty;
    if (l.doc && !x.docs.includes(l.doc)) x.docs.push(l.doc);
    sns.set(k, x);
  }
  const other = new Map();
  for (const o of others) other.set(norm(o.sku), (other.get(norm(o.sku)) || 0) + o.qty);
  const mine = new Set(rows.map((r) => norm(r.sku)));
  const out = rows.map((r) => ({ ...r, sns: Math.max(0, (sns.get(norm(r.sku))?.qty || 0) - (other.get(norm(r.sku)) || 0)) }));
  const extra = [...sns.entries()].filter(([k]) => !mine.has(k) && !other.has(k)).map(([, v]) => v);
  return {
    rows: out,
    extra,
    bad: out.filter((r) => r.sns !== r.qty).length + extra.length,
    snsTotal: out.reduce((n, r) => n + r.sns, 0) + extra.reduce((n, e) => n + e.qty, 0),
  };
}

// ยิงพลาด (เช่น ยิงออเดอร์ Shopee เข้าลูกค้า "Tiktok shop") — คนเลือกเองทีละใบว่าใบนั้นนับเป็นแพลตฟอร์มไหน
// และ/หรือบังคับลงรอบไหน (ยิงช้า/ยิงก่อนเวลา) · ใบที่ไม่ได้เลือกใช้ตามชื่อลูกค้า + เวลายิง
// fix = { [เลขใบ]: 'skip' | 'แพลตฟอร์ม' | 'แพลตฟอร์ม|รอบ' | '|รอบ' } (แพลตฟอร์มว่าง = ตามชื่อลูกค้า)
export const fixParts = (f = '') => { const [p, r] = String(f).split('|'); return { p: p || '', r: r ? Number(r) : null }; };
// แก้ทีละตัวในใบ (เช่น ของรอบ 2 หาเจอทีหลัง ยิงปนในใบรอบ 3): key = lineFixKey(ใบ, sku) ใช้ก่อนแก้ทั้งใบ
export const lineFixKey = (doc, sku) => `${doc}#${norm(sku)}`;
export function applyDocFix(lines, fix = {}) {
  return lines.flatMap((l) => {
    const f = fix[lineFixKey(l.doc, l.sku)] || fix[l.doc];
    if (!f) return [l];
    if (f === 'skip') return [];
    const { p, r } = fixParts(f);
    return [{ ...l, platform: p || l.platform, ...(r ? { round: r } : {}) }];
  });
}

// สรุปทีละใบ (ไว้โชว์รายการใบให้เลือกแก้) [{ doc, at, cust, platform, qty, lines }] เรียงตามเวลา
export function docsOf(lines) {
  const m = new Map();
  for (const l of lines) {
    const d = m.get(l.doc) || { doc: l.doc, at: l.at, cust: l.cust || '', platform: l.platform, qty: 0, lines: 0 };
    d.qty += l.qty;
    d.lines += 1;
    m.set(l.doc, d);
  }
  return [...m.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// ส่งของแทน (เปลี่ยนสี/ไซส์ให้ลูกค้า) — ยิงออกเป็น SKU อื่น แต่ให้นับแทน SKU ในใบจัดของ
// subs = [{ n, platform, from, to, qty }] · ย้าย qty ชิ้นของ from ไปนับเป็น to (เฉพาะใบยิงของรอบ n ช่องทางนั้น)
export function applySubs(lines, subs = []) {
  if (!subs.length) return lines;
  const out = lines.map((l) => ({ ...l }));
  for (const s of subs) {
    let left = s.qty;
    for (const l of out) {
      if (!left) break;
      if (norm(l.sku) !== norm(s.from) || !l.qty) continue;
      const take = Math.min(left, l.qty);
      l.qty -= take;
      left -= take;
    }
    const got = s.qty - left;
    if (got) out.push({ doc: '', at: '', platform: s.platform, sku: s.to, name: `ส่งแทนด้วย ${s.from}`, qty: got });
  }
  return out.filter((l) => l.qty > 0);
}

// แถวของตาราง os_round_r02 (supabase/065) → ค่าที่หน้า /round ใช้ { file, at, lines, fix, merge, subs, updated_at }
export const r02FromRow = (row) => (row ? {
  file: row.file, at: row.uploaded_at, lines: row.lines || [], fix: row.fix || {},
  merge: row.merge || {}, subs: row.subs || [], updated_at: row.updated_at,
} : null);
