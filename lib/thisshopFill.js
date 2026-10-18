// เติมตัวเลือกที่ ThisShop ขาดให้เหมือน Shopee REAL (ปุ่ม "เติม ThisShop" ในหน้า /compare)
//
// ThisShop ไม่มี Open API ที่แก้ตะกร้าได้ (thisshop.goods.update ตอบ 40000 "add-on product" ทุกแบบ — ทดสอบ 2026-10-17)
// ฝั่งนี้จึงแค่ "วางแผน" แล้วให้ส่วนขยาย extensions/thisshop-fill กดในหน้าแก้ไขสินค้าหลังบ้าน sale.thisshop.com แทนคน
// (ทำมือผ่านหลังบ้านสำเร็จแล้วกับ DEFENDER 40018314112 และ MANCHESTER 40017492357 — 2026-10-18)
//
// แผน = ตัวเลือกที่ Shopee REAL มีแต่ ThisShop ไม่มี (เทียบด้วยรหัส SKU) · ราคาป้ายเต็ม · คลังจาก ST · รูปสีจาก Shopee
// ชื่อตัวเลือกใหม่ต้องตั้งแบบเดียวกับที่ตะกร้า ThisShop ใช้อยู่ (ไม่ใช่ลอกจาก Shopee ตรงๆ):
//   DEFENDER ใช้ชื่อเดียวกับ Shopee ("KD2189-สีชมพู") · MANCHESTER ใช้แค่รหัสสี ("JI7423" ขณะที่ Shopee เป็น "JI7423- 25/26 สีขาว")
//   → ดูจากคู่ตัวเลือกที่มีทั้งสองร้าน (รหัส SKU เดียวกัน) ว่าเขาตั้งชื่อแบบไหน ถ้าเดาไม่ได้ไม่ทำ
import { db } from './supabase.js';
import * as shopee from './shopee.js';
import * as thisshop from './thisshop.js';
import { shopeeAuth, cleanTitle } from './clone.js';

export class FillError extends Error {}

const low = (s) => String(s || '').trim().toLowerCase();
const decode = (q) => String(q || '').replace(/dott/g, '.').replace(/sizee/g, '-');
const prefix = (sku) => String(sku || '').split('-')[0].trim();
const MAX_GALLERY = 9;   // หลังบ้าน ThisShop รับรูปสินค้าไม่เกิน 9 รูป
const MAX_TITLE = 256;   // เท่ากับที่โคลนใช้ (lib/clone.js)

// ตัวเลือกทั้งหมดของตะกร้า Shopee REAL — รูปแบบเดียวกับ runClone ใน lib/clone.js
async function shopeeRows(itemId) {
  const auth = await shopeeAuth();
  const [base] = await shopee.getItemBaseInfo({ ...auth, itemIds: [itemId] });
  if (!base) throw new FillError('Shopee REAL ไม่ตอบข้อมูลตะกร้านี้ (อาจถูกลบแล้ว)');
  if (!base.has_model) throw new FillError('ตะกร้า Shopee REAL นี้ไม่มีตัวเลือก — ไม่มีอะไรให้เติม');
  const models = await shopee.getModelList({ ...auth, itemId });
  const tiers = models?.tier_variation || [];
  const rows = (models?.model || []).map((m) => ({
    sku: String(m.model_sku || '').trim(),
    opts: (m.tier_index || []).map((ix, t) => String(tiers[t]?.option_list?.[ix]?.option ?? '').trim()),
    images: (m.tier_index || []).map((ix, t) => tiers[t]?.option_list?.[ix]?.image?.image_url || null),
    price: Number(m.price_info?.[0]?.original_price ?? m.price_info?.[0]?.current_price ?? 0),
    shopeeStock: Number(m.stock_info_v2?.summary_info?.total_available_stock ?? 0),
    order: m.tier_index || [],
  }));
  rows.sort((a, b) => {
    for (let i = 0; i < Math.max(a.order.length, b.order.length); i++) if ((a.order[i] ?? 0) !== (b.order[i] ?? 0)) return (a.order[i] ?? 0) - (b.order[i] ?? 0);
    return 0;
  });
  const gallery = (base.image?.image_url_list || []).filter(Boolean).slice(0, MAX_GALLERY);
  return { title: base.item_name, gallery, tierNames: tiers.map((t) => t.name), rows };
}

