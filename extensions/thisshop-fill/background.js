// เติมตัวเลือกที่ ThisShop ขาดให้เหมือน Shopee REAL — สั่งจากปุ่ม "เติม ThisShop" ในหน้า /compare ของ order-sync
//
// ThisShop ไม่มี Open API ที่แก้ตะกร้าได้ ส่วนขยายจึงกดในหน้าแก้ไขสินค้าหลังบ้านแทนคน ขั้นเดียวกับที่ทำมือสำเร็จแล้ว
// (DEFENDER 40018314112 · MANCHESTER 40017492357 — 2026-10-18):
//   เปิด sale.thisshop.com/shop/edit?id=<spu>&isNew=1 → แท็บ Sales attribute → พิมพ์ชื่อตัวเลือกใหม่ → Add
//   → อัปรูปสี (รูปจาก Shopee) → ติ๊ก → Generate SKU → ลบแถวที่สร้างเกิน → ใส่คลัง (กล่อง Edit) → ราคา/รหัส → Publish
// แผน (ตัวเลือก ชื่อ ราคา คลัง รูป) มาจากเว็บ order-sync POST /api/basket/thisshop-fill — ส่วนขยายไม่คิดเอง
//
// กันพัง — หยุดโดยไม่บันทึกถ้า:
//   ตะกร้าในหน้าแก้ไขไม่ตรงกับตอนวางแผน · SKU เดิมหาย/เปลี่ยนค่า (ยกเว้นตัวซ้ำเป๊ะที่ Generate SKU ตัดเอง — บันทึกแล้วของเดิมไม่หาย)
//   แถวใหม่ไม่ตรงแผนพอดี · รหัสซ้ำ · สถานะขาย/ปิดขายเปลี่ยน · หลังบ้านถามอะไรที่ไม่รู้จัก
// โหมดทดลอง (dry) ทำทุกขั้นจนถึงก่อนกด Publish แล้วปิดแท็บทิ้ง — ไม่มีอะไรถูกบันทึก
//
// ตัวหน้าแก้ไขเป็น Vue 2 + Ant Design Vue: อ่าน/ตั้งค่าแถว SKU ผ่าน formData.skuData ของคอมโพเนนต์หน้า (ค่าเดียวกับที่หน้าเว็บส่งตอนบันทึก)
// ถ้าหลังบ้านเปลี่ยนหน้าตา ขั้นไหนหาไม่เจอจะหยุดพร้อมบอกขั้นนั้น ไม่บันทึกครึ่งๆ กลางๆ
const EDIT_URL = (spu) => `https://sale.thisshop.com/shop/edit?id=${spu}&isNew=1`;

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'fill') { fillRun(msg).then(reply); return true; }
  return false;
});

