// Captura y procesado de fotos.
//
// Las fotos de un celular moderno pesan 3-5 MB cada una. Un servicio con 40 fotos
// serian ~180 MB en el telefono y un Word imposible de mandar por correo.
// Aqui se reescalan a 1600 px de lado mayor y JPEG 82%: ~350 KB por foto,
// mas que suficiente para leer un manometro o una etiqueta en el reporte.

const LADO_MAX   = 1600;
const CALIDAD    = 0.82;
const LADO_MINI  = 320;
const CALIDAD_MINI = 0.7;

/**
 * Abre la camara del telefono (o la galeria) y devuelve los archivos elegidos.
 * Se usa un <input type=file> en vez de getUserMedia a proposito: asi se usa
 * la app de camara real del telefono, con su enfoque, HDR y flash.
 */
export function elegirImagenes({ camara = true, multiple = false, alRegresar = null } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camara) input.capture = 'environment';
    if (multiple) input.multiple = true;
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    document.body.appendChild(input);

    let resuelto = false;
    const terminar = (archivos) => {
      if (resuelto) return;
      resuelto = true;
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVisible);
      clearTimeout(topeFinal);
      input.remove();
      resolve(archivos);
    };

    input.addEventListener('change', () => terminar(Array.from(input.files || [])));
    // Chrome moderno avisa la cancelacion REAL del selector con este evento.
    input.addEventListener('cancel', () => terminar([]));

    // Al volver de la camara, Chrome puede tardar VARIOS segundos en poblar
    // input.files. Se sondea con paciencia y si no llega NO se declara
    // cancelacion (eso descartaba fotos lentas): 'change'/'cancel' siguen
    // escuchando. Ultimo recurso a los 2 minutos para no colgar la promesa.
    let sondeando = false;
    let avisado = false;
    const alVolver = () => {
      if (resuelto) return;
      // Avisar al que llamo que YA volvimos de la camara/galeria: asi puede
      // poner su velo de "Procesando..." ANTES de que llegue el archivo
      // (ese hueco mostraba la pantalla anterior y parecia que fallo).
      if (!avisado && alRegresar) { avisado = true; try { alRegresar(); } catch (e) {} }
      if (sondeando) return;
      sondeando = true;
      let intentos = 0;
      const sondeo = setInterval(() => {
        if (resuelto) { clearInterval(sondeo); return; }
        if (input.files && input.files.length) {
          clearInterval(sondeo);
          terminar(Array.from(input.files));
          return;
        }
        if (++intentos >= 15) { clearInterval(sondeo); sondeando = false; }
      }, 300);
    };
    const alVisible = () => { if (document.visibilityState === 'visible') alVolver(); };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVisible);
    const topeFinal = setTimeout(() => terminar([]), 120000);

    input.click();
  });
}

async function aBitmap(archivo) {
  if (window.createImageBitmap) {
    try {
      // 'from-image' respeta la orientacion EXIF: sin esto las fotos verticales
      // salen acostadas en el reporte.
      return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    } catch (e) { /* cae al metodo de abajo */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen ilegible')); };
    img.src = url;
  });
}

function escalar(origen, ladoMax, calidad) {
  const w0 = origen.width, h0 = origen.height;
  const factor = Math.min(1, ladoMax / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * factor));
  const h = Math.max(1, Math.round(h0 * factor));

  const lienzo = document.createElement('canvas');
  lienzo.width = w;
  lienzo.height = h;
  // willReadFrequently: el lienzo queda en memoria normal (no GPU). Sin esto,
  // toBlob debe LEER los pixeles desde la GPU y en el WebView de Android esa
  // lectura tarda SEGUNDOS (medido: 13 s por foto). 'medium' y no 'high' por
  // la misma razon: la ruta 'high' del WebView es de software y lentisima.
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(origen, 0, 0, w, h);

  return codificar(lienzo, calidad).then(blob => ({ blob, w, h, lienzo }));
}

// Convierte el lienzo a JPEG por la via SINCRONA (toDataURL): las vias
// asincronas (toBlob / convertToBlob) pasan por una cola interna del motor
// que en varios WebView se atora SEGUNDOS por foto (medido: 11 ms contra
// 13,000 ms en el mismo telefono). Si algo falla, cae a toBlob.
export async function codificarJpeg(lienzo, calidad) {
  try {
    const durl = lienzo.toDataURL('image/jpeg', calidad);
    if (durl && durl.indexOf('data:image/jpeg') === 0) {
      const b64 = durl.slice(durl.indexOf(',') + 1);
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: 'image/jpeg' });
    }
  } catch (e) { /* cae a toBlob */ }
  return new Promise((resolve) => {
    lienzo.toBlob(resolve, 'image/jpeg', calidad);
  });
}
const codificar = codificarJpeg;

/**
 * Toma el archivo crudo de la camara y devuelve el registro listo para guardar:
 * imagen para el reporte + miniatura para la lista.
 *
 * La miniatura se saca de la imagen ya reducida, no del original de 12 MP:
 * reescalar dos veces el archivo completo duplicaba el tiempo por foto.
 */
