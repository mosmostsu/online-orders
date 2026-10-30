// งานก่อนแพ็คของออเดอร์ (แท็บหมายเหตุในหน้า /round) — supabase/066
// POST { id, note?, done?, by? } · ส่ง note = '' ลบงาน (และล้างติ๊ก) · done true/false = ติ๊ก/เอาติ๊กออก
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { id, note, done, by } = await req.json();
    if (!Number.isInteger(id)) return NextResponse.json({ ok: false, error: 'ไม่ได้ระบุออเดอร์' }, { status: 400 });
    const who = String(by || '').trim().slice(0, 60) || null;
    const now = new Date().toISOString();
    const patch = {};
    if (note !== undefined) {
      const text = String(note || '').trim().slice(0, 500);
      Object.assign(patch, text
        ? { pack_note: text, pack_note_by: who, pack_note_at: now }
        : { pack_note: null, pack_note_by: null, pack_note_at: null, pack_done_at: null, pack_done_by: null });
    }
    if (done !== undefined) Object.assign(patch, done ? { pack_done_at: now, pack_done_by: who } : { pack_done_at: null, pack_done_by: null });
    if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: 'ไม่มีอะไรให้บันทึก' }, { status: 400 });
    const { data, error } = await db().from('os_orders').update(patch).eq('id', id)
      .select('id, pack_note, pack_note_by, pack_note_at, pack_done_at, pack_done_by').single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, row: data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
