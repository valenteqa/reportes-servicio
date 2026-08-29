// Renderizado de la linea de tiempo y acciones de captura (foto / nota / tabla).

import * as db from '../db.js';
import * as media from '../media.js';
import { h, hora, fecha, aviso, hoja, confirmar, campo, campoArea, vacio, anclarCapa, bloquearScroll, liberarScroll, icono, orientarLibre, orientarHorizontal, orientarNormal, ocupado, libre } from '../ui.js';
import { editarFoto } from '../editor-foto.js';
import { esNativa, compartirArchivoNativo, guardarEnCarpetaNativa, nombreSeguro } from '../nativo.js';

/* ---------------------------------------------------------------- */
/* Acciones de captura                                               */
/* ---------------------------------------------------------------- */

// En el APK, cada foto que entra se copia tambien a la carpeta de la app:
// Documentos/ReportesServicio/Fotos/<dia cliente>/. En segundo plano, sin
// frenar la captura; si falla solo queda en consola.
function copiaACarpetaNativa(servicioId, ev, blob) {
  if (!esNativa()) return;
  db.servicioLeer(servicioId).then(s => {
    const d = new Date(ev.ts);
    const dia = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    const carpeta = 'Fotos/' + dia + ' ' + nombreSeguro((s && (s.cliente || s.titulo)) || 'trabajo');
    return guardarEnCarpetaNativa(blob, carpeta + '/foto-' + ev.ts + '.jpg');
  }).catch(e => console.warn('No se copio la foto a la carpeta:', e));
}

export async function capturarFoto(servicioId, equipoId, { galeria = false } = {}) {
  // El velo sale desde que REGRESAS de la camara (aunque el archivo aun no
  // llegue): sin el, ese hueco mostraba la linea de tiempo y parecia fallo.
  const archivos = await media.elegirImagenes({
    camara: !galeria,
    multiple: galeria,
    alRegresar: () => ocupado('Procesando la foto...'),
  });
  if (!archivos.length) { libre(); return null; }

  ocupado(archivos.length > 1 ? 'Procesando ' + archivos.length + ' fotos...' : 'Procesando la foto...');

  let ultimo = null;
  let msTotal = 0;
  let ultimoMs = null;
  try {
    for (const archivo of archivos) {
      try {
        const { _ms, ...procesada } = await media.procesarImagen(archivo);
        if (_ms) {
          msTotal += _ms.decodificar + _ms.escalar;
          ultimoMs = _ms;
          console.log('[foto]', _ms.ruta, _ms.decodificar + 'ms decodificar, ' + _ms.escalar + 'ms escalar');
        }
        const fotoId = db.nuevoId();
        await db.fotoGuardar(Object.assign({ id: fotoId }, procesada));
        ultimo = await db.eventoNuevo(servicioId, equipoId, 'foto', { fotoId, pie: '' });
        copiaACarpetaNativa(servicioId, ultimo, procesada.blob);
      } catch (e) {
        aviso('No se pudo procesar una foto: ' + e.message, 'error');
      }
    }
  } finally {
    libre();
  }
  // El desglose de tiempos vive en la consola y en ⚙ → Diagnostico de foto;
  // el aviso queda limpio para el uso diario.
  if (ultimoMs) void msTotal;
  if (ultimo) aviso(archivos.length > 1 ? archivos.length + ' fotos agregadas' : 'Foto agregada', 'ok');

  // Una sola imagen: abrir el editor de inmediato (recortar, girar, señalar).
  // Con varias de la galeria no: se editan una por una al abrirlas.
  if (ultimo && archivos.length === 1) await editarFoto(ultimo);

  return ultimo;
}

/**
 * Menu "+" de una rama: que agregar en esa actividad. Sustituye a la barra
 * inferior — se agrega directo donde tocaste, sin concepto de rama activa.
 */
export async function menuAgregar(servicioId, equipoId, refrescar, nombreRama, opciones, esTexto) {
  const TODAS = [
    ['camara',    '📷  Tomar foto'],
    ['galeria',   '🖼  Foto de la galeria'],
    ['nota',      '📝  Texto'],
    ['tabla',     '▦  Tabla'],
    ['prueba',    '🧪  Prueba'],
    ['pendiente', '⏳  Pendiente'],
  ];
  const lista = opciones ? TODAS.filter(([k]) => opciones.includes(k)) : TODAS;

  const accion = await hoja('＋  ' + (nombreRama || 'Agregar'), (cerrar) => h('div.lista-acciones',
    lista.map(([k, texto]) =>
      h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar(k) }, texto))
  ));
  if (!accion) return;

  // Al re-pintar el arbol, volver a la rama donde se agrego (no hasta arriba).
  sessionStorage.setItem('irARama:' + servicioId, equipoId);

  if (accion === 'camara')    await capturarFoto(servicioId, equipoId);
  if (accion === 'galeria')   await capturarFoto(servicioId, equipoId, { galeria: true });
  if (accion === 'nota')      await agregarNota(servicioId, equipoId, esTexto);
  if (accion === 'tabla')     { await agregarTabla(servicioId, equipoId); return; }  // navega al editor
  if (accion === 'prueba')    await agregarPrueba(servicioId, equipoId);
  if (accion === 'pendiente') await agregarPendiente(servicioId, equipoId);
  refrescar();
}

/**
 * Galeria del trabajo: todas las fotos del arbol en orden cronologico,
 * separadas por dia, cada una con su leyenda (el pie) si la tiene.
 * Tocar una abre el visor (pie editable, eliminar, excluir).
 */
