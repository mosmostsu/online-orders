// ดึงออเดอร์ TikTok ของทุกร้านที่ผูกไว้ → เก็บลง DB
// เรียกได้ 2 ทาง: ปุ่มบนหน้าเว็บ (POST) หรือ cron ยิงมาพร้อม ?key=SYNC_SECRET
import { NextResponse } from 'next/server';
import { fetchOrders, normalizeOrder } from '@/lib/tiktok';
import { listShops, usableToken } from '@/lib/tokens';
import { upsertOrders } from '@/lib/ingest';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FALLBACK_MINUTES = 30;   // ใช้ตอนยังไม่เคยดึงสำเร็จเลย
const OVERLAP_MINUTES = 5;     // ดึงย้อนทับรอบก่อนไว้หน่อย กันของหลุดตรงรอยต่อ
const LOCK_MINUTES = 3;        // ถ้ารอบก่อนเริ่มไม่ถึงเท่านี้และยังไม่จบ ถือว่ายังวิ่งอยู่
// แบ่งช่วงเวลาเป็นก้อนเล็กแล้วทำทีละก้อน หยุดเองเมื่อใกล้หมดเวลา
// ตอนขนส่งมารับของรอบเย็น ใบเปลี่ยนสถานะทีเดียว 500-700 ใบ (31 ส.ค. 15:35-16:05 = 655 ใบ)
// ถ้าดึงยาวรวดเดียวจะไม่ทัน 26 วินาทีของ Netlify แล้วโดนฆ่ากลางทาง
// พอโดนฆ่าก็ไม่ได้บันทึกว่าดึงถึงไหน รอบหน้ายิ่งย้อนไกล → ตายวนไม่จบ (เคยเกิดมาแล้ว 23 ชั่วโมง)
const CHUNK_MINUTES = 30;
const TIME_BUDGET_MS = 18000;

// ดึงต่อจากจุดที่ดึงถึงล่าสุด — ไม่ใช่ดึงย้อนหลังเท่าเดิมทุกครั้ง
// ร้านนี้ออเดอร์เยอะ ถ้าดึงทับซ้ำทุกรอบจะโดน TikTok เตะเรื่องยิงถี่เกิน
async function sinceFromLastRun(sb) {
  const { data } = await sb
    .from('os_sync_log')
    .select('started_at')
    .eq('platform', 'tiktok').eq('ok', true)
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!data?.started_at) return Date.now() - FALLBACK_MINUTES * 60000;
  return new Date(data.started_at).getTime() - OVERLAP_MINUTES * 60000;
}

// รอบก่อนยังวิ่งอยู่ไหม — cron ของ Netlify ยิงซ้ำได้ถ้ารอบก่อนยังไม่ตอบ
async function isRunning(sb) {
  const { data } = await sb
    .from('os_sync_log')
    .select('started_at, finished_at')
    .eq('platform', 'tiktok')
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!data || data.finished_at) return false;
  return Date.now() - new Date(data.started_at).getTime() < LOCK_MINUTES * 60000;
}

async function run(req) {
  const url = new URL(req.url);
  const sb = db();

  const days = Number(url.searchParams.get('days') || 0);
  const forcedMinutes = days ? days * 1440 : Number(url.searchParams.get('minutes') || 0);

  if (!forcedMinutes && (await isRunning(sb))) {
    return NextResponse.json({ ok: true, skipped: 'รอบก่อนยังทำงานอยู่' });
  }

  const since = forcedMinutes ? Date.now() - forcedMinutes * 60000 : await sinceFromLastRun(sb);
  const target = Date.now();
  const startedRun = Date.now();   // ใช้คุมว่าทำได้อีกกี่ก้อนก่อนหมดเวลา

  const shops = await listShops('tiktok');
  if (!shops.length) {
    return NextResponse.json({ ok: false, error: 'ยังไม่มีร้านที่ผูกไว้ — เปิด /api/setup/tiktok ก่อน' }, { status: 400 });
  }

  const result = [];
  for (const row of shops) {
    const started = new Date().toISOString();
    // จองคิวไว้ก่อนเริ่มจริง เพื่อให้รอบถัดไปรู้ว่ามีคนทำอยู่
    const { data: logRow } = await sb
      .from('os_sync_log')
      .insert({ platform: 'tiktok', shop: row.shop, started_at: started })
      .select('id').maybeSingle();

    try {
      const tok = await usableToken(row);
      // เดินทีละก้อน เก็บไว้ว่าทำถึงไหนแล้ว ถ้าเวลาใกล้หมดก็หยุดตรงนั้น รอบหน้าไปต่อ
      let cursor = since, fetched = 0, upserted = 0, chunks = 0;
      while (cursor < target) {
        const chunkEnd = Math.min(target, cursor + CHUNK_MINUTES * 60000);
        const orders = await fetchOrders({
          accessToken: tok.access_token, shopCipher: tok.shop_cipher, since: cursor, until: chunkEnd,
        });
        const records = orders.map((o) => normalizeOrder(o, row.shop));
        const res = await upsertOrders(records);
        fetched += orders.length;
        upserted += res.upserted;
        cursor = chunkEnd;
        chunks++;
        if (Date.now() - startedRun > TIME_BUDGET_MS) break;
      }

      // started_at ของรอบที่สำเร็จ = จุดที่ดึงถึง (ไม่ใช่เวลาที่เริ่มทำงาน)
      // เพราะรอบถัดไปใช้ค่านี้เป็นจุดตั้งต้น ถ้าใส่เวลาปัจจุบันช่วงที่ยังไม่ได้ดึงจะหายไปเลย
      await sb.from('os_sync_log')
        .update({ started_at: new Date(cursor).toISOString(), finished_at: new Date().toISOString(), fetched, upserted, ok: true })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, fetched, upserted, chunks, 'ดึงถึง': new Date(cursor).toISOString() });
    } catch (e) {
      const msg = String(e.message || e);
      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), ok: false, error: msg })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    since: new Date(since).toISOString(),
    minutes: Math.round((Date.now() - since) / 60000),
    result,
  });
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
