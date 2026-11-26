// เติมตาราง os_returns (หน้า /returns) — อ่านจากแพลตฟอร์มอย่างเดียว ไม่กดอะไรบนหลังร้าน
//   1) ตีกลับ: ออเดอร์ที่ยกเลิกหลังขนส่งรับไปแล้ว (มีใน os_orders อยู่แล้ว)
//   2) ลูกค้าขอคืน: API คำขอคืนของ TikTok / Shopee / Lazada
//   3) ถามสถานะขนส่งขากลับของกล่องที่ยังไม่ถึง ทีละไม่กี่ใบ (เก่าสุดก่อน)
// ห้ามเขียนคอลัมน์ฝั่งคนรับ (recv / received_* / receive_note / missing) — ของที่ยิงรับแล้ว หรือนำเข้าจาก BigSeller ต้องอยู่ครบ
import { db } from './supabase.js';
import { call as ttCall } from './tiktok.js';
import { call as spCall } from './shopee.js';
import { call as lzCall } from './lazada.js';
import { listShops, usableToken } from './tokens.js';
import {
  tiktokReturnState, tiktokRecordsState, shopeeReturnState, shopeeRefundOnly, tiktokTrackingState,
  shopeeTrackingState, shopeeReverseState, lazadaOrderState, laterState, SKIP_STOCK_NOTE,
} from './returns.js';

const DAY = 86400000;
const SHOPEE_WINDOW = 14 * DAY;   // Shopee ให้ถามช่วงเวลาได้ครั้งละไม่เกิน 15 วัน
const iso = (sec) => (sec ? new Date(Number(sec) * 1000).toISOString() : null);

// รวม SKU ซ้ำในกล่องเดียว (TikTok ส่งมาบรรทัดละชิ้น)
function mergeItems(list) {
  const m = new Map();
  for (const it of list) {
    const k = it.sku || it.name || '';
    const prev = m.get(k);
    if (prev) prev.qty += it.qty || 1;
    else m.set(k, { sku: it.sku || null, name: it.name || null, qty: it.qty || 1, image: it.image || null });
  }
  return [...m.values()];
}

