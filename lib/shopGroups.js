// จัดร้านเป็นกลุ่มตามแบรนด์ร้าน (ไม่ใช่ตามแพลตฟอร์ม) — SOLID / REAL / MVP
// ThisShop คือหน้าร้านเว็บของ REAL (ร้านเดียวชื่อ THISSHOP) จึงอยู่กลุ่ม REAL
// ใช้กับแถบเลือกร้านทุกหน้า (ดู app/ShopBar.js) ให้หน้าตาและลำดับตรงกันทั้งเว็บ
export const GROUP_ORDER = ['SOLID', 'REAL', 'MVP'];
const PLATFORM_ORDER = ['shopee', 'tiktok', 'lazada', 'thaimart', 'thisshop'];

export const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop', thaimart: 'Thaimart' };

export function shopGroup(platform, shop) {
  return platform === 'thisshop' ? 'REAL' : String(shop || '').toUpperCase();
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
