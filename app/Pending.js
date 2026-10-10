'use client';
import { useLinkStatus } from 'next/link';

// ตัวบอกว่าลิงก์ที่ครอบอยู่กำลังโหลดหน้าใหม่ไหม (ต้องอยู่ข้างใน <Link>) — CSS ใช้ :has() ไฮไลต์ + จางเนื้อหาด้านล่าง
// ใช้ร่วมกันระหว่างแถบเลือกร้าน (ShopBarView) กับปุ่มกลุ่มร้านของหน้า /allsite
export default function Pending() {
  const { pending } = useLinkStatus();
  return <i className="chpend" data-p={pending ? '1' : '0'} aria-hidden="true" />;
}
