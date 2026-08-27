// Generador de presentaciones PowerPoint (.pptx) para PROCEDIMIENTOS,
// 100% en el telefono y sin internet.
//
// Un .pptx es, como el .docx, un ZIP con XML. Estructura generada:
//   diapositiva 1: portada (titulo del procedimiento, empresa, fecha, tecnico)
//   una diapositiva por PASO (rama): titulo del paso + notas + fotos
//   (un paso con mas de 4 fotos continua en diapositivas "(cont.)")
//
// Estilo: fondo blanco, banda superior teal de la casa, titulos oscuros.

import * as db from './db.js';
import { fabricarZip, esc, EMPRESA } from './reporte.js';

const ANCHO = 12192000;    // 16:9 en EMU
const ALTO = 6858000;
const M = 457200;          // margen 0.5"
const TEAL = '087F94';
const TINTA = '14202C';
const GRIS = '5A6B7C';
const EMU_PX = 9525;
const FOTOS_POR_LAMINA = 4;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = (ts) => {
  const d = new Date(ts);
  return d.getDate() + ' de ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
};

/* ---------------------------------------------------------------- */
/* Piezas de diapositiva                                             */
/* ---------------------------------------------------------------- */

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
  ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const GRP_VACIO =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
  '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

let idSp = 1;

function parrafo(texto, o = {}) {
  const pPr = [];
  if (o.align) pPr.push(' algn="' + o.align + '"');
  if (o.espacio) pPr.push('');
  return '<a:p><a:pPr' + (o.align ? ' algn="' + o.align + '"' : '') +
    (o.despues ? '><a:spcAft><a:spcPts val="' + o.despues + '"/></a:spcAft></a:pPr>' : '/>') +
    '<a:r><a:rPr lang="es-MX" sz="' + (o.sz || 1600) + '" b="' + (o.b ? 1 : 0) + '" dirty="0">' +
    '<a:solidFill><a:srgbClr val="' + (o.color || TINTA) + '"/></a:solidFill>' +
    '<a:latin typeface="Calibri"/></a:rPr>' +
    '<a:t>' + esc(texto) + '</a:t></a:r></a:p>';
}

function cuadroTexto(x, y, w, h, parrafos, anchor) {
  idSp++;
  return '<p:sp><p:nvSpPr><p:cNvPr id="' + idSp + '" name="tx' + idSp + '"/>' +
    '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="' + Math.round(x) + '" y="' + Math.round(y) + '"/>' +
    '<a:ext cx="' + Math.round(w) + '" cy="' + Math.round(h) + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
    '<p:txBody><a:bodyPr wrap="square" anchor="' + (anchor || 't') + '">' +
    '<a:normAutofit/></a:bodyPr><a:lstStyle/>' + parrafos + '</p:txBody></p:sp>';
}

function banda(x, y, w, h, color) {
  idSp++;
  return '<p:sp><p:nvSpPr><p:cNvPr id="' + idSp + '" name="banda' + idSp + '"/>' +
    '<p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="' + Math.round(x) + '" y="' + Math.round(y) + '"/>' +
    '<a:ext cx="' + Math.round(w) + '" cy="' + Math.round(h) + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill>' +
    '<a:ln><a:noFill/></a:ln></p:spPr>' +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>';
}

// Imagen ajustada DENTRO de una celda, conservando proporcion, centrada.
function imagen(relId, anchoPx, altoPx, cx, cy, cw, ch) {
  const escala = Math.min(cw / (anchoPx * EMU_PX), ch / (altoPx * EMU_PX), 1);
  const w = anchoPx * EMU_PX * escala;
  const h = altoPx * EMU_PX * escala;
  const x = cx + (cw - w) / 2;
  const y = cy + (ch - h) / 2;
  idSp++;
  return '<p:pic><p:nvPicPr><p:cNvPr id="' + idSp + '" name="img' + idSp + '"/>' +
    '<p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="' + relId + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    '<p:spPr><a:xfrm><a:off x="' + Math.round(x) + '" y="' + Math.round(y) + '"/>' +
    '<a:ext cx="' + Math.round(w) + '" cy="' + Math.round(h) + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
}

