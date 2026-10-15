// เวลาดึงสินค้าล่าสุดของแต่ละร้าน (จาก os_sync_log แถว listings:<แพลตฟอร์ม> ที่สำเร็จ) — เมนูซิงก์สินค้าหน้า /compare
//   GET ?shops=shopee:SOLID,tiktok:SOLID  → { ok, last: { 'shopee:SOLID': '2026-10-15T09:20:00Z' | null } }
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const keys = String(new URL(req.url).searchParams.get('shops') || '').split(',')
    .map((k) => k.trim()).filter((k) => /^[a-z]+:[A-Za-z0-9_-]+$/.test(k)).slice(0, 12);
  const sb = db();
  const rows = await Promise.all(keys.map(async (k) => {
    const [platform, shop] = k.split(':');
    const { data } = await sb.from('os_sync_log').select('finished_at')
      .eq('platform', `listings:${platform}`).eq('shop', shop).eq('ok', true)
      .not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(1).maybeSingle();
    return [k, data?.finished_at || null];
  }));
  return NextResponse.json({ ok: true, last: Object.fromEntries(rows) });
}
