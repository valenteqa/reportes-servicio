// Respaldo completo de la app a un ZIP, y restauracion desde el.
//
// El ZIP lleva:
//   datos.json          todos los registros (trabajos, ramas, eventos,
//                       catalogo, ajustes) y los METADATOS de las fotos
//   fotos/<id>.jpeg     la imagen de cada foto
//   minis/<id>.jpeg     su miniatura
//
// La restauracion es por id (put): restaurar el mismo respaldo dos veces no
// duplica nada, y un respaldo de otro telefono se MEZCLA con lo local.
// Tambien sirve para migrar de telefono.

import * as db from './db.js';
import { fabricarZip, leerZip } from './reporte.js';

const VERSION_RESPALDO = 1;

export async function crearRespaldo() {
  const volcado = await db.volcadoCompleto();

  // Solo fotos referenciadas por algun evento: una huerfana (por un guardado
  // interrumpido) no aporta nada y engordaria el respaldo.
  const referidas = new Set(volcado.eventos
    .filter(e => e.tipo === 'foto' && e.datos && e.datos.fotoId)
    .map(e => e.datos.fotoId));
  const fotos = (await db.todosDe('fotos')).filter(f => referidas.has(f.id));

  const entradas = [];
  const metaFotos = [];

  for (const f of fotos) {
    metaFotos.push({
      id: f.id, ancho: f.ancho, alto: f.alto,
      bytes: f.bytes, original: f.original, creado: f.creado,
    });
    entradas.push({ nombre: 'fotos/' + f.id + '.jpeg', datos: new Uint8Array(await f.blob.arrayBuffer()) });
    if (f.mini) entradas.push({ nombre: 'minis/' + f.id + '.jpeg', datos: new Uint8Array(await f.mini.arrayBuffer()) });
  }

  const datos = {
    formato: 'respaldo-reportes',
    version: VERSION_RESPALDO,
    exportado: Date.now(),
    ...volcado,
    fotosMeta: metaFotos,
  };
  entradas.unshift({ nombre: 'datos.json', datos: new TextEncoder().encode(JSON.stringify(datos)) });

  const blob = fabricarZip(entradas);
  const d = new Date();
  const nombreArchivo = 'respaldo-reportes-' + d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.zip';

  return {
    blob: new Blob([blob], { type: 'application/zip' }),
    nombreArchivo,
    resumen: {
      trabajos: volcado.servicios.length,
      registros: volcado.eventos.length,
      fotos: fotos.length,
    },
  };
}

export async function restaurarRespaldo(archivo) {
  const buf = new Uint8Array(await archivo.arrayBuffer());
  const entradas = leerZip(buf);

  if (!entradas['datos.json']) throw new Error('El ZIP no es un respaldo de esta app');
  const datos = JSON.parse(new TextDecoder().decode(entradas['datos.json']));
  if (datos.formato !== 'respaldo-reportes') throw new Error('El ZIP no es un respaldo de esta app');
  if (datos.version > VERSION_RESPALDO) throw new Error('Respaldo de una version mas nueva de la app: actualizala primero');

  const fotos = [];
  for (const m of (datos.fotosMeta || [])) {
    const img = entradas['fotos/' + m.id + '.jpeg'];
    if (!img) continue;   // metadato sin imagen: se omite
    const mini = entradas['minis/' + m.id + '.jpeg'];
    fotos.push({
      id: m.id,
      blob: new Blob([img], { type: 'image/jpeg' }),
      mini: mini ? new Blob([mini], { type: 'image/jpeg' }) : null,
      ancho: m.ancho, alto: m.alto, bytes: m.bytes, original: m.original, creado: m.creado,
    });
  }

  const n = await db.restaurarVolcado(datos, fotos);
  return {
    registros: n,
    trabajos: (datos.servicios || []).length,
    fotos: fotos.length,
    exportado: datos.exportado,
  };
}
