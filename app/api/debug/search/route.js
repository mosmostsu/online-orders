// ตัวช่วยหาสาเหตุตอนค้นหาไม่เจอ — รันตรรกะเดียวกับหน้ารายการแล้วบอกว่าแต่ละขั้นได้อะไร
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const term = (new URL(req.url).searchParams.get('q') || '').trim();
  if (!term) return NextResponse.json({ error: 'ใส่ ?q=' }, { status: 400 });

  const sb = db();
  const like = `*${term.replace(/[%*,()]/g, '')}*`;
  const items = () => sb.from('os_order_items').select('order_ref').limit(600);
  const ords = () => sb.from('os_orders').select('id').limit(600);

  const [bySku, byName, byOrderId, byTracking, byBuyer] = await Promise.all([
    items().ilike('sku', like),
    items().ilike('product_name', like),
    ords().ilike('order_id', like),
    ords().ilike('tracking_no', like),
    ords().ilike('buyer', like),
  ]);

  const step = (r) => ({ found: r.data?.length ?? 0, error: r.error?.message ?? null });
  const ids = [...new Set([
    ...(bySku.data || []).map((h) => h.order_ref),
    ...(byName.data || []).map((h) => h.order_ref),
    ...(byOrderId.data || []).map((h) => h.id),
    ...(byTracking.data || []).map((h) => h.id),
    ...(byBuyer.data || []).map((h) => h.id),
  ])];

  const { data, count, error } = await sb
    .from('os_orders')
    .select('id, order_id', { count: 'exact' })
    .in('id', ids.length ? ids : [-1])
    .limit(5);

  return NextResponse.json({
    term, like,
    ขั้นที่1: { sku: step(bySku), ชื่อสินค้า: step(byName), เลขออเดอร์: step(byOrderId), เลขพัสดุ: step(byTracking), ผู้รับ: step(byBuyer) },
    ขั้นที่2: { รวมได้: ids.length, ตัวอย่าง: ids.slice(0, 5) },
    ขั้นที่3: { นับได้: count ?? 0, ตัวอย่าง: (data || []).map((d) => d.order_id), error: error?.message ?? null },
  });
}
