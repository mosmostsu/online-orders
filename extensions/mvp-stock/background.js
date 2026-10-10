// อัปเดตคลัง Shopee MVP (กดปุ่มเอง) — ทำงานใน Chrome โปรไฟล์ที่ล็อกอิน Seller Center ของ mvp.sport2023 ไว้
//
// เมื่อกดปุ่ม (ไม่มีรอบอัตโนมัติ) ทำวงจรเดียวกับที่คนทำด้วยมือ แต่ผ่านคำขอเบื้องหลังของหน้า Seller Center:
//   1. สั่งสร้างไฟล์ "แก้ไขสินค้า"  POST /api/mass/mpsku/generate_template
//   2. รอเสร็จ + เช็คว่าเป็นร้าน MVP  GET  /api/tool/mass_product/get_mass_record_list
//   3. ดาวน์โหลด                       GET  /api/tool/mass_product/download_record_file
//   4. ขอคลังจากเว็บ order-sync (ST − ออเดอร์รอส่ง) แล้วเขียนลงคอลัมน์คลัง
//   5. อัปโหลดกลับ                     POST /api/mass/mpsku/upload_edit_template
// คำขอพวกนี้ Shopee ไม่ได้เปิดให้คนนอกใช้ — ถ้าหน้า Seller Center เปลี่ยน ส่วนขยายจะพังและแจ้งเตือน
//
// กันพลาด: ร้านต้องเป็น shop_id 1423805168 ทุกขั้น · ไฟล์ ST เก่าเกิน 48 ชม. ไม่ทำ · เปลี่ยนเกินครึ่งหนึ่งของแถวไม่ทำ
const SHOP_ID = 1423805168;
const SHOP_NAME = 'mvp.sport2023';
const DEFAULT_API = 'https://order-sync-solid.netlify.app';
const SC_URL = 'https://seller.shopee.co.th/portal/product-mass/mass-update/download';
const MAX_ST_AGE_H = 48;
const MAX_CHANGE_RATIO = 0.5;

// ── กดเองอย่างเดียว ไม่ตั้งเวลา (ผู้ใช้เลือก 2026-10-09) ─────────────────────
// รุ่นก่อนเคยตั้งนาฬิกา 'daily' ไว้ — ล้างทิ้งตอนติดตั้ง/รีโหลด/เปิด Chrome ไม่ให้รอบอัตโนมัติค้างทำงาน
const clearOldAlarm = () => chrome.alarms.clearAll();
chrome.runtime.onInstalled.addListener(clearOldAlarm);
chrome.runtime.onStartup.addListener(clearOldAlarm);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'run') { run('manual').then(reply); return true; }
  return false;
});

