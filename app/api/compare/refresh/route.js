// ล้างที่จำไว้ของหน้า /compare แล้วเด้งกลับ — ปุ่ม "ดึงข้อมูลใหม่" ท้ายหน้า
// หน้านั้นจำผลไว้นาน (ข้อมูลไม่ค่อยเปลี่ยน) และถูกล้างเองทุกครั้งที่รอบดึงสินค้า/ไฟล์ ST เสร็จ
// ใช้ปุ่มนี้เฉพาะตอนแก้ข้อมูลที่ไม่ผ่านรอบดึง เช่น เพิ่มกฎใน os_brand_code หรืออัปเดตฟังก์ชัน SQL
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  revalidateTag('listings');
  revalidateTag('allsite');
  // ผลสำเร็จรูป (supabase/053) — ลบทิ้ง คนถัดไปที่เปิดหน้าจะสร้างใหม่ให้
  try { await db().from('os_compare_snap').delete().neq('thr', -1); } catch { /* ยังไม่มีตาราง — ข้าม */ }
  const back = new URL(req.url).searchParams.get('back') || '/compare';
  // เด้งกลับเฉพาะหน้า /compare (กัน open redirect)
  const to = back.startsWith('/compare') ? back : '/compare';
  return NextResponse.redirect(new URL(to, req.url));
}
