// service worker แบบง่าย: เปลือกหน้าเว็บเปิดจากแคชทันทีแล้วอัปเดตตามหลัง ส่วน apps.json ดึงสดก่อนเสมอ
const CACHE = "samchai-portal-v2";
const SHELL = ["./", "index.html", "app.js", "auth.js", "firebase-config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request;
  const url = new URL(r.url);
  if (r.method !== "GET" || url.origin !== location.origin) return;
  const fresh = fetch(r).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
    return res;
  });
  // apps.json: เครือข่ายก่อน ล้มเหลวค่อยใช้แคช — แก้ apps.json แล้วเห็นผลทันที
  if (url.pathname.endsWith("/apps.json")) return e.respondWith(fresh.catch(() => caches.match(r)));
  // ไฟล์อื่น: ใช้แคชก่อน (เปิดเร็ว) แล้วโหลดตัวใหม่เก็บไว้ใช้รอบหน้า — แก้โค้ดแล้วเห็นผลตอนเปิดครั้งที่สอง
  e.respondWith(caches.match(r).then(hit => {
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  }));
});
