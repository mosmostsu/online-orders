// อัปเดตคลัง Thaimart (กดปุ่มเอง) — ทำงานใน Chrome โปรไฟล์ที่ล็อกอิน seller.thaimart.com ของร้าน Solid Sports ไว้
//
// Thaimart ไม่มี API สาธารณะ แต่หน้า Seller Center เรียก API หลังบ้าน (seller-bff.marketplus.dev) ด้วยคุกกี้ accessToken
// ส่วนขยายทำแบบเดียวกันจากในแท็บ (ไม่เก็บโทเคนไว้ที่ไหน):
//   1. ดึงสินค้าทั้งร้าน      GET /api/v1/seller/products?page=N&limit=100   (ได้ variants[] พร้อม sku, quantity)
//   2. ขอจำนวนจากเว็บ order-sync (ST − ออเดอร์รอส่งที่สั่งหลังไฟล์ ST)  POST /api/mvp/stock
//   3. สินค้าที่ตัวเลขเปลี่ยน → GET สดอีกรอบ แก้เฉพาะ quantity → PUT /api/v1/shops/products/{id}
// PUT ของ Thaimart ส่งทั้งก้อนสินค้า (ไม่ใช่เฉพาะสต็อก) จึงต้อง GET สดก่อนทุกครั้งแล้วส่งกลับครบทุกฟิลด์
// ที่หน้าเว็บส่ง (status, name, description, categoryPath, requiredCompliances, images, dimensions, options, variants)
// พิสูจน์แล้ว 2026-10-10: แก้ 1 ตัวเลือก 14→13 แล้วกลับ ได้ 200 ข้อมูลส่วนอื่นไม่เปลี่ยน
//
// กันพลาด: ร้านต้องเป็น Solid Sports (shop id ด้านล่าง) · ไฟล์ ST เก่าเกิน 48 ชม. ไม่ทำ ·
// เปลี่ยนเกินครึ่งของตัวเลือกไม่ทำ (ยกเว้นติ๊ก "ครั้งแรก") · SKU ที่ไม่มีใน ST คงค่าเดิม
const SHOP_ID = '6a4df5d432e2dc9e3763624e';
const SHOP_NAME = 'Solid Sports';
const DEFAULT_API = 'https://order-sync-solid.netlify.app';
const SC_URL = 'https://seller.thaimart.com/products';
const MAX_ST_AGE_H = 48;
const MAX_CHANGE_RATIO = 0.5;

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'run') { run('manual', { force: !!msg.force }).then(reply); return true; }
  return false;
});

// ── ขั้นที่ทำในหน้า Seller Center (ฉีดเข้าแท็บ ใช้ตัวแปรข้างนอกไม่ได้ ทุกอย่างมากับ args) ──
async function pageList(shopId) {
  const tok = decodeURIComponent((document.cookie.match(/(?:^|;\s*)accessToken=([^;]+)/) || [])[1] || '');
  if (!tok) return { error: 'ไม่ได้ล็อกอิน Seller Center (ไม่มีคุกกี้ accessToken) — เข้าระบบร้าน Solid Sports ใหม่' };
  const base = 'https://seller-bff.marketplus.dev/api/v1';
  const H = { authorization: 'Bearer ' + tok };
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(`${base}/seller/products?page=${page}&limit=100`, { headers: H });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.status?.code !== 0) return { error: `ดึงรายการสินค้าไม่สำเร็จ (${r.status}) — อาจหลุดการล็อกอิน` };
    all.push(...(j.data || []));
    if (!j.pagination?.hasNext) break;
  }
  if (!all.length) return { error: 'ร้านนี้ไม่มีสินค้า' };
  const wrong = all.find((p) => p.shop?.id && p.shop.id !== shopId);
  if (wrong) return { error: `ร้านไม่ตรง: ได้ shop ${wrong.shop.id} (ต้องเป็น ${shopId}) — โปรไฟล์นี้ล็อกอินร้านอื่นอยู่` };
  globalThis.__tm = { tok, base, all };
  const rows = [];
  for (const p of all) for (const v of p.variants || []) if (v.sku) rows.push({ pid: p.id, sku: String(v.sku).trim(), cur: Number(v.quantity) || 0 });
  return { products: all.length, rows: rows.length, skus: [...new Set(rows.map((x) => x.sku))] };
}

