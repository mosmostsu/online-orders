const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const when = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '');

// รายการที่เปลี่ยน + SKU ที่ไม่มีใน ST — หัวคอลัมน์เดียวกับไฟล์ที่ Colab แนบเข้า Telegram
function downloadCsv(r) {
  const rows = ['sku,old,new,status', ...(r.changes || []).map(([s, o, n]) => `${String(s).replace(/,/g, ' ')},${o},${n},ok`)];
  if (r.missingList?.length) {
    rows.push('', 'sku_not_in_st,mvp_stock', ...r.missingList.map(([s, c]) => `${String(s).replace(/,/g, ' ')},${c}`));
  }
  const url = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  const t = new Date(r.finished || Date.now());
  a.href = url;
  a.download = `shopee_mvp_${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}_${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function show(r) {
  const box = $('last');
  const csv = $('csv');
  csv.style.display = r && ((r.changes || []).length || (r.missingList || []).length) ? 'block' : 'none';
  csv.onclick = () => downloadCsv(r);
  if (!r) { box.className = 'box'; box.textContent = 'ยังไม่เคยทำงาน'; return; }
  const head = `${r.trigger === 'auto' ? 'รอบ 20:00' : 'กดเอง'} · ${when(r.finished || r.started)}`;
  const lst = r.listings
    ? (r.listings.error ? `ส่งรายการสินค้าเข้า order-sync ไม่สำเร็จ: ${r.listings.error}` : `รายการสินค้า ${fmt(r.listings.saved)} ตะกร้า → order-sync แล้ว`)
    : null;
  if (!r.ok) {
    box.className = 'box err';
    box.textContent = [`${head}\nไม่สำเร็จ: ${r.error}`, lst].filter(Boolean).join('\n');
    return;
  }
  box.className = 'box ok';
  box.textContent = [
    head,
    r.changed ? `เปลี่ยน ${fmt(r.changed)} ตัวเลือก (ลด ${fmt(r.down)} / เพิ่ม ${fmt(r.up)}) จาก ${fmt(r.rows)}` : 'ตรงกับ ST อยู่แล้ว ไม่มีอะไรเปลี่ยน',
    r.upload ? `Shopee รับ ${fmt(r.upload.success)}/${fmt(r.upload.total)} สินค้า` : null,
    r.warn || null,
    r.missing ? `ไม่มีใน ST ${fmt(r.missing)} ตัว (คงค่าเดิม)` : null,
    r.stFileAt ? `ไฟล์ ST: ${when(r.stFileAt)}` : null,
    lst,
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
  chrome.runtime.sendMessage({ type: 'run' }, (r) => {
    $('run').disabled = false;
    $('run').textContent = 'อัปเดตคลังตอนนี้';
    show(r);
  });
};

$('save').onclick = () => {
  chrome.storage.local.set({ apiKey: $('key').value.trim(), apiBase: $('base').value.trim() }, () => {
    $('save').textContent = 'บันทึกแล้ว';
    setTimeout(() => { $('save').textContent = 'บันทึก'; }, 1500);
  });
};
