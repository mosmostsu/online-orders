// ดึงออเดอร์ TikTok ของทุกร้านที่อนุญาตไว้ → เก็บลง DB
// เรียกได้ 2 ทาง: ปุ่มบนหน้าเว็บ (POST) หรือ cron ยิงมาพร้อม ?key=SYNC_SECRET
import { NextResponse } from 'next/server';
import { fetchOrders, normalizeOrder } from '@/lib/tiktok';
import { listShops, usableToken } from '@/lib/tokens';
import { upsertOrders, logSync } from '@/lib/ingest';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ร้านนี้ออเดอร์ ~1,500/วัน — รอบปกติจึงมองย้อนหลังแค่ช่วงสั้นๆ พอให้จับของที่เพิ่งเปลี่ยนสถานะ
// ถ้าจะดึงย้อนหลังเยอะ (ครั้งแรก/ตามของที่หลุด) ค่อยส่ง ?minutes= หรือ ?days= มาเอง
const DEFAULT_MINUTES = 30;

async function run(req) {
  const url = new URL(req.url);
  const days = Number(url.searchParams.get('days') || 0);
  const minutes = days ? days * 1440 : Number(url.searchParams.get('minutes') || DEFAULT_MINUTES);
  const since = Date.now() - minutes * 60 * 1000;

  const shops = await listShops('tiktok');
  if (!shops.length) {
    return NextResponse.json({ ok: false, error: 'ยังไม่มีร้านที่อนุญาต — เปิด /api/auth/tiktok เพื่อเชื่อมร้านก่อน' }, { status: 400 });
  }

  const result = [];
  for (const row of shops) {
    const started = new Date().toISOString();
    try {
      const tok = await usableToken(row);
      const orders = await fetchOrders({
        accessToken: tok.access_token,
        shopCipher: tok.shop_cipher,
        since,
      });
      const records = orders.map((o) => normalizeOrder(o, row.shop));
      const { upserted } = await upsertOrders(records);

      await logSync({ platform: 'tiktok', shop: row.shop, started_at: started, finished_at: new Date().toISOString(), fetched: orders.length, upserted, ok: true });
      result.push({ shop: row.shop, fetched: orders.length, upserted });
    } catch (e) {
      await logSync({ platform: 'tiktok', shop: row.shop, started_at: started, finished_at: new Date().toISOString(), ok: false, error: String(e.message || e) });
      result.push({ shop: row.shop, error: String(e.message || e) });
    }
  }
  return NextResponse.json({ ok: true, minutes, result });
}

export async function GET(req) {
  const key = new URL(req.url).searchParams.get('key');
  if (process.env.SYNC_SECRET && key !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  return run(req);
}

export async function POST(req) {
  return run(req);
}
