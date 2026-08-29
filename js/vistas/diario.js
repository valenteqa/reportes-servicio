// Diario: seguimiento de actividades del dia. Cada quien anota su lista,
// la va marcando durante el dia y al cerrarlo queda su porcentaje. Un dia
// ANTERIOR sin evaluar bloquea la app completa (candado) hasta marcarlo.
// La semana se evalua por ACTIVIDADES TOTALES completadas — no promediando
// dias — para que un mal dia se recupere completando mas al siguiente.
//
// (Fase organizacional pendiente: deptos, lider y ver a toda la organizacion;
// requiere que los datos viajen entre telefonos.)

import { h, aviso, vaciar, confirmar, hoja, campo } from '../ui.js';
import * as db from '../db.js';
import { DEPTOS, ROLES, organizacion, quienSoy, puedeEditarActividades, puedeVerActividadesDe, AVISO_SOLO_LIDER, fechaSimulada } from '../organizacion.js';

const DIAS_CORTOS = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];
const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

export function fechaClave(d) {
  if (!d) {
    const simulada = fechaSimulada();   // modo prueba: la app vive ahi
    if (simulada) return simulada;
    d = new Date();
  }
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function aFecha(clave) { return new Date(clave + 'T12:00:00'); }

function nombreDia(clave) {
  const d = aFecha(clave);
  return DIAS_CORTOS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES_CORTOS[d.getMonth()];
}

// Lunes de la semana a la que pertenece la fecha (semana Lun-Dom).
function lunesDe(clave) {
  const d = aFecha(clave);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fechaClave(d);
}

function sumarDias(clave, n) {
  const d = aFecha(clave);
  d.setDate(d.getDate() + n);
  return fechaClave(d);
}

function conteo(dia) {
  const total = (dia && dia.actividades ? dia.actividades : []).length;
  const hechas = (dia && dia.actividades ? dia.actividades : []).filter(a => a.hecha).length;
  return { hechas, total, pct: total ? Math.round(hechas * 100 / total) : 0 };
}

/* ---------------------------------------------------------------- */
/* Piezas compartidas (lista de actividades con palomita)            */
/* ---------------------------------------------------------------- */

function filaActividad(dia, act, { editable, puedeEditar, alCambiar }) {
  const palomita = h('button.dia-check' + (act.hecha ? '.dia-check--si' : ''), {
    type: 'button', 'aria-label': act.hecha ? 'Completada' : 'Pendiente',
    onclick: async () => {
      act.hecha = !act.hecha;
      await db.diaGuardar(dia);
      alCambiar();
    },
  }, act.hecha ? '✔' : '');
  const fila = h('div.dia-fila',
    palomita,
    h('span.dia-texto' + (act.hecha ? '.dia-texto--hecha' : ''), act.texto));
  if (editable) {
    // Regla de Vale: cambiar o eliminar actividades es SOLO del lider (o
    // admin); al usuario normal se le pide que lo solicite a su lider.
    fila.append(
      h('button.icono-btn.dia-editar', {
        type: 'button', 'aria-label': 'Cambiar actividad',
        onclick: async () => {
          if (!puedeEditar) { aviso(AVISO_SOLO_LIDER); return; }
          const nuevo = await hoja('Cambiar actividad', (cerrar) => {
            const c = campo('Actividad', { value: act.texto, maxLength: 200 });
            return h('div', c,
              h('div.hoja__acciones',
                h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
                h('button.btn.btn--primario', { type: 'button', onclick: () => cerrar(c.querySelector('input').value.trim()) }, 'Guardar')));
          });
          if (!nuevo) return;
          act.texto = nuevo;
          await db.diaGuardar(dia);
          alCambiar();
        },
      }, '✎'),
      h('button.icono-btn.dia-borrar', {
        type: 'button', 'aria-label': 'Eliminar actividad',
        onclick: async () => {
          if (!puedeEditar) { aviso(AVISO_SOLO_LIDER); return; }
          if (!(await confirmar('¿Eliminar la actividad "' + act.texto + '"?'))) return;
          dia.actividades = dia.actividades.filter(a => a !== act);
          await db.diaGuardar(dia);
          alCambiar();
        },
      }, '🗑'));
  }
  return fila;
}

function barraAvance(dia) {
  const c = conteo(dia);
  return h('div',
    h('div.dia-barra', h('i', { style: { width: c.pct + '%' } })),
    h('p.dia-avance', c.hechas + ' de ' + c.total + ' completadas · ' + c.pct + '%'));
}

/* ---------------------------------------------------------------- */
/* Candado: dias anteriores sin evaluar bloquean TODA la app         */
/* ---------------------------------------------------------------- */

async function diasPendientes() {
  const hoy = fechaClave();
  return (await db.diasTodos())
    .filter(d => d.fecha < hoy && (d.actividades || []).length && !d.evaluado)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}

let capaCandado = null;

function mostrarCandado(dias, alTerminar) {
  // Sin ancla de historial a proposito: el boton atras del telefono sale
  // de la app, pero NO brinca el candado.
  const cuerpo = h('div.candado-cuerpo');
  capaCandado = h('div.candado-diario', cuerpo);
  document.body.appendChild(capaCandado);

  let i = 0;
  const pinta = () => {
    const dia = dias[i];
    const c = conteo(dia);
    vaciar(cuerpo).append(
      h('div.candado-tarjeta',
        h('div.candado-icono', '📔'),
        h('h2', 'Marca tus actividades del ' + nombreDia(dia.fecha)),
        h('p.pista', 'Quedaron sin evaluar. Marca lo que completaste ese dia para seguir usando la app. Lo que falto aun cuenta para la semana: hoy puedes recuperar.'),
        h('div.candado-lista', ...dia.actividades.map(a => filaActividad(dia, a, { editable: false, alCambiar: pinta }))),
        barraAvance(dia),
        h('button.btn.btn--primario.candado-btn', {
          type: 'button',
          onclick: async () => {
            dia.evaluado = true;
            await db.diaGuardar(dia);
            i += 1;
            if (i < dias.length) { pinta(); return; }
            capaCandado.remove();
            capaCandado = null;
            aviso('Dia evaluado. ¡A darle hoy!');
            if (alTerminar) alTerminar();
          },
        }, 'LISTO · CERRAR EL ' + nombreDia(dia.fecha) + ' CON ' + c.pct + '%')
      ));
  };
  pinta();
}

// Se instala al arrancar la app: revisa al momento y cada vez que la app
// vuelve a verse (el dia puede cambiar con la app abierta de fondo).
export function instalarCandado(alTerminar) {
  const revisar = async () => {
    if (capaCandado) return;
    try {
      const pendientes = await diasPendientes();
      if (pendientes.length) mostrarCandado(pendientes, alTerminar);
    } catch (e) { /* sin datos aun */ }
  };
  revisar();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revisar();
  });
}

