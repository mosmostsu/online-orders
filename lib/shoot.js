// หน้าถ่ายฟุต (/shoot) — ตรรกะล้วน ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์ · รัน test: node --test lib/shoot.test.mjs

// ชิ้นละ 8 MiB — Drive บังคับให้ทุกชิ้น (ยกเว้นชิ้นสุดท้าย) เป็นจำนวนเท่าของ 256 KiB
export const CHUNK = 8 * 1024 * 1024;
export const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB ต่อไฟล์ — กันเลือกไฟล์ผิด

// ตัดอักขระที่ใช้ในชื่อไฟล์ Windows/Drive ไม่ได้ + เว้นวรรคซ้ำ
export const safeName = (s, max = 60) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();

const EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp', 'video/x-matroska': 'mkv' };
export function extOf(fileName, mime) {
  const m = /\.([a-z0-9]{2,4})$/i.exec(String(fileName || ''));
  if (m) return m[1].toLowerCase();
  return EXT[String(mime || '').toLowerCase()] || 'mp4';
}

// ชื่อไฟล์ที่อัปขึ้น Drive: วันที่_สินค้า_ช็อต01_คำอธิบายช็อต.mp4 — คนตัดรู้ทันทีว่าเป็นช็อตไหนโดยไม่ต้องเปิดดู
// stamp (HHMMSS) กันชื่อซ้ำเมื่อถ่ายช็อตเดิมหลายเทค
export function shotFileName({ date, product, index, shot, ext = 'mp4', stamp = '' }) {
  const n = String(Number(index) + 1).padStart(2, '0');
  const parts = [date, safeName(product, 50), `ช็อต${n}`, safeName(shot, 40)].filter(Boolean);
  return `${parts.join('_')}${stamp ? `_${stamp}` : ''}.${ext}`;
}

// ช่วงไบต์ของแต่ละชิ้น [{start, end}] (end รวมปลาย) — ไฟล์ 0 ไบต์ = ไม่มีชิ้น
export function chunkRanges(size, chunk = CHUNK) {
  const out = [];
  for (let start = 0; start < size; start += chunk) out.push({ start, end: Math.min(start + chunk, size) - 1 });
  return out;
}

// หัว Range ที่ Drive ตอบตอน 308 ("bytes=0-8388607") → ไบต์ถัดไปที่ต้องส่ง · อ่านไม่ได้ = null
export function nextOffset(rangeHeader) {
  const m = /bytes=0-(\d+)/.exec(String(rangeHeader || ''));
  return m ? Number(m[1]) + 1 : null;
}

// ติ๊กช็อตที่อัปเสร็จ → { got, done } · done = ครบทุกช็อต
export function afterShot(shoot, index) {
  const shots = shoot.shots || [];
  const got = shots.map((_, i) => Boolean((shoot.got || [])[i]) || i === index);
  return { got, done: shots.length > 0 && got.every(Boolean) };
}

export const shotsLeft = (shoot) => (shoot.shots || []).filter((_, i) => !(shoot.got || [])[i]).length;
