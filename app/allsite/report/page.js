// Report Selection — แท็บใหม่ที่เปิดจากปุ่ม "เปิดในแท็บใหม่" ในตาราง ALL SITE (/allsite)
// ข้อมูลทั้งหมดโหลดฝั่งเบราว์เซอร์ เพราะรายการที่เลือกเก็บไว้ใน localStorage ของเครื่องที่เลือก
import Report from './Report';

export const metadata = { title: 'Report Selection — ALL SITE' };

// ?id=... = เปิดรายงานที่บันทึกไว้ (supabase/044) · ไม่มี = รายการที่เลือกในเครื่องนี้
export default async function ReportPage({ searchParams }) {
  const sp = await searchParams;
  const id = /^[0-9a-f-]{36}$/i.test(String(sp?.id || '')) ? String(sp.id) : '';
  return <Report key={id} id={id} />;
}
