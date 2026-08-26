// Service worker: hace que la app abra sin señal.
//
// Estrategia:
//   - El "cascaron" (HTML, CSS, JS, iconos) se precachea al instalar y se sirve
//     desde cache. En una planta sin señal la app abre igual de rapido.
//   - Los datos del usuario NO pasan por aqui: viven en IndexedDB.
//
// Al cambiar cualquier archivo hay que subir VERSION para que el telefono
// reemplace el cache viejo.

const VERSION = 'v1';
const CACHE = 'reportes-' + VERSION;

const CASCARON = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/ui.js',
  'js/media.js',
  'js/vistas/servicios.js',
  'js/vistas/servicio.js',
  'js/vistas/equipo.js',
  'js/vistas/eventos.js',
  'js/vistas/tabla.js',
  'icons/icono-192.png',
  'icons/icono-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      // addAll falla entero si un archivo falta; se agregan uno por uno para
      // que un icono ausente no deje la app sin cache.
      .then(cache => Promise.all(CASCARON.map(
        url => cache.add(url).catch(e => console.warn('[sw] no cacheado:', url, e.message))
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then(claves => Promise.all(
        claves.filter(c => c.startsWith('reportes-') && c !== CACHE).map(c => caches.delete(c))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegaciones: intentar red, caer al index cacheado si no hay señal.
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req)
        .then(res => {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put('index.html', copia));
          return res;
        })
        .catch(() => caches.match('index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Recursos: se responde al instante desde cache (rapido y funciona sin señal)
  // y en paralelo se baja la version fresca para la proxima apertura.
  //
  // Con cache-primero a secas, una correccion subida al hosting no llegaba nunca
  // al telefono si se olvidaba subir VERSION. Asi las actualizaciones entran
  // solas, con un ciclo de retraso, sin depender de que yo me acuerde.
  ev.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(enCache => {
        const desdeRed = fetch(req).then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            cache.put(req, res.clone());
          }
          return res;
        }).catch(() => enCache);

        return enCache || desdeRed;
      })
    )
  );
});
