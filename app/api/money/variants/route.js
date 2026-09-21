// ตัวเลือกสี/ไซส์ของตะกร้าเดียว — โหลดตอนกดกางเท่านั้น
//
// เดิมหน้ารายสินค้าส่งตัวเลือกของทุกตะกร้ามาพร้อมหน้า (บางตะกร้า 59 ตัวเลือก)
// หน้ากลายเป็น 1.8 MB และเปิดช้า ทั้งที่ส่วนใหญ่ไม่ได้กางดู
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const p = new URL(req.url).searchParams;
  const from = p.get('from');
  const to = p.get('to');
  const pick = p.get('pick');
  const by = p.get('by') === 'sku' ? 'sku' : 'product_id';
  if (!from || !to || !pick) {
    return NextResponse.json({ ok: false, error: 'ต้องมี from, to, pick' }, { status: 400 });
  }

  const sb = db();
  const { data, error } = await sb.from('os_money_items')
    .select('sku, variant, qty, gross, seller_discount, charges, settlement')
    .eq('platform', 'tiktok').eq(by, pick).eq('matched', true).eq('is_return', false)
    .gte('statement_at', from).lt('statement_at', to)
    .limit(5000);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const by_sku = new Map();
  for (const r of data || []) {
    const k = r.sku || '';
    if (!by_sku.has(k)) by_sku.set(k, { sku: r.sku, variant: r.variant, qty: 0, gross: 0, seller_discount: 0, charges: 0, settlement: 0 });
    const v = by_sku.get(k);
    v.qty += Number(r.qty) || 0;
    v.gross += Number(r.gross) || 0;
    v.seller_discount += Number(r.seller_discount) || 0;
    v.charges += Number(r.charges) || 0;
    v.settlement += Number(r.settlement) || 0;
    if (!v.variant) v.variant = r.variant;
  }

  // ทุนของรหัสในตะกร้านี้ — ส่งไปด้วยเลย หน้าเว็บจะได้โชว์กำไรต่อชิ้นตอนกาง
  const skus = [...by_sku.keys()].filter(Boolean);
  const costs = {};
  if (skus.length) {
    const { data: cs } = await sb.from('os_sku_cost')
      .select('sku, cost, est, off_bill').eq('platform', 'tiktok').in('sku', skus);
    for (const c of cs || []) costs[c.sku] = { cost: c.cost, est: c.est, off: c.off_bill };
  }

  const variants = [...by_sku.values()].sort((a, b) => b.qty - a.qty);
  return NextResponse.json({ ok: true, variants, costs });
}