// ชื่อตัวเลือกใหม่ของชั้น t — ดูจากคู่ที่มีทั้งสองร้านว่า ThisShop ตั้งชื่อแบบไหน
function namer(pairs, t) {
  if (!pairs.length) return null;
  if (pairs.every((p) => p.ts === p.sp)) return (r) => r.opts[t];
  if (t === 0 && pairs.every((p) => low(p.ts) === low(prefix(p.sku)))) return (r) => prefix(r.sku);
  return null;
}

// ตรวจหลังส่วนขยายกดบันทึก — ถามตะกร้า ThisShop สดผ่าน Open API (คนละทางกับที่ส่วนขยายใช้บันทึก)
// SKU เดิมต้องอยู่ครบรหัสเดิม · รหัสใหม่ต้องขึ้นครบ
export async function verifyFill({ spuId, keep = [], add = [], title = null, images = 0 }) {
  spuId = String(spuId || '');
  if (!/^\d+$/.test(spuId)) throw new FillError('เลขตะกร้าไม่ถูกต้อง');
  const ts = await thisshop.goodsDetails(await thisshop.getToken(), spuId);
  const now = new Map((ts?.skuList || []).map((s) => [String(s.itemId), s]));
  const codes = new Set((ts?.skuList || []).map((s) => low(s.itemQrcode)));
  const lostOld = keep.filter((k) => !now.has(String(k.itemId)) || low(now.get(String(k.itemId)).itemQrcode) !== low(k.code)).map((k) => k.code || k.itemId);
  const notAdded = add.filter((a) => !codes.has(low(a.code))).map((a) => a.code);
  // ชื่อ/รูปที่สั่งใส่ใหม่ (ไม่ได้สั่ง = ไม่เช็ก)
  const titleOk = !title || String(ts?.itemName || '').trim() === String(title).trim();
  const imagesOk = !images || (ts?.mediaList || []).length === Number(images);
  return {
    ok: !lostOld.length && !notAdded.length && titleOk && imagesOk, total: now.size, lostOld, notAdded,
    titleOk, imagesOk, nowTitle: ts?.itemName || '', nowImages: (ts?.mediaList || []).length,
  };
}

