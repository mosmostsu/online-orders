// Studio — วางแผนคลิป TikTok/Shopee Video: ตรรกะล้วน (ไม่แตะฐานข้อมูล) ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์
// รัน test: node --test lib/studio.test.mjs

export const STATUSES = [
  { key: 'idea', label: 'ไอเดีย' },
  { key: 'need_footage', label: 'รอฟุต' },
  { key: 'queued', label: 'เข้าคิวตัด' },
  { key: 'cut', label: 'รออนุมัติ' },
  { key: 'approved', label: 'อนุมัติแล้ว' },
  { key: 'posted', label: 'โพสต์แล้ว' },
];
const KEYS = STATUSES.map((s) => s.key);
export const isStatus = (s) => KEYS.includes(s);
export const statusLabel = (k) => (STATUSES.find((s) => s.key === k) || { label: k }).label;
export const nextStatus = (s) => { const i = KEYS.indexOf(s); return i >= 0 && i < KEYS.length - 1 ? KEYS[i + 1] : null; };
export const prevStatus = (s) => { const i = KEYS.indexOf(s); return i > 0 ? KEYS[i - 1] : null; };

// ร้านที่ลงคลิป — ตะกร้าดึงจาก os_listings ของร้านนั้น · PACE ยังไม่มีร้านในระบบ ใส่ลิงก์เอง
export const SHOPS = [
  { key: 'SOLID', platform: 'tiktok', shop: 'SOLID' },
  { key: 'REAL', platform: 'shopee', shop: 'REAL' },
  { key: 'MVP', platform: 'shopee', shop: 'MVP' },
  { key: 'PACE', platform: null, shop: null },
];
export const isShop = (s) => SHOPS.some((x) => x.key === s);

