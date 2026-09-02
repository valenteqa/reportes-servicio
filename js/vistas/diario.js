// Diario: ACTIVIDADES DIARIAS de cada quien. Cada quien anota su lista,
// la va marcando durante el dia y al cerrarlo queda su porcentaje. Un dia
// ANTERIOR sin evaluar bloquea la app completa (candado) hasta marcarlo.
// La semana se evalua por ACTIVIDADES TOTALES completadas — no promediando
// dias — para que un mal dia se recupere completando mas al siguiente.
//
// VENTAS (regla de Vale, 1 sep 2026): sus integrantes entran aqui y un
// MENU AUXILIAR los manda a "Actividades diarias" o a "Objetivos de
// Ventas" (dos paginas distintas). Cada actividad puede ligarse — es
// opcional — a un objetivo de venta abierto; eso sustituyo al ciclo de
// acciones que vivia en el objetivo.
// ESTILO: el mismo de Ventas (cabecera, titulos de grupo, cuadros con el
// corte de la casa, hojas para capturar, gafete flotante de seccion).
//
// Cada dia lleva usuarioId/usuario: cuando los dias de OTROS telefonos
// lleguen por el Excel intermediario, se sabra de quien es cada uno.

import { h, aviso, vaciar, confirmar, hoja, campo } from '../ui.js';
import * as db from '../db.js';
import { DEPTOS, ROLES, organizacion, quienSoy, esAdmin, puedeEditarActividades, puedeVerActividadesDe, AVISO_SOLO_LIDER, fechaSimulada } from '../organizacion.js';
import { objetivosParaActividades, hojaElegirObjetivo, etiquetaObjetivo, montarGafete } from './ventas.js';

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

function textoConteo(c) {
  return c.hechas + ' de ' + c.total + ' · ' + c.pct + '%';
}

// El dia sabe de quien es (para la nube); se sella al guardar.
function sellarDia(dia, yo) {
  if (!yo) return;
  if (!dia.usuarioId) dia.usuarioId = yo.id;
  if (!dia.usuario) dia.usuario = yo.nombre;
}

async function guardarDia(dia, yo) {
  sellarDia(dia, yo);
  await db.diaGuardar(dia);
}

// Solo Ventas (y el admin) ligan actividades a objetivos de venta.
function ligaObjetivos(yo) {
  return !!yo && (yo.depto === 'Ventas' || esAdmin(yo));
}

/* ---------------------------------------------------------------- */
/* Piezas compartidas                                                */
/* ---------------------------------------------------------------- */

// Hoja de captura de una actividad (nueva o cambiar): el texto y, para
// Ventas, el objetivo de venta al que pertenece (opcional, por submenu
// de cuadricula — mismo patron que cliente/sede en Ventas).
function hojaActividad(titulo, inicial, objetivos) {
  return hoja(titulo, (cerrar) => {
    const c = campo('Actividad', {
      value: inicial.texto || '', maxLength: 200,
      placeholder: 'p. ej. Llamar a Kimex por la cotizacion',
    });
    let elegido = inicial.ventaId ? (objetivos || []).find(v => v.id === inicial.ventaId) || null : null;
    let etiqueta = elegido ? etiquetaObjetivo(elegido) : (inicial.ventaId ? inicial.ventaEtiqueta || '' : '');
    const valor = h('span.crece', etiqueta || 'Sin objetivo de venta');
    const btnObjetivo = objetivos ? h('button.org-select.venta-edit-sel', {
      type: 'button',
      onclick: async () => {
        const r = await hojaElegirObjetivo(objetivos, elegido ? elegido.id : (inicial.ventaId || ''));
        if (r === null) return;
        elegido = r || null;
        etiqueta = r ? etiquetaObjetivo(r) : '';
        valor.textContent = etiqueta || 'Sin objetivo de venta';
        if (!r) inicial = { ...inicial, ventaId: '' };
      },
    }, valor, h('span', '▾')) : null;
    return h('div',
      c,
      objetivos ? h('label.campo', h('span.campo__etiqueta', 'Objetivo de venta (opcional)'), btnObjetivo) : null,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => {
            const texto = c.querySelector('input').value.trim();
            if (!texto) { aviso('Escribe la actividad.', 'error'); return; }
            cerrar({
              texto,
              ventaId: elegido ? elegido.id : (etiqueta ? inicial.ventaId || '' : ''),
              ventaEtiqueta: etiqueta,
            });
          },
        }, 'Guardar')));
  });
}

