// ดึง "เงินที่ได้รับจริง" จาก escrow ของ Shopee → os_statements + os_money_tx
//
// ต่างจากฝั่ง TikTok (app/api/sync/settlement/route.js) ตรงที่ Shopee ไม่มีใบสรุปรายวันให้ถามเป็นก้อน
// ต้องไล่ 2 ขั้น: get_escrow_list (รายชื่อออเดอร์ที่ escrow ปล่อยแล้วในช่วงเวลา) แล้วตามด้วย
// get_escrow_detail_batch (แจกแจงเต็มทีละไม่เกิน 50 ใบ) จากนั้นรวมยอดเป็น "ใบสรุปรายวัน" เอง
// ด้วย os_rebuild_statements (ดู supabase/023) — ไม่ได้เดายอดจาก escrow_list ล่วงหน้า
//
// เรียกได้ 2 ทาง: ปุ่มบนหน้าเว็บ (POST) หรือ cron ยิงมาพร้อม ?key=SYNC_SECRET
import { NextResponse } from 'next/server';
import { listEscrow, getEscrowDetailBatch, normalizeMoneyTx, getItemBaseInfo, normalizeProduct } from '@/lib/shopee';
import { saveMoneyTx, saveProducts } from '@/lib/settlement';
import { listShops, usableToken } from '@/lib/tokens';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TIME_BUDGET_MS = 17000;   // หยุดรับก้อนใหม่เมื่อเลยเท่านี้ — เผื่อก่อน Netlify ฆ่าที่ ~26 วินาที
const LOOKBACK_DAYS = 30;
const OVERLAP_MINUTES = 60;     // escrow ปล่อยไม่สม่ำเสมอเท่ารอบตัดของ TikTok เผื่อทับรอบก่อนไว้หน่อย
const LOCK_MS = 60000;

async function isRunning(sb) {
  const { data } = await sb.from('os_sync_log')
    .select('started_at, finished_at')
    .eq('platform', 'money:shopee')
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!data || data.finished_at) return false;
  return Date.now() - new Date(data.started_at).getTime() < LOCK_MS;
}

async function sinceFromLastRun(sb, shop) {
  const { data } = await sb.from('os_sync_log')
    .select('started_at')
    .eq('platform', 'money:shopee').eq('shop', shop).eq('ok', true)
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!data?.started_at) return Date.now() - LOOKBACK_DAYS * 86400000;
  return new Date(data.started_at).getTime() - OVERLAP_MINUTES * 60000;
}

