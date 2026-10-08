// TikTok Display API (Login Kit + video.list) — ดึงคลิปของช่อง TikTok ของร้านเราเอง
// คนละแอปกับ TikTok Shop (lib/tiktok.js) ไม่ใช้ key ร่วมกัน
//
// env (ตั้งใน Netlify แบบธรรมดา ห้ามเป็น secret แล้ว Trigger deploy ใหม่):
//   TIKTOK_DISPLAY_CLIENT_KEY / TIKTOK_DISPLAY_CLIENT_SECRET   จากหน้าแอปที่ developers.tiktok.com
//   TIKTOK_DISPLAY_REDIRECT_URI   ไม่บังคับ — ต้องตรงกับที่ลงทะเบียนในแอปเป๊ะ
//   TIKTOK_DISPLAY_SCOPE          ไม่บังคับ — ค่าเริ่มต้น video.list (ต้องตรงกับ scope ที่แอปได้รับ)
import { db } from './supabase.js';
import { listShops, saveToken } from './tokens.js';

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const API = 'https://open.tiktokapis.com/v2';
const REFRESH_BEFORE_MS = 30 * 60 * 1000;
const PLATFORM = 'tiktok_display';
const MAX_PAGES = 100; // 20 คลิป/หน้า → 2,000 คลิป กันวนไม่รู้จบ
const FIELDS = 'id,create_time,title,video_description,share_url,duration,view_count,like_count,comment_count,share_count';

// ชื่อย่อในระบบ → บัญชี TikTok
export const ACCOUNTS = { solid: 'solid_sports_', meta: 'meta_sports_' };

export const redirectUri = () =>
  process.env.TIKTOK_DISPLAY_REDIRECT_URI || 'https://order-sync-solid.netlify.app/api/auth/tiktok-display';

function keys() {
  const key = process.env.TIKTOK_DISPLAY_CLIENT_KEY, secret = process.env.TIKTOK_DISPLAY_CLIENT_SECRET;
  if (!key || !secret) throw new Error('ยังไม่ได้ตั้ง TIKTOK_DISPLAY_CLIENT_KEY / TIKTOK_DISPLAY_CLIENT_SECRET ที่ Netlify');
  return { key, secret };
}

export function authorizeUrl(state) {
  const { key } = keys();
  const p = new URLSearchParams({
    client_key: key, response_type: 'code', redirect_uri: redirectUri(), state,
    scope: process.env.TIKTOK_DISPLAY_SCOPE || 'video.list',
  });
  return `${AUTH_URL}?${p}`;
}

async function tokenCall(params) {
  const { key, secret } = keys();
  const res = await fetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: key, client_secret: secret, ...params }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error || !j.access_token) {
    throw new Error(`TikTok token: ${j.error_description || j.error || res.status}`);
  }
  return j;
}

export const exchangeCode = (code) =>
  tokenCall({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });

const refresh = (refreshToken) => tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken });

const patchOf = (t) => ({
  access_token: t.access_token,
  refresh_token: t.refresh_token,
  expires_at: new Date(Date.now() + (t.expires_in || 86400) * 1000).toISOString(),
  refresh_expires_at: new Date(Date.now() + (t.refresh_expires_in || 31536000) * 1000).toISOString(),
});

// เก็บโทเคนหลังเจ้าของกดอนุญาต
export async function saveAccountToken(account, t) {
  await saveToken(PLATFORM, account, { shop_id: t.open_id || null, ...patchOf(t), extra: { scope: t.scope || null } });
}

// โทเคนที่ใช้ได้จริง (ต่ออายุให้ถ้าใกล้หมด — access token อยู่ 24 ชม.)
async function usable(row) {
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expires - Date.now() > REFRESH_BEFORE_MS) return row;
  if (!row.refresh_token) throw new Error(`${row.shop}: โทเคนหมดอายุและไม่มี refresh_token — ต้องกดอนุญาตใหม่`);
  const patch = patchOf(await refresh(row.refresh_token));
  await saveToken(PLATFORM, row.shop, patch);
  return { ...row, ...patch };
}

async function listAll(accessToken) {
  const videos = [];
  let cursor;
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await fetch(`${API}/video/list/?fields=${FIELDS}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cursor ? { max_count: 20, cursor } : { max_count: 20 }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || (j.error?.code && j.error.code !== 'ok')) {
      throw new Error(`TikTok video.list: ${j.error?.message || j.error?.code || res.status}`);
    }
    videos.push(...(j.data?.videos || []));
    if (!j.data?.has_more || !j.data?.cursor) break;
    cursor = j.data.cursor;
  }
  return videos;
}

const thaiDate = (sec) => new Date(sec * 1000 + 7 * 3600000).toISOString().slice(0, 10);

// ดึงคลิปของทุกบัญชีที่เชื่อมไว้ แล้วบันทึกลง os_videos — คืนสรุปรายบัญชี (บัญชีที่พังไม่ล้มบัญชีอื่น)
export async function syncVideos() {
  const rows = await listShops(PLATFORM);
  const out = [];
  for (const row of rows) {
    const account = ACCOUNTS[row.shop];
    if (!account) continue;
    try {
      const t = await usable(row);
      const videos = await listAll(t.access_token);
      const now = new Date().toISOString();
      const recs = videos.filter((v) => v.id && v.create_time).map((v) => ({
        account, video_id: String(v.id),
        uploaded_date: thaiDate(v.create_time),
        created_at: new Date(v.create_time * 1000).toISOString(),
        caption: String(v.video_description || v.title || '').trim(),
        link: v.share_url || null,
        duration: v.duration ?? null,
        metrics: { views: v.view_count ?? null, likes: v.like_count ?? null, comments: v.comment_count ?? null, shares: v.share_count ?? null },
        fetched_at: now,
      }));
      for (let i = 0; i < recs.length; i += 500) {
        const { error } = await db().from('os_videos').upsert(recs.slice(i, i + 500), { onConflict: 'account,video_id' });
        if (error) throw new Error(error.message);
      }
      out.push({ account, ok: true, videos: recs.length });
    } catch (e) {
      out.push({ account, ok: false, error: String(e.message || e) });
    }
  }
  if (!rows.length) out.push({ ok: false, error: 'ยังไม่มีบัญชีที่เชื่อม — เปิดลิงก์เชื่อมบัญชีก่อน' });
  return out;
}

export async function dbVideos() {
  const { data, error } = await db().from('os_videos').select('*').order('uploaded_date', { ascending: false }).limit(5000);
  if (error) throw new Error(error.message);
  return data || [];
}
