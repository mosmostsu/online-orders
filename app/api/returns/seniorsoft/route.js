// ไฟล์นำเข้า Seniorsoft จากของคืนที่รับแล้ว — "รหัส<TAB>จำนวน" (ดู lib/returns seniorsoftLines)
//   GET                       กล่องที่รับแล้วแต่ยังไม่เคยส่งไฟล์ (ss_at ว่าง) → { boxes, rows, noSku, text }
//   POST { ids }              ทำไฟล์จากกล่องที่ติ๊กเลือก (ส่งไปแล้วก็ทำซ้ำได้ เผื่อไฟล์หาย)
//   POST { ids, mark:true }   จดว่าส่งแล้ว — หน้าเว็บเรียกหลังบันทึกไฟล์ลงโฟลเดอร์สำเร็จ
// ต้องรัน supabase/070_returns_seniorsoft.sql ก่อน (คอลัมน์ ss_at)
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { seniorsoftLines, toSeniorsoft } from '@/lib/returns';

export const dynamic = 'force-dynamic';

const COLS = 'id, order_id, items, missing, recv, received_at, received_by';

function fail(e) {
  const msg = String(e?.message || e);
  if (/ss_at/.test(msg)) {
    return NextResponse.json({ ok: false, needSql: true, error: 'ต้องรัน supabase/070_returns_seniorsoft.sql ใน Supabase ก่อน' });
  }
  return NextResponse.json({ ok: false, error: msg }, { status: 500 });
}

function pack(boxes) {
  const { rows, noSku } = seniorsoftLines(boxes);
  return {
    ok: true, ids: boxes.map((b) => b.id), boxes: boxes.length, rows, noSku,
    pieces: rows.reduce((s, r) => s + r.qty, 0), text: toSeniorsoft(rows),
  };
}

export async function GET() {
  try {
    const { data, error } = await db().from('os_returns').select(COLS)
      .not('recv', 'is', null).is('ss_at', null)
      .order('received_at', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    return NextResponse.json(pack(data || []));
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean).slice(0, 1000);
    if (!ids.length) return NextResponse.json({ ok: false, error: 'ไม่ได้ระบุกล่อง' }, { status: 400 });
    const sb = db();
    if (body.mark) {
      const { error } = await sb.from('os_returns').update({ ss_at: new Date().toISOString() })
        .in('id', ids).not('recv', 'is', null);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, marked: ids.length });
    }
    const { data, error } = await sb.from('os_returns').select(COLS).in('id', ids);
    if (error) throw new Error(error.message);
    return NextResponse.json(pack((data || []).filter((b) => b.recv)));
  } catch (e) { return fail(e); }
}