/* ---------------------------------------------------------------- */
/* Datos por miembro                                                 */
/* ---------------------------------------------------------------- */

// Registros de un usuario: HOY solo este telefono tiene los del dueño;
// los de los demas llegaran con la nube (Firebase). null = sin datos aqui.
async function diasDe(usuario) {
  const yo = await quienSoy();
  if (yo && usuario.id === yo.id) return db.diasTodos();
  return null;
}

function resumenSemana(dias, lunes) {
  let hechas = 0;
  let total = 0;
  if (dias) {
    for (const d of dias) {
      if (lunesDe(d.fecha) !== lunes) continue;
      const c = conteo(d);
      hechas += c.hechas;
      total += c.total;
    }
  }
  return { hechas, total, pct: total ? Math.round(hechas * 100 / total) : 0 };
}

function cabeceraSub(titulo, extra) {
  return h('header.cabecera',
    h('div.cabecera__fila',
      h('button.icono-btn', { type: 'button', 'aria-label': 'Volver', onclick: () => history.back() }, '←'),
      h('h1', titulo),
      extra ? h('span.diario-fecha', extra) : null
    ));
}

// clickeable=true abre las actividades del miembro (solo lider de su depto
// o admin); si no, la fila es plana: se ve el PORCENTAJE y nada mas.
function filaMiembro(u, resumen, clickeable) {
  const dato = resumen === null
    ? 'sin datos aqui'
    : (resumen.total ? resumen.hechas + ' de ' + resumen.total + ' · ' + resumen.pct + '%' : 'sin actividades');
  const contenido = [
    h('span.miembro-nombre', u.nombre,
      u.rol !== 'usuario' ? h('span.gd-rol', ROLES[u.rol]) : null),
    h('span.sem-dato', dato),
  ];
  if (!clickeable) return h('div.miembro-fila', ...contenido);
  return h('button.miembro-fila', {
    type: 'button',
    onclick: () => { location.hash = '#/d/u/' + u.id; },
  }, ...contenido, h('span.menu__flecha', '›'));
}

