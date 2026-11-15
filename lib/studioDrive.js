// นับฟุตเทจสดจาก Google Drive โฟลเดอร์ "ฟุตเทจแยกสินค้า" (หมวด/รุ่น/ไฟล์) ด้วย service account เดียวกับหน้า /video
// ต้อง: แชร์โฟลเดอร์ให้ GOOGLE_SA_EMAIL (แชร์แล้ว 2026-11-15) + เปิด Google Drive API ในโปรเจกต์ของ service account
// ถามแค่ 3-4 ครั้งต่อรอบ (หมวด → รุ่นทั้งหมด → ไฟล์ทั้งหมด) แคช 5 นาที · อ่านไม่ได้ = คืน null ให้หน้าใช้ตัวเลขสำรอง
import { unstable_cache } from 'next/cache';
import { accessToken } from './video';
import { buildFolders } from './studio';

export const FOOTAGE_ROOT = process.env.STUDIO_FOOTAGE_FOLDER_ID || '1Cdrcxybu6nmfpU_Vv4tKDUlVCJC60IT5';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FOLDER = 'application/vnd.google-apps.folder';

async function listAll(token, q, fields) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < 20; i += 1) {
    const u = new URL('https://www.googleapis.com/drive/v3/files');
    u.searchParams.set('q', q);
    u.searchParams.set('fields', `nextPageToken, files(${fields})`);
    u.searchParams.set('pageSize', '1000');
    u.searchParams.set('supportsAllDrives', 'true');
    u.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Drive: ${j.error?.message || res.status}`);
    out.push(...(j.files || []));
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

const inParents = (ids) => `(${ids.map((id) => `'${id}' in parents`).join(' or ')})`;

async function chunked(ids, size, fn) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
  return out;
}

async function readFootage() {
  const token = await accessToken(SCOPE);
  const cats = await listAll(token, `'${FOOTAGE_ROOT}' in parents and mimeType = '${FOLDER}' and trashed = false`, 'id, name');
  if (!cats.length) return [];
  const subs = await chunked(cats.map((c) => c.id), 40, (ids) =>
    listAll(token, `${inParents(ids)} and mimeType = '${FOLDER}' and trashed = false`, 'id, name, parents'));
  if (!subs.length) return buildFolders(cats, [], []);
  const files = await chunked(subs.map((s) => s.id), 40, (ids) =>
    listAll(token, `${inParents(ids)} and mimeType contains 'video/' and trashed = false`, 'parents, mimeType, modifiedTime'));
  return buildFolders(cats, subs, files);
}

const cached = unstable_cache(readFootage, ['studio-footage'], { revalidate: 300 });

// คืน { folders, error } — folders = null เมื่ออ่าน Drive ไม่ได้
export async function footageFromDrive() {
  try {
    return { folders: await cached(), error: null };
  } catch (e) {
    return { folders: null, error: String(e.message || e) };
  }
}
