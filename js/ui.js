// Utilidades de interfaz: construccion de DOM, formatos, hojas modales y avisos.

/* ---------------------------------------------------------------- */
/* Construccion de DOM                                               */
/* ---------------------------------------------------------------- */

/**
 * h('div.tarjeta', { onclick }, 'texto', otroNodo)
 * El primer argumento acepta 'tag.clase1.clase2' o 'tag#id'.
 */
export function h(selector, props, ...hijos) {
  let tag = 'div', clases = [], id = null;

  const m = String(selector).match(/^([a-zA-Z0-9-]*)((?:[.#][^.#]+)*)$/);
  if (m) {
    if (m[1]) tag = m[1];
    const resto = m[2] || '';
    for (const parte of resto.split(/(?=[.#])/)) {
      if (!parte) continue;
      if (parte[0] === '.') clases.push(parte.slice(1));
      else if (parte[0] === '#') id = parte.slice(1);
    }
  } else {
    tag = selector;
  }

  const el = document.createElement(tag);
  if (clases.length) el.className = clases.join(' ');
  if (id) el.id = id;

  if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
    for (const [clave, valor] of Object.entries(props)) {
      if (valor === null || valor === undefined || valor === false) continue;
      if (clave === 'class' || clave === 'className') {
        el.className = (el.className ? el.className + ' ' : '') + valor;
      } else if (clave === 'style' && typeof valor === 'object') {
        Object.assign(el.style, valor);
      } else if (clave === 'dataset' && typeof valor === 'object') {
        Object.assign(el.dataset, valor);
      } else if (clave.startsWith('on') && typeof valor === 'function') {
        el.addEventListener(clave.slice(2).toLowerCase(), valor);
      } else if (clave === 'texto') {
        el.textContent = valor;
      } else if (clave === 'html') {
        el.innerHTML = valor;
      } else if (clave in el && clave !== 'list') {
        el[clave] = valor;
      } else {
        el.setAttribute(clave, valor === true ? '' : valor);
      }
    }
  } else if (props !== null && props !== undefined) {
    hijos.unshift(props);
  }

  const agregar = (hijo) => {
    if (hijo === null || hijo === undefined || hijo === false || hijo === true) return;
    if (Array.isArray(hijo)) { hijo.forEach(agregar); return; }
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  };
  hijos.forEach(agregar);

  return el;
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

// Iconos SVG de sistema (el h() no crea nodos SVG, van por innerHTML).
// "compartir" es el simbolo estandar de Android; "descargar" la flecha a la bandeja.
const ICONOS = {
  compartir: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>',
  descargar: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
  // Girar pantalla: dos flechas de rotacion minimalistas (trazo, esquinas rectas).
  girar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M19.6 10 A 8 8 0 0 0 6 5.8"/><path d="M6 1.6 V 5.8 H 10.2"/><path d="M4.4 14 A 8 8 0 0 0 18 18.2"/><path d="M18 22.4 V 18.2 H 13.8"/></svg>',
};

export function icono(nombre) {
  return h('span.icono-svg', { innerHTML: ICONOS[nombre] || '' });
}

/* Velo de ocupado: cubre TODA la pantalla con un mensaje y un spinner
   mientras corre un trabajo pesado (procesar una foto, guardar la edicion).
   Bloquea los toques: sin el, el usuario cree que la app no respondio y
   vuelve a picarle, causando capturas dobles y guardados encimados. */

let velo = null;

export function ocupado(mensaje) {
  if (!velo) {
    velo = h('div.velo',
      h('div.velo__caja', h('span.velo__giro'), h('span.velo__texto')));
    document.body.appendChild(velo);
  }
  velo.querySelector('.velo__texto').textContent = mensaje || 'Trabajando...';
  velo.style.display = '';
  document.body.appendChild(velo);   // siempre hasta arriba de la capa actual
}

export function libre() {
  if (velo) velo.style.display = 'none';
}

/* Orientacion de pantalla: la app va anclada a vertical (manifest); el visor
   de fotos y las tablas LIBERAN el giro del telefono o fuerzan horizontal. */

// En el APK el candado del navegador NO existe (el WebView no lo trae):
// la orientacion la manda la Activity, via el plugin nativo (APK 1.12+).
const orientacionNativa = () =>
  (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ScreenOrientation) || null;

export async function orientarLibre() {
  const SO = orientacionNativa();
  if (SO) {
    try { await SO.unlock(); return true; } catch (e) { /* sigue el camino web */ }
  }
  try { await screen.orientation.lock('any'); return true; }
  catch (e) { return false; }
}

export async function orientarHorizontal() {
  const SO = orientacionNativa();
  if (SO) {
    try { await SO.lock({ orientation: 'landscape' }); return true; } catch (e) { /* camino web */ }
  }
  try { await screen.orientation.lock('landscape'); return true; }
  catch (e) {
    // En pestaña de navegador el bloqueo exige pantalla completa.
    try {
      await document.documentElement.requestFullscreen();
      await screen.orientation.lock('landscape');
      return true;
    } catch (e2) { return false; }
  }
}

export function orientarNormal() {
  const SO = orientacionNativa();
  if (SO) {
    // La app vive anclada a vertical: volver ahi al salir de la pantalla.
    SO.lock({ orientation: 'portrait' }).catch(() => {});
    return;
  }
  try { screen.orientation.unlock(); } catch (e) {}
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

export function vaciar(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Animaciones de la marca (logo y nombre): cada toque sortea una distinta,
// con su sonido goofy tambien al azar. Reinicia aunque se toque en rafaga.
const ANIMS_MARCA = ['marca-animada', 'marca-gira', 'marca-brinca', 'marca-tiembla', 'marca-late', 'marca-voltea', 'marca-vuela'];
const SONIDOS_MARCA = ['bruh', 'pato', 'corriendo', 'quepaso', 'rudo', 'djstop', 'grito', 'espera', 'dios', 'esponja', 'despegue']
  .map(n => 'sonidos/' + n + '.mp3');
let audioMarca = null;
let corteMarca = null;

// POZO precargado: crear el Audio en el toque tardaba tanto (buscar el mp3
// y decodificarlo) que el sonido llegaba cuando la animacion ya acababa.
// Precargados, el play() del toque arranca de inmediato.
let pozoMarca = null;
function pozoDeSonidos() {
  if (!pozoMarca) {
    pozoMarca = SONIDOS_MARCA.map(src => {
      const a = new Audio(src);
      a.preload = 'auto';
      return a;
    });
  }
  return pozoMarca;
}
setTimeout(() => { try { pozoDeSonidos(); } catch (e) { /* sin audio */ } }, 1500);

export function animarMarca(...els) {
  const anim = ANIMS_MARCA[Math.floor(Math.random() * ANIMS_MARCA.length)];
  // En el vuelo el logo cruza TODA la pantalla: sin barras de desborde.
  if (anim === 'marca-vuela') {
    document.documentElement.classList.add('sin-desborde-vuelo');
    setTimeout(() => document.documentElement.classList.remove('sin-desborde-vuelo'), 3000);
  }
  for (const el of els) {
    if (!el) continue;
    el.classList.remove(...ANIMS_MARCA);
    void el.offsetWidth;   // fuerza reinicio de la animacion
    el.classList.add(anim);
    el.addEventListener('animationend', () => el.classList.remove(anim), { once: true });
  }
  // Suena AL INSTANTE (pozo precargado); en rafaga corta al anterior, y se
  // detiene solo a los 4 segundos. Si el sistema lo bloquea, silencio.
  try {
    if (audioMarca) audioMarca.pause();
    clearTimeout(corteMarca);
    const pozo = pozoDeSonidos();
    audioMarca = pozo[Math.floor(Math.random() * pozo.length)];
    audioMarca.currentTime = 0;
    audioMarca.play().catch(() => {});
    corteMarca = setTimeout(() => { if (audioMarca) audioMarca.pause(); }, 4000);
  } catch (e) { /* sin audio */ }
}

/* ---------------------------------------------------------------- */
/* Formatos                                                          */
/* ---------------------------------------------------------------- */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function hora(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function fecha(ts) {
  const d = new Date(ts);
  return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
}

export function fechaHora(ts) {
  return fecha(ts) + ' ' + hora(ts);
}

export function duracion(desde, hasta) {
  const ms = (hasta || Date.now()) - desde;
  const min = Math.floor(ms / 60000);
  if (min < 60) return min + ' min';
  const hrs = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? hrs + ' h ' + resto + ' min' : hrs + ' h';
}

export function relativo(ts) {
  if (!ts) return '';
  const seg = Math.floor((Date.now() - ts) / 1000);
  if (seg < 60) return 'hace un momento';
  if (seg < 3600) return 'hace ' + Math.floor(seg / 60) + ' min';
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  if (ts >= hoy.getTime()) return 'hoy ' + hora(ts);
  const ayer = hoy.getTime() - 86400000;
  if (ts >= ayer) return 'ayer ' + hora(ts);
  return fecha(ts);
}

/* ---------------------------------------------------------------- */
/* Avisos                                                            */
/* ---------------------------------------------------------------- */

let contenedorAvisos = null;

export function aviso(texto, tipo = 'info') {
  if (!contenedorAvisos) {
    contenedorAvisos = h('div.avisos');
    document.body.appendChild(contenedorAvisos);
  }
  const el = h('div.aviso.aviso--' + tipo, texto);
  contenedorAvisos.appendChild(el);
  requestAnimationFrame(() => el.classList.add('aviso--visible'));
  setTimeout(() => {
    el.classList.remove('aviso--visible');
    setTimeout(() => el.remove(), 300);
  }, tipo === 'error' ? 4500 : 2600);
}

/* ---------------------------------------------------------------- */
/* Pila de capas: el boton atras del telefono cierra la capa de      */
/* hasta arriba (hoja o visor), no navega. Cada capa apila una       */
/* entrada fantasma en el historial; solo la capa superior responde  */
/* al popstate — si todas escucharan, un atras las cerraria todas.   */
/* ---------------------------------------------------------------- */

const capas = [];
let consumiendoFantasma = false;

// Bloqueo de scroll con contador: con capas anidadas (hoja sobre hoja,
// visor sobre galeria), cerrar la de arriba no debe liberar el fondo.
let bloqueos = 0;
export function bloquearScroll() {
  bloqueos++;
  document.body.classList.add('sin-scroll');
}
export function liberarScroll() {
  bloqueos = Math.max(0, bloqueos - 1);
  if (!bloqueos) document.body.classList.remove('sin-scroll');
}

window.addEventListener('popstate', () => {
  if (consumiendoFantasma) return;
  const tope = capas[capas.length - 1];
  if (tope) tope.cerrarPorBack();
});

export function anclarCapa(cerrarPorBack) {
  const entrada = { cerrarPorBack };
  capas.push(entrada);
  history.pushState({ capa: capas.length }, '');
  let viva = true;

  const desapilar = () => {
    const i = capas.indexOf(entrada);
    if (i > -1) capas.splice(i, 1);
  };

  return {
    // La cerro el boton atras: el navegador ya consumio el fantasma.
    desdePop() { if (!viva) return; viva = false; desapilar(); },

    // Cierre manual (boton, tocar fuera, Escape): consumir el fantasma
    // nosotros y esperar a que termine, para que una navegacion posterior
    // del que llamo no se cruce con el history.back().
    liberar() {
      if (!viva) return Promise.resolve();
      viva = false;
      desapilar();
      consumiendoFantasma = true;
      return new Promise((fin) => {
        let hecho = false;
        const listo = () => {
          if (hecho) return;
          hecho = true;
          consumiendoFantasma = false;
          window.removeEventListener('popstate', listo);
          fin();
        };
        window.addEventListener('popstate', listo);
        setTimeout(listo, 350);
        history.back();
      });
    },
  };
}

/* ---------------------------------------------------------------- */
/* Hoja modal (bottom sheet)                                         */
/* ---------------------------------------------------------------- */

/**
 * Abre una hoja desde abajo. `construir(cerrar)` devuelve el contenido.
 * Resuelve con lo que se pase a cerrar(valor), o null si se descarta.
 */
export function hoja(titulo, construir, { altura = 'auto' } = {}) {
  return new Promise((resolve) => {
    let resuelto = false;
    let porBack = false;

    const ancla = anclarCapa(() => { porBack = true; cerrar(null); });

    const cerrar = async (valor = null) => {
      if (resuelto) return;
      resuelto = true;
      fondo.classList.remove('hoja-fondo--visible');
      panel.classList.remove('hoja--visible');
      setTimeout(() => { fondo.remove(); liberarScroll(); }, 240);
      if (porBack) ancla.desdePop();
      else await ancla.liberar();
      resolve(valor);
    };

    const cuerpo = h('div.hoja__cuerpo');
    const panel = h('div.hoja', { style: altura === 'alta' ? { height: '90vh' } : null },
      h('div.hoja__asa'),
      h('header.hoja__titulo',
        h('h2', titulo),
        h('button.icono-btn', { type: 'button', 'aria-label': 'Cerrar', onclick: () => cerrar(null) }, '✕')
      ),
      cuerpo
    );

    const fondo = h('div.hoja-fondo', {
      onclick: (ev) => { if (ev.target === fondo) cerrar(null); }
    }, panel);

    cuerpo.append(construir(cerrar));
    document.body.appendChild(fondo);
    bloquearScroll();

    requestAnimationFrame(() => {
      fondo.classList.add('hoja-fondo--visible');
      panel.classList.add('hoja--visible');
      const primero = cuerpo.querySelector('input, textarea');
      if (primero && !primero.readOnly) setTimeout(() => primero.focus(), 260);
    });

    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') { cerrar(null); document.removeEventListener('keydown', esc); }
      if (resuelto) document.removeEventListener('keydown', esc);
    });
  });
}

export function confirmar(mensaje, { textoOk = 'Eliminar', peligro = true } = {}) {
  return hoja('Confirmar', (cerrar) => h('div',
    h('p.parrafo', mensaje),
    h('div.hoja__acciones',
      h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(false) }, 'Cancelar'),
      h('button.btn' + (peligro ? '.btn--peligro' : '.btn--primario'),
        { type: 'button', onclick: () => cerrar(true) }, textoOk)
    )
  )).then(r => r === true);
}

/* ---------------------------------------------------------------- */
/* Campos de formulario                                              */
/* ---------------------------------------------------------------- */

export function campo(etiqueta, props = {}) {
  const entrada = h('input.campo__entrada', Object.assign({ type: 'text' }, props));
  const cont = h('label.campo', h('span.campo__etiqueta', etiqueta), entrada);
  cont.entrada = entrada;
  return cont;
}

/**
 * Campo de texto con lista desplegable de opciones guardadas.
 * - `fuente.opciones()` se llama en cada foco/tecleo: devuelve las opciones
 *   vigentes (ya en orden alfabetico); aqui solo se filtran por lo escrito.
 * - Elegir una llama `fuente.alElegir(valor)`.
 * - Siempre se puede escribir un valor nuevo: la lista solo sugiere.
 * La lista se despliega EN el flujo (no flotante) para que no la recorte el
 * scroll de la hoja ni la tape el teclado.
 */
export function campoLista(etiqueta, props = {}, fuente = {}) {
  const entrada = h('input.campo__entrada',
    Object.assign({ type: 'text', autocomplete: 'off' }, props));
  const panel = h('div.despliegue', { style: { display: 'none' } });
  const cont = h('label.campo', h('span.campo__etiqueta', etiqueta), entrada, panel);
  cont.entrada = entrada;

  const cerrar = () => { panel.style.display = 'none'; };

  const abrir = async () => {
    let ops = [];
    try { ops = (await (fuente.opciones ? fuente.opciones() : [])) || []; } catch (e) {}
    const texto = entrada.value.trim().toLowerCase();
    if (texto) ops = ops.filter(o => o.toLowerCase().includes(texto));
    ops = ops.slice(0, 8);
    if (!ops.length) { cerrar(); return; }

    panel.replaceChildren(...ops.map(o => h('button.despliegue__op', {
      type: 'button',
      // preventDefault en pointerdown: que el toque no dispare el blur del
      // campo antes de que llegue el click.
      onpointerdown: (ev) => ev.preventDefault(),
      onclick: () => {
        entrada.value = o;
        cerrar();
        if (fuente.alElegir) fuente.alElegir(o);
      },
    }, o)));
    panel.style.display = '';
  };

  entrada.addEventListener('focus', abrir);
  entrada.addEventListener('input', abrir);
  entrada.addEventListener('blur', () => setTimeout(cerrar, 160));
  return cont;
}

export function campoArea(etiqueta, props = {}) {
  const entrada = h('textarea.campo__entrada.campo__entrada--area', Object.assign({ rows: 4 }, props));
  const cont = h('label.campo', h('span.campo__etiqueta', etiqueta), entrada);
  cont.entrada = entrada;
  return cont;
}

export function vacio(icono, titulo, detalle) {
  return h('div.vacio', h('div.vacio__icono', icono), h('h3', titulo), detalle ? h('p', detalle) : null);
}