function laminaXml(cuerpo) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld ' + NS + '><p:cSld><p:spTree>' + GRP_VACIO + cuerpo +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

// Reparte fotos en una zona: 1 completa, 2 lado a lado, 3-4 en 2x2.
function rejillaFotos(fotos, zx, zy, zw, zh) {
  const sep = 91440;   // 0.1"
  let x = '';
  if (fotos.length === 1) {
    x += imagen(fotos[0].relId, fotos[0].ancho, fotos[0].alto, zx, zy, zw, zh);
  } else if (fotos.length === 2) {
    const cw = (zw - sep) / 2;
    fotos.forEach((f, i) => { x += imagen(f.relId, f.ancho, f.alto, zx + i * (cw + sep), zy, cw, zh); });
  } else {
    const cw = (zw - sep) / 2, ch = (zh - sep) / 2;
    fotos.forEach((f, i) => {
      x += imagen(f.relId, f.ancho, f.alto,
        zx + (i % 2) * (cw + sep), zy + Math.floor(i / 2) * (ch + sep), cw, ch);
    });
  }
  return x;
}

/* ---------------------------------------------------------------- */
/* Partes fijas del paquete                                          */
/* ---------------------------------------------------------------- */

const XML_TEMA =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SERPRO">' +
  '<a:themeElements>' +
  '<a:clrScheme name="S">' +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
  '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="14202C"/></a:dk2><a:lt2><a:srgbClr val="EEF1F5"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="087F94"/></a:accent1><a:accent2><a:srgbClr val="F2B63C"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="2FD685"/></a:accent3><a:accent4><a:srgbClr val="C0362C"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5A6B7C"/></a:accent5><a:accent6><a:srgbClr val="0A99B2"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="087F94"/></a:hlink><a:folHlink><a:srgbClr val="5A6B7C"/></a:folHlink>' +
  '</a:clrScheme>' +
  '<a:fontScheme name="S">' +
  '<a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
  '</a:fontScheme>' +
  '<a:fmtScheme name="S">' +
  '<a:fillStyleLst>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) +
  '</a:fillStyleLst>' +
  '<a:lnStyleLst>' +
  '<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3) +
  '</a:lnStyleLst>' +
  '<a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) + '</a:effectStyleLst>' +
  '<a:bgFillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:bgFillStyleLst>' +
  '</a:fmtScheme>' +
  '</a:themeElements></a:theme>';

const XML_MASTER =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<p:sldMaster ' + NS + '>' +
  '<p:cSld><p:spTree>' + GRP_VACIO + '</p:spTree></p:cSld>' +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"' +
  ' accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
  '</p:sldMaster>';

const XML_LAYOUT =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<p:sldLayout ' + NS + ' type="blank" preserve="1">' +
  '<p:cSld name="Blanco"><p:spTree>' + GRP_VACIO + '</p:spTree></p:cSld>' +
  '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

const REL = (id, tipo, destino) =>
  '<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' +
  tipo + '" Target="' + destino + '"/>';

const RELS = (contenido) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  contenido + '</Relationships>';

/* ---------------------------------------------------------------- */
/* Armado                                                            */
/* ---------------------------------------------------------------- */

