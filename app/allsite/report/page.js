// Report Selection — แท็บใหม่ที่เปิดจากปุ่ม "เปิดในแท็บใหม่" ในตาราง ALL SITE (/allsite)
// ข้อมูลทั้งหมดโหลดฝั่งเบราว์เซอร์ เพราะรายการที่เลือกเก็บไว้ใน localStorage ของเครื่องที่เลือก
import Report from './Report';

export const metadata = { title: 'Report Selection — ALL SITE' };

export default function ReportPage() {
  return <Report />;
}
