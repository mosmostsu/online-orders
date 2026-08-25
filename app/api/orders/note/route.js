// บันทึก/ลบคอมเมนต์ของออเดอร์
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const form = await req.formData();
    const orderId = String(form.get('order_id') || '');
    const note = String(form.get('note') || '').trim();
    const by = String(form.get('by') || '').trim();
    if (!orderId) return NextResponse.json({ ok: false, error: 'ไม่ได้ระบุออเดอร์' }, { status: 400 });

    const patch = note
      ? { note, note_by: by || null, note_at: new Date().toISOString() }
      : { note: null, note_by: null, note_at: null };   // ส่งข้อความว่าง = ลบคอมเมนต์

    const { error } = await db().from('os_orders').update(patch).eq('order_id', orderId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
