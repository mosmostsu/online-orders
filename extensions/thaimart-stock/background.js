// อัปเดตคลัง Thaimart (กดปุ่มเอง) — ทำงานใน Chrome โปรไฟล์ที่ล็อกอิน seller.thaimart.com ของร้าน Solid Sports ไว้
//
// Thaimart ไม่มี API สาธารณะ แต่หน้า Seller Center เรียก API หลังบ้าน (seller-bff.marketplus.dev) ด้วยคุกกี้ accessToken
// ส่วนขยายทำแบบเดียวกันจากในแท็บ (ไม่เก็บโทเคนไว้ที่ไหน):
//   1. ดึงสินค้าทั้งร้าน      GET /api/v1/seller/products?page=N&limit=100   (ได้ variants[] พร้อม sku, quantity)
//      จำนวนที่ขายได้จริง = remainingQuantity · quantity คือ stockedQuantity (รวมที่ขายไปแล้ว soldQuantity)
//      PUT ส่ง quantity = จำนวนที่ขายได้ แล้วหลังบ้านบวก sold กลับเข้า quantity เอง (พิสูจน์ 2026-10-16: ส่ง 19 ได้ quantity 20, remaining 19, sold 1)
//   2. ขอจำนวนจากเว็บ order-sync (ST − ออเดอร์รอส่งที่สั่งหลังไฟล์ ST)  POST /api/mvp/stock
//   2b. ขอราคาจากไฟล์ DC (ราคาลด ถ้าไม่มีใช้ราคาเต็ม)  POST /api/thaimart/price — ติ๊กปิดได้ในหน้าต่างส่วนขยาย
//       Thaimart ยังไม่มีระบบส่วนลด ผู้ใช้สั่ง 2026-10-16 ให้ลงราคาตาม DC ไปก่อน
//   3. สินค้าที่จำนวน/ราคาเปลี่ยน → GET สดอีกรอบ แก้เฉพาะ quantity/price → PUT /api/v1/shops/products/{id}
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
const PARALLEL = 4;   // บันทึกพร้อมกันกี่ตะกร้า
const MAX_DC_AGE_H = 24 * 7;   // ราคาเปลี่ยนไม่บ่อย ไฟล์ DC เก่าเกินสัปดาห์ค่อยไม่ใช้
// ราคาใหม่ต่างจากเดิมเกินช่วงนี้ = น่าจะผิด (รหัสชนกัน/DC พิมพ์ผิด) ไม่เปลี่ยน แจ้งให้คนดู
const PRICE_MIN_RATIO = 0.5, PRICE_MAX_RATIO = 2;

// ความคืบหน้าของรอบที่ทำอยู่ เก็บใน storage ให้หน้าต่างส่วนขยายอ่าน (ปิดแล้วเปิดใหม่ก็ยังเห็น)
// service worker เพิ่งตื่น = ไม่มีรอบไหนทำอยู่ ค่าที่ค้างจากรอบที่ตายกลางทางทิ้งได้
chrome.storage.local.remove('progress');
chrome.action.setBadgeText({ text: '' });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'run') { run('manual', { force: !!msg.force, withPrice: msg.price !== false }).then(reply); return true; }
  // หน้าต่างส่วนขยายถามตอนเปิด — background ที่เพิ่งตื่น = ไม่มีรอบไหนทำงานอยู่ (ความคืบหน้าที่ค้างใน storage เป็นของรอบที่ตายไปแล้ว)
  if (msg?.type === 'status') { reply({ running }); return false; }
  // โคลนตะกร้า TikTok SOLID → Thaimart — สั่งจากหน้า /compare ของ order-sync ผ่าน content-bridge.js
  if (msg?.type === 'clone') { cloneRun(msg).then(reply); return true; }
  if (msg?.type === 'clone-delete-test') { deleteTests().then(reply); return true; }
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
    if (!r.ok || !j || j.status?.code !== 0) return { status: r.status, error: `ดึงรายการสินค้าไม่สำเร็จ (${r.status}) — อาจหลุดการล็อกอิน` };
    all.push(...(j.data || []));
    if (!j.pagination?.hasNext) break;
  }
  if (!all.length) return { error: 'ร้านนี้ไม่มีสินค้า' };
  const wrong = all.find((p) => p.shop?.id && p.shop.id !== shopId);
  if (wrong) return { error: `ร้านไม่ตรง: ได้ shop ${wrong.shop.id} (ต้องเป็น ${shopId}) — โปรไฟล์นี้ล็อกอินร้านอื่นอยู่` };
  globalThis.__tm = { tok, base, all };
  globalThis.__tmProg = null;
  const rows = [];
  for (const p of all) for (const v of p.variants || []) if (v.sku) rows.push({ pid: p.id, sku: String(v.sku).trim(), cur: Number(v.remainingQuantity ?? v.quantity) || 0 });
  // รายการสินค้าแบบย่อ ส่งเข้า order-sync ให้หน้า /product และ /allsite (ดู /api/thaimart/listings)
  // รูปตัวเลือก: Thaimart เก็บรูปไว้ที่ options[].valueImages (ตามค่าของตัวเลือกชั้นแรก)
  const listing = all.map((p) => {
    const img = {};
    for (const o of p.options || []) for (const vi of o.valueImages || []) if (vi?.value) img[vi.value] = vi.image?.url || null;
    return {
      id: p.id, title: p.name, thumb: p.imageUrl || p.images?.[0]?.url || null, status: p.status,
      created: p.createdAt || null, updated: p.updatedAt || null,
      variants: (p.variants || []).map((v) => ({
        id: v.id, sku: v.sku, variant: (v.attributes || []).map((a) => a.value).join(' / '),
        price: v.price, stock: v.remainingQuantity ?? v.quantity, image: img[v.attributes?.[0]?.value] || null,
      })),
    };
  });
  return { products: all.length, rows: rows.length, skus: [...new Set(rows.map((x) => x.sku))], listing };
}

