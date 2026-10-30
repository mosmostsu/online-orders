// ผลเช็ค R02.102 ของหน้ารอบจัดส่ง (/round) ต่อวัน — ทุกเครื่องเห็นเหมือนกัน (ตาราง os_round_r02, supabase/065)
// GET ?d=YYYY-MM-DD → { ok, value } · PUT { day, value } บันทึกทับทั้งวัน (value = null → ลบ)
// อ่านไฟล์ในเบราว์เซอร์แล้วส่งมาแค่รายการใบยิง (ไม่ส่งไฟล์) · PUT ผ่านด่าน Origin ของ middleware.js
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { r02FromRow as toValue } from '@/lib/r02';

export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 20000;


export async function GET(req) {
  const d = new URL(req.url).searchParams.get('d') || '';
  if (!DAY.test(d)) return NextResponse.json({ ok: false, error: 'วันที่ไม่ถูกต้อง' }, { status: 400 });
  const { data, error } = await db().from('os_round_r02').select('*').eq('day', d).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, value: toValue(data) });
}

export async function PUT(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 }); }
  const { day, value } = body || {};
  if (!DAY.test(day || '')) return NextResponse.json({ ok: false, error: 'วันที่ไม่ถูกต้อง' }, { status: 400 });
  const sb = db();
  if (!value) {
    const { error } = await sb.from('os_round_r02').delete().eq('day', day);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, value: null });
  }
  if (!Array.isArray(value.lines) || value.lines.length > MAX_LINES) {
    return NextResponse.json({ ok: false, error: 'รายการใบยิงไม่ถูกต้อง' }, { status: 400 });
  }
  const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  const { data, error } = await sb.from('os_round_r02').upsert({
    day,
    file: String(value.file || '').slice(0, 200),
    uploaded_at: value.at || new Date().toISOString(),
    lines: value.lines,
    fix: obj(value.fix),
    merge: obj(value.merge),
    subs: Array.isArray(value.subs) ? value.subs : [],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'day' }).select('*').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, value: toValue(data) });
}
