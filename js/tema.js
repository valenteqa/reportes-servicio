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

  try { localStorage.setItem(CLAVE, tema); } catch (e) {}
}

export function alternarTema() {
  const nuevo = temaActual() === 'claro' ? 'oscuro' : 'claro';
  aplicarTema(nuevo);
  return nuevo;
}

/* Zoom de interfaz: "normal" o "grande" (+50%, fotos igual). Tambien en
   localStorage para aplicarlo antes del primer pintado (script del head). */

const CLAVE_ZOOM = 'zoomUI';

export function zoomActual() {
  try { return localStorage.getItem(CLAVE_ZOOM) === 'grande' ? 'grande' : 'normal'; }
  catch (e) { return 'normal'; }
}

export function aplicarZoom(z) {
  if (z === 'grande') document.documentElement.dataset.zoomui = 'grande';
  else delete document.documentElement.dataset.zoomui;
  try { localStorage.setItem(CLAVE_ZOOM, z); } catch (e) {}
}