export async function generarPresentacion(servicioId) {
  const servicio = await db.servicioLeer(servicioId);
  if (!servicio) throw new Error('Trabajo no encontrado');

  const pasos = await db.equiposDeServicio(servicioId);
  const eventos = (await db.eventosDeServicio(servicioId)).filter(e => e.incluir !== false);
  const porPaso = {};
  for (const ev of eventos) (porPaso[ev.equipoId] = porPaso[ev.equipoId] || []).push(ev);

  idSp = 1;
  const laminas = [];
  const imagenes = [];   // { nombre, datos, relId (por lamina) }
  let nImg = 0;

  // --- Portada
  laminas.push({
    xml: laminaXml(
      banda(0, 0, ANCHO, 137160, TEAL) +
      cuadroTexto(M, ALTO * 0.28, ANCHO - 2 * M, 1600200,
        parrafo(servicio.titulo || 'Procedimiento', { sz: 4000, b: 1, align: 'ctr' }), 'b') +
      banda(ANCHO / 2 - 1371600, ALTO * 0.55, 2743200, 27432, TEAL) +
      cuadroTexto(M, ALTO * 0.60, ANCHO - 2 * M, 1200000,
        parrafo('PROCEDIMIENTO', { sz: 1400, align: 'ctr', color: TEAL, b: 1 }) +
        parrafo(EMPRESA.titulo, { sz: 1400, align: 'ctr', color: GRIS }) +
        parrafo(fechaLarga(servicio.inicio) + (servicio.tecnico ? '  ·  ' + servicio.tecnico : ''),
          { sz: 1200, align: 'ctr', color: GRIS }))
    ),
    fotos: [],
  });

  // --- Un paso por lamina (con continuaciones si trae mas de 4 fotos)
  let nPaso = 0;
  for (const paso of pasos) {
    const evs = porPaso[paso.id] || [];
    if (!evs.length) continue;
    nPaso++;

    const notas = evs.filter(e => e.tipo === 'nota' || e.tipo === 'pendiente')
      .map(e => e.datos.texto || '');
    const fotosEv = evs.filter(e => e.tipo === 'foto');

    // cargar fotos del paso
    const fotosPaso = [];
    for (const fe of fotosEv) {
      const f = await db.fotoLeer(fe.datos.fotoId);
      if (!f) continue;
      nImg++;
      fotosPaso.push({
        nombre: 'image' + nImg + '.jpeg',
        datos: new Uint8Array(await f.blob.arrayBuffer()),
        ancho: f.ancho, alto: f.alto,
        pie: fe.datos.pie || '',
      });
    }

    const trozos = [];
    for (let i = 0; i < Math.max(1, Math.ceil(fotosPaso.length / FOTOS_POR_LAMINA)); i++) {
      trozos.push(fotosPaso.slice(i * FOTOS_POR_LAMINA, (i + 1) * FOTOS_POR_LAMINA));
    }

    trozos.forEach((fotos, idx) => {
      const titulo = nPaso + '. ' + paso.nombre + (idx ? ' (cont.)' : '');
      const fotosRel = fotos.map((f, k) => ({ ...f, relId: 'rIdImg' + (k + 1) }));

      let cuerpo =
        banda(0, 0, ANCHO, 91440, TEAL) +
        cuadroTexto(M, 228600, ANCHO - 2 * M, 685800,
          parrafo(titulo, { sz: 2400, b: 1 }));

      const zonaY = 1097280;
      const zonaH = ALTO - zonaY - M;
      const conTexto = idx === 0 && notas.length;

      if (conTexto && fotosRel.length) {
        const wTexto = (ANCHO - 2 * M) * 0.42;
        cuerpo += cuadroTexto(M, zonaY, wTexto, zonaH,
          notas.map(n => n.split('\n').map(l =>
            parrafo(l, { sz: 1500, despues: 600 })).join('')).join(''));
        const zx = M + wTexto + 182880;
        cuerpo += rejillaFotos(fotosRel, zx, zonaY, ANCHO - M - zx, zonaH);
      } else if (fotosRel.length) {
        cuerpo += rejillaFotos(fotosRel, M, zonaY, ANCHO - 2 * M, zonaH);
      } else if (conTexto) {
        cuerpo += cuadroTexto(M, zonaY, ANCHO - 2 * M, zonaH,
          notas.map(n => n.split('\n').map(l =>
            parrafo(l, { sz: 1600, despues: 600 })).join('')).join(''));
      }

      laminas.push({ xml: laminaXml(cuerpo), fotos: fotosRel });
    });
  }

  /* ---------- paquete ---------- */

  const txt = (s) => new TextEncoder().encode(s);
  const entradas = [];

  const overridesLaminas = laminas.map((_, i) =>
    '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml"' +
    ' ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('');

  entradas.push({
    nombre: '[Content_Types].xml',
    datos: txt('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>' +
      '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>' +
      '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>' +
      overridesLaminas +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>'),
  });

  entradas.push({
    nombre: '_rels/.rels',
    datos: txt(RELS(
      REL('rId1', 'officeDocument', 'ppt/presentation.xml') +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      REL('rId3', 'extended-properties', 'docProps/app.xml')
    )),
  });

  entradas.push({
    nombre: 'docProps/core.xml',
    datos: txt('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
      ' xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      '<dc:title>' + esc(servicio.titulo || 'Procedimiento') + '</dc:title>' +
      '<dc:creator>' + esc(servicio.tecnico || '') + '</dc:creator></cp:coreProperties>'),
  });
  entradas.push({
    nombre: 'docProps/app.xml',
    datos: txt('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
      '<Application>Reportes de Servicio</Application></Properties>'),
  });

  const relsLaminas = laminas.map((_, i) => REL('rIdSld' + (i + 1), 'slide', 'slides/slide' + (i + 1) + '.xml')).join('');
  entradas.push({
    nombre: 'ppt/presentation.xml',
    datos: txt('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentation ' + NS + '>' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>' +
      '<p:sldIdLst>' +
      laminas.map((_, i) => '<p:sldId id="' + (256 + i) + '" r:id="rIdSld' + (i + 1) + '"/>').join('') +
      '</p:sldIdLst>' +
      '<p:sldSz cx="' + ANCHO + '" cy="' + ALTO + '"/><p:notesSz cx="6858000" cy="9144000"/>' +
      '</p:presentation>'),
  });
  entradas.push({
    nombre: 'ppt/_rels/presentation.xml.rels',
    datos: txt(RELS(
      REL('rIdMaster', 'slideMaster', 'slideMasters/slideMaster1.xml') +
      relsLaminas +
      REL('rIdPr', 'presProps', 'presProps.xml') +
      REL('rIdVw', 'viewProps', 'viewProps.xml') +
      REL('rIdTbl', 'tableStyles', 'tableStyles.xml') +
      REL('rIdTema', 'theme', 'theme/theme1.xml')
    )),
  });

  entradas.push({ nombre: 'ppt/presProps.xml', datos: txt('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr ' + NS + '/>') });
  entradas.push({ nombre: 'ppt/viewProps.xml', datos: txt('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr ' + NS + '/>') });
  entradas.push({ nombre: 'ppt/tableStyles.xml', datos: txt('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>') });

  entradas.push({ nombre: 'ppt/slideMasters/slideMaster1.xml', datos: txt(XML_MASTER) });
  entradas.push({
    nombre: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    datos: txt(RELS(
      REL('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml') +
      REL('rId2', 'theme', '../theme/theme1.xml')
    )),
  });
  entradas.push({ nombre: 'ppt/slideLayouts/slideLayout1.xml', datos: txt(XML_LAYOUT) });
  entradas.push({
    nombre: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    datos: txt(RELS(REL('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml'))),
  });
  entradas.push({ nombre: 'ppt/theme/theme1.xml', datos: txt(XML_TEMA) });

  laminas.forEach((lam, i) => {
    entradas.push({ nombre: 'ppt/slides/slide' + (i + 1) + '.xml', datos: txt(lam.xml) });
    entradas.push({
      nombre: 'ppt/slides/_rels/slide' + (i + 1) + '.xml.rels',
      datos: txt(RELS(
        REL('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml') +
        lam.fotos.map(f => REL(f.relId, 'image', '../media/' + f.nombre)).join('')
      )),
    });
    for (const f of lam.fotos) {
      entradas.push({ nombre: 'ppt/media/' + f.nombre, datos: f.datos });
    }
  });

  const blob = new Blob([fabricarZip(entradas)], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  const base = (servicio.titulo || 'PROCEDIMIENTO').toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑ0-9 ]/gi, '').trim();

  return {
    blob,
    nombreArchivo: base + ' PROCEDIMIENTO.pptx',
    laminas: laminas.length,
    pasos: nPaso,
  };
}
