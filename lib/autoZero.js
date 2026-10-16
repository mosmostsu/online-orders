// ตัดคลัง/คืนคลังอัตโนมัติ — ออเดอร์เข้ามาแล้ว SKU ไหนของหมด ตั้งคลังตัวเลือกนั้นเป็น 0 ทุกร้านที่ลงไว้ทันที
// ไม่ต้องรอ Colab อัปคลังรอบถัดไป (ดู memory colab-sync-stock-notebook)
//
// เรียกจาก webhook Shopee / TikTok / Lazada หลังบันทึกออเดอร์แล้ว:
//   คงเหลือ = os_st − ออเดอร์ทุกร้านที่สั่งหลังเวลาไฟล์ ST และกินของแล้ว (SQL os_auto_zero_remaining)
//   os_st หักออเดอร์รอส่ง ณ ตอน Colab รันไปแล้ว — หักเฉพาะใบหลังเวลาไฟล์ ไม่งั้นหักซ้ำ
//
//   ตัด: ออเดอร์ "รอจัดส่ง" ของร้านที่เฝ้า → คงเหลือ ≤ AUTO_ZERO_AT (ค่าเริ่ม 0)
//        → ตั้งคลังเป็น 0 เฉพาะตัวเลือก (สี/ไซส์) นั้น ทุกร้านที่เฝ้า ตัวเลือกอื่นในตะกร้าไม่แตะ
//   คืน: ลูกค้ายกเลิกตอนเรา "ยังไม่กดจัดส่ง" (rts_at ว่าง) → คงเหลือกลับมาเกิน AUTO_ZERO_AT
//        → ตั้งคลังกลับเป็นคงเหลือ เฉพาะตัวเลือกที่ระบบนี้เป็นคนตัดในไฟล์ ST รอบเดียวกัน
//        ยกเลิกหลังกดจัดส่ง = ของอาจแพ็ค/ออกจากร้านไปแล้ว ไม่คืน · ตัวที่เราไม่ได้ตัดเองไม่แตะ
//
// ไม่ใช่ระบบสต็อกคู่ขนาน (ดู CLAUDE.md) — ตัวเลขคิดจาก ST ทุกครั้ง ไฟล์ ST ใหม่มา Colab ตั้งตัวเลขจริงทับ
//
// สวิตช์: AUTO_ZERO=on ถึงจะยิงจริง · ค่าอื่น/ไม่ตั้ง = ทดลอง แจ้ง Telegram ว่า "จะตัด/จะคืน" อย่างเดียว
// บันทึกทุกครั้งใน os_auto_zero (supabase/058) — ตัวเลือกเดิมตัดแล้ว (ยังไม่คืน) ในไฟล์ ST รอบเดียวกันไม่ยิงซ้ำ
//
// โทเคน: ใช้ตามที่เก็บไว้ ไม่ต่ออายุเอง — TikTok SOLID ใช้แอปเดียวกับ Colab ต่ออายุแย่งกันจะพัง
// (รอบซิงก์ปกติของเว็บต่ออายุให้อยู่แล้ว · หมดอายุ = ยิงไม่ผ่าน แจ้ง error ใน Telegram)
import { db } from './supabase.js';
import { setStock as setShopee } from './shopee.js';
import { setStock as setTiktok, bindToken } from './tiktok.js';
import { setStock as setLazada } from './lazada.js';
import { pushTelegram } from './telegram.js';

// ร้านที่เฝ้าออเดอร์ + ร้านที่ตัด/คืนคลัง (ชุดเดียวกัน)
export const AUTO_ZERO_SHOPS = [
  { platform: 'shopee', shop: 'SOLID' },
  { platform: 'shopee', shop: 'REAL' },
  { platform: 'tiktok', shop: 'SOLID' },
  { platform: 'tiktok', shop: 'MVP' },     // แอปแยก (extra.app = MVP) — ต้องมี scope Product เขียน ไม่งั้นยิงคลังไม่ผ่าน
  { platform: 'lazada', shop: 'SOLID' },
];
const watched = (platform, shop) => AUTO_ZERO_SHOPS.some((s) => s.platform === platform && s.shop === shop);
const LABEL = { shopee: 'Shopee', tiktok: 'TikTok', lazada: 'Lazada' };

