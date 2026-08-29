// Vista previa del reporte Word, simulando EL FORMATO FINAL: paginas tamaño
// carta con los margenes reales de la plantilla, membrete (logo + banda),
// marca de agua, pie de pagina con los datos de la empresa, indice con
// numeros de pagina calculados, y las fotos AL TAMAÑO elegido (misma
// matematica que el generador). Es la mejor aproximacion posible sin el
// motor de Word: los saltos exactos de linea pueden variar un poco en la PC
// porque las fuentes del formato (Univers/Aptos) viven alla.

import * as db from '../db.js';
import { h, aviso, anclarCapa, bloquearScroll, liberarScroll, orientarLibre, orientarNormal } from '../ui.js';
import { fechaLarga, folioDe } from '../reporte.js';

/* Geometria real de la plantilla, en pixeles de 96 dpi.
   Carta 12240x15840 twips = 816x1056 px; margenes 1701/1417 twips. */
const PAG_W = 816;
const PAG_H = 1056;
const MARG_X = 113;              // 1701 twips
const CONT_W = PAG_W - MARG_X * 2;   // 590
const ENC_TOP = 0;               // la banda va pegada al borde superior
const CUERPO_TOP = 172;          // bajo el membrete (banda 44px + logo 99px)
const CUERPO_H = 789;            // hasta arriba del pie
const ANCHO_TABLA = 624;         // tblW 9360 twips = 6.5in (rebasa 34px el margen, como Word)

// Tamaño de imagen: LA MISMA formula que imagenXml del generador.
function tamImagenPx(anchoPx, altoPx, tam) {
  const MAXW = 5580000;
  const ALTOS = { chico: 1700000, mediano: 3800000, grande: 7600000 };
  const maxH = ALTOS[tam] || ALTOS.grande;
  const porPx = 9525;
  let cx = (anchoPx || 1600) * porPx;
  let cy = (altoPx || 1200) * porPx;
  if (cx > MAXW) { cy = Math.round(cy * MAXW / cx); cx = MAXW; }
  if (cy > maxH) { cx = Math.round(cx * maxH / cy); cy = maxH; }
  return { w: Math.round(cx / porPx), h: Math.round(cy / porPx) };
}

