// Service worker: hace que la app abra sin señal y que las actualizaciones
// publicadas lleguen solas al telefono.
//
// Estrategia:
//   - El "cascaron" (HTML, CSS, JS, iconos) se precachea al instalar, pidiendo
//     cada archivo con cache:'no-cache' para saltarse el cache HTTP de GitHub
//     Pages (10 min) y traer siempre lo ultimo publicado.
//   - En uso normal responde desde cache al instante (rapido y offline) y
//     refresca en segundo plano bajo ev.waitUntil — sin waitUntil, el navegador
//     puede matar el worker antes de que termine de guardar la version nueva,
//     y el telefono se queda con la vieja para siempre.
//   - Los datos del usuario NO pasan por aqui: viven en IndexedDB.
//
// Subir VERSION en cada publicacion (junto con APP_VERSION en js/version.js):
// eso dispara un re-precacheo completo, que es la via mas confiable.

const VERSION = 'v217';
const CACHE = 'reportes-' + VERSION;

const CASCARON = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/version.js',
  'js/tema.js',
  'js/nativo.js',
  'js/reporte.js',
  'js/respaldo.js',
  'js/editor-foto.js',
  'js/presentacion.js',
  'js/db.js',
  'js/ui.js',
  'js/media.js',
  'js/cameos.js',
  'js/organizacion.js',
  'js/vistas/menu.js',
  'js/vistas/diario.js',
  'js/vistas/ventas.js',
  'js/vistas/servicios.js',
  'js/vistas/servicio.js',
  'js/vistas/eventos.js',
  'js/vistas/tabla.js',
  'js/vistas/previa.js',
  'icons/icono-192.png',
  'icons/icono-512.png',
  'icons/icono-maskable-512.png',
  'icons/logo-serpro.png',
  'fonts/orbitron.woff2',
  'fonts/roboto-condensed.woff2',
  // Sonidos goofy del logo: tambien sin señal.
  'sonidos/pato.mp3',
  'sonidos/corriendo.mp3',
  'sonidos/quepaso.mp3',
  'sonidos/rudo.mp3',
  'sonidos/djstop.mp3',
  'sonidos/grito.mp3',
  'sonidos/dios.mp3',
  'sonidos/golpe.mp3',
  'sonidos/resorte.mp3',
  'sonidos/jazz.mp3',
  'cameos/cameo1.webp',
  'cameos/cameo2.webp',
  'cameos/cameo3.webp',
  'cameos/cameo4.webp',
  'cameos/cameo5.webp',
  'cameos/toasty.mp3',
  'cameos/cumbion.mp3',
  'cameos/gta.mp3',
  'cameos/bruh2.mp3',
  'cameos/nonono.mp3',
  // Plantilla del reporte Word (logos, estilos, marca de agua): sin esto
  // el modo plantilla no funciona sin señal.
  'plantilla/app-props.xml',
  'plantilla/core.xml',
  'plantilla/ct.xml',
  'plantilla/cx-item.xml',
  'plantilla/cx-props.xml',
  'plantilla/cx-rels.xml',
  'plantilla/doc-plantilla.xml',
  'plantilla/document.xml.rels',
  'plantilla/endnotes.xml',
  'plantilla/fontTable.xml',
  'plantilla/footer1.xml',
  'plantilla/footer2.xml',
  'plantilla/footer3.xml',
  'plantilla/footnotes.xml',
  'plantilla/header1.xml',
  'plantilla/header2.xml',
  'plantilla/header2.xml.rels',
  'plantilla/header3.xml',
  'plantilla/logo14.png',
  'plantilla/logo15.jpeg',
  'plantilla/logo16.png',
  'plantilla/manifest.json',
  'plantilla/numbering.xml',
  'plantilla/numbering.xml.rels',
  'plantilla/rels-raiz.xml',
  'plantilla/settings.xml',
  'plantilla/styles.xml',
  'plantilla/theme1.xml',
  'plantilla/vineta.png',
  'plantilla/webSettings.xml',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      // ATOMICO: si un archivo definitivamente no llega, la instalacion
      // completa falla y el telefono se queda con la version anterior
      // integra (un cache a medias arrancaba la app rota). PERO un tropiezo
      // de red ya no tumba todo: cada archivo reintenta hasta 3 veces con
      // pausa, y se bajan EN FILA de a 6 — los ~80 fetches simultaneos de
      // antes ahogaban la conexion del telefono, un solo fallo descartaba
      // la version entera y la flota se quedaba pegada en la vieja.
      .then(async (cache) => {
        const pendientes = [...CASCARON];
        const traerUno = async (url) => {
          for (let intento = 0; ; intento++) {
            try {
              await cache.add(new Request(url, { cache: 'no-cache' }));
              return;
            } catch (e) {
              if (intento >= 2) throw e;
              await new Promise(r => setTimeout(r, 500 * (intento + 1)));
            }
          }
        };
        const obreros = Array.from({ length: 6 }, async () => {
          while (pendientes.length) await traerUno(pendientes.shift());
        });
        await Promise.all(obreros);
      })
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

  // Navegaciones: red primero, caer al index cacheado si no hay señal.
  if (req.mode === 'navigate') {
    ev.respondWith((async () => {
      try {
        const res = await fetch(req);
        const copia = res.clone();
        ev.waitUntil(caches.open(CACHE).then(c => c.put('index.html', copia)));
        return res;
      } catch (e) {
        const enCache = await caches.match('index.html');
        return enCache || caches.match('./');
      }
    })());
    return;
  }

  // Recursos: cache primero, red de respaldo. SIN refresco por archivo:
  // mezclaba modulos de dos versiones en un mismo cache (un js viejo
  // importando exports nuevos truena). La actualizacion llega completa y
  // atomica con el precacheo de cada VERSION nueva.
  ev.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const enCache = await cache.match(req);
    return enCache || fetch(req);
  })());
});
