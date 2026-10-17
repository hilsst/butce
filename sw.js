const CACHE = "butce-v5";
const FILES = ["./", "index.html", "style.css", "app.js", "sync.js", "firebase-config.js", "kart.js", "fis.js", "ocr/tesseract.min.js", "seed.js", "xlsx.full.min.js", "manifest.webmanifest", "icon.svg"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
// Önce ağ, olmazsa önbellek: güncellemeler hemen gelir, internetsiz de açılır.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
