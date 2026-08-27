// Generador del reporte Word (.docx), 100% en el telefono y sin internet.
//
// Un .docx es un ZIP con XML adentro. Aqui se fabrican las dos cosas a mano:
// el ZIP (sin compresion: las fotos ya son JPEG y el XML pesa poco) y el
// OOXML con la estructura del reporte de referencia de GRUPO DE SERVICIOS:
//
//   encabezado "Reporte Complementario" + folio RCVQ-DDMMAA-N + fecha
//   tabla de datos (cliente, planta, maquina, serie, tecnico...)
//   CONTENIDO (indice de Word, se actualiza al abrir)
//   ANTECEDENTES  <- descripcion de la falla
//   ACTIVIDADES   <- rama General
//   una seccion por rama, con sus notas, tablas, fotos y pruebas
//   PENDIENTES / OBSERVACIONES / RECOMENDACIONES
//   pie de pagina con los datos de la empresa y numero de pagina

import * as db from './db.js';

export const EMPRESA = {
  titulo: 'GRUPO DE SERVICIOS Y PROCESOS PLÁSTICOS',
  razon: 'GRUPO DE SERVICIOS Y PROCESOS PLASTICOS, S.A. DE C.V.',
  direccion: 'MARTIN CHIMALTECATL NO. 211, BARRIO DE SANTA MARIA, C.P. 52740, OCOYOACAC, ESTADO DE MEXICO',
  telefono: 'TEL: +52 728 287 5381',
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function fechaLarga(ts) {
  const d = new Date(ts);
  return d.getDate() + ' de ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
}

export function folioDe(servicio) {
  const d = new Date(servicio.inicio);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const aa = String(d.getFullYear()).slice(2);
  return 'RCVQ-' + dd + mm + aa + '-0';
}

/* ---------------------------------------------------------------- */
/* ZIP sin compresion (STORE) con CRC-32                             */
/* ---------------------------------------------------------------- */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(datos) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function fabricarZip(entradas) {
  const ahora = new Date();
  const horaDos = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
  const fechaDos = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();

  const partes = [];
  const centrales = [];
  let offset = 0;

  for (const e of entradas) {
    const nombre = new TextEncoder().encode(e.nombre);
    const crc = crc32(e.datos);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true);           // metodo 0: sin compresion
    local.setUint16(10, horaDos, true);
    local.setUint16(12, fechaDos, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, e.datos.length, true);
    local.setUint32(22, e.datos.length, true);
    local.setUint16(26, nombre.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nombre, e.datos);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, horaDos, true);
    central.setUint16(14, fechaDos, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, e.datos.length, true);
    central.setUint32(24, e.datos.length, true);
    central.setUint16(28, nombre.length, true);
    central.setUint32(42, offset, true);
    centrales.push(new Uint8Array(central.buffer), nombre);

    offset += 30 + nombre.length + e.datos.length;
  }

  let tamCentral = 0;
  for (const c of centrales) tamCentral += c.length;

  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, entradas.length, true);
  fin.setUint16(10, entradas.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, offset, true);

  return new Blob([...partes, ...centrales, new Uint8Array(fin.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

/**
 * Lector de ZIP sin compresion (los que fabrica esta app). Devuelve
 * { nombre: Uint8Array }. Rechaza entradas comprimidas con mensaje claro.
 */
export function leerZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('No es un ZIP valido');

  const n = dv.getUint16(eocd + 8, true);
  let pos = dv.getUint32(eocd + 16, true);
  const entradas = {};
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error('ZIP corrupto');
    const metodo = dv.getUint16(pos + 10, true);
    const tam = dv.getUint32(pos + 20, true);
    const nLen = dv.getUint16(pos + 28, true);
    const eLen = dv.getUint16(pos + 30, true);
    const cLen = dv.getUint16(pos + 32, true);
    const off = dv.getUint32(pos + 42, true);
    const nombre = new TextDecoder().decode(buf.subarray(pos + 46, pos + 46 + nLen));
    if (metodo !== 0) throw new Error('Entrada comprimida no soportada: ' + nombre);
    const nLoc = dv.getUint16(off + 26, true);
    const eLoc = dv.getUint16(off + 28, true);
    const ini = off + 30 + nLoc + eLoc;
    entradas[nombre] = buf.subarray(ini, ini + tam);
    pos += 46 + nLen + eLen + cLen;
  }
  return entradas;
}

/* ---------------------------------------------------------------- */
/* Piezas OOXML                                                      */
/* ---------------------------------------------------------------- */

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Fuente de los runs generados: la del TEMA del documento (en la plantilla
// resuelve a la fuente de cuerpo de la casa), con Calibri de respaldo para el
// modo basico, que no trae tema. Sin esto los runs caian al docDefaults de la
// plantilla (Times New Roman) y se mezclaban fuentes.
const FUENTE_RUN = '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"' +
  ' w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>';

// Un parrafo. segmentos: string, o lista de {t, b (negrita), i (cursiva)}.
function par(segmentos, opts = {}) {
  const p = [];
  if (opts.estilo || opts.jc || opts.esp) {
    p.push('<w:pPr>');
    if (opts.estilo) p.push('<w:pStyle w:val="' + opts.estilo + '"/>');
    if (opts.esp) p.push('<w:spacing w:before="' + (opts.esp[0] || 0) + '" w:after="' + (opts.esp[1] || 0) + '"/>');
    if (opts.jc) p.push('<w:jc w:val="' + opts.jc + '"/>');
    p.push('</w:pPr>');
  }
  const lista = typeof segmentos === 'string' ? [{ t: segmentos }] : segmentos;
  for (const s of lista) {
    p.push('<w:r><w:rPr>');
    // En parrafos con estilo (titulos) manda el estilo, no se inyecta fuente.
    if (!opts.estilo) p.push(FUENTE_RUN);
    if (s.b) p.push('<w:b/>');
    if (s.i) p.push('<w:i/>');
    if (s.color) p.push('<w:color w:val="' + s.color + '"/>');
    if (s.sz) p.push('<w:sz w:val="' + s.sz + '"/><w:szCs w:val="' + s.sz + '"/>');
    p.push('</w:rPr><w:t xml:space="preserve">' + esc(s.t) + '</w:t></w:r>');
  }
  return '<w:p>' + p.join('') + '</w:p>';
}

function titulo1(texto) {
  return par(texto.toUpperCase(), { estilo: 'Heading1' });
}

// Texto libre: cada renglon del usuario es un parrafo.
function parrafosDe(texto, opts) {
  return String(texto || '').split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => par(l, opts)).join('');
}

function tablaXml(columnas, filas) {
  const nCols = Math.max(1, columnas.length);
  const ancho = Math.floor(9360 / nCols);
  const bordes =
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(b => '<w:' + b + ' w:val="single" w:sz="4" w:space="0" w:color="7F7F7F"/>').join('') +
    '</w:tblBorders>';

  const celda = (texto, cabecera) =>
    '<w:tc><w:tcPr><w:tcW w:w="' + ancho + '" w:type="dxa"/>' +
    (cabecera ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E4E8"/>' : '') +
    '</w:tcPr>' +
    par(cabecera ? [{ t: texto, b: true }] : String(texto || ''), { esp: [20, 20] }) +
    '</w:tc>';

  const filaCab = '<w:tr>' + columnas.map(c =>
    celda(c.nombre + (c.unidad ? ' (' + c.unidad + ')' : ''), true)).join('') + '</w:tr>';
  const cuerpo = filas.map(f =>
    '<w:tr>' + columnas.map((c, i) => celda(f[i], false)).join('') + '</w:tr>').join('');

  return '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/>' + bordes +
    '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' +
    columnas.map(() => '<w:gridCol w:w="' + ancho + '"/>').join('') +
    '</w:tblGrid>' + filaCab + cuerpo + '</w:tbl>';
}

// Tabla de datos del servicio: renglones etiqueta | valor.
function tablaDatos(pares) {
  const bordes =
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(b => '<w:' + b + ' w:val="single" w:sz="4" w:space="0" w:color="7F7F7F"/>').join('') +
    '</w:tblBorders>';
  const filas = pares.map(([k, v]) =>
    '<w:tr>' +
    '<w:tc><w:tcPr><w:tcW w:w="3120" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="D9E4E8"/></w:tcPr>' +
    par([{ t: k, b: true }], { esp: [20, 20] }) + '</w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="6240" w:type="dxa"/></w:tcPr>' +
    par(String(v || ''), { esp: [20, 20] }) + '</w:tc>' +
    '</w:tr>').join('');
  return '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/>' + bordes +
    '<w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3120"/><w:gridCol w:w="6240"/></w:tblGrid>' +
    filas + '</w:tbl>';
}

function imagenXml(relId, docPrId, anchoPx, altoPx) {
  const EMU_MAX = 5580000;                     // ~ancho util de la hoja
  const porPx = 9525;
  let cx = anchoPx * porPx;
  let cy = altoPx * porPx;
  if (cx > EMU_MAX) { cy = Math.round(cy * EMU_MAX / cx); cx = EMU_MAX; }
  // Namespaces declarados inline: el documento de plantilla no declara a:/pic:
  // en la raiz (Word los pone en cada drawing), asi la imagen es autonoma.
  return '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="40"/></w:pPr>' +
    '<w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
    '<wp:docPr id="' + docPrId + '" name="Figura ' + docPrId + '"/>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="' + docPrId + '" name="img' + docPrId + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

const XML_ESTILOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/>' +
  '</w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
  '</w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
  '<w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>' +
  '<w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/><w:color w:val="0D3B4A"/></w:rPr>' +
  '</w:style>' +
  '</w:styles>';

function xmlEncabezado(folio, fecha) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="7F7F7F"/></w:pBdr>' +
    '<w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr>' +
    '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Reporte Complementario   </w:t></w:r>' +
    '<w:r><w:t xml:space="preserve">' + esc(folio) + '   ·   ' + esc(fecha) + '</w:t></w:r>' +
    '</w:p></w:hdr>';
}

function xmlPie() {
  const linea = (txt, extra) =>
    '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr>' +
    '<w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="595959"/>' + (extra || '') + '</w:rPr>' +
    '<w:t xml:space="preserve">' + esc(txt) + '</w:t></w:r>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    linea(EMPRESA.razon, '<w:b/>') + '</w:p>' +
    linea(EMPRESA.direccion) + '</w:p>' +
    linea(EMPRESA.telefono + '  ·  Página ') +
    '<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="595959"/></w:rPr>' +
    '<w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    '</w:p></w:ftr>';
}

const XML_INDICE =
  // Titulo plano a proposito: con Heading1 se listaria a si mismo en el indice.
  par([{ t: 'CONTENIDO', b: true, sz: 26, color: '0D3B4A' }], { esp: [320, 120] }) +
  '<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-1" \\h \\z \\u </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:rPr><w:i/><w:color w:val="808080"/></w:rPr>' +
  '<w:t>El indice se llena solo: clic derecho aqui y "Actualizar campos".</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

/* ---------------------------------------------------------------- */
/* Armado del reporte a partir de los datos del trabajo              */
/* ---------------------------------------------------------------- */

/* ---------------------------------------------------------------- */
/* Modo plantilla: se rellena el .docx real de referencia, con sus   */
/* logos, marca de agua, viñetas y estilos intactos.                 */
/* ---------------------------------------------------------------- */

// Viñeta personalizada de la plantilla: numId 4 usa la viñeta con imagen.
function parVineta(texto) {
  return '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/>' +
    '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr></w:pPr>' +
    '<w:r><w:rPr>' + FUENTE_RUN + '</w:rPr>' +
    '<w:t xml:space="preserve">' + esc(texto) + '</w:t></w:r></w:p>';
}

let _plantilla = null;

async function cargarPlantilla() {
  if (_plantilla) return _plantilla;
  const base = new URL('../plantilla/', import.meta.url);
  const resp = await fetch(new URL('manifest.json', base));
  if (!resp.ok) throw new Error('manifest ' + resp.status);
  const manifest = await resp.json();

  const partes = await Promise.all(manifest.map(async (m) => {
    const r = await fetch(new URL(m.archivo, base));
    if (!r.ok) throw new Error(m.archivo + ' ' + r.status);
    return {
      zip: m.zip,
      texto: m.binario ? null : await r.text(),
      datos: m.binario ? new Uint8Array(await r.arrayBuffer()) : null,
    };
  }));

  _plantilla = partes;
  return partes;
}

function quitarFilaOpcional(xml, token) {
  const rx = new RegExp('<w:tr(?:(?!</w:tr>)[\\s\\S])*?\\{\\{' + token + '\\}\\}(?:(?!</w:tr>)[\\s\\S])*?</w:tr>');
  return xml.replace(rx, '');
}

export async function generarReporte(servicioId) {
  try {
    return await generarConPlantilla(servicioId);
  } catch (e) {
    console.warn('Plantilla no disponible, usando generador basico:', e.message);
    return generarReporteBasico(servicioId);
  }
}

async function generarConPlantilla(servicioId) {
  const partes = await cargarPlantilla();
  const servicio = await db.servicioLeer(servicioId);
  if (!servicio) throw new Error('Trabajo no encontrado');

  const actividades = await db.equiposDeServicio(servicioId);
  const eventos = (await db.eventosDeServicio(servicioId)).filter(e => e.incluir !== false);
  const porRama = {};
  for (const ev of eventos) (porRama[ev.equipoId] = porRama[ev.equipoId] || []).push(ev);

  if (!servicio.folio) {
    servicio.folio = folioDe(servicio);
    await db.servicioGuardar(servicio);
  }

  const imagenes = [];
  let nFigura = 0;

  const eventoXml = async (ev) => {
    if (ev.tipo === 'nota') return parrafosDe(ev.datos.texto);
    if (ev.tipo === 'tabla') {
      const t = ev.datos;
      let x = '';
      if (t.titulo) x += par([{ t: t.titulo, b: true }], { esp: [160, 60] });
      x += tablaXml(t.columnas || [], (t.filas || []).filter(f => f.some(c => String(c).trim() !== '')));
      x += par('', { esp: [0, 60] });
      return x;
    }
    if (ev.tipo === 'foto') {
      const foto = await db.fotoLeer(ev.datos.fotoId);
      if (!foto) return '';
      nFigura++;
      const relId = 'rIdImg' + nFigura;
      imagenes.push({
        nombre: 'media/imagenapp' + nFigura + '.jpeg',
        datos: new Uint8Array(await foto.blob.arrayBuffer()),
        relId,
      });
      let x = imagenXml(relId, 9000 + nFigura, foto.ancho, foto.alto);
      const pie = 'Figura ' + nFigura + (ev.datos.pie ? '. ' + ev.datos.pie : '');
      x += par([{ t: pie, i: true, sz: 18, color: '595959' }], { jc: 'center', esp: [0, 160] });
      return x;
    }
    if (ev.tipo === 'prueba') {
      let x = par([{ t: 'Prueba: ', b: true }, { t: ev.datos.descripcion || '' }], { esp: [120, 40] });
      x += ev.datos.resultado
        ? par([{ t: 'Resultado: ', b: true }, { t: ev.datos.resultado }], { esp: [0, 120] })
        : par([{ t: 'Resultado: ', b: true }, { t: '(pendiente de resultado)', i: true, color: '808080' }], { esp: [0, 120] });
      return x;
    }
    return '';
  };

  // El cuerpo arranca en pagina nueva, despues del indice (como el original).
  let cuerpo = ['<w:p><w:r><w:br w:type="page"/></w:r></w:p>'];

  if (servicio.descripcion || servicio.titulo) {
    cuerpo.push(titulo1('Antecedentes'));
    cuerpo.push(parrafosDe(servicio.descripcion || servicio.titulo));
  }

  const evGeneral = (porRama[db.GENERAL] || []).filter(e => e.tipo !== 'pendiente');
  if (evGeneral.length) {
    cuerpo.push(titulo1('Actividades'));
    for (const ev of evGeneral) cuerpo.push(await eventoXml(ev));
  }

  for (const act of actividades) {
    const evs = (porRama[act.id] || []).filter(e => e.tipo !== 'pendiente');
    if (!evs.length) continue;
    cuerpo.push(titulo1(act.nombre));
    for (const ev of evs) cuerpo.push(await eventoXml(ev));
  }

  const pendientes = eventos.filter(e => e.tipo === 'pendiente');
  if (pendientes.length) {
    cuerpo.push(titulo1('Pendientes'));
    for (const p of pendientes) cuerpo.push(parVineta((p.datos.texto || '').replace(/\n+/g, ' ')));
  }

  cuerpo.push(titulo1('Observaciones'));
  cuerpo.push((servicio.observaciones || '').trim()
    ? parrafosDe(servicio.observaciones)
    : par([{ t: '(Redactar observaciones)', i: true, color: '808080' }]));
  cuerpo.push(titulo1('Recomendaciones'));
  const recos = (servicio.recomendaciones || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (recos.length) for (const r of recos) cuerpo.push(parVineta(r));
  else cuerpo.push(parVineta('(Redactar recomendaciones)'));

  // Rellenar tokens del documento y del encabezado
  const fecha = fechaLarga(servicio.inicio);
  const nombreTrabajo = servicio.titulo || servicio.cliente || '';
  const valores = {
    FECHA: fecha,
    CLIENTE: servicio.cliente || nombreTrabajo,
    PLANTA: servicio.planta || '',
    MARCA: servicio.marca || '',
    MODELO: servicio.modelo || '',
    SERIE: servicio.serie || '',
    NOMAQUINA: servicio.noMaquina || '',
    DESCRIPCION: (servicio.descripcion || nombreTrabajo).replace(/\n+/g, ' '),
    TECNICO: servicio.tecnico || '',
    FOLIO: servicio.folio,
  };

  const entradas = [];
  for (const p of partes) {
    if (p.zip === 'word/document.xml') {
      let x = p.texto;
      if (!valores.PLANTA) x = quitarFilaOpcional(x, 'PLANTA');
      if (!valores.NOMAQUINA) x = quitarFilaOpcional(x, 'NOMAQUINA');
      for (const [k, v] of Object.entries(valores)) x = x.split('{{' + k + '}}').join(esc(v));
      x = x.replace('{{CUERPO}}', cuerpo.join(''));
      entradas.push({ nombre: p.zip, datos: new TextEncoder().encode(x) });
    } else if (p.zip === 'word/header2.xml') {
      let x = p.texto.split('{{FOLIO}}').join(esc(valores.FOLIO)).split('{{FECHA}}').join(esc(fecha));
      entradas.push({ nombre: p.zip, datos: new TextEncoder().encode(x) });
    } else if (p.zip === 'word/_rels/document.xml.rels') {
      const rels = imagenes.map(i =>
        '<Relationship Id="' + i.relId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + i.nombre + '"/>'
      ).join('');
      entradas.push({ nombre: p.zip, datos: new TextEncoder().encode(p.texto.replace('</Relationships>', rels + '</Relationships>')) });
    } else if (p.texto !== null) {
      entradas.push({ nombre: p.zip, datos: new TextEncoder().encode(p.texto) });
    } else {
      entradas.push({ nombre: p.zip, datos: p.datos });
    }
  }
  for (const i of imagenes) entradas.push({ nombre: 'word/' + i.nombre, datos: i.datos });

  const blob = fabricarZip(entradas);
  const base = (servicio.cliente || servicio.titulo || 'TRABAJO').toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑ0-9 ]/gi, '').trim();
  return { blob, nombreArchivo: base + ' REPORTE SERVICIO ' + servicio.folio + '.docx', figuras: nFigura };
}

/* ---------------------------------------------------------------- */
/* Modo basico (respaldo si la plantilla no carga)                   */
/* ---------------------------------------------------------------- */

async function generarReporteBasico(servicioId) {
  const servicio = await db.servicioLeer(servicioId);
  if (!servicio) throw new Error('Trabajo no encontrado');

  const actividades = await db.equiposDeServicio(servicioId);
  const eventos = (await db.eventosDeServicio(servicioId)).filter(e => e.incluir !== false);

  const porRama = {};
  for (const ev of eventos) (porRama[ev.equipoId] = porRama[ev.equipoId] || []).push(ev);

  // Folio: se genera una vez y se conserva para regeneraciones.
  if (!servicio.folio) {
    servicio.folio = folioDe(servicio);
    await db.servicioGuardar(servicio);
  }

  const fecha = fechaLarga(servicio.inicio);
  const imagenes = [];        // { nombre, datos, relId }
  let nFigura = 0;
  let cuerpo = [];

  // Portadilla y tabla de datos
  cuerpo.push(par([{ t: EMPRESA.titulo, b: true, sz: 32 }], { jc: 'center', esp: [0, 240] }));

  const nombreTrabajo = servicio.titulo || servicio.cliente || '';
  const pares = [['Fecha de realización del servicio:', fecha]];
  pares.push(['Cliente:', servicio.cliente || nombreTrabajo]);
  if (servicio.planta)    pares.push(['Planta:', servicio.planta]);
  if (servicio.marca)     pares.push(['Tipo de Máquina:', servicio.marca]);
  if (servicio.modelo)    pares.push(['Modelo:', servicio.modelo]);
  if (servicio.serie)     pares.push(['Número de Serie:', servicio.serie]);
  if (servicio.noMaquina) pares.push(['No. de Máquina:', servicio.noMaquina]);
  pares.push(['Descripción del servicio:', servicio.descripcion || nombreTrabajo]);
  pares.push(['Técnico:', servicio.tecnico || '']);
  cuerpo.push(tablaDatos(pares));

  // Indice
  cuerpo.push(XML_INDICE);

  // Un evento -> su XML
  const eventoXml = async (ev) => {
    if (ev.tipo === 'nota') return parrafosDe(ev.datos.texto);

    if (ev.tipo === 'tabla') {
      const t = ev.datos;
      let x = '';
      if (t.titulo) x += par([{ t: t.titulo, b: true }], { esp: [160, 60] });
      const filas = (t.filas || []).filter(f => f.some(c => String(c).trim() !== ''));
      x += tablaXml(t.columnas || [], filas);
      x += par('', { esp: [0, 60] });
      return x;
    }

    if (ev.tipo === 'foto') {
      const foto = await db.fotoLeer(ev.datos.fotoId);
      if (!foto) return '';
      nFigura++;
      const relId = 'rIdImg' + nFigura;
      imagenes.push({
        nombre: 'media/imagen' + nFigura + '.jpeg',
        datos: new Uint8Array(await foto.blob.arrayBuffer()),
        relId,
      });
      let x = imagenXml(relId, nFigura, foto.ancho, foto.alto);
      const pie = 'Figura ' + nFigura + (ev.datos.pie ? '. ' + ev.datos.pie : '');
      x += par([{ t: pie, i: true, sz: 18, color: '595959' }], { jc: 'center', esp: [0, 160] });
      return x;
    }

    if (ev.tipo === 'prueba') {
      let x = par([{ t: 'Prueba: ', b: true }, { t: ev.datos.descripcion || '' }], { esp: [120, 40] });
      x += ev.datos.resultado
        ? par([{ t: 'Resultado: ', b: true }, { t: ev.datos.resultado }], { esp: [0, 120] })
        : par([{ t: 'Resultado: ', b: true }, { t: '(pendiente de resultado)', i: true, color: '808080' }], { esp: [0, 120] });
      return x;
    }

    return '';   // los pendientes van en su propia seccion
  };

  // ANTECEDENTES: la descripcion de la falla
  if (servicio.descripcion || servicio.titulo) {
    cuerpo.push(titulo1('Antecedentes'));
    cuerpo.push(parrafosDe(servicio.descripcion || servicio.titulo));
  }

  // ACTIVIDADES: la rama General
  const evGeneral = (porRama[db.GENERAL] || []).filter(e => e.tipo !== 'pendiente');
  if (evGeneral.length) {
    cuerpo.push(titulo1('Actividades'));
    for (const ev of evGeneral) cuerpo.push(await eventoXml(ev));
  }

  // Una seccion por rama con contenido
  for (const act of actividades) {
    const evs = (porRama[act.id] || []).filter(e => e.tipo !== 'pendiente');
    if (!evs.length) continue;
    cuerpo.push(titulo1(act.nombre));
    for (const ev of evs) cuerpo.push(await eventoXml(ev));
  }

  // PENDIENTES: de todas las ramas
  const pendientes = eventos.filter(e => e.tipo === 'pendiente');
  if (pendientes.length) {
    cuerpo.push(titulo1('Pendientes'));
    for (const p of pendientes) {
      cuerpo.push(par([{ t: '— ', b: true }, { t: (p.datos.texto || '').replace(/\n+/g, ' ') }], { esp: [0, 80] }));
    }
  }

  // Cierre: lo capturado en la app, o marcadores editables en Word
  cuerpo.push(titulo1('Observaciones'));
  cuerpo.push((servicio.observaciones || '').trim()
    ? parrafosDe(servicio.observaciones)
    : par([{ t: '(Redactar observaciones)', i: true, color: '808080' }]));
  cuerpo.push(titulo1('Recomendaciones'));
  const recosB = (servicio.recomendaciones || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (recosB.length) for (const r of recosB) cuerpo.push(par([{ t: '— ', b: true }, { t: r }], { esp: [0, 80] }));
  else cuerpo.push(par([{ t: '(Redactar recomendaciones)', i: true, color: '808080' }]));

  const sectPr =
    '<w:sectPr>' +
    '<w:headerReference w:type="default" r:id="rIdHdr"/>' +
    '<w:footerReference w:type="default" r:id="rIdFtr"/>' +
    '<w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="576" w:footer="576" w:gutter="0"/>' +
    '</w:sectPr>';

  const xmlDocumento =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<w:body>' + cuerpo.join('') + sectPr + '</w:body></w:document>';

  const xmlRelsDoc =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdSty" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
    '<Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
    imagenes.map(i =>
      '<Relationship Id="' + i.relId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + i.nombre + '"/>'
    ).join('') +
    '</Relationships>';

  const xmlTipos =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';

  const xmlRelsRaiz =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';

  const xmlCore =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:title>' + esc('Reporte ' + (servicio.cliente || servicio.titulo || '')) + '</dc:title>' +
    '<dc:creator>' + esc(servicio.tecnico || '') + '</dc:creator>' +
    '</cp:coreProperties>';

  const txt = (s) => new TextEncoder().encode(s);
  const entradas = [
    { nombre: '[Content_Types].xml', datos: txt(xmlTipos) },
    { nombre: '_rels/.rels', datos: txt(xmlRelsRaiz) },
    { nombre: 'docProps/core.xml', datos: txt(xmlCore) },
    { nombre: 'word/document.xml', datos: txt(xmlDocumento) },
    { nombre: 'word/styles.xml', datos: txt(XML_ESTILOS) },
    { nombre: 'word/header1.xml', datos: txt(xmlEncabezado(servicio.folio, fecha)) },
    { nombre: 'word/footer1.xml', datos: txt(xmlPie()) },
    { nombre: 'word/_rels/document.xml.rels', datos: txt(xmlRelsDoc) },
    ...imagenes.map(i => ({ nombre: 'word/' + i.nombre, datos: i.datos })),
  ];

  const blob = fabricarZip(entradas);
  const base = (servicio.cliente || servicio.titulo || 'TRABAJO').toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑ0-9 ]/gi, '').trim();
  const nombreArchivo = base + ' REPORTE SERVICIO ' + servicio.folio + '.docx';

  return { blob, nombreArchivo, figuras: nFigura };
}
