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
import { h, aviso, confirmar, anclarCapa } from './ui.js';

const ROJO = '#FF2222';
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
  const lw = Math.max(4, Math.round(Math.hypot(w, h) * 0.006));
  ctx.strokeStyle = ROJO;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const f of formas) {
    const x1 = (f.x1 - rx) / rw * w, y1 = (f.y1 - ry) / rh * h;
    const x2 = (f.x2 - rx) / rw * w, y2 = (f.y2 - ry) / rh * h;
    ctx.beginPath();
    if (f.tipo === 'rect') {
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (f.tipo === 'circulo') {
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.tipo === 'flecha') {
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const cabeza = lw * 4;
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - cabeza * Math.cos(ang - 0.45), y2 - cabeza * Math.sin(ang - 0.45));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - cabeza * Math.cos(ang + 0.45), y2 - cabeza * Math.sin(ang + 0.45));
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

  let modo = 'formas';        // formas | recortar | girar
  let herramienta = 'rect';   // rect | circulo | flecha
  let guardado = false;

  const lienzo = h('canvas.editor__lienzo');
  const ctx = lienzo.getContext('2d');
  const barraModos = h('div.editor__modos');
  const barraCtrl = h('div.editor__controles');

  /* ---------- pintado del preview ---------- */

  let vista = { esc: 1, offX: 0, offY: 0, w: 1, h: 1 };  // mapeo pantalla<->imagen

  function pintar() {
    const cont = lienzo.parentElement;
    if (!cont) return;
    const maxW = cont.clientWidth - 16;
    const maxH = cont.clientHeight - 16;

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
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, pw, ph);
      ctx.fillStyle = '#fff';
      for (const [hx, hy] of [[px, py], [px + pw, py], [px, py + ph], [px + pw, py + ph]]) {
        ctx.fillRect(hx - 8, hy - 8, 16, 16);
      }
    }
  }

  /* ---------- entrada tactil ---------- */

  // pantalla -> coords normalizadas de la imagen girada completa
  function aImagen(evp) {
    const rect = lienzo.getBoundingClientRect();
    const cx = (evp.clientX - rect.left) / rect.width;
    const cy = (evp.clientY - rect.top) / rect.height;
    if (modo !== 'recortar' && ed.recorte) {
      return [ed.recorte.x + cx * ed.recorte.w, ed.recorte.y + cy * ed.recorte.h];
    }
    return [cx, cy];
  }

  let arrastre = null;

  lienzo.addEventListener('pointerdown', (evp) => {
    evp.preventDefault();
    lienzo.setPointerCapture(evp.pointerId);
    const [ix, iy] = aImagen(evp);

    if (modo === 'formas') {
      const forma = { tipo: herramienta, x1: ix, y1: iy, x2: ix, y2: iy };
      ed.formas.push(forma);
      arrastre = { tipo: 'forma', forma };
    } else if (modo === 'recortar') {
      const r = ed.recorte || (ed.recorte = { x: 0, y: 0, w: 1, h: 1 });
      const rect = lienzo.getBoundingClientRect();
      const tolX = 24 / rect.width, tolY = 24 / rect.height;
      const cerca = (a, b, tol) => Math.abs(a - b) < tol;
      let esquina = null;
      if (cerca(ix, r.x, tolX) && cerca(iy, r.y, tolY)) esquina = 'no';
      else if (cerca(ix, r.x + r.w, tolX) && cerca(iy, r.y, tolY)) esquina = 'ne';
      else if (cerca(ix, r.x, tolX) && cerca(iy, r.y + r.h, tolY)) esquina = 'so';
      else if (cerca(ix, r.x + r.w, tolX) && cerca(iy, r.y + r.h, tolY)) esquina = 'se';
      arrastre = esquina
        ? { tipo: 'esquina', esquina }
        : { tipo: 'mover', ix, iy, r0: { ...r } };
    }
  });

  lienzo.addEventListener('pointermove', (evp) => {
    if (!arrastre) return;
    evp.preventDefault();
    let [ix, iy] = aImagen(evp);
    ix = Math.max(0, Math.min(1, ix));
    iy = Math.max(0, Math.min(1, iy));

    if (arrastre.tipo === 'forma') {
      arrastre.forma.x2 = ix;
      arrastre.forma.y2 = iy;
    } else if (arrastre.tipo === 'esquina') {
      const r = ed.recorte;
      const x2 = r.x + r.w, y2 = r.y + r.h;
      if (arrastre.esquina === 'no') { r.w = x2 - ix; r.h = y2 - iy; r.x = ix; r.y = iy; }
      if (arrastre.esquina === 'ne') { r.w = ix - r.x; r.h = y2 - iy; r.y = iy; }
      if (arrastre.esquina === 'so') { r.w = x2 - ix; r.x = ix; r.h = iy - r.y; }
      if (arrastre.esquina === 'se') { r.w = ix - r.x; r.h = iy - r.y; }
      r.w = Math.max(0.05, r.w); r.h = Math.max(0.05, r.h);
    } else if (arrastre.tipo === 'mover') {
      const r = ed.recorte, r0 = arrastre.r0;
      r.x = Math.max(0, Math.min(1 - r.w, r0.x + (ix - arrastre.ix)));
      r.y = Math.max(0, Math.min(1 - r.h, r0.y + (iy - arrastre.iy)));
    }
    pintar();
  });

  const soltar = () => {
    if (arrastre && arrastre.tipo === 'forma') {
      const f = arrastre.forma;
      // un toque sin arrastre no deja una forma invisible
      if (Math.abs(f.x2 - f.x1) < 0.01 && Math.abs(f.y2 - f.y1) < 0.01) ed.formas.pop();
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
    barraModos.replaceChildren(
      btn('▭ Formas', modo === 'formas', () => { modo = 'formas'; pintarBarras(); pintar(); }),
      btn('✂ Recortar', modo === 'recortar', () => { modo = 'recortar'; if (!ed.recorte) ed.recorte = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }; pintarBarras(); pintar(); }),
      btn('⟳ Girar', modo === 'girar', () => { modo = 'girar'; pintarBarras(); pintar(); }),
    );

    if (modo === 'formas') {
      barraCtrl.replaceChildren(
        btn('▭', herramienta === 'rect', () => { herramienta = 'rect'; pintarBarras(); }, 'Rectangulo'),
        btn('◯', herramienta === 'circulo', () => { herramienta = 'circulo'; pintarBarras(); }, 'Circulo'),
        btn('↗', herramienta === 'flecha', () => { herramienta = 'flecha'; pintarBarras(); }, 'Flecha'),
        h('span.crece'),
        btn('⌫ Deshacer', false, () => { ed.formas.pop(); pintar(); }, 'Quitar ultima forma'),
      );
    } else if (modo === 'recortar') {
      barraCtrl.replaceChildren(
        h('p.editor__pista', 'Arrastra las esquinas o mueve el recuadro.'),
        h('span.crece'),
        btn('Quitar recorte', false, () => { ed.recorte = null; pintar(); }),
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
      );
    }
  }

  /* ---------- guardar / revertir / cerrar ---------- */

  async function aplicar() {
    const final = renderFinal(bitmap, ed, LADO_MAX);
    const blob = await aBlob(final, 0.85);
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
      h('button.icono-btn.icono-btn--claro', { type: 'button', 'aria-label': 'Cancelar', onclick: () => cerrar() }, '✕'),
      h('span.editor__titulo', 'Editar foto'),
      h('button.enlace.editor__revertir', { type: 'button', onclick: revertir }, 'Revertir'),
      h('button.editor__ok', { type: 'button', 'aria-label': 'Guardar', onclick: aplicar }, '✓')
    ),
    h('div.editor__zona', lienzo),
    barraCtrl,
    barraModos
  );

  async function cerrar() {
    if (resuelto) return;
    resuelto = true;
    bitmap.close && bitmap.close();
    capa.remove();
    document.body.classList.remove('sin-scroll');
    if (porBack) ancla.desdePop();
    else await ancla.liberar();
    if (guardado && alTerminar) alTerminar();
    resolver(guardado);
  }

  document.body.appendChild(capa);
  document.body.classList.add('sin-scroll');
  pintarBarras();
  // Doble pintado: el primero puede correr antes de que el layout de la zona
  // tenga altura real. Y re-pintar al girar el telefono.
  requestAnimationFrame(pintar);
  setTimeout(pintar, 80);
  const alRedimensionar = () => pintar();
  window.addEventListener('resize', alRedimensionar);

  return promesa.finally(() => window.removeEventListener('resize', alRedimensionar));
}
