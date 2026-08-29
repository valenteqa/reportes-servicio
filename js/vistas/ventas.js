// Ventas: aqui NO hay diario. El tablero es GLOBAL, por cliente, SEDE y
// oportunidad de venta, ordenado por fecha de seguimiento y prioridad.
// Una oportunidad NACE con su primera accion (sin accion no se guarda);
// cada nueva accion se vuelve el estatus vigente, y cada seguimiento
// vencido registra un ATRASO automatico (uno por fecha vencida).
// CALIFICACION de la venta = 1 / total de estatus.
//
// Permisos: VER el tablero = solo depto Ventas (o admin); crear/cerrar =
// lider de Ventas o admin; acciones y anotaciones = depto Ventas o admin.
// El DIRECTORIO de clientes lo ven Ventas, Administracion y el admin.
// Los porcentajes del depto siguen siendo publicos en Organizacion.

import { h, aviso, vaciar, confirmar, hoja, campo, campoArea } from '../ui.js';
import * as db from '../db.js';
import { quienSoy, puedeCrearVentas, puedeAccionarVentas, puedeGestionarVentas, veTodasLasVentas, fechaSimulada } from '../organizacion.js';
import { clientesConocidos } from './servicios.js';

const PRIORIDADES = [
  ['alta',  'ALTA'],
  ['media', 'MEDIA'],
  ['baja',  'BAJA'],
];
const ORDEN_PRIO = { alta: 0, media: 1, baja: 2 };

