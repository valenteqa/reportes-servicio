// Arranque y ruteo.
//
// Rutas:
//   #/                      menu principal
//   #/t                     lista de trabajos (area del tecnico)
//   #/s/<sid>               arbol del trabajo (actividades y sus registros)
//   #/s/<sid>/t/<eventoId>  editor de tabla

import { h, aviso, vaciar } from './ui.js';
import * as media from './media.js';
import { temaActual, aplicarTema } from './tema.js';
import * as vistaMenu      from './vistas/menu.js';
import * as vistaServicios from './vistas/servicios.js';
import * as vistaServicio  from './vistas/servicio.js';
import * as vistaTabla     from './vistas/tabla.js';

const raiz = document.getElementById('app');
let pintando = false;

function analizarRuta() {
  const hash = location.hash.replace(/^#\/?/, '');
  const p = hash.split('/').filter(Boolean);

  if (!p.length) return { vista: 'menu', params: {} };
  if (p[0] === 't') return { vista: 'servicios', params: {} };
  if (p[0] === 's' && p[1]) {
    if (p[2] === 't' && p[3]) return { vista: 'tabla', params: { sid: p[1], eventoId: p[3] } };
    // '/e/<id>' era la vista por equipo; ahora todo vive en el arbol.
    return { vista: 'servicio', params: { sid: p[1] } };
  }
  return { vista: 'menu', params: {} };
}

const VISTAS = {
  menu:      vistaMenu,
  servicios: vistaServicios,
  servicio:  vistaServicio,
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
            type: 'button', onclick: () => { location.replace('#/'); }
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
// De paso, dejar registrado el usuario de la app (es el tecnico de los reportes).
async function protegerDatos() {
  try {
    const { pedirPersistencia, estadoAlmacenamiento, ajusteLeer, ajusteGuardar } = await import('./db.js');
    // Nombre completo: es el que se imprime como Tecnico en el reporte.
    // (Tambien actualiza el "Usuario" corto que sembraron versiones previas.)
    const usuario = await ajusteLeer('usuario');
    if (!usuario || usuario === 'Usuario') {
      await ajusteGuardar('usuario', 'Usuario');
    }
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

// El boton atras del telefono debe IR SALIENDO un nivel a la vez
// (tabla → arbol → lista → salir de la app), no recorrer todo lo visitado.
// Para eso el historial se reconstruye como la jerarquia al arrancar; de ahi
// en adelante entrar agrega un nivel y los botones "volver" usan history.back().
function cadenaDeRuta() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 's' && p[1]) {
    if (p[2] === 't' && p[3]) return ['#/', '#/t', '#/s/' + p[1], '#/s/' + p[1] + '/t/' + p[3]];
    return ['#/', '#/t', '#/s/' + p[1]];
  }
  if (p[0] === 't') return ['#/', '#/t'];
  return ['#/'];
}

const cadena = cadenaDeRuta();
if (cadena.length > 1) {
  // replaceState/pushState no disparan hashchange: se reescribe en silencio.
  history.replaceState(null, '', cadena[0]);
  for (let i = 1; i < cadena.length; i++) history.pushState(null, '', cadena[i]);
}

aplicarTema(temaActual());   // sincroniza meta theme-color con lo aplicado al arrancar
pintar();
protegerDatos();
registrarServiceWorker();
