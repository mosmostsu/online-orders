// อ่านโทเคนของร้านจาก DB และต่ออายุให้เองถ้าใกล้หมด
import { db } from './supabase.js';
import { refreshToken as refreshTikTok } from './tiktok.js';
import { refreshToken as refreshShopee } from './shopee.js';

const REFRESH_BEFORE_MS = 30 * 60 * 1000; // เหลือน้อยกว่าครึ่งชั่วโมง → ต่ออายุเลย

export async function listShops(platform) {
  const { data, error } = await db().from('os_shop_tokens').select('*').eq('platform', platform);
  if (error) throw new Error(error.message);
  return data || [];
}

// คืนแถวโทเคนที่ใช้งานได้จริง (ต่ออายุแล้วถ้าจำเป็น)
export async function usableToken(row) {
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expires - Date.now() > REFRESH_BEFORE_MS) return row;
  if (!row.refresh_token) throw new Error(`ร้าน ${row.shop}: โทเคนหมดอายุและไม่มี refresh_token — ต้องกดอนุญาตใหม่`);

  let patch;
  if (row.platform === 'shopee') {
    // Shopee: access_token อยู่แค่ 4 ชั่วโมง ต่ออายุบ่อยกว่าเจ้าอื่นมาก
    const t = await refreshShopee({ refreshToken: row.refresh_token, shopId: row.shop_id });
    patch = {
      access_token: t.access_token,
      refresh_token: t.refresh_token || row.refresh_token,
      expires_at: new Date(Date.now() + (t.expire_in || 14400) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    };
  } else if (row.platform === 'tiktok') {
    const t = await refreshTikTok(row.refresh_token);
    patch = {
      access_token: t.access_token,
      refresh_token: t.refresh_token || row.refresh_token,
      expires_at: t.access_token_expire_in ? new Date(t.access_token_expire_in * 1000).toISOString() : null,
      refresh_expires_at: t.refresh_token_expire_in ? new Date(t.refresh_token_expire_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    };
  } else {
    return row;
  }
  const { error } = await db().from('os_shop_tokens').update(patch).eq('id', row.id);
  if (error) throw new Error(error.message);
  return { ...row, ...patch };
}

export async function saveToken(platform, shop, patch) {
  const { error } = await db()
    .from('os_shop_tokens')
    .upsert({ platform, shop, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'platform,shop' });
  if (error) throw new Error(error.message);
}