/* ---------------------------------------------------------------- */
/* Vista: organizacion completa (todos los deptos)                   */
/* ---------------------------------------------------------------- */

async function renderOrganizacion(contenedor) {
  const org = await organizacion();
  const lunes = lunesDe(fechaClave());
  contenedor.append(cabeceraSub('🏢 Organizacion', 'semana actual'));
  const cont = h('div.contenido.diario');
  contenedor.append(cont);

  for (const depto of [...DEPTOS, '']) {
    const miembros = org.usuarios.filter(u => (u.depto || '') === depto);
    if (!miembros.length) continue;
    const carta = h('section.diario-carta');
    carta.append(h('h3', depto || 'SIN DEPTO ASIGNADO'));
    let dHechas = 0;
    let dTotal = 0;
    for (const u of miembros) {
      const dias = await diasDe(u);
      const r = dias === null ? null : resumenSemana(dias, lunes);
      if (r) { dHechas += r.hechas; dTotal += r.total; }
      // En organizacion SOLO porcentajes: las filas no abren actividades.
      carta.append(filaMiembro(u, r, false));
    }
    const pct = dTotal ? Math.round(dHechas * 100 / dTotal) : 0;
    carta.append(h('p.sem-total', dTotal
      ? 'DEPTO: ' + dHechas + ' de ' + dTotal + ' · ' + pct + '%'
      : 'Depto sin actividades registradas en este telefono.'));
    // Ventas se gestiona distinto: su tablero global se abre desde aqui.
    if (depto === 'Ventas') {
      carta.append(h('button.btn.btn--fantasma.venta-abrir', {
        type: 'button', onclick: () => { location.hash = '#/d/ventas'; },
      }, '💼  Ver oportunidades de venta'));
    }
    cont.append(carta);
  }
  cont.append(h('p.pista', 'Aqui solo se ven porcentajes. El detalle de actividades de cada quien lo ve su lider de area (en Mi depto) o el administrador.'));
}

/* ---------------------------------------------------------------- */
/* Vista: mi departamento                                            */
/* ---------------------------------------------------------------- */

