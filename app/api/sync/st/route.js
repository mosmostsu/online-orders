// ดึงไฟล์ ST กลาง (สต็อก Seniorsoft) มาเก็บสำเนาใน os_st — ตัวตั้งต้นของหน้า /allsite (ดู supabase/035)
//
// เช็ค metadata ก่อน (เล็ก เร็ว) ไฟล์ไม่เปลี่ยนก็จบ ไม่โหลดก้อนใหญ่ — ?force=1 บังคับดึงใหม่
// ไฟล์มี ~43,000 รหัส บันทึกเป็นชุดละ 2,000 ยิงพร้อมกันหลายชุด แล้วลบรหัสที่ไม่อยู่ในไฟล์ล่าสุด
//
// เรียกได้ 2 ทาง: ปุ่มในหน้า /allsite (POST) หรือ cron ยิงมาพร้อม ?key=SYNC_SECRET
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { fetchCentralMeta, fetchCentralRows, normalizeStRow } from '@/lib/central';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CHUNK = 2000;
const PARALLEL = 6;

async function run(req) {
  const t0 = Date.now();
  const force = new URL(req.url).searchParams.get('force') === '1';
  const sb = db();

  const meta = await fetchCentralMeta('ST');
  const { data: last } = await sb.from('os_st_meta').select('updated').eq('id', 1).maybeSingle();
  if (!force && last?.updated && last.updated === meta.updated) {
    return NextResponse.json({ ok: true, skipped: 'ไฟล์ ST ยังไม่เปลี่ยน', updated: meta.updated });
  }

  const now = new Date().toISOString();
  const rows = (await fetchCentralRows('ST', meta)).map((r) => normalizeStRow(r, now)).filter(Boolean);
  // รหัสซ้ำในไฟล์ (คนละคลัง) — เก็บตัวแรก upsert ชุดเดียวกันซ้ำ key ไม่ได้
  const seen = new Set();
  const uniq = rows.filter((r) => (seen.has(r.sku) ? false : (seen.add(r.sku), true)));

  const chunks = [];
  for (let i = 0; i < uniq.length; i += CHUNK) chunks.push(uniq.slice(i, i + CHUNK));
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      const { error } = await sb.from('os_st').upsert(c, { onConflict: 'sku' });
      if (error) throw new Error(error.message);
    }
  }));

  // รหัสที่ไม่อยู่ในไฟล์ล่าสุด = ถูกลบออกจาก Seniorsoft แล้ว
  const { error: e2, count: removed } = await sb.from('os_st').delete({ count: 'exact' }).lt('synced_at', now);
  if (e2) throw new Error(e2.message);

  const { error: e3 } = await sb.from('os_st_meta').upsert({
    id: 1, updated: meta.updated, row_count: uniq.length, synced_at: now,
    file_modified: meta.fileModified ? new Date(meta.fileModified).toISOString() : null,
  });
  if (e3) throw new Error(e3.message);
  revalidateTag('allsite');

  return NextResponse.json({ ok: true, rows: uniq.length, removed: removed || 0, seconds: Math.round((Date.now() - t0) / 1000) });
}

async function safe(req) {
  try {
    return await run(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

export async function GET(req) {
  const key = new URL(req.url).searchParams.get('key');
  if (process.env.SYNC_SECRET && key !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  return safe(req);
}

export async function POST(req) {
  return safe(req);
}
