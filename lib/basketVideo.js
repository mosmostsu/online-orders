// วิดีโอสินค้า — อัปโหลดจากหน้าแก้ไขสินค้า (app/product/BasketVideo.js) ผ่าน /api/basket/<platform>
//   Netlify รับคำขอได้ ~6MB จึงส่งไฟล์ทั้งก้อนผ่านเซิร์ฟเวอร์ไม่ได้ — แต่ละแพลตฟอร์มทำต่างกัน:
//
//   Shopee  อัปโหลดเป็นชิ้นตามเอกสาร media_space: เบราว์เซอร์คิด MD5 ทั้งไฟล์ → init → ส่งทีละชิ้น 4MB ผ่านเซิร์ฟเวอร์
//           (เซิร์ฟเวอร์คิด MD5 ของชิ้นเอง) → complete → ถามผลจน SUCCEEDED → ผูกด้วย update_item video_upload_id
//   TikTok  Upload Product File รับทั้งไฟล์ครั้งเดียว ไม่มีแบบแบ่งชิ้น → เบราว์เซอร์ฝากไฟล์ไว้ที่ Supabase Storage ก่อน
//           (ลิงก์อัปโหลดแบบเซ็นแล้ว ส่งตรงไม่ผ่าน Netlify) → เซิร์ฟเวอร์ดึงมาส่ง TikTok แล้วลบทิ้ง → ผูกด้วย partial_edit video.id
//   Lazada  ไม่ต้องอัปโหลด — ใส่ลิงก์วิดีโอที่แอตทริบิวต์ "video" ในส่วนคุณสมบัติ
import crypto from 'crypto';
import * as shopee from './shopee.js';
import * as tiktok from './tiktok.js';
import { shopeeAuth } from './discounts.js';
import { db } from './supabase.js';
import { BasketError } from './basket.js';
import { ttAuth } from './basketTiktok.js';

export const VIDEO_MAX = 30 * 1024 * 1024;   // Shopee บังคับ 30MB · TikTok ให้ถึง 100MB แต่เซิร์ฟเวอร์ต้องดึง+ส่งต่อให้ทันเวลาของฟังก์ชัน
const UPLOAD_ID = /^[\w-]{6,160}$/;
const checkSize = (size) => {
  const n = Number(size);
  if (!Number.isInteger(n) || n <= 0) throw new BasketError('ขนาดไฟล์ไม่ถูกต้อง');
  if (n > VIDEO_MAX) throw new BasketError(`วิดีโอใหญ่เกิน ${VIDEO_MAX / 1024 / 1024}MB`);
  return n;
};

// ═════════════ Shopee ═════════════
export async function shopeeVideoInit(shop, { md5, size }) {
  if (!/^[0-9a-f]{32}$/.test(String(md5 || ''))) throw new BasketError('MD5 ของไฟล์ไม่ถูกต้อง');
  const n = checkSize(size);
  const uploadId = await shopee.initVideoUpload({ ...(await shopeeAuth(shop)), md5: String(md5), size: n });
  return { uploadId, partSize: shopee.VIDEO_PART, parts: Math.ceil(n / shopee.VIDEO_PART) };
}
export async function shopeeVideoPart(shop, uploadId, seq, bytes) {
  if (!UPLOAD_ID.test(String(uploadId || ''))) throw new BasketError('video_upload_id ไม่ถูกต้อง');
  const s = Number(seq);
  if (!Number.isInteger(s) || s < 0 || s >= Math.ceil(VIDEO_MAX / shopee.VIDEO_PART)) throw new BasketError('ลำดับชิ้นไม่ถูกต้อง');
  if (!bytes.length || bytes.length > shopee.VIDEO_PART) throw new BasketError('ชิ้นต้องไม่ว่างและไม่เกิน 4MB');
  const { partner } = await shopeeAuth(shop);
  await shopee.uploadVideoPart({ uploadId: String(uploadId), seq: s, bytes, partner });
  return { seq: s };
}
export async function shopeeVideoComplete(shop, uploadId, parts, cost) {
  if (!UPLOAD_ID.test(String(uploadId || ''))) throw new BasketError('video_upload_id ไม่ถูกต้อง');
  const n = Number(parts);
  if (!Number.isInteger(n) || n < 1 || n > Math.ceil(VIDEO_MAX / shopee.VIDEO_PART)) throw new BasketError('จำนวนชิ้นไม่ถูกต้อง');
  const { partner } = await shopeeAuth(shop);
  await shopee.completeVideoUpload({ uploadId: String(uploadId), seqs: [...Array(n).keys()], cost, partner });
  return {};
}
// status: INITIATED | TRANSCODING | SUCCEEDED | FAILED | CANCELLED
export async function shopeeVideoResult(shop, uploadId) {
  if (!UPLOAD_ID.test(String(uploadId || ''))) throw new BasketError('video_upload_id ไม่ถูกต้อง');
  const r = await shopee.getVideoUploadResult({ ...(await shopeeAuth(shop)), uploadId: String(uploadId) });
  const v = r.video_info || {};
  return {
    status: r.status || 'UNKNOWN', message: r.message || null,
    url: (v.video_url_list || [])[0]?.video_url || null, cover: (v.thumbnail_url_list || [])[0]?.image_url || null, duration: v.duration ?? null,
  };
}
export async function shopeeVideoCancel(shop, uploadId) {
  if (!UPLOAD_ID.test(String(uploadId || ''))) throw new BasketError('video_upload_id ไม่ถูกต้อง');
  await shopee.cancelVideoUpload({ ...(await shopeeAuth(shop)), uploadId: String(uploadId) });
  return {};
}

