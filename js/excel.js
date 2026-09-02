// Libros de Excel (.xlsx) SIN dependencias, en la misma linea que
// reporte.js fabrica el .docx: un .xlsx es un ZIP de archivos XML.
//
// ESCRIBIR:  crearLibro([{ nombre, columnas, filas, oculta? }]) → Blob
//   columnas: [{ titulo, ancho?, tipo? }]  tipo = texto | largo | numero |
//             fecha | fechaHora | porcentaje  (formato de TODA la columna;
//             'largo' = texto con ajuste de linea)
//   filas:    [[celda, ...]]  celda = string | number | boolean | null |
//             'AAAA-MM-DD' (en columna fecha) | ts en ms (en fechaHora) |
//             { f: 'FORMULA' } | { v, t } (t fuerza el tipo de ESA celda)
//   Cada hoja sale con encabezado fijo (panel congelado) y autofiltro.
//
// LEER:      await leerLibro(bytes) → { hojas: [{ nombre, oculta, filas }],
//             hoja(nombre) → filas | null, registros(nombre) → [{titulo: valor}] }
//   Lee tambien los libros que Excel/OneDrive guardan COMPRIMIDOS (deflate,
//   via DecompressionStream del navegador). Las celdas con formato de fecha
//   regresan como 'AAAA-MM-DD' (o 'AAAA-MM-DDTHH:MM' si traen hora); el
//   resto como string / number / boolean; las vacias como null.

import { fabricarZip } from './reporte.js';

export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const EPOCA = Date.UTC(1899, 11, 30);   // serial 0 de Excel
const DIA_MS = 86400000;
export const MAX_TEXTO_CELDA = 32767;   // limite de Excel por celda

/* ---------------------------------------------------------------- */
/* Utilerias                                                         */
/* ---------------------------------------------------------------- */

function esc(s) {
  return String(s == null ? '' : s)
    // Caracteres de control que XML 1.0 no admite: Excel rechaza el libro.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 0 → A, 25 → Z, 26 → AA
export function letraColumna(indice) {
  let n = indice + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function indiceColumna(letras) {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// 'AAAA-MM-DD' → serial de Excel (fecha pura, sin hora); null si no es fecha.
export function serialDeFecha(clave) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(clave || ''));
  if (!m) return null;
  return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCA) / DIA_MS;
}

// ts en ms (o Date, o texto de fecha) en hora LOCAL del telefono → serial
// con fraccion de dia; null si no se entiende.
export function serialDeTs(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return null;
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - EPOCA) / DIA_MS;
}

// serial → 'AAAA-MM-DD', o 'AAAA-MM-DDTHH:MM' si trae hora.
export function fechaDeSerial(serial) {
  const ms = Math.round(serial * DIA_MS) + EPOCA;
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const fecha = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  const conHora = d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds();
  return conHora ? fecha + 'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) : fecha;
}

/* ---------------------------------------------------------------- */
/* Escritura                                                         */
/* ---------------------------------------------------------------- */

// Indices en cellXfs de styles.xml (ver XML_ESTILOS).
const ESTILO = { texto: 0, numero: 0, encabezado: 1, fecha: 2, fechaHora: 3, porcentaje: 4, largo: 5 };

const XML_ESTILOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="' + NS_MAIN + '">' +
  '<numFmts count="2">' +
  '<numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>' +
  '<numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/>' +
  '</numFmts>' +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '</fonts>' +
  // Los dos primeros rellenos (none y gray125) son obligatorios para Excel.
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>' +
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  // 0 normal
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  // 1 encabezado
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
  '<alignment vertical="center" wrapText="1"/></xf>' +
  // 2 fecha
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  // 3 fecha y hora
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  // 4 porcentaje 0%
  '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  // 5 texto largo (ajuste de linea, arriba)
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
  '<alignment vertical="top" wrapText="1"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function textoXml(ref, v, s) {
  let txt = String(v);
  if (txt.length > MAX_TEXTO_CELDA) txt = txt.slice(0, MAX_TEXTO_CELDA);
  return '<c r="' + ref + '" t="inlineStr"' + s + '><is><t xml:space="preserve">' + esc(txt) + '</t></is></c>';
}

