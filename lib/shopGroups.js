// จัดร้านเป็นกลุ่มตามแบรนด์ร้าน (ไม่ใช่ตามแพลตฟอร์ม) — SOLID / REAL / MVP
// ThisShop คือหน้าร้านเว็บของ REAL (ร้านเดียวชื่อ THISSHOP) จึงอยู่กลุ่ม REAL
// ใช้กับแถบเลือกร้านทุกหน้า (ดู app/ShopBar.js) ให้หน้าตาและลำดับตรงกันทั้งเว็บ
export const GROUP_ORDER = ['SOLID', 'REAL', 'MVP'];
const PLATFORM_ORDER = ['shopee', 'tiktok', 'lazada', 'thaimart', 'thisshop'];

export const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop', thaimart: 'Thaimart' };

// แถบร้านจัดกลุ่มได้ 2 แบบ: 'shop' = ตามร้าน (SOLID / REAL / MVP) · 'platform' = ตามแพลตฟอร์ม (Shopee / TikTok / ...)
// จำค่าที่เลือกไว้ในคุกกี้ (ดู app/ShopGroupToggle.js) ใช้ร่วมกันทุกหน้า
export const GROUP_COOKIE = 'shopgroup';

export function shopGroup(platform, shop) {
  return platform === 'thisshop' ? 'REAL' : String(shop || '').toUpperCase();
}

const groupRank = (g) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
const platformRank = (p) => (PLATFORM_ORDER.includes(p) ? PLATFORM_ORDER.indexOf(p) : PLATFORM_ORDER.length);

// แบบแพลตฟอร์ม: [{ group: platform, platform, items }] เรียงแพลตฟอร์มตาม PLATFORM_ORDER
// ในกลุ่มเรียงร้านตาม SOLID, REAL, MVP — mode อื่นนอกจาก 'platform' ใช้แบบร้านเดิม
export function groupShopsBy(items, mode = 'shop') {
  if (mode !== 'platform') return groupShops(items);
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.platform)) map.set(it.platform, []);
    map.get(it.platform).push(it);
  }
  return [...map.entries()]
    .sort(([a], [b]) => platformRank(a) - platformRank(b) || a.localeCompare(b))
    .map(([platform, list]) => ({
      group: platform, platform,
      items: list.sort((a, b) => groupRank(shopGroup(a.platform, a.shop)) - groupRank(shopGroup(b.platform, b.shop))
        || String(a.shop).localeCompare(String(b.shop))),
    }));
}

// items = [{ platform, shop, ... }] → [{ group, items: [...] }] เรียง SOLID, REAL, MVP แล้วกลุ่มอื่นต่อท้าย
export function groupShops(items) {
  const map = new Map();
  for (const it of items) {
    const g = shopGroup(it.platform, it.shop);
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(it);
  }
  const rank = (g) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
  const prank = (p) => (PLATFORM_ORDER.includes(p) ? PLATFORM_ORDER.indexOf(p) : PLATFORM_ORDER.length);
  return [...map.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([group, list]) => ({ group, items: list.sort((a, b) => prank(a.platform) - prank(b.platform)) }));
}