// ── ขั้นที่ทำในหน้า Seller Center (ฉีดเข้าแท็บ) ─────────────────────────
// ฟังก์ชันพวกนี้ถูกคัดลอกไปรันในแท็บ ใช้ตัวแปรข้างนอกไม่ได้ — ทุกอย่างต้องมากับ args
async function pageDownload(shopId) {
  const X = globalThis.MVPXLSX;
  const cds = (document.cookie.match(/SPC_CDS=([^;]+)/) || [])[1];
  if (!cds) return { error: 'ไม่ได้ล็อกอิน Seller Center (ไม่มีคุกกี้ SPC_CDS) — เข้าระบบร้าน MVP ใหม่' };
  const q = `SPC_CDS=${cds}&SPC_CDS_VER=2`;
  const getJson = async (url, opt) => {
    const res = await fetch(url, opt);
    const j = await res.json().catch(() => null);
    if (!j) throw new Error(`Shopee ตอบไม่ใช่ JSON (${res.status}) — อาจหลุดการล็อกอิน`);
    return j;
  };
  const list = async (op) => {
    const j = await getJson(`/api/tool/mass_product/get_mass_record_list/?${q}&page_number=1&page_size=10&operation_type=${op}`);
    if (j.code !== 0) throw new Error('get_mass_record_list: ' + (j.user_message || j.message || j.code));
    return j.data?.list || [];
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const before = await list(3);
  const prevMax = Math.max(0, ...before.map((x) => x.id));
  const g = await getJson(`/api/mass/mpsku/generate_template?${q}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ is_query: false, template_type: 1, search_condition: {} }),
  });
  if (g.code !== 0) return { error: 'สั่งสร้างไฟล์ไม่สำเร็จ: ' + (g.user_message || g.message || g.code) };

  let rec = null;
  for (let i = 0; i < 300 && !rec; i++) {
    await sleep(2000);
    rec = (await list(3)).find((x) => x.id > prevMax && x.file_type === 'sales_info' && x.record_status === 1 && x.total_count > 0) || null;
  }
  if (!rec) return { error: 'รอไฟล์จาก Shopee เกิน 10 นาที' };
  if (rec.shop_id !== shopId) return { error: `ร้านไม่ตรง: ได้ shop_id ${rec.shop_id} (ต้องเป็น ${shopId}) — โปรไฟล์นี้ล็อกอินร้านอื่นอยู่` };

  const res = await fetch(`/api/tool/mass_product/download_record_file/?${q}&record_id=${rec.id}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] !== 0x50) return { error: 'ดาวน์โหลดไฟล์ไม่สำเร็จ: ' + new TextDecoder().decode(buf.slice(0, 200)) };
  const zip = X.readZip(buf);
  const sheetName = 'xl/worksheets/sheet1.xml';
  const sheet = await zip.text(sheetName);
  const rows = X.parseSheet(sheet, await zip.text('xl/sharedStrings.xml'));
  // หัวตารางภาษาไทยอยู่แถว 3 — ยืนยันว่าคอลัมน์ยังเป็น F = เลข SKU, I = คลัง ก่อนแตะอะไร
  const head = rows.find((r) => r.r === 3)?.c || {};
  if (head.F !== 'เลข SKU' || head.I !== 'คลัง') {
    return { error: `แบบฟอร์ม Shopee เปลี่ยน (F="${head.F}", I="${head.I}") — ต้องแก้ส่วนขยาย` };
  }
  // B ชื่อสินค้า · D ชื่อตัวเลือก — ไว้โชว์ในหน้าต่างส่วนขยายและ Telegram
  const data = rows.filter((r) => r.r >= 7 && r.c.F).map((r) => ({
    r: r.r, sku: String(r.c.F).trim(), cur: Number(r.c.I) || 0,
    name: String(r.c.B || '').slice(0, 60), variant: String(r.c.D || ''),
  }));
  globalThis.__mvp = { zip, sheetName, sheet, data, cds };
  // รายการสินค้าทั้งร้านจากไฟล์เดียวกัน — ส่งเข้า order-sync ให้หน้า /product และ /allsite (ดู /api/mvp/listings)
  // A รหัสสินค้า · B ชื่อ · C รหัสตัวเลือก · D ชื่อตัวเลือก · E Parent SKU · F เลข SKU · G ราคา · I คลัง
  const listing = rows.filter((r) => r.r >= 7 && r.c.A).map((r) => ({
    product_id: r.c.A, title: r.c.B, variation_id: r.c.C, variant: r.c.D,
    parent_sku: r.c.E, sku: String(r.c.F || '').trim(), price: r.c.G, stock: Number(r.c.I) || 0,
  }));
  return { recordId: rec.id, rows: data.length, skus: [...new Set(data.map((d) => d.sku))], listing };
}

