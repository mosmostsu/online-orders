const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const when = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '');

function show(r) {
  const box = $('last');
  if (!r) { box.className = 'box'; box.textContent = 'ยังไม่เคยทำงาน'; return; }
  const head = `${r.trigger === 'auto' ? 'รอบ 18:00' : 'กดเอง'} · ${when(r.finished || r.started)}`;
  if (!r.ok) {
    box.className = 'box err';
    box.textContent = `${head}\nไม่สำเร็จ: ${r.error}`;
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