async function pageApply(qty, maxRatio, force) {
  const st = globalThis.__tm;
  if (!st) return { error: 'ไม่มีข้อมูลจากขั้นดึงสินค้า (หน้าถูกรีเฟรชระหว่างทำงาน)' };
  const { tok, base, all } = st;
  const H = { authorization: 'Bearer ' + tok };
  const changes = [], missingList = [];
  let up = 0, down = 0, missing = 0, missingWithStock = 0, total = 0;
  const todo = new Map();      // product id → { sku: ใหม่ }
  for (const p of all) {
    for (const v of p.variants || []) {
      if (!v.sku) continue;
      total++;
      const sku = String(v.sku).trim();
      const want = qty[sku];
      const cur = Number(v.quantity) || 0;
      if (want === null || want === undefined) {
        missing++;
        if (cur > 0) { missingWithStock++; missingList.push([sku, cur]); }
        continue;
      }
      if (want !== cur) {
        // [sku, เดิม, ใหม่, ชื่อสินค้า, ตัวเลือก] — เว็บรายงานใช้ 3 ตัวแรก ที่เหลือไว้โชว์ในส่วนขยายและ Telegram
        changes.push([sku, cur, want, String(p.name || '').slice(0, 60), (v.attributes || []).map((a) => a.value).join('/')]);
        if (want > cur) up++; else down++;
        if (!todo.has(p.id)) todo.set(p.id, {});
        todo.get(p.id)[sku] = want;
      }
    }
  }
  const changed = up + down;
  const baseRes = { rows: total, changed, up, down, missing, missingWithStock, changes, missingList };
  if (!changed) return { ok: true, ...baseRes };
  if (!force && changed > total * maxRatio) {
    return { ...baseRes, error: `จะเปลี่ยน ${changed} จาก ${total} ตัวเลือก เยอะผิดปกติ — ไม่อัปเดต ตรวจไฟล์ ST ก่อน (รอบแรกให้ติ๊ก "ครั้งแรก")` };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let okProducts = 0;
  const failed = [];
  for (const [pid, want] of todo) {
    try {
      // GET สดก่อนทุกครั้ง กันทับการแก้ไขอื่นที่เกิดระหว่างรอบ
      const gr = await fetch(`${base}/shops/products/${pid}`, { headers: H });
      const gj = await gr.json().catch(() => null);
      const g = gj?.data;
      if (!gr.ok || !g) throw new Error(`GET ${gr.status}`);
      const d0 = g.variants?.[0]?.dimensions;
      if (!g.categoryPath || !g.options || !d0) throw new Error('ข้อมูลสินค้าไม่ครบสำหรับบันทึก (categoryPath/options/dimensions)');
      const body = {
        product: {
          status: g.status, name: g.name, description: g.description, categoryPath: g.categoryPath,
          requiredCompliances: g.requiredCompliances || [],
          images: (g.images || []).map((i) => ({ id: i.id || '', url: i.url })),
          dimensions: { width: d0.width, height: d0.height, length: d0.length },
          options: g.options,
          variants: g.variants.map((v) => {
            const k = String(v.sku || '').trim();
            return { id: v.id, sku: v.sku, price: String(v.price), quantity: k in want ? want[k] : v.quantity, weight: v.weight, attributes: v.attributes };
          }),
        },
      };
      const pr = await fetch(`${base}/shops/products/${pid}`, {
        method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const pj = await pr.json().catch(() => null);
      if (!pr.ok || pj?.status?.code !== 0) throw new Error(`PUT ${pr.status} ${pj?.status?.description || ''}`);
      // เทียบตัวเลขที่ตอบกลับกับที่ขอ
      const back = new Map((pj.data?.variants || []).map((v) => [String(v.sku || '').trim(), Number(v.quantity)]));
      for (const [k, n] of Object.entries(want)) if (back.has(k) && back.get(k) !== n) throw new Error(`ตอบกลับ ${k}=${back.get(k)} ไม่ตรงที่ขอ ${n}`);
      okProducts++;
    } catch (e) {
      failed.push([pid, String(e.message || e).slice(0, 120)]);
    }
    await sleep(150);
  }
  globalThis.__tm = null;
  const out = { ...baseRes, upload: { total: todo.size, success: okProducts }, failed };
  if (failed.length) out.error = `บันทึกไม่สำเร็จ ${failed.length}/${todo.size} สินค้า (ตัวอย่าง: ${failed[0][0]} — ${failed[0][1]})`;
  else out.ok = true;
  return out;
}

// ── หาแท็บ Seller Center (เปิดใหม่ในพื้นหลังถ้าไม่มี) ─────────────────────
async function sellerTab() {
  const tabs = await chrome.tabs.query({ url: 'https://seller.thaimart.com/*' });
  const ready = tabs.find((t) => t.status === 'complete' && !t.discarded && !/\/login/.test(t.url || ''));
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

// รันในโลกเดียวกับหน้าเว็บ (MAIN) เหมือนส่วนขยาย mvp-stock — หน้าเว็บห่อ fetch ไว้ รันจากโลกแยกอาจโดนบล็อก
async function inTab(tabId, func, args) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
  return res?.result;
}

async function settings() {
  const s = await chrome.storage.local.get(['apiKey', 'apiBase']);
  return { key: s.apiKey || '', base: (s.apiBase || DEFAULT_API).replace(/\/+$/, '') };
}

// คืนผลการส่ง Telegram ({ sent, error }) ให้หน้าต่างส่วนขยายโชว์ — แจ้งไม่ได้ก็ไม่ทำให้รอบนั้นพัง
async function report(cfg, result) {
  if (!cfg.key) return { sent: false, error: 'ไม่มีกุญแจ' };
  try {
    const res = await fetch(`${cfg.base}/api/mvp/report`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-key': cfg.key },
      body: JSON.stringify({ ...result, label: `Thaimart ${SHOP_NAME}`, platform: 'Thaimart' }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) return { sent: false, error: j?.error || `เว็บตอบ ${res.status}` };
    return { sent: Boolean(j.sent), error: j.skipped || (j.sent ? null : 'Telegram ไม่รับ (เช็คบอท/ห้อง)') };
  } catch (e) {
    return { sent: false, error: String(e.message || e) };
  }
}

let running = false;
async function run(trigger, { force = false } = {}) {
  if (running) return { ok: false, error: 'กำลังทำงานอยู่แล้ว' };
  running = true;
  chrome.action.setBadgeText({ text: '…' });
  const started = new Date().toISOString();
  let result;
  let tab = null;
  const cfg = await settings();
  try {
    if (!cfg.key) throw new Error('ยังไม่ได้ใส่กุญแจ (MVP_STOCK_KEY) ในหน้าตั้งค่าของส่วนขยาย');
    // header ต้องเป็น ASCII — กุญแจที่พิมพ์ตอนคีย์บอร์ดเป็นภาษาไทย/วางผิด ทำให้ fetch พังด้วยข้อความที่อ่านไม่รู้เรื่อง
    if (/[^\x21-\x7e]/.test(cfg.key)) throw new Error('กุญแจมีอักขระที่ไม่ใช่ภาษาอังกฤษ/ตัวเลข (หรือมีช่องว่าง) — เปิดตั้งค่าแล้ววางกุญแจ MVP_STOCK_KEY ใหม่ให้ตรงกับ Netlify');
    tab = await sellerTab();
    const dl = await inTab(tab.id, pageList, [SHOP_ID]);
    if (!dl || dl.error) throw new Error(dl?.error || 'ขั้นดึงสินค้าไม่ตอบ');

    const res = await fetch(`${cfg.base}/api/mvp/stock`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-key': cfg.key }, body: JSON.stringify({ skus: dl.skus }),
    });
    const stock = await res.json().catch(() => ({ ok: false, error: `เว็บ order-sync ตอบ ${res.status}` }));
    if (!stock.ok) throw new Error('ขอคลังไม่สำเร็จ: ' + stock.error);
    if (!stock.st_file_at) throw new Error('ไม่รู้ว่าไฟล์ ST เป็นของเมื่อไหร่ — ไม่อัปเดต');
    const ageH = (Date.now() - new Date(stock.st_file_at).getTime()) / 3600000;
    if (ageH > MAX_ST_AGE_H) throw new Error(`ไฟล์ ST เก่า ${Math.round(ageH)} ชม. (เกิน ${MAX_ST_AGE_H}) — ไม่อัปเดต`);

    const up = await inTab(tab.id, pageApply, [stock.qty, MAX_CHANGE_RATIO, force]);
    if (!up) throw new Error('ขั้นอัปเดตไม่ตอบ');
    result = { ok: !up.error, trigger, started, finished: new Date().toISOString(), stFileAt: stock.st_file_at, counts: stock.counts, products: dl.products, ...up };
  } catch (e) {
    result = { ok: false, trigger, started, finished: new Date().toISOString(), error: String(e.message || e) };
  }
  running = false;
  if (tab?.opened) chrome.tabs.remove(tab.id).catch(() => {});
  chrome.action.setBadgeText({ text: result.ok ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  result.telegram = await report(cfg, result);
  await chrome.storage.local.set({ lastRun: result });
  return result;
}