// ── บันทึก ───────────────────────────────────────────────────────────
// อ่านแถวเดิมก่อน แล้วรวมสถานะแบบไม่ถอยหลัง (ถึงแล้วไม่กลับไปเป็นกำลังมา · เวลาถึงที่เคยได้ไม่หาย)
export async function saveBoxes(sb, boxes) {
  if (!boxes.length) return 0;
  const groups = new Map();
  for (const b of boxes) {
    const g = `${b.platform}|${b.shop}`;
    if (!groups.has(g)) groups.set(g, new Map());
    groups.get(g).set(b.ret_key, b);   // กล่องซ้ำในรอบเดียว เอาตัวหลังสุด
  }
  let saved = 0;
  for (const [g, map] of groups) {
    const [platform, shop] = g.split('|');
    const list = [...map.values()];
    for (let i = 0; i < list.length; i += 200) {
      const part = list.slice(i, i + 200);
      const { data: old, error } = await sb.from('os_returns')
        .select('ret_key, state, arrived_at, tracking_no, items, started_at')
        .eq('platform', platform).eq('shop', shop)
        .in('ret_key', part.map((b) => b.ret_key));
      if (error) throw new Error('อ่าน os_returns ไม่สำเร็จ: ' + error.message);
      const prev = new Map((old || []).map((o) => [o.ret_key, o]));
      const rows = part.map((b) => {
        const o = prev.get(b.ret_key);
        return {
          ...b,
          state: laterState(o?.state, b.state),
          arrived_at: o?.arrived_at || b.arrived_at || null,
          tracking_no: b.tracking_no || o?.tracking_no || null,
          items: b.items?.length ? b.items : (o?.items || []),
          // หน้าเว็บกรอง 90 วันด้วยคอลัมน์นี้ ห้ามว่าง
          started_at: o?.started_at || b.started_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      });
      const { error: e2 } = await sb.from('os_returns').upsert(rows, { onConflict: 'platform,shop,ret_key' });
      if (e2) throw new Error('บันทึก os_returns ไม่สำเร็จ: ' + e2.message);
      saved += rows.length;
    }
  }
  return saved;
}

// ── 1) ตีกลับ จาก os_orders ──────────────────────────────────────────
const LOST = /สูญหาย|lost/i;

export function failedBox(o) {
  // Shopee TO_RETURN = ลูกค้าขอคืนหลังได้ของ ไม่ใช่ตีกลับ — ได้จาก API คำขอคืนแทน
  if (o.platform === 'shopee' && o.raw_status === 'TO_RETURN') return null;
  let state = 'transit';
  if (o.platform === 'lazada') state = lazadaOrderState(o.raw_status) || 'transit';
  if (LOST.test(o.cancel_reason || '')) state = 'lost';
  return {
    platform: o.platform, shop: o.shop, order_id: o.order_id, kind: 'failed',
    return_id: null, ret_key: o.order_id,
    tracking_no: o.tracking_no ? String(o.tracking_no).split(' · ')[0] : null,   // Shopee ส่งด่วนต่อท้ายรหัสรับ
    carrier: o.carrier || null,
    items: mergeItems((o.os_order_items || []).map((i) => ({ sku: i.sku, name: i.product_name, qty: i.qty, image: i.image_url }))),
    reason: o.cancel_reason || null,
    state, platform_status: o.raw_status || null,
    started_at: o.cancelled_at || null,
    arrived_at: state === 'arrived' ? (o.platform_updated_at || o.cancelled_at || null) : null,
  };
}

// ยกเลิกก่อนขนส่งเข้ารับ (เงื่อนไขเดียวกับแท็บ ⚠️ หน้า /orders) — ของอยู่ที่ร้าน = ถึงแล้ว
export const CANCEL_PREFIX = 'cancel:';
export function cancelBox(o) {
  return {
    platform: o.platform, shop: o.shop, order_id: o.order_id, kind: 'cancel',
    return_id: null, ret_key: CANCEL_PREFIX + o.order_id,
    tracking_no: o.tracking_no ? String(o.tracking_no).split(' · ')[0] : null,
    carrier: o.carrier || null,
    items: mergeItems((o.os_order_items || []).map((i) => ({ sku: i.sku, name: i.product_name, qty: i.qty, image: i.image_url }))),
    reason: o.cancel_reason || null,
    state: 'arrived', platform_status: o.raw_status || null,
    started_at: o.cancelled_at || null,
    arrived_at: o.cancelled_at || null,
  };
}
export const isRisky = (o) => o.status === 'cancelled' && !o.collected_at && (o.rts_at || o.cancelled_from === 'packed');

const CANCEL_COLS = 'order_id, platform, shop, status, raw_status, tracking_no, carrier, cancel_reason, cancelled_at, collected_at, rts_at, cancelled_from,' +
  ' pulled_at, pulled_by, pull_note, os_order_items(sku, product_name, qty, image_url)';

// ใบยกเลิกที่ยังไม่ได้หยิบออก → กล่อง 'cancel' (ใบที่หยิบไปก่อนมีหน้านี้ ถือว่าคืนสต็อกแล้ว ไม่ดึงมา)
// + ใบที่ไปกด "หยิบของออกแล้ว" ในหน้าออเดอร์ทีหลัง → จดรับให้กล่องที่ยังไม่รับ (ของหมด = ไม่ต้องคืนสต็อก)
async function seedCancelled(sb, since) {
  const { data, error } = await sb.from('os_orders').select(CANCEL_COLS)
    .eq('status', 'cancelled').is('collected_at', null)
    .or('rts_at.not.is.null,cancelled_from.eq.packed')
    .is('pulled_at', null)
    .gte('cancelled_at', new Date(since).toISOString())
    .limit(1000);
  if (error) throw new Error('อ่านใบยกเลิกก่อนขนส่งรับไม่สำเร็จ: ' + error.message);
  const n = await saveBoxes(sb, (data || []).map(cancelBox));

  const { data: open } = await sb.from('os_returns').select('id, order_id').eq('kind', 'cancel').is('recv', null).limit(1000);
  if (open?.length) {
    const { data: pulled } = await sb.from('os_orders').select('order_id, pulled_at, pulled_by, pull_note')
      .in('order_id', open.map((r) => r.order_id)).not('pulled_at', 'is', null);
    const byOrder = new Map((pulled || []).map((o) => [o.order_id, o]));
    for (const r of open) {
      const o = byOrder.get(r.order_id);
      if (!o) continue;
      const noStock = /ของหมด/.test(o.pull_note || '');
      await sb.from('os_returns').update({
        recv: 'full', received_at: o.pulled_at, received_by: o.pulled_by || 'หน้าออเดอร์',
        receive_note: noStock ? SKIP_STOCK_NOTE : (o.pull_note || null),
        ss_at: noStock ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('id', r.id).is('recv', null);
    }
  }
  return n;
}

async function seedFailed(sb, since) {
  let n = 0;
  for (let i = 0; ; i += 1000) {
    const { data, error } = await sb.from('os_orders')
      .select('order_id, platform, shop, raw_status, tracking_no, carrier, cancel_reason, cancelled_at, platform_updated_at,' +
        ' os_order_items(sku, product_name, qty, image_url)')
      .eq('status', 'cancelled').not('collected_at', 'is', null)
      .gte('cancelled_at', new Date(since).toISOString())
      .order('cancelled_at', { ascending: true })
      .range(i, i + 999);
    if (error) throw new Error('อ่านออเดอร์ตีกลับไม่สำเร็จ: ' + error.message);
    n += await saveBoxes(sb, (data || []).map(failedBox).filter(Boolean));
    if (!data || data.length < 1000) return n;
  }
}

// ── 2) ลูกค้าขอคืน ───────────────────────────────────────────────────
export function tiktokBox(r, shop) {
  const state = tiktokReturnState(r);
  if (!state) return null;
  return {
    platform: 'tiktok', shop, order_id: String(r.order_id), kind: 'buyer',
    return_id: String(r.return_id), ret_key: String(r.return_id),
    tracking_no: r.return_tracking_number || null,
    carrier: r.return_provider_name || null,
    items: mergeItems((r.return_line_items || []).map((l) => ({
      sku: l.seller_sku, name: [l.product_name, l.sku_name].filter(Boolean).join(' · '), qty: 1, image: l.product_image?.url,
    }))),
    reason: r.return_reason_text || r.return_reason || null,
    state, platform_status: `${r.return_type}/${r.return_status}`,
    started_at: iso(r.create_time),
    arrived_at: state === 'arrived' ? iso(r.update_time) : null,
  };
}

async function pullTikTok(sb, since, deadline) {
  let n = 0;
  const errs = [];
  for (const row of await listShops('tiktok')) {
    try { n += await pullTikTokShop(sb, row, since, deadline); } catch (e) { errs.push(`${row.shop}: ${e.message}`); }
  }
  // ร้านหนึ่งไม่มีสิทธิ์ (เช่น แอปของ MVP ยังไม่ได้ขอ scope คืนสินค้า) ไม่ให้ลากร้านอื่นพังไปด้วย
  if (errs.length) throw new Error(`ได้ ${n} กล่อง แต่ ` + errs.join(' · '));
  return n;
}

async function pullTikTokShop(sb, row, since, deadline) {
  let n = 0;
  {
    const tok = await usableToken(row);
    let pageToken = '';
    for (let p = 0; p < 50 && Date.now() < deadline; p++) {
      const query = { page_size: '50' };
      if (pageToken) query.page_token = pageToken;
      const data = await ttCall('/return_refund/202309/returns/search', {
        method: 'POST', query, accessToken: tok.access_token, shopCipher: tok.shop_cipher,
        body: { update_time_ge: Math.floor(since / 1000), update_time_lt: Math.floor(Date.now() / 1000) },
      });
      n += await saveBoxes(sb, (data.return_orders || []).map((r) => tiktokBox(r, row.shop)).filter(Boolean));
      pageToken = data.next_page_token || '';
      if (!pageToken) break;
    }
  }
  return n;
}

export function shopeeBox(r, shop) {
  const state = shopeeReturnState(r);
  if (!state) return null;
  return {
    platform: 'shopee', shop, order_id: String(r.order_sn), kind: 'buyer',
    return_id: String(r.return_sn), ret_key: String(r.return_sn),
    tracking_no: r.tracking_number || null,
    carrier: null,
    items: mergeItems((r.item || []).map((i) => ({
      sku: i.variation_sku || i.item_sku, name: i.name, qty: i.amount, image: i.images?.[0],
    }))),
    reason: r.reason || null,
    state, platform_status: r.status || null,
    started_at: iso(r.create_time),
    arrived_at: null,
  };
}

async function pullShopee(sb, since, deadline) {
  let n = 0;
  const end = Date.now();
  const refundOnly = [];
  for (const row of await listShops('shopee')) {
    const tok = await usableToken(row);
    for (let from = since; from < end && Date.now() < deadline; from += SHOPEE_WINDOW) {
      const to = Math.min(from + SHOPEE_WINDOW, end);
      for (let page = 0; page < 50; page++) {
        const data = await spCall('/api/v2/returns/get_return_list', {
          accessToken: tok.access_token, shopId: tok.shop_id, partner: tok,
          params: {
            page_no: String(page), page_size: '50',
            update_time_from: String(Math.floor(from / 1000)), update_time_to: String(Math.floor(to / 1000)),
          },
        });
        n += await saveBoxes(sb, (data.return || []).map((r) => shopeeBox(r, row.shop)).filter(Boolean));
        for (const r of data.return || []) if (shopeeRefundOnly(r)) refundOnly.push({ r, shop: row.shop, tok });
        if (!data.more) break;
      }
    }
  }
  return n + await shopeeRefundFailed(sb, refundOnly, deadline);
}

// คืนเงินอย่างเดียวที่จริง ๆ คือส่งไม่สำเร็จ — ถาม tracking ขาไป ถ้ากำลังตีกลับ/ถึงร้านแล้ว = กล่องตีกลับ
// (เจอ 25 พ.ย.: 2611232TF8PP6M ที่อยู่ผิด ออเดอร์ COMPLETED แต่พัสดุตีกลับถึงร้าน BigSeller นับ "คืนสินค้าแล้ว")
async function shopeeRefundFailed(sb, list, deadline, limit = 15) {
  if (!list.length) return 0;
  const ids = [...new Set(list.map((x) => String(x.r.order_sn)))];
  // ข้ามใบที่รู้แล้ว: ออเดอร์มีกล่องตีกลับอยู่แล้ว · หรือคำขอนี้ถึงร้าน/รับไปแล้ว (เช่น นำเข้าจาก BigSeller)
  const { data: have } = await sb.from('os_returns').select('order_id, kind, ret_key, state, recv').in('order_id', ids);
  const known = new Set((have || []).filter((x) => x.kind === 'failed' && x.ret_key === x.order_id).map((x) => x.order_id));
  const done = new Set((have || []).filter((x) => x.state === 'arrived' || x.recv).map((x) => x.ret_key));
  const todo = list.filter((x) => !known.has(String(x.r.order_sn)) && !done.has(String(x.r.return_sn)))
    .sort((a, b) => Number(b.r.create_time || 0) - Number(a.r.create_time || 0))
    .slice(0, limit);
  const boxes = [];
  for (const { r, shop, tok } of todo) {
    if (Date.now() > deadline) break;
    const opt = { accessToken: tok.access_token, shopId: tok.shop_id, partner: tok, params: { order_sn: r.order_sn } };
    let hit = null, trk = null;
    try {
      hit = shopeeTrackingState((await spCall('/api/v2/logistics/get_tracking_info', opt)).tracking_info);
      if (hit) trk = (await spCall('/api/v2/logistics/get_tracking_number', opt).catch(() => null))?.tracking_number || null;
    } catch { /* ใบนี้ถามไม่ได้ รอบหน้าค่อยถาม */ }
    if (!hit) continue;   // ไม่มีตีกลับ = ลูกค้าได้ของแล้ว คืนเงินบางส่วน ไม่ใช่กล่องคืน
    const b = shopeeBox({ ...r, needs_logistics: true, tracking_number: trk }, shop);
    if (!b) continue;
    // คีย์ตามเลขคำขอคืน (เหมือนไฟล์ BigSeller) — ไม่เกิดกล่องซ้ำกับแถวที่นำเข้ามาแล้ว
    Object.assign(b, {
      kind: 'failed',
      reason: ['ส่งไม่สำเร็จ ลูกค้าได้เงินคืน', r.reason].filter(Boolean).join(' · '),
      state: hit.state, arrived_at: hit.state === 'arrived' ? hit.at : null,
    });
    boxes.push(b);
  }
  return saveBoxes(sb, boxes);
}

// Lazada ยังไม่เคยลองยิง endpoint คืนสินค้าจริง (ปริมาณ ~8 กล่อง/90 วัน) — อ่านแบบเผื่อชื่อฟิลด์
// คืนตัวอย่างก้อนแรกกลับไปให้ดูในผล sync จะได้ปรับให้ตรงทีหลัง
async function pullLazada(sb, since) {
  let n = 0, sample = null;
  for (const row of await listShops('lazada')) {
    const tok = await usableToken(row);
    for (let page = 1; page <= 10; page++) {
      const json = await lzCall('/reverse/getreverseordersforseller', {
        accessToken: tok.access_token, params: { page_size: '50', page_no: String(page) },
      });
      const list = json?.result?.items || json?.data?.items || json?.items || [];
      if (!sample && list[0]) sample = list[0];
      const boxes = [];
      for (const ro of list) {
        const lines = ro.reverse_order_lines || ro.reverse_order_line_list || [];
        // ยิงจริง 25 พ.ย.: เวลาอยู่ที่บรรทัด return_order_line_gmt_create (วินาที) · ofc_status = สถานะขนส่งขากลับ
        // (RETURN_DELIVERED = ส่งถึงร้านแล้ว) · reverse_status = สถานะคำขอ (BUYER_RETURN_ITEM ฯลฯ)
        let created = Number(lines[0]?.return_order_line_gmt_create || ro.create_time || 0);
        if (created && created < 1e12) created *= 1000;
        if (!created || created < since) continue;
        const type = String(ro.request_type || '');
        if (/ONLY_REFUND|REFUND_ONLY/i.test(type)) continue;
        const ofc = String(lines[0]?.ofc_status || '');
        const rev = String(lines[0]?.reverse_status || '');
        const state = /DELIVERED|RECEIVED/i.test(ofc) ? 'arrived'
          : /LOST/i.test(ofc) ? 'lost'
          : /CANCEL|REJECT/i.test(rev) ? 'not_needed' : 'transit';
        const st = [rev, ofc].filter(Boolean).join('/');
        const modified = Number(lines[0]?.return_order_line_gmt_modified || 0);
        boxes.push({
          platform: 'lazada', shop: row.shop, order_id: String(ro.trade_order_id || ''), kind: 'buyer',
          return_id: String(ro.reverse_order_id), ret_key: String(ro.reverse_order_id),
          tracking_no: lines[0]?.tracking_number || null, carrier: null,
          items: mergeItems(lines.map((l) => ({ sku: l.seller_sku_id || l.product?.product_sku, name: l.product?.product_name || l.product_name, qty: 1 }))),
          reason: lines[0]?.reason_text || null,
          state, platform_status: st || type || null,
          started_at: new Date(created).toISOString(),
          arrived_at: state === 'arrived' && modified ? new Date(modified * 1000).toISOString() : null,
        });
      }
      n += await saveBoxes(sb, boxes.filter((b) => b.order_id && b.ret_key !== 'undefined'));
      if (list.length < 50) break;
    }
  }
  return { n, sample };
}

// ── 3) ถามสถานะขนส่งของกล่องที่ยังไม่ถึง ──────────────────────────────
async function tokens(platform) {
  const out = new Map();
  for (const row of await listShops(platform)) {
    try { out.set(row.shop, await usableToken(row)); } catch { /* ร้านนี้โทเคนพัง ข้ามไป */ }
  }
  return out;
}

// กล่องตีกลับ Shopee ที่ออเดอร์ไม่มีเลขพัสดุ (ดึงออเดอร์มาตอนยังไม่แพ็ค) — ถามเลขจาก Shopee ให้พนักงานยิงบาร์โค้ดกล่องเจอ
async function fillShopeeTracking(sb, deadline, limit = 20) {
  const { data, error } = await sb.from('os_returns')
    .select('id, shop, order_id')
    .eq('platform', 'shopee').eq('kind', 'failed')
    .is('tracking_no', null).is('recv', null).neq('state', 'not_needed')
    .limit(limit);
  if (error) throw new Error(error.message);
  if (!data?.length) return 0;
  const sp = await tokens('shopee');
  let n = 0;
  for (const r of data) {
    if (Date.now() > deadline) break;
    const tok = sp.get(r.shop);
    if (!tok) continue;
    try {
      const d = await spCall('/api/v2/logistics/get_tracking_number', {
        accessToken: tok.access_token, shopId: tok.shop_id, partner: tok, params: { order_sn: r.order_id },
      });
      if (!d?.tracking_number) continue;
      await sb.from('os_returns').update({ tracking_no: d.tracking_number, updated_at: new Date().toISOString() }).eq('id', r.id);
      n++;
    } catch { /* ถามไม่ได้ รอบหน้าค่อยถาม */ }
  }
  return n;
}

async function checkArrivals(sb, limit, deadline) {
  const { data, error } = await sb.from('os_returns')
    .select('id, platform, shop, order_id, kind, return_id, state')
    .in('state', ['waiting', 'transit'])
    .is('recv', null)
    .in('platform', ['tiktok', 'shopee'])
    .order('checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  if (!data?.length) return 0;
  const tt = await tokens('tiktok');
  const sp = await tokens('shopee');
  let n = 0;
  for (const r of data) {
    if (Date.now() > deadline) break;
    let hit = null;
    try {
      if (r.platform === 'tiktok') {
        const tok = tt.get(r.shop);
        if (!tok) continue;
        if (r.kind === 'failed') {
          const d = await ttCall(`/fulfillment/202309/orders/${r.order_id}/tracking`, { accessToken: tok.access_token, shopCipher: tok.shop_cipher });
          hit = tiktokTrackingState(d.tracking);
        } else {
          const d = await ttCall(`/return_refund/202309/returns/${r.return_id}/records`, {
            query: { locale: 'th-TH' }, accessToken: tok.access_token, shopCipher: tok.shop_cipher,
          });
          hit = tiktokRecordsState(d.records);
        }
      } else {
        const tok = sp.get(r.shop);
        if (!tok) continue;
        const opt = { accessToken: tok.access_token, shopId: tok.shop_id, partner: tok };
        if (r.kind === 'failed') {
          const d = await spCall('/api/v2/logistics/get_tracking_info', { ...opt, params: { order_sn: r.order_id } });
          hit = shopeeTrackingState(d.tracking_info);
        } else {
          const d = await spCall('/api/v2/returns/get_reverse_tracking_info', { ...opt, params: { return_sn: r.return_id } });
          hit = shopeeReverseState(d);
        }
      }
    } catch { /* ใบนี้ถามไม่ได้ (เช่น ออเดอร์เก่าเกิน) ข้ามไป รอบหน้าค่อยถามใหม่ */ }
    const patch = { checked_at: new Date().toISOString() };
    if (hit) {
      const state = laterState(r.state, hit.state);
      if (state !== r.state) patch.state = state;
      if (hit.at && state === 'arrived') patch.arrived_at = hit.at;
    }
    await sb.from('os_returns').update(patch).eq('id', r.id);
    if (hit) n++;
  }
  return n;
}

// ── 4) ออเดอร์ที่ยังขึ้น "กำลังส่ง" นานผิดปกติ — อาจกำลังตีกลับทั้งที่ยังไม่ถูกยกเลิก ──────
// TikTok/Shopee ยกเลิกออเดอร์ตอนของถึงร้านแล้ว ระหว่างทางยังเป็น IN_TRANSIT / SHIPPED
// (เทียบกับ BigSeller 25 พ.ย.: 19 กล่อง "อยู่ระหว่างคืนสินค้า" เป็นแบบนี้ทั้งหมด)
// ขนส่งรับไปเกิน 2 วันแล้วยังไม่ถึงมือลูกค้า มีราว 340 ใบ/90 วัน (25 พ.ย.) — ถามทีละ probeLimit ใบ หมุนไปเรื่อยๆ ครบรอบราว 10 ชั่วโมง
async function probeShipped(sb, probeLimit, deadline) {
  const now = Date.now();
  const { data, error } = await sb.from('os_orders')
    .select('order_id, platform, shop, raw_status, tracking_no, carrier, cancel_reason, cancelled_at, platform_updated_at,' +
      ' os_order_items(sku, product_name, qty, image_url)')
    .eq('status', 'shipped').in('platform', ['tiktok', 'shopee'])
    .lt('collected_at', new Date(now - 2 * DAY).toISOString())
    .gt('collected_at', new Date(now - 90 * DAY).toISOString())
    .order('order_id', { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  const { data: have } = await sb.from('os_returns').select('order_id')
    .in('order_id', (data || []).map((o) => o.order_id)).eq('kind', 'failed');
  const known = new Set((have || []).map((r) => r.order_id));
  const todo = (data || []).filter((o) => !known.has(o.order_id));
  if (!todo.length) return 0;
  // หมุนทีละช่วง 15 นาที (ตรงกับ cron sync-returns-probe + รอบใหญ่ — ชั่วโมงละ 4 รอบ ไม่ซ้ำชุดกัน)
  // ~400 ใบ รอบละ ~90 → ครบทุกใบใน ~75 นาที
  const start = (Math.floor(now / 900000) * probeLimit) % todo.length;
  const pick = [...todo.slice(start), ...todo.slice(0, start)].slice(0, probeLimit);
  const tt = await tokens('tiktok');
  const sp = await tokens('shopee');
  const boxes = [];
  for (const o of pick) {
    if (Date.now() > deadline) break;
    let hit = null;
    try {
      if (o.platform === 'tiktok') {
        const tok = tt.get(o.shop);
        if (!tok) continue;
        const d = await ttCall(`/fulfillment/202309/orders/${o.order_id}/tracking`, { accessToken: tok.access_token, shopCipher: tok.shop_cipher });
        hit = tiktokTrackingState(d.tracking);
      } else {
        const tok = sp.get(o.shop);
        if (!tok) continue;
        const d = await spCall('/api/v2/logistics/get_tracking_info', {
          accessToken: tok.access_token, shopId: tok.shop_id, partner: tok, params: { order_sn: o.order_id },
        });
        hit = shopeeTrackingState(d.tracking_info);
      }
    } catch { /* ใบนี้ถามไม่ได้ รอบหน้าค่อยถาม */ }
    if (!hit) continue;
    const b = failedBox({ ...o, cancel_reason: o.cancel_reason || 'กำลังตีกลับ (ออเดอร์ยังไม่ถูกยกเลิก)' });
    if (!b) continue;
    b.state = hit.state;
    b.arrived_at = hit.state === 'arrived' ? hit.at : null;
    b.started_at = o.platform_updated_at || null;
    boxes.push(b);
  }
  return saveBoxes(sb, boxes);
}

// ── อ่านไปแสดง ───────────────────────────────────────────────────────
// ทุกกล่องย้อนหลัง days วัน (ปกติ 90 เท่า BigSeller ~1,200 กล่อง) — กรอง/นับในหน้าเอง
export async function loadBoxes(days = 90) {
  const sb = db();
  const since = new Date(Date.now() - days * DAY).toISOString();
  const all = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await sb.from('os_returns')
      .select('id, platform, shop, order_id, kind, return_id, tracking_no, carrier, items, reason, state, platform_status,' +
        ' started_at, arrived_at, recv, received_at, received_by, receive_note, missing')
      .gte('started_at', since)
      .order('id', { ascending: true })
      .range(i, i + 999);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < 1000) return all;
  }
}

// ── รวม ──────────────────────────────────────────────────────────────
// days = ดึงย้อนหลังกี่วัน (รอบปกติ 3 วันทับกันไว้ · รอบแรกสั่ง ?days=90)
// แต่ละขั้นพังแยกกัน ขั้นหนึ่งพังไม่ทำให้ขั้นอื่นไม่ได้ทำ
export async function runReturnsSync({ days = 3, checkLimit = 40, budgetMs = 20000, only = null } = {}) {
  const sb = db();
  const t0 = Date.now();
  const deadline = t0 + budgetMs;
  const since = t0 - days * DAY;
  const out = { errors: [] };
  const step = async (name, fn) => {
    if (only && !only.includes(name)) return;
    try { out[name] = await fn(); } catch (e) { out.errors.push(`${name}: ${String(e.message || e)}`); }
  };
  await step('failed', () => seedFailed(sb, since));
  await step('cancel', () => seedCancelled(sb, since));
  await step('tiktok', () => pullTikTok(sb, since, deadline));
  await step('shopee', () => pullShopee(sb, since, deadline));
  await step('lazada', () => pullLazada(sb, since));
  await step('tracking', () => fillShopeeTracking(sb, deadline));
  await step('checked', () => checkArrivals(sb, checkLimit, deadline));
  await step('probed', () => probeShipped(sb, Math.max(10, Math.round(checkLimit * 0.75)), deadline));
  out.ms = Date.now() - t0;
  return out;
}
