// อ่านโทเคนของร้านจาก DB และต่ออายุให้เองถ้าใกล้หมด
import { db } from './supabase.js';
import { refreshToken as refreshTikTok, bindToken as bindTikTokApp } from './tiktok.js';
import { refreshToken as refreshShopee } from './shopee.js';
import { refreshToken as refreshLazada } from './lazada.js';

const REFRESH_BEFORE_MS = 30 * 60 * 1000; // เหลือน้อยกว่าครึ่งชั่วโมง → ต่ออายุเลย

export async function listShops(platform) {
  const { data, error } = await db().from('os_shop_tokens').select('*').eq('platform', platform);
  if (error) throw new Error(error.message);
  return data || [];
}

// สำหรับหน้าที่อ่านอย่างเดียว (เช่น /discount) — ใช้โทเคนใน DB ตรงๆ ไม่ต่ออายุเอง
// refresh_token ของ Shopee ใช้ได้ครั้งเดียว ถ้าหลายที่ต่ออายุพร้อมกัน ฝั่งหนึ่งจะได้โทเคนที่ใช้ไม่ได้ (ไม่มีล็อก)
// ปล่อยให้รอบซิงก์ออเดอร์ (ทุก 30 นาที ต่ออายุเมื่อเหลือ < 30 นาที) เป็นคนต่ออายุ — ปกติโทเคนใน DB จึงยังไม่หมด
export function readOnlyToken(row) {
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expires && expires - Date.now() < 60 * 1000) {
    throw new Error(`โทเคน ${row.platform} ${row.shop} หมดอายุ — รอรอบซิงก์ออเดอร์ต่ออายุให้ (ทุก 30 นาที) แล้วเปิดใหม่`);
  }
  // TikTok บางร้านใช้แอปของตัวเอง — ผูกโทเคนกับแอปให้ lib/tiktok เซ็นคำขอถูกคีย์ (เหมือน usableToken)
  if (row.platform === 'tiktok') bindTikTokApp(row.access_token, row.extra?.app || '');
  return row;
}

// คืนแถวโทเคนที่ใช้งานได้จริง (ต่ออายุแล้วถ้าจำเป็น)
// หลายคำขอเรียกพร้อมกันได้ (cron sync, ปุ่ม ↻, โคลน) → ต่ออายุผ่านล็อกต่อร้าน (supabase/059)
// ทีละคำขอเท่านั้น ที่เหลือรอแล้วอ่านโทเคนใหม่จาก DB
// ⚠ ล็อกกันได้แค่ฝั่งเว็บ: โน้ตบุ๊ก Colab (sync_stock_all_platforms) ใช้แอป TikTok ตัวเดียวกัน
//   และต่ออายุเองโดยไม่ผ่านล็อกนี้ ถ้าชนกันยังพังได้ แก้ได้ต้องให้ Colab อ่าน/เขียนผ่าน os_shop_tokens ด้วย
export async function usableToken(row) {
  bindApp(row);
  if (!needsRefresh(row)) return row;
  if (!row.refresh_token) throw new Error(`ร้าน ${row.shop}: โทเคนหมดอายุและไม่มี refresh_token — ต้องกดอนุญาตใหม่`);

  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const claim = await db().rpc('os_token_claim_refresh', { p_id: row.id, p_seconds: LOCK_SECONDS });
    if (claim.error) {
      // ยังไม่ได้รัน 059 → ต่ออายุแบบเดิม (ไม่มีล็อก) ดีกว่าใช้งานไม่ได้เลย
      if (/os_token_claim_refresh|refreshing_until/.test(claim.error.message)) {
        console.warn('tokens: ยังไม่มีล็อกต่ออายุ (รัน supabase/059) —', claim.error.message);
        return refreshAndSave(row, false);
      }
      throw new Error(claim.error.message);
    }
    const mine = claim.data?.[0];
    if (mine) {
      // ได้ล็อกแล้ว — ใช้แถวล่าสุดจาก DB เพราะคนก่อนหน้าอาจต่ออายุเสร็จไปแล้วระหว่างที่เรารอ
      bindApp(mine);
      if (!needsRefresh(mine)) {
        await releaseLock(mine.id);
        return mine;
      }
      if (!mine.refresh_token) {
        await releaseLock(mine.id);
        throw new Error(`ร้าน ${mine.shop}: โทเคนหมดอายุและไม่มี refresh_token — ต้องกดอนุญาตใหม่`);
      }
      return refreshAndSave(mine, true);
    }

    // คนอื่นกำลังต่ออายุ — รอสั้นๆ แล้วดูว่าเสร็จหรือยัง
    await sleep(LOCK_POLL_MS);
    const { data: fresh, error } = await db().from('os_shop_tokens').select('*').eq('id', row.id).single();
    if (error) throw new Error(error.message);
    bindApp(fresh);
    if (!needsRefresh(fresh)) return fresh;
    if (Date.now() > deadline) {
      // รอนานเกิน — ถ้าโทเคนเดิมยังไม่หมดจริงก็ใช้ไปก่อน (ต่ออายุตั้งแต่เหลือ 30 นาที)
      if (expiresAt(fresh) > Date.now()) return fresh;
      throw new Error(`ร้าน ${row.shop}: กำลังต่ออายุโทเคนจากคำขออื่นอยู่ ลองใหม่อีกครั้ง`);
    }
    // ล็อกหมดอายุแล้วแต่ยังไม่ได้ต่อ (คนถือล็อกล้ม) → วนไปจองใหม่
  }
}

