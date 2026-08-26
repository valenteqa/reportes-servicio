// Detalle del servicio: equipos y linea de tiempo completa.

import * as db from '../db.js';
import * as media from '../media.js';
import { h, campo, campoArea, hoja, aviso, confirmar, fecha, hora, duracion, relativo, vacio, $ } from '../ui.js';
import { lineaDeTiempo } from './eventos.js';
import { editarServicio } from './servicios.js';

export async function agregarEquipo(servicioId) {
  const catalogo = await db.catalogoEquipos();

  const datos = await hoja('Agregar equipo', (cerrar) => {
    const cNombre = campo('Nombre del equipo', {
      placeholder: 'Bomba hidraulica 2',
      list: 'catalogo-equipos',
      autocomplete: 'off',
    });
    const cTag  = campo('TAG', { placeholder: 'BH-002' });
    const cDesc = campoArea('Notas del equipo', { rows: 2, placeholder: 'Marca, modelo, serie...' });

    const sugerencias = h('datalist#catalogo-equipos',
      catalogo.slice(0, 40).map(c => h('option', { value: c.valor })));

    const rapidas = catalogo.length
      ? h('div.chips',
          h('span.pista', 'Usados antes:'),
          catalogo.slice(0, 6).map(c => h('button.chip', {
            type: 'button',
            onclick: () => { cNombre.entrada.value = c.valor; cNombre.entrada.focus(); }
          }, c.valor))
        )
      : null;

    return h('div',
      cNombre, sugerencias, rapidas, cTag, cDesc,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => cerrar({
            nombre: cNombre.entrada.value.trim(),
            tag:    cTag.entrada.value.trim(),
            descripcion: cDesc.entrada.value.trim(),
          })
        }, 'Agregar')
      )
    );
  });

  if (!datos) return null;
  if (!datos.nombre) { aviso('Ponle nombre al equipo', 'error'); return null; }
  const equipo = await db.equipoNuevo(servicioId, datos);
  aviso('Equipo agregado', 'ok');
  return equipo;
}

function tarjetaEquipo(servicio, equipo, resumen, refrescar) {
  const r = resumen || { total: 0, foto: 0, nota: 0, tabla: 0, ultimo: 0 };
  const esGeneral = equipo.id === db.GENERAL;

  return h('article.tarjeta-equipo' + (esGeneral ? '.tarjeta-equipo--general' : ''), {
    onclick: () => { location.hash = '#/s/' + servicio.id + '/e/' + equipo.id; }
  },
    h('div.tarjeta-equipo__cuerpo',
      h('h3.tarjeta-equipo__nombre',
        esGeneral ? '📋 ' : '',
        equipo.nombre,
        equipo.tag ? h('span.tag', equipo.tag) : null
      ),
      equipo.descripcion ? h('p.tarjeta-equipo__desc', equipo.descripcion) : null,
      h('div.tarjeta-equipo__pie',
        r.total
          ? [
              r.foto  ? h('span.contador', '📷 ' + r.foto)  : null,
              r.tabla ? h('span.contador', '▦ ' + r.tabla)  : null,
              r.nota  ? h('span.contador', '📝 ' + r.nota)  : null,
              h('span.pista', '· ' + relativo(r.ultimo)),
            ]
          : h('span.pista', 'Sin registros')
      )
    ),
    esGeneral ? null : h('button.icono-btn.tarjeta-equipo__menu', {
      type: 'button', 'aria-label': 'Opciones',
      onclick: async (ev) => {
        ev.stopPropagation();
        const accion = await hoja(equipo.nombre, (cerrar) => h('div.lista-acciones',
          h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('editar') }, '✎  Editar equipo'),
          h('button.lista-acciones__item.lista-acciones__item--peligro',
            { type: 'button', onclick: () => cerrar('borrar') }, '🗑  Eliminar equipo')
        ));

        if (accion === 'editar') {
          const datos = await hoja('Editar equipo', (cerrar) => {
            const cNombre = campo('Nombre', { value: equipo.nombre });
            const cTag = campo('TAG', { value: equipo.tag || '' });
            const cDesc = campoArea('Notas del equipo', { rows: 2, value: equipo.descripcion || '' });
            return h('div', cNombre, cTag, cDesc,
              h('div.hoja__acciones',
                h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
                h('button.btn.btn--primario', {
                  type: 'button',
                  onclick: () => cerrar({
                    nombre: cNombre.entrada.value.trim(),
                    tag: cTag.entrada.value.trim(),
                    descripcion: cDesc.entrada.value.trim(),
                  })
                }, 'Guardar')));
          });
          if (datos && datos.nombre) {
            Object.assign(equipo, datos);
            await db.equipoGuardar(equipo);
            refrescar();
          }
        } else if (accion === 'borrar') {
          const ok = await confirmar('Se elimina "' + equipo.nombre +
            '" y sus ' + r.total + ' registros. Esto no se puede deshacer.');
          if (ok) { await db.equipoBorrar(equipo.id); aviso('Equipo eliminado'); refrescar(); }
        }
      }
    }, '⋯')
  );
}

