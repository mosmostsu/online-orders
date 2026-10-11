// service worker แบบง่าย: เก็บเปลือกหน้าเว็บไว้เปิดเร็ว/ติดตั้งได้ ส่วน apps.json ดึงสดก่อนเสมอ
const CACHE = "samchai-portal-v1";
const SHELL = ["./", "index.html", "app.js", "auth.js", "firebase-config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  // เครือข่ายก่อน ล้มเหลวค่อยใช้แคช — แก้ apps.json แล้วเห็นผลทันที
  e.respondWith(fetch(r).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(r, copy));
    return res;
  }).catch(() => caches.match(r)));
});
