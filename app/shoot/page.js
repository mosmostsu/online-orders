// หน้าถ่ายฟุต — ลูกน้องเปิดบนมือถือ กดถ่าย/เลือกคลิปทีละช็อต ไฟล์ขึ้น Google Drive ของร้านพร้อมชื่อสินค้า+ช็อต
// ไม่ต้องใส่รหัสยอดขาย (ล็อกอินเว็บด้วยรหัสร้านพอ) — หน้านี้ไม่มีตัวเลขยอดขาย แก้แผนคลิปไม่ได้ ทำได้แค่อัปฟุตของงานถ่ายที่ตั้งไว้
import { db } from '@/lib/supabase';
import { driveStatus } from '@/lib/gdrive';
import Shoot from './Shoot';
import '../studio/studio.css';
import './shoot.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ถ่ายฟุต — order-sync' };

export default async function ShootPage() {
  const [res, drive] = await Promise.all([
    db().from('os_studio_shoots').select('id, product, folder, shots, got, due, done').eq('done', false).order('due', { nullsFirst: false }).limit(100),
    driveStatus(),
  ]);
  if (res.error) {
    return <div className="pcard"><b>เปิดหน้าถ่ายฟุตไม่ได้</b><div className="sub" style={{ margin: '6px 0 0' }}>{res.error.message}</div></div>;
  }
  return <Shoot shoots={res.data || []} drive={{ ok: drive.ok, why: drive.why || '' }} />;
}
