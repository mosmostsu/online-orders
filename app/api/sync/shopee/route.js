// ดึงออเดอร์ Shopee ของทุกร้านที่ผูกไว้ → เก็บลง DB
// โครงเดียวกับฝั่ง TikTok ทุกอย่าง ต่างแค่ตัวที่ไปคุยกับแพลตฟอร์ม
import { NextResponse } from 'next/server';
import { fetchOrders, normalizeOrder, getTrackingNumber } from '@/lib/shopee';
import { listShops, usableToken } from '@/lib/tokens';
import { upsertOrders } from '@/lib/ingest';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FALLBACK_MINUTES = 30;
const OVERLAP_MINUTES = 5;

// จำเวลาแยกตามร้าน — สองร้านถูกดึงสลับกัน ถ้าใช้ตัวจำร่วมกัน
// รอบของร้านหนึ่งจะเลื่อนเวลาเริ่มของอีกร้านไปด้วย แล้วช่วงที่ยังไม่ได้ดึงจะถูกข้าม
async function sinceFromLastRun(sb, shop) {
  const { data } = await sb
    .from('os_sync_log')
    .select('started_at')
    .eq('platform', 'shopee').eq('shop', shop).eq('ok', true)
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!data?.started_at) return Date.now() - FALLBACK_MINUTES * 60000;
  return new Date(data.started_at).getTime() - OVERLAP_MINUTES * 60000;
}

async function run(req) {
  const url = new URL(req.url);
  const sb = db();
  const days = Number(url.searchParams.get('days') || 0);
  const forced = days ? days * 1440 : Number(url.searchParams.get('minutes') || 0);
  let shops = await listShops('shopee');
  // เลือกดึงทีละร้านได้ด้วย ?shop=REAL — ดึงหลายร้านในคำขอเดียวมักไม่ทันเวลาที่เว็บให้
  const only = url.searchParams.get('shop');
  if (only) shops = shops.filter((s) => s.shop === only);
  if (!shops.length) {
    return NextResponse.json({ ok: false, error: 'ยังไม่มีร้าน Shopee ที่ผูกไว้ — เปิด /api/auth/shopee?shop=SOLID ก่อน' }, { status: 400 });
  }

  const result = [];
  for (const row of shops) {
    const started = new Date().toISOString();
    const { data: logRow } = await sb
      .from('os_sync_log')
      .insert({ platform: 'shopee', shop: row.shop, started_at: started })
      .select('id').maybeSingle();
    try {
      const since = forced ? Date.now() - forced * 60000 : await sinceFromLastRun(sb, row.shop);
      const tok = await usableToken(row);
      const orders = await fetchOrders({ accessToken: tok.access_token, shopId: tok.shop_id, since, partner: tok });
      const records = orders.map((o) => normalizeOrder(o, row.shop));

      // เติมเลขติดตามพัสดุให้ใบที่กดจัดส่งแล้ว — ต้องขอทีละใบ จึงถามเฉพาะใบที่ยังไม่เคยได้
      // ใบที่เคยได้แล้วต้องหยิบของเดิมกลับมาใส่ ไม่งั้น upsert รอบนี้จะล้างเลขทิ้ง
      const shipped = records.filter((r) => ['packed', 'shipped'].includes(r.order.status));
      const have = new Map();
      for (let i = 0; i < shipped.length; i += 100) {
        const { data } = await sb.from('os_orders')
          .select('order_id, tracking_no')
          .eq('platform', 'shopee').eq('shop', row.shop)
          .in('order_id', shipped.slice(i, i + 100).map((r) => r.order.order_id));
        for (const k of data || []) if (k.tracking_no) have.set(k.order_id, k.tracking_no);
      }
      const needTracking = [];
      for (const r of shipped) {
        const old = have.get(r.order.order_id);
        if (old) r.order.tracking_no = old;
        else needTracking.push(r);
      }
      // ถามได้จำกัดต่อรอบ (ฟังก์ชันมีเวลา 26 วินาที) ที่เหลือรอบหน้าเก็บต่อ
      for (const r of needTracking.slice(0, 40)) {
        const tn = await getTrackingNumber({
          accessToken: tok.access_token, shopId: tok.shop_id, partner: tok, orderSn: r.order.order_id,
        });
        if (tn) r.order.tracking_no = tn;
      }

      const { upserted } = await upsertOrders(records);
      // ตาข่ายกันเหนียว เผื่อ push ของช้อปปี้หลุด
      try {
        const { notifyExpress } = await import('@/app/api/notify/express/route');
        await notifyExpress();
      } catch (e) { console.error('แจ้งส่งด่วนไม่สำเร็จ:', e.message); }
      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), fetched: orders.length, upserted, ok: true })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, fetched: orders.length, upserted });
    } catch (e) {
      const msg = String(e.message || e);
      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), ok: false, error: msg })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, error: msg });
    }
  }
  return NextResponse.json({ ok: true, result });
}

export async function GET(req) {
  if (process.env.SYNC_SECRET && new URL(req.url).searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  return run(req);
}
export async function POST(req) { return run(req); }
