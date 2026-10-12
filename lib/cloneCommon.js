// ตัวช่วยร่วมของงานโคลนข้ามร้าน (lib/cloneLazada.js ฯลฯ) — อ่านฐานข้อมูล/โทเคน ไม่มีการเขียนลงร้านค้า
import { db } from './supabase.js';
import { listShops, usableToken } from './tokens.js';

export const low = (s) => String(s || '').trim().toLowerCase();
export const norm = (s) => String(s || '').toLowerCase().replace(/[(（][^)）]*[)）]/g, '').replace(/[^a-z0-9฀-๿]/g, '');
export const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const PENDING_MIN = 15;

// อ่านทั้งตารางแบบขนาน: คำขอแรกขอจำนวนรวม แล้วยิงหน้าที่เหลือพร้อมกัน (make(a, b) ต้อง select ... { count: 'exact' })
export async function selectAllFast(make) {
  const first = await make(0, 999);
  if (first.error) throw first.error;
  const rows = first.data || [];
  const total = first.count || rows.length;
  const jobs = [];
  for (let from = 1000; from < total; from += 1000) jobs.push(make(from, from + 999));
  for (const r of await Promise.all(jobs)) {
    if (r.error) throw r.error;
    rows.push(...(r.data || []));
  }
  return rows;
}

export async function pool(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i]); }
  }));
  return out;
}

export async function shopToken(platform, shop) {
  const row = (await listShops(platform)).find((r) => r.shop === shop);
  if (!row) throw new Error(`ไม่พบโทเคน ${platform} ${shop}`);
  return usableToken(row);
}

// SKU (ตัวเล็ก) ทั้งหมดของร้านนั้น ทุกสถานะ
export async function skuSet(platform, shop) {
  const rows = await selectAllFast((a, b) => db().from('os_listing_skus').select('seller_sku', { count: 'exact' })
    .eq('platform', platform).eq('shop', shop).order('sku_id').range(a, b));
  return new Set(rows.map((r) => low(r.seller_sku)).filter(Boolean));
}

// ตะกร้าต้นทางที่ "ขายอยู่" และปลายทางไม่มี SKU ไหนเลย
export async function candidates({ srcPlatform, dstPlatform, shop }) {
  const sb = db();
  const [list, skus, onDst] = await Promise.all([
    selectAllFast((a, b) => sb.from('os_listings').select('product_id, title, status, thumb_url', { count: 'exact' })
      .eq('platform', srcPlatform).eq('shop', shop).order('product_id').range(a, b)),
    selectAllFast((a, b) => sb.from('os_listing_skus').select('product_id, seller_sku', { count: 'exact' })
      .eq('platform', srcPlatform).eq('shop', shop).order('sku_id').range(a, b)),
    skuSet(dstPlatform, shop),
  ]);
  const by = new Map();
  for (const r of skus) {
    const k = low(r.seller_sku);
    if (!k) continue;
    if (!by.has(r.product_id)) by.set(r.product_id, new Set());
    by.get(r.product_id).add(k);
  }
  const LIVE = ['NORMAL', 'ACTIVATE', 'ONSHELF'];
  return list
    .filter((l) => LIVE.includes(l.status) && by.get(l.product_id)?.size && ![...by.get(l.product_id)].some((k) => onDst.has(k)))
    .map((l) => ({ id: l.product_id, title: l.title, thumb: l.thumb_url, n: by.get(l.product_id).size }));
}

// ประวัติโคลนที่ยังบล็อกอยู่ (สำเร็จ หรือกำลังทำไม่เกิน 15 นาที) — key อยู่ในคอลัมน์ shopee_shop ของ os_clone_log
export async function blockedIds(key, ids) {
  const out = new Map();
  for (const c of chunks(ids, 100)) {
    const { data, error } = await db().from('os_clone_log').select('shopee_product_id, thisshop_spu_id, status, created_at')
      .eq('shopee_shop', key).in('shopee_product_id', c).in('status', ['ok', 'pending']);
    if (error) throw new Error(error.message);
    for (const r of data || []) {
      const stale = r.status === 'pending' && Date.now() - new Date(r.created_at).getTime() > PENDING_MIN * 60000;
      if (!stale) out.set(r.shopee_product_id, r);
    }
  }
  return out;
}

// สต็อก Seniorsoft ของรายการ SKU → Map(sku ตัวเล็ก → จำนวน)
export async function stCounts(skus) {
  const forms = [...new Set(skus.filter(Boolean).flatMap((s) => [s, s.toLowerCase(), s.toUpperCase()]))];
  const out = new Map();
  for (const c of chunks(forms, 300)) {
    const { data, error } = await db().from('os_st').select('sku, qty').in('sku', c);
    if (error) throw new Error(error.message);
    for (const r of data || []) out.set(low(r.sku), Math.max(0, Number(r.qty) || 0));
  }
  return out;
}

export async function fetchImageBytes(url, accept = 'image/jpeg,image/png') {
  const res = await fetch(url, { headers: { accept }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`โหลดรูปไม่ได้ (${res.status})`);
  const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  return { bytes: new Uint8Array(await res.arrayBuffer()), type };
}
