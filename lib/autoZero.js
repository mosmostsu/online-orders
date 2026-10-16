// ตัดคลังอัตโนมัติ — ออเดอร์เข้ามาแล้ว SKU ไหนของหมด ตั้งคลังตัวเลือกนั้นเป็น 0 ทุกร้านที่ลงไว้ทันที
// ไม่ต้องรอ Colab อัปคลังรอบถัดไป (ดู memory colab-sync-stock-notebook)
//
// เรียกจาก webhook Shopee / TikTok หลังบันทึกออเดอร์แล้ว:
//   1. เอา SKU ในออเดอร์ "รอจัดส่ง" ของร้านที่เฝ้า
//   2. คงเหลือ = os_st − ออเดอร์รอส่งทุกร้านที่สั่งหลังเวลาไฟล์ ST (สูตรเดียวกับ app/api/mvp/stock)
//      os_st หักออเดอร์รอส่ง ณ ตอน Colab รันไปแล้ว — หักเฉพาะใบหลังเวลาไฟล์ ไม่งั้นหักซ้ำ
//   3. คงเหลือ ≤ AUTO_ZERO_AT (ค่าเริ่ม 0) → ตั้งคลังเป็น 0 เฉพาะตัวเลือก (สี/ไซส์) นั้น ทุกร้านที่เฝ้า
//      ตัวเลือกอื่นในตะกร้าเดียวกันไม่แตะ
//
// ลดอย่างเดียว ไม่บวกคืน — ยกเลิก/ของเข้าใหม่ ให้ Colab รอบถัดไปตั้งตัวเลขจริงกลับเอง
// (ไม่ใช่ระบบสต็อกคู่ขนาน ดู CLAUDE.md)
//
// สวิตช์: AUTO_ZERO=on ถึงจะยิงจริง · ค่าอื่น/ไม่ตั้ง = ทดลอง แจ้ง Telegram ว่า "จะตัด" อย่างเดียว
// บันทึกทุกครั้งใน os_auto_zero (supabase/058) — ตัวเลือกเดิมตัดแล้วในไฟล์ ST รอบเดียวกันจะไม่ยิงซ้ำ
// ไฟล์ ST ใหม่มา (Colab อาจตั้งคลังกลับ) ถึงตัดซ้ำได้
//
// โทเคน: ใช้ตามที่เก็บไว้ ไม่ต่ออายุเอง — TikTok ใช้แอปเดียวกับ Colab ต่ออายุแย่งกันจะพัง
import { db } from './supabase.js';
import { zeroStock as zeroShopee } from './shopee.js';
import { zeroStock as zeroTiktok, bindToken } from './tiktok.js';
import { pushTelegram } from './telegram.js';

// ร้านที่เฝ้าออเดอร์ + ร้านที่ตัดคลัง (ชุดเดียวกัน)
export const AUTO_ZERO_SHOPS = [
  { platform: 'shopee', shop: 'SOLID' },
  { platform: 'shopee', shop: 'REAL' },
  { platform: 'tiktok', shop: 'SOLID' },
];
const watched = (platform, shop) => AUTO_ZERO_SHOPS.some((s) => s.platform === platform && s.shop === shop);
const LABEL = { shopee: 'Shopee', tiktok: 'TikTok' };

const isLive = () => process.env.AUTO_ZERO === 'on';
const threshold = () => {
  const n = parseInt(process.env.AUTO_ZERO_AT || '0', 10);
  return Number.isFinite(n) ? n : 0;
};

// ilike ใช้ % กับ _ เป็นตัวพิเศษ — รหัสสินค้ามี _ ได้
const likeExact = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

async function stOf(sb, sku) {
  const { data: exact } = await sb.from('os_st').select('sku, qty').eq('sku', sku).limit(1);
  if (exact?.length) return exact[0];
  const { data } = await sb.from('os_st').select('sku, qty').ilike('sku', likeExact(sku)).limit(1);
  return data?.[0] || null;
}

async function toShipSince(sb, skus, since) {
  const { data, error } = await sb.from('os_order_items')
    .select('qty, os_orders!inner(status, ordered_at)')
    .in('sku', skus)
    .eq('os_orders.status', 'to_ship')
    .gt('os_orders.ordered_at', since);
  if (error) throw new Error('อ่านออเดอร์รอส่งไม่สำเร็จ: ' + error.message);
  return (data || []).reduce((n, r) => n + (Number(r.qty) || 0), 0);
}

// ตัวเลือกที่ผูกรหัสนี้ไว้ในร้านที่เฝ้า (ไม่สนตัวพิมพ์เล็กใหญ่)
async function targetsOf(sb, sku) {
  const { data, error } = await sb.from('os_listing_skus')
    .select('platform, shop, product_id, sku_id, variant')
    .ilike('seller_sku', likeExact(sku))
    .in('platform', ['shopee', 'tiktok']);
  if (error) throw new Error('อ่านตะกร้าไม่สำเร็จ: ' + error.message);
  return (data || []).filter((r) => watched(r.platform, r.shop));
}