function fechaClave(d) {
  if (!d) {
    const simulada = fechaSimulada();   // modo prueba: la app vive ahi
    if (simulada) return simulada;
    d = new Date();
  }
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fechaBonita(clave) {
  if (!clave) return 'sin fecha';
  const d = new Date(clave + 'T12:00:00');
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
}

function fechaDeTs(ts) {
  return ts ? fechaBonita(fechaClave(new Date(ts))) : 'sin fecha';
}

function veTablero(yo) {
  return !!yo && (yo.rol === 'admin' || yo.depto === 'Ventas');
}

function veDirectorio(yo) {
  return !!yo && (yo.rol === 'admin' || yo.depto === 'Ventas' || yo.depto === 'Administracion');
}

/* ---------------------------------------------------------------- */
/* Fuentes globales: clientes, sedes y contactos                     */
/* ---------------------------------------------------------------- */

// La base de clientes es GLOBAL: los conocidos por toda la app (mismo
// catalogo que el asistente de Servicio) + los ya usados en ventas.
async function clientesGlobales() {
  const vistos = new Map();
  try {
    for (const c of await clientesConocidos()) vistos.set(c.toLowerCase(), c);
  } catch (e) { /* sin catalogo */ }
  try {
    for (const v of await db.ventasTodas()) {
      if (v.cliente && !vistos.has(v.cliente.toLowerCase())) vistos.set(v.cliente.toLowerCase(), v.cliente);
    }
  } catch (e) { /* sin ventas */ }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

// Sedes conocidas de un cliente: las plantas del catalogo global (modulo
// Tecnico) + las sedes ya usadas en sus ventas.
async function sedesDe(cliente) {
  const clave = (cliente || '').trim().toLowerCase();
  const vistos = new Map();
  const ver = (s) => { const t = (s || '').trim(); if (t && !vistos.has(t.toLowerCase())) vistos.set(t.toLowerCase(), t); };
  try {
    for (const m of await db.maquinasCatalogo()) {
      if ((m.cliente || '').trim().toLowerCase() === clave) ver(m.planta);
    }
  } catch (e) { /* sin catalogo */ }
  try {
    for (const v of await db.ventasTodas()) {
      if ((v.cliente || '').trim().toLowerCase() === clave) ver(v.sede);
    }
  } catch (e) { /* sin ventas */ }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

// Contactos del cliente EN ESA SEDE (los contactos dependen de la sede).
async function contactosDe(cliente, sede) {
  const cl = (cliente || '').trim().toLowerCase();
  const sd = (sede || '').trim().toLowerCase();
  const vistos = new Map();
  const ver = (c) => { if (c && !vistos.has(c.toLowerCase())) vistos.set(c.toLowerCase(), c); };
  try {
    for (const v of await db.ventasTodas()) {
      if ((v.cliente || '').trim().toLowerCase() !== cl) continue;
      if (sd && (v.sede || '').trim().toLowerCase() !== sd) continue;
      ver(v.contacto);
      for (const e of (v.historial || [])) ver(e.contacto);
    }
  } catch (e) { /* sin ventas */ }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

// TODOS los contactos de la organizacion, con su cliente y sede (para
// "ver lista de contactos global": un contacto de otro cliente puede
// servir, p. ej. si tiene una pieza que le sirve al actual).
async function contactosGlobales() {
  const vistos = new Map();
  try {
    for (const v of await db.ventasTodas()) {
      const ver = (c) => {
        if (!c) return;
        const clave = c.toLowerCase() + '|' + (v.cliente || '').toLowerCase() + '|' + (v.sede || '').toLowerCase();
        if (!vistos.has(clave)) vistos.set(clave, { nombre: c, cliente: v.cliente || '', sede: v.sede || '' });
      };
      ver(v.contacto);
      for (const e of (v.historial || [])) ver(e.contacto);
    }
  } catch (e) { /* sin ventas */ }
  return [...vistos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/* ---------------------------------------------------------------- */
/* Calculo                                                           */
/* ---------------------------------------------------------------- */

function calificacion(v) {
  const n = (v.historial || []).length || 1;
  return Math.round(100 / n);
}

function estatusActual(v) {
  const hist = v.historial || [];
  return hist.length ? hist[hist.length - 1].texto : '';
}

// El contacto "vigente" es el de la accion mas reciente que tenga uno
// (las ventas viejas con contacto de oportunidad tambien cuentan).
function contactoVigente(v) {
  const hist = v.historial || [];
  for (let k = hist.length - 1; k >= 0; k--) {
    if (hist[k].contacto) return hist[k].contacto;
  }
  return v.contacto || '';
}

// Un ATRASO automatico por cada fecha de seguimiento vencida sin accion.
async function registrarAtrasos(ventas) {
  const hoy = fechaClave();
  for (const v of ventas) {
    if (v.cerrada || !v.fechaSeguimiento || v.fechaSeguimiento >= hoy) continue;
    const ya = (v.historial || []).some(e => e.tipo === 'atraso' && e.porFecha === v.fechaSeguimiento);
    if (ya) continue;
    v.historial.push({
      ts: db.marcaDeTiempo(), fecha: hoy, tipo: 'atraso', porFecha: v.fechaSeguimiento,
      texto: 'ATRASO: seguimiento vencido el ' + fechaBonita(v.fechaSeguimiento),
    });
    await db.ventaGuardar(v);
  }
}

/* ---------------------------------------------------------------- */
/* Formularios                                                       */
/* ---------------------------------------------------------------- */

// Asistente CALCADO del de Servicio (consistencia): paso 1 el cliente en
// cuadricula, paso 2 la SEDE del cliente (los contactos dependen de ella),
// paso 3 los datos de la oportunidad, con la miga de lo elegido.
function hojaNuevaOportunidad(clientes) {
  return hoja('💼  Nueva oportunidad', (cerrar) => {
    const sel = { cliente: '', sede: '' };
    let sedes = [];
    let i = 0;
    const TOTAL = 3;
    const cont = h('div.asistente');
    const poner = (...nodos) => cont.replaceChildren(...nodos.filter(Boolean));

    const cabeza = (titulo) => h('div.asistente__cab',
      h('div.asistente__fila',
        i > 0 ? h('button.icono-btn', { type: 'button', 'aria-label': 'Paso anterior',
          onclick: () => { i -= 1; pintarPaso(); } }, '←') : null,
        h('div.crece',
          h('p.asistente__paso', 'PASO ' + (i + 1) + ' / ' + TOTAL),
          h('h3.asistente__titulo', titulo)
        )
      ),
      i > 0 ? h('p.asistente__miga', [sel.cliente, sel.sede].filter(Boolean).join(' · ')) : null
    );

    const elegirCliente = async (nombre) => {
      sel.cliente = nombre;
      sedes = await sedesDe(nombre);
      i = 1;
      pintarPaso();
    };

    function pintarEntrada(titulo, placeholder, opciones, alContinuar, omitible) {
      const entrada = h('input.campo__entrada', { type: 'text', placeholder });
      poner(
        cabeza(titulo),
        entrada,
        h('div.hoja__acciones',
          opciones.length
            ? h('button.btn.btn--fantasma', { type: 'button', onclick: () => pintarPaso() }, 'Ver opciones')
            : (omitible
              ? h('button.btn.btn--fantasma', { type: 'button', onclick: () => alContinuar('') }, 'Omitir')
              : h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar')),
          h('button.btn.btn--primario', {
            type: 'button',
            onclick: () => {
              const v = entrada.value.trim();
              if (!v && !omitible) return;
              alContinuar(v);
            }
          }, 'Continuar')
        )
      );
      setTimeout(() => entrada.focus(), 80);
    }

    function pintarPaso() {
      if (i === 0) {
        if (!clientes.length) return pintarEntrada('Cliente', 'Cliente', clientes, (v) => { if (v) elegirCliente(v); }, false);
        poner(
          cabeza('Cliente'),
          h('button.asistente__nuevo', {
            type: 'button',
            onclick: () => pintarEntrada('Cliente', 'Cliente', clientes, (v) => { if (v) elegirCliente(v); }, false)
          }, '＋  Agregar cliente'),
          h('div.asistente__rejilla',
            clientes.map(o => h('button.asistente__op', { type: 'button', onclick: () => elegirCliente(o) }, o))),
          h('div.hoja__acciones',
            h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'))
        );
        return;
      }

      if (i === 1) {
        const continuarSede = (v) => { sel.sede = v; i = 2; pintarPaso(); };
        // "N/A" siempre disponible (clientes donde la sede no aplica); por
        // eso la cuadricula existe aunque no haya sedes conocidas.
        poner(
          cabeza('Sede'),
          h('button.asistente__nuevo', {
            type: 'button',
            onclick: () => pintarEntrada('Sede', 'Sede / planta del cliente', ['N/A', ...sedes], continuarSede, true)
          }, '＋  Agregar sede'),
          h('div.asistente__rejilla',
            h('button.asistente__op', { type: 'button', onclick: () => continuarSede('N/A') }, 'N/A'),
            sedes.map(o => h('button.asistente__op', { type: 'button', onclick: () => continuarSede(o) }, o))),
          h('div.hoja__acciones',
            h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
            h('button.btn.btn--fantasma', { type: 'button', onclick: () => continuarSede('') }, 'Omitir'))
        );
        return;
      }

      const cTitulo = campo('Oportunidad', { maxLength: 160, placeholder: 'p. ej. Refacciones para H400' });
      const selPrio = h('select.org-select', ...PRIORIDADES.map(([v, n]) => h('option', { value: v }, n)));
      const cFecha = campo('Fecha compromiso', { type: 'date', value: fechaClave() });
      poner(
        cabeza('La oportunidad'),
        cTitulo,
        h('label.campo', h('span.campo__etiqueta', 'Prioridad'), selPrio),
        cFecha,
        h('div.hoja__acciones',
          h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
          h('button.btn.btn--primario', {
            type: 'button',
            onclick: () => {
              const titulo = cTitulo.querySelector('input').value.trim();
              if (!titulo) { aviso('Describe la oportunidad.', 'error'); return; }
              cerrar({
                cliente: sel.cliente, sede: sel.sede, titulo,
                prioridad: selPrio.value,
                fechaSeguimiento: cFecha.querySelector('input').value || '',
              });
            },
          }, 'Continuar'))
      );
      setTimeout(() => { const e = cTitulo.querySelector('input'); if (e) e.focus(); }, 80);
    }

    pintarPaso();
    return cont;
  });
}

// Anotaciones: datos importantes, tips, señas del cliente. NO son estatus:
// no cuentan para la calificacion.
function hojaNuevaAnotacion(v) {
  return hoja('💡  Nueva anotacion', (cerrar) => {
    const cTexto = campoArea('Dato importante, tip, seña…', { maxLength: 400 });
    return h('div',
      h('p.pista', v.cliente + (v.sede ? ' · ' + v.sede : '') + ' · ' + v.titulo),
      cTexto,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => {
            const texto = cTexto.querySelector('textarea, input').value.trim();
            if (!texto) { aviso('Escribe la anotacion.', 'error'); return; }
            cerrar(texto);
          },
        }, 'Guardar')));
  });
}

// El CONTACTO es POR ACCION y se elige IGUAL que el cliente: cuadricula de
// los contactos de ESTE cliente y sede + "＋ Agregar", con OMITIR, y el
// boton "VER LISTA DE CONTACTOS GLOBAL" para tomar uno de otro cliente.
function hojaNuevaAccion(v, contactos, globales) {
  return hoja('✚  Nueva accion', (cerrar) => {
    const sel = { contacto: '' };
    let i = 0;
    let modoGlobal = false;
    const TOTAL = 2;
    const cont = h('div.asistente');
    const poner = (...nodos) => cont.replaceChildren(...nodos.filter(Boolean));

    const cabeza = (titulo) => h('div.asistente__cab',
      h('div.asistente__fila',
        i > 0 ? h('button.icono-btn', { type: 'button', 'aria-label': 'Paso anterior',
          onclick: () => { i = 0; pintarPaso(); } }, '←') : null,
        h('div.crece',
          h('p.asistente__paso', 'PASO ' + (i + 1) + ' / ' + TOTAL),
          h('h3.asistente__titulo', titulo)
        )
      ),
      i > 0
        ? h('p.asistente__miga', [v.cliente, v.sede].filter(Boolean).join(' · ') + (sel.contacto ? ' · 👤 ' + sel.contacto : ''))
        : h('p.asistente__miga', [v.cliente, v.sede].filter(Boolean).join(' · ') + ' · ' + v.titulo)
    );

    const avanzar = () => { i = 1; pintarPaso(); };

    function pintarEntradaContacto() {
      const entrada = h('input.campo__entrada', { type: 'text', placeholder: 'Contacto (a quien viste o veras)' });
      poner(
        cabeza('Contacto'),
        entrada,
        h('div.hoja__acciones',
          (contactos.length || globales.length)
            ? h('button.btn.btn--fantasma', { type: 'button', onclick: () => pintarPaso() }, 'Ver opciones')
            : h('button.btn.btn--fantasma', { type: 'button', onclick: () => { sel.contacto = ''; avanzar(); } }, 'Omitir'),
          h('button.btn.btn--primario', {
            type: 'button',
            onclick: () => { sel.contacto = entrada.value.trim(); avanzar(); }
          }, 'Continuar')
        )
      );
      setTimeout(() => entrada.focus(), 80);
    }

    function pintarPaso() {
      if (i === 0) {
        if (!contactos.length && !globales.length) return pintarEntradaContacto();
        const rejilla = modoGlobal
          ? globales.map(g => h('button.asistente__op', {
            type: 'button',
            onclick: () => { sel.contacto = g.nombre; avanzar(); }
          }, g.nombre, h('span.venta-op__seña', [g.cliente, g.sede].filter(Boolean).join(' · '))))
          : contactos.map(o => h('button.asistente__op', {
            type: 'button',
            onclick: () => { sel.contacto = o; avanzar(); }
          }, o));
        poner(
          cabeza(modoGlobal ? 'Contacto (global)' : 'Contacto'),
          h('button.asistente__nuevo', { type: 'button', onclick: () => pintarEntradaContacto() },
            '＋  Agregar contacto'),
          rejilla.length ? h('div.asistente__rejilla', rejilla)
            : h('p.pista', modoGlobal ? 'Aun no hay contactos en la organizacion.' : 'Sin contactos de este cliente y sede.'),
          globales.length ? h('button.btn.btn--fantasma.venta-btn-mini', {
            type: 'button',
            onclick: () => { modoGlobal = !modoGlobal; pintarPaso(); },
          }, modoGlobal ? '👤  VER CONTACTOS DE ESTE CLIENTE' : '🌐  VER LISTA DE CONTACTOS GLOBAL') : null,
          h('div.hoja__acciones',
            h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
            h('button.btn.btn--fantasma', { type: 'button', onclick: () => { sel.contacto = ''; avanzar(); } }, 'Omitir'))
        );
        return;
      }
      const cTexto = campo('¿Que se hizo? (nuevo estatus)', { maxLength: 240 });
      const cFecha = campo('Fecha compromiso', { type: 'date', value: '' });
      poner(
        cabeza('La accion'),
        cTexto, cFecha,
        h('div.hoja__acciones',
          h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
          h('button.btn.btn--primario', {
            type: 'button',
            onclick: () => {
              const texto = cTexto.querySelector('input').value.trim();
              if (!texto) { aviso('Describe la accion.', 'error'); return; }
              cerrar({ texto, fecha: cFecha.querySelector('input').value || '', contacto: sel.contacto });
            },
          }, 'Guardar'))
      );
      setTimeout(() => { const e = cTexto.querySelector('input'); if (e) e.focus(); }, 80);
    }

    pintarPaso();
    return cont;
  });
}

/* ---------------------------------------------------------------- */
/* Edicion (SOLO lider de Ventas o admin: "poder cambiar todo")      */
/* ---------------------------------------------------------------- */

function hojaEditarOportunidad(v) {
  return hoja('✎  Editar oportunidad', (cerrar) => {
    const cCliente = campo('Cliente', { maxLength: 80, value: v.cliente || '' });
    const cSede = campo('Sede', { maxLength: 80, value: v.sede || '' });
    const cTitulo = campo('Oportunidad', { maxLength: 160, value: v.titulo || '' });
    const selPrio = h('select.org-select',
      ...PRIORIDADES.map(([val, n]) => h('option', { value: val, selected: v.prioridad === val }, n)));
    const cFecha = campo('Fecha compromiso', { type: 'date', value: v.fechaSeguimiento || '' });
    return h('div',
      cCliente, cSede, cTitulo,
      h('label.campo', h('span.campo__etiqueta', 'Prioridad'), selPrio),
      cFecha,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => {
            const cliente = cCliente.querySelector('input').value.trim();
            const titulo = cTitulo.querySelector('input').value.trim();
            if (!cliente || !titulo) { aviso('El cliente y la oportunidad no pueden quedar vacios.', 'error'); return; }
            cerrar({
              cliente,
              sede: cSede.querySelector('input').value.trim(),
              titulo,
              prioridad: selPrio.value,
              fechaSeguimiento: cFecha.querySelector('input').value || '',
            });
          },
        }, 'Guardar')));
  });
}

function hojaEditarAccion(e) {
  return hoja('✎  Editar accion', (cerrar) => {
    const cTexto = campo('Texto del estatus', { maxLength: 240, value: e.texto || '' });
    const cContacto = campo('Contacto', { maxLength: 120, value: e.contacto || '' });
    const cFecha = campo('Fecha compromiso', { type: 'date', value: e.compromiso || '' });
    return h('div',
      cTexto, cContacto, cFecha,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => {
            const texto = cTexto.querySelector('input').value.trim();
            if (!texto) { aviso('El texto no puede quedar vacio.', 'error'); return; }
            cerrar({
              texto,
              contacto: cContacto.querySelector('input').value.trim(),
              compromiso: cFecha.querySelector('input').value || '',
            });
          },
        }, 'Guardar')));
  });
}

