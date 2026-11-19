// อัปฟุตจากหน้า /shoot เข้า Google Drive ของร้านโดยตรง (ไฟล์ไม่ผ่าน Netlify — ฟังก์ชันรับไฟล์ใหญ่ไม่ได้)
// ใช้ OAuth ของบัญชี Google เจ้าของ Drive ไม่ใช่ service account: service account ไม่มีโควตาพื้นที่ใน My Drive จึงสร้างไฟล์ไม่ได้
//   env: GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET — ค่าเดียวกับเว็บ samchaiinvoice (OAuth client ตัวเดียวกัน มีขอบเขต drive.file อยู่แล้ว)
//   เชื่อมครั้งเดียว: /api/auth/google (ต้องปลดล็อกรหัสยอดขายก่อน) → refresh token เก็บใน os_shop_tokens (platform google, shop DRIVE)
// ขอบเขต drive.file = แอปเห็น/แก้ได้เฉพาะไฟล์ที่แอปสร้างเอง ไฟล์อื่นใน Drive แตะไม่ได้ แม้โทเคนหลุด
//   ผลคือแอปต้องสร้างโฟลเดอร์ปลายทางเอง ("ฟุตเทจจาก Studio") — ลากโฟลเดอร์นั้นไปไว้ใต้ #TTvid ได้ สิทธิ์ไม่หาย
// ขั้นตอนอัป: เซิร์ฟเวอร์เปิด resumable session (แนบ Origin ของเว็บ → Drive ยอมให้เบราว์เซอร์ PUT ข้ามโดเมน)
//   แล้วส่ง URL ของ session ให้มือถือ PUT ไฟล์เป็นชิ้นๆ ตรงเข้า Drive (lib/shoot.js: chunkRanges)
import { db } from './supabase.js';
import { saveToken } from './tokens.js';
import { safeName } from './shoot.js';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const PLATFORM = 'google';
const SHOP = 'DRIVE';
const ROOT_NAME = 'ฟุตเทจจาก Studio';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';

export class DriveError extends Error {}

const creds = () => {
  const { id, secret } = envCreds();
  if (!id || !secret) throw new DriveError('ยังไม่ได้ตั้ง GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ใน Netlify');
  return { id, secret };
};
// ใช้ OAuth client ตัวเดียวกับ samchaiinvoice ได้ (ชื่อ env เดียวกัน GOOGLE_CLIENT_ID/SECRET) — เพิ่ม redirect URI ของเว็บนี้ใน client นั้น
// GOOGLE_OAUTH_* = ชื่อสำรอง เผื่ออยากแยก client
function envCreds() {
  return {
    id: process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    secret: process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
  };
}
export const driveConfigured = () => { const c = envCreds(); return Boolean(c.id && c.secret); };

export function authorizeUrl({ redirectUri, state }) {
  // access_type=offline + prompt=consent → ได้ refresh token ทุกครั้งที่กดเชื่อม (ไม่งั้นครั้งที่สองจะไม่ได้)
  const q = new URLSearchParams({
    client_id: creds().id, redirect_uri: redirectUri, response_type: 'code', scope: GOOGLE_SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenCall(form) {
  const { id, secret } = creds();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...form }), cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new DriveError(`Google: ${j.error_description || j.error || r.status}`);
  return j;
}

async function row() {
  const { data, error } = await db().from('os_shop_tokens').select('*').eq('platform', PLATFORM).eq('shop', SHOP).maybeSingle();
  if (error) throw new DriveError(error.message);
  return data;
}

// สถานะการเชื่อม — ใช้โชว์ในหน้า · ไม่โยน error
export async function driveStatus() {
  if (!driveConfigured()) return { ok: false, why: 'env' };
  try {
    const r = await row();
    if (!r?.refresh_token) return { ok: false, why: 'connect' };
    return { ok: true, folderId: r.extra?.folder_id || null };
  } catch (e) { return { ok: false, why: 'error', error: String(e.message || e) }; }
}

async function api(token, path, init = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init, cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}), ...(init.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new DriveError(`Drive: ${j.error?.message || r.status}`);
  return j;
}

