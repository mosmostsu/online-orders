// ข้อมูลของ SKU ที่เลือกไว้ — หน้า /allsite/report (เปิดในแท็บใหม่) ส่งรายการรหัสมา
// คืนชื่อ แบรนด์ หมวด คงเหลือ ราคา จาก ST + ลงแต่ละร้านแล้วหรือยัง (os_st_on)
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { shopsFrom } from '@/lib/listings';

export const dynamic = 'force-dynamic';

const MAX = 5000;
const CHUNK = 300;   // ใส่ in(...) ทีละไม่มาก ลิงก์คำขอจะได้ไม่ยาวเกิน

export async function POST(req) {
  try {
    return await rowsOf(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

async function rowsOf(req) {
  const body = await req.json().catch(() => ({}));
  const skus = [...new Set((body.skus || []).map((s) => String(s)).filter(Boolean))].slice(0, MAX);
  const sb = db();
  const { data: shopList } = await sb.rpc('os_listing_shops');
  const shops = shopsFrom(shopList).map((s) => ({ platform: s.platform, shop: s.shop }));
  if (!skus.length) return NextResponse.json({ ok: true, shops, rows: [] });

  const chunks = [];
  for (let i = 0; i < skus.length; i += CHUNK) chunks.push(skus.slice(i, i + CHUNK));
  const st = [];
  const on = new Set();
  await Promise.all(chunks.map(async (c) => {
    const lows = c.map((s) => s.trim().toLowerCase());
    const [a, b] = await Promise.all([
      sb.from('os_st').select('sku, name, group_name, brand, cat, qty, price').in('sku', c),
      sb.from('os_st_on').select('lsku, platform, shop').in('lsku', lows),
    ]);
    if (a.error) throw new Error(a.error.message);
    st.push(...(a.data || []));
    for (const r of b.data || []) on.add(`${r.lsku}|${r.platform}|${r.shop}`);
  }));

  const rows = st.map((r) => {
    const l = r.sku.trim().toLowerCase();
    return { ...r, qty: Number(r.qty) || 0, on: shops.map((s) => on.has(`${l}|${s.platform}|${s.shop}`)) };
  });
  return NextResponse.json({ ok: true, shops, rows });
}