export function galeriaDelTrabajo(servicioId) {
  return hoja('Fotos del trabajo', (cerrar) => {
    const cont = h('div');

    const pintar = async () => {
      // eventosDeServicio ya viene ordenado por hora de captura.
      const fotos = (await db.eventosDeServicio(servicioId)).filter(e => e.tipo === 'foto');
      cont.replaceChildren();

      // Acceso a la papelera de ESTE trabajo, con su conteo.
      const nPapelera = (await db.papeleraFotos(servicioId)).length;
      const btnPapelera = h('button.btn.btn--fantasma.galeria__papelera', {
        type: 'button',
        onclick: async () => { await papeleraDeFotos(servicioId); pintar(); }
      }, '🗑  Papelera de este trabajo (' + nPapelera + ')');

      if (!fotos.length) {
        cont.append(vacio('🖼', 'Sin fotos todavia',
          'Las imagenes que agregues con el boton Imagen apareceran aqui.'), btnPapelera);
        return;
      }

      let diaPrevio = null;
      let rejilla = null;

      for (const ev of fotos) {
        const dia = new Date(ev.ts).toDateString();
        if (dia !== diaPrevio) {
          diaPrevio = dia;
          cont.append(h('h3.galeria__dia', new Date(ev.ts).toLocaleDateString('es-MX', {
            weekday: 'long', day: 'numeric', month: 'long'
          })));
          rejilla = h('div.galeria-rejilla');
          cont.append(rejilla);
        }

        const marco = h('span.galeria-item__marco');
        const item = h('button.galeria-item', {
          type: 'button',
          onclick: () => verFoto(ev, pintar),
        },
          marco,
          ev.datos.pie ? h('span.galeria-item__pie', ev.datos.pie) : null
        );
        if (!ev.incluir) item.classList.add('galeria-item--excluida');
        rejilla.append(item);

        db.fotoLeer(ev.datos.fotoId).then(f => {
          if (!f) { marco.append(h('span.galeria-item__falta', '✕')); return; }
          const img = h('img', { alt: ev.datos.pie || '' });
          marco.append(img);
          img.src = media.urlDe(f.mini || f.blob);
        });
      }

      cont.append(btnPapelera);
    };

    pintar();
    return cont;
  }, { altura: 'alta' });
}

/**
 * Papelera de fotos del trabajo: las eliminadas de ESTE servicio, para
 * restaurarlas a su linea de tiempo o eliminarlas para siempre.
 */
export async function papeleraDeFotos(servicioId) {
  for (;;) {
    const lista = await db.papeleraFotos(servicioId);

    const elegido = await hoja('🗑  Papelera de fotos', (cerrar) => {
      const cont = h('div');
      if (!lista.length) {
        cont.append(h('p.pista', 'Vacia. Las fotos que elimines de este trabajo llegan aqui y se pueden restaurar.'));
        return cont;
      }
      const rejilla = h('div.galeria-rejilla');
      for (const ev of lista) {
        const marco = h('span.galeria-item__marco');
        rejilla.append(h('button.galeria-item', { type: 'button', onclick: () => cerrar(ev) },
          marco,
          h('span.galeria-item__pie', ev.datos.pie || fecha(ev.ts))));
        db.fotoLeer(ev.datos.fotoId).then(f => {
          if (!f) { marco.append(h('span.galeria-item__falta', '✕')); return; }
          const img = h('img', { alt: '' });
          marco.append(img);
          img.src = media.urlDe(f.mini || f.blob);
        });
      }
      cont.append(
        h('p.pista', 'Toca una foto para restaurarla o eliminarla para siempre.'),
        rejilla,
        h('div.hoja__acciones',
          h('button.btn.btn--peligro', { type: 'button', onclick: () => cerrar('vaciar') }, 'Vaciar papelera'))
      );
      return cont;
    }, { altura: 'alta' });

    if (!elegido) return;

    if (elegido === 'vaciar') {
      if (await confirmar('Se eliminan DEFINITIVAMENTE ' + lista.length + ' foto(s). Esto no se puede deshacer.', { textoOk: 'Vaciar' })) {
        for (const ev of lista) await db.eventoBorrar(ev.id);
        aviso('Papelera vaciada', 'ok');
      }
      continue;
    }

    const accion = await hoja(elegido.datos.pie || 'Foto', (cerrar) => h('div',
      h('p.pista', 'Eliminada el ' + fecha(elegido.borrado) + '.'),
      h('div.lista-acciones',
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('restaurar') },
          '↩  Restaurar a su linea de tiempo'),
        h('button.lista-acciones__item.lista-acciones__item--peligro',
          { type: 'button', onclick: () => cerrar('definitivo') }, '🗑  Eliminar definitivamente')
      )
    ));

    if (accion === 'restaurar') {
      await db.eventoRestaurar(elegido.id);
      aviso('Foto restaurada', 'ok');
    } else if (accion === 'definitivo') {
      if (await confirmar('Se elimina la foto para siempre.', { textoOk: 'Eliminar' })) {
        await db.eventoBorrar(elegido.id);
        aviso('Foto eliminada');
      }
    }
  }
}

// El elemento se llama "Texto" en toda la app (en procedimientos es el texto
// de la diapositiva; en servicios, la nota de campo). esTexto solo ajusta la
// pista del placeholder.
export async function agregarNota(servicioId, equipoId, esTexto) {
  const texto = await hoja('Nuevo texto', (cerrar) => {
    const area = campoArea('', {
      placeholder: esTexto
        ? 'El texto de esta diapositiva...\n\nTip: usa el microfono de tu teclado para dictar.'
        : 'Que observaste, que ajustaste, que falto...\n\nTip: usa el microfono de tu teclado para dictar.',
      rows: 7,
    });
    return h('div',
      area,
      h('p.pista', 'Se guarda con la hora actual.'),
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => cerrar(area.entrada.value.trim())
        }, 'Guardar texto')
      )
    );
  });

  if (!texto) return null;
  const ev = await db.eventoNuevo(servicioId, equipoId, 'nota', { texto });
  aviso('Texto guardado', 'ok');
  return ev;
}

