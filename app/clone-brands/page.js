// แบรนด์ที่ ThisShop ยังไม่มีให้ร้านใช้ — เปิดจากปุ่มในหน้าต่างโคลน ThisShop (/allsite/report)
import BrandGaps from './BrandGaps';

export const metadata = { title: 'แบรนด์ที่ ThisShop ยังไม่มี' };

export default function Page() {
  return <BrandGaps />;
}
