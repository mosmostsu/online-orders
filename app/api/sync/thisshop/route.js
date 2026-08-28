// ดึงออเดอร์ ThisShop — ไม่ต้องผูกร้านก่อน เพราะขอโทเคนใหม่ได้ตลอดด้วย appId+appSecret
import { NextResponse } from 'next/server';
import { fetchOrders, normalizeOrder } from '@/lib/thisshop';
import { upsertOrders } from '@/lib/ingest';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run(req) {
  const url = new URL(req.url);
  const recentDone = Number(url.searchParams.get('done') ?? 30);
  const maxOrders = Number(url.searchParams.get('max') ?? 60);
  const sb = db();
  const started = new Date().toISOString();
  const { data: logRow } = await sb
    .from('os_sync_log')
    .insert({ platform: 'thisshop', shop: 'THISSHOP', started_at: started })
    .select('id').maybeSingle();

  try {
    // เอาเฉพาะรอจัดส่งกับส่งแล้ว — ใบที่ยังไม่จ่ายมีค้างสะสมหลายพันใบ ไม่ใช่งานของเรา
    const orders = await fetchOrders({ recentDone, maxOrders });
    const { upserted } = await upsertOrders(orders.map((o) => normalizeOrder(o)));
    await sb.from('os_sync_log')
      .update({ finished_at: new Date().toISOString(), fetched: orders.length, upserted, ok: true })
      .eq('id', logRow?.id);
    return NextResponse.json({ ok: true, result: [{ shop: 'THISSHOP', fetched: orders.length, upserted }] });
  } catch (e) {
    const msg = String(e.message || e);
    await sb.from('os_sync_log')
      .update({ finished_at: new Date().toISOString(), ok: false, error: msg })
      .eq('id', logRow?.id);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req) {
  if (process.env.SYNC_SECRET && new URL(req.url).searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  return run(req);
}
export async function POST(req) { return run(req); }