export async function editarNota(evento) {
  const texto = await hoja('Editar texto', (cerrar) => {
    const area = campoArea('', { rows: 7, value: evento.datos.texto || '' });
    return h('div',
      area,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button', onclick: () => cerrar(area.entrada.value.trim())
        }, 'Guardar')
      )
    );
  });
  if (texto === null) return false;
  evento.datos.texto = texto;
  await db.eventoGuardar(evento);
  return true;
}

// Plantilla base, siempre disponible (el formato de analisis de tarjetas VT).
// Sus columnas dependen de que bombas tenga la maquina: se preguntan al agregar.
const TABLA_VT = { nombre: 'Analisis de Tarjetas VT de Bombas', esVT: true };

const BOMBAS_VT = [
  ['Sistema 1',  'S1'],
  ['Sistema 2',  'S2'],
  ['Extruder 1', 'E1'],
  ['Extruder 2', 'E2'],
];

function tablaVTDe(abrevs, subtitulo) {
  const columnas = [{ nombre: 'Pin', unidad: '', tipo: 'texto' }];
  const separadores = [];   // columna donde ARRANCA cada bomba: borde grueso
  for (const a of abrevs) {
    separadores.push(columnas.length);
    columnas.push({ nombre: a + ' Off', unidad: '', tipo: 'numero' });
    columnas.push({ nombre: a + ' On',  unidad: '', tipo: 'numero' });
  }
  const filas = ['Pin 1', 'Pin 2', 'Pin 3', 'Pin 4', 'Pin 5', 'Pin 6', 'Presion']
    .map(p => columnas.map((c, i) => (i === 0 ? p : '')));
  return { titulo: TABLA_VT.nombre, subtitulo: subtitulo || '', columnas, filas, separadores };
}

// ¿Que tabla es? La leyenda va debajo del titulo en la tabla y el reporte.
function elegirLeyendaVT() {
  return hoja('¿Que tabla es?', (cerrar) => h('div',
    h('div.lista-acciones',
      ['VALORES INICIALES', 'ANTES DE AJUSTE', 'DESPUES DE AJUSTE'].map(t =>
        h('button.lista-acciones__item.opcion-fuerte', { type: 'button', onclick: () => cerrar(t) }, t)),
      h('button.lista-acciones__item.opcion-fuerte', { type: 'button', onclick: () => cerrar('__otro__') },
        '✎  OTRO (LEYENDA PROPIA)')
    )
  )).then(async (op) => {
    if (!op) return null;
    if (op !== '__otro__') return op;
    let texto = null;
    await hoja('Leyenda de la tabla', (cerrar) => {
      const cLeyenda = campo('Leyenda', { value: '' });
      return h('div',
        cLeyenda,
        h('div.hoja__acciones',
          h('button.btn.btn--primario', {
            type: 'button',
            onclick: () => {
              const v = cLeyenda.querySelector('input').value.trim();
              if (!v) { aviso('Escribe la leyenda', 'error'); return; }
              texto = v.toUpperCase();
              cerrar(true);
            }
          }, 'Continuar'))
      );
    });
    return texto;
  });
}

// Seleccion multiple: cuales bombas tiene la maquina (todas marcadas de inicio).
function elegirBombasVT() {
  return hoja('¿Que bombas tiene la maquina?', (cerrar) => {
    const sel = new Set(BOMBAS_VT.map(([, a]) => a));
    const botones = BOMBAS_VT.map(([nombre, ab]) => {
      const b = h('button.lista-acciones__item.fila-bomba', { type: 'button' });
      const pintar = () => {
        const si = sel.has(ab);
        b.replaceChildren(
          h('span.check-vt' + (si ? '.check-vt--si' : '.check-vt--no'), si ? '✓' : '✕'),
          nombre + ' (' + ab + ')'
        );
      };
      b.onclick = () => { if (sel.has(ab)) sel.delete(ab); else sel.add(ab); pintar(); };
      pintar();
      return b;
    });
    return h('div',
      h('div.lista-acciones', botones),
      h('p.pista', 'Desmarca las que no tenga: solo las marcadas entran como columnas Off/On.'),
      h('div.hoja__acciones',
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => {
            if (!sel.size) { aviso('Marca al menos una bomba', 'error'); return; }
            cerrar(BOMBAS_VT.filter(([, a]) => sel.has(a)).map(([, a]) => a));
          }
        }, 'Agregar tabla'))
    );
  });
}

