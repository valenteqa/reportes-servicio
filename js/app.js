// Arranque y ruteo.
//
// Rutas:
//   #/                      lista de servicios
//   #/s/<sid>               detalle del servicio (equipos / linea completa)
//   #/s/<sid>/e/<eid>       linea de tiempo de un equipo
//   #/s/<sid>/t/<eventoId>  editor de tabla

import { h, aviso, vaciar } from './ui.js';
import * as media from './media.js';
import * as vistaServicios from './vistas/servicios.js';
import * as vistaServicio  from './vistas/servicio.js';
import * as vistaEquipo    from './vistas/equipo.js';
import * as vistaTabla     from './vistas/tabla.js';

const raiz = document.getElementById('app');
let pintando = false;

function analizarRuta() {
  const hash = location.hash.replace(/^#\/?/, '');
  const p = hash.split('/').filter(Boolean);

  if (!p.length) return { vista: 'servicios', params: {} };
  if (p[0] === 's' && p[1]) {
    if (p[2] === 'e' && p[3]) return { vista: 'equipo', params: { sid: p[1], eid: p[3] } };
    if (p[2] === 't' && p[3]) return { vista: 'tabla',  params: { sid: p[1], eventoId: p[3] } };
    return { vista: 'servicio', params: { sid: p[1] } };
  }
  return { vista: 'servicios', params: {} };
}

const VISTAS = {
  servicios: vistaServicios,
  servicio:  vistaServicio,
  equipo:    vistaEquipo,
  tabla:     vistaTabla,
};

async function pintar() {
  if (pintando) return;
  pintando = true;

  const { vista, params } = analizarRuta();
  const modulo = VISTAS[vista] || VISTAS.servicios;

  try {
    vaciar(raiz);
    await modulo.render(raiz, pintar, params);
  } catch (err) {
    console.error(err);
    vaciar(raiz).append(
      h('div.contenido',
        h('div.vacio',
          h('div.vacio__icono', '⚠'),
          h('h3', 'Algo fallo al abrir esta pantalla'),
          h('p', String(err && err.message ? err.message : err)),
          h('button.btn.btn--primario', {
            type: 'button', onclick: () => { location.hash = '#/'; }
          }, 'Volver al inicio')
        )
      )
    );
  } finally {
    pintando = false;
  }
}

window.addEventListener('hashchange', pintar);

window.addEventListener('error', (ev) => {
  console.error(ev.error || ev.message);
});

// Al instalarse, pedir que Android no borre los datos por falta de espacio.
async function protegerDatos() {
  try {
    const { pedirPersistencia, estadoAlmacenamiento } = await import('./db.js');
    const info = await estadoAlmacenamiento();
    if (info.soportado && !info.persistente) await pedirPersistencia();
  } catch (e) { /* sin soporte */ }
}

async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');

    // Android suele "resumir" la app sin recargar la pagina, y ahi nunca se
    // buscaba la version nueva. Ahora se busca cada vez que la app vuelve a verse.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });

    // Cuando la version nueva toma el control, recargar para usarla ya —
    // salvo que haya una hoja abierta o algo a medio escribir.
    const primeraVez = !navigator.serviceWorker.controller;
    let recargado = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (primeraVez || recargado) return;
      recargado = true;
      const abierto = document.querySelector('.hoja-fondo, .visor');
      const tag = (document.activeElement || {}).tagName || '';
      if (abierto || tag === 'INPUT' || tag === 'TEXTAREA') {
        aviso('Hay una version nueva. Cierra y abre la app para verla.');
        return;
      }
      location.reload();
    });
  } catch (e) {
    console.warn('Service worker no registrado:', e.message);
  }
}

window.addEventListener('pagehide', () => media.liberarUrls());

pintar();
protegerDatos();
registrarServiceWorker();