// ไม่รอให้บันทึกเสร็จในคำสั่งเดียว: Chrome ฆ่า service worker ถ้าคำสั่งเดียวรอนานเกิน 5 นาที
// (รอบแรก ~300 ตะกร้าเกินแน่) → เริ่มงานในแท็บแล้วคืนทันที ผลไปอยู่ที่ globalThis.__tmDone ให้ background มาถามทีละวินาที
// price = { sku: ราคาจาก DC | null } หรือ null = รอบนี้ไม่แตะราคา
function pageApply(qty, price, maxRatio, force, parallel, priceRange) {
  globalThis.__tmDone = null;
  (async () => {
  const st = globalThis.__tm;
  if (!st) return { error: 'ไม่มีข้อมูลจากขั้นดึงสินค้า (หน้าถูกรีเฟรชระหว่างทำงาน)' };
  const { tok, base, all } = st;
  const H = { authorization: 'Bearer ' + tok };
  const changes = [], missingList = [], priceChanges = [], priceOdd = [];
  let up = 0, down = 0, missing = 0, missingWithStock = 0, total = 0, priceMissing = 0;
  const todo = new Map();      // product id → { sku: { q?: จำนวนใหม่, p?: ราคาใหม่ } }
  const mark = (pid, sku, k, n) => {
    if (!todo.has(pid)) todo.set(pid, {});
    const t = todo.get(pid);
    (t[sku] ||= {})[k] = n;
  };
  for (const p of all) {
    for (const v of p.variants || []) {
      if (!v.sku) continue;
      total++;
      const sku = String(v.sku).trim();
      const name = String(p.name || '').slice(0, 60);
      const opt = (v.attributes || []).map((a) => a.value).join('/');
      if (price) {
        const pw = price[sku];
        const pc = Number(v.price) || 0;
        if (!pw) priceMissing++;
        else if (Math.abs(pw - pc) >= 0.005) {
          // ราคาเดิม 0/ว่าง ถือว่าต้องใส่ · ต่างเกินช่วง = น่าจะผิด ไม่เปลี่ยน
          if (pc > 0 && (pw < pc * priceRange[0] || pw > pc * priceRange[1])) priceOdd.push([sku, pc, pw, name, opt]);
          else { priceChanges.push([sku, pc, pw, name, opt]); mark(p.id, sku, 'p', pw); }
        }
      }
      const want = qty[sku];
      const cur = Number(v.remainingQuantity ?? v.quantity) || 0;
      if (want === null || want === undefined) {
        missing++;
        if (cur > 0) { missingWithStock++; missingList.push([sku, cur]); }
        continue;
      }
      if (want !== cur) {
        // [sku, เดิม, ใหม่, ชื่อสินค้า, ตัวเลือก] — เว็บรายงานใช้ 3 ตัวแรก ที่เหลือไว้โชว์ในส่วนขยายและ Telegram
        changes.push([sku, cur, want, name, opt]);
        if (want > cur) up++; else down++;
        mark(p.id, sku, 'q', want);
      }
    }
  }
  const changed = up + down;
  const baseRes = {
    rows: total, changed, up, down, missing, missingWithStock, changes, missingList,
    ...(price ? { priceChanged: priceChanges.length, priceChanges, priceOdd, priceMissing } : {}),
  };
  if (!todo.size) return { ok: true, ...baseRes };
  // กันพลาดนับเฉพาะจำนวน — ราคารอบแรกเปลี่ยนเกือบทั้งร้านเป็นเรื่องปกติ (เดิมลงราคาเต็มจาก TikTok)
  if (!force && changed > total * maxRatio) {
    return { ...baseRes, error: `จะเปลี่ยน ${changed} จาก ${total} ตัวเลือก เยอะผิดปกติ — ไม่อัปเดต ตรวจไฟล์ ST ก่อน (รอบแรกให้ติ๊ก "ครั้งแรก")` };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // โดน 429/503 (ส่งถี่ไป) → รอแล้วลองใหม่ สูงสุด 3 ครั้ง · คำขอที่โดนปัดไม่ถูกบันทึก ลองซ้ำได้ปลอดภัย
  async function req(url, opts) {
    for (let i = 0; ; i++) {
      // หลังบ้านไม่ตอบ 30 วิ = ตัดทิ้ง ตะกร้านั้นนับว่าพลาด (ไม่ให้ทั้งรอบแขวนค้าง)
      // โทเคนในคุกกี้อายุ ~15 นาที — อ่านใหม่ทุกคำขอ (เผื่อหน้าเว็บต่ออายุให้ระหว่างรอบ) ไม่ใช้ตัวที่อ่านไว้ตอนเริ่ม
      const fresh = decodeURIComponent((document.cookie.match(/(?:^|;\s*)accessToken=([^;]+)/) || [])[1] || '');
      const headers = { ...(opts?.headers || {}), ...(fresh ? { authorization: 'Bearer ' + fresh } : {}) };
      const r = await fetch(url, { ...opts, headers, signal: AbortSignal.timeout(30000) });
      if ((r.status !== 429 && r.status !== 503) || i >= 3) return r;
      const ra = Number(r.headers.get('retry-after'));
      await sleep(ra > 0 ? ra * 1000 : 1000 * 2 ** i);
    }
  }
  let okProducts = 0;
  const failed = [];
  const jobs = [...todo];
  let next = 0, done = 0;
  // ความคืบหน้า — background อ่านค่านี้ทุกวินาทีไปโชว์ในส่วนขยาย
  globalThis.__tmProg = { done: 0, total: jobs.length, failed: 0 };
  async function saveOne(pid, want) {
    // GET สดก่อนทุกครั้ง กันทับการแก้ไขอื่นที่เกิดระหว่างรอบ
    const gr = await req(`${base}/shops/products/${pid}`, { headers: H });
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
          const w = want[String(v.sku || '').trim()] || {};
          return {
            id: v.id, sku: v.sku, price: String(w.p ?? v.price), quantity: w.q ?? v.remainingQuantity ?? v.quantity, weight: v.weight, attributes: v.attributes,
          };
        }),
      },
    };
    const pr = await req(`${base}/shops/products/${pid}`, {
      method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const pj = await pr.json().catch(() => null);
    if (!pr.ok || pj?.status?.code !== 0) throw new Error(`PUT ${pr.status} ${pj?.status?.description || ''}`);
    // เทียบตัวเลขที่ตอบกลับกับที่ขอ
    const back = new Map((pj.data?.variants || []).map((v) => [String(v.sku || '').trim(), v]));
    for (const [k, w] of Object.entries(want)) {
      const b = back.get(k);
      if (!b) continue;
      const bq = b.remainingQuantity ?? b.quantity;
      if (w.q !== undefined && Number(bq) !== w.q) throw new Error(`ตอบกลับ ${k} จำนวน ${bq} ไม่ตรงที่ขอ ${w.q}`);
      if (w.p !== undefined && Math.abs(Number(b.price) - w.p) >= 0.005) throw new Error(`ตอบกลับ ${k} ราคา ${b.price} ไม่ตรงที่ขอ ${w.p}`);
    }
  }
  // ส่งพร้อมกันทีละ `parallel` ตะกร้า (แต่ละตะกร้ายัง GET → PUT ตามลำดับเหมือนเดิม)
  async function worker() {
    while (next < jobs.length) {
      const [pid, want] = jobs[next++];
      try {
        await saveOne(pid, want);
        okProducts++;
      } catch (e) {
        failed.push([pid, String(e.message || e).slice(0, 120)]);
      }
      done++;
      globalThis.__tmProg = { done, total: jobs.length, failed: failed.length };
      // ไม่พักด้วย setTimeout ระหว่างตะกร้า: แท็บ Seller Center มักอยู่เบื้องหลัง Chrome หน่วง timer ของแท็บเบื้องหลัง
      // เหลือ ~นาทีละครั้ง (intensive throttling) เดิมพัก 150ms ทีละตะกร้า → รอบที่ควรเสร็จใน 1 นาทีค้างเป็นชั่วโมง
      // จังหวะส่งคุมด้วยจำนวนพร้อมกัน (parallel) อยู่แล้ว · โดน 429/503 ค่อยถอยใน req()
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker));
  globalThis.__tm = null;
  const out = { ...baseRes, upload: { total: todo.size, success: okProducts }, failed };
  if (failed.length) out.error = `บันทึกไม่สำเร็จ ${failed.length}/${todo.size} สินค้า (ตัวอย่าง: ${failed[0][0]} — ${failed[0][1]})`;
  else out.ok = true;
  return out;
  })().then((r) => { globalThis.__tmDone = r; }, (e) => { globalThis.__tmDone = { error: String(e?.message || e) }; });
  return true;
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
// ขอราคาจาก DC — พังหรือไฟล์เก่าก็ยังอัปเดตจำนวนต่อได้ (แค่ไม่แตะราคารอบนี้) คืน { price, fileAt, counts } หรือ { error }
async function fetchPrices(cfg, skus) {
  try {
    const res = await fetch(`${cfg.base}/api/thaimart/price`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-key': cfg.key }, body: JSON.stringify({ skus }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await res.json().catch(() => ({ ok: false, error: `เว็บ order-sync ตอบ ${res.status}` }));
    if (!j.ok) return { error: 'ขอราคาไม่สำเร็จ: ' + j.error };
    const ageH = (Date.now() - new Date(j.dc_file_at).getTime()) / 3600000;
    if (!(ageH <= MAX_DC_AGE_H)) return { error: `ไฟล์ DC เก่า ${Math.round(ageH)} ชม. — ไม่แตะราคารอบนี้`, fileAt: j.dc_file_at };
    return { price: j.price, fileAt: j.dc_file_at, counts: j.counts };
  } catch (e) {
    return { error: 'ขอราคาไม่สำเร็จ: ' + String(e.message || e) };
  }
}

async function run(trigger, { force = false, withPrice = true } = {}) {
  if (running) return { ok: false, error: 'กำลังทำงานอยู่แล้ว' };
  running = true;
  chrome.action.setBadgeText({ text: '…' });
  const started = new Date().toISOString();
  let result;
  let tab = null;
  let dl = null;
  let newQty = null;
  let newPrice = null;
  let pr = null;
  const cfg = await settings();
  // ความคืบหน้า: ขั้นที่ทำอยู่ + (ตอนบันทึก) done/total — ปิดหน้าต่างส่วนขยายแล้วเปิดใหม่ก็ยังเห็น
  const step = (text, prog) => chrome.storage.local.set({ progress: { text, ...prog, started } }).catch(() => {});
  try {
    if (!cfg.key) throw new Error('ยังไม่ได้ใส่กุญแจ (MVP_STOCK_KEY) ในหน้าตั้งค่าของส่วนขยาย');
    // header ต้องเป็น ASCII — กุญแจที่พิมพ์ตอนคีย์บอร์ดเป็นภาษาไทย/วางผิด ทำให้ fetch พังด้วยข้อความที่อ่านไม่รู้เรื่อง
    if (/[^\x21-\x7e]/.test(cfg.key)) throw new Error('กุญแจมีอักขระที่ไม่ใช่ภาษาอังกฤษ/ตัวเลข (หรือมีช่องว่าง) — เปิดตั้งค่าแล้ววางกุญแจ MVP_STOCK_KEY ใหม่ให้ตรงกับ Netlify');
    step('เปิดหน้า Seller Center');
    tab = await sellerTab();
    step('ดึงรายการสินค้าทั้งร้าน');
    // โทเคนในคุกกี้อายุ ~15 นาที แท็บที่เปิดค้างไว้นานจะได้ 401 → โหลดหน้าใหม่ให้หน้าเว็บต่ออายุเอง แล้วลองอีกครั้ง
    dl = await inTabAuth(tab, pageList, [SHOP_ID]);
    if (!dl || dl.error) throw new Error(dl?.error || 'ขั้นดึงสินค้าไม่ตอบ');

    step(`ขอจำนวนจาก ST (${dl.skus.length} SKU)`);
    const res = await fetch(`${cfg.base}/api/mvp/stock`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-key': cfg.key }, body: JSON.stringify({ skus: dl.skus }),
      signal: AbortSignal.timeout(60000),
    });
    const stock = await res.json().catch(() => ({ ok: false, error: `เว็บ order-sync ตอบ ${res.status}` }));
    if (!stock.ok) throw new Error('ขอคลังไม่สำเร็จ: ' + stock.error);
    if (!stock.st_file_at) throw new Error('ไม่รู้ว่าไฟล์ ST เป็นของเมื่อไหร่ — ไม่อัปเดต');
    const ageH = (Date.now() - new Date(stock.st_file_at).getTime()) / 3600000;
    if (ageH > MAX_ST_AGE_H) throw new Error(`ไฟล์ ST เก่า ${Math.round(ageH)} ชม. (เกิน ${MAX_ST_AGE_H}) — ไม่อัปเดต`);

    if (withPrice) {
      step('ขอราคาจากไฟล์ DC');
      pr = await fetchPrices(cfg, dl.skus);
    }

    step(pr?.price ? 'เทียบจำนวนกับ ST + ราคากับ DC' : 'เทียบตัวเลขกับ ST');
    if (!(await inTab(tab.id, pageApply, [stock.qty, pr?.price || null, MAX_CHANGE_RATIO, force, PARALLEL, [PRICE_MIN_RATIO, PRICE_MAX_RATIO]]))) throw new Error('ขั้นอัปเดตไม่ตอบ');
    // ถามแท็บทุกวินาทีจนเสร็จ → ป้ายบนไอคอน (%) + หน้าต่างส่วนขยาย
    let up = null;
    let lastDone = -1, lastMove = Date.now();
    while (!up) {
      await new Promise((r) => setTimeout(r, 1000));
      const s = await inTab(tab.id, () => ({ done: globalThis.__tmDone, prog: globalThis.__tmProg, alive: Boolean(globalThis.__tm) }), []).catch(() => null);
      if (s?.done) { up = s.done; break; }
      if (!s || !s.alive) throw new Error('แท็บ Seller Center ถูกรีเฟรช/ปิดระหว่างบันทึก — รอบนี้หยุดกลางทาง กดใหม่ได้');
      const p = s.prog;
      if (!p?.total) continue;
      if (p.done !== lastDone) { lastDone = p.done; lastMove = Date.now(); }
      if (Date.now() - lastMove > 180000) throw new Error(`ค้างที่ ${p.done}/${p.total} สินค้าเกิน 3 นาที — หลังบ้าน Thaimart ไม่ตอบ`);
      step(`บันทึกเข้า Thaimart ${p.done}/${p.total} สินค้า` + (p.failed ? ` (พลาด ${p.failed})` : ''), p);
      chrome.action.setBadgeText({ text: `${Math.floor((p.done * 100) / p.total)}%` });
    }
    if (!up.error) {   // บันทึกผ่านแล้ว รายการสินค้าที่ส่งเข้า order-sync ใช้คลัง/ราคาใหม่
      newQty = stock.qty;
      newPrice = Object.fromEntries((up.priceChanges || []).map(([s, , n]) => [s, n]));
    }
    result = {
      ok: !up.error, trigger, started, finished: new Date().toISOString(), stFileAt: stock.st_file_at, counts: stock.counts, products: dl.products, ...up,
      ...(withPrice ? { dcFileAt: pr?.fileAt || null, priceError: pr?.error || null } : { priceOff: true }),
    };
  } catch (e) {
    result = { ok: false, trigger, started, finished: new Date().toISOString(), error: String(e.message || e) };
  }
  // ส่งรายการสินค้าเข้า order-sync — พังก็ไม่ให้รอบนี้นับว่าพัง แค่บันทึกไว้ในผล
  if (dl?.listing?.length && cfg.key) {
    step('ส่งรายการสินค้าเข้า order-sync');
    try {
      const products = dl.listing.map((p) => ({
        ...p,
        variants: p.variants.map((v) => {
          const k = String(v.sku || '').trim();
          const n = newQty?.[k];
          const pn = newPrice?.[k];
          return { ...v, ...(n === null || n === undefined ? {} : { stock: n }), ...(pn ? { price: pn } : {}) };
        }),
      }));
      const res = await fetch(`${cfg.base}/api/thaimart/listings`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-key': cfg.key }, body: JSON.stringify({ products }),
        signal: AbortSignal.timeout(60000),   // เว็บไม่ตอบ = ข้าม ไม่ให้รอบค้างตลอดไป (เคยค้างขั้นนี้ 41 ชม.)
      });
      const j = await res.json().catch(() => ({ ok: false, error: `เว็บ order-sync ตอบ ${res.status}` }));
      result.listings = j.ok ? { saved: j.listings, removed: j.removed } : { error: j.error };
    } catch (e) {
      result.listings = { error: String(e.message || e) };
    }
  }
  running = false;
  if (tab?.opened) chrome.tabs.remove(tab.id).catch(() => {});
  chrome.action.setBadgeText({ text: result.ok ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  step('ส่งรายงานเข้า Telegram');
  result.telegram = await report(cfg, result);
  await chrome.storage.local.set({ lastRun: result });
  await chrome.storage.local.remove('progress');
  return result;
}


// ── โคลน TikTok SOLID → Thaimart (สร้างตะกร้าใหม่ — ไม่แตะตะกร้าที่มีอยู่แล้ว) ─────────────────
// order-sync เตรียมก้อนสินค้า (POST /api/thaimart/clone) แบบเดียวกับที่หน้า "อัปโหลดสินค้า (Excel)" ของ Thaimart ส่ง
// ส่วนขยายส่งก้อนนั้นจากแท็บ Seller Center: POST /seller/products/batch { products } (สร้างแบบ "ยังไม่วางขาย")
// สร้างเสร็จแบบไม่ทันที (หลังบ้านทยอยสร้าง) → ไล่หาด้วย SKU จนครบ แล้วเผยแพร่: PATCH /seller/products/status
// กันซ้ำสองชั้น: order-sync ตรวจจากฐานข้อมูล + ส่วนขยายตรวจ SKU สดจาก Thaimart อีกรอบก่อนส่ง
// ทดสอบ (test): [TEST] + SKU -TEST + จำนวน 0 · ไม่เผยแพร่ · ลบด้วย deleteTests (เปลี่ยนสถานะเป็นลบสินค้า)
const CLONE_IDS_PER_CALL = 25;     // ตะกร้าต่อคำขอ order-sync (เพดานเวลา Netlify)
const CLONE_MAX_ROWS = 400;        // ตัวเลือกต่อคำขอ batch ของ Thaimart (หน้าเว็บจำกัด 500 แถวต่อไฟล์)

// รันในแท็บ: คืน { status, json } — ใช้โทเคนจากคุกกี้ของหน้า
async function pageFetch(path, method, body) {
  const tok = decodeURIComponent((document.cookie.match(/(?:^|;\s*)accessToken=([^;]+)/) || [])[1] || '');
  if (!tok) return { status: 0, json: null, error: 'ไม่ได้ล็อกอิน Seller Center' };
  const r = await fetch(`https://seller-bff.marketplus.dev/api/v1${path}`, {
    method, headers: { authorization: 'Bearer ' + tok, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

// รันในแท็บ: สินค้าทั้งร้านแบบย่อ [{ id, name, status, skus }]
async function pageAllProducts(shopId) {
  const tok = decodeURIComponent((document.cookie.match(/(?:^|;\s*)accessToken=([^;]+)/) || [])[1] || '');
  if (!tok) return { status: 0, error: 'ไม่ได้ล็อกอิน Seller Center' };
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(`https://seller-bff.marketplus.dev/api/v1/seller/products?page=${page}&limit=100`, { headers: { authorization: 'Bearer ' + tok } });
    const j = await r.json().catch(() => null);
    if (!r.ok || j?.status?.code !== 0) return { status: r.status, error: `ดึงรายการสินค้าไม่สำเร็จ (${r.status})` };
    for (const p of j.data || []) {
      if (p.shop?.id && p.shop.id !== shopId) return { status: 200, error: `ร้านไม่ตรง: ${p.shop.id} (ต้องเป็น ${shopId})` };
      out.push({ id: p.id, name: p.name, status: p.status, skus: (p.variants || []).map((v) => String(v.sku || '').trim()).filter(Boolean) });
    }
    if (!j.pagination?.hasNext) break;
  }
  return { status: 200, products: out };
}

// เรียกในแท็บ ถ้าโทเคนหมดอายุ (401) → โหลดหน้าใหม่ให้หน้าเว็บต่ออายุเอง แล้วลองอีกครั้ง
async function inTabAuth(tab, func, args) {
  let r = await inTab(tab.id, func, args);
  if (r?.status === 401) {
    await chrome.tabs.reload(tab.id);
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 30000);
      function on(id, info) { if (id === tab.id && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); resolve(); } }
      chrome.tabs.onUpdated.addListener(on);
    });
    await new Promise((x) => setTimeout(x, 2500));
    r = await inTab(tab.id, func, args);
  }
  return r;
}

