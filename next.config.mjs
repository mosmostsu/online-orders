/** @type {import('next').NextConfig} */
const nextConfig = {
  // พาจากหน้าแรกไปหน้าออเดอร์ด้วยการเปลี่ยนเส้นทางระดับเซิร์ฟเวอร์จริงๆ
  // เดิมใช้คำสั่ง redirect ในหน้า ซึ่งส่งมาปนกับเนื้อหาที่ทยอยส่ง
  // เบราว์เซอร์บางตัว (โดยเฉพาะบนไอโฟน) ไม่ทำตาม กลายเป็นค้างที่ "กำลังโหลด..."
  // หรือขึ้น Application error ไปเลย
  async redirects() {
    return [{ source: '/', destination: '/orders', permanent: false }];
  },
};
export default nextConfig;
