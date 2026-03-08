const CACHE_NAME = 'nexusnas-v2';
const SHELL_ASSETS = [
    '/',
    '/static/css/style.css?v=2',
    '/static/js/app.js?v=2',
    '/static/manifest.json',
    '/static/img/icon-192.png',
    '/static/img/icon-512.png'
];

// Install — cache app shell + force activate
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(SHELL_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// Activate — clean ALL old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch — network first for everything, fallback cache
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // API calls & uploads: always network
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // All assets: network first, fallback cache
    event.respondWith(
        fetch(event.request).then(res => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            return res;
        }).catch(() => caches.match(event.request))
    );
});
