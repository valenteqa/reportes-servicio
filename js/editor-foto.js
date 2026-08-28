// Editor de fotos, no destructivo.
//
// La foto ORIGINAL nunca se toca: se guarda en foto.blobOriginal y cada
// edicion guarda su "receta" en foto.edicion:
//   { pasos90, flipH, flipV, fino,          giro en pasos de 90 + ajuste fino
//     recorte: {x,y,w,h} | null,            normalizado sobre la imagen girada
//     formas: [{tipo,x1,y1,x2,y2}] }        rect|circulo|flecha, normalizadas
// Al guardar se re-renderiza el resultado desde el original y se actualizan
// blob y miniatura. Revertir borra la receta y restaura el original.
//
// Herramientas: recortar, girar (90°, libre, flips), y formas rojas de borde
// grueso sin relleno (rectangulo, circulo, flecha) para señalar.

import * as db from './db.js';
import { h, aviso, confirmar, anclarCapa, bloquearScroll, liberarScroll } from './ui.js';

const ROJO = '#FF2222';

// Colores y grosores disponibles para las formas. El estilo elegido se
// recuerda (localStorage) y cada forma guarda el suyo en la receta.
const COLORES_FORMA = ['#FF2222', '#FFD400', '#2979FF', '#2ECC40', '#FFFFFF'];
const GROSORES = { 1: 0.6, 2: 1, 3: 1.7 };
const LADO_MAX = 1600;
const LADO_MINI = 320;

function edicionVacia() {
  return { pasos90: 0, flipH: false, flipV: false, fino: 0, recorte: null, formas: [] };
}

function esVacia(ed) {
  return !ed.pasos90 && !ed.flipH && !ed.flipV && !ed.fino && !ed.recorte && !ed.formas.length;
}

/* ---------------------------------------------------------------- */
/* Render: original + receta -> canvas                               */
/* ---------------------------------------------------------------- */

function dimsGiradas(w, h, angulo) {
  const r = angulo * Math.PI / 180;
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  return { w: w * c + h * s, h: w * s + h * c };
}

// Dibuja el bitmap girado+volteado en un canvas de tamaño maximo `cap`.
function lienzoTransformado(bitmap, ed, cap) {
  const angulo = ed.pasos90 * 90 + ed.fino;
  const d = dimsGiradas(bitmap.width, bitmap.height, angulo);
  const escala = Math.min(1, cap / Math.max(d.w, d.h));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(d.w * escala));
  cv.height = Math.max(1, Math.round(d.h * escala));
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(cv.width / 2, cv.height / 2);
  ctx.rotate(angulo * Math.PI / 180);
  ctx.scale(ed.flipH ? -escala : escala, ed.flipV ? -escala : escala);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  return cv;
}

function dibujarFormas(ctx, formas, w, h, recorte) {
  // Las formas viven en coords normalizadas de la imagen girada COMPLETA;
  // si hay recorte se desplazan para caer donde corresponde.
  const rx = recorte ? recorte.x : 0, ry = recorte ? recorte.y : 0;
  const rw = recorte ? recorte.w : 1, rh = recorte ? recorte.h : 1;
  const lwBase = Math.max(4, Math.round(Math.hypot(w, h) * 0.006));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const f of formas) {
    // Recetas viejas no traen color/grosor: rojo y grosor medio.
    const lw = Math.max(2, Math.round(lwBase * (GROSORES[f.grosor] || 1)));
    ctx.strokeStyle = f.color || ROJO;
    ctx.lineWidth = lw;
    const x1 = (f.x1 - rx) / rw * w, y1 = (f.y1 - ry) / rh * h;
    const x2 = (f.x2 - rx) / rw * w, y2 = (f.y2 - ry) / rh * h;

    const cabezaEn = (px, py, ang) => {
      const cabeza = lw * 4;
      ctx.moveTo(px, py);
      ctx.lineTo(px - cabeza * Math.cos(ang - 0.45), py - cabeza * Math.sin(ang - 0.45));
      ctx.moveTo(px, py);
      ctx.lineTo(px - cabeza * Math.cos(ang + 0.45), py - cabeza * Math.sin(ang + 0.45));
    };

    ctx.beginPath();
    if (f.tipo === 'rect') {
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (f.tipo === 'circulo') {
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.tipo === 'flecha') {
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      cabezaEn(x2, y2, Math.atan2(y2 - y1, x2 - x1));
      ctx.stroke();
    } else if (f.tipo === 'flechaCurva') {
      // Curva cuadratica con comba perpendicular (30% del largo) y cabeza
      // alineada a la tangente final.
      const dx = x2 - x1, dy = y2 - y1;
      const L = Math.hypot(dx, dy) || 1;
      const cx = (x1 + x2) / 2 - dy * 0.3;
      const cy = (y1 + y2) / 2 + dx * 0.3;
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx, cy, x2, y2);
      cabezaEn(x2, y2, Math.atan2(y2 - cy, x2 - cx));
      ctx.stroke();
    }
  }
}

