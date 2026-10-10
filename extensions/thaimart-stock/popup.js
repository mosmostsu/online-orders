const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const when = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '');

// รายการที่เปลี่ยน + SKU ที่ไม่มีใน ST — หัวคอลัมน์เดียวกับไฟล์ของ mvp-stock
function downloadCsv(r) {
  const c = (x) => String(x ?? '').replace(/[,\r\n]/g, ' ');
  const rows = ['sku,old,new,status,name,variant', ...(r.changes || []).map(([s, o, n, nm, vr]) => `${c(s)},${o},${n},ok,${c(nm)},${c(vr)}`)];
  if (r.missingList?.length) {
    rows.push('', 'sku_not_in_st,thaimart_stock', ...r.missingList.map(([s, c]) => `${String(s).replace(/,/g, ' ')},${c}`));
  }
  const url = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  const t = new Date(r.finished || Date.now());
  a.href = url;
  a.download = `thaimart_${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}_${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const lst = (r) => (r.listings ? (r.listings.error ? `ส่งรายการสินค้าเข้า order-sync ไม่สำเร็จ: ${r.listings.error}` : `รายการสินค้า ${fmt(r.listings.saved)} ตะกร้า → order-sync แล้ว`) : null);
const tg = (r) => (r.telegram ? (r.telegram.sent ? 'ส่งรายงานเข้า Telegram แล้ว' : `ส่ง Telegram ไม่สำเร็จ: ${r.telegram.error || 'ไม่ทราบสาเหตุ'}`) : null);

// รายการที่เปลี่ยน: [sku, เดิม, ใหม่, ชื่อสินค้า, ตัวเลือก] แสดงสูงสุด 300 แถวต่อครั้ง (ค้นหาได้)
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function renderChanges(list, q) {
  const k = String(q || '').trim().toLowerCase();
  const hit = k ? list.filter((c) => c.slice(0, 5).join(' ').toLowerCase().includes(k)) : list;
  $('chgList').innerHTML = hit.slice(0, 300).map(([sku, o, n, name, variant]) =>
    `<div class="row"><b>${esc(sku)}</b> ${o} → <span class="${n > o ? 'up' : 'dn'}">${n}</span>`
    + (name ? `<span class="nm">${esc(name)}${variant ? ' · ' + esc(variant) : ''}</span>` : '') + '</div>').join('')
    + (hit.length > 300 ? `<div class="row">… อีก ${fmt(hit.length - 300)} รายการ (ค้นหาหรือโหลด CSV)</div>` : '')
    || '<div class="row">ไม่พบ</div>';
}

function show(r) {
  const box = $('last');
  const csv = $('csv');
  const changes = r?.changes || [];
  csv.style.display = r && (changes.length || (r.missingList || []).length) ? 'block' : 'none';
  csv.onclick = () => downloadCsv(r);
  $('chg').style.display = changes.length ? 'block' : 'none';
  if (changes.length) {
    $('chgTitle').textContent = `รายการที่เปลี่ยน (${fmt(changes.length)})`;
    $('q').oninput = () => renderChanges(changes, $('q').value);
    renderChanges(changes, '');
  }
  if (!r) { box.className = 'box'; box.textContent = 'ยังไม่เคยทำงาน'; return; }
  const head = `กดเอง · ${when(r.finished || r.started)}`;
  if (!r.ok) {
    box.className = 'box err';
    box.textContent = `${head}\nไม่สำเร็จ: ${r.error}` + (r.upload ? `\nบันทึกแล้ว ${fmt(r.upload.success)}/${fmt(r.upload.total)} สินค้า` : '') + (tg(r) ? '\n' + tg(r) : '');
    return;
  }
  box.className = 'box ok';
  box.textContent = [
    head,
    r.changed ? `เปลี่ยน ${fmt(r.changed)} ตัวเลือก (ลด ${fmt(r.down)} / เพิ่ม ${fmt(r.up)}) จาก ${fmt(r.rows)}` : 'ตรงกับ ST อยู่แล้ว ไม่มีอะไรเปลี่ยน',
    r.upload ? `Thaimart รับ ${fmt(r.upload.success)}/${fmt(r.upload.total)} สินค้า` : null,
    r.missing ? `ไม่มีใน ST ${fmt(r.missing)} ตัว (คงค่าเดิม)` : null,
    r.stFileAt ? `ไฟล์ ST: ${when(r.stFileAt)}` : null,
    lst(r),
    tg(r),
  ].filter(Boolean).join('\n');
}

chrome.storage.local.get(['lastRun', 'apiKey', 'apiBase'], (s) => {
  show(s.lastRun);
  $('key').value = s.apiKey || '';
  $('base').value = s.apiBase || '';
  if (!s.apiKey) $('cfg').open = true;
});

$('run').onclick = () => {
  $('run').disabled = true;
  $('run').textContent = 'กำลังทำงาน… (1-3 นาที)';
  chrome.runtime.sendMessage({ type: 'run', force: $('force').checked }, (r) => {
    $('run').disabled = false;
    $('run').textContent = 'อัปเดตคลังตอนนี้';
    show(r);
  });
};

$('save').onclick = () => {
  const key = $('key').value.trim();
  if (/[^\x21-\x7e]/.test(key)) {
    $('save').textContent = 'กุญแจต้องเป็นอังกฤษ/ตัวเลขเท่านั้น';
    setTimeout(() => { $('save').textContent = 'บันทึก'; }, 2500);
    return;
  }
  chrome.storage.local.set({ apiKey: key, apiBase: $('base').value.trim() }, () => {
    $('save').textContent = 'บันทึกแล้ว';
    setTimeout(() => { $('save').textContent = 'บันทึก'; }, 1500);
  });
};
