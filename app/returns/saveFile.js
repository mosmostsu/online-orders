// บันทึกไฟล์จากหน้า /returns ลงเครื่อง
//   saveAs()      = เปิดหน้าต่าง "บันทึกเป็น" ให้เลือกที่เก็บเอง (Chrome/Edge) — เบราว์เซอร์อื่นดาวน์โหลดปกติ
//   saveToSync()  = เขียนลงโฟลเดอร์ที่เลือกไว้ครั้งแรก (เช่น G:\My Drive\product_image\สินค้าตีคืน\sync
//                   ที่ Google Drive บนเครื่องซิงก์ขึ้น Drive ให้เอง) ครั้งต่อไปไม่ต้องเลือกซ้ำ
// โฟลเดอร์ที่เลือกจำไว้ในเบราว์เซอร์เครื่องนั้น (IndexedDB) — เครื่องอื่นต้องเลือกครั้งแรกของตัวเอง
const DB = 'order-sync-files';
const STORE = 'handles';
const KEY = 'returns-sync-dir';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) {
  const d = await idb();
  return new Promise((res, rej) => {
    const q = d.transaction(STORE).objectStore(STORE).get(k);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function idbSet(k, v) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(v, k);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const isAbort = (e) => e?.name === 'AbortError';

// คืน { where } เมื่อบันทึกแล้ว · { cancelled:true } เมื่อผู้ใช้กดยกเลิก
export async function saveAs(name, blob, { description = 'ไฟล์', accept = {} } = {}) {
  if (typeof window.showSaveFilePicker !== 'function') { download(name, blob); return { where: 'โฟลเดอร์ดาวน์โหลด' }; }
  try {
    const h = await window.showSaveFilePicker({ suggestedName: name, id: 'returns-save-as', types: [{ description, accept }] });
    const w = await h.createWritable();
    await w.write(blob);
    await w.close();
    return { where: h.name };
  } catch (e) {
    if (isAbort(e)) return { cancelled: true };
    throw e;
  }
}

export const canPickFolder = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

export async function syncFolderName() {
  try { return (await idbGet(KEY))?.name || ''; } catch { return ''; }
}

export async function pickSyncFolder() {
  const dir = await window.showDirectoryPicker({ id: 'returns-sync', mode: 'readwrite' });
  await idbSet(KEY, dir);
  return dir.name;
}

// เขียนไฟล์ลงโฟลเดอร์ sync — ยังไม่เคยเลือก / ไม่มีสิทธิ์แล้ว = ถามเลือกโฟลเดอร์ก่อน
export async function saveToSync(name, blob) {
  if (!canPickFolder()) { download(name, blob); return { where: 'โฟลเดอร์ดาวน์โหลด (เบราว์เซอร์นี้เลือกโฟลเดอร์ไม่ได้ ใช้ Chrome)' }; }
  try {
    let dir = null;
    try { dir = await idbGet(KEY); } catch { /* ไม่มีที่จำ */ }
    if (dir) {
      const opt = { mode: 'readwrite' };
      if ((await dir.queryPermission(opt)) !== 'granted' && (await dir.requestPermission(opt)) !== 'granted') dir = null;
    }
    if (!dir) {
      dir = await window.showDirectoryPicker({ id: 'returns-sync', mode: 'readwrite' });
      await idbSet(KEY, dir);
    }
    const f = await dir.getFileHandle(name, { create: true });
    const w = await f.createWritable();
    await w.write(blob);
    await w.close();
    return { where: `${dir.name}\\${name}` };
  } catch (e) {
    if (isAbort(e)) return { cancelled: true };
    throw e;
  }
}

// เวลาไทยสำหรับชื่อไฟล์ เช่น 20261126-1530
export const stamp = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16).replace(/-/g, '').replace('T', '-').replace(':', '');
