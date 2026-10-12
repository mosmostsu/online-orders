// สะพานระหว่างหน้าเว็บ order-sync (หน้า /compare) กับส่วนขยาย — รันในหน้า order-sync เท่านั้น (ดู manifest)
// หน้าเว็บส่ง window.postMessage({ source: 'order-sync', type, id, ... }) → ส่งต่อให้ background → ตอบกลับด้วย source 'tm-ext'
//   tm-ping                 → tm-pong (บอกหน้าเว็บว่าติดตั้งส่วนขยายแล้ว)
//   tm-clone { ids, test }  → tm-result { result } · ระหว่างทำงานส่ง tm-progress { progress } มาเรื่อยๆ
//   tm-delete-test          → tm-result (ลบสินค้าทดสอบ [TEST] … -TEST)
const VERSION = chrome.runtime.getManifest().version;
const reply = (msg) => window.postMessage({ source: 'tm-ext', ...msg }, location.origin);

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'order-sync') return;
  const { type, id } = e.data;
  if (type === 'tm-ping') { reply({ type: 'tm-pong', id, version: VERSION }); return; }
  if (type === 'tm-clone') {
    chrome.runtime.sendMessage({ type: 'clone', ids: e.data.ids || [], test: e.data.test === true, base: location.origin },
      (result) => reply({ type: 'tm-result', id, result: result || { ok: false, error: chrome.runtime.lastError?.message || 'ส่วนขยายไม่ตอบ' } }));
    return;
  }
  if (type === 'tm-delete-test') {
    chrome.runtime.sendMessage({ type: 'clone-delete-test' },
      (result) => reply({ type: 'tm-result', id, result: result || { ok: false, error: chrome.runtime.lastError?.message || 'ส่วนขยายไม่ตอบ' } }));
  }
});

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.cloneProgress) reply({ type: 'tm-progress', progress: ch.cloneProgress.newValue || null });
});
