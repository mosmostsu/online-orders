// ดึง "เงินที่ได้รับจริง" ของ Lazada จาก Finance API → os_money_tx + os_statements
//
// Lazada ให้เป็นบรรทัดค่าธรรมเนียมทีละรายการ (ไม่มีก้อนต่อออเดอร์) และลงบรรทัดของออเดอร์เดียวกันกระจายได้หลายวัน
// (เช่น วันขายลงราคา+ค่าคอม แล้วอีกวันค่อยมีค่าธรรมเนียมตามมา) เราต้องรวมเป็นก้อนเดียวต่อออเดอร์ (ดู normalizeMoneyTx)
// จึงต้องเห็นบรรทัด "ครบทุกวัน" ของออเดอร์ที่ขยับ ไม่ใช่แค่วันที่เพิ่งดึง:
//   1. ช่วงใหม่ = ตั้งแต่วันล่าสุดที่บันทึกไว้ (ถอย 2 วัน) ถึงวันนี้ — หาว่าออเดอร์ไหนมีบรรทัดใหม่
//   2. ถามย้อนหลังเพิ่มอีก HISTORY_DAYS เพื่อเอาบรรทัดเก่าของออเดอร์พวกนั้นมารวมด้วย
//   3. เขียนทับก้อนของออเดอร์นั้นทั้งก้อน แล้วสร้างใบสรุปรายวันของช่วงนั้นใหม่ทั้งหมด
// ร้าน Lazada มีออเดอร์ไม่มาก ถามย้อนหลังทุกรอบได้สบาย
//
// เรียกได้ 2 ทาง: ปุ่มบนหน้าเว็บ (POST) หรือ cron ยิงมาพร้อม ?key=SYNC_SECRET
import { NextResponse } from 'next/server';
import { listTransactions, normalizeMoneyTx, isPaidRow, rowDay } from '@/lib/lazada';
import { saveMoneyTx } from '@/lib/settlement';
import { listShops, usableToken } from '@/lib/tokens';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOOKBACK_DAYS = 30;     // รอบแรกที่ยังไม่มีข้อมูล
const OVERLAP_DAYS = 2;       // เผื่อบรรทัดที่ลงช้า
const HISTORY_DAYS = 45;      // บรรทัดของออเดอร์เดียวกันห่างกันได้ไม่เกินนี้
const CHUNK_DAYS = 15;        // ถาม API ทีละช่วงไม่ให้กว้างเกิน
const LOCK_MS = 60000;
const DAY = 86400000;

const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (s) => Date.parse(`${s}T00:00:00Z`);

async function isRunning(sb) {
  const { data } = await sb.from('os_sync_log')
    .select('started_at, finished_at')
    .eq('platform', 'money:lazada')
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!data || data.finished_at) return false;
  return Date.now() - new Date(data.started_at).getTime() < LOCK_MS;
}

async function fetchRange(accessToken, from, to) {
  const out = [];
  for (let d = from; d <= to; d += CHUNK_DAYS * DAY) {
    const end = Math.min(d + (CHUNK_DAYS - 1) * DAY, to);
    out.push(...await listTransactions({ accessToken, from: dayStr(d), to: dayStr(end) }));
  }
  return out;
}

