// Puente nativo: cuando la app corre dentro del cascaron Android (APK con
// Capacitor), window.Capacitor existe y podemos compartir CUALQUIER archivo
// por el menu nativo de Android — sin la lista de tipos de Chrome que
// bloquea Word y PowerPoint. En navegador normal, esNativa() es false y
// todo sigue por el camino web de siempre.

export function esNativa() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform());
}

function aBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(blob);
  });
}

// Escribe el blob al cache de la app nativa y abre el share sheet con el.
export async function compartirArchivoNativo(blob, nombre, titulo) {
  const P = window.Capacitor.Plugins;
  const datos = await aBase64(blob);
  const escrito = await P.Filesystem.writeFile({
    path: nombre,
    data: datos,
    directory: 'CACHE',
  });
  await P.Share.share({ title: titulo || nombre, files: [escrito.uri] });
}
