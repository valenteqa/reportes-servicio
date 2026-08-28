// Vista previa del reporte Word, dibujada como pagina blanca dentro de la app.
//
// Muestra EL MISMO contenido y orden que el .docx generado (datos, secciones,
// fotos con su numero de figura, tablas, pendientes, observaciones y
// recomendaciones), siguiendo las mismas reglas que js/reporte.js. Es una
// aproximacion: el archivo real ademas lleva logos, marca de agua, indice y
// las fuentes del formato.

import * as db from '../db.js';
import { h, anclarCapa, bloquearScroll, liberarScroll } from '../ui.js';
import { fechaLarga, folioDe } from '../reporte.js';

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
    .map(s => h('p.previa__p', s));

  const gris = (t) => h('p.previa__p.previa__gris', t);

  async function eventoNodo(ev) {
    if (ev.tipo === 'nota') return parrafos(ev.datos.texto);

    if (ev.tipo === 'tabla') {
      const t = ev.datos;
      const filas = (t.filas || []).filter(f => f.some(c => String(c).trim() !== ''));
      return [
        t.titulo ? h('p.previa__p', h('strong', t.titulo)) : null,
        h('div.previa__desborde', h('table.previa__tabla',
          // las columnas son objetos {nombre, unidad}: pasarlos directo a h()
          // los tragaba como atributos y los encabezados salian vacios
          h('thead', h('tr', (t.columnas || []).map(c =>
            h('th', typeof c === 'string' ? c : (c.nombre || '') + (c.unidad ? ' (' + c.unidad + ')' : ''))))),
          h('tbody', filas.map(f => h('tr', f.map(c => h('td', String(c))))))
        )),
      ];
    }

    if (ev.tipo === 'foto') {
      const foto = await db.fotoLeer(ev.datos.fotoId);
      if (!foto) return null;
      nFigura++;
      const url = URL.createObjectURL(foto.blob);
      urls.push(url);
      return h('figure.previa__figura',
        h('img', { src: url, alt: '', loading: 'lazy' }),
        h('figcaption', 'Figura ' + nFigura + (ev.datos.pie ? '. ' + ev.datos.pie : ''))
      );
    }

    if (ev.tipo === 'prueba') {
      return [
        h('p.previa__p', h('strong', 'Prueba: '), ev.datos.descripcion || ''),
        ev.datos.resultado
          ? h('p.previa__p', h('strong', 'Resultado: '), ev.datos.resultado)
          : h('p.previa__p', h('strong', 'Resultado: '), h('span.previa__gris', '(pendiente de resultado)')),
      ];
    }

    return null;   // los pendientes van en su propia seccion
  }

  async function seccion(nombre, evs) {
    const nodos = [];
    for (const ev of evs) nodos.push(await eventoNodo(ev));
    return [h('h2.previa__h', nombre), ...nodos];
  }

  /* ---- pagina ---- */

  const filaDato = (etq, val) => val
    ? h('tr', h('th', etq), h('td', val)) : null;

  const cuerpo = [];

  cuerpo.push(h('div.previa__membrete',
    h('img.previa__logo', { src: 'icons/logo-serpro.png', alt: 'Grupo Ser Pro' }),
    h('div',
      h('p.previa__emp', 'REPORTE DE SERVICIO'),
      h('p.previa__folio', 'Folio ' + (servicio.folio || folioDe(servicio)) + ' · ' + fechaLarga(servicio.inicio))
    )
  ));

  cuerpo.push(h('table.previa__datos', h('tbody',
    filaDato('Cliente', servicio.cliente),
    filaDato('Planta', servicio.planta),
    filaDato('Tipo de maquina', servicio.marca),
    filaDato('Modelo', servicio.modelo),
    filaDato('No. de serie', servicio.serie),
    filaDato('No. de maquina', servicio.noMaquina),
    filaDato('Descripcion del problema', (servicio.descripcion || servicio.titulo || '').replace(/\n+/g, ' ')),
    filaDato('Tecnico', servicio.tecnico)
  )));

  cuerpo.push(gris('(Aqui va el indice: se actualiza solo al abrir el Word)'));

  if (servicio.descripcion || servicio.titulo) {
    cuerpo.push(h('h2.previa__h', 'Antecedentes'), ...parrafos(servicio.descripcion || servicio.titulo));
  }

  const evGeneral = (porRama[db.GENERAL] || []).filter(e => e.tipo !== 'pendiente');
  if (evGeneral.length) cuerpo.push(...await seccion('Actividades', evGeneral));

  for (const act of actividades) {
    const evs = (porRama[act.id] || []).filter(e => e.tipo !== 'pendiente');
    if (!evs.length) continue;
    cuerpo.push(...await seccion(act.nombre, evs));
  }

  const pendientes = eventos.filter(e => e.tipo === 'pendiente');
  if (pendientes.length) {
    cuerpo.push(h('h2.previa__h', 'Pendientes'),
      h('ul.previa__lista', pendientes.map(p =>
        h('li', (p.datos.texto || '').replace(/\n+/g, ' ')))));
  }

  // La seccion fija del arbol: textos como viñetas, fotos como figuras.
  cuerpo.push(h('h2.previa__h', 'Observaciones y recomendaciones'));
  const evObs = porRama[db.OBSERVACIONES] || [];
  const nodosObs = [];
  let vinetas = [];
  const soltarVinetas = () => {
    if (vinetas.length) { nodosObs.push(h('ul.previa__lista', vinetas)); vinetas = []; }
  };
  for (const ev of evObs) {
    if (ev.tipo === 'nota') {
      for (const linea of (ev.datos.texto || '').split('\n').map(s => s.trim()).filter(Boolean))
        vinetas.push(h('li', linea));
    } else {
      soltarVinetas();
      nodosObs.push(await eventoNodo(ev));
    }
  }
  soltarVinetas();
  cuerpo.push(nodosObs.length ? nodosObs : gris('(Redactar observaciones y recomendaciones)'));

  const pagina = h('div.previa__pagina', cuerpo);

  /* ---- capa a pantalla completa, con atras del telefono ---- */

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
      if (porBack) ancla.desdePop();
      else await ancla.liberar();
      resolve();
    }

    // Imprimir: solo sale la pagina blanca (CSS @media print + body.imprimiendo).
    // En el APK, window.print() no existe de verdad: va por el puente nativo.
    const imprimir = () => {
      document.body.classList.add('imprimiendo');
      const fin = () => document.body.classList.remove('imprimiendo');
      window.addEventListener('afterprint', fin, { once: true });
      setTimeout(fin, 4000);   // respaldo por si afterprint no dispara
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
        h('span.previa__nota', 'aproximada — el Word lleva logos y formato'),
        h('span.crece'),
        h('button.icono-btn.icono-btn--claro', { type: 'button', 'aria-label': 'Imprimir', onclick: imprimir }, '🖨')
      ),
      h('div.previa__scroll', pagina)
    );

    document.body.appendChild(capa);
    bloquearScroll();
  });
}