export async function agregarTabla(servicioId, equipoId) {
  // Primero elegir: tabla nueva o una predeterminada (la base + las guardadas).
  const guardadas = await db.tablasPredeterminadas().catch(() => []);
  const eleccion = await hoja('▦  ¿Que tabla agregamos?', (cerrar) => h('div',
    h('div.lista-acciones',
      h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar({ nueva: true }) },
        '➕  Tabla nueva'),
      h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar(TABLA_VT) },
        '▦  ' + TABLA_VT.nombre),
      guardadas.filter(g => g.clave !== 'tabla:' + TABLA_VT.nombre.toLowerCase()).map(g =>
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar(g) },
          '▦  ' + g.nombre))
    ),
    h('p.pista', 'Al terminar una tabla nueva podras guardarla como predeterminada para reutilizarla.')
  ));
  if (!eleccion) return null;

  let datos;
  if (eleccion.nueva) {
    datos = {
      titulo: '',
      columnas: [
        { nombre: 'Punto', unidad: '', tipo: 'texto' },
        { nombre: 'Valor', unidad: '', tipo: 'numero' },
      ],
      filas: [['', ''], ['', '']],
    };
  } else if (eleccion.esVT) {
    const abrevs = await elegirBombasVT();
    if (!abrevs) return null;
    const leyenda = await elegirLeyendaVT();
    if (!leyenda) return null;
    datos = tablaVTDe(abrevs, leyenda);
  } else {
    datos = JSON.parse(JSON.stringify(eleccion.tabla));
  }

  const ev = await db.eventoNuevo(servicioId, equipoId, 'tabla', datos);
  // Marcas en la RAIZ del evento (el editor solo toca datos):
  // - enEdicion: la tabla se esta CAPTURANDO; el boton "Agregar tabla" la
  //   cierra y de ahi en adelante abrirla es solo-ver.
  // - preguntarPlantilla: al volver al arbol se ofrece guardarla como
  //   predeterminada, una sola vez (solo tablas nuevas).
  ev.enEdicion = true;
  if (eleccion.nueva) ev.preguntarPlantilla = true;
  await db.eventoGuardar(ev);
  location.hash = '#/s/' + servicioId + '/t/' + ev.id;
  return ev;
}

/* ---------------------------------------------------------------- */
/* Visor de foto a pantalla completa                                 */
/* ---------------------------------------------------------------- */

