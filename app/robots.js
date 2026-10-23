// เว็บใช้ภายในร้าน ไม่ต้องให้ใครเก็บข้อมูล — กันบอท/AI crawler ทุกตัว
export default function robots() {
  return { rules: [{ userAgent: '*', disallow: '/' }] };
}
