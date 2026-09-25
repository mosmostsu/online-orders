// ดึงรายการสินค้าทั้งร้าน (ตะกร้า + ตัวเลือกสี/ไซส์ + ราคา + ราคาพิเศษ + คลัง) → os_listings (ดู supabase/030)
//
// ทั้งสองแพลตฟอร์มเป็น 2 ขั้นเหมือนกัน:
//   1. ขอรายชื่อตะกร้าทั้งร้าน (ได้แค่ id + เวลาแก้ไขล่าสุด) — เร็ว ครั้งละ 100
//   2. ถามรายละเอียดเฉพาะตะกร้าที่ใหม่/ถูกแก้/ข้อมูลเก่าเกิน STALE_HOURS — ช้า Shopee ต้องถามตัวเลือกทีละตะกร้า
// คลังลดตามออเดอร์โดยที่เวลาแก้ไขของตะกร้าอาจไม่ขยับ จึงต้องมีรอบไล่ของเก่าด้วย ไม่ใช่ดูแค่ตัวที่ถูกแก้
//
// หนึ่งรอบมีงบเวลา ~17 วินาที (Netlify ตัดที่ ~26) ทำไม่หมดก็คืน more: true ให้ปุ่ม/cron เรียกต่อ
// ไม่ต้องจำ cursor — ตะกร้าที่ทำแล้วได้ synced_at ใหม่ รอบถัดไปจะข้ามเอง
//
// เรียกได้ 2 ทาง: ปุ่มบนหน้าเว็บ (POST) หรือ cron ยิงมาพร้อม ?key=SYNC_SECRET
// ?platform=shopee&shop=REAL — ทำร้านเดียว (ปุ่มในหน้า /product ส่งร้านที่เปิดดูอยู่มา)
//
// ThisShop ต่างออกไป: ไม่มีเวลาแก้ไขให้เทียบ และขอได้ทีละ 10 ตะกร้าแบบช้า (1-30 วินาทีต่อหน้า)
// จึงไล่ทีละหน้าตามตัวชี้ใน os_listing_cursor ครบรอบแล้ววนใหม่ (ทั้งร้าน ~130 หน้า ใช้ ~10 รอบ)
import { NextResponse } from 'next/server';
import * as shopee from '@/lib/shopee';
import * as tiktok from '@/lib/tiktok';
import * as thisshop from '@/lib/thisshop';
import {
  saveListings, storedListings, removeListings, getCursor, setCursor, removeUntouched,
} from '@/lib/listings';
import { listShops, usableToken } from '@/lib/tokens';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TIME_BUDGET_MS = 17000;
const STALE_HOURS = 3;
const LOCK_MS = 60000;
const PLATFORMS = ['shopee', 'tiktok', 'thisshop'];
const TS_PARALLEL = 4;   // ยิงพร้อมกันมากกว่านี้ ThisShop เริ่มตอบ "connection timed out"

// ทำทีละ n งานพร้อมกัน — ยิงทีละตัวช้าเกิน ยิงทั้งหมดพร้อมกันโดนแพลตฟอร์มจำกัดความถี่
async function pool(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  }));
  return out;
}

async function isRunning(sb, platform, shop) {
  const { data } = await sb.from('os_sync_log')
    .select('started_at, finished_at')
    .eq('platform', `listings:${platform}`).eq('shop', shop)
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!data || data.finished_at) return false;
  return Date.now() - new Date(data.started_at).getTime() < LOCK_MS;
}

// เทียบรายชื่อจากแพลตฟอร์มกับที่เก็บไว้ → ตะกร้าที่ต้องดึงรายละเอียด (ใหม่/ถูกแก้ก่อน แล้วค่อยของเก่าสุด)
function pickTodo(remote, stored) {
  const byId = new Map(stored.map((s) => [s.product_id, s]));
  const staleBefore = Date.now() - STALE_HOURS * 3600000;
  const changed = [], stale = [];
  for (const r of remote) {
    const s = byId.get(r.id);
    if (!s || !s.remote_updated_at || (r.updatedAt && new Date(s.remote_updated_at).getTime() < r.updatedAt)) {
      changed.push(r.id);
    } else if (new Date(s.synced_at).getTime() < staleBefore) {
      stale.push({ id: r.id, at: new Date(s.synced_at).getTime() });
    }
  }
  stale.sort((a, b) => a.at - b.at);
  const alive = new Set(remote.map((r) => r.id));
  const gone = stored.map((s) => s.product_id).filter((id) => !alive.has(id));
  return { todo: [...changed, ...stale.map((x) => x.id)], gone };
}

async function syncShopee(row, t0) {
  const auth = { accessToken: row.access_token, shopId: row.shop_id, partner: row };
  const remote = (await shopee.listItemIds(auth))
    .map((it) => ({ id: String(it.item_id), updatedAt: it.update_time ? it.update_time * 1000 : null }));
  const { todo, gone } = pickTodo(remote, await storedListings('shopee', row.shop));
  const removed = await removeListings('shopee', row.shop, gone);

  let saved = 0, done = 0;
  for (let i = 0; i < todo.length; i += 50) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break;
    const chunk = todo.slice(i, i + 50);
    const bases = await shopee.getItemBaseInfo({ ...auth, itemIds: chunk });
    const items = await pool(bases, 8, async (b) => {
      const models = b.has_model ? await shopee.getModelList({ ...auth, itemId: b.item_id }) : null;
      return shopee.normalizeListing(b, models, row.shop);
    });
    saved += await saveListings(items);
    done += chunk.length;
  }
  return { total: remote.length, todo: todo.length, saved, removed, left: todo.length - done };
}

