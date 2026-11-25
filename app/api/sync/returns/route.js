// เติมตารางของคืน (os_returns) — เรียกได้ 2 ทาง
//   cron (netlify/functions/sync-returns.mjs) ยิง GET พร้อม ?key=SYNC_SECRET
//   ปุ่ม "ดึงสถานะใหม่" บนหน้า /returns (POST — ด่าน Origin ใน middleware)
// ?days=90 = ดึงย้อนหลัง (รอบแรก) · ?check=100 = ถามสถานะขนส่งกี่กล่อง · ?only=tiktok,shopee = ทำบางขั้น
import { NextResponse } from 'next/server';
import { runReturnsSync } from '@/lib/returnsSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run(req) {
  const url = new URL(req.url);
  const days = Math.min(120, Math.max(1, Number(url.searchParams.get('days')) || 3));
  const checkLimit = Math.min(200, Math.max(0, Number(url.searchParams.get('check') ?? 40)));
  const only = url.searchParams.get('only')?.split(',').filter(Boolean) || null;
  // Netlify ตัดคำขอที่ ~26 วินาที — งบ 20 วินาที รอบย้อนหลังยาวให้สั่งทีละขั้นด้วย ?only=
  const result = await runReturnsSync({ days, checkLimit, only, budgetMs: 20000 });
  return NextResponse.json({ ok: !result.errors.length, days, ...result });
}

export async function GET(req) {
  const key = new URL(req.url).searchParams.get('key');
  if (process.env.SYNC_SECRET && key !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  return run(req);
}

export async function POST(req) {
  return run(req);
}
