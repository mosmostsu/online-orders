// อ่านโทเคนของร้านจาก DB และต่ออายุให้เองถ้าใกล้หมด
import { db } from './supabase.js';
import { refreshToken } from './tiktok.js';

const REFRESH_BEFORE_MS = 30 * 60 * 1000; // เหลือน้อยกว่าครึ่งชั่วโมง → ต่ออายุเลย

export async function listShops(platform) {
  const { data, error } = await db().from('os_shop_tokens').select('*').eq('platform', platform);
  if (error) throw new Error(error.message);
  return data || [];
}

// คืนแถวโทเคนที่ใช้งานได้จริง (ต่ออายุแล้วถ้าจำเป็น)
export async function usableToken(row) {
  if (row.platform !== 'tiktok') return row;
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expires - Date.now() > REFRESH_BEFORE_MS) return row;
  if (!row.refresh_token) throw new Error(`ร้าน ${row.shop}: โทเคนหมดอายุและไม่มี refresh_token — ต้องกดอนุญาตใหม่`);

  const t = await refreshToken(row.refresh_token);
  const patch = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || row.refresh_token,
    expires_at: t.access_token_expire_in ? new Date(t.access_token_expire_in * 1000).toISOString() : null,
    refresh_expires_at: t.refresh_token_expire_in ? new Date(t.refresh_token_expire_in * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
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
