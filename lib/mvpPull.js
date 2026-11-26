// คำขอ "ดึงออเดอร์" ของร้าน Shopee ที่ไม่มี API (MVP, PACE) — ตาราง os_mvp_pull (supabase/070)
// หน้า /round เครื่องไหนก็กดขอได้ → ส่วนขยาย mvp-stock บนเครื่องที่ล็อกอินร้านนั้นเช็คทุก 2 นาทีแล้วดึงให้
import { db } from './supabase.js';

export const SEEN_FRESH_MIN = 6;   // ส่วนขยายเช็คทุก 2 นาที — ไม่เห็นเกินนี้ = Chrome เครื่องนั้นปิด/หลับ

// ยังไม่ได้รัน 070 = ตารางไม่มี → คืน null ให้หน้าเว็บบอก
export async function pullState(shop) {
  const { data, error } = await db().from('os_mvp_pull').select('*').eq('shop', shop).maybeSingle();
  if (error) return null;
  return data || { shop };
}

export const isPending = (r) =>
  !!r?.requested_at && (!r.done_at || Date.parse(r.requested_at) > Date.parse(r.done_at));

export async function savePull(shop, patch) {
  const { error } = await db().from('os_mvp_pull').upsert({ shop, ...patch }, { onConflict: 'shop' });
  if (error) throw new Error(error.message);
}
