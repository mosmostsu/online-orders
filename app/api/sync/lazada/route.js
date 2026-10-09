// ดึงออเดอร์ Lazada ของทุกร้านที่ผูกไว้ → เก็บลง DB
// โครงเดียวกับฝั่ง Shopee/TikTok ต่างแค่ตัวที่ไปคุยกับแพลตฟอร์ม
import { NextResponse } from 'next/server';
import { fetchOrders, normalizeOrder } from '@/lib/lazada';
import { listShops, usableToken } from '@/lib/tokens';
import { upsertOrders } from '@/lib/ingest';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FALLBACK_MINUTES = 30;
const OVERLAP_MINUTES = 5;

async function sinceFromLastRun(sb, shop) {
  const { data } = await sb
    .from('os_sync_log')
    .select('started_at')
    .eq('platform', 'lazada').eq('shop', shop).eq('ok', true)
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!data?.started_at) return Date.now() - FALLBACK_MINUTES * 60000;
  return new Date(data.started_at).getTime() - OVERLAP_MINUTES * 60000;
}

async function run(req) {
  const url = new URL(req.url);
  const sb = db();
  const days = Number(url.searchParams.get('days') || 0);
  const forced = days ? days * 1440 : Number(url.searchParams.get('minutes') || 0);
  let shops = await listShops('lazada');
  const only = url.searchParams.get('shop');
  if (only) shops = shops.filter((s) => s.shop === only);
  if (!shops.length) {
    return NextResponse.json({ ok: false, error: 'ยังไม่มีร้าน Lazada ที่ผูกไว้ — เปิด /api/auth/lazada?shop=SOLID ก่อน' }, { status: 400 });
  }

  const result = [];
  for (const row of shops) {
    const { data: logRow } = await sb
      .from('os_sync_log')
      .insert({ platform: 'lazada', shop: row.shop, started_at: new Date().toISOString() })
      .select('id').maybeSingle();
    try {
      const since = forced ? Date.now() - forced * 60000 : await sinceFromLastRun(sb, row.shop);
      const tok = await usableToken(row);
      const orders = await fetchOrders({ accessToken: tok.access_token, since });
      const { upserted } = await upsertOrders(orders.map((o) => normalizeOrder(o, row.shop)));
      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), fetched: orders.length, upserted, ok: true })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, fetched: orders.length, upserted });
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
  if (process.env.SYNC_SECRET && new URL(req.url).searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  return run(req);
}
export async function POST(req) { return run(req); }