export async function render(contenedor, refrescar, params) {
  media.liberarUrls();
  const servicio = await db.servicioLeer(params.sid);
  if (!servicio) { location.hash = '#/'; return; }

  const equipos = await db.equiposDeServicio(servicio.id);
  const resumen = await db.resumenPorEquipo(servicio.id);
  const pestanaGuardada = sessionStorage.getItem('pestana:' + servicio.id) || 'equipos';

  const tipo = db.tipoDe(servicio);
  const titulo = servicio.cliente || servicio.planta || tipo.nombre;
  const maquina = [servicio.modelo, servicio.serie].filter(Boolean).join(' · ');

  const cabecera = h('header.cabecera',
    h('div.cabecera__fila',
      h('button.icono-btn', { type: 'button', 'aria-label': 'Volver',
        onclick: () => { location.hash = '#/'; } }, '←'),
      h('div.cabecera__titulo',
        h('h1', titulo),
        h('p', tipo.icono + ' ' + tipo.nombre + (servicio.planta ? ' · ' + servicio.planta : ''))
      ),
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

  const panel = h('div.panel');

  const pestanas = h('div.pestanas',
    h('button.pestana', { type: 'button', dataset: { p: 'equipos' } },
      'Equipos (' + equipos.length + ')'),
    h('button.pestana', { type: 'button', dataset: { p: 'todo' } }, 'Linea completa')
  );

  const nombrePorId = {};
  nombrePorId[db.GENERAL] = 'General';
  equipos.forEach(e => { nombrePorId[e.id] = e.nombre; });

  async function pintarPanel(cual) {
    sessionStorage.setItem('pestana:' + servicio.id, cual);
    Array.from(pestanas.children).forEach(b =>
      b.classList.toggle('pestana--activa', b.dataset.p === cual));
    panel.replaceChildren();

    if (cual === 'equipos') {
      const general = { id: db.GENERAL, nombre: 'General', tag: '', descripcion: 'Observaciones que no son de un equipo especifico' };
      panel.append(tarjetaEquipo(servicio, general, resumen[db.GENERAL], refrescar));

      if (!equipos.length) {
        panel.append(vacio('⚙', 'Sin equipos todavia',
          'Agrega los equipos que vas a revisar. Cada uno lleva su propia linea de tiempo.'));
      } else {
        equipos.forEach(eq => panel.append(tarjetaEquipo(servicio, eq, resumen[eq.id], refrescar)));
      }

      panel.append(h('button.btn.btn--bloque', {
        type: 'button',
        onclick: async () => { if (await agregarEquipo(servicio.id)) refrescar(); }
      }, '+  Agregar equipo'));

    } else {
      const eventos = await db.eventosDeServicio(servicio.id);
      panel.append(lineaDeTiempo(eventos, refrescar, { mostrarEquipo: id => nombrePorId[id] || 'Equipo eliminado' }));
    }
  }

  pestanas.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.pestana');
    if (btn) pintarPanel(btn.dataset.p);
  });

  contenedor.append(cabecera, pestanas, h('main.contenido', panel));
  await pintarPanel(pestanaGuardada);
}
