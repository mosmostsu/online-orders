// รหัสเข้าเว็บ (ทั้งเว็บ) — คนละอันกับ SALES_PIN ที่ปลดตัวเลขยอดขาย
// ตั้ง SITE_PASSWORD ใน Netlify → ทุกหน้าต้องใส่รหัสก่อน ใส่ครั้งเดียวจำเครื่องไว้ 180 วัน
// ยังไม่ตั้ง = เว็บเปิดเหมือนเดิม (กันล็อกตัวเองออกตอน deploy ก่อนตั้งค่า)
// เปลี่ยน SITE_PASSWORD = ทุกเครื่องต้องใส่ใหม่
//
// ใช้ Web Crypto ได้ทั้ง edge (middleware) และ node (route) — ค่าแฮชต้องตรงกันสองฝั่ง
export const SITE_COOKIE = 'os_site';
export const SITE_MAX_AGE = 180 * 86400;

export async function siteToken() {
  const pw = process.env.SITE_PASSWORD;
  if (!pw) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`site|${pw}|${process.env.SYNC_SECRET || ''}`));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function sameStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// หน้า/ทางเข้าที่ต้องเปิดได้โดยไม่ล็อกอิน
//   login เอง · webhook (มีลายเซ็นแพลตฟอร์ม) · auth (OAuth กลับมาจากแพลตฟอร์ม)
//   privacy/terms/about (แพลตฟอร์มตรวจแอปต้องเปิดได้) · ไฟล์ยืนยันโดเมน TikTok · โลโก้ · robots
export const PUBLIC = [
  /^\/login\/?$/, /^\/api\/site-login\/?$/,
  /^\/api\/webhook\//, /^\/api\/auth\//, /^\/api\/ping\/?$/,
  /^\/(privacy|terms|about)(\/|$)/,
  /^\/robots\.txt$/, /^\/tiktok[^/]*\.txt$/, /^\/[^/]+\.(png|ico|svg|jpg|webp)$/,
];