async function renderDepto(contenedor) {
  const org = await organizacion();
  const yo = await quienSoy();
  const lunes = lunesDe(fechaClave());
  const depto = yo ? (yo.depto || '') : '';
  contenedor.append(cabeceraSub('👥 Mi depto', depto || null));
  const cont = h('div.contenido.diario');
  contenedor.append(cont);

  if (!yo) {
    cont.append(h('div.diario-carta', h('p.pista', 'Este telefono aun no dice de quien es: eligelo en ⚙ Configuracion → Usuarios y deptos.')));
    return;
  }
  if (!depto) {
    cont.append(h('div.diario-carta', h('p.pista', 'Aun no tienes depto asignado. El administrador lo asigna en ⚙ Configuracion → Usuarios y deptos.')));
    return;
  }

  const miembros = org.usuarios.filter(u => (u.depto || '') === depto);
  const carta = h('section.diario-carta');
  carta.append(h('h3', depto.toUpperCase() + ' · ESTA SEMANA'));
  let dHechas = 0;
  let dTotal = 0;
  for (const u of miembros) {
    const dias = await diasDe(u);
    const r = dias === null ? null : resumenSemana(dias, lunes);
    if (r) { dHechas += r.hechas; dTotal += r.total; }
    carta.append(filaMiembro(u, r, puedeVerActividadesDe(yo, u)));
  }
  const pct = dTotal ? Math.round(dHechas * 100 / dTotal) : 0;
  carta.append(
    h('div.dia-barra.sem-barra', h('i', { style: { width: pct + '%' } })),
    h('p.sem-total', dTotal
      ? 'DEPTO: ' + dHechas + ' de ' + dTotal + ' actividades · ' + pct + '%'
      : 'Sin actividades del depto registradas en este telefono.'),
    h('p.pista', 'El depto se evalua igual que la semana: actividades totales completadas entre todos, no promedio.'));
  cont.append(carta);
}

/* ---------------------------------------------------------------- */
/* Vista: actividades de un miembro                                  */
/* ---------------------------------------------------------------- */

async function renderMiembro(contenedor, id) {
  const org = await organizacion();
  const u = org.usuarios.find(x => x.id === id);
  if (!u) {
    contenedor.append(cabeceraSub('Miembro'), h('div.contenido', h('div.diario-carta', h('p.pista', 'No se encontro a esta persona en el padron.'))));
    return;
  }
  const hoyClave = fechaClave();
  const lunes = lunesDe(hoyClave);
  contenedor.append(cabeceraSub(u.nombre, u.depto || 'sin depto'));
  const cont = h('div.contenido.diario');
  contenedor.append(cont);
  if (u.rol !== 'usuario') cont.append(h('p.diario-quien', ROLES[u.rol]));

  // Las ACTIVIDADES (los textos) solo las ve su lider de depto o el admin;
  // los porcentajes son publicos para todos.
  const yo = await quienSoy();
  const puedeVer = puedeVerActividadesDe(yo, u);
  if (!puedeVer) {
    cont.append(h('p.pista.diario-quien',
      'Aqui solo se ven porcentajes: el detalle de actividades lo ve su lider de area o el administrador.'));
  }

  const dias = await diasDe(u);
  if (dias === null) {
    cont.append(h('div.diario-carta',
      h('p.pista', 'Los registros de ' + u.nombre + ' viven en su telefono. Cuando se conecte la nube, aqui veras sus porcentajes.')));
    return;
  }

  const porFecha = {};
  for (const d of dias) porFecha[d.fecha] = d;

  // HOY (solo ver, y solo para quien puede ver el detalle)
  if (puedeVer) {
    const dHoy = porFecha[hoyClave];
    const cartaHoy = h('section.diario-carta', h('h3', 'HOY'));
    if (dHoy && dHoy.actividades.length) {
      const c = conteo(dHoy);
      cartaHoy.append(...dHoy.actividades.map(a => filaActividad(dHoy, a, { editable: false, alCambiar: () => {} })));
      for (const b of cartaHoy.querySelectorAll('.dia-check')) b.disabled = true;
      cartaHoy.append(h('p.dia-avance', c.hechas + ' de ' + c.total + ' · ' + c.pct + '%' + (dHoy.evaluado ? ' · dia cerrado' : '')));
    } else {
      cartaHoy.append(h('p.pista', 'Sin actividades registradas hoy.'));
    }
    cont.append(cartaHoy);
  }

  // SEMANA
  const cartaSem = h('section.diario-carta', h('h3', 'ESTA SEMANA'));
  const r = resumenSemana(dias, lunes);
  for (let n = 0; n < 7; n++) {
    const f = sumarDias(lunes, n);
    const c = conteo(porFecha[f]);
    cartaSem.append(h('div.sem-fila' + (f === hoyClave ? '.sem-fila--hoy' : ''),
      h('span', nombreDia(f)),
      h('span.sem-dato', c.total ? c.hechas + ' de ' + c.total + ' · ' + c.pct + '%' : (f > hoyClave ? '' : '—'))));
  }
  cartaSem.append(
    h('div.dia-barra.sem-barra', h('i', { style: { width: r.pct + '%' } })),
    h('p.sem-total', r.total ? 'SEMANA: ' + r.hechas + ' de ' + r.total + ' · ' + r.pct + '%' : 'Sin actividades esta semana.'));
  cont.append(cartaSem);
}

