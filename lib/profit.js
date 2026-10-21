// กำไรถ้าขายที่ราคานี้ — ใช้ในหน้าเทียบส่วนลด (/discount/compare) และป็อปอัพแก้โปร
//
// อิงตัวเลขชุดเดียวกับหน้า /money:
//   ค่าธรรมเนียม = ที่โดนหักจริง (fee + ค่าส่ง + ปรับยอด) ÷ ราคาหลังร้านลด ของเงินเข้า 30 วันล่าสุด ต่อร้าน (os_money_totals)
//     ร้านที่ขายน้อย (< 50 รายการ) ใช้อัตรารวมของทั้งแพลตฟอร์มแทน — ไม่งั้นอัตราแกว่งตามออเดอร์ไม่กี่ใบ
//   ทุน = ทุนล่าสุดจากบิลรับของ (os_costs) กฎเดียวกับ os_costs_resolve (supabase/042): SCS ลดนอกบิล = ราคาป้าย × 70%
//     รหัสที่บิลไม่มีตรงๆ ลองทุนที่หน้า /money คิดไว้แล้ว (os_sku_cost — อาจเป็นทุนประมาณจากรหัสใกล้เคียง)
// กำไร = ราคาขาย × (1 − ค่าธรรมเนียม) − ทุน · กำไร % = กำไร ÷ ราคาขาย
import { unstable_cache } from 'next/cache';
import { db } from './supabase.js';

const DAYS = 30;
const MIN_ROWS = 50;
const PLATFORMS = ['shopee', 'tiktok', 'lazada'];

const rateOf = (t) => {
  const base = Number(t?.gross || 0) + Number(t?.seller_discount || 0);
  const charges = -(Number(t?.fee || 0) + Number(t?.shipping || 0) + Number(t?.adjustment || 0));
  return base > 0 ? Math.min(Math.max(charges / base, 0), 0.6) : null;
};

// { 'shopee:REAL': { rate, n }, 'P:shopee': { rate, n }, ... } · จำไว้ 6 ชั่วโมง (เงินเข้าเปลี่ยนวันละครั้ง)
export const feeRates = unstable_cache(async () => {
  const from = new Date(Date.now() - DAYS * 86400000).toISOString();
  const to = new Date(Date.now() + 86400000).toISOString();
  const { data: shops, error } = await db().from('os_shop_tokens').select('platform, shop').in('platform', PLATFORMS);
  if (error) throw new Error(error.message);
  const ask = (platform, shop) => db().rpc('os_money_totals', { p_from: from, p_to: to, p_platform: platform, p_shop: shop })
    .then((r) => (r.error ? null : r.data));
  const jobs = [
    ...(shops || []).map((s) => ask(s.platform, s.shop).then((t) => [`${s.platform}:${s.shop}`, t])),
    ...PLATFORMS.map((p) => ask(p, null).then((t) => [`P:${p}`, t])),
  ];
  const out = {};
  for (const [k, t] of await Promise.all(jobs)) {
    const rate = rateOf(t);
    if (rate !== null) out[k] = { rate, n: Number(t.rows || 0) };
  }
  return out;
}, ['profit-fee-rates'], { revalidate: 21600, tags: ['money'] });

// อัตราค่าธรรมเนียมของร้าน (null = ไม่มีข้อมูลเงินเข้า เช่น ThisShop / Thaimart)
export function feeRateFor(rates, platform, shop) {
  const s = rates?.[`${platform}:${shop}`];
  if (s && s.n >= MIN_ROWS) return s.rate;
  return rates?.[`P:${platform}`]?.rate ?? s?.rate ?? null;
}

// keys = seller_sku ตัวเล็ก → { [key]: { c: ทุน, est: ทุนประมาณ } }
export async function skuCosts(keys) {
  const want = [...new Set(keys.map((k) => String(k || '').trim().toLowerCase()).filter(Boolean))];
  const out = {};
  for (let i = 0; i < want.length; i += 200) {
    const { data, error } = await db().from('os_costs').select('sku_key, unit_cost, list_price, supplier').in('sku_key', want.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const x of data || []) {
      const c = x.supplier === 'SCS' && Number(x.list_price) > 0 ? Math.round(Number(x.list_price) * 70) / 100 : Number(x.unit_cost);
      if (c > 0) out[x.sku_key] = { c, est: false };
    }
  }
  const miss = want.filter((k) => !out[k]);
  for (let i = 0; i < miss.length; i += 200) {
    const { data } = await db().from('os_sku_cost').select('sku, cost, est').in('sku', miss.slice(i, i + 200));
    for (const x of data || []) {
      const k = String(x.sku).toLowerCase();
      if (!out[k] && Number(x.cost) > 0) out[k] = { c: Number(x.cost), est: true };
    }
  }
  return out;
}

// กำไรที่ราคาขาย price — null ถ้าไม่รู้ทุนหรือค่าธรรมเนียม
export function profitAt(price, cost, rate) {
  if (!(price > 0) || !(cost > 0) || rate === null || rate === undefined) return null;
  const profit = Math.round((price * (1 - rate) - cost) * 100) / 100;
  return { profit, pct: Math.round((profit / price) * 100) };
}
