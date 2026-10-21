// ผลสำเร็จรูปของหน้า /compare (os_compare_snap, supabase/053) — ทำให้ "เก่า" แทนการลบทิ้ง
//
// เดิมหลังโคลนแต่ละตะกร้าลบก้อนของกลุ่มทิ้ง → คนที่เปิด /compare ถัดไปต้องรอสร้างก้อนใหม่ 4–13 วินาที
// โคลนหลายตัวติดกัน + เปิดหน้าไปด้วย = หลายคำขอสร้างพร้อมกันชนกันในฐานข้อมูล จนหน้าเว็บขาด ("Connection closed")
// ตอนนี้แค่ถอย built_at ไป 1 วัน → หน้า /compare ใช้ก้อนเดิมทันที แล้วสร้างใหม่เบื้องหลัง (ดู loadSnap ใน lib/compareSnapLoad.js)
// built_at ใหม่ทุกครั้ง (ไม่ใช่ค่าคงที่) เพราะที่จำร่วมของก้อนใช้ built_at เป็นกุญแจ
import { db } from './supabase.js';

export async function markCompareStale(group) {
  if (!group) return;
  const at = new Date(Date.now() - 86400000 - Math.floor(Math.random() * 1000)).toISOString();
  // กลุ่มตามแพลตฟอร์ม (P:shopee ฯลฯ — supabase/056) และกลุ่มร้านหลัก (X:main — 057) มีร้านนี้อยู่ด้วย → ทำให้เก่าพร้อมกัน
  try { await db().from('os_compare_snap').update({ built_at: at }).or(`grp.eq.${group},grp.like.P:*,grp.like.X:*`); } catch { /* ยังไม่มีตาราง — ข้าม */ }
}

// ทุกกลุ่ม — ปุ่ม "ดึงข้อมูลใหม่" ของหน้า /compare (เดิมลบทิ้งทั้งตาราง คนถัดไปต้องรอสร้าง 4–13 วิ)
export async function markAllCompareStale() {
  const at = new Date(Date.now() - 86400000 - Math.floor(Math.random() * 1000)).toISOString();
  try { await db().from('os_compare_snap').update({ built_at: at }).neq('thr', -1); } catch { /* ยังไม่มีตาราง — ข้าม */ }
}
