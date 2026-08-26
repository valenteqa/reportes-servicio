// Linea de tiempo de un equipo, con la barra de captura siempre a la mano.

import * as db from '../db.js';
import * as media from '../media.js';
import { h, duracion, relativo } from '../ui.js';
import { lineaDeTiempo, barraCaptura } from './eventos.js';

export async function render(contenedor, refrescar, params) {
  media.liberarUrls();

  const servicio = await db.servicioLeer(params.sid);
  if (!servicio) { location.hash = '#/'; return; }

  const esGeneral = params.eid === db.GENERAL;
  let equipo;
  if (esGeneral) {
    equipo = { id: db.GENERAL, nombre: 'General', tag: '', descripcion: '' };
  } else {
    equipo = await db.equipoLeer(params.eid);
    if (!equipo) { location.hash = '#/s/' + params.sid; return; }
  }

  const eventos = await db.eventosDeEquipo(equipo.id);

  const cabecera = h('header.cabecera',
    h('div.cabecera__fila',
      h('button.icono-btn', { type: 'button', 'aria-label': 'Volver',
        onclick: () => { location.hash = '#/s/' + servicio.id; } }, '←'),
      h('div.cabecera__titulo',
        h('h1', (esGeneral ? '📋 ' : '') + equipo.nombre),
        h('p', [servicio.cliente, servicio.planta].filter(Boolean).join(' · '))
      ),
      equipo.tag ? h('span.tag.tag--grande', equipo.tag) : null
    ),
    h('div.cabecera__meta',
      h('span', eventos.length + (eventos.length === 1 ? ' registro' : ' registros')),
      eventos.length ? h('span', '· ultimo ' + relativo(eventos[eventos.length - 1].ts)) : null
    )
  );

  contenedor.append(
    cabecera,
    h('main.contenido.contenido--conBarra', lineaDeTiempo(eventos, refrescar)),
    barraCaptura(servicio.id, equipo.id, refrescar)
  );

  // Al volver de capturar algo, mostrar lo ultimo sin que el usuario tenga que buscar.
  const main = contenedor.querySelector('.contenido');
  if (eventos.length && sessionStorage.getItem('irAlFinal:' + equipo.id) === '1') {
    sessionStorage.removeItem('irAlFinal:' + equipo.id);
    requestAnimationFrame(() => { main.scrollTop = main.scrollHeight; });
  }
}