async function run(req) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const shopFilter = url.searchParams.get('shop') || null;
  const forcedDays = Number(url.searchParams.get('days') || 0);
  // ดึงเจาะวันที่เอง — ?from=2026-09-06&to=2026-09-06 (from อย่างเดียวก็ได้ ถือว่าวันเดียว)
  // มีไว้เผื่อ ?days= กว้างไปแล้วค้าง จะได้เจาะดึงเฉพาะวันที่ยังขาดได้ตรงๆ ไม่ต้องไล่ทั้งช่วงใหม่
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to') || fromParam;
  const explicitSince = fromParam ? new Date(`${fromParam}T00:00:00Z`).getTime() : null;
  const explicitUntil = toParam ? new Date(`${toParam}T00:00:00Z`).getTime() + 86400000 : null;
  const sb = db();

  if (await isRunning(sb)) {
    return NextResponse.json({ ok: true, skipped: 'รอบก่อนยังทำงานอยู่', more: true });
  }

  const shops = (await listShops('shopee')).filter((s) => !shopFilter || s.shop === shopFilter);
  if (!shops.length) {
    return NextResponse.json({ ok: false, error: 'ยังไม่มีร้าน Shopee ที่ผูกไว้' }, { status: 400 });
  }

  const result = [];
  let more = false;

  for (const row of shops) {
    const { data: logRow } = await sb.from('os_sync_log')
      .insert({ platform: 'money:shopee', shop: row.shop, started_at: new Date().toISOString() })
      .select('id').maybeSingle();

    let saved = 0, escrowN = 0, statements = 0;
    try {
      const tok = await usableToken(row);
      const auth = { accessToken: tok.access_token, shopId: tok.shop_id, partner: tok };

      const since = explicitSince ?? (forcedDays ? Date.now() - forcedDays * 86400000 : await sinceFromLastRun(sb, row.shop));
      const until = explicitUntil ?? Date.now();
      const escrow = await listEscrow({ ...auth, since, until });
      escrowN = escrow.length;

      // ข้ามใบที่บันทึกไปแล้วในรอบก่อนๆ — escrow_list ดึงมาใหม่ทั้งช่วงทุกครั้ง (ไม่มี cursor ให้จำ)
      // ถ้าไม่กรองตรงนี้ ร้านที่มีของเยอะจนรอบเดียวไม่จบใน TIME_BUDGET_MS จะวนไปติดที่ใบแรกๆ
      // ซ้ำทุกรอบ ไม่มีวันไปถึงใบท้ายๆ สักที (ใช้การมีแถวใน os_money_tx แล้วเป็นตัวจำแทน cursor)
      const orderSns = escrow.map((e) => String(e.order_sn));
      const done = new Set();
      for (let i = 0; i < orderSns.length; i += 300) {
        const { data: existing } = await sb.from('os_money_tx')
          .select('tx_id').eq('platform', 'shopee').eq('shop', row.shop)
          .in('tx_id', orderSns.slice(i, i + 300));
        for (const r of existing || []) done.add(r.tx_id);
      }
      const pending = escrow.filter((e) => !done.has(String(e.order_sn)));

      let touchedFrom = null, touchedTo = null;
      for (let i = 0; i < pending.length; i += 50) {
        if (Date.now() - t0 > TIME_BUDGET_MS) { more = true; break; }
        const chunk = pending.slice(i, i + 50);
        const detail = await getEscrowDetailBatch({ ...auth, orderSns: chunk.map((e) => e.order_sn) });
        const byOrder = new Map(chunk.map((e) => [String(e.order_sn), e]));
        const rows = detail.map((d) => {
          const e = byOrder.get(String(d.order_sn));
          const at = new Date((e?.escrow_release_time || Math.floor(Date.now() / 1000)) * 1000).toISOString();
          if (!touchedFrom || at < touchedFrom) touchedFrom = at;
          if (!touchedTo || at > touchedTo) touchedTo = at;
          return normalizeMoneyTx(d, { shop: row.shop, statementAt: at });
        });
        await saveMoneyTx(rows);
        saved += rows.length;
      }

      // รวมยอดเป็น "ใบสรุปรายวัน" จากแถวที่เพิ่งบันทึกไป (ไม่ใช่เดาจาก escrow_list) — คลุมทั้งวันที่แตะ
      // กันตกหล่นที่ขอบวัน (เผื่อรอบก่อนเคยบันทึกออเดอร์อื่นของวันเดียวกันไว้แล้วบางส่วน)
      if (touchedFrom) {
        const dayFrom = new Date(new Date(touchedFrom).setUTCHours(0, 0, 0, 0)).toISOString();
        const dayTo = new Date(new Date(touchedTo).getTime() + 86400000).toISOString();
        const { data: n, error: e2 } = await sb.rpc('os_rebuild_statements', {
          p_platform: 'shopee', p_shop: row.shop, p_from: dayFrom, p_to: dayTo,
        });
        if (e2) throw new Error(e2.message);
        statements = n || 0;
      }

      // รูปปก/ชื่อตะกร้า — ใช้เวลาที่เหลือจากขั้นบันทึกยอดเท่านั้น ยอดเงินสำคัญกว่ารูป
      // พังก็ไม่ให้ทั้งรอบพัง (เช่นยังไม่ได้รัน 019) แค่รายงานไว้ — โครงเดียวกับฝั่ง TikTok
      let products = 0, productsError = null;
      if (Date.now() - t0 < TIME_BUDGET_MS) {
        try {
          const { data: todo, error: e3 } = await sb.rpc('os_products_todo', { p_platform: 'shopee', p_limit: 40 });
          if (e3) throw new Error(e3.message);
          const items = todo?.length ? await getItemBaseInfo({ ...auth, itemIds: todo }) : [];
          const byId = new Map(items.map((it) => [String(it.item_id), it]));
          const got = (todo || []).map((itemId) => {
            const it = byId.get(String(itemId));
            // ตะกร้าที่ถูกลบ/ปิดไปแล้วถามไม่ได้ — จดไว้ว่าถามแล้ว จะได้ไม่วนถามซ้ำทุกรอบ
            return it ? normalizeProduct(it) : {
              platform: 'shopee', product_id: String(itemId), title: null, cover_url: null,
              thumb_url: null, status: null, synced_at: new Date().toISOString(),
            };
          });
          products = await saveProducts(got);
          if ((todo || []).length === 40) more = true;
        } catch (e) {
          productsError = String(e.message || e);
        }
      }

      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), fetched: saved, upserted: statements, ok: true })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, escrow: escrowN, already_done: done.size, saved, statements, products, productsError });
    } catch (e) {
      const msg = String(e.message || e);
      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), fetched: saved, ok: false, error: msg })
        .eq('id', logRow?.id);
      result.push({ shop: row.shop, saved, error: msg });
    }
  }

  return NextResponse.json({ ok: true, more, seconds: Math.round((Date.now() - t0) / 1000), result });
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
