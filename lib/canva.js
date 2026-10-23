// ตัดพื้นหลังด้วย Canva (Connect API) — ปุ่ม "ตัดด้วย Canva" ในหน้าสร้างปก (app/product/CoverMaker.js)
// ใช้บัญชี Canva Pro ของร้าน (เครดิต AI ของบัญชีนั้น) ผ่าน Integration ที่สร้างใน canva.com/developers
//   env: CANVA_CLIENT_ID · CANVA_CLIENT_SECRET (ตั้งแบบธรรมดา ไม่ใช่ secret — ดู memory netlify-secret-env-invisible)
//   เชื่อมบัญชีครั้งเดียว: /api/auth/canva (ต้องปลดล็อกรหัสยอดขายก่อน) → โทเคนเก็บใน os_shop_tokens (platform canva, shop CANVA)
//   access token อยู่ 4 ชม. · refresh token ใช้ได้ครั้งเดียว ต่ออายุแล้วต้องเก็บตัวใหม่ทันที
// ขั้นตอนตัด (แบ่งเป็นหลายคำขอสั้นๆ เพราะฟังก์ชัน Netlify มีเวลาจำกัด — หน้าเว็บเป็นคนวนถาม):
//   start: อัปรูป (asset-uploads) → รอเสร็จ → สั่งตัดพื้น (image-transformations — API รุ่น preview) → { job }
//   status: ถามงานตัดพื้น → เสร็จ = สร้างงานออกแบบจากรูปที่ตัดแล้ว (ขนาดเท่ารูป) → สั่ง export PNG พื้นใส → { export }
//   export: ถาม export → เสร็จ = { url } ลิงก์ไฟล์ PNG (หน้าเว็บโหลดผ่าน /api/xclone/img)
//   ของที่สร้างใน Canva (รูป/งานออกแบบ) ย้ายเข้าโฟลเดอร์ "order-sync ตัดพื้น" ไม่ให้รก Projects
import { db } from './supabase.js';
import { saveToken } from './tokens.js';

const API = 'https://api.canva.com/rest/v1';
export const CANVA_SCOPES = 'asset:read asset:write design:content:read design:content:write design:meta:read folder:read folder:write';
const PLATFORM = 'canva';
const SHOP = 'CANVA';
const FOLDER = 'order-sync ตัดพื้น';

export class CanvaError extends Error {}

const basic = () => {
  const id = process.env.CANVA_CLIENT_ID; const secret = process.env.CANVA_CLIENT_SECRET;
  if (!id || !secret) throw new CanvaError('ยังไม่ได้ตั้ง CANVA_CLIENT_ID / CANVA_CLIENT_SECRET ใน Netlify');
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
};

export function authorizeUrl({ redirectUri, state, challenge }) {
  const q = new URLSearchParams({
    code_challenge: challenge, code_challenge_method: 's256', scope: CANVA_SCOPES,
    response_type: 'code', client_id: process.env.CANVA_CLIENT_ID || '', state, redirect_uri: redirectUri,
  });
  return `https://www.canva.com/api/oauth/authorize?${q}`;
}