// ═════════════ TikTok (ฝากไฟล์ที่ Supabase Storage) ═════════════
const BUCKET = 'video-tmp';
const EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const STAGED = /^\d{13}-[0-9a-f]{12}\.(mp4|mov|webm)$/;
async function ensureBucket() {
  const { error } = await db().storage.createBucket(BUCKET, { public: false, fileSizeLimit: VIDEO_MAX });
  if (error && !/exist|duplicate/i.test(error.message || '')) throw new Error(`สร้างที่ฝากวิดีโอไม่ได้: ${error.message}`);
}
// ไฟล์ค้างจากรอบที่อัปโหลดไม่จบ (เกิน 1 ชม.) — ลบทิ้งทุกครั้งที่เริ่มรอบใหม่
async function sweep() {
  try {
    const { data } = await db().storage.from(BUCKET).list('', { limit: 100 });
    const old = (data || []).filter((f) => STAGED.test(f.name) && Date.now() - Number(f.name.slice(0, 13)) > 3600e3).map((f) => f.name);
    if (old.length) await db().storage.from(BUCKET).remove(old);
  } catch { /* ไม่เป็นไร รอบหน้าลบใหม่ */ }
}
export async function tiktokVideoStage(shop, { size, type }) {
  await ttAuth(shop);
  checkSize(size);
  const ext = EXT[String(type || '')];
  if (!ext) throw new BasketError('วิดีโอต้องเป็น MP4 / MOV / WEBM');
  await ensureBucket();
  await sweep();
  const path = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) throw new Error(`ขอลิงก์อัปโหลดไม่ได้: ${error?.message || 'ไม่ทราบสาเหตุ'}`);
  return { path, url: data.signedUrl };
}
export async function tiktokVideoUpload(shop, path) {
  if (!STAGED.test(String(path || ''))) throw new BasketError('ไฟล์ที่ฝากไว้ไม่ถูกต้อง');
  const auth = await ttAuth(shop);
  const store = db().storage.from(BUCKET);
  try {
    const { data, error } = await store.download(String(path));
    if (error || !data) throw new BasketError(`ไม่เจอไฟล์ที่ฝากไว้ — อัปโหลดใหม่ (${error?.message || ''})`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    checkSize(bytes.length);
    const ext = path.split('.').pop();
    const type = Object.keys(EXT).find((k) => EXT[k] === ext);
    const f = await tiktok.uploadFile({ ...auth, bytes, name: `video${Date.now()}.${ext}`, contentType: type });
    return { id: String(f.id), url: f.url || null, format: f.format || null };
  } finally {
    await store.remove([String(path)]).catch(() => {});
  }
}
