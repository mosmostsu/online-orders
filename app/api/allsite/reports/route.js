// รายงานที่บันทึกไว้ของหน้า /allsite/report (supabase/044)
// GET = รายการรายงานล่าสุด · POST {name, skus} = บันทึกรายงานใหม่ คืน id ไว้ทำลิงก์
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const MAX_SKUS = 5000;

export async function GET() {
  const { data, error } = await db().from('os_allsite_reports')
    .select('id, name, skus, done, created_at, updated_at')
    .order('updated_at', { ascending: false }).limit(50);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  // ไม่ต้องส่งรหัสทั้งก้อนมาในรายการ — แค่จำนวน
  const reports = (data || []).map((r) => ({
    id: r.id, name: r.name, skus: r.skus.length, done: r.done.length, created_at: r.created_at, updated_at: r.updated_at,
  }));
  return NextResponse.json({ ok: true, reports });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 120);
  const skus = [...new Set((body.skus || []).map(String).filter(Boolean))].slice(0, MAX_SKUS);
  if (!name) return NextResponse.json({ ok: false, error: 'ต้องตั้งชื่อรายงาน' }, { status: 400 });
  if (!skus.length) return NextResponse.json({ ok: false, error: 'ยังไม่ได้เลือกสินค้า' }, { status: 400 });
  const { data, error } = await db().from('os_allsite_reports').insert({ name, skus }).select('id').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
