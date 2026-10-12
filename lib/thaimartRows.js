// โมเดลสินค้ากลาง → แถวไฟล์นำเข้า Thaimart (seller.thaimart.com → นำเข้าสินค้า) — ฟังก์ชันล้วน ทดสอบในเบราว์เซอร์ได้
//
// กติกาที่เจอจริงของ import (ดู memory thaimart-listing-import — ไม่ได้เขียนไว้ในเทมเพลต):
//   1 ไฟล์ = 1 หมวด · ≤500 แถว · 1 แถว = 1 ตัวเลือก ต้องกรอกข้อมูลสินค้าซ้ำทุกแถว
//   ต้องมีครบทุกคู่ สี×ไซส์ ไม่งั้นปฏิเสธทั้งไฟล์ ("ตัวเลือกสินค้าไม่ถูกต้อง") → เติมคู่ที่ขาดด้วยจำนวน 0
//   ค่า/ชื่อตัวเลือก ≤20 ตัวอักษร · คำอธิบายห้ามว่าง · ชื่อสินค้า ≥15 และ <255 · รูปใช้ URL ได้ (Thaimart ดึงไปเก็บเอง)
//
// คอลัมน์ A–X (ข้อมูลเริ่มแถว 5):
//   A หมวด · B ชื่อ · C คำอธิบาย · D–L รูป 1–9 · M SKU · N ชื่อตัวเลือกหลัก · O ค่า · P รูปของค่า ·
//   Q ชื่อตัวเลือกรอง · R ค่า · S น้ำหนัก g · T ยาว · U กว้าง · V สูง cm · W ราคา · X จำนวน
import { htmlToText, cleanTitle, shortenValues } from './productModel.js';

export const MAX_ROWS = 500;

// หมวดปลายทาง (ตรงกับ TEMPLATES ใน thaimartTemplates.js) จากชื่อหมวดของต้นทาง
//   fitness/ตกปลา ยังไม่มีเทมเพลต → คืน 'fitness' ให้ผู้เรียกข้ามพร้อมบอกเหตุผล
export function thaimartCategory(chain) {
  const s = (chain || []).join(' / ');
  if (/เชือกกระโดด|เสื่อกีฬา|อุปกรณ์ออกกำลังกาย|ฟิตเนส|โยคะ|ดัมเบล|ลู่วิ่ง/.test(s)) return 'fitness';
  if (/ตกปลา|เบ็ด/.test(s)) return 'fishing';
  if (/รองเท้า|เสื้อ|กางเกง|จ็อกเกอร์|เจอร์ซีย์|สลิปเปอร์|ชุดกีฬา|แจ็กเก็ต|ฮู้ด/.test(s)) return 'shoes';
  return 'balls';   // ลูกบอล ถุงเท้า ถุงมือ อุปกรณ์ป้องกัน กระเป๋า ไม้แบด เทป ฯลฯ
}

const int = (n, min = 0) => Math.max(min, Math.round(Number(n) || 0));