// Cuadro de una actividad: palomita, texto (y su objetivo de venta si lo
// tiene) y, si es editable, cambiar/eliminar (solo lider o admin).
function filaActividad(dia, act, o) {
  const palomita = h('button.dia-check' + (act.hecha ? '.dia-check--si' : ''), {
    type: 'button', 'aria-label': act.hecha ? 'Completada' : 'Pendiente',
    onclick: async () => {
      act.hecha = !act.hecha;
      await guardarDia(dia, o.yo);
      o.alCambiar();
    },
  }, act.hecha ? '✔' : '');
  const texto = h('span.dia-texto',
    h('span.dia-texto__t' + (act.hecha ? '.dia-texto--hecha' : ''), act.texto),
    act.ventaEtiqueta ? h('span.dia-objetivo', '💲 ' + act.ventaEtiqueta) : null);
  const fila = h('div.dia-fila', palomita, texto);
  if (o.editable) {
    // Regla de Vale: cambiar o eliminar actividades es SOLO del lider (o
    // admin); al usuario normal se le pide que lo solicite a su lider.
    fila.append(
      h('button.icono-btn.dia-editar', {
        type: 'button', 'aria-label': 'Cambiar actividad',
        onclick: async () => {
          if (!o.puedeEditar) { aviso(AVISO_SOLO_LIDER); return; }
          const r = await hojaActividad('✎  Cambiar actividad', act, o.objetivos);
          if (!r) return;
          Object.assign(act, r);
          await guardarDia(dia, o.yo);
          o.alCambiar();
        },
      }, '✎'),
      h('button.icono-btn.dia-borrar', {
        type: 'button', 'aria-label': 'Eliminar actividad',
        onclick: async () => {
          if (!o.puedeEditar) { aviso(AVISO_SOLO_LIDER); return; }
          if (!(await confirmar('¿Eliminar la actividad "' + act.texto + '"?'))) return;
          dia.actividades = dia.actividades.filter(a => a !== act);
          await guardarDia(dia, o.yo);
          o.alCambiar();
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

// Titulo de seccion con el MISMO formato de grupo de Ventas.
function grupo(titulo, dato) {
  return h('h3.venta-grupo', titulo, dato ? h('span.sem-dato', dato) : null);
}

/* ---------------------------------------------------------------- */
/* Candado: dias anteriores sin evaluar bloquean TODA la app         */
/* ---------------------------------------------------------------- */

async function diasPendientes() {
  const hoy = fechaClave();
  const yo = await quienSoy();
  return (await db.diasTodos())
    .filter(d => d.fecha < hoy && (d.actividades || []).length && !d.evaluado &&
      (!d.usuarioId || !yo || d.usuarioId === yo.id))
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
        h('div.candado-icono', '📋'),
        h('h2', 'Marca tus actividades del ' + nombreDia(dia.fecha)),
        h('p.pista', 'Quedaron sin evaluar. Marca lo que completaste ese dia para seguir usando la app. Lo que falto aun cuenta para la semana: hoy puedes recuperar.'),
        h('div.candado-lista', ...dia.actividades.map(a => filaActividad(dia, a, { editable: false, alCambiar: pinta, yo: null }))),
        barraAvance(dia),
        h('button.btn.btn--primario.candado-btn', {
          type: 'button',
          onclick: async () => {
            dia.evaluado = true;
            await guardarDia(dia, null);
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
let _revisarCandado = null;

export function instalarCandado(alTerminar) {
  const revisar = async () => {
    if (capaCandado) return;
    try {
      const pendientes = await diasPendientes();
      if (pendientes.length) mostrarCandado(pendientes, alTerminar);
    } catch (e) { /* sin datos aun */ }
  };
  _revisarCandado = revisar;
  revisar();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revisar();
  });
}

// Para el Test Mode: al brincar de fecha, el candado se revisa AL MOMENTO.
export function revisarCandado() {
  if (_revisarCandado) _revisarCandado();
}

/* ---------------------------------------------------------------- */
/* Datos por miembro                                                 */
/* ---------------------------------------------------------------- */

// Registros de un usuario: HOY solo este telefono tiene los del dueño;
// los de los demas llegaran con la nube. null = sin datos aqui.
async function diasDe(usuario) {
  const yo = await quienSoy();
  if (yo && usuario.id === yo.id) {
    return (await db.diasTodos()).filter(d => !d.usuarioId || d.usuarioId === yo.id);
  }
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
      h('h1', titulo),
      extra ? h('span.diario-fecha', extra) : null
    ));
}

// clickeable=true abre las actividades del miembro (solo lider de su depto
// o admin); si no, la fila es plana: se ve el PORCENTAJE y nada mas.
function filaMiembro(u, resumen, clickeable) {
  const dato = resumen === null
    ? 'sin datos aqui'
    : (resumen.total ? textoConteo(resumen) : 'sin actividades');
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

function navGestion(yo) {
  return h('div.gd-nav',
    h('button.btn.btn--fantasma', { type: 'button', onclick: () => { location.hash = '#/d/org'; } }, '🏢  ORGANIZACION'),
    h('button.btn.btn--fantasma', { type: 'button', onclick: () => { location.hash = '#/d/depto'; } }, '👥  MI DEPTO'),
    // El directorio de clientes lo ven Ventas (ya lo tienen en su
    // tablero) y Administracion.
    yo && (yo.rol === 'admin' || yo.depto === 'Administracion')
      ? h('button.btn.btn--fantasma', { type: 'button', onclick: () => { location.hash = '#/d/ventas/dir'; } }, '📇  DIRECTORIO')
      : null);
}

/* ---------------------------------------------------------------- */
/* Vista: organizacion completa (todos los deptos)                   */
/* ---------------------------------------------------------------- */

async function renderOrganizacion(contenedor) {
  const org = await organizacion();
  const yoOrg = await quienSoy();
  const lunes = lunesDe(fechaClave());
  contenedor.append(cabeceraSub('🏢 Organizacion', 'semana actual'));
  const cont = h('div.contenido.diario');
  contenedor.append(cont);
  const actualizarGafete = montarGafete(contenedor, cont);

  for (const depto of [...DEPTOS, '']) {
    const miembros = org.usuarios.filter(u => (u.depto || '') === depto);
    if (!miembros.length) continue;
    const filas = [];
    let dHechas = 0;
    let dTotal = 0;
    for (const u of miembros) {
      const dias = await diasDe(u);
      const r = dias === null ? null : resumenSemana(dias, lunes);
      if (r) { dHechas += r.hechas; dTotal += r.total; }
      // En organizacion SOLO porcentajes: las filas no abren actividades.
      filas.push(filaMiembro(u, r, false));
    }
    const pct = dTotal ? Math.round(dHechas * 100 / dTotal) : 0;
    cont.append(
      grupo('🏢 ' + (depto || 'SIN DEPTO ASIGNADO').toUpperCase(),
        dTotal ? dHechas + ' de ' + dTotal + ' · ' + pct + '%' : 'sin actividades aqui'),
      ...filas);
    // Ventas ademas tiene su tablero de OBJETIVOS, que solo ve el equipo
    // de Ventas (y el admin).
    if (depto === 'Ventas' && yoOrg && (yoOrg.rol === 'admin' || yoOrg.depto === 'Ventas')) {
      cont.append(h('button.btn.btn--fantasma.venta-abrir', {
        type: 'button', onclick: () => { location.hash = '#/d/ventas'; },
      }, '💲  Ver objetivos de venta'));
    }
  }
  cont.append(h('p.pista', 'Aqui solo se ven porcentajes. El detalle de actividades de cada quien lo ve su lider de area (en Mi depto) o el administrador.'));
  actualizarGafete();
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
  const filas = [];
  let dHechas = 0;
  let dTotal = 0;
  for (const u of miembros) {
    const dias = await diasDe(u);
    const r = dias === null ? null : resumenSemana(dias, lunes);
    if (r) { dHechas += r.hechas; dTotal += r.total; }
    filas.push(filaMiembro(u, r, puedeVerActividadesDe(yo, u)));
  }
  const pct = dTotal ? Math.round(dHechas * 100 / dTotal) : 0;
  cont.append(
    grupo('👥 ' + depto.toUpperCase() + ' · ESTA SEMANA', dTotal ? dHechas + ' de ' + dTotal + ' · ' + pct + '%' : 'sin actividades'),
    ...filas,
    h('div.dia-barra.sem-barra', h('i', { style: { width: pct + '%' } })),
    h('p.sem-total', dTotal
      ? 'DEPTO: ' + dHechas + ' de ' + dTotal + ' actividades · ' + pct + '%'
      : 'Sin actividades del depto registradas en este telefono.'),
    h('p.pista', 'El depto se evalua igual que la semana: actividades totales completadas entre todos, no promedio.'));
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
  const actualizarGafete = montarGafete(contenedor, cont);
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
    const c = conteo(dHoy);
    cont.append(grupo('📋 HOY', dHoy && dHoy.actividades.length ? textoConteo(c) + (dHoy.evaluado ? ' · cerrado' : '') : 'sin actividades'));
    if (dHoy && dHoy.actividades.length) {
      const filas = dHoy.actividades.map(a => filaActividad(dHoy, a, { editable: false, alCambiar: () => {}, yo: null }));
      for (const f of filas) for (const b of f.querySelectorAll('.dia-check')) b.disabled = true;
      cont.append(...filas);
    } else {
      cont.append(h('p.pista', 'Sin actividades registradas hoy.'));
    }
  }

  // SEMANA
  const r = resumenSemana(dias, lunes);
  cont.append(grupo('📅 ESTA SEMANA', r.total ? textoConteo(r) : 'sin actividades'));
  for (let n = 0; n < 7; n++) {
    const f = sumarDias(lunes, n);
    const c = conteo(porFecha[f]);
    cont.append(h('div.sem-fila' + (f === hoyClave ? '.sem-fila--hoy' : ''),
      h('span', nombreDia(f)),
      h('span.sem-dato', c.total ? textoConteo(c) : (f > hoyClave ? '' : '—'))));
  }
  cont.append(
    h('div.dia-barra.sem-barra', h('i', { style: { width: r.pct + '%' } })),
    h('p.sem-total', r.total ? 'SEMANA: ' + textoConteo(r) : 'Sin actividades esta semana.'));
  actualizarGafete();
}

/* ---------------------------------------------------------------- */
/* Vista: menu auxiliar de Ventas                                    */
/* ---------------------------------------------------------------- */

// Los de Ventas eligen entre sus ACTIVIDADES DIARIAS y los OBJETIVOS DE
// VENTAS (regla de Vale): dos paginas distintas.
function renderMenuVentas(contenedor, yo) {
  contenedor.append(cabeceraSub('📔 Gestion de Deptos', nombreDia(fechaClave())));
  const cont = h('div.contenido.diario');
  contenedor.append(cont);
  const opcion = (icono, texto, ruta) => h('button.menu__boton', {
    type: 'button', onclick: () => { location.hash = ruta; },
  }, h('span.menu__icono', icono), h('span.menu__texto', texto), h('span.menu__flecha', '›'));
  cont.append(
    h('p.diario-quien', 'Tu: ' + yo.nombre + ' · ' + yo.depto),
    h('div.gd-menu',
      opcion('📋', 'Actividades diarias', '#/d/act'),
      opcion('💲', 'Objetivos de Ventas', '#/d/ventas')),
    navGestion(yo));
}

/* ---------------------------------------------------------------- */
/* Vista: mis actividades diarias                                    */
/* ---------------------------------------------------------------- */

async function renderMiDia(contenedor, yo) {
  const hoyClave = fechaClave();
  let dia = await db.diaLeer(hoyClave);
  if (!dia) dia = { fecha: hoyClave, actividades: [], evaluado: false };
  sellarDia(dia, yo);

  const puedeEditar = puedeEditarActividades(yo);
  const esVentas = !!yo && yo.depto === 'Ventas';
  const objetivos = ligaObjetivos(yo) ? await objetivosParaActividades(yo) : null;

  contenedor.append(cabeceraSub('📋 Actividades diarias', nombreDia(hoyClave)));
  const cont = h('div.contenido.diario');
  contenedor.append(cont);
  const actualizarGafete = montarGafete(contenedor, cont);

  const pintar = async () => {
    const todos = (await db.diasTodos())
      .filter(d => !d.usuarioId || !yo || d.usuarioId === yo.id)
      .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    vaciar(cont);

    if (yo) {
      cont.append(h('p.diario-quien', 'Tu: ' + yo.nombre + (yo.depto ? ' · ' + yo.depto : '')));
    } else {
      cont.append(h('p.pista.diario-quien',
        'Este telefono aun no dice de quien es: eligelo en ⚙ Configuracion → Usuarios y deptos. Mientras, cuenta como usuario normal.'));
    }
    // Ventas llega desde su menu auxiliar (ahi esta la navegacion); los
    // demas deptos entran directo aqui.
    if (!esVentas) cont.append(navGestion(yo));

    /* ── HOY ── */
    const cHoy = conteo(dia);
    const opciones = { editable: !dia.evaluado, puedeEditar, alCambiar: pintar, objetivos, yo };
    cont.append(grupo('📋 HOY',
      dia.actividades.length ? textoConteo(cHoy) + (dia.evaluado ? ' · cerrado' : '') : 'sin actividades'));

    if (dia.evaluado) {
      cont.append(h('p.diario-cerrado', 'Dia cerrado · ' + textoConteo(cHoy)));
      const filas = dia.actividades.map(a => filaActividad(dia, a, { ...opciones, editable: false }));
      for (const f of filas) for (const b of f.querySelectorAll('.dia-check')) b.disabled = true;
      cont.append(...filas);
    } else {
      if (dia.actividades.length) {
        cont.append(...dia.actividades.map(a => filaActividad(dia, a, opciones)));
        cont.append(barraAvance(dia));
      } else {
        cont.append(h('p.pista', 'Anota tus actividades de hoy para empezar. Las puedes ir marcando durante el dia.'));
      }
      cont.append(h('button.btn.btn--primario.venta-btn', {
        type: 'button',
        onclick: async () => {
          const r = await hojaActividad('✚  Nueva actividad', {}, objetivos);
          if (!r) return;
          dia.actividades.push({ id: db.nuevoId(), hecha: false, ...r });
          await guardarDia(dia, yo);
          pintar();
        },
      }, '✚  NUEVA ACTIVIDAD'));
      if (dia.actividades.length) {
        cont.append(h('button.btn.btn--fantasma.venta-btn', {
          type: 'button',
          onclick: async () => {
            const c = conteo(dia);
            const ok = await confirmar(
              '¿Cerrar el dia con ' + c.hechas + ' de ' + c.total + ' completadas (' + c.pct + '%)? Ya no podras cambiarlo.',
              { textoOk: 'Cerrar el dia', peligro: false });
            if (!ok) return;
            dia.evaluado = true;
            await guardarDia(dia, yo);
            aviso('Dia cerrado: ' + c.pct + '%');
            pintar();
          },
        }, '✅  CERRAR EL DIA'));
      }
    }

    /* ── SEMANA ACTUAL (Lun-Dom, por actividades totales) ── */
    const lunes = lunesDe(hoyClave);
    const porFecha = {};
    for (const d of todos) porFecha[d.fecha] = d;
    porFecha[hoyClave] = dia;

    let sHechas = 0;
    let sTotal = 0;
    const filasSem = [];
    for (let n = 0; n < 7; n++) {
      const f = sumarDias(lunes, n);
      const d = porFecha[f];
      const c = conteo(d);
      sHechas += c.hechas;
      sTotal += c.total;
      let estado;
      if (!d || !c.total) estado = f > hoyClave ? '' : '—';
      else estado = c.hechas + ' de ' + c.total + (d.evaluado || f < hoyClave ? ' · ' + c.pct + '%' : '');
      filasSem.push(h('div.sem-fila' + (f === hoyClave ? '.sem-fila--hoy' : ''),
        h('span', nombreDia(f)),
        h('span.sem-dato', estado)));
    }
    const pctSem = sTotal ? Math.round(sHechas * 100 / sTotal) : 0;
    cont.append(
      grupo('📅 ESTA SEMANA', sTotal ? sHechas + ' de ' + sTotal + ' · ' + pctSem + '%' : 'sin actividades'),
      ...filasSem,
      h('div.dia-barra.sem-barra', h('i', { style: { width: pctSem + '%' } })),
      h('p.sem-total', sTotal
        ? 'SEMANA: ' + sHechas + ' de ' + sTotal + ' actividades · ' + pctSem + '%'
        : 'Aun no hay actividades esta semana.'),
      h('p.pista', 'La semana cuenta actividades totales, no promedia dias: si un dia te fue mal, te recuperas completando mas al siguiente.'));

    /* ── SEMANAS ANTERIORES (en su hoja, para no saturar la pagina) ── */
    const porSemana = {};
    for (const d of todos) {
      if (lunesDe(d.fecha) === lunes) continue;   // la actual ya se mostro
      const l = lunesDe(d.fecha);
      if (!porSemana[l]) porSemana[l] = { hechas: 0, total: 0 };
      const c = conteo(d);
      porSemana[l].hechas += c.hechas;
      porSemana[l].total += c.total;
    }
    const semanas = Object.keys(porSemana).sort().reverse().slice(0, 12);
    if (semanas.length) {
      cont.append(h('button.btn.btn--fantasma.venta-btn', {
        type: 'button',
        onclick: () => hoja('📜  Semanas anteriores', () => h('div',
          ...semanas.map(l => {
            const s = porSemana[l];
            const pct = s.total ? Math.round(s.hechas * 100 / s.total) : 0;
            return h('div.sem-fila',
              h('span', nombreDia(l) + ' – ' + nombreDia(sumarDias(l, 6))),
              h('span.sem-dato', s.hechas + ' de ' + s.total + ' · ' + pct + '%'));
          }))),
      }, '📜  SEMANAS ANTERIORES (' + semanas.length + ')'));
    }
    actualizarGafete();
  };

  await pintar();
}

/* ---------------------------------------------------------------- */
/* Despachador                                                       */
/* ---------------------------------------------------------------- */

export async function render(contenedor, refrescar, params = {}) {
  if (params.sub === 'org') return renderOrganizacion(contenedor);
  if (params.sub === 'u') return renderMiembro(contenedor, params.id);
  if (params.sub === 'depto') return renderDepto(contenedor);

  const yo = await quienSoy();
  // Ventas: primero el menu auxiliar; sus actividades viven en #/d/act.
  if (params.sub === '' && yo && yo.depto === 'Ventas') return renderMenuVentas(contenedor, yo);
  return renderMiDia(contenedor, yo);
}
