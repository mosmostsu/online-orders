// ดึงต้นทุนล่าสุดจากบิลรับของ Seniorsoft → os_costs
//
//   ปกติ (cron รายวัน / ปุ่ม)  : ดู 2 เดือนล่าสุด — บิลที่เก่ากว่านั้นไม่ใช่ทุนล่าสุดอยู่แล้ว
//   ?months=2568-01,2568-02    : ระบุเดือนเอง ใช้ตอนเติมย้อนหลังครั้งแรก
//
// ⚠️ เติมย้อนหลังต้องไล่จากเดือนเก่าไปใหม่ — upsert เขียนทับตรงๆ ไม่ได้เทียบวันที่บิล
//    ถ้าไล่ย้อนจากใหม่ไปเก่า ทุนเก่าจะทับทุนใหม่
//
// เรียกได้ 2 ทาง: ปุ่มบนหน้าเว็บ (POST) หรือ cron ยิงมาพร้อม ?key=SYNC_SECRET
import { NextResponse } from 'next/server';
import { fetchMonth, latestCosts, saveCosts, recentMonths } from '@/lib/costs';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TIME_BUDGET_MS = 17000;    // หยุดรับก้อนใหม่เมื่อเลยเท่านี้ — Netlify ตัดจริงราว 26 วินาที
const RESOLVE_CHUNK = 300;       // sku ต่อรอบ os_costs_resolve — กันคิวรีเดียวกินเวลาจนโดนเตะ (เจอจริงเป็น 502)

async function run(req) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const asked = (url.searchParams.get('months') || '').split(',').map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}$/.test(s)).sort();
  const months = asked.length ? asked : recentMonths(2);

  const sb = db();
  const { data: logRow } = await sb.from('os_sync_log')
    .insert({ platform: 'money:costs', started_at: new Date().toISOString() })
    .select('id').maybeSingle();

  try {
    // ดึงพร้อมกันทุกเดือน แต่รวมตามลำดับเดือน — ทุนของเดือนหลังชนะเดือนก่อน
    // ไฟล์ที่ยังไม่มี = null (ปกติ) · ไฟล์ที่มีแต่อ่านไม่ได้ = error ต้องรายงาน ไม่ใช่ทำเป็นไม่มีไฟล์
    const errors = {};
    const files = await Promise.all(months.map((m) => fetchMonth(m).catch((e) => { errors[m] = e.message; return null; })));
    const lines = [];
    const found = [];
    months.forEach((m, i) => { if (files[i]) { lines.push(...files[i]); found.push(m); } });

    const rows = latestCosts(lines);
    const saved = await saveCosts(rows);

    // คิดทุนของรหัสที่ขายอยู่ให้เสร็จตรงนี้ เก็บลง os_sku_cost
    // หน้ารายสินค้าจะได้อ่านตารางตรงๆ ไม่ต้องไล่หาทุนแทนสดๆ (เดิมกินเวลา 4.3 วินาทีต่อการเปิดหนึ่งครั้ง)
    //
    // ทำทีละก้อน (RESOLVE_CHUNK sku ต่อรอบ) ไม่ใช่รวดเดียวทั้งหมด — ตอน os_money_items มีแต่
    // TikTok ยังไหว แต่พอ Shopee ดึงย้อนหลังเข้ามาเพิ่มอีกหลายร้อย sku (ส่วนใหญ่ต้องไปวิ่ง
    // fallback แบบเดารหัสใกล้เคียงซึ่งกินเวลากว่า exact match มาก) รวดเดียวไม่จบ โดน
    // statement timeout ของ Postgres บ้าง โดน Netlify เตะจนขาดกลางทาง (502) บ้าง
    let resolved = 0, resolvedError = null, resolvedMore = false;
    for (;;) {
      if (Date.now() - t0 > TIME_BUDGET_MS) { resolvedMore = true; break; }
      const { data: r, error: e } = await sb.rpc('os_costs_resolve', { p_days: 70, p_limit: RESOLVE_CHUNK });
      if (e) { resolvedError = e.message; break; }
      resolved += r || 0;
      if (!r || r < RESOLVE_CHUNK) break;   // ทำครบแล้ว ไม่มี sku ค้างให้คิดต่อ
    }

    await sb.from('os_sync_log')
      .update({ finished_at: new Date().toISOString(), fetched: lines.length, upserted: saved, ok: true })
      .eq('id', logRow?.id);
    return NextResponse.json({
      ok: true, months: found, missing: months.filter((m) => !found.includes(m) && !errors[m]), errors,
      lines: lines.length, skus: saved, resolved, resolvedError, resolvedMore,
      seconds: Math.round((Date.now() - t0) / 1000),
    });
  } catch (e) {
    const msg = String(e.message || e);
    await sb.from('os_sync_log')
      .update({ finished_at: new Date().toISOString(), ok: false, error: msg })
      .eq('id', logRow?.id);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
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