function hojaEditarAnotacion(n) {
  return hoja('✎  Editar anotacion', (cerrar) => {
    const cTexto = campoArea('Anotacion', { maxLength: 400 });
    const area = cTexto.querySelector('textarea, input');
    area.value = n.texto || '';
    return h('div',
      cTexto,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => {
            const texto = area.value.trim();
            if (!texto) { aviso('La anotacion no puede quedar vacia.', 'error'); return; }
            cerrar(texto);
          },
        }, 'Guardar')));
  });
}

/* ---------------------------------------------------------------- */
/* Detalle de una oportunidad                                        */
/* ---------------------------------------------------------------- */

async function hojaDetalle(v, permisos, alCambiar) {
  await hoja(v.cliente + (v.sede ? ' · ' + v.sede : ''), (cerrar) => {
    const cuerpo = h('div');
    const pinta = () => {
      const cal = calificacion(v);
      const contacto = contactoVigente(v);
      // OJO: append(null) pinta el texto "null" (h() si filtra nulos);
      // aqui los condicionales entregan null, se filtran antes de anexar.
      const partes = [
        h('p.venta-titulo', v.titulo),
        h('p.venta-meta',
          h('span.venta-prio.venta-prio--' + v.prioridad, v.prioridad.toUpperCase()),
          ' · 📅 Creada: ' + fechaDeTs(v.creado) + (v.cerrada ? ' · CERRADA' : '')),
        v.cerrada ? null : h('p.venta-meta', 'Fecha compromiso: ' + fechaBonita(v.fechaSeguimiento)),
        contacto ? h('p.venta-meta', '👤 Contacto actual: ' + contacto) : null,
        h('p.venta-cal', 'CALIFICACION: ' + cal + '%  (' + (v.historial || []).length + ' estatus)'),
        permisos.gestionar ? h('button.btn.btn--fantasma.venta-btn-mini', {
          type: 'button',
          onclick: async () => {
            const datos = await hojaEditarOportunidad(v);
            if (!datos) return;
            Object.assign(v, datos);
            await db.ventaGuardar(v);
            pinta();
            alCambiar();
          },
        }, '✎  EDITAR OPORTUNIDAD') : null,

        h('h3.venta-h3', 'HISTORIAL DE ACCIONES'),
        h('div.venta-historial',
          ...(v.historial || []).slice().reverse().map(e =>
            h('div.venta-evento' + (e.tipo === 'atraso' ? '.venta-evento--atraso' : ''),
              h('span.venta-evento__fecha', fechaBonita(e.fecha)),
              h('span.venta-evento__texto', e.texto,
                e.contacto ? h('span.venta-evento__contacto', '👤 ' + e.contacto) : null,
                e.compromiso ? h('span.venta-evento__contacto', '📅 Fecha compromiso: ' + fechaBonita(e.compromiso)) : null),
              permisos.gestionar ? h('span.venta-evento__tools',
                h('button.icono-btn.org-mini', {
                  type: 'button', 'aria-label': 'Editar accion',
                  onclick: async () => {
                    const datos = await hojaEditarAccion(e);
                    if (!datos) return;
                    e.texto = datos.texto;
                    e.contacto = datos.contacto;
                    e.compromiso = datos.compromiso;
                    // si es la accion mas reciente, su compromiso es el vigente
                    if (datos.compromiso && v.historial[v.historial.length - 1] === e) {
                      v.fechaSeguimiento = datos.compromiso;
                    }
                    await db.ventaGuardar(v);
                    pinta();
                    alCambiar();
                  },
                }, '✎'),
                h('button.icono-btn.org-mini', {
                  type: 'button', 'aria-label': 'Eliminar accion',
                  onclick: async () => {
                    if (!(await confirmar('¿Eliminar este estatus del historial? La calificacion se recalcula.'))) return;
                    v.historial = v.historial.filter(x => x !== e);
                    await db.ventaGuardar(v);
                    pinta();
                    alCambiar();
                  },
                }, '🗑')) : null))),
        permisos.accionar && !v.cerrada ? h('button.btn.btn--primario.venta-btn', {
          type: 'button',
          onclick: async () => {
            const accion = await hojaNuevaAccion(v, await contactosDe(v.cliente, v.sede), await contactosGlobales());
            if (!accion) return;
            v.historial.push({ ts: db.marcaDeTiempo(), fecha: fechaClave(), tipo: 'estatus', texto: accion.texto, contacto: accion.contacto || '', compromiso: accion.fecha || '' });
            if (accion.fecha) v.fechaSeguimiento = accion.fecha;
            await db.ventaGuardar(v);
            pinta();
            alCambiar();
          },
        }, '✚  AGREGAR ACCION') : null,

        // Divisor grueso: acciones y anotaciones son DOS cosas distintas.
        h('hr.venta-divisor'),

        h('h3.venta-h3', '💡 ANOTACIONES'),
        (v.anotaciones || []).length
          ? h('div.venta-notas',
            (v.anotaciones || []).slice().reverse().map(n =>
              h('div.venta-nota',
                h('span.venta-evento__fecha', fechaBonita(n.fecha)),
                h('span.venta-nota__texto', n.texto),
                permisos.gestionar ? h('span.venta-evento__tools',
                  h('button.icono-btn.org-mini', {
                    type: 'button', 'aria-label': 'Editar anotacion',
                    onclick: async () => {
                      const texto = await hojaEditarAnotacion(n);
                      if (!texto) return;
                      n.texto = texto;
                      await db.ventaGuardar(v);
                      pinta();
                    },
                  }, '✎'),
                  h('button.icono-btn.org-mini', {
                    type: 'button', 'aria-label': 'Eliminar anotacion',
                    onclick: async () => {
                      if (!(await confirmar('¿Eliminar esta anotacion?'))) return;
                      v.anotaciones = v.anotaciones.filter(x => x !== n);
                      await db.ventaGuardar(v);
                      pinta();
                    },
                  }, '🗑')) : null)))
          : h('p.pista', 'Datos importantes, tips, señas del cliente… (no afectan la calificacion)'),
        permisos.accionar ? h('button.btn.btn--fantasma.venta-btn-mini', {
          type: 'button',
          onclick: async () => {
            const texto = await hojaNuevaAnotacion(v);
            if (!texto) return;
            if (!v.anotaciones) v.anotaciones = [];
            v.anotaciones.push({ ts: db.marcaDeTiempo(), fecha: fechaClave(), texto });
            await db.ventaGuardar(v);
            pinta();
          },
        }, '💡  AGREGAR ANOTACION') : null,
        // Cerrar (modificar) es SOLO del lider o el admin; los vendedores
        // agregan pero no tocan lo ya registrado.
        permisos.gestionar && !v.cerrada ? h('button.btn.btn--fantasma.venta-btn', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmar('¿Cerrar la oportunidad "' + v.titulo + '"? Su calificacion queda en ' + calificacion(v) + '%.', { textoOk: 'Cerrar', peligro: false }))) return;
            v.cerrada = true;
            await db.ventaGuardar(v);
            pinta();
            alCambiar();
          },
        }, '✔  CERRAR OPORTUNIDAD') : null,
      ];
      vaciar(cuerpo).append(...partes.filter(Boolean));
    };
    pinta();
    return cuerpo;
  });
}

