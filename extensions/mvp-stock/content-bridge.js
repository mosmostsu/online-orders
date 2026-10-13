// สะพานระหว่างหน้าเว็บ order-sync (หน้า /compare กลุ่ม MVP) กับส่วนขยาย MVP Stock Sync — รันในหน้า order-sync เท่านั้น
// หน้าเว็บส่ง window.postMessage({ source: 'order-sync', type, id, ... }) → background → ตอบกลับด้วย source 'mvp-ext'
//   mvp-ping                 → mvp-pong (บอกว่าติดตั้งแล้ว — ต้องเป็นโปรไฟล์ที่ล็อกอิน Seller Center ร้าน MVP)
//   mvp-clone { ids, categoryIds } → mvp-result { result } · ระหว่างทำงานส่ง mvp-progress
const VERSION = chrome.runtime.getManifest().version;
const reply = (msg) => window.postMessage({ source: 'mvp-ext', ...msg }, location.origin);

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'order-sync') return;
  const { type, id } = e.data;
  if (type === 'mvp-ping') { reply({ type: 'mvp-pong', id, version: VERSION }); return; }
  if (type === 'mvp-clone') {
    chrome.runtime.sendMessage({ type: 'clone', ids: e.data.ids || [], categoryIds: e.data.categoryIds || {}, test: e.data.test === true, base: location.origin },
      (result) => reply({ type: 'mvp-result', id, result: result || { ok: false, error: chrome.runtime.lastError?.message || 'ส่วนขยายไม่ตอบ' } }));
  }
});

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.cloneProgress) reply({ type: 'mvp-progress', progress: ch.cloneProgress.newValue || null });
});