// รูปสินค้า — ไฟล์ "แก้ไขสินค้า" ไม่มีรูป ต้องสร้างแบบฟอร์ม "ข้อมูลรูปภาพ" (template_type 5) อีกไฟล์
// แถวละหนึ่งตะกร้า: A รหัสสินค้า · E ภาพปก · ตัวเลือกชั้นแรก (มักเป็นสี) เป็นคู่ ชื่อ/รูป เริ่มที่ Q/R, S/T, ... 12 คู่
// คืน { cover: {รหัสสินค้า: url}, opt: {รหัสสินค้า: {ชื่อตัวเลือก: url}} }
async function pageImages(shopId) {
  const X = globalThis.MVPXLSX;
  const cds = (document.cookie.match(/SPC_CDS=([^;]+)/) || [])[1];
  if (!cds) return { error: 'ไม่ได้ล็อกอิน' };
  const q = `SPC_CDS=${cds}&SPC_CDS_VER=2`;
  const list = async () => {
    const j = await fetch(`/api/tool/mass_product/get_mass_record_list/?${q}&page_number=1&page_size=10&operation_type=3`).then((r) => r.json());
    return j.data?.list || [];
  };
  const prevMax = Math.max(0, ...(await list()).map((x) => x.id));
  const g = await fetch(`/api/mass/mpsku/generate_template?${q}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ is_query: false, template_type: 5, search_condition: {} }),
  }).then((r) => r.json()).catch(() => null);
  if (!g || g.code !== 0) return { error: 'สร้างไฟล์รูปไม่สำเร็จ: ' + (g?.user_message || g?.message || '') };
  let rec = null;
  for (let i = 0; i < 150 && !rec; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    rec = (await list()).find((x) => x.id > prevMax && x.file_type === 'media_info' && x.record_status === 1 && x.total_count > 0) || null;
  }
  if (!rec) return { error: 'รอไฟล์รูปเกิน 5 นาที' };
  if (rec.shop_id !== shopId) return { error: `ไฟล์รูปเป็นของร้าน ${rec.shop_id}` };
  const buf = new Uint8Array(await (await fetch(`/api/tool/mass_product/download_record_file/?${q}&record_id=${rec.id}`)).arrayBuffer());
  const zip = X.readZip(buf);
  const rows = X.parseSheet(await zip.text('xl/worksheets/sheet1.xml'), await zip.text('xl/sharedStrings.xml'));
  const head = rows.find((r) => r.r === 3)?.c || {};
  if (head.A !== 'รหัสสินค้า' || head.E !== 'ภาพปก') return { error: `แบบฟอร์มรูปเปลี่ยน (A="${head.A}", E="${head.E}")` };
  const col = (n) => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  const Q = 16;   // ตำแหน่งคอลัมน์ Q (นับจาก A = 0)
  const cover = {}, opt = {};
  for (const r of rows) {
    if (r.r < 7 || !r.c.A) continue;
    const pid = String(r.c.A).trim();
    if (r.c.E) cover[pid] = r.c.E;
    for (let k = 0; k < 12; k++) {
      const name = String(r.c[col(Q + 2 * k)] || '').trim();
      const url = r.c[col(Q + 2 * k + 1)];
      if (name && url) (opt[pid] = opt[pid] || {})[name] = url;
    }
  }
  return { cover, opt };
}

async function pageUpload(shopId, qty, maxRatio) {
  const X = globalThis.MVPXLSX;
  const st = globalThis.__mvp;
  if (!st) return { error: 'ไม่มีไฟล์จากขั้นดาวน์โหลด (หน้าถูกรีเฟรชระหว่างทำงาน)' };
  const want = {};
  // รายการที่เปลี่ยน [sku, เดิม, ใหม่] — รายงานแบบเดียวกับ Colab (ข้อความ 10 ตัวแรก + ไฟล์ CSV เต็ม)
  // และ SKU ที่ไม่มีใน ST แต่บน MVP ยังมีคลัง [sku, คลังบน MVP] ไว้ตามแก้รหัสที่ลงผิด
  const changes = [];
  const missingList = [];
  let up = 0, down = 0, missing = 0, missingWithStock = 0;
  for (const d of st.data) {
    const v = qty[d.sku];
    if (v === null || v === undefined) {
      missing++;
      if (d.cur > 0) { missingWithStock++; missingList.push([d.sku, d.cur]); }
      continue;
    }
    if (v !== d.cur) { want[d.r] = v; changes.push([d.sku, d.cur, v, d.name, d.variant]); if (v > d.cur) up++; else down++; }
  }
  const changed = up + down;
  const base = { rows: st.data.length, changed, up, down, missing, missingWithStock, changes, missingList };
  if (!changed) return { ok: true, ...base };
  if (changed > st.data.length * maxRatio) {
    return { ...base, error: `จะเปลี่ยน ${changed} จาก ${st.data.length} แถว เยอะผิดปกติ — ไม่อัปโหลด ตรวจไฟล์ ST ก่อน` };
  }

  const { xml, n } = X.setNumbers(st.sheet, 'I', want);
  if (n !== changed) return { ...base, error: `เขียนคลังได้ ${n} แถว ไม่ครบ ${changed} — ไม่อัปโหลด` };
  const files = [];
  for (const e of st.zip.entries) {
    files.push({ nameB: e.nameB, data: e.name === st.sheetName ? new TextEncoder().encode(xml) : await st.zip.data(e) });
  }
  const blob = X.writeZipStored(files);
  if (blob.size > 3 * 1024 * 1024) return { ...base, error: `ไฟล์ใหญ่ ${Math.round(blob.size / 1024)} KB เกินเพดาน 3 MB` };

  const q = `SPC_CDS=${st.cds}&SPC_CDS_VER=2`;
  const list = async () => {
    const j = await fetch(`/api/tool/mass_product/get_mass_record_list/?${q}&page_number=1&page_size=10&operation_type=4`).then((r) => r.json());
    if (j.code !== 0) throw new Error('get_mass_record_list: ' + (j.user_message || j.message || j.code));
    return j.data?.list || [];
  };
  const prevMax = Math.max(0, ...(await list()).map((x) => x.id));
  const stamp = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16).replace(/\D/g, '');
  const fd = new FormData();
  fd.append('file', new File([blob], `mass_update_sales_info_${shopId}_auto_${stamp}.xlsx`, { type: blob.type }));
  const res = await fetch(`/api/mass/mpsku/upload_edit_template/?${q}&timestamp=${Date.now()}`, { method: 'POST', body: fd });
  const text = await res.text();
  let u = null;
  try { u = JSON.parse(text); } catch { /* ด้านล่างรายงานสิ่งที่ได้จริง */ }
  if (!u) return { ...base, error: `อัปโหลดไม่สำเร็จ: Shopee ตอบ ${res.status} ไม่ใช่ JSON — ${text.replace(/\s+/g, ' ').slice(0, 120)}` };
  if (u.code !== 0) return { ...base, error: 'อัปโหลดไม่สำเร็จ: ' + (u.user_message || u.message || u.code) };

  let rec = null;
  for (let i = 0; i < 150 && !rec; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    rec = (await list()).find((x) => x.id > prevMax && x.record_status === 1 && x.handled_count >= x.total_count && x.total_count > 0) || null;
  }
  if (!rec) return { ...base, ok: true, warn: 'อัปโหลดแล้ว แต่ Shopee ยังประมวลผลไม่เสร็จใน 5 นาที — ดูผลที่หน้าแก้ไขข้อมูลสินค้าแบบชุด' };
  if (rec.shop_id !== shopId) return { ...base, error: `ผลอัปโหลดเป็นของร้าน ${rec.shop_id} ไม่ใช่ ${shopId}` };
  globalThis.__mvp = null;
  return { ...base, ok: true, upload: { id: rec.id, total: rec.total_count, success: rec.success_count } };
}

// ── หาแท็บ Seller Center (เปิดใหม่ในพื้นหลังถ้าไม่มี) ─────────────────────
async function sellerTab() {
  const tabs = await chrome.tabs.query({ url: 'https://seller.shopee.co.th/*' });
  const ready = tabs.find((t) => t.status === 'complete' && !t.discarded);
  if (ready) return { id: ready.id, opened: false };
  const t = await chrome.tabs.create({ url: SC_URL, active: false });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); reject(new Error('เปิด Seller Center ไม่ขึ้นใน 60 วินาที')); }, 60000);
    function on(id, info) {
      if (id === t.id && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); resolve(); }
    }
    chrome.tabs.onUpdated.addListener(on);
  });
  return { id: t.id, opened: true };
}

// รันในโลกเดียวกับหน้าเว็บ (MAIN) ไม่ใช่โลกแยกของส่วนขยาย — หน้า Seller Center ห่อ fetch/XHR ไว้
// แล้วแนบ header กันบอทให้คำขอบางตัว รันจากโลกแยกแล้วการอัปโหลดโดนกัน ได้คำตอบที่ไม่ใช่ JSON
// (เจอจริงรอบแรก 2026-10-09: สร้างไฟล์/ดาวน์โหลดผ่าน แต่อัปโหลดพัง · ยิงจากโลกหน้าเว็บได้ JSON ปกติ)
async function inTab(tabId, func, args) {
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['xlsx.js'] });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
  return res?.result;
}

async function settings() {
  const s = await chrome.storage.local.get(['apiKey', 'apiBase']);
  return { key: s.apiKey || '', base: (s.apiBase || DEFAULT_API).replace(/\/+$/, '') };
}

async function report(cfg, result) {
  if (!cfg.key) return;
  try {
    await fetch(`${cfg.base}/api/mvp/report`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-key': cfg.key }, body: JSON.stringify(result),
    });
  } catch { /* แจ้งไม่ได้ก็ยังเห็นผลในหน้าต่างส่วนขยาย */ }
}

let running = false;
async function run(trigger) {
  if (running) return { ok: false, error: 'กำลังทำงานอยู่แล้ว' };
  running = true;
  // รอไฟล์จาก Shopee ได้หลายนาที (เจอจริง: สร้างไฟล์ใช้ 3 นาที 47 วิ) กัน service worker หลับกลางทาง
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  chrome.action.setBadgeText({ text: '…' });
  const started = new Date().toISOString();
  let result;
  let tab = null;
  let dl = null;
  let newQty = null;
  const cfg = await settings();
  try {
    if (!cfg.key) throw new Error('ยังไม่ได้ใส่กุญแจ (MVP_STOCK_KEY) ในหน้าตั้งค่าของส่วนขยาย');
    tab = await sellerTab();
    dl = await inTab(tab.id, pageDownload, [SHOP_ID]);
    if (!dl || dl.error) throw new Error(dl?.error || 'ขั้นดาวน์โหลดไม่ตอบ');

    const res = await fetch(`${cfg.base}/api/mvp/stock`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-key': cfg.key }, body: JSON.stringify({ skus: dl.skus }),
    });
    const stock = await res.json().catch(() => ({ ok: false, error: `เว็บ order-sync ตอบ ${res.status}` }));
    if (!stock.ok) throw new Error('ขอคลังไม่สำเร็จ: ' + stock.error);
    if (!stock.st_file_at) throw new Error('ไม่รู้ว่าไฟล์ ST เป็นของเมื่อไหร่ — ไม่อัปโหลด');
    const ageH = (Date.now() - new Date(stock.st_file_at).getTime()) / 3600000;
    if (ageH > MAX_ST_AGE_H) throw new Error(`ไฟล์ ST เก่า ${Math.round(ageH)} ชม. (เกิน ${MAX_ST_AGE_H}) — ไม่อัปโหลด`);

    const up = await inTab(tab.id, pageUpload, [SHOP_ID, stock.qty, MAX_CHANGE_RATIO]);
    if (!up || up.error) throw Object.assign(new Error(up?.error || 'ขั้นอัปโหลดไม่ตอบ'), { detail: up });
    newQty = stock.qty;   // อัปโหลดผ่านแล้ว รายการสินค้าที่ส่งเข้า order-sync ใช้คลังใหม่
    result = { ok: true, trigger, started, finished: new Date().toISOString(), stFileAt: stock.st_file_at, counts: stock.counts, ...up };
  } catch (e) {
    result = { ok: false, trigger, started, finished: new Date().toISOString(), error: String(e.message || e), ...(e.detail || {}) };
  }
  // ปิดแท็บที่เปิดเองหลังขั้นรูป/รายการสินค้า (ด้านล่างยังต้องใช้แท็บโหลดไฟล์รูป)
  // ส่งรายการสินค้าเข้า order-sync — ทำแม้อัปเดตคลังไม่ผ่าน (ไฟล์ที่โหลดมาเป็นของสดอยู่แล้ว ใช้คลังเดิมในไฟล์)
  // พังก็ไม่ให้รอบนี้นับว่าพัง แค่บันทึกไว้ในผล
  if (dl?.listing?.length && cfg.key) {
    try {
      // รูปมาจากอีกไฟล์ — พังก็ส่งรายการสินค้าไปแบบไม่มีรูป ไม่ให้ทั้งขั้นพัง
      let img = null;
      try {
        if (tab) img = await inTab(tab.id, pageImages, [SHOP_ID]);
      } catch (e) { img = { error: String(e.message || e) }; }
      if (img?.error) result.imagesError = img.error;
      const rows = dl.listing.map((x) => {
        const v = newQty?.[x.sku];
        const pid = String(x.product_id).trim();
        // ชื่อตัวเลือกในไฟล์ขาย เช่น "342173-กรม,2XL" — ส่วนก่อนคอมมาคือตัวเลือกชั้นแรกที่มีรูป
        const first = String(x.variant || '').split(',')[0].trim();
        return {
          ...x,
          ...(v === null || v === undefined ? {} : { stock: v }),
          cover: img?.cover?.[pid] || null,
          image: img?.opt?.[pid]?.[first] || null,
        };
      });
      const res = await fetch(`${cfg.base}/api/mvp/listings`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-key': cfg.key }, body: JSON.stringify({ rows }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `เว็บ order-sync ตอบ ${res.status}` }));
      result.listings = j.ok ? { saved: j.listings, removed: j.removed } : { error: j.error };
    } catch (e) {
      result.listings = { error: String(e.message || e) };
    }
  }
  clearInterval(keepAlive);
  running = false;
  if (tab?.opened) chrome.tabs.remove(tab.id).catch(() => {});
  chrome.action.setBadgeText({ text: result.ok ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  await chrome.storage.local.set({ lastRun: result });
  await report(cfg, result);
  return result;
}
