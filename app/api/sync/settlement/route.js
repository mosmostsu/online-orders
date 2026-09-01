// ดึง "เงินที่ได้รับจริง" ของออเดอร์ที่ส่งของออกไปแล้ว → เก็บลง os_settlements
//
// แยกรอบจากการดึงออเดอร์โดยตั้งใจ:
//   • ออเดอร์ต้องสดทุก 5 นาที (ไว้จับยกเลิก) แต่ยอดเงินนิ่งอยู่แล้ว วันละครั้งพอ
//   • Finance API ต้องยิงทีละใบ ถ้าเอาไปปนรอบหลักจะทำให้รอบดึงออเดอร์ช้าจนเลยเวลา
//
// เรียกได้ 2 ทาง: ปุ่มบนหน้าเว็บ (POST) หรือ cron ยิงมาพร้อม ?key=SYNC_SECRET
import { NextResponse } from 'next/server';
import { getOrderSettlement, normalizeSettlement } from '@/lib/tiktok';
import { saveSettlements, pendingRow } from '@/lib/settlement';
import { listShops, usableToken } from '@/lib/tokens';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_LIMIT = 40;    // ใบต่อรอบ — ยิงทีละใบ ต้องเผื่อเวลาให้จบใน 60 วินาที
const GAP_MS = 120;          // เว้นจังหวะระหว่างใบ กันโดนเตะเรื่องยิงถี่เกิน
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(req) {
  const url = new URL(req.url);
  const shopFilter = url.searchParams.get('shop') || null;
  const limit = Math.min(200, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT);
  // ปกติใบที่ถามแล้วยังไม่ปิดยอดจะพัก 12 ชั่วโมงก่อนถามใหม่ — ใส่ ?now=1 เพื่อถามซ้ำทันที
  const cooldown = url.searchParams.get('now') ? '0 seconds' : '12 hours';

  const sb = db();
  const shops = await listShops('tiktok');
  const rows = shopFilter ? shops.filter((s) => s.shop === shopFilter) : shops;
  if (!rows.length) {
    return NextResponse.json({ ok: false, error: 'ยังไม่มีร้าน TikTok ที่ผูกไว้' }, { status: 400 });
  }

  const result = [];
  for (const row of rows) {
    const { data: logRow } = await sb
      .from('os_sync_log')
      .insert({ platform: 'money:tiktok', shop: row.shop, started_at: new Date().toISOString() })
      .select('id').maybeSingle();

    try {
      const { data: todo, error } = await sb.rpc('os_settlement_todo', {
        p_platform: 'tiktok', p_shop: row.shop, p_limit: limit, p_cooldown: cooldown,
      });
      if (error) throw new Error(error.message);

      const tok = await usableToken(row);
      const out = [];
      let settled = 0, waiting = 0;

      for (const job of todo || []) {
        try {
          const data = await getOrderSettlement({
            accessToken: tok.access_token, shopCipher: tok.shop_cipher, orderId: job.oid,
          });
          const rec = normalizeSettlement(data, {
            orderRef: job.ref, shop: row.shop, orderId: job.oid,
          });
          out.push(rec);
          rec.settled ? settled++ : waiting++;
        } catch (e) {
          // ยังไม่ถึงรอบปิดยอด = ปกติ ไม่ใช่ความผิดพลาด แค่จดว่าถามแล้วรอบหน้าค่อยมาใหม่
          out.push(pendingRow({
            orderRef: job.ref, platform: 'tiktok', shop: row.shop,
            orderId: job.oid, error: e.message,
          }));
          waiting++;
        }
        await sleep(GAP_MS);
      }

      await saveSettlements(out);
      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), fetched: out.length, upserted: settled, ok: true })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, asked: out.length, settled, waiting });
    } catch (e) {
      const msg = String(e.message || e);
      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), ok: false, error: msg })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, error: msg });
    }
  }

  return NextResponse.json({ ok: true, result });
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
