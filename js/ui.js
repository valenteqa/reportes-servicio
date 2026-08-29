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
const ANIMS_MARCA = ['marca-animada', 'marca-gira', 'marca-brinca', 'marca-tiembla', 'marca-late', 'marca-voltea', 'marca-vuela', 'marca-vibra', 'marca-cae', 'marca-rudo', 'marca-pato'];
const SONIDOS_MARCA = ['pato', 'corriendo', 'quepaso', 'rudo', 'djstop', 'grito', 'dios']
  .map(n => 'sonidos/' + n + '.mp3');
let audioMarca = null;
let corteMarca = null;
let patoMarca = null;   // chillido del pato agendado para el rebote de la caida

// Capa "rudo": lentes de sol y cigarro montados ENCIMA del logo mientras
// suena el riff; se retira cuando el sonido termina (o el corte).
let capaRudo = null;
function quitarRudo() {
  if (capaRudo) { capaRudo.remove(); capaRudo = null; }
}

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

let retrasoAnimMarca = null;

// Nombres para el ensayo del logo.
const MARCAS_PROBADOR = [
  ['marca-animada', 'Pulso'],
  ['marca-gira', 'Giro doble (dj stop)'],
  ['marca-brinca', 'Brinco'],
  ['marca-tiembla', 'Tembleque'],
  ['marca-late', 'Latido'],
  ['marca-voltea', 'Voltereta 3D'],
  ['marca-vuela', 'Vuelo (disparado)'],
  ['marca-vibra', 'What the hell (crece, mini y vibra)'],
  ['marca-cae', 'Caida (grito y pato)'],
  ['marca-rudo', 'Rudo (lentes y cigarro)'],
  ['marca-pato', 'Patito de hule (pato)'],
];

// Nombres de los sonidos, en el MISMO orden que SONIDOS_MARCA.
const SONIDOS_NOMBRES = ['Pato', 'Corriendo (pasos + disparo)', 'What the hell',
  'Rudo', 'DJ stop', 'Grito', 'Dios'];

// Ensayo del logo: pantalla dedicada con fondo blanco. Tocar una ANIMACION
// la corre sola (en silencio) y la deja elegida; tocar un SONIDO lo hace
// sonar Y corre la animacion elegida al mismo tiempo, para revisar las
// parejas una por una.
export function ensayoDeMarca() {
  return new Promise((resolve) => {
    let resuelto = false;
    let porBack = false;
    const ancla = anclarCapa(() => { porBack = true; cerrar(); });
    const cerrar = async () => {
      if (resuelto) return;
      resuelto = true;
      try { if (audioMarca) audioMarca.pause(); } catch (e) { /* sin audio */ }
      clearTimeout(corteMarca);
      clearTimeout(patoMarca);
      quitarRudo();
      pantalla.remove();
      if (porBack) ancla.desdePop();
      else await ancla.liberar();
      resolve();
    };

    let animSel = MARCAS_PROBADOR[0][0];
    // Tocar el logo corre la animacion elegida CON su sonido asignado
    // (la pareja real de la app, sin forzar indice).
    const logo = h('img.ensayo__logo', {
      src: 'icons/logo-serpro.png', alt: '',
      onclick: () => ejecutarMarca(animSel, [logo]),
    });
    // En el menu real el vuelo deja el logo IDO hasta reentrar; aqui en el
    // ensayo reaparece solito tras un respiro, para seguir probando. El
    // setTimeout(0) deja que el listener de ejecutarMarca ponga marca-ida
    // primero (corre despues de este, en orden de registro).
    logo.addEventListener('animationend', () => {
      setTimeout(() => {
        if (logo.classList.contains('marca-ida')) {
          setTimeout(() => logo.classList.remove('marca-ida'), 650);
        }
      }, 0);
    });

    // El chip SOLO elige; la animacion corre al tocar el logo o un sonido.
    const chips = MARCAS_PROBADOR.map(([clase, nombre]) =>
      h('button.chip-ensayo', {
        type: 'button',
        onclick: (ev) => {
          animSel = clase;
          for (const c of chips) c.classList.toggle('chip-ensayo--activo', c === ev.currentTarget);
        },
      }, nombre));
    chips[0].classList.add('chip-ensayo--activo');

    const pantalla = h('div.ensayo',
      h('header.ensayo__cabeza',
        h('button.ensayo__volver', { type: 'button', 'aria-label': 'Volver', onclick: () => cerrar() }, '←'),
        h('h2', 'Ensayo del logo')
      ),
      h('div.ensayo__centro',
        h('div.ensayo__escena', logo,
          h('p.ensayo__pista', 'Toca el logo: corre con su sonido asignado'))),
      h('div.ensayo__zona',
        h('p.ensayo__titulo', 'ANIMACION · elige una'),
        h('div.ensayo__chips', chips),
        h('p.ensayo__titulo', 'SONIDOS · suena y corre la animacion elegida'),
        h('div.ensayo__sonidos',
          SONIDOS_NOMBRES.map((nombre, i) =>
            h('button.boton-sonido', { type: 'button', onclick: () => ejecutarMarca(animSel, [logo], i) },
              '🔊 ' + nombre))
        )
      )
    );
    document.body.appendChild(pantalla);
  });
}

export function animarMarca(...els) {
  ejecutarMarca(ANIMS_MARCA[Math.floor(Math.random() * ANIMS_MARCA.length)], els);
}

