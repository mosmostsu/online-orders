// สะพานระหว่างหน้าเว็บ order-sync (หน้า /compare) กับส่วนขยาย ThisShop Fill — รันในหน้า order-sync เท่านั้น
// หน้าเว็บส่ง window.postMessage({ source: 'order-sync', type, id, ... }) → background → ตอบกลับด้วย source 'tsfill-ext'
//   tsfill-ping              → tsfill-pong (บอกว่าติดตั้งแล้ว)
//   tsfill-run { plan, dry } → tsfill-result { result } · ระหว่างทำงานส่ง tsfill-progress
const VERSION = chrome.runtime.getManifest().version;
const reply = (msg) => window.postMessage({ source: 'tsfill-ext', ...msg }, location.origin);

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'order-sync') return;
  const { type, id } = e.data;
  if (type === 'tsfill-ping') { reply({ type: 'tsfill-pong', id, version: VERSION }); return; }
  if (type === 'tsfill-run') {
    chrome.runtime.sendMessage({ type: 'fill', plan: e.data.plan, dry: e.data.dry === true },
      (result) => reply({ type: 'tsfill-result', id, result: result || { ok: false, error: chrome.runtime.lastError?.message || 'ส่วนขยายไม่ตอบ' } }));
  }
});

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.fillProgress) reply({ type: 'tsfill-progress', progress: ch.fillProgress.newValue || null });
});
