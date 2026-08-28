// ปลายทางเบาที่สุด ไม่แตะฐานข้อมูล — ไว้ให้ตัวตั้งเวลาแวะปลุกเซิร์ฟเวอร์
// (Netlify ใช้เครื่องเดียวรันทุกหน้า ปลุกตรงนี้ก็ทำให้หน้าอื่นอุ่นตาม)
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ ok: true, at: new Date().toISOString() });
}
