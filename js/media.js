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
export function elegirImagenes({ camara = true, multiple = false } = {}) {
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
      input.remove();
      resolve(archivos);
    };

    input.addEventListener('change', () => terminar(Array.from(input.files || [])));
    // Si el usuario cancela, 'change' nunca dispara. Se limpia al volver el foco.
    window.addEventListener('focus', () => {
      setTimeout(() => { if (!input.files || !input.files.length) terminar([]); }, 600);
    }, { once: true });

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
  const ctx = lienzo.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(origen, 0, 0, w, h);

  return new Promise((resolve) => {
    lienzo.toBlob(blob => resolve({ blob, w, h, lienzo }), 'image/jpeg', calidad);
  });
}

/**
 * Toma el archivo crudo de la camara y devuelve el registro listo para guardar:
 * imagen para el reporte + miniatura para la lista.
 *
 * La miniatura se saca de la imagen ya reducida, no del original de 12 MP:
 * reescalar dos veces el archivo completo duplicaba el tiempo por foto.
 */
export async function procesarImagen(archivo) {
  const bitmap = await aBitmap(archivo);
  const grande = await escalar(bitmap, LADO_MAX, CALIDAD);
  if (bitmap.close) bitmap.close();

  const mini = await escalar(grande.lienzo, LADO_MINI, CALIDAD_MINI);

  return {
    blob:  grande.blob,
    ancho: grande.w,
    alto:  grande.h,
    mini:  mini.blob,
    bytes: grande.blob.size,
    original: archivo.size,
    creado: Date.now(),
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