async function run(req) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const shopFilter = url.searchParams.get('shop') || null;
  const forcedDays = Number(url.searchParams.get('days') || 0);
  // ?from=2026-10-01&to=2026-10-05 เจาะช่วงเอง (from อย่างเดียว = ถึงวันนี้)
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const sb = db();

  if (await isRunning(sb)) return NextResponse.json({ ok: true, skipped: 'รอบก่อนยังทำงานอยู่', more: true });

  const shops = (await listShops('lazada')).filter((s) => !shopFilter || s.shop === shopFilter);
  if (!shops.length) return NextResponse.json({ ok: false, error: 'ยังไม่มีร้าน Lazada ที่ผูกไว้' }, { status: 400 });

  const result = [];
  for (const row of shops) {
    const { data: logRow } = await sb.from('os_sync_log')
      .insert({ platform: 'money:lazada', shop: row.shop, started_at: new Date().toISOString() })
      .select('id').maybeSingle();

    let saved = 0, statements = 0, lines = 0;
    try {
      const tok = await usableToken(row);
      const today = dayMs(dayStr(Date.now()));

      let start;
      if (fromParam) start = dayMs(fromParam);
      else if (forcedDays) start = today - forcedDays * DAY;
      else {
        const { data: last } = await sb.from('os_money_tx').select('statement_at')
          .eq('platform', 'lazada').eq('shop', row.shop)
          .order('statement_at', { ascending: false }).limit(1).maybeSingle();
        start = last?.statement_at
          ? dayMs(dayStr(new Date(last.statement_at).getTime())) - OVERLAP_DAYS * DAY
          : today - LOOKBACK_DAYS * DAY;
      }
      const end = toParam ? dayMs(toParam) : today;
      const histFrom = start - HISTORY_DAYS * DAY;

      const all = (await fetchRange(tok.access_token, histFrom, end)).filter(isPaidRow);
      lines = all.length;
      const startDay = dayStr(start);

      // ออเดอร์ที่มีบรรทัดในช่วงใหม่ → เอาบรรทัดทุกวันของออเดอร์นั้น · บรรทัดไม่ผูกออเดอร์เอาเฉพาะช่วงใหม่
      const touched = new Set(all.filter((r) => r.order_no && rowDay(r) >= startDay).map((r) => String(r.order_no).trim()));
      const rows = all.filter((r) => (r.order_no ? touched.has(String(r.order_no).trim()) : rowDay(r) >= startDay));
      const txs = normalizeMoneyTx(rows, row.shop);

      // ก้อนแบบเก่าที่แยกตามวัน (tx_id = เลขออเดอร์@วัน) — ลบทิ้งก่อน ไม่งั้นจำนวนชิ้นนับซ้ำ
      // os_money_items ผูกกับ os_money_tx แบบ cascade หายไปด้วย
      const orders = [...touched];
      for (let i = 0; i < orders.length; i += 200) {
        const { error } = await sb.from('os_money_tx').delete()
          .eq('platform', 'lazada').eq('shop', row.shop)
          .in('order_id', orders.slice(i, i + 200)).like('tx_id', '%@%');
        if (error) throw new Error(error.message);
      }
      if (txs.length) saved = await saveMoneyTx(txs);

      // สร้างใบสรุปรายวันของทั้งช่วงใหม่หมด — ก้อนที่ย้ายวัน (รวมก้อนเก่าเข้าด้วยกัน) จะได้ไม่ทิ้งยอดค้างไว้ที่วันเดิม
      const pFrom = new Date(histFrom).toISOString();
      const pTo = new Date(end + DAY).toISOString();
      const { error: e1 } = await sb.from('os_statements').delete()
        .eq('platform', 'lazada').eq('shop', row.shop).gte('statement_at', pFrom).lt('statement_at', pTo);
      if (e1) throw new Error(e1.message);
      const { data: n, error: e2 } = await sb.rpc('os_rebuild_statements', {
        p_platform: 'lazada', p_shop: row.shop, p_from: pFrom, p_to: pTo,
      });
      if (e2) throw new Error(e2.message);
      statements = n || 0;

      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), fetched: saved, upserted: statements, ok: true })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, from: startDay, lines, orders: touched.size, saved, statements });
    } catch (e) {
      const msg = String(e.message || e);
      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), fetched: saved, ok: false, error: msg })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, saved, error: msg });
    }
  }
  return NextResponse.json({ ok: true, more: false, seconds: Math.round((Date.now() - t0) / 1000), result });
}

export async function GET(req) {
  if (process.env.SYNC_SECRET && new URL(req.url).searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  return run(req);
}
export async function POST(req) { return run(req); }