const isLive = () => process.env.AUTO_ZERO === 'on';
const threshold = () => {
  const n = parseInt(process.env.AUTO_ZERO_AT || '0', 10);
  return Number.isFinite(n) ? n : 0;
};

// ilike ใช้ % กับ _ เป็นตัวพิเศษ — รหัสสินค้ามี _ ได้
const likeExact = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

// ใบไหนกินของในชั้นไปแล้ว — คิดใน SQL os_auto_zero_remaining (supabase/058) ให้ตรงกันด้วย
//   ไฟล์ ST เป็นภาพ ณ เวลาเดียว ใบที่สั่งหลังไฟล์กินของทุกสถานะ (รอส่ง / แพ็คแล้ว / ส่งแล้ว)
//   ไม่นับ: ยังไม่จ่ายเงิน · ยกเลิกจบแล้ว · Shopee IN_CANCEL (ลูกค้า "ขอ" ยกเลิก) ยังนับว่ากินของ
// คืนคลังเฉพาะยกเลิกที่จบแล้ว — ไม่ใช่ IN_CANCEL และไม่ใช่ TO_RETURN (คืนของหลังส่ง)
// Lazada: returned / shipped_back / failed = ยกเลิกหลังส่งของออกไปแล้ว ไม่คืนเหมือนกัน
const NOT_RESTORE = new Set(['in_cancel', 'to_return', 'returned', 'shipped_back', 'failed']);
const finallyCancelled = (o) => o.status === 'cancelled' && !NOT_RESTORE.has(String(o.raw_status || '').toLowerCase());

// คงเหลือสดๆ ของรหัสนี้ คำสั่งเดียว เทียบแบบไม่สนตัวพิมพ์ทั้ง ST และออเดอร์
// null = รหัสไม่อยู่ใน ST (อาจพิมพ์ผิดบนแพลตฟอร์ม ไม่แตะ)
async function remainingOf(sb, sku, stAt) {
  const { data, error } = await sb.rpc('os_auto_zero_remaining', { p_skus: [sku], p_since: stAt });
  if (error) throw new Error('คิดคงเหลือไม่สำเร็จ: ' + error.message);
  const r = data?.[0];
  if (!r) return null;
  const stQty = Number(r.st_qty) || 0;
  const ship = Number(r.sold) || 0;
  return { sku: r.st_sku, stQty, ship, left: stQty - ship };
}

// ตัวเลือกที่ผูกรหัสนี้ไว้ในร้านที่เฝ้า (ไม่สนตัวพิมพ์เล็กใหญ่)
async function targetsOf(sb, sku) {
  const { data, error } = await sb.from('os_listing_skus')
    .select('platform, shop, product_id, sku_id, variant')
    .ilike('seller_sku', likeExact(sku))
    .in('platform', [...new Set(AUTO_ZERO_SHOPS.map((s) => s.platform))]);
  if (error) throw new Error('อ่านตะกร้าไม่สำเร็จ: ' + error.message);
  return (data || []).filter((r) => watched(r.platform, r.shop));
}

// ตัวเลือกของรหัสนี้ที่ตัดไปแล้ว (ยังไม่คืน) ในไฟล์ ST รอบนี้ — ถามทีเดียวทั้งรหัส
async function zeroedKeys(sb, sku, stAt, dry) {
  const { data, error } = await sb.from('os_auto_zero')
    .select('platform, shop, sku_id')
    .eq('sku', sku).eq('st_file_at', stAt).eq('dry_run', dry).eq('ok', true)
    .is('restored_at', null);
  if (error) throw new Error('อ่าน os_auto_zero ไม่สำเร็จ: ' + error.message);
  return new Set((data || []).map((r) => `${r.platform}|${r.shop}|${r.sku_id}`));
}

async function tokenOf(sb, platform, shop) {
  const { data } = await sb.from('os_shop_tokens').select('*').eq('platform', platform).eq('shop', shop).maybeSingle();
  return data || null;
}

