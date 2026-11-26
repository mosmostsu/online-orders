// ไฟล์คืนสต็อก Seniorsoft จากแท็บ "⚠️ ยกเลิกก่อนขนส่งเข้ารับ" — ของถูกยิงออกใน Seniorsoft ตอนตัดรอบไปแล้ว
// พอยกเลิกแล้วหยิบของออกจากกอง ต้องเอาเข้าใหม่ · รูปแบบเดียวกับของตีคืน "รหัส<TAB>จำนวน" (lib/returns seniorsoftLines)
//   GET                     ใบที่หยิบออกแล้วแต่ยังไม่เคยส่งไฟล์ (ss_at ว่าง) → { orders, rows, pieces, noSku, text, ids }
//   POST { ids, mark:true } จดว่าส่งแล้ว (ids = เลขออเดอร์) — หน้าเว็บเรียกหลังบันทึกไฟล์สำเร็จ
// ไม่เอาใบที่หยิบแล้วเจอว่า "ของหมด" (ไม่มีของให้คืน) · ต้องรัน supabase/071_risky_seniorsoft.sql ก่อน
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { seniorsoftLines, toSeniorsoft } from '@/lib/returns';

export const dynamic = 'force-dynamic';

const NO_STOCK = 'ของหมด';   // ตรงกับตัวเลือกใน app/orders/PullForm.js

function fail(e) {
  const msg = String(e?.message || e);
  if (/ss_at/.test(msg)) {
    return NextResponse.json({ ok: false, needSql: true, error: 'ต้องรัน supabase/071_risky_seniorsoft.sql ใน Supabase ก่อน' });
  }
  return NextResponse.json({ ok: false, error: msg }, { status: 500 });
}

export async function GET() {
  try {
    const { data, error } = await db().from('os_orders')
      .select('order_id, pull_note, os_order_items(sku, product_name, qty)')
      .eq('status', 'cancelled').is('collected_at', null)
      .or('rts_at.not.is.null,cancelled_from.eq.packed')       // ตัวเดียวกับแท็บ ⚠️ ในหน้า /orders
      .not('pulled_at', 'is', null).is('ss_at', null)
      .or(`pull_note.is.null,pull_note.neq.${NO_STOCK}`)
      .order('pulled_at', { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    const orders = data || [];
    const boxes = orders.map((o) => ({
      recv: 'full',
      items: (o.os_order_items || []).map((i) => ({ sku: i.sku, name: i.product_name, qty: i.qty })),
    }));
    const { rows, noSku } = seniorsoftLines(boxes);
    return NextResponse.json({
      ok: true, orders: orders.length, ids: orders.map((o) => o.order_id), rows, noSku,
      pieces: rows.reduce((s, r) => s + r.qty, 0), text: toSeniorsoft(rows),
    });
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean).slice(0, 500);
    if (!body.mark || !ids.length) return NextResponse.json({ ok: false, error: 'ไม่ได้ระบุออเดอร์' }, { status: 400 });
    const { error } = await db().from('os_orders').update({ ss_at: new Date().toISOString() })
      .in('order_id', ids).eq('status', 'cancelled').not('pulled_at', 'is', null);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, marked: ids.length });
  } catch (e) { return fail(e); }
}
