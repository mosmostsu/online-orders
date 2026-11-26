// ส่วนขยาย Chrome (extensions/mvp-stock 1.4+) มาเช็คคำขอ "ดึงออเดอร์" ที่หน้า /round ฝากไว้ (os_mvp_pull, supabase/070)
// ทุก 2 นาที — header x-key = MVP_STOCK_KEY (ยกเว้นในด่าน middleware เหมือน mvp/listings)
// GET  ?shop=MVP → บันทึกว่าเครื่องนี้ยังเปิดอยู่ (seen_at) + บอกร้านที่มีคำขอรอ { pending: ['MVP'] }
//      ไม่ส่ง shop (ส่วนขยายยังไม่รู้ว่าล็อกอินร้านไหน) → บอกทุกร้านที่รอ
// POST { shop, ok, message } → ผลของคำขอ (สำเร็จ หรือสาเหตุที่ดึงไม่ได้ เช่น หลุดล็อกอิน)
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { SHOPEE_NO_API } from '@/lib/shopGroups';
import { savePull, isPending } from '@/lib/mvpPull';

export const dynamic = 'force-dynamic';

const authed = (req) => {
  const key = process.env.MVP_STOCK_KEY;
  return key && req.headers.get('x-key') === key;
};

export async function GET(req) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  const shop = String(new URL(req.url).searchParams.get('shop') || '').toUpperCase();
  const now = new Date().toISOString();
  const { data, error } = await db().from('os_mvp_pull').select('*');
  if (error) return NextResponse.json({ ok: false, error: 'ยังไม่ได้รัน supabase/070_mvp_pull.sql' });
  const known = SHOPEE_NO_API.includes(shop);
  if (known) await savePull(shop, { seen_at: now }).catch(() => {});
  const pending = (data || []).filter(isPending).map((r) => r.shop).filter((s) => !known || s === shop);
  for (const s of pending) await savePull(s, { started_at: now }).catch(() => {});
  return NextResponse.json({ ok: true, pending });
}

export async function POST(req) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const shop = String(b.shop || '').toUpperCase();
  if (!SHOPEE_NO_API.includes(shop)) return NextResponse.json({ ok: false, error: 'ไม่รู้จักร้าน' }, { status: 400 });
  try {
    await savePull(shop, { done_at: new Date().toISOString(), ok: !!b.ok, message: String(b.message || '').slice(0, 300) || null });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
