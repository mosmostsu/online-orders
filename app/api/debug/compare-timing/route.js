// จับเวลาการอ่านก้อนสำเร็จรูปของหน้า /compare จากฝั่งเซิร์ฟเวอร์จริง (รันบน Netlify เหมือนหน้าเว็บ)
//   /api/debug/compare-timing?key=SYNC_SECRET&g=REAL
// เทียบ: คำขอเล็ก · ดึงก้อน (~1 MB) จาก Supabase ตรงๆ · ดึงผ่านที่จำร่วมของ Next (ครั้งแรก/ครั้งต่อมา)
import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const viaCache = unstable_cache(async (grp, builtAt) => {
  const { data, error } = await db().from('os_compare_snap').select('data')
    .eq('grp', grp).eq('thr', 60).eq('hide_skus', true).eq('hide_rows', true).single();
  if (error) throw new Error(error.message);
  return data.data;
}, ['dbg-compare-snap'], { revalidate: 120 });

export async function GET(req) {
  const url = new URL(req.url);
  if (process.env.SYNC_SECRET && url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const g = ['SOLID', 'REAL', 'MVP'].includes(url.searchParams.get('g')) ? url.searchParams.get('g') : 'REAL';
  const sb = db();
  const out = { group: g };
  const time = async (name, fn) => {
    const t = Date.now();
    const r = await fn();
    out[name] = Date.now() - t;
    return r;
  };

  const head = async () => (await sb.from('os_compare_snap').select('built_at')
    .eq('grp', g).eq('thr', 60).eq('hide_skus', true).eq('hide_rows', true).maybeSingle()).data;
  await time('small_1_ms', head);
  await time('small_2_ms', head);
  const h = await head();
  const direct = async () => (await sb.from('os_compare_snap').select('data')
    .eq('grp', g).eq('thr', 60).eq('hide_skus', true).eq('hide_rows', true).single()).data;
  const d1 = await time('blob_direct_1_ms', direct);
  await time('blob_direct_2_ms', direct);
  out.blob_kb = Math.round(JSON.stringify(d1?.data || {}).length / 1024);
  await time('blob_cached_first_ms', () => viaCache(g, h?.built_at));
  await time('blob_cached_second_ms', () => viaCache(g, h?.built_at));
  return NextResponse.json(out);
}
