// Renderizado de la linea de tiempo y acciones de captura (foto / nota / tabla).

import * as db from '../db.js';
import * as media from '../media.js';
import { h, hora, aviso, hoja, confirmar, campoArea, vacio, anclarCapa, bloquearScroll, liberarScroll } from '../ui.js';
import { editarFoto } from '../editor-foto.js';

/* ---------------------------------------------------------------- */
/* Acciones de captura                                               */
/* ---------------------------------------------------------------- */

export async function capturarFoto(servicioId, equipoId, { galeria = false } = {}) {
  const archivos = await media.elegirImagenes({ camara: !galeria, multiple: galeria });
  if (!archivos.length) return null;

  let ultimo = null;
  for (const archivo of archivos) {
    try {
      const procesada = await media.procesarImagen(archivo);
      const fotoId = db.nuevoId();
      await db.fotoGuardar(Object.assign({ id: fotoId }, procesada));
      ultimo = await db.eventoNuevo(servicioId, equipoId, 'foto', { fotoId, pie: '' });
    } catch (e) {
      aviso('No se pudo procesar una foto: ' + e.message, 'error');
    }
  }
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

      if (!fotos.length) {
        cont.append(vacio('🖼', 'Sin fotos todavia',
          'Las imagenes que agregues con el boton Imagen apareceran aqui.'));
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
    };

    pintar();
    return cont;
  }, { altura: 'alta' });
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

export async function agregarTabla(servicioId, equipoId) {
  const ev = await db.eventoNuevo(servicioId, equipoId, 'tabla', {
    titulo: '',
    columnas: [
      { nombre: 'Punto',  unidad: '', tipo: 'texto'  },
      { nombre: 'Valor',  unidad: '', tipo: 'numero' },
    ],
    filas: [['', ''], ['', '']],
  });
  location.hash = '#/s/' + servicioId + '/t/' + ev.id;
  return ev;
}

/* ---------------------------------------------------------------- */
/* Visor de foto a pantalla completa                                 */
/* ---------------------------------------------------------------- */

export async function verFoto(evento, alCambiar) {
  const foto = await db.fotoLeer(evento.datos.fotoId);
  if (!foto) { aviso('La imagen no se encontro', 'error'); return; }

  const url = media.urlDe(foto.blob);

  const guardarPie = async () => {
    evento.datos.pie = pie.value.trim();
    await db.eventoGuardar(evento);
    pie.blur();                    // baja el teclado
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

  // El atras del telefono cierra el visor (guardando el pie), no navega.
  let resuelto = false;
  let porBack = false;
  const ancla = anclarCapa(() => { porBack = true; cerrar(true); });

  const cerrar = async (guardar) => {
    if (resuelto) return;
    resuelto = true;
    if (guardar) {
      evento.datos.pie = pie.value.trim();
      await db.eventoGuardar(evento);
    }
    URL.revokeObjectURL(url);
    capa.remove();
    liberarScroll();
    if (porBack) ancla.desdePop();
    else await ancla.liberar();
    if (alCambiar) alCambiar();
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
  let pinchV = null, panV = null, ultimoTap = 0;

  lienzoV.addEventListener('pointerdown', (evp) => {
    evp.preventDefault();
    try { lienzoV.setPointerCapture(evp.pointerId); } catch (e) {}
    punterosV.set(evp.pointerId, { x: evp.clientX, y: evp.clientY });
    if (punterosV.size === 2) {
      const [a, b] = Array.from(punterosV.values());
      pinchV = { d0: Math.hypot(a.x - b.x, a.y - b.y), s0: zv.s };
      panV = null;
    } else if (zv.s > 1) {
      panV = { x0: evp.clientX, y0: evp.clientY, tx0: zv.tx, ty0: zv.ty };
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
    }
  });
  const soltarV = (evp) => {
    // doble toque: acercar al doble / regresar
    if (punterosV.size === 1 && !panV && !pinchV) {
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
    punterosV.delete(evp.pointerId);
    if (punterosV.size < 2) pinchV = null;
    if (!punterosV.size) panV = null;
  };
  lienzoV.addEventListener('pointerup', soltarV);
  lienzoV.addEventListener('pointercancel', soltarV);

  const capa = h('div.visor',
    h('div.visor__barra',
      h('button.icono-btn.icono-btn--claro', { type: 'button', onclick: () => cerrar(true) }, '✕'),
      h('span.visor__hora', hora(evento.ts)),
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
          if (await confirmar('Se elimina la foto de forma permanente.')) {
            await db.eventoBorrar(evento.id);
            aviso('Foto eliminada');
            cerrar(false);
          }
        }
      }, '🗑')
    ),
    lienzoV,
    h('div.visor__pieCont',
      h('div.visor__pieFila', pie, botonOk),
      h('span.visor__meta', foto.ancho + '×' + foto.alto + ' · ' + media.formatoBytes(foto.bytes)))
  );

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
        if (await confirmar('Se elimina este registro de forma permanente.')) {
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
  tabla.append(h('thead', h('tr', cols.map(c =>
    h('th', c.nombre + (c.unidad ? ' (' + c.unidad + ')' : ''))))));
  const cuerpo = h('tbody');
  conDatos.slice(0, 3).forEach(f => cuerpo.append(h('tr', f.map(v => h('td', v || '—')))));
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
    img.src = media.urlDe(foto.mini || foto.blob);
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