export async function verFoto(eventoInicial, alCambiar) {
  let evento = eventoInicial;
  let foto = await db.fotoLeer(evento.datos.fotoId);
  if (!foto) { aviso('La imagen no se encontro', 'error'); return; }

  let url = media.urlDe(foto.blob);

  // Deslizar a los lados pasa a la foto anterior/siguiente del trabajo
  // (orden cronologico, el mismo de la galeria). El cambio es EN el mismo
  // visor — nada se cierra ni se vuelve a abrir, asi no hay destello.
  const fotosLista = (await db.eventosDeServicio(evento.servicioId)).filter(e => e.tipo === 'foto');
  let idxFoto = fotosLista.findIndex(e => e.id === evento.id);

  const pintarContador = () => {
    horaEl.textContent = hora(evento.ts) +
      (fotosLista.length > 1 ? '  ·  ' + (idxFoto + 1) + '/' + fotosLista.length : '');
  };

  let cambiando = false;
  const irOtra = async (delta) => {
    const destino = fotosLista[idxFoto + delta];
    if (!destino || cambiando) return;   // primera/ultima: no hay a donde ir
    cambiando = true;
    try {
      const fotoNueva = await db.fotoLeer(destino.datos.fotoId);
      if (!fotoNueva) { aviso('La imagen no se encontro', 'error'); return; }
      // guarda la leyenda de la foto actual antes de soltar su evento
      const pieNuevo = pie.value.trim();
      if (pieNuevo !== (evento.datos.pie || '')) {
        evento.datos.pie = pieNuevo;
        await db.eventoGuardar(evento);
        if (alCambiar) alCambiar();
      }
      const urlNueva = media.urlDe(fotoNueva.blob);
      // decodifica ANTES de intercambiar para que el cambio sea instantaneo;
      // con tope: en pantallas suspendidas decode() puede no resolver nunca.
      const pre = new Image();
      pre.src = urlNueva;
      await Promise.race([
        pre.decode().catch(() => {}),
        new Promise(res => setTimeout(res, 400)),
      ]);
      evento = destino;
      foto = fotoNueva;
      idxFoto += delta;
      url = urlNueva;
      imgEl.src = urlNueva;
      zv.s = 1; zv.tx = 0; zv.ty = 0;
      aplicarZoomV();
      pie.value = evento.datos.pie || '';
      pintarLeyenda();
      pintarContador();
      metaEl.textContent = foto.ancho + '×' + foto.alto + ' · ' + media.formatoBytes(foto.bytes);
    } finally {
      cambiando = false;
    }
  };

  // La leyenda se MUESTRA compacta (texto blanco bajo la foto, con ✎);
  // tocarla abre el renglon de edicion, que se oculta al guardar.
  const guardarPie = async () => {
    evento.datos.pie = pie.value.trim();
    await db.eventoGuardar(evento);
    pie.blur();                    // baja el teclado
    pintarLeyenda();
    aviso('Leyenda guardada', 'ok');
  };

  const pie = h('input.visor__pie', {
    type: 'text',
    placeholder: 'Leyenda de la foto (aparece en el reporte)',
    value: evento.datos.pie || '',
    enterkeyhint: 'done',
    onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); guardarPie(); } },
  });

  const botonOk = h('button.visor__ok', {
    type: 'button', 'aria-label': 'Guardar leyenda',
    onclick: guardarPie,
  }, '✓');

  const filaEdicion = h('div.visor__pieFila', { style: { display: 'none' } }, pie, botonOk);

  const horaEl = h('span.visor__hora');
  const metaEl = h('span.visor__meta', foto.ancho + '×' + foto.alto + ' · ' + media.formatoBytes(foto.bytes));

  const textoLeyenda = h('span.visor__leyendaTexto');
  const filaLeyenda = h('button.visor__leyenda', {
    type: 'button', 'aria-label': 'Editar leyenda',
    onclick: () => {
      filaLeyenda.style.display = 'none';
      filaEdicion.style.display = '';
      pie.focus();
    }
  }, textoLeyenda, h('span.visor__leyendaEditar', '✎'));

  function pintarLeyenda() {
    const hay = !!(evento.datos.pie || '').trim();
    textoLeyenda.textContent = hay ? evento.datos.pie : 'Toca para agregar leyenda';
    textoLeyenda.classList.toggle('visor__leyendaTexto--vacia', !hay);
    filaLeyenda.style.display = '';
    filaEdicion.style.display = 'none';
  }

  // El atras del telefono cierra el visor (guardando el pie), no navega.
  let resuelto = false;
  let porBack = false;
  const ancla = anclarCapa(() => { porBack = true; cerrar(true); });

  const cerrar = async (guardar) => {
    if (resuelto) return;
    resuelto = true;
    orientarNormal();   // de vuelta a vertical al salir del visor
    try {
      if (guardar) {
        evento.datos.pie = pie.value.trim();
        await db.eventoGuardar(evento);
      }
    } catch (e) {
      // Almacenamiento lleno o base colgada: avisar, pero JAMAS dejar el
      // visor pegado en pantalla — el desmontaje va en finally.
      console.error(e);
      aviso('No se pudo guardar la leyenda', 'error');
    } finally {
      URL.revokeObjectURL(url);
      capa.remove();
      liberarScroll();
      if (porBack) ancla.desdePop();
      else await ancla.liberar();
      if (alCambiar) alCambiar();
    }
  };

  /* ---- zoom del visor: pellizco, paneo y doble toque ---- */
  const zv = { s: 1, tx: 0, ty: 0 };
  const imgEl = h('img.visor__img', { src: url, alt: '' });
  const btnZoomV = h('button.editor__zoomreset', {
    type: 'button', style: { display: 'none' },
    onclick: () => { zv.s = 1; zv.tx = 0; zv.ty = 0; aplicarZoomV(); },
  }, 'RESET ZOOM');
  const lienzoV = h('div.visor__lienzo', imgEl, btnZoomV);

  function acotarPan() {
    const r = lienzoV.getBoundingClientRect();
    const mx = (zv.s - 1) * r.width / 2, my = (zv.s - 1) * r.height / 2;
    zv.tx = Math.max(-mx, Math.min(mx, zv.tx));
    zv.ty = Math.max(-my, Math.min(my, zv.ty));
  }
  function aplicarZoomV() {
    acotarPan();
    imgEl.style.transform = 'translate(' + zv.tx + 'px,' + zv.ty + 'px) scale(' + zv.s + ')';
    btnZoomV.style.display = zv.s > 1 ? '' : 'none';
  }

  const punterosV = new Map();
  let pinchV = null, panV = null, swipeV = null, ultimoTap = 0;

  lienzoV.addEventListener('pointerdown', (evp) => {
    evp.preventDefault();
    try { lienzoV.setPointerCapture(evp.pointerId); } catch (e) {}
    punterosV.set(evp.pointerId, { x: evp.clientX, y: evp.clientY });
    if (punterosV.size === 2) {
      const [a, b] = Array.from(punterosV.values());
      pinchV = { d0: Math.hypot(a.x - b.x, a.y - b.y), s0: zv.s };
      panV = null;
      swipeV = null;
      aplicarZoomV();
    } else if (zv.s > 1) {
      panV = { x0: evp.clientX, y0: evp.clientY, tx0: zv.tx, ty0: zv.ty };
    } else {
      // sin zoom: el arrastre horizontal pasa de foto
      swipeV = { x0: evp.clientX, y0: evp.clientY, dx: 0 };
    }
  });
  lienzoV.addEventListener('pointermove', (evp) => {
    if (punterosV.has(evp.pointerId)) punterosV.set(evp.pointerId, { x: evp.clientX, y: evp.clientY });
    if (pinchV && punterosV.size === 2) {
      evp.preventDefault();
      const [a, b] = Array.from(punterosV.values());
      zv.s = Math.max(1, Math.min(6, pinchV.s0 * Math.hypot(a.x - b.x, a.y - b.y) / pinchV.d0));
      aplicarZoomV();
    } else if (panV) {
      evp.preventDefault();
      zv.tx = panV.tx0 + (evp.clientX - panV.x0);
      zv.ty = panV.ty0 + (evp.clientY - panV.y0);
      aplicarZoomV();
    } else if (swipeV && punterosV.size === 1) {
      swipeV.dx = evp.clientX - swipeV.x0;
      if (Math.abs(swipeV.dx) > Math.abs(evp.clientY - swipeV.y0)) {
        evp.preventDefault();
        // la foto sigue al dedo, de retroalimentacion
        imgEl.style.transform = 'translateX(' + swipeV.dx + 'px)';
      }
    }
  });
  const soltarV = (evp) => {
    const sw = swipeV;
    swipeV = null;
    if (sw) {
      aplicarZoomV();   // regresa la foto a su lugar
      const dy = Math.abs(evp.clientY - sw.y0);
      if (Math.abs(sw.dx) > 60 && Math.abs(sw.dx) > dy) {
        punterosV.delete(evp.pointerId);
        ultimoTap = 0;
        irOtra(sw.dx < 0 ? 1 : -1);   // izquierda = siguiente
        return;
      }
    }
    const fueArrastre = sw && (Math.abs(sw.dx) > 10 || Math.abs(evp.clientY - sw.y0) > 10);
    // doble toque: acercar al doble / regresar
    if (punterosV.size === 1 && !panV && !pinchV && !fueArrastre) {
      const ahora = Date.now();
      if (ahora - ultimoTap < 320) {
        if (zv.s > 1) { zv.s = 1; zv.tx = 0; zv.ty = 0; }
        else { zv.s = 2.5; }
        aplicarZoomV();
        ultimoTap = 0;
      } else {
        ultimoTap = ahora;
      }
    }
    if (fueArrastre) ultimoTap = 0;
    punterosV.delete(evp.pointerId);
    if (punterosV.size < 2) pinchV = null;
    if (!punterosV.size) panV = null;
  };
  lienzoV.addEventListener('pointerup', soltarV);
  lienzoV.addEventListener('pointercancel', soltarV);

  // En el visor el giro queda libre (el resto de la app va anclada a
  // vertical); el boton 🔁 fuerza horizontal y vuelve a dejarlo libre.
  let horizontal = false;
  orientarLibre();

  const capa = h('div.visor',
    h('div.visor__barra',
      h('button.icono-btn.icono-btn--claro', { type: 'button', onclick: () => cerrar(true) }, '✕'),
      horaEl,
      h('button.icono-btn.icono-btn--claro', {
        type: 'button', 'aria-label': 'Girar pantalla',
        onclick: async () => {
          const ok = horizontal ? await orientarLibre() : await orientarHorizontal();
          if (!ok) { aviso('Este dispositivo no deja girar la pantalla desde la app', 'error'); return; }
          horizontal = !horizontal;
        }
      }, '🔁'),
      h('button.icono-btn.icono-btn--claro', {
        type: 'button', 'aria-label': 'Compartir foto',
        // Las fotos JPEG SI pasan por el menu de Android (Word no).
        // Sin esperas antes del share: debe pedirse en el toque mismo.
        onclick: () => {
          const nombre = 'foto-' + hora(evento.ts).replace(/[^0-9]/g, '') + '.jpg';
          if (esNativa()) {
            compartirArchivoNativo(foto.blob, nombre, evento.datos.pie || nombre)
              .catch((e) => {
                if (e && /cancel/i.test((e.message || '') + e)) return;
                console.error(e);
                aviso('No se pudo compartir la foto', 'error');
              });
            return;
          }
          if (!navigator.share) { aviso('Este navegador no comparte archivos', 'error'); return; }
          const archivo = new File([foto.blob], nombre, { type: 'image/jpeg' });
          navigator.share({ files: [archivo], title: evento.datos.pie || nombre })
            .catch((e) => {
              if (e && e.name === 'AbortError') return;
              console.error(e);
              aviso('Android nego compartir la foto (' + (e && e.name ? e.name : e) + ')', 'error');
            });
        }
      }, icono('compartir')),
      h('button.icono-btn.icono-btn--claro', {
        type: 'button', 'aria-label': 'Editar foto',
        onclick: async () => {
          await cerrar(true);                 // guarda la leyenda y cierra el visor
          await editarFoto(evento);           // abre el editor
          if (alCambiar) alCambiar();         // refresca miniaturas al volver
        }
      }, '✎'),
      h('button.icono-btn.icono-btn--claro', {
        type: 'button',
        onclick: async () => {
          if (await confirmar('La foto se manda a la papelera. Puedes restaurarla desde ⚙ Configuracion.', { textoOk: 'Eliminar' })) {
            await db.eventoAPapelera(evento.id);
            aviso('Foto enviada a la papelera');
            cerrar(false);
          }
        }
      }, '🗑')
    ),
    lienzoV,
    h('div.visor__pieCont',
      filaLeyenda,
      filaEdicion,
      metaEl)
  );
  pintarLeyenda();
  pintarContador();

  document.body.appendChild(capa);
  bloquearScroll();
}

