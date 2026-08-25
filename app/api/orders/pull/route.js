// ยืนยันว่า "หยิบของออกจากกองแล้ว" พร้อมรูปหลักฐาน
// ลูกน้องกดจากหน้า /orders?status=risky บนมือถือได้เลย
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req) {
  try {
    const form = await req.formData();
    const orderId = String(form.get('order_id') || '');
    const by = String(form.get('by') || '').trim();
    const note = String(form.get('note') || '').trim();
    const photo = form.get('photo');
    const undo = form.get('undo') === '1';

    if (!orderId) return NextResponse.json({ ok: false, error: 'ไม่ได้ระบุออเดอร์' }, { status: 400 });

    const sb = db();

    // กดผิด — ล้างการยืนยันออก (รูปเก่ายังอยู่ใน storage เผื่อต้องย้อนดู)
    if (undo) {
      const { error } = await sb
        .from('os_orders')
        .update({ pulled_at: null, pulled_by: null, pull_note: null })
        .eq('order_id', orderId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, undone: true });
    }

    if (!by) return NextResponse.json({ ok: false, error: 'ใส่ชื่อคนที่หยิบด้วย' }, { status: 400 });

    let path = null;
    if (photo && typeof photo === 'object' && photo.size > 0) {
      const ext = (photo.type || '').includes('png') ? 'png' : 'jpg';
      path = `${orderId}/${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage
        .from('proofs')
        .upload(path, photo, { contentType: photo.type || 'image/jpeg', upsert: false });
      if (upErr) throw new Error('อัปโหลดรูปไม่สำเร็จ: ' + upErr.message);
    }

    const patch = { pulled_at: new Date().toISOString(), pulled_by: by, pull_note: note || null };
    if (path) patch.pull_photo = path;

    const { error } = await sb.from('os_orders').update(patch).eq('order_id', orderId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, pulled_at: patch.pulled_at, photo: path });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