// Una celda. Devuelve '' si no hay nada que escribir.
function celdaXml(ref, valor, tipoCol) {
  if (valor === null || valor === undefined || valor === '') return '';
  let t = tipoCol || 'texto';
  let v = valor;
  if (typeof valor === 'object') {
    if (valor instanceof Date) { v = valor.getTime(); t = 'fechaHora'; }
    else if (valor.f) {
      const sf = ESTILO[t] ? ' s="' + ESTILO[t] + '"' : '';
      return '<c r="' + ref + '"' + sf + '><f>' + esc(valor.f) + '</f></c>';
    } else {
      v = valor.v;
      if (valor.t) t = valor.t;
      if (v === null || v === undefined || v === '') return '';
    }
  }
  const s = ESTILO[t] ? ' s="' + ESTILO[t] + '"' : '';
  if (t === 'fecha') {
    const n = typeof v === 'number' ? v : serialDeFecha(v);
    if (n === null) return textoXml(ref, v, '');   // no era fecha: se escribe tal cual
    return '<c r="' + ref + '"' + s + '><v>' + n + '</v></c>';
  }
  if (t === 'fechaHora') {
    // number chico = ya es serial; number grande = ts en ms; texto/Date se interpretan
    const n = typeof v === 'number' && v < 1e8 ? v : serialDeTs(v);
    if (n === null) return textoXml(ref, v, '');
    return '<c r="' + ref + '"' + s + '><v>' + n + '</v></c>';
  }
  if (typeof v === 'boolean') return '<c r="' + ref + '" t="b"' + s + '><v>' + (v ? 1 : 0) + '</v></c>';
  if (typeof v === 'number') {
    if (!isFinite(v)) return '';
    return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
  }
  return textoXml(ref, v, s);
}

// Nombre de hoja valido para Excel: sin []:*?/\ , maximo 31, unico.
function nombreHoja(nombre, usados) {
  const base = String(nombre || 'Hoja').replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
  let n = base;
  let k = 2;
  while (usados.has(n.toLowerCase())) {
    const sufijo = ' (' + k++ + ')';
    n = base.slice(0, 31 - sufijo.length) + sufijo;
  }
  usados.add(n.toLowerCase());
  return n;
}

function dimensiones(hoja) {
  const cols = hoja.columnas || [];
  let nCols = cols.length;
  for (const f of hoja.filas) if (f.length > nCols) nCols = f.length;
  const ultimaFila = (cols.length ? 1 : 0) + hoja.filas.length;
  return { nCols: Math.max(nCols, 1), ultimaFila: Math.max(ultimaFila, 1) };
}

function hojaXml(hoja) {
  const cols = hoja.columnas || [];
  const { nCols, ultimaFila } = dimensiones(hoja);
  const p = [];
  p.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  p.push('<worksheet xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">');
  p.push('<sheetViews><sheetView workbookViewId="0"' + (hoja.activa ? ' tabSelected="1"' : '') + '>' +
    (cols.length
      ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
      : '') +
    '</sheetView></sheetViews>');
  p.push('<sheetFormatPr defaultRowHeight="15"/>');
  if (cols.some(c => c.ancho)) {
    p.push('<cols>' + cols.map((c, i) => c.ancho
      ? '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + c.ancho + '" customWidth="1"/>'
      : '').join('') + '</cols>');
  }
  p.push('<sheetData>');
  let r = 1;
  if (cols.length) {
    p.push('<row r="1">' + cols.map((c, i) =>
      '<c r="' + letraColumna(i) + '1" t="inlineStr" s="1"><is><t xml:space="preserve">' + esc(c.titulo) + '</t></is></c>'
    ).join('') + '</row>');
    r = 2;
  }
  for (const fila of hoja.filas) {
    const celdas = [];
    for (let i = 0; i < fila.length; i++) {
      const x = celdaXml(letraColumna(i) + r, fila[i], cols[i] && cols[i].tipo);
      if (x) celdas.push(x);
    }
    if (celdas.length) p.push('<row r="' + r + '">' + celdas.join('') + '</row>');
    r++;
  }
  p.push('</sheetData>');
  if (cols.length && hoja.filtro !== false) {
    p.push('<autoFilter ref="A1:' + letraColumna(nCols - 1) + ultimaFila + '"/>');
  }
  p.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  p.push('</worksheet>');
  return p.join('');
}