// ยิงตั้งคลังทีละตะกร้า (ตัวเลือกหลายตัวในตะกร้าเดียวกันส่งรวบคำขอเดียว)
async function pushStock(sb, platform, shop, productId, skuIds, qty) {
  const tok = await tokenOf(sb, platform, shop);
  if (!tok?.access_token) return skuIds.map((id) => ({ skuId: String(id), error: 'ร้านนี้ยังไม่ได้ผูก API' }));
  try {
    if (platform === 'lazada') {
      return await setLazada({ accessToken: tok.access_token, itemId: productId, skuIds, qty });
    }
    if (platform === 'shopee') {
      return await setShopee({ accessToken: tok.access_token, shopId: tok.shop_id, partner: tok, itemId: productId, skuIds, qty });
    }
    bindToken(tok.access_token, tok.extra?.app || '');
    return await setTiktok({ accessToken: tok.access_token, shopCipher: tok.shop_cipher, productId, skuIds, qty });
  } catch (e) {
    return skuIds.map((id) => ({ skuId: String(id), error: String(e.message || e).slice(0, 300) }));
  }
}

// ตั้งคลังให้ทุกเป้า รวบตามตะกร้า → คืน [{ t, error }]
async function applyAll(sb, targets, qty, dry) {
  const byProduct = new Map();
  for (const t of targets) {
    const k = `${t.platform}|${t.shop}|${t.product_id}`;
    if (!byProduct.has(k)) byProduct.set(k, []);
    byProduct.get(k).push(t);
  }
  const out = [];
  for (const list of byProduct.values()) {
    const { platform, shop, product_id } = list[0];
    const results = dry
      ? list.map((t) => ({ skuId: String(t.sku_id), error: null }))
      : await pushStock(sb, platform, shop, product_id, list.map((t) => t.sku_id), qty);
    for (const t of list) {
      const res = results.find((x) => x.skuId === String(t.sku_id)) || { error: 'ไม่ได้ผลตอบกลับ' };
      out.push({ t, error: res.error || null });
    }
  }
  return out;
}

const line = ({ t, error }) =>
  `  ${error ? '❌' : '✅'} ${LABEL[t.platform]} ${t.shop}${t.variant ? ' · ' + t.variant : ''}${error ? ' — ' + error : ''}`;

const skusOf = (r) => [...new Set((r.items || []).map((it) => String(it.sku || '').trim()).filter(Boolean))];
const orderLabel = (o) => `${LABEL[o.platform]} ${o.shop} ${o.order_id}`;

async function zeroSku(sb, sku, fromOrder, stAt, dry) {
  const rem = await remainingOf(sb, sku, stAt);
  if (!rem || rem.left > threshold()) return null;

  const done0 = await zeroedKeys(sb, rem.sku, stAt, dry);
  const todo = (await targetsOf(sb, rem.sku)).filter((t) => !done0.has(`${t.platform}|${t.shop}|${t.sku_id}`));
  if (!todo.length) return null;

  const done = await applyAll(sb, todo, 0, dry);
  const { error } = await sb.from('os_auto_zero').insert(done.map(({ t, error: err }) => ({
    sku: rem.sku, platform: t.platform, shop: t.shop, product_id: t.product_id, sku_id: t.sku_id, variant: t.variant,
    st_file_at: stAt, st_qty: rem.stQty, to_ship: rem.ship, remaining: rem.left,
    from_order: fromOrder, dry_run: dry, ok: !err, error: err,
  })));
  if (error) console.error('บันทึก os_auto_zero ไม่สำเร็จ:', error.message);
  return `🔻 ${rem.sku} เหลือ ${rem.left} (ST ${rem.stQty} − ขายหลังไฟล์ ST ${rem.ship}) จาก ${fromOrder}\n${done.map(line).join('\n')}`;
}