/* Lee ancho/alto y orientacion EXIF de un JPEG SIN decodificarlo (solo el
   encabezado). Con eso se puede pedir la decodificacion YA REDUCIDA, que en
   una foto de 50 MP se salta ~95% del trabajo. Devuelve null si no es JPEG
   o el encabezado no se entiende (y se usa la ruta lenta de siempre). */
async function dimsJpeg(archivo) {
  try {
    const buf = new Uint8Array(await archivo.slice(0, 262144).arrayBuffer());
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;   // no es JPEG
    let i = 2;
    let orientacion = 1;
    while (i + 8 < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const marca = buf[i + 1];
      if (marca === 0xD8 || (marca >= 0xD0 && marca <= 0xD9)) { i += 2; continue; }
      const largo = (buf[i + 2] << 8) | buf[i + 3];
      // EXIF (APP1): buscar la etiqueta de orientacion 0x0112
      if (marca === 0xE1 && buf[i + 4] === 0x45 && buf[i + 5] === 0x78) {   // "Ex"
        const tiff = i + 10;
        const le = buf[tiff] === 0x49;                     // little endian
        const u16 = (o) => le ? buf[o] | (buf[o + 1] << 8) : (buf[o] << 8) | buf[o + 1];
        const u32 = (o) => le
          ? buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)
          : (buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
        const ifd = tiff + u32(tiff + 4);
        if (ifd + 2 < buf.length) {
          const n = u16(ifd);
          for (let k = 0; k < n; k++) {
            const e = ifd + 2 + k * 12;
            if (e + 12 > buf.length) break;
            if (u16(e) === 0x0112) { orientacion = u16(e + 8) || 1; break; }
          }
        }
      }
      // SOF0..SOF15 (menos DHT/JPGA/DAC): dimensiones reales
      if (marca >= 0xC0 && marca <= 0xCF && marca !== 0xC4 && marca !== 0xC8 && marca !== 0xCC) {
        const alto = (buf[i + 5] << 8) | buf[i + 6];
        const ancho = (buf[i + 7] << 8) | buf[i + 8];
        if (!alto || !ancho) return null;
        return { ancho, alto, orientacion };
      }
      i += 2 + largo;
    }
    return null;
  } catch (e) { return null; }
}

export async function procesarImagen(archivo) {
  const t0 = performance.now();
  let bitmap = null;
  let ruta = 'lenta';

  // RUTA RAPIDA: decodificar ya reducido (el motor usa el escalado interno
  // del JPEG). En el WebView esto baja de ~13 s a ~1 s con fotos grandes.
  const dims = await dimsJpeg(archivo);
  if (dims && Math.max(dims.ancho, dims.alto) > LADO_MAX && window.createImageBitmap) {
    // Con orientacion EXIF de 90/270, el resultado orientado viene volteado.
    const giraEjes = dims.orientacion >= 5;
    const w0 = giraEjes ? dims.alto : dims.ancho;
    const h0 = giraEjes ? dims.ancho : dims.alto;
    const f = LADO_MAX / Math.max(w0, h0);
    try {
      bitmap = await createImageBitmap(archivo, {
        imageOrientation: 'from-image',
        resizeWidth: Math.max(1, Math.round(w0 * f)),
        resizeHeight: Math.max(1, Math.round(h0 * f)),
        resizeQuality: 'medium',
      });
      ruta = 'rapida';
    } catch (e) { bitmap = null; }
  }
  if (!bitmap) bitmap = await aBitmap(archivo);

  const t1 = performance.now();
  const grande = await escalar(bitmap, LADO_MAX, CALIDAD);
  if (bitmap.close) bitmap.close();
  const t2 = performance.now();

  // Miniatura en DOS pasos (1600→640→320): reducir 5x de un jalon con
  // 'medium' deja serrucho; el paso intermedio lo elimina y cuesta ~10ms.
  const medio = await escalar(grande.lienzo, 640, 0.9);
  const mini = await escalar(medio.lienzo, LADO_MINI, CALIDAD_MINI);

  return {
    blob:  grande.blob,
    ancho: grande.w,
    alto:  grande.h,
    mini:  mini.blob,
    bytes: grande.blob.size,
    original: archivo.size,
    creado: Date.now(),
    // cronometro de diagnostico (no se guarda en la base)
    _ms: { decodificar: Math.round(t1 - t0), escalar: Math.round(t2 - t1), ruta },
  };
}

/* URLs de objeto con limpieza automatica, para no fugar memoria al navegar. */
const urlsVivas = new Set();

export function urlDe(blob) {
  const url = URL.createObjectURL(blob);
  urlsVivas.add(url);
  return url;
}

export function liberarUrls() {
  for (const url of urlsVivas) URL.revokeObjectURL(url);
  urlsVivas.clear();
}

export function formatoBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}
