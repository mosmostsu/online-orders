// คลิปวิดีโอ TikTok ทั้งสองช่องเป็น JSON (normalize แล้ว) — ไว้ให้เครื่องมืออื่น เช่น Gemini วางแผนคลิป
// ต้องแนบ SYNC_SECRET: header "x-sync-secret" หรือ ?secret=
import { NextResponse } from 'next/server';
import { getVideos } from '@/lib/video';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const secret = process.env.SYNC_SECRET;
  const given = req.headers.get('x-sync-secret') || new URL(req.url).searchParams.get('secret');
  if (!secret || given !== secret) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await getVideos()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