// ── ทำในหน้าแก้ไขสินค้า (ฉีดเข้าแท็บ โลก MAIN เพื่อเข้าถึง Vue) ─────────────────
// ฟังก์ชันนี้ถูกคัดลอกไปรันในแท็บ ใช้ตัวแปรข้างนอกไม่ได้ — ทุกอย่างต้องมากับ args
async function pageFill(plan, images, dry) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = (s) => String(s ?? '').trim();
  const lc = (s) => T(s).toLowerCase();
  const key = (vs) => JSON.stringify(vs);
  const log = [];
  const fail = (step, error) => ({ ok: false, step, error, log, saved: false });
  const until = async (fn, ms = 20000, every = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const v = fn(); if (v) return v; } catch { /* ยังไม่พร้อม */ }
      await sleep(every);
    }
    return null;
  };
  const visible = (el) => !!(el && el.offsetParent);
  const setInput = (el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus();
    set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const btnByText = (root, re) => [...root.querySelectorAll('button')].filter((b) => visible(b) && re.test(T(b.textContent)));
  const b64File = (img, name) => {
    const bin = atob(img.b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], name, { type: img.type || 'image/jpeg' });
  };

  // ── 1. หาคอมโพเนนต์หน้าแก้ไข ──
  const findComp = () => {
    for (const el of document.querySelectorAll('*')) {
      let v = el.__vue__;
      while (v) {
        const d = v.$data?.formData;
        if (d && Array.isArray(d.skuData) && d.skuData.length && String(d.spuId) === String(plan.spuId)) return v;
        v = v.$parent;
      }
    }
    return null;
  };
  const comp = await until(() => (/\/login/.test(location.pathname) ? 'login' : findComp()), 45000, 500);
  if (comp === 'login' || /\/login/.test(location.pathname)) return fail('login', 'ยังไม่ได้ล็อกอินหลังบ้าน ThisShop ใน Chrome นี้ — ล็อกอินแล้วกดใหม่');
  if (!comp) return fail('load', `เปิดหน้าแก้ไขตะกร้า ${plan.spuId} ไม่ขึ้นใน 45 วินาที`);
  const rows = () => comp.$data.formData.skuData;

  const names = plan.tiers.map((t) => lc(t.name));
  const valsOf = (s) => names.map((n) => T((s.attData || []).find((a) => lc(a.attName) === n)?.attValue));
  const snap = (s) => ({
    itemId: String(s.itemId), code: T(s.itemQrcode), price: Number(s.amtPrice), market: Number(s.amtPriceMarket),
    stock: Number(s.stockNum), vals: valsOf(s),
  });
  const before = rows().filter((s) => s.itemId).map(snap);
  const typPublish0 = String(comp.$data.formData.typPublish);

  // ── 2. ตะกร้ายังเหมือนตอนวางแผน ──
  const planKeep = new Map(plan.keep.map((k) => [String(k.itemId), k]));
  if (before.length !== plan.keep.length || rows().some((s) => !s.itemId)) {
    return fail('check', `ตะกร้าเปลี่ยนไปหลังวางแผน (SKU ในหลังบ้าน ${before.length} · ตอนวางแผน ${plan.keep.length}) — กดเติมใหม่`);
  }
  for (const b of before) {
    const k = planKeep.get(b.itemId);
    if (!k || lc(k.code) !== lc(b.code) || key(k.values.map(T)) !== key(b.vals)) {
      return fail('check', `SKU ${b.code || b.itemId} ในหลังบ้านไม่ตรงกับตอนวางแผน — กดเติมใหม่`);
    }
  }
  log.push(`ตะกร้าตรงกับแผน (SKU เดิม ${before.length})`);

  const want = new Map(plan.add.map((a) => [key(a.values.map(T)), a]));
  const dropped = [];
  if (plan.add.length) {
  // ── 3. แท็บ Sales attribute ──
  const tab = [...document.querySelectorAll('[role=tab]')].find((e) => /sales attribute/i.test(e.textContent));
  if (!tab) return fail('tab', 'ไม่เจอแท็บ Sales attribute');
  tab.click();
  await sleep(800);

  // แถว "ชื่อชั้น [ช่องพิมพ์] [Add]" ของชั้นนั้น
  const attrRow = (name) => {
    const labels = [...document.querySelectorAll('label, span, div')].filter((e) => e.children.length === 0 && lc(e.textContent) === lc(name));
    for (const lab of labels) {
      let p = lab;
      for (let i = 0; i < 6 && p; i++) {
        p = p.parentElement;
        if (!p) break;
        const adds = btnByText(p, /^Add$/);
        if (adds.length > 1) break;
        const inp = p.querySelector('input[type=text], input:not([type])');
        if (adds.length === 1 && inp) return { input: inp, add: adds[0] };
      }
    }
    return null;
  };
  // ช่องติ๊กของตัวเลือก — ชื่อต้องไม่ซ้ำทั้งหน้า
  const optWrap = (value) => {
    const w = [...document.querySelectorAll('.ant-checkbox-wrapper')].filter((e) => T(e.textContent) === T(value));
    return w.length === 1 ? w[0] : (w.length > 1 ? 'dup' : null);
  };

  // ── 4. เพิ่มชื่อตัวเลือกใหม่ (+ รูป) แล้วติ๊ก ──
  for (const t of plan.tiers) {
    // ชื่อเดิมต้องติ๊กอยู่ครบ (ไม่งั้น Generate SKU จะทิ้ง SKU เดิม)
    for (const v of t.existing) {
      const w = optWrap(v);
      if (!w || w === 'dup' || !w.querySelector('input[type=checkbox]')?.checked) return fail('attr', `ตัวเลือกเดิม "${v}" ไม่ได้ติ๊กอยู่ในหน้า`);
    }
    if (!t.add.length) continue;
    const row = attrRow(t.name);
    if (!row) return fail('attr', `ไม่เจอช่องเพิ่มตัวเลือกของ "${t.name}"`);
    for (const a of t.add) {
      if (optWrap(a.value)) return fail('attr', `มีตัวเลือก "${a.value}" อยู่แล้วในหน้า — ไม่ตรงกับแผน`);
      setInput(row.input, a.value);
      await sleep(150);
      row.add.click();
      const w = await until(() => { const x = optWrap(a.value); return x && x !== 'dup' ? x : null; }, 5000);
      if (!w) return fail('attr', `กด Add "${a.value}" แล้วไม่ขึ้นเป็นตัวเลือก`);
      if (a.image) {
        const img = images.opts?.[a.value];
        if (!img) return fail('image', `โหลดรูปของ "${a.value}" จาก Shopee ไม่ได้`);
        let card = w;
        let file = null;
        for (let i = 0; i < 5 && card && !file; i++) {
          card = card.parentElement;
          const fs = card ? card.querySelectorAll('input[type=file]') : [];
          if (fs.length === 1) file = fs[0];
          else if (fs.length > 1) break;
        }
        if (!file) return fail('image', `ไม่เจอช่องอัปรูปของ "${a.value}"`);
        const dt = new DataTransfer();
        dt.items.add(b64File(img, `${a.value.replace(/[^A-Za-z0-9-]/g, '') || 'opt'}.jpg`));
        file.files = dt.files;
        file.dispatchEvent(new Event('change', { bubbles: true }));
        const ok = await until(() => card.querySelector('img'), 30000, 500);
        if (!ok) return fail('image', `อัปรูปของ "${a.value}" ไม่ขึ้นใน 30 วินาที`);
      }
      const cb = w.querySelector('input[type=checkbox]');
      if (!cb) return fail('attr', `ไม่เจอช่องติ๊กของ "${a.value}"`);
      if (!cb.checked) cb.click();
      if (!(await until(() => cb.checked, 3000))) return fail('attr', `ติ๊ก "${a.value}" ไม่ติด`);
      log.push(`เพิ่ม ${t.name}: ${a.value}${a.image ? ' (มีรูป)' : ''}`);
    }
  }

  // ── 5. Generate SKU ──
  const gen = btnByText(document, /^Generate SKU$/);
  if (gen.length !== 1) return fail('generate', 'ไม่เจอปุ่ม Generate SKU');
  gen[0].click();
  // แถวใหม่ต้องขึ้นอย่างน้อยเท่าแผน (อาจมากกว่า = แถวเกินที่ต้องลบ)
  if (!(await until(() => rows().filter((s) => !s.itemId).length >= plan.add.length, 10000))) return fail('generate', 'กด Generate SKU แล้วแถวใหม่ไม่ขึ้นครบ');
  await sleep(800);

  // SKU เดิมหลัง Generate: หายได้เฉพาะตัวที่ซ้ำเป๊ะกับตัวเดิมที่ยังอยู่ (หน้าเว็บรวมตัวซ้ำเอง — บันทึกแล้วของเดิมไม่หาย)
  const old2 = rows().filter((s) => s.itemId);
  const keptIds = new Set(old2.map((s) => String(s.itemId)));
  for (const b of before) {
    if (keptIds.has(b.itemId)) continue;
    if (!old2.some((s) => key(valsOf(s)) === key(b.vals))) return fail('generate', `SKU เดิม ${b.code} หายจากฟอร์มหลังกด Generate SKU`);
    dropped.push(b.code);
  }
  if (old2.some((s) => !before.some((b) => b.itemId === String(s.itemId)))) return fail('generate', 'มี SKU เดิมที่ไม่รู้จักโผล่มาหลัง Generate SKU');
  if (dropped.length) log.push(`หน้าเว็บรวมตัวซ้ำ ${dropped.length} ตัว (${dropped.join(', ')}) — บันทึกแล้วของเดิมยังอยู่`);

  // ── 6. ลบแถวที่สร้างเกิน ──
  const mainRows = () => [...new Set(document.querySelectorAll('.ant-table-scroll tbody tr, .ant-table-body tbody tr'))]
    .filter((tr) => !tr.closest('.ant-table-fixed-left, .ant-table-fixed-right'));
  const specVals = (tr) => {
    const lines = tr.innerText.split('\n').map(T);
    return names.map((n) => { const l = lines.find((x) => lc(x).startsWith(`${n}:`)); return l ? T(l.slice(l.indexOf(':') + 1)) : null; });
  };
  const trOf = (vals) => { const m = mainRows().filter((tr) => key(specVals(tr)) === key(vals)); return m.length === 1 ? m[0] : null; };
  const extras = () => rows().filter((s) => !s.itemId && !want.has(key(valsOf(s))));
  let guard = 0;
  while (extras().length) {
    if (++guard > 400) return fail('delete', 'ลบแถวเกินไม่จบ');
    const s = extras()[0];
    const vals = valsOf(s);
    const tr = trOf(vals);
    if (!tr) return fail('delete', `ไม่เจอแถว ${vals.join(' / ')} ในตาราง`);
    const idx = [...tr.parentElement.children].indexOf(tr);
    const fr = document.querySelector('.ant-table-fixed-right tbody')?.children[idx];
    const del = fr && [...fr.querySelectorAll('a')].find((a) => T(a.textContent) === 'delete');
    if (!del) return fail('delete', `ไม่เจอปุ่ม delete ของแถว ${vals.join(' / ')}`);
    const n0 = extras().length;
    del.click();
    const yes = await until(() => {
      const p = [...document.querySelectorAll('.ant-popover')].find((e) => visible(e) && /confirm delete/i.test(e.textContent));
      return p ? btnByText(p, /^Yes$/)[0] : null;
    }, 4000);
    if (!yes) return fail('delete', 'ไม่ขึ้นกล่องยืนยันการลบแถว');
    yes.click();
    if (!(await until(() => extras().length < n0, 4000))) return fail('delete', `ลบแถว ${vals.join(' / ')} ไม่สำเร็จ`);
  }
  const nw = rows().filter((s) => !s.itemId);
  if (nw.length !== plan.add.length || nw.some((s) => !want.has(key(valsOf(s))))) {
    return fail('rows', `แถวใหม่ไม่ตรงแผน (มี ${nw.length} · แผน ${plan.add.length})`);
  }
  log.push(`แถวใหม่ ${nw.length} แถวตรงแผน`);

  // ── 7. คลัง (กล่อง Edit ของหน้าเว็บ) แล้วค่อยราคา/รหัส ──
  const heads = [...document.querySelectorAll('.ant-table-scroll thead th, .ant-table-header thead th')]
    .filter((th) => !th.closest('.ant-table-fixed-left, .ant-table-fixed-right')).map((th) => T(th.textContent));
  const invCol = heads.findIndex((h) => /commodity/i.test(h));
  if (invCol < 0) return fail('stock', 'ไม่เจอคอลัมน์คลัง (Commodity inventory)');
  for (const s of nw) {
    const a = want.get(key(valsOf(s)));
    if (!(a.stock > 0)) continue;
    const tr = trOf(valsOf(s));
    const edit = tr && [...(tr.children[invCol]?.querySelectorAll('a') || [])].find((x) => /edit/i.test(x.textContent));
    if (!edit) return fail('stock', `ไม่เจอปุ่มแก้คลังของ ${a.code}`);
    edit.click();
    const m = await until(() => [...document.querySelectorAll('.ant-modal')].find((e) => visible(e) && /edit stock/i.test(e.textContent)), 4000);
    if (!m) return fail('stock', `ไม่ขึ้นกล่องแก้คลังของ ${a.code}`);
    const inp = [...m.querySelectorAll('input')].filter(visible).pop();
    setInput(inp, a.stock);
    inp.blur();
    await sleep(200);
    const ok = btnByText(m, /^OK$/)[0];
    if (!ok) return fail('stock', 'ไม่เจอปุ่ม OK ในกล่องแก้คลัง');
    ok.click();
    if (!(await until(() => !visible(m) && Number(s.stockNum) === Number(a.stock), 4000))) return fail('stock', `ตั้งคลัง ${a.code} = ${a.stock} ไม่ติด`);
  }
  for (const s of nw) {
    const a = want.get(key(valsOf(s)));
    comp.$set(s, 'amtPrice', a.price);
    comp.$set(s, 'amtPriceMarket', a.price);
    comp.$set(s, 'itemQrcode', a.code);
  }
  await sleep(500);
  }   // จบส่วนเพิ่มตัวเลือก

  // ── 7b. ชื่อ + รูปสินค้าจาก Shopee REAL (แท็บแรก) ──
  const fd = comp.$data.formData;
  const newTitle = T(plan.info?.title);
  if (newTitle) {
    comp.$set(fd, 'spuTitle', newTitle);
    comp.$set(fd, 'spuName', newTitle);
    log.push(`ชื่อใหม่: ${newTitle}`);
  }
  const gallery = images.gallery || [];
  if (gallery.length) {
    // คอมโพเนนต์รูปหลักของหน้า (mainProductPicture): fileList คู่กับ formData.mediaList · รูปแรก = รูปปก (หน้าเว็บตั้ง imageUrl ให้เอง)
    let mp = null;
    for (const el of document.querySelectorAll('*')) { const v = el.__vue__; if (v?.$options?.name === 'mainProductPicture' && v.formData === fd) { mp = v; break; } }
    if (!mp || typeof mp.removeFile !== 'function' || !Array.isArray(mp.fileList)) return fail('images', 'ไม่เจอช่องรูปสินค้าหลักในหน้า');
    const input = mp.$el.querySelector('input[type=file]');
    if (!input) return fail('images', 'ไม่เจอช่องอัปรูปสินค้า');
    if (gallery.length > (Number(mp.fileListSize) || 9)) return fail('images', `รูปเกิน ${mp.fileListSize} รูป`);
    for (const e of [...mp.fileList]) mp.removeFile(e);
    if (mp.fileList.length || (fd.mediaList || []).length) return fail('images', 'ลบรูปเดิมออกจากฟอร์มไม่หมด');
    const dt = new DataTransfer();
    gallery.forEach((img, i) => dt.items.add(b64File(img, `g${i}.jpg`)));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const done = await until(() => mp.fileList.length === gallery.length && mp.fileList.every((f) => f.key || f.url) && (fd.mediaList || []).length === gallery.length, 60000, 500);
    if (!done) return fail('images', `อัปรูปสินค้าไม่ครบใน 60 วินาที (ขึ้น ${mp.fileList.length}/${gallery.length})`);
    // เรียงตาม Shopee (อัปพร้อมกัน เสร็จไม่ตามลำดับ) — removeFile ของหน้าสร้าง mediaList ใหม่จาก fileList ให้
    const ix = (f) => { const m = /^g(\d+)\.jpg$/.exec(String(f.name || f.originFileObj?.name || '')); return m ? Number(m[1]) : -1; };
    if (mp.fileList.every((f) => ix(f) >= 0)) {
      mp.fileList = [...mp.fileList].sort((a, b) => ix(a) - ix(b));
      mp.removeFile({ uid: '__none__' });
    } else {
      log.push('เรียงรูปตาม Shopee ไม่ได้ (ไม่รู้ชื่อไฟล์) — ใช้ลำดับที่อัปเสร็จ');
    }
    await sleep(500);
    log.push(`รูปสินค้าใหม่ ${gallery.length} รูป`);
  }

  // ── 8. ตรวจทั้งหมดก่อนบันทึก ──
  const all = rows();
  for (const s of all.filter((x) => x.itemId)) {
    const b = before.find((x) => x.itemId === String(s.itemId));
    const n = snap(s);
    if (!b || b.code !== n.code || b.price !== n.price || b.market !== n.market || b.stock !== n.stock || key(b.vals) !== key(n.vals)) {
      return fail('verify', `SKU เดิม ${b?.code || s.itemId} ค่าเปลี่ยน — ไม่บันทึก`);
    }
  }
  const firstImg = plan.tiers[0].add.some((a) => a.image);
  const tier0 = names[0];
  for (const s of all.filter((x) => !x.itemId)) {
    const a = want.get(key(valsOf(s)));
    if (!a) return fail('verify', 'มีแถวใหม่ที่ไม่อยู่ในแผน');
    if (Number(s.amtPrice) !== a.price || Number(s.amtPriceMarket) !== a.price || T(s.itemQrcode) !== a.code || Number(s.stockNum) !== Number(a.stock)) {
      return fail('verify', `แถวใหม่ ${a.code} ค่าไม่ตรงแผน (ราคา ${s.amtPrice} คลัง ${s.stockNum})`);
    }
    if (firstImg && !T((s.attData || []).find((x) => lc(x.attName) === tier0)?.imgUrl)) return fail('verify', `แถวใหม่ ${a.code} ไม่มีรูปสี`);
  }
  const codes = all.map((s) => lc(s.itemQrcode));
  const dupCodes = [...new Set(codes.filter((c, i) => c && codes.indexOf(c) !== i))];
  const okDup = new Set(dropped.map(lc));   // ตัวซ้ำเดิมที่มีอยู่แล้วในตะกร้า
  if (dupCodes.some((c) => !okDup.has(c) && !before.some((b) => lc(b.code) === c))) return fail('verify', `รหัสซ้ำ: ${dupCodes.join(', ')}`);
  if (String(comp.$data.formData.typPublish) !== typPublish0) return fail('verify', 'สถานะขาย/ปิดขายเปลี่ยน — ไม่บันทึก');
  if (newTitle && (T(fd.spuTitle) !== newTitle || T(fd.spuName) !== newTitle)) return fail('verify', 'ใส่ชื่อสินค้าใหม่ไม่ติด');
  if (gallery.length && ((fd.mediaList || []).length !== gallery.length || !fd.imageUrl)) return fail('verify', 'รูปสินค้าในฟอร์มไม่ครบ');
  log.push(`ตรวจผ่าน: SKU เดิม ${all.filter((x) => x.itemId).length} ตัวไม่เปลี่ยน · แถวใหม่ ${plan.add.length} ตัวตรงแผน`);

  if (dry) {
    // ทดลองจบ = ทิ้งฟอร์ม — กันกล่อง "ออกจากหน้านี้ไหม" ค้างตอนส่วนขยายปิดแท็บ
    window.onbeforeunload = null;
    window.addEventListener('beforeunload', (e) => e.stopImmediatePropagation(), true);
    return { ok: true, dry: true, saved: false, added: plan.add.length, dropped, log };
  }

  // ── 9. บันทึก ──
  const pub = btnByText(document, /^Publish$/);
  if (pub.length !== 1) return fail('publish', 'ไม่เจอปุ่ม Publish');
  pub[0].click();
  let confirmed = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await sleep(500);
    if (/published successfully/i.test(document.body.innerText)) {
      log.push('Published successfully');
      return { ok: true, dry: false, saved: true, added: plan.add.length, dropped, log };
    }
    const err = [...document.querySelectorAll('.ant-message-error, .ant-message-warning, .ant-form-explain')].find(visible);
    if (err) return { ...fail('publish', `หลังบ้านไม่ยอมบันทึก: ${T(err.textContent).slice(0, 200)}`), saved: false };
    const modal = [...document.querySelectorAll('.ant-modal-wrap, .ant-modal-confirm')].find((e) => visible(e) && T(e.textContent));
    if (modal) {
      if (!confirmed && /classification/i.test(modal.textContent)) {
        const ok = btnByText(modal, /^OK$/)[0];
        if (ok) { ok.click(); confirmed = true; continue; }
      }
      if (!/classification/i.test(modal.textContent)) return fail('publish', `หลังบ้านถาม: ${T(modal.textContent).slice(0, 200)} — ยังไม่บันทึก ตรวจในแท็บที่เปิดค้างไว้`);
    }
  }
  return { ...fail('publish', 'กด Publish แล้วไม่ขึ้น "Published successfully" ใน 60 วินาที — ตรวจในแท็บที่เปิดค้างไว้'), saved: null };
}

