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

const PAGE_FETCH_MS = 6000;               // TikTok ตอบช้ากว่านี้ถือว่าค้าง
const FULL_REFRESH_MS = 24 * 3600 * 1000; // ไล่ทั้งหมดใหม่วันละครั้ง เพื่ออัปเดตยอดวิวของคลิปเก่า

async function fetchPage(accessToken, cursor) {
  const res = await fetch(`${API}/video/list/?fields=${FIELDS}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cursor ? { max_count: 20, cursor } : { max_count: 20 }),
    signal: AbortSignal.timeout(PAGE_FETCH_MS),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.error?.code && j.error.code !== 'ok')) {
    throw new Error(`TikTok video.list: ${j.error?.message || j.error?.code || res.status}`);
  }
  return { videos: j.data?.videos || [], cursor: j.data?.cursor, hasMore: Boolean(j.data?.has_more && j.data?.cursor) };
}

const thaiDate = (sec) => new Date(sec * 1000 + 7 * 3600000).toISOString().slice(0, 10);

async function savePage(account, videos) {
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
  if (!recs.length) return 0;
  const { error } = await db().from('os_videos').upsert(recs, { onConflict: 'account,video_id' });
  if (error) throw new Error(error.message);
  return recs.length;
}

// ดึงคลิปของทุกบัญชีที่เชื่อมไว้ลง os_videos — ทำเป็นช่วงๆ ไม่ให้เกินเวลาของฟังก์ชัน (Netlify ตัดที่ ~10-26 วินาที)
// ทุกครั้งดึงหน้าแรก (คลิปใหม่สุด) ก่อนเสมอ แล้วไล่คลิปเก่าต่อจากจุดที่ค้างไว้ (sync_cursor เก็บใน extra ของโทเคน)
// เรียกซ้ำจนผลบอก done:true — บันทึกทีละหน้า ถ้าถูกตัดกลางทางคลิปที่ได้มาแล้วไม่หาย
export async function syncVideos({ budgetMs = 7000 } = {}) {
  const rows = (await listShops(PLATFORM)).filter((r) => ACCOUNTS[r.shop]);
  const t0 = Date.now();
  const results = [];
  for (const [i, row] of rows.entries()) {
    const account = ACCOUNTS[row.shop];
    const until = t0 + (budgetMs * (i + 1)) / rows.length;
    try {
      const t = await usable(row);
      const extra = row.extra || {};
      let cursor = extra.sync_cursor || undefined;
      let fullAt = extra.full_at || null;
      let saved = 0;

      // หน้าแรกเสมอ (คลิปใหม่ + ยอดวิวล่าสุดของคลิปใหม่)
      const first = await fetchPage(t.access_token, undefined);
      saved += await savePage(account, first.videos);
      const stale = !fullAt || Date.now() - Date.parse(fullAt) > FULL_REFRESH_MS;
      if (!first.hasMore) {
        cursor = undefined;
        fullAt = new Date().toISOString();
      } else if (!cursor && stale) {
        cursor = first.cursor; // เริ่มรอบไล่ทั้งหมดใหม่
      }

      while (cursor && Date.now() < until) {
        const page = await fetchPage(t.access_token, cursor);
        saved += await savePage(account, page.videos);
        if (page.hasMore) cursor = page.cursor;
        else { cursor = undefined; fullAt = new Date().toISOString(); }
      }

      await saveToken(PLATFORM, row.shop, { extra: { ...extra, sync_cursor: cursor || null, full_at: fullAt } });
      results.push({ account, ok: true, saved, done: !cursor });
    } catch (e) {
      results.push({ account, ok: false, done: true, error: String(e.message || e) });
    }
  }
  if (!rows.length) results.push({ ok: false, done: true, error: 'ยังไม่มีบัญชีที่เชื่อม — เปิดลิงก์เชื่อมบัญชีก่อน' });
  return { results, done: results.every((r) => r.done) };
}

export async function dbVideos() {
  const { data, error } = await db().from('os_videos').select('*').order('uploaded_date', { ascending: false }).limit(5000);
  if (error) throw new Error(error.message);
  return data || [];
}