async function syncTiktok(row, t0) {
  const auth = { accessToken: row.access_token, shopCipher: row.shop_cipher };
  const remote = (await tiktok.searchProductIds(auth))
    .map((p) => ({ id: String(p.id), updatedAt: p.update_time ? p.update_time * 1000 : null }));
  const { todo, gone } = pickTodo(remote, await storedListings('tiktok', row.shop));
  const removed = await removeListings('tiktok', row.shop, gone);

  let saved = 0, done = 0;
  for (let i = 0; i < todo.length; i += 30) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break;
    const chunk = todo.slice(i, i + 30);
    const items = await pool(chunk, 6, async (productId) => {
      try {
        return tiktok.normalizeListing(await tiktok.getProduct({ ...auth, productId }), row.shop);
      } catch {
        return null;   // ตะกร้าที่เพิ่งถูกลบระหว่างรอบ — รอบหน้าจะหายจากรายชื่อเอง
      }
    });
    saved += await saveListings(items.filter(Boolean));
    done += chunk.length;
  }
  return { total: remote.length, todo: todo.length, saved, removed, left: todo.length - done };
}

async function syncThisshop(row, t0) {
  const token = await thisshop.getToken();
  let { next_page: page, pass_started_at: passStart } = await getCursor('thisshop', row.shop);
  let saved = 0, failed = 0, end = false, total = null;

  // หน้าละไม่เกิน 9 วินาที (listItemsPage) — เริ่มชุดใหม่ได้ถึง 14 วินาที จบช้าสุด ~23 ก่อน Netlify ตัดที่ ~26
  while (!end && Date.now() - t0 < TIME_BUDGET_MS - 3000) {
    const pages = Array.from({ length: TS_PARALLEL }, (_, i) => page + i);
    const got = await Promise.all(pages.map((n) => thisshop.listItemsPage(token, n, 9000).catch(() => null)));
    // เดินตัวชี้ได้เฉพาะหน้าที่สำเร็จติดกันจากหน้าแรก — หน้าที่หลุดไว้ลองใหม่รอบหน้า
    const items = [];
    for (const g of got) {
      if (!g) { failed++; break; }
      total = g.total ?? total;
      items.push(...g.items.map((spu) => thisshop.normalizeListing(spu, row.shop)));
      page++;
      if (g.items.length < thisshop.ITEM_PAGE_SIZE) { end = true; break; }
    }
    saved += await saveListings(items);
    if (got[0] === null) break;   // หน้าแรกของชุดยังไม่มา ไม่ต้องดันต่อ
  }

  let removed = 0;
  if (end) {
    removed = await removeUntouched('thisshop', row.shop, passStart);
    page = 1;
    passStart = new Date().toISOString();
  }
  await setCursor('thisshop', row.shop, page, passStart);
  const pagesAll = total ? Math.ceil(total / thisshop.ITEM_PAGE_SIZE) : null;
  return {
    total, saved, removed, failed, next_page: page,
    left: end ? 0 : pagesAll ? Math.max(1, pagesAll - page + 1) : 1,
  };
}

async function run(req) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const pf = url.searchParams.get('platform');
  const shopFilter = url.searchParams.get('shop') || null;
  const sb = db();

  const platforms = PLATFORMS.includes(pf) ? [pf] : PLATFORMS;
  const shops = [];
  for (const p of platforms) {
    // ThisShop ไม่มีแถวใน os_shop_tokens (ขอโทเคนสดด้วย appId+appSecret ทุกครั้ง) มีร้านเดียว
    const list = p === 'thisshop'
      ? (process.env.THISSHOP_APP_ID ? [{ platform: 'thisshop', shop: 'THISSHOP' }] : [])
      : await listShops(p);
    for (const s of list) if (!shopFilter || s.shop === shopFilter) shops.push(s);
  }
  if (!shops.length) return NextResponse.json({ ok: false, error: 'ไม่พบร้านที่ผูกไว้' }, { status: 400 });

  const result = [];
  let more = false;
  for (const row of shops) {
    if (Date.now() - t0 > TIME_BUDGET_MS) { more = true; break; }
    if (await isRunning(sb, row.platform, row.shop)) {
      result.push({ platform: row.platform, shop: row.shop, skipped: 'รอบก่อนยังทำงานอยู่' });
      more = true;
      continue;
    }
    const { data: logRow } = await sb.from('os_sync_log')
      .insert({ platform: `listings:${row.platform}`, shop: row.shop, started_at: new Date().toISOString() })
      .select('id').maybeSingle();
    try {
      const r = row.platform === 'thisshop' ? await syncThisshop(row, t0)
        : row.platform === 'shopee' ? await syncShopee(await usableToken(row), t0)
          : await syncTiktok(await usableToken(row), t0);
      if (r.left > 0) more = true;
      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), fetched: r.total, upserted: r.saved, ok: true })
        .eq('id', logRow?.id);
      result.push({ platform: row.platform, shop: row.shop, ...r });
    } catch (e) {
      const msg = String(e.message || e);
      await sb.from('os_sync_log')
        .update({ finished_at: new Date().toISOString(), ok: false, error: msg })
        .eq('id', logRow?.id);
      result.push({ platform: row.platform, shop: row.shop, error: msg });
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