const mkFolder = (token, name, parent) => api(token, '/files?fields=id', {
  method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }),
});

// แลก code → เก็บ refresh token + สร้างโฟลเดอร์ปลายทาง (ถ้าเคยเชื่อมแล้วและโฟลเดอร์เดิมยังอยู่ ใช้ของเดิม)
export async function exchangeCode({ code, redirectUri }) {
  const j = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  if (!j.refresh_token) throw new DriveError('Google ไม่ได้ส่ง refresh token มา — ลบสิทธิ์แอปที่ myaccount.google.com/permissions แล้วกดเชื่อมใหม่');
  const old = await row().catch(() => null);
  let folderId = old?.extra?.folder_id || null;
  if (folderId) {
    try { const f = await api(j.access_token, `/files/${folderId}?fields=id,trashed`); if (f.trashed) folderId = null; } catch { folderId = null; }
  }
  if (!folderId) folderId = (await mkFolder(j.access_token, ROOT_NAME)).id;
  await saveToken(PLATFORM, SHOP, {
    access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(), extra: { ...(old?.extra || {}), folder_id: folderId },
  });
  return { folderId };
}

// access token ที่ใช้ได้ (อยู่ 1 ชม. — ต่ออายุเมื่อเหลือ < 5 นาที · refresh token ของ Google ใช้ซ้ำได้ ไม่ต้องล็อกเหมือน Canva)
async function session() {
  const r = await row();
  if (!r?.refresh_token) throw new DriveError('ยังไม่ได้เชื่อม Google Drive — เจ้าของร้านเปิด /api/auth/google หนึ่งครั้ง');
  if (!r.extra?.folder_id) throw new DriveError('ไม่พบโฟลเดอร์ปลายทาง — กดเชื่อม Google Drive ใหม่ที่ /api/auth/google');
  const left = r.expires_at ? new Date(r.expires_at).getTime() - Date.now() : 0;
  if (r.access_token && left > 5 * 60 * 1000) return { token: r.access_token, folderId: r.extra.folder_id };
  const j = await tokenCall({ grant_type: 'refresh_token', refresh_token: r.refresh_token });
  await saveToken(PLATFORM, SHOP, { access_token: j.access_token, expires_at: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString() });
  return { token: j.access_token, folderId: r.extra.folder_id };
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// โฟลเดอร์ย่อยต่อสินค้า (หาก่อน ไม่มีค่อยสร้าง)
async function productFolder(token, root, product) {
  const name = safeName(product, 80) || 'ไม่ระบุสินค้า';
  const q = `name = '${esc(name)}' and '${root}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const found = await api(token, `/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
  return found.files?.[0]?.id || (await mkFolder(token, name, root)).id;
}

// เปิด resumable session → URL ให้เบราว์เซอร์ PUT ไฟล์ตรงเข้า Drive (URL นี้ใช้ได้ราว 1 สัปดาห์ และใช้ได้กับไฟล์นี้ไฟล์เดียว)
export async function startUpload({ product, name, mime, size, origin }) {
  const { token, folderId } = await session();
  const parent = await productFolder(token, folderId, product);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size', {
    method: 'POST', cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size), ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ name, parents: [parent] }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new DriveError(`Drive: ${j.error?.message || r.status}`); }
  const uploadUrl = r.headers.get('location');
  if (!uploadUrl) throw new DriveError('Drive ไม่ได้ส่งที่อยู่อัปโหลดกลับมา');
  return { uploadUrl };
}

// ยืนยันว่าไฟล์ขึ้น Drive จริงก่อนติ๊กช็อต — กันติ๊กทั้งที่อัปไม่สำเร็จ
export async function fileInfo(fileId) {
  if (!/^[\w-]{10,100}$/.test(String(fileId || ''))) throw new DriveError('รหัสไฟล์ไม่ถูกต้อง');
  const { token } = await session();
  const f = await api(token, `/files/${fileId}?fields=id,name,size,trashed`);
  if (f.trashed) throw new DriveError('ไฟล์ถูกลบไปแล้ว');
  return f;
}

export const driveFolderUrl = (id) => (id ? `https://drive.google.com/drive/folders/${id}` : '');
