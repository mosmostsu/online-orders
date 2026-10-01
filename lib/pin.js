// รหัสปลดล็อกข้อมูลยอดขาย — หน้า /money ทั้งหน้า, จำนวนชิ้น/ยอดขายบาทในหน้า /summary และหน้ารายละเอียดสินค้า
//
// เว็บนี้ไม่มีระบบล็อกอิน ใครมีลิงก์ก็เปิดได้ ตัวเลขยอดขายจึงซ่อนไว้ที่ฝั่งเซิร์ฟเวอร์
// (ไม่ส่งไปเบราว์เซอร์เลย ไม่ใช่แค่ปิดตาด้วย CSS) จนกว่าจะใส่รหัส SALES_PIN ที่ตั้งใน Netlify
// ใส่ถูกแล้วได้คุกกี้จำไว้ 30 วัน — ค่าในคุกกี้เป็นค่าแฮช ไม่ใช่ตัวรหัส
// เปลี่ยน SALES_PIN = ทุกเครื่องที่เคยปลดล็อกไว้ต้องใส่ใหม่
import crypto from 'crypto';
import { cookies } from 'next/headers';

export const PIN_COOKIE = 'os_sales_pin';
export const PIN_MAX_AGE = 30 * 86400;
export const MASK = '******';

export const pinConfigured = () => Boolean(process.env.SALES_PIN);

// ค่าที่เก็บในคุกกี้ — ผูกกับ SYNC_SECRET ด้วย รู้รหัสอย่างเดียวปลอมคุกกี้เองไม่ได้
export function pinToken() {
  const pin = process.env.SALES_PIN;
  if (!pin) return null;
  return crypto.createHash('sha256').update(`${pin}|${process.env.SYNC_SECRET || ''}`).digest('hex');
}

export function pinMatches(input) {
  const pin = process.env.SALES_PIN;
  if (!pin || typeof input !== 'string') return false;
  const a = Buffer.from(input), b = Buffer.from(pin);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function salesUnlocked() {
  const t = pinToken();
  if (!t) return false;
  const c = (await cookies()).get(PIN_COOKIE)?.value || '';
  return c.length === t.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(t));
}
