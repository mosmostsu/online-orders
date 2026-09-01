// จัดรูปแบบวันเวลาแบบไทย โดยไม่พึ่ง toLocaleString
//
// ทำไมต้องเขียนเอง: client component ถูก render สองรอบ — รอบแรกที่เซิร์ฟเวอร์ (Node)
// รอบสองตอน hydrate ที่เบราว์เซอร์ ถ้าสองรอบได้ข้อความต่างกันแม้แต่ตัวอักษรเดียว
// React จะโยน error #418 แล้วหน้าพัง
//
// toLocaleString('th-TH') พึ่งตาราง ICU ซึ่งติดมากับ Node คนละเวอร์ชันกับที่ติดมากับ iOS
// คนละเวอร์ชันจัดรูปแบบไม่เหมือนกัน (เช่นมี/ไม่มีจุลภาคคั่นวันกับเวลา) จึงพังเฉพาะบางเครื่อง
// เขียนเองแบบนี้ได้ผลเหมือนกันทุกเครื่องทุกเบราว์เซอร์

const MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// ไทยเป็น UTC+7 คงที่ ไม่มี daylight saving มาตั้งแต่ปี 2463 บวกตรงๆ ได้เลย
const TH_OFFSET = 7 * 3600000;
const pad = (n) => String(n).padStart(2, '0');

// "01 ก.ย. 09:40" — รูปแบบเดียวกับที่หน้าเว็บใช้อยู่เดิม
export function fmtTimeTH(s) {
  if (!s) return '—';
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return '—';
  const d = new Date(t + TH_OFFSET);
  return `${pad(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