/* ---------------------------------------------------------------- */
/* Vista principal (mi dia) y despachador                            */
/* ---------------------------------------------------------------- */

export async function render(contenedor, refrescar, params = {}) {
  if (params.sub === 'org') return renderOrganizacion(contenedor);
  if (params.sub === 'u') return renderMiembro(contenedor, params.id);

  // VENTAS no lleva diario: sus miembros entran directo al tablero global
  // (tambien su "Mi depto" ES el tablero).
  if (params.sub === '' || params.sub === 'depto') {
    const yoV = await quienSoy();
    if (yoV && yoV.depto === 'Ventas') { location.replace('#/d/ventas'); return; }
  }
  if (params.sub === 'depto') return renderDepto(contenedor);

  const hoyClave = fechaClave();
  let dia = await db.diaLeer(hoyClave);
  if (!dia) dia = { fecha: hoyClave, actividades: [], evaluado: false };

  const yo = await quienSoy();
  const puedeEditar = puedeEditarActividades(yo);

  const cabecera = h('header.cabecera',
    h('div.cabecera__fila',
      h('button.icono-btn', { type: 'button', 'aria-label': 'Volver', onclick: () => history.back() }, '←'),
      h('h1', '📔 Gestion de Deptos'),
      h('span.diario-fecha', nombreDia(hoyClave))
    ));

  const cont = h('div.contenido.diario');
  contenedor.append(cabecera, cont);

  const pintar = async () => {
    const todos = (await db.diasTodos()).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    vaciar(cont);

    if (yo) {
      cont.append(h('p.diario-quien', 'Tu: ' + yo.nombre + (yo.depto ? ' · ' + yo.depto : '')));
    } else {
      cont.append(h('p.pista.diario-quien',
        'Este telefono aun no dice de quien es: eligelo en ⚙ Configuracion → Usuarios y deptos. Mientras, cuenta como usuario normal.'));
    }

    // Abre en TU dia; desde aqui se brinca a la gestion completa.
    cont.append(h('div.gd-nav',
      h('button.btn.btn--fantasma', { type: 'button', onclick: () => { location.hash = '#/d/org'; } }, '🏢  ORGANIZACION'),
      h('button.btn.btn--fantasma', { type: 'button', onclick: () => { location.hash = '#/d/depto'; } }, '👥  MI DEPTO')));

    /* ── HOY ── */
    const cHoy = conteo(dia);
    const cartaHoy = h('section.diario-carta');
    cartaHoy.append(h('h3', 'HOY'));

    if (dia.evaluado) {
      cartaHoy.append(
        h('p.diario-cerrado', 'Dia cerrado · ' + cHoy.hechas + ' de ' + cHoy.total + ' · ' + cHoy.pct + '%'),
        ...dia.actividades.map(a => filaActividad(dia, a, { editable: false, alCambiar: () => {} })));
      // solo-ver: sin palomitas activas
      for (const b of cartaHoy.querySelectorAll('.dia-check')) b.disabled = true;
    } else {
      if (dia.actividades.length) {
        cartaHoy.append(...dia.actividades.map(a => filaActividad(dia, a, { editable: true, puedeEditar, alCambiar: pintar })));
        cartaHoy.append(barraAvance(dia));
      } else {
        cartaHoy.append(h('p.pista', 'Anota tus actividades de hoy para empezar. Las puedes ir marcando durante el dia.'));
      }

      const entrada = h('input.dia-entrada', { type: 'text', placeholder: 'Nueva actividad…', maxLength: 200 });
      const forma = h('form.dia-agregar', {
        onsubmit: async (ev) => {
          ev.preventDefault();
          const texto = entrada.value.trim();
          if (!texto) return;
          dia.actividades.push({ id: db.nuevoId(), texto, hecha: false });
          await db.diaGuardar(dia);
          pintar();
        },
      }, entrada, h('button.btn.btn--primario', { type: 'submit' }, 'AGREGAR'));
      cartaHoy.append(forma);

      if (dia.actividades.length) {
        cartaHoy.append(h('button.btn.btn--fantasma.dia-cerrar', {
          type: 'button',
          onclick: async () => {
            const c = conteo(dia);
            const ok = await confirmar(
              '¿Cerrar el dia con ' + c.hechas + ' de ' + c.total + ' completadas (' + c.pct + '%)? Ya no podras cambiarlo.',
              { textoOk: 'Cerrar el dia', peligro: false });
            if (!ok) return;
            dia.evaluado = true;
            await db.diaGuardar(dia);
            aviso('Dia cerrado: ' + c.pct + '%');
            pintar();
          },
        }, '✅  CERRAR EL DIA'));
      }
    }
    cont.append(cartaHoy);

    /* ── SEMANA ACTUAL (Lun-Dom, por actividades totales) ── */
    const lunes = lunesDe(hoyClave);
    const porFecha = {};
    for (const d of todos) porFecha[d.fecha] = d;

    const cartaSem = h('section.diario-carta');
    cartaSem.append(h('h3', 'ESTA SEMANA'));
    let sHechas = 0;
    let sTotal = 0;
    for (let n = 0; n < 7; n++) {
      const f = sumarDias(lunes, n);
      const d = porFecha[f];
      const c = conteo(d);
      sHechas += c.hechas;
      sTotal += c.total;
      let estado;
      if (!d || !c.total) estado = f > hoyClave ? '' : '—';
      else estado = c.hechas + ' de ' + c.total + (d.evaluado || f < hoyClave ? ' · ' + c.pct + '%' : '');
      cartaSem.append(h('div.sem-fila' + (f === hoyClave ? '.sem-fila--hoy' : ''),
        h('span', nombreDia(f)),
        h('span.sem-dato', estado)));
    }
    const pctSem = sTotal ? Math.round(sHechas * 100 / sTotal) : 0;
    cartaSem.append(
      h('div.dia-barra.sem-barra', h('i', { style: { width: pctSem + '%' } })),
      h('p.sem-total', sTotal
        ? 'SEMANA: ' + sHechas + ' de ' + sTotal + ' actividades · ' + pctSem + '%'
        : 'Aun no hay actividades esta semana.'),
      h('p.pista', 'La semana cuenta actividades totales, no promedia dias: si un dia te fue mal, te recuperas completando mas al siguiente.'));
    cont.append(cartaSem);

    /* ── SEMANAS ANTERIORES ── */
    const porSemana = {};
    for (const d of todos) {
      if (lunesDe(d.fecha) === lunes) continue;   // la actual ya se mostro
      const l = lunesDe(d.fecha);
      if (!porSemana[l]) porSemana[l] = { hechas: 0, total: 0 };
      const c = conteo(d);
      porSemana[l].hechas += c.hechas;
      porSemana[l].total += c.total;
    }
    const semanas = Object.keys(porSemana).sort().reverse().slice(0, 8);
    if (semanas.length) {
      const cartaHist = h('section.diario-carta');
      cartaHist.append(h('h3', 'SEMANAS ANTERIORES'));
      for (const l of semanas) {
        const s = porSemana[l];
        const pct = s.total ? Math.round(s.hechas * 100 / s.total) : 0;
        cartaHist.append(h('div.sem-fila',
          h('span', nombreDia(l) + ' – ' + nombreDia(sumarDias(l, 6))),
          h('span.sem-dato', s.hechas + ' de ' + s.total + ' · ' + pct + '%')));
      }
      cont.append(cartaHist);
    }
  };

  await pintar();
}