/* ---------------------------------------------------------------- */
/* Tarjetas de la linea de tiempo                                    */
/* ---------------------------------------------------------------- */

const ICONO = { nota: '📝', tabla: '▦', foto: '📷', prueba: '🧪', pendiente: '⏳' };

/* ---------------------------------------------------------------- */
/* Pendientes: lo que queda por hacer despues del servicio.          */
/* En el reporte alimentan su propia seccion.                        */
/* ---------------------------------------------------------------- */

export async function agregarPendiente(servicioId, equipoId) {
  const texto = await hoja('Nuevo pendiente', (cerrar) => {
    const area = campoArea('', {
      placeholder: 'Que queda pendiente...\n\nEj: Instalar contactor K905 de mas de 125 A cuando llegue la refaccion.',
      rows: 5,
    });
    return h('div',
      area,
      h('p.pista', 'Los pendientes llevan su propia seccion en el reporte.'),
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button', onclick: () => cerrar(area.entrada.value.trim())
        }, 'Guardar pendiente')
      )
    );
  });

  if (!texto) return null;
  const ev = await db.eventoNuevo(servicioId, equipoId, 'pendiente', { texto });
  aviso('Pendiente guardado', 'ok');
  return ev;
}

async function editarPendiente(evento) {
  const texto = await hoja('Editar pendiente', (cerrar) => {
    const area = campoArea('', { rows: 5, value: evento.datos.texto || '' });
    return h('div',
      area,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button', onclick: () => cerrar(area.entrada.value.trim())
        }, 'Guardar')
      )
    );
  });
  if (texto === null) return false;
  evento.datos.texto = texto;
  await db.eventoGuardar(evento);
  return true;
}

/* ---------------------------------------------------------------- */
/* Pruebas: se describe la prueba a realizar y queda colgando una    */
/* rama "Resultado" pendiente hasta que se registra que paso.        */
/* ---------------------------------------------------------------- */

export async function agregarPrueba(servicioId, equipoId) {
  const texto = await hoja('Nueva prueba', (cerrar) => {
    const area = campoArea('', {
      placeholder: 'Que prueba vas a realizar...\n\nEj: Cambiar BREAKER Q905 de 90 A por uno de 125 A y arrancar en ciclo de inyeccion.',
      rows: 5,
    });
    return h('div',
      area,
      h('p.pista', 'Al guardarla queda pendiente su resultado: registralo cuando termines la prueba.'),
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button', onclick: () => cerrar(area.entrada.value.trim())
        }, 'Guardar prueba')
      )
    );
  });

  if (!texto) return null;
  const ev = await db.eventoNuevo(servicioId, equipoId, 'prueba', {
    descripcion: texto,
    resultado: '',
    resultadoTs: null,
  });
  aviso('Prueba guardada — queda pendiente el resultado', 'ok');
  return ev;
}

