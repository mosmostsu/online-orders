// รหัส SKU ทั้งหมดที่ตรงตัวกรองปัจจุบันของตาราง ALL SITE — ปุ่ม "เลือกทั้งหมดที่กรองไว้"
// รับพารามิเตอร์ชุดเดียวกับลิงก์หน้า /allsite (nm sk br ct hide yn sh) คืนแค่รหัส ไม่เกิน MAX ตัว
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { shopsFrom } from '@/lib/listings';

export const dynamic = 'force-dynamic';

const MAX = 5000;
const clean = (v) => String(v || '').replace(/[%_]/g, ' ').trim();
const keyOf = (s) => `${s.platform}:${s.shop}`;

export async function GET(req) {
  const sp = new URL(req.url).searchParams;
  let picked = String(sp.get('sh') || '').split(',').filter(Boolean);
  if (!picked.length) {
    const { data } = await db().rpc('os_listing_shops');
    picked = shopsFrom(data).map(keyOf);
  }
  const yn = Object.fromEntries(String(sp.get('yn') || '').split(',')
    .map((x) => x.split('=')).filter(([k, v]) => k && picked.includes(k) && (v === 'Y' || v === 'N')));

  const { data, error } = await db().rpc('os_allsite_skus', {
    p_shops: picked.map((k) => k.split(':')), p_stock: sp.get('hide') === '1' ? 'in' : 'all',
    p_filter: Object.fromEntries(Object.entries(yn).map(([k, v]) => [String(picked.indexOf(k) + 1), v])),
    p_name: clean(sp.get('nm')), p_sku: clean(sp.get('sk')), p_brand: clean(sp.get('br')), p_cat: clean(sp.get('ct')),
    p_sort: '', p_dir: 'asc', p_page: 1, p_size: MAX,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const skus = (data?.rows || []).map((r) => r.sku);
  return NextResponse.json({ ok: true, skus, capped: (data?.total || 0) > MAX });
}
