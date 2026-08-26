// Tema claro/oscuro.
//
// Se guarda en localStorage y no en IndexedDB a proposito: localStorage es
// sincrono, asi el mini-script de index.html puede aplicar el tema ANTES del
// primer pintado y la app no destella en oscuro al abrir en modo claro.

const CLAVE = 'tema';

export function temaActual() {
  try { return localStorage.getItem(CLAVE) === 'claro' ? 'claro' : 'oscuro'; }
  catch (e) { return 'oscuro'; }
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