const iso = (d) => d.toISOString().slice(0, 10);
export const todayBkk = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
export function weekDays(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setUTCDate(d.getUTCDate() + i); return iso(x); });
}
export const addDays = (isoDate, n) => { const d = new Date(`${isoDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

const byDateSlot = (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (a.slot || 0) - (b.slot || 0);
export const postQueue = (clips, today) => (clips || []).filter((c) => c.status === 'approved' && String(c.date || '') <= today).sort(byDateSlot);
export const cutQueue = (clips) => (clips || []).filter((c) => c.status === 'queued').sort(byDateSlot);
export const lowFootage = (folders, min = 5) => (folders || []).filter((f) => f.n < min).sort((a, b) => a.n - b.n);
export const captionText = (c) => [c.caption || '', (c.hashtags || []).join(' ')].filter(Boolean).join('\n\n');

// ---- ตะกร้า ----
const G = '(grand|แกรนด์)';
const R = (s) => new RegExp(s, 'i');
const NOT = (s) => ({ not: R(s) });
// โฟลเดอร์ฟุต → คำในชื่อสินค้า (ทุกเงื่อนไขต้องตรง) · โฟลเดอร์ที่ไม่มีในนี้ใช้คำในชื่อรุ่นแทน · "รวม..." ไม่จับคู่
const RULES = {
  'กางเกงวอร์ม/Flyhawk b516-b517': [R('b516|b517')],
  'กางเกงวอร์ม/GrandSport': [R('กางเกงวอร์ม'), R(G), NOT('ขาสั้น')],
  'กางเกงวอร์ม/GrandSport ผ้าร่ม': [R('ผ้าร่ม'), R(G), R('ขายาว')],
  'กางเกงวอร์ม/FBT': [R('กางเกงวอร์ม'), R('fbt')],
  'กางเกงวอร์ม/FBT ผ้าร่ม': [R('ผ้าร่ม'), R('fbt'), R('ขายาว')],
  'กางเกงวอร์ม/Warrix': [R('กางเกงวอร์ม'), R('warrix')],
  'กางเกงวอร์ม/BCS ผ้าร่ม': [R('bcs')],
  'กางเกงบอล-ขาสั้น/Flyhawk b511-b514': [R('flyhawk'), R('b51[1-4]|ขาสั้น')],
  'กางเกงบอล-ขาสั้น/GrandSport': [R('ขาสั้น|กางเกงบอล'), R(G), NOT('ผ้าร่ม')],
  'กางเกงบอล-ขาสั้น/GrandSport ผ้าร่มขาสั้น': [R('ผ้าร่ม'), R('ขาสั้น'), R(G)],
  'กางเกงบอล-ขาสั้น/FBT': [R('กางเกง(บอล|ขาสั้น)'), R('fbt')],
  'กางเกงบอล-ขาสั้น/Warrix': [R('กางเกง(บอล|ขาสั้น)'), R('warrix')],
  'กางเกงบอล-ขาสั้น/Pegan': [R('ขาสั้น'), R('pegan')],
  'เสื้อวอร์ม-แทร็คสูท/GrandSport': [R('เสื้อวอร์ม|แจ็คเก็ต|แทร็ค|ชุดวอร์ม|jacket'), R(G)],
  'เสื้อวอร์ม-แทร็คสูท/Warrix': [R('เสื้อวอร์ม|แจ็คเก็ต|แทร็ค|ชุดวอร์ม|jacket'), R('warrix')],
  'เสื้อโปโล-เสื้อกีฬา/GrandSport': [R('เสื้อ'), R('โปโล|กีฬา'), R(G)],
  'เสื้อโปโล-เสื้อกีฬา/Pegan โปโล': [R('โปโล'), R('pegan')],
  'เสื้อโปโล-เสื้อกีฬา/Warrix เสื้อเชียร์ทีมชาติไทย': [R('warrix'), R('ทีมชาติ')],
  'เสื้อโปโล-เสื้อกีฬา/Warrix โปโล': [R('warrix'), R('โปโล'), NOT('ทีมชาติ')],
  'รองเท้าสตั๊ด-ฟุตซอล/Pan Balancer': [R('balancer')],
  'รองเท้าสตั๊ด-ฟุตซอล/Pan Super Sonic': [R('super ?sonic')],
  'รองเท้าสตั๊ด-ฟุตซอล/Pan Vigor X Thunder': [R('vigor')],
  'รองเท้าสตั๊ด-ฟุตซอล/Pan Wave II': [R('pan'), R('wave')],
  'รองเท้าสตั๊ด-ฟุตซอล/Zeta': [R('zeta')],
  'รองเท้าสตั๊ด-ฟุตซอล/Breaker ฟุตซอล': [R('breaker'), R('ฟุตซอล')],
  'รองเท้าสตั๊ด-ฟุตซอล/GrandSport': [R('สตั๊ด|ฟุตซอล'), R(G)],
  'รองเท้าแบดมินตัน/Pan': [R('แบด'), R('pan')],
  'รองเท้านักเรียน/Breaker': [R('นักเรียน'), R('breaker')],
  'รองเท้านักเรียน/Popteen-Catcha': [R('popteen|catcha')],
  'รองเท้านักเรียน/รองเท้าอนุบาล': [R('อนุบาล')],
  'ถุงมือโกล/Eepro': [R('eepro')],
  'ถุงเท้า-สนับ/ถุงเท้าบอล': [R('ถุงเท้า'), R('บอล')],
  'ลูกบอล/ฟุตบอล-ฟุตซอล': [R('ลูกฟุตบอล|ลูกฟุตซอล|ลูกบอล')],
  'ลูกบอล/วอลเลย์บอล': [R('วอลเลย์')],
  'ไม้แบด-ปิงปอง/ไม้แบด GrandSport': [R('ไม้แบด'), R(G)],
  'ไม้แบด-ปิงปอง/ไม้ปิงปอง GrandSport': [R('ปิงปอง'), R(G)],
};
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function rulesFor(key) {
  if (RULES[key]) return RULES[key];
  const sub = String(key).split('/')[1] || '';
  if (!sub || /รวม|อื่น/.test(sub)) return null;
  return sub.split(/[\s-]+/).filter((w) => w.length > 1).map((w) => R(escRe(w)));
}
export function basketCandidates(key, listings, max = 8) {
  const rs = rulesFor(key);
  if (!rs || !rs.length) return [];
  return (listings || []).filter((x) => rs.every((r) => (r.not ? !r.not.test(x.title || '') : r.test(x.title || '')))).slice(0, max);
}

export function listingUrl(platform, id, shopId) {
  if (platform === 'tiktok') return `https://shop.tiktok.com/view/product/${id}?region=TH`;
  if (platform === 'shopee') return shopId ? `https://shopee.co.th/product/${shopId}/${id}` : '';
  return '';
}

// ตะกร้าของคลิป: ลิงก์ที่ใส่ในคลิปเองก่อน → ตะกร้าของโฟลเดอร์ตามร้านที่ลง → ไม่มี (null)
// listings: { 'platform:shop:product_id': listing }
export function basketOf(clip, folders, listings) {
  if (clip?.basket_url) return { url: clip.basket_url, title: '', thumb_url: '' };
  const b = folders?.[clip?.folder]?.baskets?.[clip?.shop];
  if (!b) return null;
  if (b.url) return { url: b.url, title: '', thumb_url: '' };
  const s = SHOPS.find((x) => x.key === clip.shop);
  const l = s && listings?.[`${b.platform || s.platform}:${s.shop}:${b.id}`];
  if (!l) return b.id ? { id: b.id, url: '', title: '', thumb_url: '' } : null;
  return { ...l, id: l.product_id };
}

// ---- Drive ----
const isVideo = (f) => /^video\//.test(f.mimeType || '');
// cats = โฟลเดอร์หมวด, subs = โฟลเดอร์รุ่น (parents = หมวด), files = ไฟล์ใต้โฟลเดอร์รุ่น → [{key,cat,sub,n,latest,drive_url}]
export function buildFolders(cats, subs, files) {
  const catName = new Map((cats || []).map((c) => [c.id, c.name]));
  const count = new Map(), latest = new Map();
  for (const f of files || []) {
    if (!isVideo(f)) continue;
    for (const p of f.parents || []) {
      count.set(p, (count.get(p) || 0) + 1);
      if (!latest.get(p) || f.modifiedTime > latest.get(p)) latest.set(p, f.modifiedTime);
    }
  }
  const out = [];
  for (const s of subs || []) {
    const cat = catName.get((s.parents || [])[0]);
    if (!cat || cat.startsWith('_')) continue;
    out.push({ key: `${cat}/${s.name}`, cat, sub: s.name, n: count.get(s.id) || 0, latest: latest.get(s.id) || null, drive_url: `https://drive.google.com/drive/folders/${s.id}` });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