// Resultado final (recortado y con formas) en un canvas, tamaño maximo `cap`.
function renderFinal(bitmap, ed, cap) {
  const t = lienzoTransformado(bitmap, ed, 100000);   // sin limite: recorte exacto
  const r = ed.recorte || { x: 0, y: 0, w: 1, h: 1 };
  const sw = Math.max(1, Math.round(r.w * t.width));
  const sh = Math.max(1, Math.round(r.h * t.height));
  const escala = Math.min(1, cap / Math.max(sw, sh));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sw * escala));
  cv.height = Math.max(1, Math.round(sh * escala));
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(t, r.x * t.width, r.y * t.height, sw, sh, 0, 0, cv.width, cv.height);
  dibujarFormas(ctx, ed.formas, cv.width, cv.height, ed.recorte);
  return cv;
}

function aBlob(cv, calidad) {
  return new Promise(res => cv.toBlob(res, 'image/jpeg', calidad));
}

/* ---------------------------------------------------------------- */
/* Remapeo de coordenadas al girar 90 / voltear                      */
/* (para que recorte y formas sigan al contenido)                    */
/* ---------------------------------------------------------------- */

function remapear(ed, fn) {
  const p = (x, y) => fn(x, y);
  for (const f of ed.formas) {
    const a = p(f.x1, f.y1), b = p(f.x2, f.y2);
    f.x1 = a[0]; f.y1 = a[1]; f.x2 = b[0]; f.y2 = b[1];
  }
  if (ed.recorte) {
    const r = ed.recorte;
    const a = p(r.x, r.y), b = p(r.x + r.w, r.y + r.h);
    ed.recorte = {
      x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
      w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]),
    };
  }
}

/* ---------------------------------------------------------------- */
/* El editor                                                         */
/* ---------------------------------------------------------------- */

