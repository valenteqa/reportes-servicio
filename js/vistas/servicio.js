// Detalle del trabajo: UNA sola vista en forma de arbol (tipo skill tree).
//
// El tronco es el trabajo; cada rama es una ACTIVIDAD (pruebas de una IPC,
// ajuste de bombas, mediciones de temperatura...) y de cada rama cuelgan sus
// notas, tablas, fotos y pruebas en orden cronologico.
//
// La rama seleccionada es el destino de la barra de captura. "General" es el
// tronco: siempre existe y recibe lo que no pertenece a una actividad.

import * as db from '../db.js';
import * as media from '../media.js';
import { h, campo, hoja, aviso, confirmar, fecha, hora, duracion } from '../ui.js';
import { lineaDeTiempo, menuAgregar, galeriaDelTrabajo } from './eventos.js';
import { editarServicio } from './servicios.js';

export async function agregarActividad(servicioId) {
  const catalogo = await db.catalogoEquipos();

  const nombre = await hoja('Nueva actividad', (cerrar) => {
    const cNombre = campo('Titulo de la actividad', {
      placeholder: 'Pruebas de tarjeta IPC',
      autocomplete: 'off',
    });

    const rapidas = catalogo.length
      ? h('div.chips',
          h('span.pista', 'Usadas antes:'),
          catalogo.slice(0, 6).map(c => h('button.chip', {
            type: 'button',
            onclick: () => { cNombre.entrada.value = c.valor; cNombre.entrada.focus(); }
          }, c.valor))
        )
      : null;

    return h('div',
      cNombre, rapidas,
      h('p.pista', 'Cada actividad es una rama del arbol: ahi caen sus notas, tablas, fotos y pruebas. En el reporte sera una seccion.'),
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button', onclick: () => cerrar(cNombre.entrada.value.trim())
        }, 'Crear rama')
      )
    );
  });

  if (!nombre) return null;
  const actividad = await db.equipoNuevo(servicioId, { nombre });
  aviso('Actividad creada', 'ok');
  return actividad;
}

function menuRama(actividad, conteo, refrescar) {
  return h('button.icono-btn.icono-btn--mini.icono-btn--tenue', {
    type: 'button', 'aria-label': 'Opciones',
    onclick: async (ev) => {
      ev.stopPropagation();
      const accion = await hoja(actividad.nombre, (cerrar) => h('div.lista-acciones',
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('renombrar') }, '✎  Renombrar'),
        h('button.lista-acciones__item.lista-acciones__item--peligro',
          { type: 'button', onclick: () => cerrar('borrar') }, '🗑  Eliminar actividad')
      ));

      if (accion === 'renombrar') {
        const nombre = await hoja('Renombrar actividad', (cerrar) => {
          const cNombre = campo('Titulo', { value: actividad.nombre });
          return h('div', cNombre,
            h('div.hoja__acciones',
              h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
              h('button.btn.btn--primario', {
                type: 'button', onclick: () => cerrar(cNombre.entrada.value.trim())
              }, 'Guardar')));
        });
        if (nombre) { actividad.nombre = nombre; await db.equipoGuardar(actividad); refrescar(); }
      } else if (accion === 'borrar') {
        const ok = await confirmar('Se elimina "' + actividad.nombre + '" con sus ' +
          conteo + ' registros. Esto no se puede deshacer.');
        if (ok) { await db.equipoBorrar(actividad.id); aviso('Actividad eliminada'); refrescar(); }
      }
    }
  }, '⋯');
}

function rama(servicio, actividad, eventos, refrescar) {
  const esGeneral = actividad.id === db.GENERAL;
  const sinResultado = eventos.filter(e => e.tipo === 'prueba' && !e.datos.resultado).length;

  const cabeza = h('div.rama__cabeza',
    h('span.rama__rombo'),
    h('span.rama__nombre', actividad.nombre),
    eventos.length ? h('span.rama__conteo', String(eventos.length)) : null,
    sinResultado ? h('span.rama__pendiente', sinResultado + ' sin resultado') : null,
    h('span.crece'),
    // El + de la rama: agregar directo aqui, sin concepto de rama activa.
    h('button.rama__agregar', {
      type: 'button', 'aria-label': 'Agregar en ' + actividad.nombre,
      onclick: () => menuAgregar(servicio.id, actividad.id, refrescar, actividad.nombre),
    }, '+'),
    esGeneral ? null : menuRama(actividad, eventos.length, refrescar)
  );

  const cuerpo = eventos.length
    ? lineaDeTiempo(eventos, refrescar)
    : h('p.rama__vacia', 'Sin registros — agrega con el +');

  return h('section.rama',
    cabeza,
    h('div.rama__cuerpo', cuerpo)
  );
}

export async function render(contenedor, refrescar, params) {
  media.liberarUrls();
  const servicio = await db.servicioLeer(params.sid);
  if (!servicio) { location.replace('#/'); return; }

  const actividades = await db.equiposDeServicio(servicio.id);
  const eventos = await db.eventosDeServicio(servicio.id);

  const porRama = {};
  for (const ev of eventos) {
    (porRama[ev.equipoId] = porRama[ev.equipoId] || []).push(ev);
  }

  const tipo = db.tipoDe(servicio);
  const titulo = servicio.titulo || servicio.cliente || servicio.planta || tipo.nombre;
  const maquina = [[servicio.marca, servicio.modelo].filter(Boolean).join(' '), servicio.serie,
    servicio.noMaquina ? 'Maq. ' + servicio.noMaquina : '']
    .filter(Boolean).join(' · ');

  const cabecera = h('header.cabecera',
    h('div.cabecera__fila',
      h('button.icono-btn', { type: 'button', 'aria-label': 'Volver',
        onclick: () => history.back() }, '←'),
      h('div.cabecera__titulo',
        h('h1', titulo),
        h('p', tipo.icono + ' ' + tipo.nombre + (servicio.planta ? ' · ' + servicio.planta : ''))
      ),
      h('button.icono-btn', { type: 'button', 'aria-label': 'Fotos del trabajo',
        onclick: async () => {
          await galeriaDelTrabajo(servicio.id);
          refrescar();   // por si borro o excluyo fotos desde el visor
        } }, '🖼'),
      h('button.icono-btn', { type: 'button', 'aria-label': 'Editar datos',
        onclick: async () => { if (await editarServicio(servicio)) refrescar(); } }, '✎')
    ),
    maquina ? h('div.cabecera__maquina', '⚙ ' + maquina) : null,
    h('div.cabecera__meta',
      h('span', fecha(servicio.inicio) + ' · ' + hora(servicio.inicio)),
      servicio.tecnico ? h('span', '· ' + servicio.tecnico) : null,
      h('span.crece'),
      h('span', duracion(servicio.inicio, servicio.fin))
    )
  );

  const general = { id: db.GENERAL, nombre: 'General' };
  const arbol = h('div.arbol',
    rama(servicio, general, porRama[db.GENERAL] || [], refrescar),
    actividades.map(a => rama(servicio, a, porRama[a.id] || [], refrescar)),
    h('button.rama-nueva', {
      type: 'button',
      onclick: async () => { if (await agregarActividad(servicio.id)) refrescar(); }
    },
      h('span.rama-nueva__rombo', '+'),
      h('span', 'Nueva actividad')
    )
  );

  contenedor.append(cabecera, h('main.contenido', arbol));
}
