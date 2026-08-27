// Renderizado de la linea de tiempo y acciones de captura (foto / nota / tabla).

import * as db from '../db.js';
import * as media from '../media.js';
import { h, hora, aviso, hoja, confirmar, campoArea, vacio, anclarCapa } from '../ui.js';

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
  return ultimo;
}

/** Boton Imagen: deja elegir entre tomar foto o traer de la galeria. */
export async function agregarImagen(servicioId, equipoId) {
  const origen = await hoja('Agregar imagen', (cerrar) => h('div.lista-acciones',
    h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('camara') },
      '📷  Tomar foto'),
    h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('galeria') },
      '🖼  Elegir de la galeria')
  ));
  if (!origen) return null;
  return capturarFoto(servicioId, equipoId, { galeria: origen === 'galeria' });
}

/**
 * Galeria del trabajo: todas las fotos del arbol, agrupadas por rama.
 * Tocar una abre el visor (pie editable, eliminar, excluir).
 */
export function galeriaDelTrabajo(servicioId, nombrePorRama) {
  return hoja('Fotos del trabajo', (cerrar) => {
    const cont = h('div');

    const pintar = async () => {
      const fotos = (await db.eventosDeServicio(servicioId)).filter(e => e.tipo === 'foto');
      cont.replaceChildren();

      if (!fotos.length) {
        cont.append(vacio('🖼', 'Sin fotos todavia',
          'Las imagenes que agregues con el boton Imagen apareceran aqui.'));
        return;
      }

      const grupos = new Map();
      for (const ev of fotos) {
        if (!grupos.has(ev.equipoId)) grupos.set(ev.equipoId, []);
        grupos.get(ev.equipoId).push(ev);
      }

      for (const [ramaId, lista] of grupos) {
        cont.append(h('h3.galeria__rama',
          (nombrePorRama[ramaId] || 'General') + ' · ' + lista.length));
        const rejilla = h('div.galeria-rejilla');
        for (const ev of lista) {
          const celda = h('button.galeria-celda', {
            type: 'button',
            onclick: () => verFoto(ev, pintar),
          });
          if (!ev.incluir) celda.classList.add('galeria-celda--excluida');
          rejilla.append(celda);
          db.fotoLeer(ev.datos.fotoId).then(f => {
            if (!f) { celda.append(h('span.galeria-celda__falta', '✕')); return; }
            const img = h('img', { alt: ev.datos.pie || '' });
            celda.append(img);
            img.src = media.urlDe(f.mini || f.blob);
          });
        }
        cont.append(rejilla);
      }
    };

    pintar();
    return cont;
  }, { altura: 'alta' });
}

export async function agregarNota(servicioId, equipoId) {
  const texto = await hoja('Nueva nota', (cerrar) => {
    const area = campoArea('', {
      placeholder: 'Que observaste, que ajustaste, que falto...\n\nTip: usa el microfono de tu teclado para dictar.',
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
        }, 'Guardar nota')
      )
    );
  });

  if (!texto) return null;
  const ev = await db.eventoNuevo(servicioId, equipoId, 'nota', { texto });
  aviso('Nota guardada', 'ok');
  return ev;
}

export async function editarNota(evento) {
  const texto = await hoja('Editar nota', (cerrar) => {
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
  const pie = h('input.visor__pie', {
    type: 'text',
    placeholder: 'Pie de foto (aparece en el reporte)',
    value: evento.datos.pie || '',
  });

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
    document.body.classList.remove('sin-scroll');
    if (porBack) ancla.desdePop();
    else await ancla.liberar();
    if (alCambiar) alCambiar();
  };

  const capa = h('div.visor',
    h('div.visor__barra',
      h('button.icono-btn.icono-btn--claro', { type: 'button', onclick: () => cerrar(true) }, '✕'),
      h('span.visor__hora', hora(evento.ts)),
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
    h('div.visor__lienzo', h('img.visor__img', { src: url, alt: '' })),
    h('div.visor__pieCont', pie,
      h('span.visor__meta', foto.ancho + '×' + foto.alto + ' · ' + media.formatoBytes(foto.bytes)))
  );

  document.body.appendChild(capa);
  document.body.classList.add('sin-scroll');
}

/* ---------------------------------------------------------------- */
/* Tarjetas de la linea de tiempo                                    */
/* ---------------------------------------------------------------- */

const ICONO = { nota: '📝', tabla: '▦', foto: '📷', prueba: '🧪' };

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
  evento.datos.resultado = texto;
  if (texto && !evento.datos.resultadoTs) evento.datos.resultadoTs = Date.now();
  if (!texto) evento.datos.resultadoTs = null;
  await db.eventoGuardar(evento);
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

export function tarjetaEvento(evento, refrescar) {
  let el;
  if (evento.tipo === 'nota')  el = tarjetaNota(evento, refrescar);
  else if (evento.tipo === 'tabla')  el = tarjetaTabla(evento, refrescar);
  else if (evento.tipo === 'foto')   el = tarjetaFoto(evento, refrescar);
  else if (evento.tipo === 'prueba') el = tarjetaPrueba(evento, refrescar);
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

/**
 * Barra fija de captura. Todo cae en la actividad activa (destinoNombre
 * la muestra para que siempre sepas donde va a quedar lo que captures).
 */
export function barraCaptura(servicioId, equipoId, refrescar, destinoNombre) {
  const btn = (icono, texto, alPulsar, clase = '') =>
    h('button.captura__btn' + clase, { type: 'button', onclick: alPulsar },
      h('span.captura__icono', icono), h('span.captura__texto', texto));

  return h('div.captura-zona',
    destinoNombre ? h('div.captura-destino',
      h('span.captura-destino__flecha', '▸'), destinoNombre) : null,
    h('div.captura',
      btn('📷', 'Imagen', async () => {
        await agregarImagen(servicioId, equipoId);
        refrescar();
      }, '.captura__btn--principal'),
      btn('📝', 'Nota', async () => {
        if (await agregarNota(servicioId, equipoId)) refrescar();
      }),
      btn('▦', 'Tabla', () => agregarTabla(servicioId, equipoId)),
      btn('🧪', 'Prueba', async () => {
        if (await agregarPrueba(servicioId, equipoId)) refrescar();
      })
    )
  );
}