// iSonido: indice para FORZAR un sonido (ensayo); null/ausente = pareja
// coreografiada o sorteo (uso normal).
function ejecutarMarca(anim, els, iSonido) {
  const esVuela = anim === 'marca-vuela';
  const esVibra = anim === 'marca-vibra';
  const esCae = anim === 'marca-cae';
  const esGira = anim === 'marca-gira';
  const esRudo = anim === 'marca-rudo';
  const esPato = anim === 'marca-pato';

  // En el vuelo y la caida el logo sale de la pantalla: sin barras de
  // desborde mientras dura.
  if (esVuela || esCae) {
    document.documentElement.classList.add('sin-desborde-vuelo');
    setTimeout(() => document.documentElement.classList.remove('sin-desborde-vuelo'), esCae ? 2900 : 1600);
  }

  const quitarVibra = () => els.forEach(el => el && el.classList.remove('marca-vibra'));

  // Parejas coreografiadas: vuelo↔pasos+disparo (exclusivos entre si) y
  // vibracion↔"what the hell" (vibra hasta que el sonido termina). El resto
  // de animaciones sortea los demas sonidos. El de DJ arranca medio segundo
  // ANTES del movimiento (asi caen a tiempo).
  let retrasoAnim = 0;
  quitarRudo();   // una corrida nueva limpia lentes/cigarro anteriores
  try {
    if (audioMarca) audioMarca.pause();
    clearTimeout(corteMarca);
    clearTimeout(patoMarca);
    const pozo = pozoDeSonidos();
    const iCorriendo = SONIDOS_MARCA.findIndex(s => s.includes('corriendo'));
    const iQuepaso = SONIDOS_MARCA.findIndex(s => s.includes('quepaso'));
    const iGrito = SONIDOS_MARCA.findIndex(s => s.includes('grito'));
    const iPato = SONIDOS_MARCA.findIndex(s => s.includes('pato'));
    const iDj = SONIDOS_MARCA.findIndex(s => s.includes('djstop'));
    const iRudo = SONIDOS_MARCA.findIndex(s => s.includes('rudo'));
    let i;
    if (iSonido != null) i = iSonido;
    else if (esVuela) i = iCorriendo;
    else if (esVibra) i = iQuepaso;
    else if (esCae) i = iGrito;
    else if (esGira) i = iDj;         // pareja fija: giro doble ↔ dj stop
    else if (esRudo) i = iRudo;       // pareja fija: rudo ↔ lentes y cigarro
    else if (esPato) i = iPato;       // pareja fija: patito de hule ↔ pato
    else {
      do { i = Math.floor(Math.random() * pozo.length); } while (i === iCorriendo || i === iQuepaso || i === iGrito || i === iDj || i === iRudo || i === iPato);
    }
    if (SONIDOS_MARCA[i].includes('djstop')) retrasoAnim = 500;
    audioMarca = pozo[i];
    audioMarca.currentTime = 0;
    audioMarca.play().catch(() => {});
    if (esVibra) audioMarca.addEventListener('ended', quitarVibra, { once: true });
    if (esRudo) audioMarca.addEventListener('ended', quitarRudo, { once: true });
    // Caida con su grito: el PATO se dispara 200ms antes del primer impacto
    // (2.10s de la coreografia) porque su primer chillido vive en 0.20-0.44s
    // del archivo; asi chilla EXACTO al rebote, y el segundo chillido
    // (0.48-0.60s) cae solo en el segundo rebote.
    if (esCae && SONIDOS_MARCA[i].includes('grito')) {
      patoMarca = setTimeout(() => {
        try {
          if (audioMarca) audioMarca.pause();
          audioMarca = pozo[iPato];
          audioMarca.currentTime = 0;
          audioMarca.play().catch(() => {});
        } catch (e) { /* sin audio */ }
      }, 1900);
    }
    // "What the hell" corta EXACTO al terminar el OH MY GOD (el "god" muere
    // en 4.88s medido en la onda; 4.9s deja la palabra completa y fuera las
    // risas). Los demas se cortan a los 4s.
    const tope = SONIDOS_MARCA[i].includes('quepaso') ? 4900 : 4000;
    corteMarca = setTimeout(() => {
      if (audioMarca) audioMarca.pause();
      quitarVibra();   // si el sonido se corto en el tope, la vibracion tambien
      quitarRudo();
    }, tope);
  } catch (e) { /* sin audio */ }

  const aplicar = () => {
    for (const el of els) {
      if (!el) continue;
      el.classList.remove('marca-ida', ...ANIMS_MARCA);
      void el.offsetWidth;   // fuerza reinicio de la animacion
      el.classList.add(anim);
      if (!esVibra) {
        el.addEventListener('animationend', () => {
          el.classList.remove(anim);
          // Tras el disparo ya no regresa: queda ido hasta reentrar aqui.
          if (esVuela) el.classList.add('marca-ida');
        }, { once: true });
      }
    }
    // Rudo: lentes y cigarro fijados SOBRE el logo. La capa corre la MISMA
    // pose (marcaRudo) que el logo y arranca en el mismo cuadro, asi se
    // ladean juntos. Se mide el rect ANTES de que la pose lo transforme.
    if (esRudo && els[0]) {
      const r = els[0].getBoundingClientRect();
      capaRudo = h('div.rudo-capa',
        h('div.rudo-lentes'),
        h('div.rudo-cigarro', h('div.rudo-humo'), h('div.rudo-humo'), h('div.rudo-humo')));
      Object.assign(capaRudo.style, {
        left: r.left + 'px', top: r.top + 'px',
        width: r.width + 'px', height: r.height + 'px',
      });
      document.body.appendChild(capaRudo);
    }
  };
  clearTimeout(retrasoAnimMarca);
  if (retrasoAnim) retrasoAnimMarca = setTimeout(aplicar, retrasoAnim);
  else aplicar();
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