// ── ฝั่ง background ─────────────────────────────────────────────────────
async function imageB64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`โหลดรูป ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > 790 * 1024) throw new Error('รูปใหญ่เกิน 800KB');
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { b64: btoa(s), type: res.headers.get('content-type') || 'image/jpeg' };
}

async function openEdit(spu) {
  const t = await chrome.tabs.create({ url: EDIT_URL(spu), active: true });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); reject(new Error('เปิดหลังบ้าน ThisShop ไม่ขึ้นใน 60 วินาที')); }, 60000);
    function on(id, info) {
      if (id === t.id && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); resolve(); }
    }
    chrome.tabs.onUpdated.addListener(on);
  });
  return t.id;
}

function checkPlan(plan) {
  if (!plan || !/^\d+$/.test(String(plan.spuId || ''))) return 'แผนไม่มีเลขตะกร้า ThisShop';
  if (!Array.isArray(plan.tiers) || !plan.tiers.length || !Array.isArray(plan.add) || !Array.isArray(plan.keep)) return 'แผนไม่ครบ';
  if (!plan.add.length && !plan.info?.title && !plan.info?.images?.length) return 'แผนไม่มีอะไรให้ทำ';
  if (plan.add.some((a) => !a.code || !(a.price > 0) || !Array.isArray(a.values) || a.values.length !== plan.tiers.length)) return 'แผนมีแถวใหม่ที่ข้อมูลไม่ครบ';
  return null;
}

let running = false;
async function fillRun({ plan, dry = false }) {
  if (running) return { ok: false, error: 'กำลังเติมตะกร้าอื่นอยู่ — รอให้เสร็จก่อน' };
  const bad = checkPlan(plan);
  if (bad) return { ok: false, error: bad };
  running = true;
  const started = new Date().toISOString();
  const step = (text) => chrome.storage.local.set({ fillProgress: { text, spuId: plan.spuId, started } }).catch(() => {});
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  let tabId = null;
  let result;
  try {
    step('โหลดรูปจาก Shopee');
    const images = { opts: {}, gallery: [] };
    for (const a of plan.tiers[0].add) {
      if (!a.image) continue;
      try { images.opts[a.value] = await imageB64(a.image); } catch (e) { throw new Error(`โหลดรูปของ ${a.value} ไม่ได้: ${e.message}`); }
    }
    for (const [i, u] of (plan.info?.images || []).entries()) {
      try { images.gallery.push(await imageB64(u)); } catch (e) { throw new Error(`โหลดรูปสินค้ารูปที่ ${i + 1} ไม่ได้: ${e.message}`); }
    }
    step('เปิดหน้าแก้ไขสินค้าในหลังบ้าน ThisShop');
    tabId = await openEdit(plan.spuId);
    step(dry ? 'ทดลองกดในหน้าแก้ไข (ไม่บันทึก)' : 'กำลังเพิ่มตัวเลือกในหน้าแก้ไข');
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: pageFill, args: [plan, images, dry] });
    result = res?.result || { ok: false, error: 'หน้าแก้ไขไม่ตอบ' };
  } catch (e) {
    result = { ok: false, error: String(e.message || e) };
  } finally {
    clearInterval(keepAlive);
    running = false;
    // สำเร็จหรือทดลอง = ปิดแท็บ (ทดลอง → ทิ้งสิ่งที่กรอกไว้) · พัง = เปิดค้างไว้ให้ดู (ยังไม่บันทึก)
    if (tabId && result?.ok) chrome.tabs.remove(tabId).catch(() => {});
    await chrome.storage.local.remove('fillProgress');
  }
  result = { ...result, spuId: plan.spuId, dry, started, finished: new Date().toISOString() };
  await chrome.storage.local.set({ lastFill: result });
  return result;
}
