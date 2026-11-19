// หน้าถ่ายฟุต (/shoot) — ลูกน้องใช้ได้โดยไม่ต้องรู้รหัสยอดขาย (ด่านระดับ 2 ใน middleware: ล็อกอินเว็บ + มาจากหน้าเว็บเรา)
// จึงทำได้แค่ 2 อย่าง กับงานถ่ายที่มีอยู่แล้วเท่านั้น: ขอที่อยู่อัปไฟล์ของช็อต (start) · ยืนยันว่าอัปเสร็จ (done)
//   start: { id, index, fileName, mime, size } → { uploadUrl, name }  (ไฟล์ไปที่ Drive ตรงๆ ไม่ผ่านที่นี่)
//   done:  { id, index, fileId } → เช็คว่าไฟล์อยู่ใน Drive จริง → ติ๊กช็อต · ครบทุกช็อต = ปิดงานถ่าย + คลิปที่รอฟุตของโฟลเดอร์นั้นเข้าคิวตัด
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/supabase';
import { todayBkk } from '@/lib/studio';
import { MAX_BYTES, extOf, shotFileName, afterShot } from '@/lib/shoot';
import { startUpload, fileInfo, DriveError } from '@/lib/gdrive';

export const dynamic = 'force-dynamic';

const bad = (error, status = 400) => NextResponse.json({ ok: false, error }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function shootOf(id, index) {
  if (!UUID.test(String(id || ''))) throw new DriveError('ไม่พบงานถ่าย');
  const { data, error } = await db().from('os_studio_shoots').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new DriveError('ไม่พบงานถ่าย (อาจถูกลบไปแล้ว) — รีเฟรชหน้า');
  if (!Number.isInteger(index) || index < 0 || index >= (data.shots || []).length) throw new DriveError('ไม่พบช็อตนี้ — รีเฟรชหน้า');
  return data;
}

export async function POST(req) {
  try {
    const b = await req.json();
    const index = Number(b.index);
    if (b.op === 'start') {
      const size = Number(b.size);
      const mime = String(b.mime || '').toLowerCase();
      if (!/^video\/[\w.+-]+$/.test(mime)) return bad('รับเฉพาะไฟล์วิดีโอ');
      if (!Number.isFinite(size) || size <= 0) return bad('ไฟล์ว่าง');
      if (size > MAX_BYTES) return bad('ไฟล์ใหญ่เกิน 2 GB');
      const s = await shootOf(b.id, index);
      const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).replace(/:/g, '');
      const name = shotFileName({ date: todayBkk(), product: s.product, index, shot: s.shots[index], ext: extOf(b.fileName, mime), stamp: now });
      const origin = req.headers.get('origin') || '';
      const { uploadUrl } = await startUpload({ product: s.product, name, mime, size, origin });
      return NextResponse.json({ ok: true, uploadUrl, name });
    }
    if (b.op === 'done') {
      const s = await shootOf(b.id, index);
      await fileInfo(b.fileId);
      const { got, done } = afterShot(s, index);
      const { error } = await db().from('os_studio_shoots').update({ got, done: s.done || done, updated_at: new Date().toISOString() }).eq('id', s.id);
      if (error) throw new Error(error.message);
      let queued = 0;
      if (done && s.folder) {
        const { data } = await db().from('os_studio_clips').update({ status: 'queued', updated_at: new Date().toISOString() })
          .eq('folder', s.folder).eq('status', 'need_footage').select('id');
        queued = data?.length || 0;
      }
      revalidatePath('/shoot'); revalidatePath('/studio');
      return NextResponse.json({ ok: true, got, done, queued });
    }
    return bad('คำสั่งไม่ถูกต้อง');
  } catch (e) {
    return bad(String(e.message || e), e instanceof DriveError ? 400 : 500);
  }
}
