// ถามสั้นๆ ว่าโค้ดที่สแกนได้ตรงกับออเดอร์ไหน — ตอบแค่เลขออเดอร์
// มีไว้เพื่อให้ตัวสแกนพาไปหน้าออเดอร์ได้เอง ไม่ต้องวิ่งผ่านหน้ารายการแล้วให้เซิร์ฟเวอร์สั่งเด้งต่อ
// (การสั่งเด้งฝั่งเซิร์ฟเวอร์ไม่ทำงานบนเบราว์เซอร์ของ iPhone)
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ ok: false, error: 'ไม่มีโค้ด' }, { status: 400 });

  const sb = db();
  const like = `*${q.replace(/[%*,()]/g, '')}*`;

  // เลขพัสดุกับเลขออเดอร์คือสองอย่างที่อยู่บนใบปะหน้า ถามทั้งคู่พร้อมกัน
  const [byTracking, byOrder] = await Promise.all([
    sb.from('os_orders').select('order_id').ilike('tracking_no', like).limit(2),
    sb.from('os_orders').select('order_id').ilike('order_id', like).limit(2),
  ]);

  const hits = [...new Set([
    ...(byTracking.data || []).map((r) => r.order_id),
    ...(byOrder.data || []).map((r) => r.order_id),
  ])];

  // ตรงใบเดียวเท่านั้นถึงพาไปเลย ถ้าตรงหลายใบต้องให้คนเลือกเองในหน้ารายการ
  return NextResponse.json({ ok: true, order_id: hits.length === 1 ? hits[0] : null, matched: hits.length });
}
