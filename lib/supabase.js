// ต่อ Supabase ฝั่ง server ด้วย service_role — ข้าม RLS ได้ ห้ามเรียกจาก client component
import { createClient } from '@supabase/supabase-js';

let cached = null;

export function db() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('ยังไม่ได้ตั้ง NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY ใน .env.local');
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
