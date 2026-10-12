// โมเดลสินค้ากลาง — ทุกร้านอ่านสินค้า "เข้า" โมเดลนี้ (from*) แล้วตัวเขียนของแต่ละปลายทาง (Thaimart ไฟล์ Excel,
// ThisShop, Shopee, Lazada, TikTok) สร้างสินค้า "ออก" จากโมเดลนี้ → คู่ใดก็ได้ต้นทาง × ปลายทาง ไม่ต้องเขียนซ้ำเป็นคู่ๆ
//
// ไม่มี import (ฟังก์ชันล้วน) เพื่อทดสอบในเบราว์เซอร์ได้
//
// โมเดล:
//   { source: { platform, shop, id }, title, descriptionHtml, images: [url], categoryChain: [ชื่อหมวดจากต้นทาง], categoryLeafId,
//     brand, weightG, dims: { l, w, h } (cm), optionNames: [ชื่อตัวเลือกชั้น 1, 2],
//     variants: [{ sku, options: [{ name, value, image }], price, qty }] }

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// หน่วยน้ำหนัก → กรัม · ขนาด → เซนติเมตร
function toGrams(w) {
  if (!w) return 0;
  const v = num(w.value);
  const u = String(w.unit || '').toUpperCase();
  if (u.startsWith('KILO')) return v * 1000;
  if (u.startsWith('POUND')) return v * 453.592;
  if (u.startsWith('OUNCE')) return v * 28.3495;
  return v;   // GRAM
}
function toCm(v, unit) {
  const n = num(v);
  return String(unit || '').toUpperCase().startsWith('INCH') ? n * 2.54 : n;
}

// ── TikTok Shop (product 202309 · GET /products/{id}) ──
export function fromTikTok(p, shop = 'SOLID') {
  const skus = p.skus || [];
  const d = p.package_dimensions || {};
  return {
    source: { platform: 'tiktok', shop, id: String(p.id) },
    title: p.title || '',
    descriptionHtml: p.description || '',
    images: (p.main_images || []).map((i) => (i.urls || [])[0]).filter(Boolean),
    categoryChain: (p.category_chains || []).map((c) => c.local_name || c.name || '').filter(Boolean),
    categoryLeafId: (p.category_chains || []).length ? String(p.category_chains[p.category_chains.length - 1].id) : null,
    brand: p.brand?.name || null,
    weightG: toGrams(p.package_weight),
    dims: { l: toCm(d.length, d.unit), w: toCm(d.width, d.unit), h: toCm(d.height, d.unit) },
    optionNames: (skus[0]?.sales_attributes || []).map((a) => a.name || ''),
    variants: skus.map((s) => ({
      sku: String(s.seller_sku || '').trim(),
      options: (s.sales_attributes || []).map((a) => ({
        name: a.name || '', value: a.value_name || '', image: (a.sku_img?.urls || [])[0] || null,
      })),
      price: num(s.price?.sale_price ?? s.price?.tax_exclusive_price),
      qty: (s.inventory || []).reduce((n, w) => n + (num(w.quantity)), 0),
    })),
  };
}

// ── Shopee (get_item_base_info + get_model_list) ──
// base = ก้อนจาก get_item_base_info · models = ก้อนจาก get_model_list (null ถ้าไม่มีตัวเลือก)
export function fromShopee(base, models, shop = 'SOLID', categoryNames = []) {
  const tiers = models?.tier_variation || [];
  const dim = base.dimension || {};
  const list = base.has_model && models?.model?.length ? models.model : [null];
  return {
    source: { platform: 'shopee', shop, id: String(base.item_id) },
    title: base.item_name || '',
    descriptionHtml: base.description
      || (base.description_info?.extended_description?.field_list || []).filter((f) => f.field_type === 'text').map((f) => f.text).join('\n'),
    images: base.image?.image_url_list || [],
    categoryChain: categoryNames,
    categoryLeafId: base.category_id ? String(base.category_id) : null,
    brand: base.brand?.original_brand_name || null,
    weightG: num(base.weight) * 1000,     // Shopee เก็บเป็น kg
    dims: { l: num(dim.package_length), w: num(dim.package_width), h: num(dim.package_height) },
    optionNames: tiers.map((t) => t.name || ''),
    variants: list.map((m) => {
      if (!m) {
        return {
          sku: String(base.item_sku || '').trim(), options: [],
          price: num(base.price_info?.[0]?.original_price ?? base.price_info?.[0]?.current_price),
          qty: num(base.stock_info_v2?.summary_info?.total_available_stock),
        };
      }
      return {
        sku: String(m.model_sku || '').trim(),
        options: (m.tier_index || []).map((ix, t) => {
          const o = tiers[t]?.option_list?.[ix];
          return { name: tiers[t]?.name || '', value: o?.option || '', image: o?.image?.image_url || null };
        }),
        price: num(m.price_info?.[0]?.original_price ?? m.price_info?.[0]?.current_price),
        qty: num(m.stock_info_v2?.summary_info?.total_available_stock),
      };
    }),
  };
}

// ── ตัวช่วยร่วมของตัวเขียน ──

// ตัดแท็ก HTML → ข้อความล้วน (คงบรรทัด) สำหรับร้านที่รับคำอธิบายเป็นข้อความ
export function htmlToText(html, max = 9000) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0*39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

// ชื่อสินค้า Shopee/TikTok มักติดป้ายโปรหน้าชื่อ เช่น "💸ลด65.-ใส่โค้ดXXXX💸…" — ตัดคู่อีโมจิที่ล้อมข้อความออก
export function cleanTitle(s) {
  return String(s || '')
    .replace(/(\p{Extended_Pictographic}️?)[^\p{Extended_Pictographic}]{0,80}?\1/gu, ' ')
    .replace(/[\p{Extended_Pictographic}️]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ย่อค่าตัวเลือกให้ไม่เกิน max ตัวอักษร และไม่ซ้ำกันในตะกร้าเดียว — คืน Map(ค่าเดิม → ค่าที่ย่อแล้ว)
// ลำดับ: ใช้ตามเดิมถ้าพอ → ตัดรหัสนำหน้าก่อนขีด ("P1GA252137-สีขาวเขียว" → "สีขาวเขียว") → ตัดท้าย → ต่อเลขกันซ้ำ
export function shortenValues(values, max = 20) {
  const uniq = [...new Set(values.map((v) => String(v ?? '')))];
  const out = new Map();
  const used = new Set();
  const take = (want) => {
    let s = want;
    let n = 2;
    while (used.has(s)) {
      const suf = String(n);
      n += 1;
      s = want.slice(0, max - suf.length) + suf;
    }
    used.add(s);
    return s;
  };
  for (const v of uniq) if (v.length <= max) out.set(v, take(v));
  for (const v of uniq) {
    if (out.has(v)) continue;
    const i = v.indexOf('-');
    let s = v;
    if (i > 0 && v.length - i - 1 >= 2) s = v.slice(i + 1).trim();
    if (s.length > max) s = s.slice(0, max);
    out.set(v, take(s));
  }
  return out;
}