export async function editarFoto(evento, alTerminar) {
  const foto = await db.fotoLeer(evento.datos.fotoId);
  if (!foto) { aviso('La imagen no se encontro', 'error'); return false; }

  // Preservar el original la primera vez que se edita.
  if (!foto.blobOriginal) foto.blobOriginal = foto.blob;

  const bitmap = await createImageBitmap(foto.blobOriginal);
  const ed = foto.edicion
    ? JSON.parse(JSON.stringify(foto.edicion))
    : edicionVacia();
  if (!ed.formas) ed.formas = [];

  let modo = 'recortar';      // arranca en recortar | formas | girar
  let herramienta = null;     // rect | circulo | flecha | flechaCurva | null (manipular)

  // Estilo para formas nuevas (se recuerda entre sesiones). Con una forma
  // seleccionada, los botones de color/grosor la re-estilizan al momento.
  const estilo = { color: ROJO, grosor: 2 };
  try {
    const g = JSON.parse(localStorage.getItem('estiloFormas') || '{}');
    if (COLORES_FORMA.includes(g.color)) estilo.color = g.color;
    if (GROSORES[g.grosor]) estilo.grosor = g.grosor;
  } catch (e) {}
  const guardarEstilo = () => {
    try { localStorage.setItem('estiloFormas', JSON.stringify(estilo)); } catch (e) {}
  };
  let seleccion = null;       // forma seleccionada para mover/redimensionar
  let guardado = false;

  // Zoom de la VISTA en modo formas (para ajustar formas con precision).
  // s = aumento; ox/oy = esquina visible, en fraccion de la vista recortada.
  const zoom = { s: 1, ox: 0, oy: 0 };
  const zoomReset = () => { zoom.s = 1; zoom.ox = 0; zoom.oy = 0; };
  const zoomAcotar = () => {
    zoom.ox = Math.max(0, Math.min(1 - 1 / zoom.s, zoom.ox));
    zoom.oy = Math.max(0, Math.min(1 - 1 / zoom.s, zoom.oy));
  };

  // Recorte inicial: el cuadro completo (guardar sin tocarlo no recorta nada).
  if (!ed.recorte) ed.recorte = { x: 0, y: 0, w: 1, h: 1 };

  const lienzo = h('canvas.editor__lienzo');
  const ctx = lienzo.getContext('2d');
  const barraModos = h('div.editor__modos');
  const barraCtrl = h('div.editor__controles');

  // Boton flotante para quitar el zoom: aparece solo cuando hay zoom,
  // arriba a la izquierda, junto al boton de retroceso.
  const btnZoom = h('button.editor__zoomreset', {
    type: 'button', style: { display: 'none' },
    onclick: () => { zoomReset(); refrescarBtnZoom(); pintar(); },
  }, 'RESET ZOOM');
  function refrescarBtnZoom() {
    btnZoom.style.display = (modo === 'formas' && zoom.s > 1) ? '' : 'none';
  }

  /* ---------- pintado del preview ---------- */

  let vista = { esc: 1, offX: 0, offY: 0, w: 1, h: 1 };  // mapeo pantalla<->imagen

  function pintar() {
    const cont = lienzo.parentElement;
    if (!cont) return;
    // Respetar el padding real de la zona (marco anti-gesto de Android).
    const est = getComputedStyle(cont);
    const maxW = cont.clientWidth - parseFloat(est.paddingLeft) - parseFloat(est.paddingRight);
    const maxH = cont.clientHeight - parseFloat(est.paddingTop) - parseFloat(est.paddingBottom);

    const t = lienzoTransformado(bitmap, ed, 1400);
    let imgW = t.width, imgH = t.height, offX = 0, offY = 0, base = t;

    if (modo !== 'recortar' && ed.recorte) {
      // vista del resultado: recortada
      imgW = Math.max(1, Math.round(ed.recorte.w * t.width));
      imgH = Math.max(1, Math.round(ed.recorte.h * t.height));
      offX = ed.recorte.x * t.width;
      offY = ed.recorte.y * t.height;
    }

    const esc = Math.min(maxW / imgW, maxH / imgH, 1);
    lienzo.width = Math.max(1, Math.round(imgW * esc));
    lienzo.height = Math.max(1, Math.round(imgH * esc));
    vista = { esc, offX, offY, w: t.width, h: t.height };

    // Zoom de vista (solo formas): todo el pintado pasa por la misma
    // transformacion, asi imagen, formas y manijas coinciden siempre.
    if (modo === 'formas' && zoom.s > 1) {
      ctx.setTransform(zoom.s, 0, 0, zoom.s,
        -zoom.ox * lienzo.width * zoom.s, -zoom.oy * lienzo.height * zoom.s);
    }

    ctx.drawImage(base, offX, offY, imgW, imgH, 0, 0, lienzo.width, lienzo.height);
    // en vista recortada las formas se desplazan dentro de dibujarFormas
    dibujarFormas(ctx, ed.formas, lienzo.width, lienzo.height, modo === 'recortar' ? null : ed.recorte);

    if (modo === 'recortar') {
      const r = ed.recorte || { x: 0, y: 0, w: 1, h: 1 };
      const px = r.x * lienzo.width, py = r.y * lienzo.height;
      const pw = r.w * lienzo.width, ph = r.h * lienzo.height;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, 0, lienzo.width, py);
      ctx.fillRect(0, py + ph, lienzo.width, lienzo.height - py - ph);
      ctx.fillRect(0, py, px, ph);
      ctx.fillRect(px + pw, py, lienzo.width - px - pw, ph);
      // En tema claro el marco va NEGRO (el blanco se pierde); cada manija
      // lleva un filo del color opuesto para verse sobre cualquier foto.
      const esClaro = document.documentElement.dataset.tema === 'claro';
      const cRec = esClaro ? '#000' : '#fff';
      const cFilo = esClaro ? '#fff' : '#000';
      ctx.strokeStyle = cRec;
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, pw, ph);
      const manija = (x, y, w2, h2) => {
        ctx.fillStyle = cRec;
        ctx.fillRect(x, y, w2, h2);
        ctx.strokeStyle = cFilo;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + .5, y + .5, w2 - 1, h2 - 1);
      };
      for (const [hx, hy] of [[px, py], [px + pw, py], [px, py + ph], [px + pw, py + ph]]) {
        manija(hx - 8, hy - 8, 16, 16);
      }
      // manijas de BORDE (barras al centro de cada lado)
      manija(px + pw / 2 - 16, py - 5, 32, 10);
      manija(px + pw / 2 - 16, py + ph - 5, 32, 10);
      manija(px - 5, py + ph / 2 - 16, 10, 32);
      manija(px + pw - 5, py + ph / 2 - 16, 10, 32);
    }

    // Forma seleccionada: marco punteado + manijas en las esquinas
    if (modo === 'formas' && seleccion) {
      const rx = ed.recorte ? ed.recorte.x : 0, ry = ed.recorte ? ed.recorte.y : 0;
      const rw = ed.recorte ? ed.recorte.w : 1, rh = ed.recorte ? ed.recorte.h : 1;
      const px = (v) => (v - rx) / rw * lienzo.width;
      const py = (v) => (v - ry) / rh * lienzo.height;
      const f = seleccion;

      ctx.save();
      ctx.strokeStyle = '#35E0F2';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(
        Math.min(px(f.x1), px(f.x2)) - 6, Math.min(py(f.y1), py(f.y2)) - 6,
        Math.abs(px(f.x2) - px(f.x1)) + 12, Math.abs(py(f.y2) - py(f.y1)) + 12);
      ctx.setLineDash([]);
      for (const [cx2, cy2] of esquinasDe(f)) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(px(cx2) - 9, py(cy2) - 9, 18, 18);
        ctx.strokeStyle = '#FF2222';
        ctx.strokeRect(px(cx2) - 9, py(cy2) - 9, 18, 18);
      }
      ctx.restore();
    }
  }

  /* ---------- entrada tactil ---------- */

  // pantalla -> coords normalizadas de la imagen girada completa
  function aImagen(evp) {
    const rect = lienzo.getBoundingClientRect();
    let cx = (evp.clientX - rect.left) / rect.width;
    let cy = (evp.clientY - rect.top) / rect.height;
    if (modo === 'formas' && zoom.s > 1) {
      cx = zoom.ox + cx / zoom.s;
      cy = zoom.oy + cy / zoom.s;
    }
    if (modo !== 'recortar' && ed.recorte) {
      return [ed.recorte.x + cx * ed.recorte.w, ed.recorte.y + cy * ed.recorte.h];
    }
    return [cx, cy];
  }

  // coords de imagen -> px de pantalla (para hit-tests con tolerancia fija)
  function aPantalla(ix, iy) {
    const rect = lienzo.getBoundingClientRect();
    let fx = ix, fy = iy;
    if (modo !== 'recortar' && ed.recorte) {
      fx = (ix - ed.recorte.x) / ed.recorte.w;
      fy = (iy - ed.recorte.y) / ed.recorte.h;
    }
    if (modo === 'formas' && zoom.s > 1) {
      fx = (fx - zoom.ox) * zoom.s;
      fy = (fy - zoom.oy) * zoom.s;
    }
    return { x: rect.left + fx * rect.width, y: rect.top + fy * rect.height };
  }

  const esquinasDe = (f) => f.tipo === 'flecha'
    ? [[f.x1, f.y1], [f.x2, f.y2]]
    : [[f.x1, f.y1], [f.x2, f.y1], [f.x1, f.y2], [f.x2, f.y2]];

  const TOL = 26;   // px: zona de agarre pensada para dedo con guante

  let arrastre = null;
  const punteros = new Map();   // gestos de dos dedos
  let pellizco = null;          // dos dedos CON seleccion: escala la forma
  let vistaPellizco = null;     // dos dedos SIN seleccion: zoom/paneo de la vista

  lienzo.addEventListener('pointerdown', (evp) => {
    evp.preventDefault();
    try { lienzo.setPointerCapture(evp.pointerId); } catch (e) { /* punteros sinteticos */ }
    punteros.set(evp.pointerId, { x: evp.clientX, y: evp.clientY });

    // Dos dedos en modo formas:
    //   con forma seleccionada -> escala LA FORMA
    //   sin seleccion          -> zoom/paneo de LA VISTA
    if (punteros.size === 2 && modo === 'formas') {
      const [a, b] = Array.from(punteros.values());
      const d0 = Math.hypot(a.x - b.x, a.y - b.y);
      if (seleccion) {
        pellizco = {
          d0,
          f0: { x1: seleccion.x1, y1: seleccion.y1, x2: seleccion.x2, y2: seleccion.y2 },
          cx: (seleccion.x1 + seleccion.x2) / 2,
          cy: (seleccion.y1 + seleccion.y2) / 2,
        };
      } else {
        const rect = lienzo.getBoundingClientRect();
        const mx = ((a.x + b.x) / 2 - rect.left) / rect.width;
        const my = ((a.y + b.y) / 2 - rect.top) / rect.height;
        vistaPellizco = {
          d0, s0: zoom.s,
          // punto de la vista que esta bajo el centro de los dedos
          px: zoom.ox + mx / zoom.s,
          py: zoom.oy + my / zoom.s,
        };
      }
      arrastre = null;
      return;
    }

    const [ix, iy] = aImagen(evp);

    if (modo === 'formas') {
      if (herramienta) {
        // dibujar una forma nueva con el estilo elegido
        const forma = { tipo: herramienta, x1: ix, y1: iy, x2: ix, y2: iy,
          color: estilo.color, grosor: estilo.grosor };
        ed.formas.push(forma);
        arrastre = { tipo: 'forma', forma };
        return;
      }
      // sin herramienta armada: manipular lo ya dibujado
      if (seleccion) {
        // ¿agarro una esquina de la seleccionada?
        for (const [cx, cy] of esquinasDe(seleccion)) {
          const p = aPantalla(cx, cy);
          if (Math.hypot(evp.clientX - p.x, evp.clientY - p.y) < TOL) {
            arrastre = { tipo: 'redim', cx, cy };
            return;
          }
        }
      }
      // ¿toco una forma? (la mas reciente primero)
      for (let k = ed.formas.length - 1; k >= 0; k--) {
        const f = ed.formas[k];
        const minX = Math.min(f.x1, f.x2), maxX = Math.max(f.x1, f.x2);
        const minY = Math.min(f.y1, f.y2), maxY = Math.max(f.y1, f.y2);
        const p1 = aPantalla(minX, minY), p2 = aPantalla(maxX, maxY);
        if (evp.clientX > p1.x - TOL && evp.clientX < p2.x + TOL &&
            evp.clientY > p1.y - TOL && evp.clientY < p2.y + TOL) {
          seleccion = f;
          arrastre = { tipo: 'moverForma', ix, iy, f0: { x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2 } };
          pintarBarras();
          pintar();
          return;
        }
      }
      // toque en vacio: con zoom se panea; sin zoom, deseleccionar
      if (zoom.s > 1) {
        arrastre = { tipo: 'pan', x0: evp.clientX, y0: evp.clientY, ox0: zoom.ox, oy0: zoom.oy };
      }
      seleccion = null;
      pintarBarras();
      pintar();
    } else if (modo === 'recortar') {
      const r = ed.recorte || (ed.recorte = { x: 0, y: 0, w: 1, h: 1 });
      const rect = lienzo.getBoundingClientRect();
      const tolX = TOL / rect.width, tolY = TOL / rect.height;
      const cerca = (a, b, tol) => Math.abs(a - b) < tol;
      const dentroX = ix > r.x - tolX && ix < r.x + r.w + tolX;
      const dentroY = iy > r.y - tolY && iy < r.y + r.h + tolY;

      let esquina = null;
      if (cerca(ix, r.x, tolX) && cerca(iy, r.y, tolY)) esquina = 'no';
      else if (cerca(ix, r.x + r.w, tolX) && cerca(iy, r.y, tolY)) esquina = 'ne';
      else if (cerca(ix, r.x, tolX) && cerca(iy, r.y + r.h, tolY)) esquina = 'so';
      else if (cerca(ix, r.x + r.w, tolX) && cerca(iy, r.y + r.h, tolY)) esquina = 'se';

      // Sin esquina: ¿agarro un BORDE? (mas facil en pantallas chicas)
      let lado = null;
      if (!esquina) {
        if (cerca(ix, r.x, tolX) && dentroY) lado = 'izq';
        else if (cerca(ix, r.x + r.w, tolX) && dentroY) lado = 'der';
        else if (cerca(iy, r.y, tolY) && dentroX) lado = 'arr';
        else if (cerca(iy, r.y + r.h, tolY) && dentroX) lado = 'aba';
      }

      arrastre = esquina ? { tipo: 'esquina', esquina }
        : lado ? { tipo: 'lado', lado }
        : { tipo: 'mover', ix, iy, r0: { ...r } };
    }
  });

  lienzo.addEventListener('pointermove', (evp) => {
    if (punteros.has(evp.pointerId)) {
      punteros.set(evp.pointerId, { x: evp.clientX, y: evp.clientY });
    }

    // pellizco de VISTA: zoom + paneo siguiendo el centro de los dedos
    if (vistaPellizco && punteros.size === 2) {
      evp.preventDefault();
      const [a, b] = Array.from(punteros.values());
      const rect = lienzo.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoom.s = Math.max(1, Math.min(6, vistaPellizco.s0 * d / vistaPellizco.d0));
      const mx = ((a.x + b.x) / 2 - rect.left) / rect.width;
      const my = ((a.y + b.y) / 2 - rect.top) / rect.height;
      zoom.ox = vistaPellizco.px - mx / zoom.s;
      zoom.oy = vistaPellizco.py - my / zoom.s;
      zoomAcotar();
      refrescarBtnZoom();
      pintar();
      return;
    }

    // pellizco: escala la forma seleccionada alrededor de su centro
    if (pellizco && punteros.size === 2 && seleccion) {
      evp.preventDefault();
      const [a, b] = Array.from(punteros.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const s = Math.max(0.15, Math.min(6, d / pellizco.d0));
      const { f0, cx, cy } = pellizco;
      seleccion.x1 = cx + (f0.x1 - cx) * s;
      seleccion.y1 = cy + (f0.y1 - cy) * s;
      seleccion.x2 = cx + (f0.x2 - cx) * s;
      seleccion.y2 = cy + (f0.y2 - cy) * s;
      pintar();
      return;
    }

    if (!arrastre) return;
    evp.preventDefault();
    let [ix, iy] = aImagen(evp);
    ix = Math.max(0, Math.min(1, ix));
    iy = Math.max(0, Math.min(1, iy));

    if (arrastre.tipo === 'forma') {
      arrastre.forma.x2 = ix;
      arrastre.forma.y2 = iy;
    } else if (arrastre.tipo === 'pan') {
      const rect = lienzo.getBoundingClientRect();
      zoom.ox = arrastre.ox0 - (evp.clientX - arrastre.x0) / rect.width / zoom.s;
      zoom.oy = arrastre.oy0 - (evp.clientY - arrastre.y0) / rect.height / zoom.s;
      zoomAcotar();
    } else if (arrastre.tipo === 'moverForma') {
      const dx = ix - arrastre.ix, dy = iy - arrastre.iy;
      seleccion.x1 = arrastre.f0.x1 + dx;
      seleccion.y1 = arrastre.f0.y1 + dy;
      seleccion.x2 = arrastre.f0.x2 + dx;
      seleccion.y2 = arrastre.f0.y2 + dy;
    } else if (arrastre.tipo === 'redim') {
      // la esquina agarrada sigue al dedo; la opuesta queda fija
      const f = seleccion;
      if (Math.abs(arrastre.cx - f.x1) < Math.abs(arrastre.cx - f.x2)) f.x1 = ix; else f.x2 = ix;
      if (Math.abs(arrastre.cy - f.y1) < Math.abs(arrastre.cy - f.y2)) f.y1 = iy; else f.y2 = iy;
      arrastre.cx = ix; arrastre.cy = iy;
    } else if (arrastre.tipo === 'esquina') {
      const r = ed.recorte;
      const x2 = r.x + r.w, y2 = r.y + r.h;
      if (arrastre.esquina === 'no') { r.w = x2 - ix; r.h = y2 - iy; r.x = ix; r.y = iy; }
      if (arrastre.esquina === 'ne') { r.w = ix - r.x; r.h = y2 - iy; r.y = iy; }
      if (arrastre.esquina === 'so') { r.w = x2 - ix; r.x = ix; r.h = iy - r.y; }
      if (arrastre.esquina === 'se') { r.w = ix - r.x; r.h = iy - r.y; }
      r.w = Math.max(0.05, r.w); r.h = Math.max(0.05, r.h);
    } else if (arrastre.tipo === 'lado') {
      const r = ed.recorte;
      const x2 = r.x + r.w, y2 = r.y + r.h;
      if (arrastre.lado === 'izq') { r.w = x2 - ix; r.x = ix; }
      if (arrastre.lado === 'der') { r.w = ix - r.x; }
      if (arrastre.lado === 'arr') { r.h = y2 - iy; r.y = iy; }
      if (arrastre.lado === 'aba') { r.h = iy - r.y; }
      r.w = Math.max(0.05, r.w); r.h = Math.max(0.05, r.h);
    } else if (arrastre.tipo === 'mover') {
      const r = ed.recorte, r0 = arrastre.r0;
      r.x = Math.max(0, Math.min(1 - r.w, r0.x + (ix - arrastre.ix)));
      r.y = Math.max(0, Math.min(1 - r.h, r0.y + (iy - arrastre.iy)));
    }
    pintar();
  });

  const soltar = (evp) => {
    punteros.delete(evp.pointerId);
    if (punteros.size < 2) { pellizco = null; vistaPellizco = null; }

    if (arrastre && arrastre.tipo === 'forma') {
      const f = arrastre.forma;
      if (Math.abs(f.x2 - f.x1) < 0.01 && Math.abs(f.y2 - f.y1) < 0.01) {
        // Toque sin arrastre: forma MEDIANA centrada en el punto (22% del
        // lado corto de la imagen), sin salirse de los bordes.
        const tam = 0.22 * Math.min(lienzo.width, lienzo.height);
        const hx = (tam / 2) / lienzo.width;
        const hy = (tam / 2) / lienzo.height;
        const cx = Math.max(hx, Math.min(1 - hx, f.x1));
        const cy = Math.max(hy, Math.min(1 - hy, f.y1));
        f.x1 = cx - hx; f.y1 = cy - hy;
        f.x2 = cx + hx; f.y2 = cy + hy;
      }
      // Forma agregada: soltar la herramienta y dejarla seleccionada
      // para poder moverla o redimensionarla de inmediato.
      herramienta = null;
      seleccion = f;
      pintarBarras();
    }
    arrastre = null;
    pintar();
  };
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);

  /* ---------- barras de herramientas ---------- */

  const btn = (texto, activo, alPulsar, titulo) =>
    h('button.editor__btn' + (activo ? '.editor__btn--activo' : ''), {
      type: 'button', 'aria-label': titulo || texto, onclick: alPulsar,
    }, texto);

  function pintarBarras() {
    const cambiarModo = (m) => {
      modo = m;
      seleccion = null;
      herramienta = null;
      zoomReset();
      refrescarBtnZoom();
      if (m === 'recortar' && !ed.recorte) ed.recorte = { x: 0, y: 0, w: 1, h: 1 };
      pintarBarras();
      pintar();
    };
    barraModos.replaceChildren(
      btn('✂ Recortar', modo === 'recortar', () => cambiarModo('recortar')),
      btn('▭ Formas', modo === 'formas', () => cambiarModo('formas')),
      btn('⟳ Girar', modo === 'girar', () => cambiarModo('girar')),
    );

    if (modo === 'formas') {
      // La herramienta se desarma sola al dibujar; volver a tocarla la rearma.
      const armar = (t) => { herramienta = herramienta === t ? null : t; seleccion = null; pintarBarras(); pintar(); };

      const filaHerr = h('div.editor__fila', ...[
        btn('▭', herramienta === 'rect', () => armar('rect'), 'Rectangulo'),
        btn('◯', herramienta === 'circulo', () => armar('circulo'), 'Circulo'),
        btn('↗', herramienta === 'flecha', () => armar('flecha'), 'Flecha'),
        // (la flecha curva se descarto; el dibujo de 'flechaCurva' se queda
        //  por si alguna receta vieja la trae)
        herramienta
          ? h('p.editor__pista', 'Toca (tamaño mediano) o arrastra.')
          : h('p.editor__pista', seleccion
              ? 'Arrastra para mover · esquinas o 2 dedos para tamaño.'
              : 'Toca una forma para moverla · 2 dedos: zoom.'),
        h('span.crece'),
        btn('⌫', false, () => {
          if (seleccion) {
            const i2 = ed.formas.indexOf(seleccion);
            if (i2 > -1) ed.formas.splice(i2, 1);
            seleccion = null;
          } else {
            ed.formas.pop();
          }
          pintarBarras();
          pintar();
        }, 'Eliminar forma'),
      ].filter(Boolean));

      // Color y grosor: aplican a la forma seleccionada, o quedan como el
      // estilo de la siguiente que dibujes.
      const colorActivo = seleccion ? (seleccion.color || ROJO) : estilo.color;
      const grosorActivo = seleccion ? (seleccion.grosor || 2) : estilo.grosor;
      const aplicarEstilo = (cambio) => {
        Object.assign(estilo, cambio);
        guardarEstilo();
        if (seleccion) Object.assign(seleccion, cambio);
        pintarBarras();
        pintar();
      };
      const filaEstilo = h('div.editor__fila',
        COLORES_FORMA.map(c =>
          h('button.editor__color' + (c === colorActivo ? '.editor__color--activo' : ''), {
            type: 'button', 'aria-label': 'Color ' + c,
            style: { background: c },
            onclick: () => aplicarEstilo({ color: c }),
          })),
        h('span.crece'),
        [1, 2, 3].map(g =>
          h('button.editor__grosor' + (g === grosorActivo ? '.editor__grosor--activo' : ''), {
            type: 'button', 'aria-label': 'Grosor ' + g,
            onclick: () => aplicarEstilo({ grosor: g }),
          }, h('span', { style: { height: (g * 2 + 1) + 'px' } })))
      );

      barraCtrl.replaceChildren(filaHerr, filaEstilo);
    } else if (modo === 'recortar') {
      barraCtrl.replaceChildren(
        h('p.editor__pista', 'Arrastra las esquinas o mueve el recuadro.'),
        h('span.crece'),
        h('div.editor__columna',
          // Confirmacion del recorte aqui mismo, para no confundir con la
          // palomita de arriba (esa guarda TODA la edicion).
          h('button.editor__btn.editor__btn--primario', {
            type: 'button', onclick: () => cambiarModo('formas'),
          }, '✓ Aplicar recorte'),
          btn('Quitar recorte', false, () => { ed.recorte = null; pintar(); }),
        ),
      );
    } else {
      const slider = h('input.editor__fino', {
        type: 'range', min: '-45', max: '45', step: '1', value: String(ed.fino),
        oninput: () => { ed.fino = Number(slider.value); etiqueta.textContent = ed.fino + '°'; pintar(); },
      });
      const etiqueta = h('span.editor__grados', ed.fino + '°');
      barraCtrl.replaceChildren(
        btn('⟳ 90°', false, () => {
          ed.pasos90 = (ed.pasos90 + 1) % 4;
          remapear(ed, (x, y) => [1 - y, x]);
          pintar();
        }),
        btn('⇋', false, () => { ed.flipH = !ed.flipH; remapear(ed, (x, y) => [1 - x, y]); pintar(); }, 'Voltear horizontal'),
        btn('⇵', false, () => { ed.flipV = !ed.flipV; remapear(ed, (x, y) => [x, 1 - y]); pintar(); }, 'Voltear vertical'),
        slider, etiqueta,
        btn('↺', false, () => {
          // Deshacer giros y volteos aplicando los remapeos inversos, para que
          // recorte y formas regresen a su lugar sobre la imagen original.
          if (ed.flipH) { remapear(ed, (x, y) => [1 - x, y]); ed.flipH = false; }
          if (ed.flipV) { remapear(ed, (x, y) => [x, 1 - y]); ed.flipV = false; }
          const faltan = (4 - ed.pasos90) % 4;
          for (let k = 0; k < faltan; k++) remapear(ed, (x, y) => [1 - y, x]);
          ed.pasos90 = 0;
          ed.fino = 0;
          pintarBarras();
          pintar();
        }, 'Restablecer giros'),
      );
    }
  }

  /* ---------- guardar / revertir / cerrar ---------- */

  // Un recorte que abarca (casi) todo no es recorte.
  function normalizarRecorte() {
    const r = ed.recorte;
    if (r && r.x < 0.005 && r.y < 0.005 && r.w > 0.99 && r.h > 0.99) ed.recorte = null;
  }

  // Vista previa en grande antes de guardar: asi se ve EXACTAMENTE como
  // quedara la foto, se pone la leyenda ahi mismo, y se confirma o se
  // vuelve a editar. Resuelve { pie } al confirmar, o null para volver.
  function confirmarPrevia(blobFinal) {
    return new Promise((res) => {
      const url = URL.createObjectURL(blobFinal);
      let listo = false;
      let porBack = false;
      const ancla = anclarCapa(() => { porBack = true; terminar(false); });

      const pie = h('input.editor-previa__pie', {
        type: 'text',
        placeholder: 'Ej. Fuga en el sello de la bomba',
        value: (evento.datos && evento.datos.pie) || '',
        enterkeyhint: 'done',
        onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); pie.blur(); } },
      });
      const leyenda = h('div.editor-previa__leyenda',
        h('label.editor-previa__etq', 'LEYENDA DE LA FOTO — SALE EN EL REPORTE'),
        pie
      );

      // Desliza la leyenda al centro del hueco visible entre la foto y los
      // botones. Es un transform: el resto del acomodo no se mueve ni un px.
      // Nunca sube mas alla del borde inferior de la foto.
      const centrarLeyenda = () => {
        leyenda.style.transform = '';
        const im = previa.querySelector('.editor-previa__zona img');
        const a = im.getBoundingClientRect();
        const l = leyenda.getBoundingClientRect();
        const b = previa.querySelector('.editor-previa__barra').getBoundingClientRect();
        if (!a.height || !l.height) return;
        const deseado = a.bottom + (b.top - a.bottom - l.height) / 2;
        const corrimiento = Math.min(0, Math.max(a.bottom - l.top, deseado - l.top));
        leyenda.style.transform = 'translateY(' + Math.round(corrimiento) + 'px)';
      };

      let preguntando = false;
      async function terminar(ok) {
        if (listo || preguntando) return;
        if (ok && !pie.value.trim()) {
          preguntando = true;
          const sinLeyenda = await confirmar('La foto va sin leyenda. ¿Guardar asi?',
            { textoOk: 'Guardar sin leyenda' });
          preguntando = false;
          if (!sinLeyenda) { pie.focus(); return; }   // a escribirla
          if (listo) return;
        }
        listo = true;
        window.removeEventListener('resize', centrarLeyenda);
        URL.revokeObjectURL(url);
        previa.remove();
        if (porBack) ancla.desdePop();
        else await ancla.liberar();
        res(ok ? { pie: pie.value.trim() } : null);
      }

      const previa = h('div.editor-previa',
        h('div.editor-previa__zona', h('img', { src: url, alt: 'Vista previa', onload: centrarLeyenda })),
        leyenda,
        h('div.editor-previa__barra',
          h('button.btn.btn--fantasma', { type: 'button', onclick: () => terminar(false) }, '← Seguir editando'),
          h('button.btn.btn--primario', { type: 'button', onclick: () => terminar(true) }, 'Confirmar y guardar')
        )
      );
      document.body.appendChild(previa);
      // Doble disparo (sin rAF): cubre layouts tardios; resize cubre el teclado.
      setTimeout(centrarLeyenda, 0);
      setTimeout(centrarLeyenda, 150);
      window.addEventListener('resize', centrarLeyenda);
    });
  }

  async function aplicar() {
    normalizarRecorte();
    const final = renderFinal(bitmap, ed, LADO_MAX);
    const blob = await aBlob(final, 0.85);

    const conf = await confirmarPrevia(blob);
    if (!conf) {
      if (!ed.recorte && modo === 'recortar') ed.recorte = { x: 0, y: 0, w: 1, h: 1 };
      pintar();
      return;   // de vuelta al editor
    }

    // La leyenda vive en el evento (igual que al editarla en el visor).
    if (evento.datos && conf.pie !== (evento.datos.pie || '')) {
      evento.datos.pie = conf.pie;
      await db.eventoGuardar(evento);
    }

    const miniCv = renderFinal(bitmap, ed, LADO_MINI);
    const mini = await aBlob(miniCv, 0.7);

    foto.blob = blob;
    foto.mini = mini;
    foto.ancho = final.width;
    foto.alto = final.height;
    foto.bytes = blob.size;
    foto.edicion = esVacia(ed) ? null : ed;
    await db.fotoGuardar(foto);
    guardado = true;
    aviso('Foto guardada', 'ok');
    cerrar();
  }

  async function revertir() {
    if (!(await confirmar('Se quitan recorte, giros y formas: la foto vuelve al original.', { textoOk: 'Revertir', peligro: false }))) return;
    const orig = await createImageBitmap(foto.blobOriginal);
    const cv = document.createElement('canvas');
    const escMini = Math.min(1, LADO_MINI / Math.max(orig.width, orig.height));
    cv.width = Math.max(1, Math.round(orig.width * escMini));
    cv.height = Math.max(1, Math.round(orig.height * escMini));
    cv.getContext('2d').drawImage(orig, 0, 0, cv.width, cv.height);
    foto.blob = foto.blobOriginal;
    foto.mini = await aBlob(cv, 0.7);
    foto.ancho = orig.width;
    foto.alto = orig.height;
    foto.bytes = foto.blobOriginal.size;
    foto.edicion = null;
    orig.close && orig.close();
    await db.fotoGuardar(foto);
    guardado = true;
    aviso('Foto restaurada al original', 'ok');
    cerrar();
  }

  let resuelto = false;
  let porBack = false;
  let resolver;
  const promesa = new Promise(res => { resolver = res; });
  const ancla = anclarCapa(() => { porBack = true; cerrar(); });

  const capa = h('div.editor',
    h('div.editor__barra',
      h('button.icono-btn', { type: 'button', 'aria-label': 'Cancelar', onclick: () => cerrar() }, '✕'),
      h('span.editor__titulo', 'Editar foto'),
      h('button.enlace.editor__revertir', { type: 'button', onclick: revertir }, 'Revertir'),
      h('button.editor__ok', { type: 'button', 'aria-label': 'Guardar', onclick: aplicar }, '✓')
    ),
    h('div.editor__zona', lienzo, btnZoom),
    barraCtrl,
    barraModos
  );

  async function cerrar() {
    if (resuelto) return;
    resuelto = true;
    bitmap.close && bitmap.close();
    capa.remove();
    liberarScroll();
    if (porBack) ancla.desdePop();
    else await ancla.liberar();
    if (guardado && alTerminar) alTerminar();
    resolver(guardado);
  }

  document.body.appendChild(capa);
  bloquearScroll();
  pintarBarras();
  // Doble pintado: el primero puede correr antes de que el layout de la zona
  // tenga altura real. Y re-pintar al girar el telefono.
  requestAnimationFrame(pintar);
  setTimeout(pintar, 80);
  const alRedimensionar = () => pintar();
  window.addEventListener('resize', alRedimensionar);

  return promesa.finally(() => window.removeEventListener('resize', alRedimensionar));
}