async function tokenCall(form) {
  const r = await fetch(`${API}/oauth/token`, {
    method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new CanvaError(`Canva ไม่ให้โทเคน: ${j.error_description || j.error || j.message || r.status}`);
  return j;
}

async function store(t, extra) {
  await saveToken(PLATFORM, SHOP, {
    access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (Number(t.expires_in) || 14400) * 1000).toISOString(),
    ...(extra ? { extra } : {}),
  });
}

export async function exchangeCode({ code, verifier, redirectUri }) {
  const t = await tokenCall({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
  await store(t, {});
}

async function row() {
  const { data, error } = await db().from('os_shop_tokens').select('*').eq('platform', PLATFORM).eq('shop', SHOP).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function canvaConnected() {
  try { return Boolean((await row())?.refresh_token); } catch { return false; }
}

// โทเคนที่ใช้ได้ (ต่ออายุเองถ้าเหลือ < 5 นาที) — refresh token หมุนทุกครั้ง เก็บตัวใหม่ก่อนใช้
async function token() {
  const r = await row();
  if (!r?.refresh_token) throw new CanvaError('ยังไม่ได้เชื่อม Canva — กด "เชื่อม Canva" ก่อน');
  if (r.access_token && new Date(r.expires_at).getTime() - Date.now() > 5 * 60 * 1000) return r;
  const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: r.refresh_token });
  await store(t, r.extra || {});
  return { ...r, access_token: t.access_token, refresh_token: t.refresh_token };
}

async function call(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const t = await token();
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${t.access_token}`, ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.code === 'credit_quota_exceeded' || j.code === 'quota_exceeded' ? 'เครดิต AI ของ Canva หมด' : (j.message || j.code || r.status);
    throw new CanvaError(`Canva ${path.split('?')[0]}: ${msg}`);
  }
  return j;
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const jobErr = (job) => job?.error?.message || job?.error?.code || 'ไม่ทราบสาเหตุ';

// โฟลเดอร์เก็บของที่สร้าง — หา/สร้างครั้งเดียว จำ id ไว้ใน extra ของแถวโทเคน · พังก็ข้าม (ไม่ย้ายเฉยๆ)
async function folderId() {
  try {
    const r = await row();
    if (r?.extra?.folder) return r.extra.folder;
    const j = await call('/folders', { method: 'POST', body: { name: FOLDER, parent_folder_id: 'root' } });
    const id = j.folder?.id;
    if (id) await saveToken(PLATFORM, SHOP, { extra: { ...(r?.extra || {}), folder: id } });
    return id || null;
  } catch { return null; }
}
async function tidy(itemId) {
  const f = await folderId();
  if (f && itemId) await call('/folders/move', { method: 'POST', body: { item_id: itemId, to_folder_id: f } }).catch(() => {});
}

// 1) อัปรูป + สั่งตัดพื้น → { job } (หรือ { asset } ถ้าเสร็จทันที)
export async function cutStart(bytes, name = 'order-sync') {
  const meta = { name_base64: Buffer.from(name.slice(0, 50)).toString('base64') };
  let up = (await call('/asset-uploads', { method: 'POST', body: bytes, raw: true, headers: { 'Content-Type': 'application/octet-stream', 'Asset-Upload-Metadata': JSON.stringify(meta) } })).job;
  for (let i = 0; up?.status === 'in_progress' && i < 20; i += 1) {
    await sleep(500);
    up = (await call(`/asset-uploads/${up.id}`)).job;
  }
  if (up?.status !== 'success') throw new CanvaError(`อัปรูปเข้า Canva ไม่สำเร็จ: ${jobErr(up)}`);
  const src = up.asset.id;
  tidy(src);
  const tj = (await call('/image-transformations', { method: 'POST', body: { asset_id: src, transformations: [{ type: 'background_removal' }] } })).job;
  if (tj.status === 'failed') throw new CanvaError(tj.error?.code === 'no_foreground_found' ? 'Canva หาตัวสินค้าในรูปไม่เจอ' : `Canva ตัดพื้นไม่สำเร็จ: ${jobErr(tj)}`);
  if (tj.status === 'success') return { asset: tj.result.asset.id, w: tj.result.asset.metadata?.width, h: tj.result.asset.metadata?.height };
  return { job: tj.id };
}

// 2) ถามงานตัดพื้น → เสร็จแล้วสร้างงานออกแบบจากรูปนั้น + สั่ง export PNG พื้นใส → { export } · ยังไม่เสร็จ → { pending: true }
export async function cutStatus({ job, asset, w, h }) {
  let a = asset; let aw = w; let ah = h;
  if (!a) {
    const tj = (await call(`/image-transformations/${job}`)).job;
    if (tj.status === 'in_progress') return { pending: true };
    if (tj.status !== 'success') throw new CanvaError(tj.error?.code === 'no_foreground_found' ? 'Canva หาตัวสินค้าในรูปไม่เจอ' : `Canva ตัดพื้นไม่สำเร็จ: ${jobErr(tj)}`);
    a = tj.result.asset.id; aw = tj.result.asset.metadata?.width; ah = tj.result.asset.metadata?.height;
  }
  tidy(a);
  const d = (await call('/designs', { method: 'POST', body: { type: 'type_and_asset', asset_id: a, title: 'order-sync ตัดพื้น' } })).design;
  tidy(d.id);
  const ex = (await call('/exports', {
    method: 'POST',
    // PNG เต็ม (lossless) ไม่บีบ — ด้านกว้างไม่เกิน 1600 ให้ไฟล์ผ่าน proxy รูป (ฟังก์ชันส่งได้ ~6MB) ปกกว้างแค่ 1000 อยู่แล้ว
    body: { design_id: d.id, format: { type: 'png', transparent_background: true, lossless: true, ...(aw ? { width: Math.min(aw, 1600) } : {}) } },
  })).job;
  if (ex.status === 'failed') throw new CanvaError(`Canva export ไม่สำเร็จ: ${jobErr(ex)}`);
  if (ex.status === 'success') return { url: ex.urls[0] };
  return { export: ex.id, h: ah };
}

// 3) ถาม export → { url } ไฟล์ PNG · ยังไม่เสร็จ → { pending: true }
export async function cutExport(id) {
  const ex = (await call(`/exports/${id}`)).job;
  if (ex.status === 'in_progress') return { pending: true };
  if (ex.status !== 'success') throw new CanvaError(`Canva export ไม่สำเร็จ: ${jobErr(ex)}`);
  return { url: ex.urls[0] };
}
