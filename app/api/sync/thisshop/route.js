// ดึงออเดอร์ ThisShop — ไม่ต้องผูกร้านก่อน เพราะขอโทเคนใหม่ได้ตลอดด้วย appId+appSecret
import { NextResponse } from 'next/server';
import { fetchOrders, normalizeOrder } from '@/lib/thisshop';
import { upsertOrders } from '@/lib/ingest';
import { autoZeroFromOrders } from '@/lib/autoZero';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ใบที่เพิ่งเข้ามาหรือเปลี่ยนสถานะตั้งแต่รอบก่อน — ใบรอส่งเดิมที่ค้างอยู่ไม่ต้องส่งให้ตัดคลังซ้ำทุกรอบ
// (ไฟล์ ST ใหม่มาที ใบเก่าทั้งกองจะทำให้ได้แจ้ง "ตัด" รหัสที่ ST เป็น 0 อยู่แล้วซ้ำอีกรอบ)
async function changedOnly(sb, records) {
  if (!records.length) return [];
  const { data, error } = await sb.from('os_orders')
    .select('order_id, status')
    .eq('platform', 'thisshop')
    .in('order_id', records.map((r) => r.order.order_id));
  if (error) throw new Error('อ่านสถานะออเดอร์เดิมไม่สำเร็จ: ' + error.message);
  const prev = new Map((data || []).map((o) => [o.order_id, o.status]));
  return records.filter((r) => prev.get(r.order.order_id) !== r.order.status);
}

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
    const records = orders.map((o) => normalizeOrder(o));
    // ต้องเทียบก่อนบันทึก ไม่งั้นทุกใบจะดูเหมือนไม่เปลี่ยน
    const fresh = await changedOnly(sb, records);
    const { upserted } = await upsertOrders(records);
    // ตัดคลังร้านอื่น (และ ThisShop เอง) เมื่อออเดอร์ ThisShop ทำให้ของหมด — ThisShop ไม่มี webhook จึงทำในรอบดึงนี้
    // ไม่ได้ดึงใบยกเลิก (สถานะ 0) มาเลย จึงไม่มีการคืนคลังจากฝั่ง ThisShop
    if (fresh.length) {
      try { await autoZeroFromOrders(fresh); } catch (e) { console.error('ตัดคลังอัตโนมัติไม่สำเร็จ:', e.message); }
    }
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