/* ---------------------------------------------------------------- */
/* Directorio de clientes (Ventas, Administracion y admin)           */
/* ---------------------------------------------------------------- */

async function directorioClientes() {
  const mapa = new Map();
  const asegura = (cliente, sede) => {
    const c = (cliente || '').trim();
    if (!c) return null;
    if (!mapa.has(c.toLowerCase())) mapa.set(c.toLowerCase(), { nombre: c, sedes: new Map() });
    const ent = mapa.get(c.toLowerCase());
    const s = (sede || '').trim();
    if (!ent.sedes.has(s.toLowerCase())) ent.sedes.set(s.toLowerCase(), { nombre: s, contactos: new Map() });
    return ent.sedes.get(s.toLowerCase());
  };
  try {
    for (const m of await db.maquinasCatalogo()) if (m.cliente) asegura(m.cliente, m.planta);
  } catch (e) { /* sin catalogo */ }
  try {
    for (const v of await db.ventasTodas()) {
      if (!v.cliente) continue;
      const sede = asegura(v.cliente, v.sede);
      const ver = (c) => { if (c && sede && !sede.contactos.has(c.toLowerCase())) sede.contactos.set(c.toLowerCase(), c); };
      ver(v.contacto);
      for (const e of (v.historial || [])) ver(e.contacto);
    }
  } catch (e) { /* sin ventas */ }
  return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

async function renderDirectorio(contenedor) {
  const yo = await quienSoy();
  contenedor.append(h('header.cabecera',
    h('div.cabecera__fila',
      h('button.icono-btn', { type: 'button', 'aria-label': 'Volver', onclick: () => history.back() }, '←'),
      h('h1', '📇 Directorio de clientes'),
    )));
  const cont = h('div.contenido.diario');
  contenedor.append(cont);

  if (!veDirectorio(yo)) {
    cont.append(h('div.diario-carta', h('p.pista',
      'El directorio de clientes lo ven Ventas y Administracion. Si te falta depto, pide al administrador que te lo asigne en ⚙.')));
    return;
  }

  const clientes = await directorioClientes();
  if (!clientes.length) {
    cont.append(h('div.diario-carta', h('p.pista', 'Aun no hay clientes dados de alta.')));
    return;
  }

  for (const c of clientes) {
    const carta = h('section.diario-carta');
    carta.append(h('h3', c.nombre));
    const sedes = [...c.sedes.values()].sort((a, b) => (a.nombre || '~').localeCompare(b.nombre || '~', 'es'));
    for (const s of sedes) {
      carta.append(h('p.dir-sede', '📍 ' + (s.nombre || 'Sede sin especificar')));
      const contactos = [...s.contactos.values()].sort((a, b) => a.localeCompare(b, 'es'));
      if (contactos.length) {
        for (const nombre of contactos) carta.append(h('p.dir-contacto', '👤 ' + nombre));
      } else {
        carta.append(h('p.dir-contacto.dir-contacto--vacio', 'Sin contactos registrados.'));
      }
    }
    cont.append(carta);
  }
  cont.append(h('p.pista', 'Los contactos se registran solos con cada accion de venta; las sedes salen del catalogo y de las oportunidades.'));
}

/* ---------------------------------------------------------------- */
/* Tablero                                                           */
/* ---------------------------------------------------------------- */

export async function render(contenedor, refrescar, params = {}) {
  if (params.sub === 'dir') return renderDirectorio(contenedor);

  const yo = await quienSoy();
  const permisos = {
    crear: puedeCrearVentas(yo),
    accionar: puedeAccionarVentas(yo),
    gestionar: puedeGestionarVentas(yo),
  };
  // Caja cerrada: el vendedor solo ve SUS oportunidades; el lider (y el
  // admin) ven todas las cajas.
  const veTodas = veTodasLasVentas(yo);

  contenedor.append(h('header.cabecera',
    h('div.cabecera__fila',
      h('button.icono-btn', { type: 'button', 'aria-label': 'Volver', onclick: () => history.back() }, '←'),
      h('h1', '💼 Ventas'),
      h('span.diario-fecha', veTodas ? 'todas las cajas' : 'mi caja de ventas')
    )));
  const cont = h('div.contenido.diario');
  contenedor.append(cont);

  // Las oportunidades SOLO las ve el equipo de Ventas (y el admin); los
  // porcentajes del depto siguen siendo publicos en Organizacion.
  if (!veTablero(yo)) {
    cont.append(h('div.diario-carta', h('p.pista',
      'Las oportunidades de venta solo las ve el equipo de Ventas. El estatus del depto esta en 🏢 Organizacion.')));
    return;
  }

  let filtroCliente = '';
  let filtroVendedor = '';

  const pintar = async () => {
    const todasLasVentas = await db.ventasTodas();
    await registrarAtrasos(todasLasVentas);
    vaciar(cont);

    // Filtrado de caja: lo visible para quien mira.
    const ventas = todasLasVentas.filter(v => veTodas || (yo && v.duenoId === yo.id));

    const clientes = [...new Set(ventas.map(v => v.cliente))].sort((a, b) => a.localeCompare(b));

    // Filtro por cliente + alta (solo lider/admin)
    const selFiltro = h('select.org-select.venta-filtro',
      h('option', { value: '' }, 'Todos los clientes'),
      ...clientes.map(c => h('option', { value: c, selected: filtroCliente === c }, c)));
    selFiltro.onchange = () => { filtroCliente = selFiltro.value; pintar(); };
    cont.append(h('div.gd-nav',
      selFiltro,
      permisos.crear ? h('button.btn.btn--primario', {
        type: 'button',
        onclick: async () => {
          const datos = await hojaNuevaOportunidad(await clientesGlobales());
          if (!datos) return;
          // La PRIMERA ACCION es OBLIGATORIA: sin ella no se guarda nada.
          const previa = { cliente: datos.cliente, sede: datos.sede, titulo: datos.titulo };
          const accion = await hojaNuevaAccion(previa,
            await contactosDe(datos.cliente, datos.sede), await contactosGlobales());
          if (!accion) {
            aviso('Sin una primera accion no se guarda la oportunidad.', 'error');
            return;
          }
          const v = {
            id: db.nuevoId(), ...datos, cerrada: false, creado: db.marcaDeTiempo(),
            duenoId: yo ? yo.id : '', dueno: yo ? yo.nombre : '',
            anotaciones: [],
            historial: [{ ts: db.marcaDeTiempo(), fecha: fechaClave(), tipo: 'estatus', texto: accion.texto, contacto: accion.contacto || '', compromiso: accion.fecha || '' }],
          };
          if (accion.fecha) v.fechaSeguimiento = accion.fecha;
          await db.ventaGuardar(v);
          // cliente y sede nuevos → al catalogo global de toda la app
          try { await db.maquinaRecordar({ cliente: datos.cliente, planta: datos.sede }); } catch (e) { /* opcional */ }
          await pintar();
          // directo al menu de acciones y anotaciones de la recien creada
          hojaDetalle(v, permisos, pintar);
        },
      }, '✚  NUEVA') : null));

    // Filtro por VENDEDOR (solo la vista del lider ve todas las cajas).
    if (veTodas) {
      const duenos = [...new Set(ventas.map(v => v.dueno).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      const haySinDueno = ventas.some(v => !v.dueno);
      const selVendedor = h('select.org-select.venta-filtro',
        h('option', { value: '' }, 'Todos los vendedores'),
        ...duenos.map(d => h('option', { value: d, selected: filtroVendedor === d }, d)),
        haySinDueno ? h('option', { value: '__sin__', selected: filtroVendedor === '__sin__' }, 'Sin vendedor') : null);
      selVendedor.onchange = () => { filtroVendedor = selVendedor.value; pintar(); };
      cont.append(h('div.gd-nav', selVendedor));
    }

    cont.append(h('button.btn.btn--fantasma.venta-abrir', {
      type: 'button', onclick: () => { location.hash = '#/d/ventas/dir'; },
    }, '📇  DIRECTORIO DE CLIENTES'));

    let lista = ventas.filter(v => !filtroCliente || v.cliente === filtroCliente);
    if (veTodas && filtroVendedor) {
      lista = lista.filter(v => filtroVendedor === '__sin__' ? !v.dueno : v.dueno === filtroVendedor);
    }
    // Orden: abiertas primero por fecha de seguimiento y luego prioridad;
    // cerradas al final.
    lista.sort((a, b) => {
      if (!!a.cerrada !== !!b.cerrada) return a.cerrada ? 1 : -1;
      const fa = a.fechaSeguimiento || '9999';
      const fb = b.fechaSeguimiento || '9999';
      if (fa !== fb) return fa < fb ? -1 : 1;
      return (ORDEN_PRIO[a.prioridad] || 1) - (ORDEN_PRIO[b.prioridad] || 1);
    });

    const abiertas = lista.filter(v => !v.cerrada);
    if (abiertas.length) {
      const prom = Math.round(abiertas.reduce((s, v) => s + calificacion(v), 0) / abiertas.length);
      cont.append(h('p.sem-total', abiertas.length + ' abierta' + (abiertas.length === 1 ? '' : 's') + ' · calificacion promedio ' + prom + '%'));
    }

    if (!lista.length) {
      cont.append(h('div.diario-carta', h('p.pista', filtroCliente
        ? 'Sin oportunidades de este cliente.'
        : (permisos.crear
          ? 'Aun no hay oportunidades de venta. Crea la primera con ✚ NUEVA.'
          : 'Aun no hay oportunidades de venta. Las crea el lider de Ventas.'))));
      return;
    }

    const hoy = fechaClave();
    const tarjeta = (v) => {
      const vencida = !v.cerrada && v.fechaSeguimiento && v.fechaSeguimiento < hoy;
      return h('button.venta-carta' + (v.cerrada ? '.venta-carta--cerrada' : ''), {
        type: 'button',
        onclick: () => hojaDetalle(v, permisos, pintar),
      },
        h('div.venta-carta__fila',
          h('span.venta-prio.venta-prio--' + v.prioridad, v.prioridad.toUpperCase()),
          h('span.venta-cliente', v.cliente + (v.sede ? ' · ' + v.sede : '')),
          h('span.venta-cal', calificacion(v) + '%')),
        h('p.venta-titulo', v.titulo),
        h('p.venta-meta', '📅 Creada: ' + fechaDeTs(v.creado),
          v.cerrada ? ' · CERRADA' : h('span' + (vencida ? '.venta-vencida' : ''),
            ' · ' + (vencida ? '⚠ vencida · ' : '') + 'Fecha compromiso: ' + fechaBonita(v.fechaSeguimiento))),
        h('p.venta-meta',
          contactoVigente(v) ? '👤 ' + contactoVigente(v) + ' · ' : '',
          h('span.venta-estatus', estatusActual(v)))
      );
    };

    if (!veTodas) {
      for (const v of lista) cont.append(tarjeta(v));
      return;
    }

    // Vista del lider: AGRUPADAS por vendedor (sin dueño al final).
    const grupos = new Map();
    for (const v of lista) {
      const clave = v.dueno || 'Sin vendedor';
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(v);
    }
    const nombres = [...grupos.keys()].sort((a, b) =>
      (a === 'Sin vendedor') - (b === 'Sin vendedor') || a.localeCompare(b, 'es'));
    for (const nombre of nombres) {
      const suyas = grupos.get(nombre);
      const abiertasG = suyas.filter(v => !v.cerrada);
      const promG = abiertasG.length
        ? Math.round(abiertasG.reduce((s, v) => s + calificacion(v), 0) / abiertasG.length)
        : null;
      cont.append(h('h3.venta-grupo', '🧑‍🔧 ' + nombre,
        h('span.sem-dato', abiertasG.length + ' abierta' + (abiertasG.length === 1 ? '' : 's') + (promG !== null ? ' · ' + promG + '%' : ''))));
      for (const v of suyas) cont.append(tarjeta(v));
    }
  };

  await pintar();
}
