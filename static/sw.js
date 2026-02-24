const CACHE_NAME = 'nexusnas-v1';
const SHELL_ASSETS = [
    '/',
    '/static/css/style.css',
    '/static/js/app.js',
    '/static/manifest.json',
    '/static/img/icon-192.png',
    '/static/img/icon-512.png'
];

// Install — cache app shell
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(SHELL_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch — network first for API, cache first for static
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // API calls & uploads: always network
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // Static assets: cache first, fallback network
    if (url.pathname.startsWith('/static/')) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                return cached || fetch(event.request).then(res => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return res;
                });
            })
        );
        return;
    }

    // HTML pages: network first, fallback cache
    event.respondWith(
        fetch(event.request).then(res => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            return res;
        }).catch(() => caches.match(event.request))
    );
});