// คืน { rows: [[24 ค่า]], warnings: [], skipped: 'เหตุผล' | null }
//   stockBySku: Map(sku ตัวเล็ก → จำนวน Seniorsoft) — ไม่มีรหัสนั้นใช้จำนวนจากต้นทาง
export function buildThaimartRows(product, { categoryPath, stockBySku = new Map() }) {
  const warnings = [];
  const variants = (product.variants || []).filter((v) => v);
  if (!variants.length) return { rows: [], warnings, skipped: 'ไม่มีตัวเลือก (SKU) เลย' };
  const images = (product.images || []).slice(0, 9);
  if (!images.length) return { rows: [], warnings, skipped: 'ไม่มีรูปสินค้า' };

  let title = cleanTitle(product.title) || String(product.title || '').trim();
  if (title.length >= 255) { title = title.slice(0, 250); warnings.push('ชื่อยาวเกิน ตัดเหลือ 250 ตัวอักษร'); }
  if (title.length < 15) { title = `${title} ${product.categoryChain?.slice(-1)[0] || ''}`.trim(); warnings.push('ชื่อสั้นกว่า 15 ตัวอักษร ต่อชื่อหมวดให้'); }
  const description = htmlToText(product.descriptionHtml) || title;

  const weight = int(product.weightG, 1);
  const L = int(Math.ceil(product.dims?.l), 1);
  const W = int(Math.ceil(product.dims?.w), 1);
  const H = int(Math.ceil(product.dims?.h), 1);

  // ชั้นตัวเลือก: 0 / 1 / 2 ชั้น (Thaimart รองรับสูงสุด 2)
  const depth = Math.max(0, ...variants.map((v) => (v.options || []).length));
  if (depth > 2) warnings.push(`ต้นทางมี ${depth} ชั้นตัวเลือก — ใช้แค่ 2 ชั้นแรก`);
  const name1 = depth >= 1 ? String(variants[0].options[0]?.name || 'ตัวเลือก').slice(0, 20) : 'ตัวเลือก';
  const name2 = depth >= 2 ? String(variants[0].options[1]?.name || 'ขนาด').slice(0, 20) : '';

  const val = (v, i) => String(v.options?.[i]?.value ?? '').trim();
  const v1raw = [...new Set(variants.map((v) => (depth >= 1 ? val(v, 0) : 'มาตรฐาน')))];
  const v2raw = depth >= 2 ? [...new Set(variants.map((v) => val(v, 1)))] : [];
  const short1 = shortenValues(v1raw);
  const short2 = shortenValues(v2raw);

  // รูปของค่าตัวเลือกหลัก = รูปแรกที่เจอของค่านั้น (ไม่มี → ว่าง)
  const img1 = new Map();
  for (const v of variants) {
    const k = depth >= 1 ? val(v, 0) : 'มาตรฐาน';
    if (!img1.has(k) && v.options?.[0]?.image) img1.set(k, v.options[0].image);
  }

  const key = (a, b) => `${a}\u0001${b}`;
  const byPair = new Map();
  for (const v of variants) {
    const k = key(depth >= 1 ? val(v, 0) : 'มาตรฐาน', depth >= 2 ? val(v, 1) : '');
    if (!byPair.has(k)) byPair.set(k, v);
  }

  const rows = [];
  let filled = 0;
  const list2 = depth >= 2 ? v2raw : [''];
  for (const a of v1raw) {
    const firstOfA = variants.find((v) => (depth >= 1 ? val(v, 0) : 'มาตรฐาน') === a);
    for (const b of list2) {
      let v = byPair.get(key(a, b));
      let qty;
      let sku = '';
      if (v) {
        sku = v.sku;
        qty = sku && stockBySku.has(sku.toLowerCase()) ? stockBySku.get(sku.toLowerCase()) : v.qty;
      } else {
        v = firstOfA;     // คู่ที่ขาด — เติมให้ครบ (จำนวน 0) ราคาเท่าตัวแรกของสีนั้น
        qty = 0;
        filled += 1;
      }
      rows.push([
        categoryPath, title, description,
        images[0], images[1] || '', images[2] || '', images[3] || '', images[4] || '',
        images[5] || '', images[6] || '', images[7] || '', images[8] || '',
        sku,
        name1, short1.get(a) ?? a, img1.get(a) || '',
        name2, depth >= 2 ? (short2.get(b) ?? b) : '',
        weight, L, W, H,
        int(v.price), int(qty),
      ]);
    }
  }
  if (filled) warnings.push(`เติมคู่ตัวเลือกที่ขาด ${filled} แถว (จำนวน 0)`);
  const bad = rows.filter((r) => !(r[22] > 0));
  if (bad.length) warnings.push(`${bad.length} แถวราคา 0 — ตรวจก่อนอัปโหลด`);
  return { rows, warnings, skipped: null };
}