export async function vistaPreviaReporte(servicioId) {
  const servicio = await db.servicioLeer(servicioId);
  if (!servicio) return;

  const actividades = await db.equiposDeServicio(servicioId);
  const eventos = (await db.eventosDeServicio(servicioId)).filter(e => e.incluir !== false);
  const porRama = {};
  for (const ev of eventos) (porRama[ev.equipoId] = porRama[ev.equipoId] || []).push(ev);

  const urls = [];
  let nFigura = 0;

  const parrafos = (texto) => (texto || '').split('\n')
    .map(s => s.trim()).filter(Boolean)
    .map(s => h('p.pw__p', s));

  const vineta = (t) => h('p.pw__p.pw__vineta', t);

  async function eventoNodo(ev) {
    // Los textos llevan la viñeta del formato, un renglon por viñeta.
    if (ev.tipo === 'nota') {
      return (ev.datos.texto || '').split('\n').map(s => s.trim()).filter(Boolean).map(vineta);
    }

    if (ev.tipo === 'tabla') {
      const t = ev.datos;
      const filas = (t.filas || []).filter(f => f.some(c => String(c).trim() !== ''));
      const sep = (i) => (t.separadores || []).includes(i) ? 'sep-grupo' : '';
      const nCols = Math.max(1, (t.columnas || []).length);
      const anchoCol = Math.floor(ANCHO_TABLA / nCols);
      return [
        t.titulo ? h('p.pw__p.pw__tituloTabla', String(t.titulo).toUpperCase()) : null,
        t.subtitulo ? h('p.pw__p', t.subtitulo) : null,
        h('table.pw__tabla', { style: { width: ANCHO_TABLA + 'px' } },
          h('thead', h('tr', (t.columnas || []).map((c, i) =>
            h('th', { class: sep(i), style: { width: anchoCol + 'px' } },
              typeof c === 'string' ? c : (c.nombre || '') + (c.unidad ? ' (' + c.unidad + ')' : ''))))),
          h('tbody', filas.map(f => h('tr', f.map((c, i) => h('td', { class: sep(i) }, String(c))))))
        ),
      ];
    }

    if (ev.tipo === 'foto') {
      const foto = await db.fotoLeer(ev.datos.fotoId);
      if (!foto) return null;
      nFigura++;
      const url = URL.createObjectURL(foto.blob);
      urls.push(url);
      // Fotos sin ancho/alto guardado (viejas o restauradas): medir el archivo.
      let aw = foto.ancho, ah = foto.alto;
      if (!aw || !ah) {
        const sonda = new Image();
        sonda.src = url;
        try {
          await Promise.race([sonda.decode(), new Promise((x, rej) => setTimeout(rej, 1500))]);
          aw = sonda.naturalWidth; ah = sonda.naturalHeight;
        } catch (e) { aw = aw || 1600; ah = ah || 1200; }
      }
      const dim = tamImagenPx(aw, ah, ev.datos.tamImagen);
      // Que la figura completa (foto + pie) quepa en una hoja: si la foto es
      // mas alta que el area util, se reduce proporcionalmente.
      if (dim.h > 715) { dim.w = Math.round(dim.w * 715 / dim.h); dim.h = 715; }
      return h('figure.pw__figura',
        h('img', { src: url, alt: '', style: { width: dim.w + 'px', height: dim.h + 'px' } }),
        h('figcaption', 'Figura ' + nFigura + (ev.datos.pie ? '. ' + ev.datos.pie : ''))
      );
    }

    if (ev.tipo === 'prueba') {
      return [
        h('p.pw__p', h('strong', 'Prueba: '), ev.datos.descripcion || ''),
        h('p.pw__p', h('strong', 'Resultado: '),
          ev.datos.resultado || h('em.pw__gris', '(pendiente de resultado)')),
      ];
    }

    return null;   // los pendientes van en su propia seccion
  }

  /* ---- bloques del documento, en el orden del generador ---- */

  const bloques = [];   // { el, seccion?, esTitulo?, rompe? }
  const meter = (el, extra) => { if (el) bloques.push(Object.assign({ el }, extra || {})); };
  const meterVarios = (nodos) => {
    for (const n of [].concat(nodos || [])) if (n) meter(n);
  };

  // Portada: titulo de la empresa, fecha, tabla de datos.
  meter(h('p.pw__empresa', 'GRUPO DE SERVICIOS Y PROCESOS PLÁSTICOS'));
  meter(h('p.pw__p.pw__fecha', h('strong', 'Fecha de realización del servicio: '),
    fechaLarga(servicio.inicio) + '   ·   Folio ' + (servicio.folio || folioDe(servicio))));

  const filasDatos = [
    ['Cliente:', servicio.cliente], ['Planta:', servicio.planta],
    ['Tipo de Máquina:', servicio.marca], ['Modelo:', servicio.modelo],
    ['Número de Serie:', servicio.serie], ['No. de Máquina:', servicio.noMaquina],
  ].filter(([, v]) => v);
  meter(h('table.pw__tabla.pw__datos', { style: { width: ANCHO_TABLA + 'px' } }, h('tbody',
    filasDatos.map(([k, v]) => h('tr', h('th', k), h('td', v))),
    h('tr',
      h('th.pw__datoCab', 'Descripción del servicio'),
      h('th.pw__datoCab', 'Tecnico')),
    h('tr',
      h('td', (servicio.descripcion || servicio.titulo || '').replace(/\n+/g, ' ')),
      h('td', servicio.tecnico || ''))
  )));

  // Indice: los renglones existen desde ahora (su altura cuenta al paginar);
  // los numeros de pagina se rellenan al final, ya paginado.
  const secciones = [];
  const evAntecedentes = porRama[db.ANTECEDENTES] || [];
  if (evAntecedentes.length) secciones.push('ANTECEDENTES');
  const evGeneral = (porRama[db.GENERAL] || []).filter(e => e.tipo !== 'pendiente');
  if (evGeneral.length) secciones.push('ACTIVIDADES');
  for (const act of actividades) {
    if (((porRama[act.id] || []).filter(e => e.tipo !== 'pendiente')).length) {
      secciones.push(String(act.nombre).toUpperCase());
    }
  }
  const pendientes = eventos.filter(e => e.tipo === 'pendiente');
  if (pendientes.length) secciones.push('PENDIENTES');
  secciones.push('OBSERVACIONES Y RECOMENDACIONES');

  meter(h('p.pw__contenido', 'CONTENIDO'));
  const filasIndice = new Map();
  for (const s of secciones) {
    const num = h('span.pw__tocnum', '·');
    filasIndice.set(s, num);
    meter(h('p.pw__toc', h('span.pw__tocnombre', s), h('span.pw__tocpuntos'), num));
  }

  meter(null);
  bloques.push({ el: h('span'), rompe: true });   // el cuerpo arranca en pagina nueva

  const seccionesPagina = new Map();
  async function meterSeccion(nombre, evs) {
    const titulo = h('h2.pw__h1', nombre.toUpperCase());
    meter(titulo, { seccion: nombre.toUpperCase(), esTitulo: true });
    for (const ev of evs) meterVarios(await eventoNodo(ev));
  }

  if (evAntecedentes.length) {
    meter(h('h2.pw__h1', 'ANTECEDENTES'), { seccion: 'ANTECEDENTES', esTitulo: true });
    for (const ev of evAntecedentes) meterVarios(await eventoNodo(ev));
  }
  if (evGeneral.length) await meterSeccion('Actividades', evGeneral);
  for (const act of actividades) {
    const evs = (porRama[act.id] || []).filter(e => e.tipo !== 'pendiente');
    if (evs.length) await meterSeccion(act.nombre, evs);
  }
  if (pendientes.length) {
    meter(h('h2.pw__h1', 'PENDIENTES'), { seccion: 'PENDIENTES', esTitulo: true });
    for (const p of pendientes) meter(vineta((p.datos.texto || '').replace(/\n+/g, ' ')));
  }
  meter(h('h2.pw__h1', 'OBSERVACIONES Y RECOMENDACIONES'), { seccion: 'OBSERVACIONES Y RECOMENDACIONES', esTitulo: true });
  let hayObs = false;
  for (const ev of (porRama[db.OBSERVACIONES] || [])) {
    if (ev.tipo === 'nota') {
      for (const linea of (ev.datos.texto || '').split('\n').map(s => s.trim()).filter(Boolean)) {
        meter(vineta(linea)); hayObs = true;
      }
    } else {
      const n = await eventoNodo(ev);
      if (n) { meterVarios(n); hayObs = true; }
    }
  }
  if (!hayObs) meter(vineta('(Redactar observaciones y recomendaciones)'));

  /* ---- armar paginas: membrete, marca de agua y pie en cada una ---- */

  const folio = servicio.folio || folioDe(servicio);
  const paginas = [];

  function nuevaPagina() {
    const cuerpo = h('div.pw__cuerpo');
    const el = h('div.pw',
      h('img.pw__marca-agua', { src: 'plantilla/logo15.jpeg', alt: '' }),
      h('div.pw__enc',
        h('img.pw__banda', { src: 'plantilla/logo16.png', alt: '' }),
        h('div.pw__encfila',
          h('img.pw__logo', { src: 'plantilla/logo14.png', alt: '' }),
          h('div.pw__enctexto',
            h('strong', 'Reporte Complementario'),
            h('span', folio + '   ·   ' + fechaLarga(servicio.inicio))))),
      cuerpo,
      h('div.pw__previa-marca',
        h('strong', 'VISTA PREVIA'),
        h('span', 'el documento final se verá mejor')),
      h('div.pw__pie',
        h('p', h('strong', 'GRUPO DE SERVICIOS Y PROCESOS PLASTICOS, S.A. DE C.V.')),
        h('p', 'MARTIN CHIMALTECATL NO. 211, BARRIO DE SANTA MARIA, C.P. 52740, OCOYOACAC, ESTADO DE MEXICO'),
        h('p.pw__pag', 'TEL: +52 728 287 5381'))
    );
    const pagina = { el, cuerpo, usado: 0 };
    paginas.push(pagina);
    return pagina;
  }

  // Medidor oculto con el ancho real del cuerpo: se mide cada bloque ya
  // renderizado y se reparte en paginas sin rebasar el alto util.
  const medidor = h('div.pw__medidor', { style: { width: CONT_W + 'px' } });
  document.body.appendChild(medidor);

  let pag = nuevaPagina();
  // Cada bloque se mide AISLADO (el que llama lo mueve a su pagina despues;
  // medir acumulado se descomponia al mover los bloques ya medidos).
  const alturaDe = (el) => {
    medidor.appendChild(el);
    const cs = getComputedStyle(el);
    return el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
  };

  for (let i = 0; i < bloques.length; i++) {
    const b = bloques[i];
    if (b.rompe) { if (pag.usado > 0) pag = nuevaPagina(); continue; }
    const alto = alturaDe(b.el);
    let cabe = pag.usado + alto <= CUERPO_H;
    // Un titulo no se queda huerfano al pie: necesita lugar para algo mas.
    if (cabe && b.esTitulo && (pag.usado + alto + 48) > CUERPO_H) cabe = false;
    if (!cabe && pag.usado > 0) { pag = nuevaPagina(); }
    pag.cuerpo.appendChild(b.el);
    pag.usado += alto;
    if (b.seccion) seccionesPagina.set(b.seccion, paginas.length);
  }
  medidor.remove();

  // Numeros reales: en el indice y en el pie de cada pagina.
  for (const [nombre, num] of filasIndice) {
    num.textContent = String(seccionesPagina.get(nombre) || '·');
  }
  paginas.forEach((p, i) => {
    p.el.querySelector('.pw__pag').textContent =
      'TEL: +52 728 287 5381   ·   Página ' + (i + 1) + ' de ' + paginas.length;
  });

  /* ---- capa a pantalla completa: zoom, giro libre e impresion ---- */

  return new Promise((resolve) => {
    let resuelto = false;
    let porBack = false;
    const ancla = anclarCapa(() => { porBack = true; cerrar(); });

    async function cerrar() {
      if (resuelto) return;
      resuelto = true;
      for (const u of urls) URL.revokeObjectURL(u);
      capa.remove();
      liberarScroll();
      orientarNormal();
      if (porBack) ancla.desdePop();
      else await ancla.liberar();
      resolve();
    }

    // Zoom: ajuste al ancho del telefono, o fijo 75/100/150 %.
    const lienzo = h('div.pw-lienzo', paginas.map(p => p.el));
    const etiquetaZoom = h('span.previa__nota');
    const escalaAjuste = () => Math.max(0.3, Math.min(1, Math.round(((window.innerWidth - 18) / PAG_W) * 1000) / 1000));
    const ZOOMS = ['ajuste', 0.75, 1, 1.5];
    let iZoom = 0;
    const aplicarEscala = () => {
      const z = ZOOMS[iZoom] === 'ajuste' ? escalaAjuste() : ZOOMS[iZoom];
      lienzo.style.zoom = z;
      etiquetaZoom.textContent = ZOOMS[iZoom] === 'ajuste'
        ? 'ajuste (' + Math.round(z * 100) + '%)' : Math.round(z * 100) + '%';
    };
    window.addEventListener('resize', aplicarEscala);

    // Imprimir: solo salen las paginas (CSS @media print + body.imprimiendo).
    // En el APK, window.print() no existe de verdad: va por el puente nativo.
    const imprimir = () => {
      document.body.classList.add('imprimiendo');
      const fin = () => document.body.classList.remove('imprimiendo');
      window.addEventListener('afterprint', fin, { once: true });
      setTimeout(fin, 4000);
      const Puente = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Puente;
      if (Puente && Puente.imprimir) {
        Puente.imprimir().catch(() => window.print());
      } else if (window.ImpresoraNativa && window.ImpresoraNativa.imprimir) {
        window.ImpresoraNativa.imprimir();
      } else {
        window.print();
      }
    };

    const capa = h('div.previa',
      h('div.previa__barra',
        h('button.icono-btn.icono-btn--claro', { type: 'button', 'aria-label': 'Cerrar', onclick: cerrar }, '✕'),
        h('span.previa__titulo', 'Vista previa'),
        h('span.crece'),
        h('button.icono-btn.icono-btn--claro', {
          type: 'button', 'aria-label': 'Alejar',
          onclick: () => { iZoom = (iZoom + ZOOMS.length - 1) % ZOOMS.length; aplicarEscala(); }
        }, '−'),
        etiquetaZoom,
        h('button.icono-btn.icono-btn--claro', {
          type: 'button', 'aria-label': 'Acercar',
          onclick: () => { iZoom = (iZoom + 1) % ZOOMS.length; aplicarEscala(); }
        }, '＋'),
        h('button.icono-btn.icono-btn--claro', { type: 'button', 'aria-label': 'Imprimir', onclick: imprimir }, '🖨')
      ),
      h('p.previa__aviso-nota', paginas.length + ' pagina(s) · formato real aproximado — los saltos de linea exactos pueden variar un poco en la PC'),
      h('div.previa__scroll', lienzo)
    );

    document.body.appendChild(capa);
    bloquearScroll();
    orientarLibre();
    aplicarEscala();
  });
}
