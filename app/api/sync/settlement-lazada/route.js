// ดึง "เงินที่ได้รับจริง" ของ Lazada จาก Finance API → os_money_tx + os_statements
//
// Lazada ให้เป็นบรรทัดค่าธรรมเนียมทีละรายการ (ไม่มีก้อนต่อออเดอร์) — ไล่ถามทีละวัน แล้วรวมบรรทัดของ (ออเดอร์ + วัน)
// เป็นหนึ่งแถวเอง (ดู normalizeMoneyTx ใน lib/lazada.js) จากนั้นให้ os_rebuild_statements รวมเป็นใบสรุปรายวัน
// เหมือนที่ทำกับ Shopee (ดู supabase/023) · ตัวแปลงรายสินค้า (os_money_items) ทำงานเองจาก trigger ของ os_money_tx
//
// ความคืบหน้าจำจากข้อมูลที่บันทึกแล้ว (วันล่าสุดใน os_money_tx ถอยหลัง 2 วันเผื่อบรรทัดที่เข้าช้า) ไม่ต้องมี cursor แยก
// เรียกได้ 2 ทาง: ปุ่มบนหน้าเว็บ (POST) หรือ cron ยิงมาพร้อม ?key=SYNC_SECRET
import { NextResponse } from 'next/server';
import { listTransactions, normalizeMoneyTx, isPaidRow, rowDay } from '@/lib/lazada';
import { saveMoneyTx } from '@/lib/settlement';
import { listShops, usableToken } from '@/lib/tokens';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TIME_BUDGET_MS = 17000;
const LOOKBACK_DAYS = 30;
const OVERLAP_DAYS = 2;
const BATCH = 5;          // ถามกี่วันพร้อมกัน
const LOCK_MS = 60000;

const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);

async function isRunning(sb) {
  const { data } = await sb.from('os_sync_log')
    .select('started_at, finished_at')
    .eq('platform', 'money:lazada')
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!data || data.finished_at) return false;
  return Date.now() - new Date(data.started_at).getTime() < LOCK_MS;
}

async function run(req) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const shopFilter = url.searchParams.get('shop') || null;
  const forcedDays = Number(url.searchParams.get('days') || 0);
  // ?from=2026-10-01&to=2026-10-05 เจาะช่วงเอง (from อย่างเดียว = วันเดียว)
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to') || fromParam;
  const sb = db();

  if (await isRunning(sb)) return NextResponse.json({ ok: true, skipped: 'รอบก่อนยังทำงานอยู่', more: true });

  const shops = (await listShops('lazada')).filter((s) => !shopFilter || s.shop === shopFilter);
  if (!shops.length) return NextResponse.json({ ok: false, error: 'ยังไม่มีร้าน Lazada ที่ผูกไว้' }, { status: 400 });

  const result = [];
  let more = false;

  for (const row of shops) {
    const { data: logRow } = await sb.from('os_sync_log')
      .insert({ platform: 'money:lazada', shop: row.shop, started_at: new Date().toISOString() })
      .select('id').maybeSingle();

    let saved = 0, statements = 0, linesSeen = 0;
    try {
      const tok = await usableToken(row);
      const today = Date.parse(`${dayStr(Date.now())}T00:00:00Z`);

      let start;
      if (fromParam) start = Date.parse(`${fromParam}T00:00:00Z`);
      else if (forcedDays) start = today - forcedDays * 86400000;
      else {
        const { data: last } = await sb.from('os_money_tx').select('statement_at')
          .eq('platform', 'lazada').eq('shop', row.shop)
          .order('statement_at', { ascending: false }).limit(1).maybeSingle();
        start = last?.statement_at
          ? Date.parse(`${dayStr(new Date(last.statement_at).getTime())}T00:00:00Z`) - OVERLAP_DAYS * 86400000
          : today - LOOKBACK_DAYS * 86400000;
      }
      const end = toParam ? Date.parse(`${toParam}T00:00:00Z`) : today;

      const days = [];
      for (let d = start; d <= end; d += 86400000) days.push(dayStr(d));

      let touchedFrom = null, touchedTo = null;
      for (let i = 0; i < days.length; i += BATCH) {
        if (Date.now() - t0 > TIME_BUDGET_MS) { more = true; break; }
        const chunk = days.slice(i, i + BATCH);
        const lists = await Promise.all(chunk.map((d) => listTransactions({ accessToken: tok.access_token, from: d, to: d })));
        linesSeen += lists.reduce((s, l) => s + l.length, 0);
        // เก็บเฉพาะบรรทัดของวันนั้นจริงๆ (ปลายช่วงของ API อาจเลยมาวันถัดไป) และเฉพาะที่จ่ายแล้ว
        const rows = lists.flatMap((l, k) => l.filter((r) => isPaidRow(r) && rowDay(r) === chunk[k]));
        const txs = normalizeMoneyTx(rows, row.shop);
        if (txs.length) {
          await saveMoneyTx(txs);
          saved += txs.length;
          for (const t of txs) {
            if (!touchedFrom || t.statement_at < touchedFrom) touchedFrom = t.statement_at;
            if (!touchedTo || t.statement_at > touchedTo) touchedTo = t.statement_at;
          }
        }
      }

      if (touchedFrom) {
        const { data: n, error: e2 } = await sb.rpc('os_rebuild_statements', {
          p_platform: 'lazada', p_shop: row.shop,
          p_from: touchedFrom, p_to: new Date(new Date(touchedTo).getTime() + 86400000).toISOString(),
        });
        if (e2) throw new Error(e2.message);
        statements = n || 0;
      }

      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), fetched: saved, upserted: statements, ok: true })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, days: days.length, lines: linesSeen, saved, statements });
    } catch (e) {
      const msg = String(e.message || e);
      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), fetched: saved, ok: false, error: msg })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, saved, error: msg });
    }
  }
  return NextResponse.json({ ok: true, more, seconds: Math.round((Date.now() - t0) / 1000), result });
}

export async function GET(req) {
  if (process.env.SYNC_SECRET && new URL(req.url).searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  return run(req);
}
export async function POST(req) { return run(req); }