async function restoreSku(sb, sku, fromOrder, stAt, dry) {
  const rem = await remainingOf(sb, sku, stAt);
  if (!rem || rem.left <= threshold()) return null;

  // คืนเฉพาะตัวที่ระบบนี้ตัดไปเองในไฟล์ ST รอบนี้ และยังไม่ได้คืน
  const { data: rows, error: e1 } = await sb.from('os_auto_zero')
    .select('id, platform, shop, product_id, sku_id, variant')
    .eq('sku', rem.sku).eq('st_file_at', stAt).eq('dry_run', dry).eq('ok', true)
    .is('restored_at', null);
  if (e1) throw new Error('อ่าน os_auto_zero ไม่สำเร็จ: ' + e1.message);
  if (!rows?.length) return null;

  const done = await applyAll(sb, rows, rem.left, dry);
  const now = new Date().toISOString();
  for (const { t, error } of done) {
    // คืนไม่สำเร็จ = ยังนับว่าตัดอยู่ ยกเลิกใบถัดไปจะลองคืนอีก
    if (error) continue;
    const { error: e2 } = await sb.from('os_auto_zero')
      .update({ restored_at: now, restored_qty: rem.left, restored_by: fromOrder })
      .eq('id', t.id);
    if (e2) console.error('บันทึกการคืนคลังไม่สำเร็จ:', e2.message);
  }
  let msg = `🔺 ${rem.sku} คืนเป็น ${rem.left} (ST ${rem.stQty} − ขายหลังไฟล์ ST ${rem.ship}) ยกเลิกจาก ${fromOrder}\n${done.map(line).join('\n')}`;

  // กันคืนทับหลังตัด: ระหว่างคิดกับยิงคืน อาจมีออเดอร์ใหม่ (webhook อีกตัว) เข้ามาแล้วตั้ง 0 ไปก่อน
  // คิดใหม่อีกรอบ ถ้าหมดแล้วตั้ง 0 ซ้ำทันที (ตัวที่เพิ่งคืนถูกนับว่ายังไม่ตัด จึงตัดได้อีก)
  const again = await zeroSku(sb, sku, `${fromOrder} (เช็คซ้ำหลังคืน)`, stAt, dry);
  if (again) msg += `\n${again}`;
  return msg;
}

export async function autoZeroFromOrders(records) {
  const zero = new Map();    // sku → ออเดอร์ที่ทำให้เช็ค
  const restore = new Map();
  for (const r of records || []) {
    const o = r.order;
    if (!watched(o.platform, o.shop)) continue;
    if (o.status === 'to_ship') {
      for (const s of skusOf(r)) if (!zero.has(s)) zero.set(s, orderLabel(o));
    } else if (finallyCancelled(o) && !o.rts_at) {
      // ยกเลิกตอนยังไม่กดจัดส่ง — ของยังอยู่บนชั้น ขายต่อได้
      for (const s of skusOf(r)) if (!restore.has(s)) restore.set(s, orderLabel(o));
    }
  }
  if (!zero.size && !restore.size) return { skipped: 'ไม่มีออเดอร์ที่ต้องเช็ค' };

  const sb = db();
  const { data: meta } = await sb.from('os_st_meta').select('file_modified').eq('id', 1).maybeSingle();
  const stAt = meta?.file_modified;
  if (!stAt) return { skipped: 'ไม่รู้เวลาไฟล์ ST' };

  const dry = !isLive();
  const report = [];
  for (const [sku, from] of zero) {
    const msg = await zeroSku(sb, sku, from, stAt, dry);
    if (msg) report.push(msg);
  }
  for (const [sku, from] of restore) {
    const msg = await restoreSku(sb, sku, from, stAt, dry);
    if (msg) report.push(msg);
  }

  if (report.length) {
    const head = dry ? '🧪 ตัด/คืนคลังอัตโนมัติ (โหมดทดลอง — ยังไม่ได้แก้คลังจริง)' : 'ตัด/คืนคลังอัตโนมัติ';
    await pushTelegram(`${head}\n\n${report.join('\n\n')}`, {
      chatId: process.env.AUTO_ZERO_TELEGRAM_CHAT_ID || process.env.MVP_TELEGRAM_CHAT_ID,
    });
  }
  return { zero: zero.size, restore: restore.size, reported: report.length, dry };
}