async function alreadyDone(sb, t, stAt, dry) {
  const { data } = await sb.from('os_auto_zero')
    .select('id')
    .eq('platform', t.platform).eq('shop', t.shop).eq('sku_id', t.sku_id)
    .eq('st_file_at', stAt).eq('dry_run', dry).eq('ok', true)
    .limit(1);
  return Boolean(data?.length);
}

async function tokenOf(sb, platform, shop) {
  const { data } = await sb.from('os_shop_tokens').select('*').eq('platform', platform).eq('shop', shop).maybeSingle();
  return data || null;
}

// ยิงตั้ง 0 ทีละตะกร้า (ตัวเลือกหลายตัวในตะกร้าเดียวกันส่งรวบคำขอเดียว)
async function pushZero(sb, platform, shop, productId, skuIds) {
  const tok = await tokenOf(sb, platform, shop);
  if (!tok?.access_token) return skuIds.map((id) => ({ skuId: id, error: 'ร้านนี้ยังไม่ได้ผูก API' }));
  try {
    if (platform === 'shopee') {
      return await zeroShopee({ accessToken: tok.access_token, shopId: tok.shop_id, partner: tok, itemId: productId, skuIds });
    }
    bindToken(tok.access_token, tok.extra?.app || '');
    return await zeroTiktok({ accessToken: tok.access_token, shopCipher: tok.shop_cipher, productId, skuIds });
  } catch (e) {
    return skuIds.map((id) => ({ skuId: id, error: String(e.message || e).slice(0, 300) }));
  }
}

export async function autoZeroFromOrders(records) {
  const skus = new Map(); // sku → order ที่ทำให้เช็ค
  for (const r of records || []) {
    const o = r.order;
    if (o.status !== 'to_ship' || !watched(o.platform, o.shop)) continue;
    for (const it of r.items || []) {
      const s = String(it.sku || '').trim();
      if (s && !skus.has(s)) skus.set(s, `${LABEL[o.platform]} ${o.shop} ${o.order_id}`);
    }
  }
  if (!skus.size) return { skipped: 'ไม่มีออเดอร์รอส่งของร้านที่เฝ้า' };

  const sb = db();
  const { data: meta } = await sb.from('os_st_meta').select('file_modified').eq('id', 1).maybeSingle();
  const stAt = meta?.file_modified;
  if (!stAt) return { skipped: 'ไม่รู้เวลาไฟล์ ST' };

  const dry = !isLive();
  const at = threshold();
  const report = [];

  for (const [sku, fromOrder] of skus) {
    const st = await stOf(sb, sku);
    if (!st) continue; // รหัสไม่อยู่ใน ST — อาจพิมพ์ผิดบนแพลตฟอร์ม ไม่ตัดมั่ว
    const ship = await toShipSince(sb, [...new Set([sku, st.sku])], stAt);
    const left = Math.floor(Number(st.qty) || 0) - ship;
    if (left > at) continue;

    const todo = [];
    for (const t of await targetsOf(sb, st.sku)) {
      if (!(await alreadyDone(sb, t, stAt, dry))) todo.push(t);
    }
    if (!todo.length) continue;

    // รวบตามตะกร้า
    const byProduct = new Map();
    for (const t of todo) {
      const k = `${t.platform}|${t.shop}|${t.product_id}`;
      if (!byProduct.has(k)) byProduct.set(k, []);
      byProduct.get(k).push(t);
    }

    const lines = [];
    const logs = [];
    for (const list of byProduct.values()) {
      const { platform, shop, product_id } = list[0];
      const results = dry
        ? list.map((t) => ({ skuId: t.sku_id, error: null }))
        : await pushZero(sb, platform, shop, product_id, list.map((t) => t.sku_id));
      for (const t of list) {
        const res = results.find((x) => x.skuId === String(t.sku_id)) || { error: 'ไม่ได้ผลตอบกลับ' };
        lines.push(`  ${res.error ? '❌' : '✅'} ${LABEL[platform]} ${shop}${t.variant ? ' · ' + t.variant : ''}${res.error ? ' — ' + res.error : ''}`);
        logs.push({
          sku: st.sku, platform, shop, product_id, sku_id: t.sku_id,
          st_file_at: stAt, st_qty: Number(st.qty) || 0, to_ship: ship, remaining: left,
          from_order: fromOrder, dry_run: dry, ok: !res.error, error: res.error,
        });
      }
    }
    const { error } = await sb.from('os_auto_zero').insert(logs);
    if (error) console.error('บันทึก os_auto_zero ไม่สำเร็จ:', error.message);
    report.push(`${st.sku} เหลือ ${left} (ST ${Number(st.qty) || 0} − รอส่งหลังไฟล์ ST ${ship}) จาก ${fromOrder}\n${lines.join('\n')}`);
  }

  if (report.length) {
    const head = dry ? '🧪 ตัดคลังอัตโนมัติ (โหมดทดลอง — ยังไม่ได้ตั้ง 0 จริง)' : '🔻 ตัดคลังอัตโนมัติ — ตั้งคลังเป็น 0';
    await pushTelegram(`${head}\n\n${report.join('\n\n')}`, {
      chatId: process.env.AUTO_ZERO_TELEGRAM_CHAT_ID || process.env.MVP_TELEGRAM_CHAT_ID,
    });
  }
  return { checked: skus.size, zeroed: report.length, dry };
}
