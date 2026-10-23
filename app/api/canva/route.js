// ตัดพื้นหลังด้วย Canva — หน้าสร้างปก (app/product/CoverMaker.js) วนถามทีละขั้น (lib/canva.js)
// GET                                      → { ok, connected } เชื่อมบัญชีแล้วหรือยัง
// POST { action: 'start', data: base64 }   → { ok, job } | { ok, asset, w, h }   อัปรูป + สั่งตัดพื้น
// POST { action: 'status', job | asset }   → { ok, pending } | { ok, export } | { ok, url }
// POST { action: 'export', id }            → { ok, pending } | { ok, url }   url = PNG พื้นใส (โหลดผ่าน /api/xclone/img)
// ต้องปลดล็อกรหัสยอดขาย (middleware.js) — ใช้เครดิต AI ของบัญชี Canva ร้าน
import { NextResponse } from 'next/server';
import { canvaConnected, cutStart, cutStatus, cutExport, CanvaError } from '@/lib/canva';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

const id = (x) => /^[a-zA-Z0-9_-]{1,60}$/.test(String(x || ''));

export async function GET() {
  return NextResponse.json({ ok: true, connected: await canvaConnected() });
}

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === 'start') {
      const bytes = Buffer.from(String(b.data || ''), 'base64');
      if (!bytes.length) return NextResponse.json({ ok: false, error: 'ไม่มีรูป' }, { status: 400 });
      if (bytes.length > 20 * 1024 * 1024) return NextResponse.json({ ok: false, error: 'รูปใหญ่เกิน 20MB' }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await cutStart(bytes)) });
    }
    if (b.action === 'status') {
      if (!id(b.job) && !id(b.asset)) return NextResponse.json({ ok: false, error: 'job ไม่ถูกต้อง' }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await cutStatus({ job: id(b.job) ? b.job : null, asset: id(b.asset) ? b.asset : null, w: Number(b.w) || null, h: Number(b.h) || null })) });
    }
    if (b.action === 'export') {
      if (!id(b.id)) return NextResponse.json({ ok: false, error: 'export ไม่ถูกต้อง' }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await cutExport(b.id)) });
    }
    return NextResponse.json({ ok: false, error: 'action ไม่ถูกต้อง' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: e instanceof CanvaError ? 400 : 500 });
  }
}
