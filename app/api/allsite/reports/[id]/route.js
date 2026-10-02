// รายงานเดียว — GET อ่าน · PATCH {key, on} ติ๊ก/เอาติ๊ก "ทำแล้ว" ทีละแถว หรือ {name} เปลี่ยนชื่อ · DELETE ลบ
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_req, { params }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: 'ลิงก์รายงานไม่ถูกต้อง' }, { status: 400 });
  const { data, error } = await db().from('os_allsite_reports').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'ไม่พบรายงานนี้ (อาจถูกลบไปแล้ว)' }, { status: 404 });
  return NextResponse.json({ ok: true, report: data });
}

export async function PATCH(req, { params }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: 'ลิงก์รายงานไม่ถูกต้อง' }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const sb = db();
  if (typeof body.name === 'string' && body.name.trim()) {
    const { error } = await sb.from('os_allsite_reports')
      .update({ name: body.name.trim().slice(0, 120), updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (typeof body.key !== 'string' || !body.key) return NextResponse.json({ ok: false, error: 'ไม่มีแถวที่จะติ๊ก' }, { status: 400 });
  // ติ๊กทีละแถวในฐานข้อมูล — สองคนติ๊กพร้อมกันคนละแถวไม่ทับกัน (supabase/044)
  const { data, error } = await sb.rpc('os_report_mark', { p_id: id, p_key: body.key, p_on: Boolean(body.on) });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, done: data || [] });
}

export async function DELETE(_req, { params }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: 'ลิงก์รายงานไม่ถูกต้อง' }, { status: 400 });
  const { error } = await db().from('os_allsite_reports').delete().eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
