// ดึง "เงินที่ได้รับจริง" จากใบสรุปรายวันของ TikTok → os_statements + os_money_tx
//
// ทำงานเป็นสองขั้น:
//   1. ขอรายการใบสรุปช่วง 30 วันล่าสุด (ครั้งเดียว) — ได้ยอดโอนรายวันทันที
//   2. ไล่ดึงรายออเดอร์ในใบที่ยังดึงไม่ครบ ทีละ 100 รายการ
//
// ข้อจำกัดที่ต้องออกแบบรอบ: Netlify ฆ่า function ที่ ~26 วินาที
// ถ้าโดนฆ่าก่อนบันทึก งานทั้งรอบหายหมด (รุ่นแรกเจอแบบนี้ทุกรอบ ได้ศูนย์ใบ)
// จึงบันทึกทุกหน้าที่ได้มา + จำ page_token ไว้ในใบสรุป แล้วหยุดเองเมื่อใกล้หมดเวลา
// รอบถัดไป (cron รายชั่วโมง หรือปุ่มกดซ้ำ) ทำต่อจากหน้าที่ค้างไว้
//
// เรียกได้ 2 ทาง: ปุ่มบนหน้าเว็บ (POST) หรือ cron ยิงมาพร้อม ?key=SYNC_SECRET
import { NextResponse } from 'next/server';
import { listStatements, getStatementPage, normalizeStatement, normalizeMoneyTx } from '@/lib/tiktok';
import { saveStatements, saveMoneyTx } from '@/lib/settlement';
import { listShops, usableToken } from '@/lib/tokens';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TIME_BUDGET_MS = 17000;   // หยุดรับหน้าใหม่เมื่อเลยเท่านี้ — หนึ่งหน้าใช้ ~1-2 วินาที เหลือเผื่อก่อน 26
const LOOKBACK_DAYS = 30;
const LOCK_MS = 60000;          // รอบก่อนเริ่มไม่ถึงนาทีและยังไม่จบ = ยังวิ่งอยู่ อย่าแย่งกันเขียน cursor

async function isRunning(sb) {
  const { data } = await sb.from('os_sync_log')
    .select('started_at, finished_at')
    .eq('platform', 'money:tiktok')
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!data || data.finished_at) return false;
  return Date.now() - new Date(data.started_at).getTime() < LOCK_MS;
}

async function run(req) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const shopFilter = url.searchParams.get('shop') || null;
  const days = Math.min(90, Number(url.searchParams.get('days')) || LOOKBACK_DAYS);
  const sb = db();

  if (await isRunning(sb)) {
    return NextResponse.json({ ok: true, skipped: 'รอบก่อนยังทำงานอยู่', more: true });
  }

  const shops = (await listShops('tiktok')).filter((s) => !shopFilter || s.shop === shopFilter);
  if (!shops.length) {
    return NextResponse.json({ ok: false, error: 'ยังไม่มีร้าน TikTok ที่ผูกไว้' }, { status: 400 });
  }

  const result = [];
  let more = false;

  for (const row of shops) {
    const { data: logRow } = await sb.from('os_sync_log')
      .insert({ platform: 'money:tiktok', shop: row.shop, started_at: new Date().toISOString() })
      .select('id').maybeSingle();

    let pages = 0, saved = 0;
    try {
      const tok = await usableToken(row);
      const auth = { accessToken: tok.access_token, shopCipher: tok.shop_cipher };

      // ขั้น 1: ใบสรุป — ยิงครั้งเดียวได้ครบทั้งเดือน
      const stmts = await listStatements({ ...auth, since: Date.now() - days * 86400000, until: Date.now() });
      await saveStatements(stmts.map((s) => normalizeStatement(s, row.shop)));

      // ขั้น 2: ใบที่ยังดึงรายการไม่ครบ — ใหม่สุดก่อน คนเปิดดูมักสนใจเงินวันล่าสุด
      const { data: pending, error } = await sb.from('os_statements')
        .select('statement_id, statement_at, payment_status, cursor, tx_synced')
        .eq('platform', 'tiktok').eq('shop', row.shop).eq('done', false)
        .order('statement_at', { ascending: false });
      if (error) throw new Error(error.message);

      outer:
      for (const st of pending || []) {
        let cursor = st.cursor || '';
        let synced = st.tx_synced || 0;
        let retried = false;

        for (;;) {
          if (Date.now() - t0 > TIME_BUDGET_MS) break outer;

          let data;
          try {
            data = await getStatementPage({ ...auth, statementId: st.statement_id, pageToken: cursor });
          } catch (e) {
            // page_token เก่าอาจหมดอายุข้ามชั่วโมง — เริ่มใบนั้นใหม่ได้ เพราะบันทึกซ้ำไม่เกิดแถวซ้ำ
            if (cursor && !retried) { cursor = ''; synced = 0; retried = true; continue; }
            throw e;
          }

          const rows = (data.transactions || []).map((t) =>
            normalizeMoneyTx(t, { shop: row.shop, statementId: st.statement_id, statementAt: st.statement_at }));
          await saveMoneyTx(rows);
          pages++;
          saved += rows.length;
          synced += rows.length;

          const next = data.next_page_token || '';
          // ใบที่แพลตฟอร์มยังไม่โอน ตัวเลขอาจยังขยับ — อ่านจบแล้วก็ยังไม่ปิด รอบหน้าอ่านใหม่
          const done = !next && st.payment_status === 'SETTLED';
          const { error: e2 } = await sb.from('os_statements').update({
            tx_total: data.total_count ?? null,
            tx_synced: next ? synced : (data.total_count ?? synced),
            cursor: next || null,
            done,
            synced_at: new Date().toISOString(),
          }).eq('platform', 'tiktok').eq('shop', row.shop).eq('statement_id', st.statement_id);
          if (e2) throw new Error(e2.message);

          if (!next) break;
          cursor = next;
        }
      }

      const { count: left } = await sb.from('os_statements')
        .select('statement_id', { count: 'exact', head: true })
        .eq('platform', 'tiktok').eq('shop', row.shop).eq('done', false);
      if (left) more = true;

      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), fetched: saved, upserted: pages, ok: true })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, statements: stmts.length, pages, saved, left: left || 0 });
    } catch (e) {
      const msg = String(e.message || e);
      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), fetched: saved, upserted: pages, ok: false, error: msg })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, pages, saved, error: msg });
    }
  }

  return NextResponse.json({ ok: true, more, seconds: Math.round((Date.now() - t0) / 1000), result });
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