/**
 * Fabrica el .xlsx. `hojas` = [{ nombre, columnas, filas, oculta?, filtro? }].
 * La primera hoja visible queda seleccionada al abrir.
 */
export function crearLibro(hojas, { creador = 'Ser Pro App' } = {}) {
  if (!hojas || !hojas.length) throw new Error('El libro necesita al menos una hoja');
  const txt = (s) => new TextEncoder().encode(s);
  const usados = new Set();
  const primeraVisible = Math.max(0, hojas.findIndex(h => !h.oculta));
  const lista = hojas.map((h, i) => ({
    ...h,
    filas: h.filas || [],
    nombreXml: nombreHoja(h.nombre, usados),
    activa: i === primeraVisible,
  }));

  const tipos = lista.map((h, i) =>
    '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  ).join('');
  const xmlTipos =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    tipos +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  const xmlRelsRaiz =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="' + NS_PKG_REL + '">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>';

  const definidos = [];
  lista.forEach((h, i) => {
    if (!(h.columnas && h.columnas.length) || h.filtro === false) return;
    const { nCols, ultimaFila } = dimensiones(h);
    definidos.push('<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">' +
      "'" + esc(h.nombreXml.replace(/'/g, "''")) + "'!$A$1:$" + letraColumna(nCols - 1) + '$' + ultimaFila + '</definedName>');
  });
  const xmlLibro =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
    '<workbookPr date1904="0"/>' +
    '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"' +
    (primeraVisible > 0 ? ' activeTab="' + primeraVisible + '"' : '') + '/></bookViews>' +
    '<sheets>' + lista.map((h, i) =>
      '<sheet name="' + esc(h.nombreXml) + '" sheetId="' + (i + 1) + '"' + (h.oculta ? ' state="hidden"' : '') + ' r:id="rId' + (i + 1) + '"/>'
    ).join('') + '</sheets>' +
    (definidos.length ? '<definedNames>' + definidos.join('') + '</definedNames>' : '') +
    '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
    '</workbook>';

  const xmlRelsLibro =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="' + NS_PKG_REL + '">' +
    lista.map((h, i) =>
      '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'
    ).join('') +
    '<Relationship Id="rId' + (lista.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const ahora = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const xmlCore =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:creator>' + esc(creador) + '</dc:creator><cp:lastModifiedBy>' + esc(creador) + '</cp:lastModifiedBy>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + ahora + '</dcterms:created>' +
    '<dcterms:modified xsi:type="dcterms:W3CDTF">' + ahora + '</dcterms:modified>' +
    '</cp:coreProperties>';
  const xmlApp =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>' + esc(creador) + '</Application></Properties>';

  const entradas = [
    { nombre: '[Content_Types].xml', datos: txt(xmlTipos) },
    { nombre: '_rels/.rels', datos: txt(xmlRelsRaiz) },
    { nombre: 'docProps/core.xml', datos: txt(xmlCore) },
    { nombre: 'docProps/app.xml', datos: txt(xmlApp) },
    { nombre: 'xl/workbook.xml', datos: txt(xmlLibro) },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: txt(xmlRelsLibro) },
    { nombre: 'xl/styles.xml', datos: txt(XML_ESTILOS) },
    ...lista.map((h, i) => ({ nombre: 'xl/worksheets/sheet' + (i + 1) + '.xml', datos: txt(hojaXml(h)) })),
  ];
  return new Blob([fabricarZip(entradas)], { type: MIME_XLSX });
}

/* ---------------------------------------------------------------- */
/* Lectura                                                           */
/* ---------------------------------------------------------------- */

async function inflar(datos) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Este navegador no puede descomprimir el Excel (falta DecompressionStream)');
  }
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/**
 * Lector de ZIP que entiende entradas sin comprimir (las de esta app) y
 * comprimidas con deflate (las que guarda Excel). Devuelve { nombre: Uint8Array }.
 */
export async function leerZipAsync(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const minimo = Math.max(0, u8.length - 22 - 65535);
  let eocd = u8.length - 22;
  while (eocd >= minimo && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < minimo) throw new Error('No es un archivo ZIP');

  const n = dv.getUint16(eocd + 10, true);
  let pos = dv.getUint32(eocd + 16, true);
  const entradas = {};
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error('ZIP corrupto');
    const metodo = dv.getUint16(pos + 10, true);
    const tamComp = dv.getUint32(pos + 20, true);
    const nLen = dv.getUint16(pos + 28, true);
    const eLen = dv.getUint16(pos + 30, true);
    const cLen = dv.getUint16(pos + 32, true);
    const off = dv.getUint32(pos + 42, true);
    const nombre = new TextDecoder().decode(u8.subarray(pos + 46, pos + 46 + nLen));
    const nLoc = dv.getUint16(off + 26, true);
    const eLoc = dv.getUint16(off + 28, true);
    const ini = off + 30 + nLoc + eLoc;
    const crudo = u8.subarray(ini, ini + tamComp);
    if (metodo === 0) entradas[nombre] = crudo;
    else if (metodo === 8) entradas[nombre] = await inflar(crudo);
    else throw new Error('Compresion no soportada (' + metodo + ') en ' + nombre);
    pos += 46 + nLen + eLen + cLen;
  }
  return entradas;
}

function parsearXml(u8) {
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(u8), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML invalido dentro del libro');
  return doc;
}

// Elementos por nombre local, sin importar prefijo ni espacio de nombres
// (Excel escribe sin prefijo; otros programas a veces con 'x:').
function todos(nodo, local) {
  return Array.from(nodo.getElementsByTagNameNS('*', local));
}

function atributo(el, nombre) {
  return el.getAttribute(nombre) || el.getAttributeNS(NS_REL, nombre.replace(/^r:/, '')) || '';
}

function textoDe(nodo) {
  return todos(nodo, 't').map(t => t.textContent).join('');
}

const FORMATOS_FECHA = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function esCodigoDeFecha(codigo) {
  const c = String(codigo || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(c) && !/[#%]/.test(c) && !/General/i.test(c);
}

// Por cada estilo (indice s de la celda): ¿es formato de fecha?
function estilosDeFecha(entradas) {
  const u8 = entradas['xl/styles.xml'];
  if (!u8) return [];
  const doc = parsearXml(u8);
  const personalizados = {};
  for (const f of todos(doc, 'numFmt')) {
    personalizados[parseInt(f.getAttribute('numFmtId'), 10)] = f.getAttribute('formatCode') || '';
  }
  const cellXfs = todos(doc, 'cellXfs')[0];
  if (!cellXfs) return [];
  return todos(cellXfs, 'xf').map(xf => {
    const id = parseInt(xf.getAttribute('numFmtId') || '0', 10);
    if (FORMATOS_FECHA.has(id)) return true;
    return id in personalizados ? esCodigoDeFecha(personalizados[id]) : false;
  });
}

function cadenasCompartidas(entradas) {
  const u8 = entradas['xl/sharedStrings.xml'];
  if (!u8) return [];
  return todos(parsearXml(u8), 'si').map(textoDe);
}

function filasDeHoja(u8, compartidos, esFecha) {
  const doc = parsearXml(u8);
  const filas = [];
  let rAuto = 0;
  for (const fila of todos(doc, 'row')) {
    const rAttr = parseInt(fila.getAttribute('r'), 10);
    const r = isNaN(rAttr) ? rAuto + 1 : rAttr;
    rAuto = r;
    const celdas = [];
    let cAuto = -1;
    for (const c of todos(fila, 'c')) {
      const ref = /^([A-Z]+)/.exec(c.getAttribute('r') || '');
      const col = ref ? indiceColumna(ref[1]) : cAuto + 1;
      cAuto = col;
      const t = c.getAttribute('t') || 'n';
      const s = parseInt(c.getAttribute('s') || '0', 10);
      let vNodo = null;
      let isNodo = null;
      for (const hijo of c.childNodes) {
        if (hijo.localName === 'v') vNodo = hijo;
        else if (hijo.localName === 'is') isNodo = hijo;
      }
      let val = null;
      if (t === 's') {
        const idx = vNodo ? parseInt(vNodo.textContent, 10) : -1;
        val = idx >= 0 && idx < compartidos.length ? compartidos[idx] : '';
      } else if (t === 'inlineStr') {
        val = isNodo ? textoDe(isNodo) : '';
      } else if (t === 'str') {
        val = vNodo ? vNodo.textContent : '';
      } else if (t === 'b') {
        val = vNodo ? vNodo.textContent === '1' : null;
      } else if (t === 'e') {
        val = null;
      } else if (vNodo) {
        const num = Number(vNodo.textContent);
        val = isNaN(num) ? vNodo.textContent : (esFecha[s] ? fechaDeSerial(num) : num);
      }
      if (val === '') val = null;
      celdas[col] = val;
    }
    for (let k = 0; k < celdas.length; k++) if (celdas[k] === undefined) celdas[k] = null;
    filas[r - 1] = celdas;
  }
  for (let k = 0; k < filas.length; k++) if (!filas[k]) filas[k] = [];
  return filas;
}

/**
 * Lee un .xlsx (Uint8Array / ArrayBuffer / Blob). Devuelve
 * { hojas: [{ nombre, oculta, filas }], hoja(nombre), registros(nombre) }.
 */
export async function leerLibro(origen) {
  const buf = origen instanceof Blob ? new Uint8Array(await origen.arrayBuffer()) : origen;
  const entradas = await leerZipAsync(buf);
  if (!entradas['xl/workbook.xml']) throw new Error('El archivo no es un libro de Excel (.xlsx)');

  const rels = {};
  if (entradas['xl/_rels/workbook.xml.rels']) {
    for (const r of todos(parsearXml(entradas['xl/_rels/workbook.xml.rels']), 'Relationship')) {
      let destino = r.getAttribute('Target') || '';
      destino = destino.startsWith('/') ? destino.slice(1) : 'xl/' + destino.replace(/^\.\//, '');
      rels[r.getAttribute('Id')] = destino;
    }
  }
  const compartidos = cadenasCompartidas(entradas);
  const esFecha = estilosDeFecha(entradas);

  const hojas = [];
  const libro = parsearXml(entradas['xl/workbook.xml']);
  todos(libro, 'sheet').forEach((s, i) => {
    const rid = atributo(s, 'r:id');
    const ruta = rels[rid] || ('xl/worksheets/sheet' + (i + 1) + '.xml');
    const u8 = entradas[ruta];
    hojas.push({
      nombre: s.getAttribute('name') || ('Hoja' + (i + 1)),
      oculta: (s.getAttribute('state') || 'visible') !== 'visible',
      filas: u8 ? filasDeHoja(u8, compartidos, esFecha) : [],
    });
  });

  const porNombre = (nombre) => hojas.find(h => h.nombre.toLowerCase() === String(nombre).toLowerCase()) || null;
  return {
    hojas,
    hoja: (nombre) => { const h = porNombre(nombre); return h ? h.filas : null; },
    // La fila 1 como encabezados → [{ titulo: valor }] (filas vacias fuera).
    registros: (nombre) => {
      const h = porNombre(nombre);
      if (!h || !h.filas.length) return [];
      const titulos = (h.filas[0] || []).map(t => (t == null ? '' : String(t).trim()));
      const salida = [];
      for (let r = 1; r < h.filas.length; r++) {
        const fila = h.filas[r] || [];
        if (!fila.some(v => v !== null && v !== undefined)) continue;
        const obj = {};
        titulos.forEach((t, i) => { if (t) obj[t] = fila[i] === undefined ? null : fila[i]; });
        salida.push(obj);
      }
      return salida;
    },
  };
}
