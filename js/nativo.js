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

/* La carpeta propia de la app en el telefono: Documentos/ReportesServicio.
   Ahi caen los respaldos y una copia de cada foto que se toma, visibles
   desde la app Archivos del telefono. */

const CARPETA = 'ReportesServicio';

export function nombreSeguro(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60) || 'sin-nombre';
}

const MIMES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
};

// Via oficial de Android (MediaStore, puente del cascaron): la UNICA que
// acepta DOCUMENTOS (.docx/.zip) en Documentos sin permisos. Por trozos,
// para no cruzar archivos grandes en un solo string. Preferimos el plugin
// Capacitor "Puente" (APK 1.5+, sin carreras de arranque); si el cascaron
// es 1.4, cae a la interfaz vieja ArchivosNativos.
async function guardarPorMediaStore(blob, ruta) {
  const corte = ruta.lastIndexOf('/');
  const nombre = corte === -1 ? ruta : ruta.slice(corte + 1);
  const subruta = corte === -1 ? '' : ruta.slice(0, corte);
  const ext = (nombre.split('.').pop() || '').toLowerCase();
  const mime = MIMES[ext] || 'application/octet-stream';
  const TROZO = 768 * 1024;

  const Puente = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Puente;
  if (Puente && Puente.msAbrir) {
    const { id } = await Puente.msAbrir({ nombre, subruta, mime });
    try {
      for (let i = 0; i < blob.size; i += TROZO) {
        await Puente.msEscribir({ id, datos: await aBase64(blob.slice(i, i + TROZO)) });
      }
      await Puente.msCerrar({ id });
      return 'Documents/' + CARPETA + '/' + ruta;
    } catch (e) {
      try { await Puente.msCancelar({ id }); } catch (e2) {}
      throw e;
    }
  }

  const AN = window.ArchivosNativos;
  if (!AN || !AN.abrir) throw new Error('sin puente de archivos');
  const id = AN.abrir(nombre, subruta, mime);
  if (String(id).indexOf('ERROR') === 0) throw new Error('MediaStore: ' + id);
  try {
    for (let i = 0; i < blob.size; i += TROZO) {
      const b64 = await aBase64(blob.slice(i, i + TROZO));
      const r = AN.escribir(id, b64);
      if (String(r).indexOf('ERROR') === 0) throw new Error('MediaStore: ' + r);
    }
    const fin = AN.cerrar(id);
    if (String(fin).indexOf('ERROR') === 0) throw new Error('MediaStore: ' + fin);
    return 'Documents/' + CARPETA + '/' + ruta;
  } catch (e) {
    try { AN.cancelar(id); } catch (e2) {}
    throw e;
  }
}

/* Copia privada del ULTIMO respaldo, en el almacen interno de la app: con
   ella "Restaurar" puede ofrecer el ultimo respaldo sin pedir buscar el
   archivo. Solo una copia (se sobreescribe); si la app se desinstala se
   pierde, pero el respaldo real de Documentos/ReportesServicio/ sobrevive
   y queda la via "Buscar otro archivo". */

export async function guardarUltimoRespaldo(blob) {
  const P = window.Capacitor.Plugins;
  await P.Filesystem.writeFile({
    path: 'ultimo-respaldo.zip',
    data: await aBase64(blob),
    directory: 'DATA',
  });
}

export async function leerUltimoRespaldo() {
  const P = window.Capacitor.Plugins;
  const r = await P.Filesystem.readFile({ path: 'ultimo-respaldo.zip', directory: 'DATA' });
  const bin = atob(r.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'application/zip' });
}

// Guarda el blob en Documentos/ReportesServicio/<ruta> (crea las carpetas).
// Primero la ruta directa del plugin (rapida; imagenes siempre pasan); si
// Android la niega (EACCES con .docx/.zip en varios equipos), MediaStore.
export async function guardarEnCarpetaNativa(blob, ruta) {
  const P = window.Capacitor.Plugins;
  const path = CARPETA + '/' + ruta;
  try {
    const datos = await aBase64(blob);
    return (await P.Filesystem.writeFile({
      path, data: datos, directory: 'DOCUMENTS', recursive: true,
    })).uri;
  } catch (e) {
    // Android nego la ruta directa. Si el cascaron no trae NINGUN puente de
    // MediaStore, es un APK viejo: decirlo CLARO en vez del EACCES criptico.
    const hayPuente = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Puente) || window.ArchivosNativos;
    if (!hayPuente && !/jpe?g|png$/i.test(ruta)) {
      throw new Error('Este telefono necesita el APK 1.5 para guardar documentos en la carpeta. Instala ReportesServicio-v1.5.apk (o usa Compartir).');
    }
    try {
      return await guardarPorMediaStore(blob, ruta);
    } catch (e2) {
      // Android viejo (sin MediaStore moderno): pedir permiso y reintentar directo.
      try { await P.Filesystem.requestPermissions(); } catch (e3) {}
      const datos = await aBase64(blob);
      return (await P.Filesystem.writeFile({
        path, data: datos, directory: 'DOCUMENTS', recursive: true,
      })).uri;
    }
  }
}