export async function buildFillPlan({ shopeeItemId, spuId }) {
  shopeeItemId = String(shopeeItemId || '');
  spuId = String(spuId || '');
  if (!/^\d+$/.test(shopeeItemId) || !/^\d+$/.test(spuId)) throw new FillError('เลขตะกร้าไม่ถูกต้อง');

  const token = await thisshop.getToken();
  const [sp, ts] = await Promise.all([shopeeRows(shopeeItemId), thisshop.goodsDetails(token, spuId)]);
  if (!ts?.skuList?.length) throw new FillError(`ไม่พบตะกร้า ThisShop ${spuId}`);
  if (String(ts.bolDelete) === 'y') throw new FillError(`ตะกร้า ThisShop ${spuId} ถูกลบแล้ว`);

  const noSku = sp.rows.filter((r) => !r.sku);
  if (noSku.length) throw new FillError(`Shopee REAL มี ${noSku.length} ตัวเลือกที่ไม่มีรหัส SKU — ใส่รหัสก่อน`);

  // ── ตะกร้า ThisShop ปัจจุบัน ──
  const attNames = (ts.skuList[0].attData || []).map((a) => a.attName);
  if (attNames.length !== sp.tierNames.length) {
    throw new FillError(`จำนวนชั้นตัวเลือกไม่เท่ากัน — Shopee REAL ${sp.tierNames.length} ชั้น (${sp.tierNames.join(' / ')}) · ThisShop ${attNames.length} ชั้น (${attNames.join(' / ')})`);
  }
  const keep = ts.skuList.map((s) => ({
    itemId: String(s.itemId), code: String(s.itemQrcode || ''), sku: decode(s.itemQrcode),
    values: attNames.map((n) => String((s.attData || []).find((a) => a.attName === n)?.attValue ?? '')),
  }));
  if (keep.some((k) => k.values.some((v) => !v))) throw new FillError('ตะกร้า ThisShop มี SKU ที่ชื่อตัวเลือกว่าง — ทำมือในหลังบ้านแทน');
  const tsBySku = new Map(keep.map((k) => [low(k.sku), k]));
  // รหัสใหม่เขียนแบบเดียวกับ SKU เดิมในตะกร้า — ร้านใช้ปนกัน แยกจุดกับขีด (เจอจริง: "HP7568-8dott5" ขีดตรงๆ แต่จุดเป็น dott,
  // "GW3658-6.5" ตรงๆ ทั้งคู่, ตะกร้าโคลนผ่าน Open API เป็น sizee/dott ทั้งคู่) · หลังบ้านรับ "-" "." ตรงๆ ได้ (บันทึกจริงแล้ว)
  // ตะกร้าเดียวมีทั้งสองแบบ = ใช้แบบที่มากกว่า
  const count = (re) => keep.filter((k) => re.test(k.code)).length;
  const dotEnc = count(/dott/) > count(/\./);
  const dashEnc = count(/sizee/) > count(/-/);
  const toCode = (sku) => {
    let c = String(sku);
    if (dotEnc) c = c.replace(/\./g, 'dott');
    if (dashEnc) c = c.replace(/-/g, 'sizee');
    return c;
  };

  // ── จับคู่ชื่อตัวเลือก Shopee ↔ ThisShop จากรหัสที่มีทั้งสองร้าน ──
  const shared = sp.rows.filter((r) => tsBySku.has(low(r.sku)));
  if (!shared.length) throw new FillError('ไม่มีรหัส SKU ไหนตรงกันเลยระหว่างสองตะกร้า — อาจจับคู่ผิดตะกร้า');
  // ลำดับชั้นอาจสลับกัน (ThisShop บางตะกร้าเป็น Size ก่อน color) — perm[t] = ชั้นของ Shopee ที่ตรงกับชั้น t ของ ThisShop
  // ใช้ลำดับที่ชื่อจับคู่กันได้แบบหนึ่งต่อหนึ่งทุกชั้น · ได้มากกว่าหนึ่งแบบ (ข้อมูลไม่พอแยก) หรือไม่ได้เลย = ไม่ทำ
  const tryPerm = (perm) => {
    const fwd = perm.map(() => new Map());   // ชั้น t: ชื่อ Shopee → ชื่อ ThisShop
    const back = perm.map(() => new Map());
    const pairs = perm.map(() => []);
    for (const r of shared) {
      const k = tsBySku.get(low(r.sku));
      for (let t = 0; t < perm.length; t++) {
        const o = r.opts[perm[t]];
        const v = k.values[t];
        if ((fwd[t].has(o) && fwd[t].get(o) !== v) || (back[t].has(v) && back[t].get(v) !== o)) return null;
        fwd[t].set(o, v);
        back[t].set(v, o);
        pairs[t].push({ sp: o, ts: v, sku: r.sku });
      }
    }
    return { perm, fwd, pairs };
  };
  const n = sp.tierNames.length;
  const perms = n === 2 ? [[0, 1], [1, 0]] : [Array.from({ length: n }, (_, i) => i)];
  const ok = perms.map(tryPerm).filter(Boolean);
  if (!ok.length) throw new FillError('ชื่อตัวเลือกของสองร้านจับคู่กันไม่ได้แบบหนึ่งต่อหนึ่ง — ทำมือในหลังบ้านแทน');
  if (ok.length > 1) throw new FillError('แยกไม่ออกว่าชั้นตัวเลือกของสองร้านเรียงตรงกันแบบไหน (รหัสที่ตรงกันมีน้อยไป) — ทำมือในหลังบ้านแทน');
  const { perm, fwd: map, pairs } = ok[0];
  for (const r of sp.rows) {
    r.opts = perm.map((i) => r.opts[i]);
    r.images = perm.map((i) => r.images[i]);
  }
  const names = pairs.map((p, t) => namer(p, t));

  // ── ตัวเลือกที่ต้องเพิ่ม ──
  const missing = sp.rows.filter((r) => !tsBySku.has(low(r.sku)));
  // ชื่อ + รูปสินค้าจาก Shopee REAL (ผู้ใช้สั่ง 2026-10-19: เติมแล้วเอาชื่อกับรูปไปใส่ใหม่ด้วย) — หน้าเว็บให้ติ๊กเลือกได้
  const info = {
    title: (cleanTitle(sp.title) || String(sp.title || '').trim()).replace(/\s+/g, ' ').slice(0, MAX_TITLE),
    images: sp.gallery,
    curTitle: ts.itemName || '',
    curImages: (ts.mediaList || []).length,
    curCover: ts.imageUrl || null,
  };
  const existingTiers = sp.tierNames.map((n, t) => ({ name: attNames[t], shopeeName: n, existing: [...new Set(keep.map((k) => k.values[t]))], add: [] }));
  if (!missing.length) {
    return {
      ok: true, spuId, shopeeItemId, title: ts.itemName, nothing: true, info, tiers: existingTiers, add: [], extra: 0,
      editUrl: `https://sale.thisshop.com/shop/edit?id=${spuId}&isNew=1`,
      keep: keep.map(({ itemId, code, values }) => ({ itemId, code, values })),
    };
  }

  const stForms = [...new Set(missing.flatMap((r) => [r.sku, r.sku.toLowerCase(), r.sku.toUpperCase()]))];
  const { data: stRows, error: eSt } = await db().from('os_st').select('sku, qty').in('sku', stForms);
  if (eSt) throw eSt;
  const stQty = new Map((stRows || []).map((r) => [low(r.sku), Math.max(0, Number(r.qty) || 0)]));

  const existing = sp.tierNames.map((_, t) => [...new Set(keep.map((k) => k.values[t]))]);
  const tiers = sp.tierNames.map((n, t) => ({ name: attNames[t], shopeeName: n, existing: existing[t], add: [] }));
  const add = [];
  const codes = new Set(keep.map((k) => low(k.code)));
  for (const r of missing) {
    const values = r.opts.map((o, t) => {
      if (map[t].has(o)) return map[t].get(o);
      if (!names[t]) throw new FillError(`ตั้งชื่อตัวเลือกใหม่ "${o}" (ชั้น ${attNames[t]}) ให้เข้ากับตะกร้า ThisShop ไม่ได้ — ชื่อเดิมไม่ได้ตั้งตาม Shopee หรือรหัสสี`);
      const v = String(names[t](r)).trim();
      // ชื่อใหม่ชนกับชื่อเดิม/ชื่อใหม่ของตัวเลือก Shopee อื่น (เช่น ตัดเหลือรหัสแล้วซ้ำ) = รวมผิดตัว
      if (!v || existing[t].includes(v) || [...map[t].values()].includes(v)) {
        throw new FillError(`ชื่อตัวเลือกใหม่ "${v}" (จาก "${o}") ชนกับชื่อที่มีอยู่ — ทำมือแทน`);
      }
      map[t].set(o, v);
      return v;
    });
    values.forEach((v, t) => {
      if (!existing[t].includes(v) && !tiers[t].add.some((a) => a.value === v)) {
        tiers[t].add.push({ value: v, image: t === 0 ? r.images[0] : null });
      }
    });
    if (!(r.price > 0)) throw new FillError(`${r.sku} ราคาใน Shopee REAL เป็น 0`);
    const code = toCode(r.sku);
    if (codes.has(low(code))) throw new FillError(`รหัส ${code} มีใน ThisShop แล้วแต่ชื่อตัวเลือกไม่ตรง — ทำมือแทน`);
    codes.add(low(code));
    add.push({
      sku: r.sku, code, values,
      price: Math.round(r.price * 100) / 100,
      stock: stQty.has(low(r.sku)) ? stQty.get(low(r.sku)) : Math.max(0, r.shopeeStock),
    });
  }
  // ตัวเลือกชั้นแรกของ ThisShop มีรูปไหม — ถ้ามี สีใหม่ต้องมีรูป (เหมือน Shopee) ไม่มีรูปจาก Shopee = ไม่ทำ
  const firstHasImg = (ts.skuList || []).some((s) => (s.attData || [])[0]?.imgUrl);
  if (firstHasImg) {
    const noImg = tiers[0].add.filter((a) => !a.image);
    if (noImg.length) throw new FillError(`สีใหม่ ${noImg.map((a) => a.value).join(', ')} ไม่มีรูปใน Shopee REAL — ตะกร้า ThisShop นี้สีมีรูปทุกตัว`);
  } else {
    tiers[0].add.forEach((a) => { a.image = null; });
  }

  // แถวที่ปุ่ม Generate SKU ของหลังบ้านจะสร้างเกิน (ทุกชื่อ × ทุกชื่อ) — ส่วนขยายต้องลบก่อนบันทึก
  const all = tiers.map((t) => [...t.existing, ...t.add.map((a) => a.value)]);
  const combos = all.reduce((acc, vs) => acc.flatMap((c) => vs.map((v) => [...c, v])), [[]]);
  const have = new Set([...keep, ...add].map((k) => JSON.stringify(k.values)));
  const extra = combos.filter((c) => !have.has(JSON.stringify(c))).length;

  return {
    ok: true, spuId, shopeeItemId, title: ts.itemName, shopeeTitle: sp.title,
    editUrl: `https://sale.thisshop.com/shop/edit?id=${spuId}&isNew=1`,
    tiers, add, extra, info,
    keep: keep.map(({ itemId, code, values }) => ({ itemId, code, values })),
  };
}
