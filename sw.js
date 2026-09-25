// Guarda os arquivos do app para abrir mais rápido e funcionar com internet fraca.
// Mapas, endereços e rotas continuam vindo da internet.
const CACHE = 'rotacerta-v1';
const FILES = [
    './', 'index.html', 'app.css', 'app.js', 'solver.js', 'manifest.json', 'icon.svg',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    const isApp = url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com';
    if (e.request.method !== 'GET' || !isApp) return;
    // Rede primeiro (pega versão nova), cache se estiver sem internet.
    e.respondWith(
        fetch(e.request)
            .then(res => {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(e.request, copy));
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
