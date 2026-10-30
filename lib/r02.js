// รีพอร์ต R02.102 ของ Seniorsoft (ความเคลื่อนไหวสินค้า) → รายการที่ "ยิงออก" ไว้เช็คกับใบจัดของ (app/round)
// แทนแท็บ SNS + สรุป ในชีต "tiktok SCS order" — อ่านในเบราว์เซอร์ ไม่ส่งไฟล์ขึ้นเซิร์ฟเวอร์
// ใช้แค่ใบขาย OSVS ที่ตัดสต็อก (CF_FSTOCKMAIN = -1) ของช่องทางออนไลน์ · เงินสด / ไทยฟินเทค ไม่นับ
// กฎอ่านไฟล์แนวเดียวกับ sc2004stock/report-r02102.js
import { readZip } from './xlsxPatch.js';
import { normSku as norm } from './rounds.js';   // ไม่สนตัวพิมพ์ / เลข 0 นำหน้า

// ชื่อลูกค้า (CF_PERSON_FNAME) → แพลตฟอร์ม · ไม่ตรงอันไหน = ไม่นับ
export function r02Platform(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('tiktok')) return 'tiktok';
  if (s.includes('shopee')) return 'shopee';
  if (s.includes('lazada')) return 'lazada';
  if (s.includes('thisshop')) return 'thisshop';
  return null;
}

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
    out.push({ doc, at: serialToIso(x.TRANDATE), platform, sku: String(x.CF_ITEMID ?? '').trim(), name: String(x.CF_ITEMNAME ?? ''), qty });
  }
  return out;
}


// ใบยิงออกแต่ละใบลงรอบไหน — รอบล่าสุดของแพลตฟอร์มนั้นที่เริ่มปริ้น/กดส่งก่อนเวลายิง
// (ยิงหลังจัดของเสร็จเสมอ) ยิงก่อนรอบแรกเริ่ม = รอบแรก · คืน Map(`${n}|${platform}` → lines)
export function assignSns(rounds, lines) {
  const out = new Map();
  for (const l of lines) {
    const cands = rounds
      .map((r) => ({ n: r.n, from: r.shops.filter((s) => s.platform === l.platform).map((s) => s.from).sort()[0] }))
      .filter((c) => c.from);
    if (!cands.length) continue;
    const hit = [...cands].reverse().find((c) => Date.parse(c.from) <= Date.parse(l.at)) || cands[0];
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
    const x = sns.get(k) || { sku: l.sku, name: l.name, qty: 0 };
    x.qty += l.qty;
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