async function registrarResultado(evento) {
  const texto = await hoja(evento.datos.resultado ? 'Editar resultado' : 'Resultado de la prueba', (cerrar) => {
    const area = campoArea('', {
      rows: 6,
      value: evento.datos.resultado || '',
      placeholder: 'Que paso al realizar la prueba...\n\nEj: Se arranca maquina en ciclo de inyeccion sin alarmas de SERVODRIVE.',
    });
    return h('div',
      h('p.parrafo.prueba__cita', '🧪 ' + evento.datos.descripcion),
      area,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button', onclick: () => cerrar(area.entrada.value.trim())
        }, 'Guardar resultado')
      )
    );
  });

  if (texto === null) return false;
  const esNuevoResultado = !evento.datos.resultado && !!texto;
  evento.datos.resultado = texto;
  if (texto && !evento.datos.resultadoTs) evento.datos.resultadoTs = Date.now();
  if (!texto) evento.datos.resultadoTs = null;
  await db.eventoGuardar(evento);

  // Al cerrar una prueba, ofrecer encadenar la siguiente: asi las pruebas
  // de una actividad quedan en secuencia sin volver a buscar el menu.
  if (esNuevoResultado) {
    const siguiente = await hoja('Resultado guardado', (cerrar) => h('div',
      h('p.parrafo', '¿Agregar la siguiente prueba de esta actividad?'),
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Ahora no'),
        h('button.btn.btn--primario', { type: 'button', onclick: () => cerrar('si') }, '＋ Siguiente prueba')
      )
    ));
    if (siguiente === 'si') await agregarPrueba(evento.servicioId, evento.equipoId);
  }
  return true;
}

async function editarPrueba(evento) {
  const texto = await hoja('Editar prueba', (cerrar) => {
    const area = campoArea('', { rows: 5, value: evento.datos.descripcion || '' });
    return h('div',
      area,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button', onclick: () => cerrar(area.entrada.value.trim())
        }, 'Guardar')
      )
    );
  });
  if (texto === null) return false;
  evento.datos.descripcion = texto;
  await db.eventoGuardar(evento);
  return true;
}

function menuEvento(evento, refrescar) {
  return h('button.icono-btn.tarjeta__menu', {
    type: 'button',
    'aria-label': 'Opciones',
    onclick: async (ev) => {
      ev.stopPropagation();
      const accion = await hoja('Opciones', (cerrar) => h('div.lista-acciones',
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('excluir') },
          evento.incluir ? '🚫  Excluir del reporte' : '✓  Incluir en el reporte'),
        h('button.lista-acciones__item.lista-acciones__item--peligro',
          { type: 'button', onclick: () => cerrar('borrar') }, '🗑  Eliminar')
      ));

      if (accion === 'excluir') {
        evento.incluir = !evento.incluir;
        await db.eventoGuardar(evento);
        aviso(evento.incluir ? 'Se incluira en el reporte' : 'Excluido del reporte');
        refrescar();
      } else if (accion === 'borrar') {
        if (evento.tipo === 'foto') {
          // Las fotos van a la papelera; lo demas se elimina de una vez.
          if (await confirmar('La foto se manda a la papelera. Puedes restaurarla desde ⚙ Configuracion.', { textoOk: 'Eliminar' })) {
            await db.eventoAPapelera(evento.id);
            aviso('Foto enviada a la papelera');
            refrescar();
          }
        } else if (await confirmar('Se elimina este registro de forma permanente.')) {
          await db.eventoBorrar(evento.id);
          aviso('Eliminado');
          refrescar();
        }
      }
    }
  }, '⋯');
}

function tarjetaNota(evento, refrescar) {
  return h('div.tarjeta.tarjeta--nota', {
    onclick: async () => { if (await editarNota(evento)) refrescar(); }
  },
    h('div.tarjeta__cabeza',
      h('span.tarjeta__icono', ICONO.nota),
      h('span.tarjeta__hora', hora(evento.ts)),
      menuEvento(evento, refrescar)
    ),
    h('p.tarjeta__texto', evento.datos.texto || '(nota vacia)')
  );
}

function tarjetaTabla(evento, refrescar) {
  const cols = evento.datos.columnas || [];
  const filas = evento.datos.filas || [];
  const conDatos = filas.filter(f => f.some(c => String(c).trim() !== ''));

  const previa = h('div.tabla-previa');
  const tabla = h('table.tabla-mini');
  const sep = (i) => (evento.datos.separadores || []).includes(i) ? 'sep-grupo' : '';
  tabla.append(h('thead', h('tr', cols.map((c, i) =>
    h('th', { class: sep(i) }, c.nombre + (c.unidad ? ' (' + c.unidad + ')' : ''))))));
  const cuerpo = h('tbody');
  conDatos.slice(0, 3).forEach(f => cuerpo.append(h('tr', f.map((v, i) => h('td', { class: sep(i) }, v || '—')))));
  tabla.append(cuerpo);
  previa.append(tabla);

  return h('div.tarjeta.tarjeta--tabla', {
    onclick: () => { location.hash = '#/s/' + evento.servicioId + '/t/' + evento.id; }
  },
    h('div.tarjeta__cabeza',
      h('span.tarjeta__icono', ICONO.tabla),
      h('span.tarjeta__hora', hora(evento.ts)),
      menuEvento(evento, refrescar)
    ),
    h('h4.tarjeta__titulo', evento.datos.titulo || 'Tabla sin titulo'),
    evento.datos.subtitulo ? h('p.tarjeta__subtitulo', evento.datos.subtitulo) : null,
    conDatos.length ? previa : h('p.pista', 'Tabla vacia — toca para llenarla'),
    conDatos.length > 3 ? h('p.pista', '+ ' + (conDatos.length - 3) + ' filas mas') : null
  );
}