async function cloneRun({ ids = [], test = false, base = null }) {
  if (running) return { ok: false, error: 'ส่วนขยายกำลังทำงานอื่นอยู่ — รอให้เสร็จก่อน' };
  running = true;
  const started = new Date().toISOString();
  const cfg = await settings();
  const api = (base || cfg.base).replace(/\/+$/, '');
  const step = (text, prog) => chrome.storage.local.set({ cloneProgress: { text, ...prog, started } }).catch(() => {});
  let tab = null;
  const result = { ok: false, test, started, created: [], published: 0, notFound: [], skipped: [], warnings: [] };
  try {
    ids = [...new Set(ids.map(String))].filter((x) => /^\d+$/.test(x));
    if (!ids.length) throw new Error('ยังไม่ได้เลือกตะกร้า');
    step('เปิดหน้า Seller Center');
    tab = await sellerTab();

    // SKU ที่มีใน Thaimart ตอนนี้ (สด) — กันสร้างซ้ำแม้ฐานข้อมูลของ order-sync ยังไม่อัปเดต
    step('อ่านสินค้าที่มีใน Thaimart ตอนนี้');
    const before = await inTabAuth(tab, pageAllProducts, [SHOP_ID]);
    if (!before?.products) throw new Error(before?.error || 'อ่านสินค้า Thaimart ไม่ได้');
    const live = new Set(before.products.flatMap((p) => p.skus.map((s) => s.toLowerCase())));

    // เตรียมก้อนสินค้าจาก order-sync ทีละ 25 ตะกร้า
    const ready = [];
    for (let i = 0; i < ids.length; i += CLONE_IDS_PER_CALL) {
      step(`เตรียมข้อมูลจาก TikTok ${Math.min(i + CLONE_IDS_PER_CALL, ids.length)}/${ids.length} ตะกร้า`, { done: i, total: ids.length });
      const res = await fetch(`${api}/api/thaimart/clone`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ids.slice(i, i + CLONE_IDS_PER_CALL), test }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `order-sync ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(`เตรียมข้อมูลไม่สำเร็จ: ${j.error}`);
      result.skipped.push(...j.skipped);
      result.warnings.push(...j.warnings);
      for (const x of j.products) {
        const clash = x.product.variants.map((v) => v.sku).filter((s) => s && live.has(s.toLowerCase()));
        if (clash.length) result.skipped.push({ id: x.id, title: x.title, why: `Thaimart มี SKU นี้แล้ว (${clash.slice(0, 3).join(', ')}) — ไม่สร้างซ้ำ` });
        else ready.push(x);
      }
    }
    if (!ready.length) { result.ok = true; result.note = 'ไม่มีตะกร้าที่ต้องสร้าง'; return result; }

    // ส่งเข้า Thaimart เป็นชุด (ตัวเลือกรวม ≤ CLONE_MAX_ROWS ต่อชุด)
    const batches = [];
    let cur = [], rows = 0;
    for (const x of ready) {
      if (cur.length && rows + x.product.variants.length > CLONE_MAX_ROWS) { batches.push(cur); cur = []; rows = 0; }
      cur.push(x); rows += x.product.variants.length;
    }
    if (cur.length) batches.push(cur);
    const sent = [];
    for (let b = 0; b < batches.length; b++) {
      step(`ส่งเข้า Thaimart ชุด ${b + 1}/${batches.length}`, { done: b, total: batches.length });
      const r = await inTabAuth(tab, pageFetch, ['/seller/products/batch', 'POST', { products: batches[b].map((x) => ({ shopId: SHOP_ID, ...x.product })) }]);
      if (r?.status !== 200 || r.json?.status?.code !== 0) {
        result.skipped.push(...batches[b].map((x) => ({ id: x.id, title: x.title, why: `Thaimart ไม่รับ (${r?.status}) ${r?.json?.status?.description || r?.error || ''}`.trim() })));
        continue;
      }
      sent.push(...batches[b]);
    }

    // หลังบ้านทยอยสร้าง — ไล่หาด้วย SKU (สูงสุด ~2 นาที)
    const want = new Map(sent.map((x) => [x.id, x]));
    const found = new Map();
    for (let t = 0; t < 12 && found.size < want.size; t++) {
      step(`รอ Thaimart สร้างสินค้า ${found.size}/${want.size}`, { done: found.size, total: want.size });
      await new Promise((x) => setTimeout(x, 10000));
      const now = await inTabAuth(tab, pageAllProducts, [SHOP_ID]);
      if (!now?.products) continue;
      const bySku = new Map();
      for (const p of now.products) for (const s of p.skus) bySku.set(s.toLowerCase(), p);
      for (const [id, x] of want) {
        if (found.has(id)) continue;
        const k = x.product.variants.map((v) => v.sku).find(Boolean);
        const p = k ? bySku.get(k.toLowerCase()) : now.products.find((q) => q.name === x.product.name);
        if (p) found.set(id, p);
      }
    }
    result.created = [...found].map(([id, p]) => ({ id, thaimartId: p.id, name: p.name }));
    result.notFound = [...want.keys()].filter((id) => !found.has(id)).map((id) => ({ id, title: want.get(id).title }));

    // เผยแพร่ (ทดสอบไม่เผยแพร่)
    if (!test && found.size) {
      step(`เผยแพร่ ${found.size} สินค้า`);
      const r = await inTabAuth(tab, pageFetch, ['/seller/products/status', 'PATCH', { productIds: [...found.values()].map((p) => p.id), status: 'PRODUCT_STATUS_PUBLISHED' }]);
      if (r?.status === 200 && r.json?.status?.code === 0) result.published = found.size;
      else result.warnings.push({ id: '-', title: 'เผยแพร่', notes: [`เผยแพร่ไม่สำเร็จ (${r?.status}) — สินค้าอยู่ในแท็บ "ยังไม่วางขาย" กดเผยแพร่เองได้`] });
    }

    // ส่งรายการสินค้าใหม่เข้า order-sync ให้หน้า /compare เห็นทันที (ต้องมีกุญแจ)
    if (!test && found.size && cfg.key) {
      step('อัปเดตรายการสินค้าเข้า order-sync');
      try {
        const dl = await inTab(tab.id, pageList, [SHOP_ID]);
        if (dl?.listing?.length) {
          const res = await fetch(`${api}/api/thaimart/listings`, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-key': cfg.key }, body: JSON.stringify({ products: dl.listing }),
          });
          const j = await res.json().catch(() => ({}));
          result.listings = j.ok ? { saved: j.listings } : { error: j.error || `ตอบ ${res.status}` };
        }
      } catch (e) { result.listings = { error: String(e.message || e) }; }
    }
    result.ok = true;
  } catch (e) {
    result.error = String(e.message || e);
  } finally {
    running = false;
    if (tab?.opened) chrome.tabs.remove(tab.id).catch(() => {});
    await chrome.storage.local.remove('cloneProgress');
    result.finished = new Date().toISOString();
    await chrome.storage.local.set({ lastClone: result });
  }
  return result;
}

// ลบสินค้าทดสอบ — เฉพาะตะกร้าที่ชื่อขึ้นต้น [TEST] และทุก SKU ลงท้าย -TEST (เปลี่ยนสถานะเป็นลบสินค้า)
async function deleteTests() {
  if (running) return { ok: false, error: 'ส่วนขยายกำลังทำงานอื่นอยู่' };
  running = true;
  let tab = null;
  try {
    tab = await sellerTab();
    const all = await inTabAuth(tab, pageAllProducts, [SHOP_ID]);
    if (!all?.products) throw new Error(all?.error || 'อ่านสินค้าไม่ได้');
    const tests = all.products.filter((p) => String(p.name || '').startsWith('[TEST]') && p.skus.length && p.skus.every((s) => s.endsWith('-TEST'))
      && p.status !== 'PRODUCT_STATUS_DELETED');
    if (!tests.length) return { ok: true, deleted: 0 };
    const r = await inTabAuth(tab, pageFetch, ['/seller/products/status', 'PATCH', { productIds: tests.map((p) => p.id), status: 'PRODUCT_STATUS_DELETED' }]);
    if (r?.status !== 200 || r.json?.status?.code !== 0) throw new Error(`ลบไม่สำเร็จ (${r?.status}) ${r?.json?.status?.description || ''}`);
    return { ok: true, deleted: tests.length, names: tests.map((p) => p.name) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    running = false;
    if (tab?.opened) chrome.tabs.remove(tab.id).catch(() => {});
  }
}
