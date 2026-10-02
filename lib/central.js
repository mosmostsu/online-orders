// ไฟล์กลาง (ST/DC/BC) จาก Firebase Storage — ท่อเดียวกับ samchai2004.com/lib/central.js และ scan-stock
// Colab อัป ST (สต็อก Seniorsoft) ขึ้น central/ST.json ทุกรอบตัด เป็น JSON ที่ข้างในเป็น gzip+base64
import zlib from 'node:zlib';

export const CENTRAL_BUCKET = 'samchai-checkstock.firebasestorage.app';

const metaUrl = (key) =>
  `https://firebasestorage.googleapis.com/v0/b/${CENTRAL_BUCKET}/o/central%2F${key}.json`;

// อ่านเฉพาะ metadata (เล็ก เร็ว) — ไว้เช็คว่าไฟล์อัปเดตหรือยัง โดยไม่ต้องโหลดทั้งก้อน
export async function fetchCentralMeta(key) {
  const meta = await (await fetch(metaUrl(key), { cache: 'no-store' })).json();
  if (!meta.downloadTokens) throw new Error(`ไม่พบไฟล์ ${key} ในส่วนกลาง`);
  return {
    key,
    token: meta.downloadTokens.split(',')[0],
    updated: meta.updated ?? null,
    fileModified: Number(meta.metadata?.fileModified) || null,
  };
}

// โหลด + คลาย gzip → rows (array ของ object ตามหัวคอลัมน์ของ Seniorsoft เช่น cf_itemid)
export async function fetchCentralRows(key, meta) {
  const m = meta ?? (await fetchCentralMeta(key));
  const payload = await (await fetch(`${metaUrl(key)}?alt=media&token=${m.token}`, { cache: 'no-store' })).json();
  const raw = zlib.gunzipSync(Buffer.from(payload.dataGz, 'base64')).toString('utf8');
  payload.dataGz = null;
  // บางทีมี NaN/Infinity (cell ตัวเลขว่าง) ซึ่งไม่ใช่ JSON ที่ถูกต้อง — ลอง parse ตรงๆ ก่อน
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/:\s*NaN/g, ':null').replace(/:\s*-?Infinity/g, ':null'));
  }
}

// ชื่อรุ่น+สี = ชื่อสินค้าตัดไซส์ท้ายออก — "รองเท้า ... GY9048 สีขาวส้ม - 7" → "รองเท้า ... GY9048 สีขาวส้ม"
// ไซส์ท้ายชื่อใน Seniorsoft คั่นด้วย " - " และสั้น (7, 11.5, XL, 2XL, 4L) ตัดได้ไม่เกิน 6 ตัวอักษร
// ไม่มีไซส์ท้ายชื่อ = กลุ่มเดียวของตัวเอง
export const groupNameOf = (name) => String(name || '').replace(/\s*-\s*[^-]{1,6}$/, '').trim();

export function normalizeStRow(r, now) {
  const sku = String(r.cf_itemid ?? '').trim();
  if (!sku) return null;
  const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    sku,
    name: r.cf_itemname ?? null,
    group_name: groupNameOf(r.cf_itemname) || sku,
    brand: r.cf_itemgroupl1_groupname ?? null,
    cat: r.cf_itemgroupl2_groupname ?? null,
    qty: num(r.cf_quantity),
    price: num(r.cf_itempricelevel_price ?? r.cf_price),
    synced_at: now,
  };
}
