// ดึงคลิป TikTok (Display API) ของทุกบัญชีที่เชื่อมไว้ลง os_videos — cron ยิงมาพร้อม ?key=SYNC_SECRET
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { syncVideos } from '@/lib/tiktok-display';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run() {
  try {
    // ทำเป็นช่วงๆ — ถ้าผลบอก done:false ให้เรียกซ้ำจนกว่าจะเป็น true (บันทึกต่อจากจุดที่ค้างไว้)
    const { results, done } = await syncVideos();
    revalidateTag('video');
    return NextResponse.json({ ok: results.every((r) => r.ok), done, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

export async function GET(req) {
  const key = new URL(req.url).searchParams.get('key');
  if (process.env.SYNC_SECRET && key !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  return run();
}
