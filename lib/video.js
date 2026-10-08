// อ่านคลิปวิดีโอจาก Google Sheet (อ่านอย่างเดียว) → รายการที่ normalize แล้ว
//
// เข้าชีทด้วย service account (ไม่เพิ่ม dependency — เซ็น JWT เองด้วย crypto)
// env ที่ต้องตั้งใน Netlify (ตั้งแบบธรรมดา ห้าม secret และต้อง deploy ใหม่หลังตั้ง):
//   GOOGLE_SA_EMAIL        อีเมล service account — แชร์ชีทให้อีเมลนี้เป็น Viewer
//   GOOGLE_SA_PRIVATE_KEY  private_key จาก JSON (ใส่ทั้งก้อนได้ ทั้งแบบมีบรรทัดจริงหรือ \n)
//   VIDEO_SHEET_ID         ไม่บังคับ — ค่าเริ่มต้นเป็นชีทปัจจุบัน
import crypto from 'crypto';
import { unstable_cache } from 'next/cache';
import { brandOf, categoryOf } from './video-config';
import { dbVideos } from './tiktok-display';

const DEFAULT_SHEET_ID = '13OMcLbBgqEoiAMvF0H8mLDPdc-9_uXN0Y4aKMwSQ7DU';
// แท็บ → ช่อง TikTok
export const TABS = [
  { tab: 'video', account: 'solid_sports_' },
  { tab: 'video2', account: 'meta_sports_' },
];
const CACHE_SECONDS = 300;

const b64u = (b) => Buffer.from(b).toString('base64url');

async function accessToken() {
  const email = process.env.GOOGLE_SA_EMAIL;
  let key = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (!email || !key) throw new Error('ยังไม่ได้ตั้ง GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY ที่ Netlify');
  key = key.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`ขอ token Google ไม่ได้: ${j.error_description || j.error || res.status}`);
  return j.access_token;
}

async function readTab(token, sheetId, tab) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`อ่านแท็บ ${tab} ไม่ได้: ${j.error?.message || res.status}`);
  return j.values || [];
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// map คอลัมน์ด้วยชื่อหัวตาราง ไม่ใช่ตำแหน่ง (สองแท็บเลย์เอาต์ต่างกัน)
function mapHeader(row) {
  const idx = {};
  row.forEach((cell, i) => {
    const h = norm(cell);
    if (!h) return;
    if (idx.link === undefined && /video link|^link$/.test(h)) idx.link = i;
    else if (idx.uploaded === undefined && h.startsWith('uploaded')) idx.uploaded = i;
    else if (idx.caption === undefined && h === 'caption') idx.caption = i;
    else if (idx.shopee === undefined && h.startsWith('shopee')) idx.shopee = i;
    else if (idx.ig === undefined && h === 'ig') idx.ig = i;
    else if (idx.fb === undefined && h === 'fb') idx.fb = i;
  });
  return idx;
}

const pad = (n) => String(n).padStart(2, '0');

// วันที่ลง → 'YYYY-MM-DD' (รับ ISO, d/m/y, ตัวเลข serial ของชีท) · ไม่รู้ = null
export function parseDate(v) {
  const s = String(v ?? '').trim();
  if (!s || /^n\/?a$/i.test(s)) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return null;
}

// สถานะท้ายแถวปนกัน → ชุดเดียว ('' = ว่าง) · ค่าที่ไม่รู้จักเก็บตามที่เขียนไว้ ไม่ทิ้ง
export function normStatus(v) {
  const s = norm(v);
  if (!s) return '';
  if (s === 'done' || s === 'ลงแล้ว') return 'ลงแล้ว';
  if (s === 'pos' || s === 'โพสต์' || s === 'โพสท์' || s === 'post') return 'โพสต์';
  if (s === 'โปสเตอร์' || s === 'poster') return 'โปสเตอร์';
  if (s === 'โหลดไม่ได้') return 'โหลดไม่ได้';
  return String(v).trim();
}

const idOf = (link) => String(link || '').match(/\/(?:video|photo)\/(\d+)/)?.[1] || null;

