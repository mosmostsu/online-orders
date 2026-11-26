// ปุ่ม "ขอดึงออเดอร์ Shopee MVP" ในหน้า /round — กดจากเครื่องไหนก็ได้ (ต้องล็อกอินเว็บ)
// GET  ?shop=MVP → สถานะคำขอล่าสุด / ดึงล่าสุด / Chrome เครื่อง MVP เปิดอยู่ไหม
// POST { shop }  → ฝากคำขอไว้ ส่วนขยายบนเครื่องที่ล็อกอินร้านนั้นมาเอาไปทำ (ดู /api/mvp/queue)
import { NextResponse } from 'next/server';
import { SHOPEE_NO_API } from '@/lib/shopGroups';
import { pullState, savePull, isPending, SEEN_FRESH_MIN } from '@/lib/mvpPull';

export const dynamic = 'force-dynamic';

const view = (r) => ({
  ok: true,
  requested_at: r.requested_at || null,
  started_at: r.started_at || null,
  done_at: r.done_at || null,
  done_ok: r.ok ?? null,
  message: r.message || null,
  seen_at: r.seen_at || null,
  pending: isPending(r),
  online: !!r.seen_at && Date.now() - Date.parse(r.seen_at) < SEEN_FRESH_MIN * 60000,
});

const shopOf = (v) => {
  const s = String(v || 'MVP').toUpperCase();
  return SHOPEE_NO_API.includes(s) ? s : null;
};
const NO_TABLE = { ok: false, error: 'ยังไม่ได้รัน supabase/070_mvp_pull.sql' };

export async function GET(req) {
  const shop = shopOf(new URL(req.url).searchParams.get('shop'));
  if (!shop) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้าน' }, { status: 400 });
  const r = await pullState(shop);
  return NextResponse.json(r ? view(r) : NO_TABLE);
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const shop = shopOf(body.shop);
  if (!shop) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้าน' }, { status: 400 });
  const r = await pullState(shop);
  if (!r) return NextResponse.json(NO_TABLE);
  try {
    // กดซ้ำระหว่างรอ ไม่ต้องเลื่อนเวลา — คำขอเดิมยังรออยู่
    if (!isPending(r)) await savePull(shop, { requested_at: new Date().toISOString() });
    return NextResponse.json(view(await pullState(shop)));
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
