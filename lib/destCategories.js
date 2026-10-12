// หมวดปลายทาง (เฉพาะ leaf) ไว้ให้ผู้ใช้เลือกเองในแผงโคลน — แทนหมวดที่ระบบเดาจากแผนที่
// คืน [{ id, path }] เส้นทางภาษาไทย "แม่ › ลูก" · จำไว้ 1 ชั่วโมงต่อเครื่อง (หมวดไม่ค่อยเปลี่ยน)
import * as shopee from './shopee.js';
import * as lazada from './lazada.js';
import * as tiktok from './tiktok.js';
import { shopToken } from './cloneCommon.js';

const cache = new Map();
const TTL = 3600000;

async function shopeeLeaves(shop) {
  const t = await shopToken('shopee', shop);
  const d = await shopee.call('/api/v2/product/get_category', { accessToken: t.access_token, shopId: t.shop_id, partner: t, params: { language: 'th' } });
  const list = d.category_list || [];
  const byId = new Map(list.map((c) => [c.category_id, c]));
  const path = (c) => {
    const parts = [];
    for (let cur = c, g = 0; cur && g < 6; g++) {
      parts.unshift(cur.display_category_name || cur.original_category_name || String(cur.category_id));
      cur = cur.parent_category_id ? byId.get(cur.parent_category_id) : null;
    }
    return parts.join(' › ');
  };
  return list.filter((c) => !c.has_children).map((c) => ({ id: String(c.category_id), path: path(c) }));
}

async function lazadaLeaves(shop) {
  const t = await shopToken('lazada', shop);
  const tree = (await lazada.call('/category/tree/get', { accessToken: t.access_token, params: { language_code: 'th_TH' } })).data || [];
  const out = [];
  const walk = (nodes, parts) => {
    for (const n of nodes || []) {
      const p = [...parts, n.name || String(n.category_id)];
      if (n.leaf || !(n.children || []).length) out.push({ id: String(n.category_id), path: p.join(' › ') });
      else walk(n.children, p);
    }
  };
  walk(tree, []);
  return out;
}

async function tiktokLeaves(shop) {
  const t = await shopToken('tiktok', shop);
  const d = await tiktok.call('/product/202309/categories', {
    accessToken: t.access_token, shopCipher: t.shop_cipher, query: { category_version: 'v2', locale: 'th-TH' },
  });
  const list = d.categories || [];
  const byId = new Map(list.map((c) => [String(c.id), c]));
  const path = (c) => {
    const parts = [];
    for (let cur = c, g = 0; cur && g < 6; g++) {
      parts.unshift(cur.local_name || String(cur.id));
      cur = cur.parent_id && cur.parent_id !== '0' ? byId.get(String(cur.parent_id)) : null;
    }
    return parts.join(' › ');
  };
  return list.filter((c) => c.is_leaf && (c.permission_statuses || ['AVAILABLE']).includes('AVAILABLE')).map((c) => ({ id: String(c.id), path: path(c) }));
}

export async function destCategories(dest, shop = 'SOLID') {
  const key = `${dest}:${shop}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const fn = { shopee: shopeeLeaves, lazada: lazadaLeaves, tiktok: tiktokLeaves }[dest];
  if (!fn) throw new Error('ปลายทางนี้ยังไม่รองรับการเลือกหมวด');
  const items = (await fn(shop)).sort((a, b) => a.path.localeCompare(b.path, 'th'));
  cache.set(key, { at: Date.now(), items });
  return items;
}