function parseTab(rows, account) {
  const out = [];
  let updated = null, skipped = 0;
  const h = rows.findIndex((r) => r.some((c) => /video link/i.test(String(c))));
  if (h < 0) throw new Error(`แท็บของ @${account} ไม่พบหัวตาราง "Tiktok Video link"`);
  const idx = mapHeader(rows[h]);
  if (idx.link === undefined || idx.uploaded === undefined) throw new Error(`แท็บของ @${account} หัวตารางไม่ครบ (ต้องมี link, uploaded)`);
  const cell = (r, k) => (idx[k] === undefined ? '' : r[idx[k]] ?? '');

  for (const r of rows.slice(h + 1)) {
    const lu = r.find((c) => /^last updated/i.test(String(c).trim()));
    if (lu) { updated = String(lu).replace(/^last updated:?\s*/i, '').trim() || null; continue; }
    const link = String(cell(r, 'link')).trim();
    const videoId = idOf(link);
    if (!videoId) continue; // แถวว่าง / มีแต่เลขลำดับ
    const uploadedDate = parseDate(cell(r, 'uploaded'));
    if (!uploadedDate) { skipped++; continue; } // N/A (skip: D empty)
    const caption = String(cell(r, 'caption')).trim();
    out.push({
      videoId, account, uploadedDate, caption, link,
      brand: brandOf(caption), category: categoryOf(caption),
      statusIG: normStatus(cell(r, 'ig')), statusFB: normStatus(cell(r, 'fb')),
      statusShopee: normStatus(cell(r, 'shopee')),
      metrics: null, // Phase 2: views/likes/comments/shares จาก TikTok Display API
    });
  }
  return { out, updated, skipped };
}

async function loadSheet() {
  const sheetId = process.env.VIDEO_SHEET_ID || DEFAULT_SHEET_ID;
  const token = await accessToken();
  const all = await Promise.all(TABS.map(async (t) => parseTab(await readTab(token, sheetId, t.tab), t.account)));
  return {
    videos: all.flatMap((p) => p.out),
    updated: all.map((p, i) => ({ account: TABS[i].account, at: p.updated })),
    skipped: all.reduce((n, p) => n + p.skipped, 0),
  };
}

// คลิปจาก TikTok Display API (os_videos) — รูปแบบเดียวกับแถวจากชีท
async function loadDb() {
  const rows = await dbVideos();
  return rows.map((r) => ({
    videoId: r.video_id, account: r.account, uploadedDate: r.uploaded_date,
    caption: r.caption || '', link: r.link || '',
    brand: brandOf(r.caption), category: categoryOf(r.caption),
    statusIG: '', statusFB: '', statusShopee: '',
    metrics: r.metrics || null,
  }));
}

// รวม 2 แหล่ง: TikTok (ข้อมูลล่าสุด + ยอดวิว) เป็นหลัก ชีทเติมคลิปเก่าที่ API ไม่คืน และสถานะ IG/FB
// ชีทหรือ TikTok อย่างใดอย่างหนึ่งพัง/ยังไม่ได้ตั้งค่า ก็ยังโชว์อีกแหล่งได้ — บอกไว้ใน warnings
async function load() {
  const [db, sheet] = await Promise.allSettled([loadDb(), loadSheet()]);
  if (db.status === 'rejected' && sheet.status === 'rejected') throw new Error(`TikTok: ${db.reason?.message}\nชีท: ${sheet.reason?.message}`);
  const warnings = [];
  if (db.status === 'rejected') warnings.push(`อ่านคลิปจาก TikTok ไม่ได้: ${db.reason?.message}`);
  if (sheet.status === 'rejected') warnings.push(`อ่านชีทไม่ได้: ${sheet.reason?.message}`);

  const byKey = new Map();
  for (const v of db.value || []) byKey.set(`${v.account}:${v.videoId}`, v);
  for (const v of sheet.value?.videos || []) {
    const k = `${v.account}:${v.videoId}`;
    const mine = byKey.get(k);
    if (!mine) byKey.set(k, v);
    else Object.assign(mine, { statusIG: v.statusIG, statusFB: v.statusFB, statusShopee: v.statusShopee });
  }
  const videos = [...byKey.values()].sort((a, b) => (a.uploadedDate < b.uploadedDate ? 1 : a.uploadedDate > b.uploadedDate ? -1 : 0));
  return {
    videos,
    updated: sheet.value?.updated || [],
    skipped: sheet.value?.skipped || 0,
    warnings,
    hasMetrics: videos.some((v) => v.metrics),
    fetchedAt: new Date().toISOString(),
  };
}

// จำ 5 นาที กันชนโควตา Sheets API (sync คลิปเสร็จจะล้างด้วย tag 'video')
export const getVideos = unstable_cache(load, ['video-merged-v2'], { revalidate: CACHE_SECONDS, tags: ['video'] });
