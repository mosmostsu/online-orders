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

// ดึงต่อจากจุดที่ดึงถึงล่าสุดของ "ร้านนั้น" — ไม่ใช่ดึงย้อนหลังเท่าเดิมทุกครั้ง
// ร้านนี้ออเดอร์เยอะ ถ้าดึงทับซ้ำทุกรอบจะโดน TikTok เตะเรื่องยิงถี่เกิน
// ต้องแยกตามร้าน: ถ้าใช้จุดรวม ร้านที่ดึงได้ช้ากว่าจะโดนข้ามช่วงที่ยังไม่ได้ดึงไปเลย
async function sinceFromLastRun(sb, shop) {
  const { data } = await sb
    .from('os_sync_log')
    .select('started_at')
    .eq('platform', 'tiktok').eq('shop', shop).eq('ok', true)
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!data?.started_at) return Date.now() - FALLBACK_MINUTES * 60000;
  return new Date(data.started_at).getTime() - OVERLAP_MINUTES * 60000;
}

// รอบก่อนยังวิ่งอยู่ไหม — cron ของ Netlify ยิงซ้ำได้ถ้ารอบก่อนยังไม่ตอบ
// เช็คแยกตามร้าน — ตัวตั้งเวลายิงแต่ละร้านพร้อมกัน ถ้าเช็ครวมร้านที่สองจะโดนข้ามทุกรอบ
async function isRunning(sb, shop) {
  const { data } = await sb
    .from('os_sync_log')
    .select('started_at, finished_at')
    .eq('platform', 'tiktok').eq('shop', shop)
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

  const target = Date.now();
  const startedRun = Date.now();   // ใช้คุมว่าทำได้อีกกี่ก้อนก่อนหมดเวลา
  // ดึงย้อนหลังร้านที่ออเดอร์น้อย: ?days=30&chunk=1440 = ก้อนละ 1 วัน (30 ก้อน จบในรอบเดียว)
  // ใช้เมื่อสั่งเองเท่านั้น — ร้านที่ออเดอร์เยอะอย่าตั้งใหญ่ เพราะก้อนใหญ่ใช้เวลาต่อก้อนนาน เสี่ยงไม่ทันงบเวลา
  const chunkMinutes = Math.min(1440, Math.max(CHUNK_MINUTES, Number(url.searchParams.get('chunk')) || CHUNK_MINUTES));

  // เลือกดึงทีละร้านได้ด้วย ?shop=MVP — ตัวตั้งเวลายิงแยกร้าน ร้านละงบเวลาของตัวเอง
  let shops = await listShops('tiktok');
  const only = url.searchParams.get('shop');
  if (only) shops = shops.filter((s) => s.shop === only);
  if (!shops.length) {
    return NextResponse.json({ ok: false, error: 'ยังไม่มีร้านที่ผูกไว้ — เปิด /api/auth/tiktok?shop=ชื่อร้าน ก่อน' }, { status: 400 });
  }

  const result = [];
  for (let i = 0; i < shops.length; i++) {
    const row = shops[i];
    if (!forcedMinutes && (await isRunning(sb, row.shop))) {
      result.push({ shop: row.shop, skipped: 'รอบก่อนยังทำงานอยู่' });
      continue;
    }
    // ถ้าเรียกรวมหลายร้านในคำขอเดียว แบ่งงบเวลาเท่าๆ กัน — ร้านแรกกินหมดไม่ได้
    const shopDeadline = startedRun + (TIME_BUDGET_MS * (i + 1)) / shops.length;
    const since = forcedMinutes ? Date.now() - forcedMinutes * 60000 : await sinceFromLastRun(sb, row.shop);
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
        const chunkEnd = Math.min(target, cursor + chunkMinutes * 60000);
        const orders = await fetchOrders({
          accessToken: tok.access_token, shopCipher: tok.shop_cipher, since: cursor, until: chunkEnd,
        });
        const records = orders.map((o) => normalizeOrder(o, row.shop));
        const res = await upsertOrders(records);
        fetched += orders.length;
        upserted += res.upserted;
        cursor = chunkEnd;
        chunks++;
        if (Date.now() > shopDeadline) break;
      }

      // started_at ของรอบที่สำเร็จ = จุดที่ดึงถึง (ไม่ใช่เวลาที่เริ่มทำงาน)
      // เพราะรอบถัดไปใช้ค่านี้เป็นจุดตั้งต้น ถ้าใส่เวลาปัจจุบันช่วงที่ยังไม่ได้ดึงจะหายไปเลย
      await sb.from('os_sync_log')
        .update({ started_at: new Date(cursor).toISOString(), finished_at: new Date().toISOString(), fetched, upserted, ok: true })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, since: new Date(since).toISOString(), fetched, upserted, chunks, 'ดึงถึง': new Date(cursor).toISOString() });
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
