// จับเวลาแต่ละคิวรีของหน้าเงินเข้า วัดจากฝั่งเซิร์ฟเวอร์จริง
//
// วัดจากเครื่องที่บ้านไม่ได้ เพราะเน็ตไปหา Supabase ช้ากว่าที่ Netlify วิ่ง
// ตัวนี้รันบน Netlify เหมือนหน้าเว็บ ตัวเลขที่ได้จึงเทียบกันได้
//   /api/debug/timing?key=SYNC_SECRET&days=30
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  if (process.env.SYNC_SECRET && url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const days = Number(url.searchParams.get('days')) || 30;
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const to = new Date(Date.now() + 86400000).toISOString();
  const sb = db();
  const out = {};

  const time = async (name, fn) => {
    const t = Date.now();
    const res = await fn();
    out[name] = { ms: Date.now() - t, rows: Array.isArray(res?.data) ? res.data.length : undefined, error: res?.error?.message };
    return res;
  };

  await time('money_totals', () => sb.rpc('os_money_totals', { p_from: from, p_to: to, p_platform: 'tiktok', p_shop: null }));
  await time('money_daily', () => sb.rpc('os_money_daily', { p_from: from, p_to: to, p_platform: 'tiktok', p_shop: null }));
  const prod = await time('by_product', () => sb.rpc('os_money_by_product', {
    p_from: from, p_to: to, p_platform: 'tiktok', p_sort: 'qty', p_min_qty: 1, p_limit: 1000,
  }));
  await time('costs_for', () => sb.rpc('os_costs_for', { p_from: from, p_to: to, p_platform: 'tiktok' }));
  await time('sync_log', () => sb.from('os_sync_log').select('*').eq('platform', 'money:tiktok')
    .order('started_at', { ascending: false }).limit(1).maybeSingle());
  await time('statements_pending', () => sb.from('os_statements').select('statement_id', { count: 'exact', head: true })
    .eq('platform', 'tiktok').eq('done', false));

  const ids = (prod?.data?.rows || []).map((r) => r.product_id).filter(Boolean);
  await time('product_covers', () => sb.from('os_products').select('product_id, thumb_url, cover_url')
    .eq('platform', 'tiktok').in('product_id', ids));

  out.total_ms = Object.values(out).reduce((s, v) => s + (v.ms || 0), 0);
  out.baskets = (prod?.data?.rows || []).length;
  out.payload_kb = Math.round(JSON.stringify(prod?.data || {}).length / 1024);
  return NextResponse.json(out);
}