const LOCK_SECONDS = 30;   // ล็อกค้างนานสุดเท่านี้ถ้าฟังก์ชันตายกลางทาง
const LOCK_WAIT_MS = 8000; // รอคนอื่นต่ออายุนานสุด (ฟังก์ชัน Netlify มีเวลาจำกัด)
const LOCK_POLL_MS = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expiresAt = (row) => (row.expires_at ? new Date(row.expires_at).getTime() : 0);
const needsRefresh = (row) => expiresAt(row) - Date.now() <= REFRESH_BEFORE_MS;

// TikTok บางร้านใช้แอปของตัวเอง (extra.app) — ผูกโทเคนกับแอปไว้ให้ lib/tiktok เซ็นคำขอถูกคีย์
function bindApp(row) {
  if (row.platform === 'tiktok') bindTikTokApp(row.access_token, row.extra?.app || '');
}

async function releaseLock(id) {
  await db().from('os_shop_tokens').update({ refreshing_until: null }).eq('id', id);
}

async function refreshAndSave(row, locked) {
  let patch;
  try {
    patch = await refreshPatch(row);
  } catch (e) {
    if (locked) await releaseLock(row.id).catch(() => null);
    throw e;
  }
  if (!patch) {
    if (locked) await releaseLock(row.id);
    return row;
  }
  // บันทึกโทเคนใหม่พร้อมปลดล็อกในคำสั่งเดียว
  const { error } = await db().from('os_shop_tokens').update(locked ? { ...patch, refreshing_until: null } : patch).eq('id', row.id);
  if (error) throw new Error(error.message);
  return { ...row, ...patch };
}

async function refreshPatch(row) {
  const tiktokApp = row.platform === 'tiktok' ? row.extra?.app || '' : '';
  if (row.platform === 'shopee') {
    // Shopee: access_token อยู่แค่ 4 ชั่วโมง ต่ออายุบ่อยกว่าเจ้าอื่นมาก · refresh_token ใช้ได้ครั้งเดียว
    const t = await refreshShopee({ refreshToken: row.refresh_token, shopId: row.shop_id, partner: row });
    return {
      access_token: t.access_token,
      refresh_token: t.refresh_token || row.refresh_token,
      expires_at: new Date(Date.now() + (t.expire_in || 14400) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
  if (row.platform === 'lazada') {
    // Lazada: access_token ราว 30 วัน · ต่ออายุแล้วได้ refresh_token ใหม่ (180 วัน)
    const t = await refreshLazada(row.refresh_token);
    return {
      access_token: t.access_token,
      refresh_token: t.refresh_token || row.refresh_token,
      expires_at: new Date(Date.now() + (t.expires_in || 2592000) * 1000).toISOString(),
      refresh_expires_at: t.refresh_expires_in ? new Date(Date.now() + t.refresh_expires_in * 1000).toISOString() : row.refresh_expires_at,
      updated_at: new Date().toISOString(),
    };
  }
  if (row.platform === 'tiktok') {
    const t = await refreshTikTok(row.refresh_token, tiktokApp);
    bindTikTokApp(t.access_token, tiktokApp);
    return {
      access_token: t.access_token,
      refresh_token: t.refresh_token || row.refresh_token,
      expires_at: t.access_token_expire_in ? new Date(t.access_token_expire_in * 1000).toISOString() : null,
      refresh_expires_at: t.refresh_token_expire_in ? new Date(t.refresh_token_expire_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    };
  }
  return null;
}

export async function saveToken(platform, shop, patch) {
  const { error } = await db()
    .from('os_shop_tokens')
    .upsert({ platform, shop, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'platform,shop' });
  if (error) throw new Error(error.message);
}