function tarjetaFoto(evento, refrescar) {
  const cont = h('div.tarjeta.tarjeta--foto', {
    onclick: () => verFoto(evento, refrescar)
  },
    h('div.tarjeta__cabeza',
      h('span.tarjeta__icono', ICONO.foto),
      h('span.tarjeta__hora', hora(evento.ts)),
      menuEvento(evento, refrescar)
    )
  );

  const marco = h('div.tarjeta__foto');
  cont.append(marco);
  if (evento.datos.pie) cont.append(h('p.tarjeta__pie', evento.datos.pie));

  db.fotoLeer(evento.datos.fotoId).then(foto => {
    if (!foto) { marco.append(h('div.tarjeta__fotoFalta', 'Imagen no disponible')); return; }

    // Sin loading="lazy" a proposito: las miniaturas pesan ~2 KB y salen de
    // IndexedDB, no de la red. Diferirlas no ahorra nada y agrega un modo de falla.
    //
    // El src se asigna DESPUES de insertar el elemento: al asignarlo estando
    // aun desprendido del documento, la carga puede quedarse colgada.
    const img = h('img', { alt: '' });
    marco.append(img);
    // La tarjeta es casi de pantalla completa: va la foto REAL (1600px).
    // La miniatura de 320px es para las rejillas chicas (galeria/papelera);
    // aqui estirada se veia pixeleada.
    img.src = media.urlDe(foto.blob || foto.mini);
  });

  return cont;
}

function tarjetaPrueba(evento, refrescar) {
  const d = evento.datos;
  const pendiente = !d.resultado;

  const nodoResultado = pendiente
    ? h('button.prueba__resultado.prueba__resultado--pendiente', {
        type: 'button',
        onclick: async (ev) => { ev.stopPropagation(); if (await registrarResultado(evento)) refrescar(); }
      }, '⚡ Registrar resultado de la prueba…')
    : h('div.prueba__resultado', {
        onclick: async (ev) => { ev.stopPropagation(); if (await registrarResultado(evento)) refrescar(); }
      },
        h('div.prueba__resultadoCabeza',
          h('span.prueba__etiqueta', 'Resultado'),
          d.resultadoTs ? h('span.tarjeta__hora', hora(d.resultadoTs)) : null
        ),
        h('p.tarjeta__texto', d.resultado)
      );

  return h('div.tarjeta.tarjeta--prueba', {
    onclick: async () => { if (await editarPrueba(evento)) refrescar(); }
  },
    h('div.tarjeta__cabeza',
      h('span.tarjeta__icono', ICONO.prueba),
      h('span.prueba__etiqueta', 'Prueba'),
      h('span.tarjeta__hora', hora(evento.ts)),
      menuEvento(evento, refrescar)
    ),
    h('p.tarjeta__texto', d.descripcion || '(sin descripcion)'),
    h('div.prueba__rama', nodoResultado)
  );
}

function tarjetaPendiente(evento, refrescar) {
  return h('div.tarjeta.tarjeta--pendiente', {
    onclick: async () => { if (await editarPendiente(evento)) refrescar(); }
  },
    h('div.tarjeta__cabeza',
      h('span.tarjeta__icono', ICONO.pendiente),
      h('span.pendiente__etiqueta', 'Pendiente'),
      h('span.tarjeta__hora', hora(evento.ts)),
      menuEvento(evento, refrescar)
    ),
    h('p.tarjeta__texto', evento.datos.texto || '(sin texto)')
  );
}

export function tarjetaEvento(evento, refrescar) {
  let el;
  if (evento.tipo === 'nota')  el = tarjetaNota(evento, refrescar);
  else if (evento.tipo === 'tabla')  el = tarjetaTabla(evento, refrescar);
  else if (evento.tipo === 'foto')   el = tarjetaFoto(evento, refrescar);
  else if (evento.tipo === 'prueba') el = tarjetaPrueba(evento, refrescar);
  else if (evento.tipo === 'pendiente') el = tarjetaPendiente(evento, refrescar);
  else el = h('div.tarjeta', 'Tipo desconocido: ' + evento.tipo);

  if (!evento.incluir) el.classList.add('tarjeta--excluida');
  return el;
}

/**
 * Linea de tiempo agrupada por dia. `eventos` debe venir ordenado por ts.
 */
export function lineaDeTiempo(eventos, refrescar, { mostrarEquipo = null } = {}) {
  if (!eventos.length) {
    return vacio('🕐', 'Sin registros todavia',
      'Usa los botones de abajo para agregar una foto, una nota o una tabla.');
  }

  const cont = h('div.linea');
  let diaPrevio = null;

  for (const ev of eventos) {
    const dia = new Date(ev.ts).toDateString();
    if (dia !== diaPrevio) {
      diaPrevio = dia;
      cont.append(h('div.linea__dia', new Date(ev.ts).toLocaleDateString('es-MX', {
        weekday: 'long', day: 'numeric', month: 'long'
      })));
    }
    const fila = h('div.linea__fila', h('div.linea__punto'), tarjetaEvento(ev, refrescar));
    if (mostrarEquipo) {
      const nombre = mostrarEquipo(ev.equipoId);
      if (nombre) fila.querySelector('.tarjeta__cabeza')
        .insertBefore(h('span.chip-equipo', nombre), fila.querySelector('.tarjeta__menu'));
    }
    cont.append(fila);
  }
  return cont;
}

/* ---------------------------------------------------------------- */
/* Barra inferior de captura                                         */
/* ---------------------------------------------------------------- */

