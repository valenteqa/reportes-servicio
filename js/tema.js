// Tema claro/oscuro.
//
// Se guarda en localStorage y no en IndexedDB a proposito: localStorage es
// sincrono, asi el mini-script de index.html puede aplicar el tema ANTES del
// primer pintado y la app no destella en oscuro al abrir en modo claro.

const CLAVE = 'tema';

// El claro es el predeterminado (se trabaja a pleno sol en planta).
export function temaActual() {
  try { return localStorage.getItem(CLAVE) === 'oscuro' ? 'oscuro' : 'claro'; }
  catch (e) { return 'claro'; }
}

export function aplicarTema(tema) {
  const raiz = document.documentElement;
  if (tema === 'claro') raiz.dataset.tema = 'claro';
  else delete raiz.dataset.tema;

  // Color de la barra de estado de Android
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = tema === 'claro' ? '#eef1f4' : '#07090d';

  // Barra de estado NATIVA (APK 1.11+): iconos del sistema (hora, señal,
  // bateria) oscuros en tema claro y claros en oscuro. En navegador el
  // plugin no existe y se omite.
  try {
    const SB = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
    if (SB) {
      SB.setStyle({ style: tema === 'claro' ? 'LIGHT' : 'DARK' }).catch(() => {});
      if (SB.setBackgroundColor) SB.setBackgroundColor({ color: tema === 'claro' ? '#eef1f4' : '#07090d' }).catch(() => {});
    }
  } catch (e) { /* sin plugin */ }

  try { localStorage.setItem(CLAVE, tema); } catch (e) {}
}

export function alternarTema() {
  const nuevo = temaActual() === 'claro' ? 'oscuro' : 'claro';
  aplicarTema(nuevo);
  return nuevo;
}

/* Zoom de interfaz: normal, 110, 125 o 150 (%; fotos igual). Tambien en
   localStorage para aplicarlo antes del primer pintado (script del head). */

const CLAVE_ZOOM = 'zoomUI';
const ZOOMS = ['110', '125', '150'];

export function zoomActual() {
  try {
    let z = localStorage.getItem(CLAVE_ZOOM);
    if (z === 'grande') z = '150';   // valor de la version anterior
    return ZOOMS.includes(z) ? z : 'normal';
  } catch (e) { return 'normal'; }
}

export function aplicarZoom(z) {
  if (ZOOMS.includes(z)) document.documentElement.dataset.zoomui = z;
  else delete document.documentElement.dataset.zoomui;
  try { localStorage.setItem(CLAVE_ZOOM, z); } catch (e) {}
}
