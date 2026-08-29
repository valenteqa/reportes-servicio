// Ventas: aqui NO hay diario. El tablero es GLOBAL, por cliente y
// oportunidad de venta, ordenado por fecha de seguimiento y prioridad.
// Cada oportunidad lleva su HISTORIAL: al crearla nace su primer estatus,
// cada nueva accion se vuelve el estatus vigente, y cada seguimiento
// vencido registra un ATRASO automatico (uno por fecha vencida).
// CALIFICACION de la venta = 1 / total de estatus (menos vueltas y menos
// atrasos = mejor calificacion; una recien creada vale 100%).
//
// Permisos: crear oportunidades = lider de Ventas (Usuario2) o admin;
// registrar acciones = cualquiera del depto Ventas (o admin); ver = todos.

import { h, aviso, vaciar, confirmar, hoja, campo, campoArea } from '../ui.js';
import * as db from '../db.js';
import { quienSoy, puedeCrearVentas, puedeAccionarVentas, fechaSimulada } from '../organizacion.js';
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

// La base de clientes es GLOBAL: los conocidos por toda la app (mismo
// catalogo que el asistente de Servicio) + los ya usados en ventas. Y al
// crear con un cliente nuevo, este se recuerda en el catalogo global.
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

// Asistente de 2 pasos, CALCADO del asistente de Servicio (consistencia):
// paso 1 el cliente en cuadricula de botones con "＋ Agregar cliente";
// paso 2 los datos de la oportunidad, con la miga del cliente elegido.
function hojaNuevaOportunidad(clientes) {
  return hoja('💼  Nueva oportunidad', (cerrar) => {
    const sel = { cliente: '' };
    let i = 0;
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
      i > 0 && sel.cliente ? h('p.asistente__miga', sel.cliente) : null
    );

    function pintarEntradaCliente() {
      const entrada = h('input.campo__entrada', { type: 'text', placeholder: 'Cliente' });
      poner(
        cabeza('Cliente'),
        entrada,
        h('div.hoja__acciones',
          clientes.length
            ? h('button.btn.btn--fantasma', { type: 'button', onclick: () => pintarPaso() }, 'Ver opciones')
            : h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
          h('button.btn.btn--primario', {
            type: 'button',
            onclick: () => {
              const v = entrada.value.trim();
              if (!v) return;
              sel.cliente = v;
              i = 1;
              pintarPaso();
            }
          }, 'Continuar')
        )
      );
      setTimeout(() => entrada.focus(), 80);
    }

    function pintarPaso() {
      if (i === 0) {
        // Sin nada guardado no hay cuadricula que mostrar: directo a escribir.
        if (!clientes.length) return pintarEntradaCliente();
        poner(
          cabeza('Cliente'),
          h('button.asistente__nuevo', { type: 'button', onclick: () => pintarEntradaCliente() },
            '＋  Agregar cliente'),
          h('div.asistente__rejilla',
            clientes.map(o => h('button.asistente__op', {
              type: 'button',
              onclick: () => { sel.cliente = o; i = 1; pintarPaso(); }
            }, o))),
          h('div.hoja__acciones',
            h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'))
        );
        return;
      }
      const cTitulo = campo('Oportunidad', { maxLength: 160, placeholder: 'p. ej. Refacciones para H400' });
      const selPrio = h('select.org-select', ...PRIORIDADES.map(([v, n]) => h('option', { value: v }, n)));
      const cFecha = campo('Proximo seguimiento', { type: 'date', value: fechaClave() });
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
                cliente: sel.cliente, titulo,
                prioridad: selPrio.value,
                fechaSeguimiento: cFecha.querySelector('input').value || '',
              });
            },
          }, 'Crear'))
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
      h('p.pista', v.cliente + ' · ' + v.titulo),
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

// Contactos conocidos del cliente: se juntan de lo ya usado en sus ventas
// (acciones e historico), igual que los clientes se juntan de lo usado.
async function contactosDe(cliente) {
  const vistos = new Map();
  const ver = (c) => { if (c && !vistos.has(c.toLowerCase())) vistos.set(c.toLowerCase(), c); };
  try {
    for (const v of await db.ventasTodas()) {
      if (v.cliente !== cliente) continue;
      ver(v.contacto);
      for (const e of (v.historial || [])) ver(e.contacto);
    }
  } catch (e) { /* sin ventas */ }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

// El CONTACTO es POR ACCION (cada accion puede verse con alguien distinto)
// y se elige IGUAL que el cliente: asistente con cuadricula + "＋ Agregar".
function hojaNuevaAccion(v, contactos) {
  return hoja('✚  Nueva accion', (cerrar) => {
    const sel = { contacto: '' };
    let i = 0;
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
      i > 0 ? h('p.asistente__miga', v.cliente + (sel.contacto ? ' · 👤 ' + sel.contacto : '')) : h('p.asistente__miga', v.cliente + ' · ' + v.titulo)
    );

    const avanzar = () => { i = 1; pintarPaso(); };

    function pintarEntradaContacto() {
      const entrada = h('input.campo__entrada', { type: 'text', placeholder: 'Contacto (a quien viste o veras)' });
      poner(
        cabeza('Contacto'),
        entrada,
        h('div.hoja__acciones',
          contactos.length
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
        if (!contactos.length) return pintarEntradaContacto();
        poner(
          cabeza('Contacto'),
          h('button.asistente__nuevo', { type: 'button', onclick: () => pintarEntradaContacto() },
            '＋  Agregar contacto'),
          h('div.asistente__rejilla',
            contactos.map(o => h('button.asistente__op', {
              type: 'button',
              onclick: () => { sel.contacto = o; avanzar(); }
            }, o))),
          h('div.hoja__acciones',
            h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
            h('button.btn.btn--fantasma', { type: 'button', onclick: () => { sel.contacto = ''; avanzar(); } }, 'Omitir'))
        );
        return;
      }
      const cTexto = campo('¿Que se hizo? (nuevo estatus)', { maxLength: 240 });
      const cFecha = campo('Proximo seguimiento', { type: 'date', value: '' });
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
/* Detalle de una oportunidad                                        */
/* ---------------------------------------------------------------- */

async function hojaDetalle(v, permisos, alCambiar) {
  await hoja(v.cliente, (cerrar) => {
    const cuerpo = h('div');
    const pinta = () => {
      const cal = calificacion(v);
      const contacto = contactoVigente(v);
      vaciar(cuerpo).append(
        h('p.venta-titulo', v.titulo),
        h('p.venta-meta',
          h('span.venta-prio.venta-prio--' + v.prioridad, v.prioridad.toUpperCase()),
          ' · seguimiento: ' + fechaBonita(v.fechaSeguimiento) + (v.cerrada ? ' · CERRADA' : '')),
        contacto ? h('p.venta-meta', '👤 Contacto actual: ' + contacto) : null,
        h('p.venta-cal', 'CALIFICACION: ' + cal + '%  (' + (v.historial || []).length + ' estatus)'),

        h('h3.venta-h3', 'HISTORIAL DE ACCIONES'),
        h('div.venta-historial',
          ...(v.historial || []).slice().reverse().map(e =>
            h('div.venta-evento' + (e.tipo === 'atraso' ? '.venta-evento--atraso' : ''),
              h('span.venta-evento__fecha', fechaBonita(e.fecha)),
              h('span.venta-evento__texto', e.texto,
                e.contacto ? h('span.venta-evento__contacto', '👤 ' + e.contacto) : null)))),
        permisos.accionar && !v.cerrada ? h('button.btn.btn--primario.venta-btn', {
          type: 'button',
          onclick: async () => {
            const accion = await hojaNuevaAccion(v, await contactosDe(v.cliente));
            if (!accion) return;
            v.historial.push({ ts: db.marcaDeTiempo(), fecha: fechaClave(), tipo: 'estatus', texto: accion.texto, contacto: accion.contacto || '' });
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
                h('span.venta-nota__texto', n.texto))))
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
        permisos.crear && !v.cerrada ? h('button.btn.btn--fantasma.venta-btn', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmar('¿Cerrar la oportunidad "' + v.titulo + '"? Su calificacion queda en ' + calificacion(v) + '%.', { textoOk: 'Cerrar', peligro: false }))) return;
            v.cerrada = true;
            await db.ventaGuardar(v);
            pinta();
            alCambiar();
          },
        }, '✔  CERRAR OPORTUNIDAD') : null
      );
    };
    pinta();
    return cuerpo;
  });
}

/* ---------------------------------------------------------------- */
/* Tablero                                                           */
/* ---------------------------------------------------------------- */

export async function render(contenedor) {
  const yo = await quienSoy();
  const permisos = { crear: puedeCrearVentas(yo), accionar: puedeAccionarVentas(yo) };

  contenedor.append(h('header.cabecera',
    h('div.cabecera__fila',
      h('button.icono-btn', { type: 'button', 'aria-label': 'Volver', onclick: () => history.back() }, '←'),
      h('h1', '💼 Ventas'),
      h('span.diario-fecha', 'por cliente y oportunidad')
    )));
  const cont = h('div.contenido.diario');
  contenedor.append(cont);

  let filtroCliente = '';

  const pintar = async () => {
    const ventas = await db.ventasTodas();
    await registrarAtrasos(ventas);
    vaciar(cont);

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
          const v = {
            id: db.nuevoId(), ...datos, cerrada: false, creado: db.marcaDeTiempo(),
            historial: [{ ts: db.marcaDeTiempo(), fecha: fechaClave(), tipo: 'estatus', texto: 'Oportunidad creada' }],
          };
          await db.ventaGuardar(v);
          // cliente nuevo → al catalogo global de toda la app
          try { await db.maquinaRecordar({ cliente: datos.cliente }); } catch (e) { /* opcional */ }
          pintar();
        },
      }, '✚  NUEVA') : null));

    let lista = ventas.filter(v => !filtroCliente || v.cliente === filtroCliente);
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
    for (const v of lista) {
      const vencida = !v.cerrada && v.fechaSeguimiento && v.fechaSeguimiento < hoy;
      cont.append(h('button.venta-carta' + (v.cerrada ? '.venta-carta--cerrada' : ''), {
        type: 'button',
        onclick: () => hojaDetalle(v, permisos, pintar),
      },
        h('div.venta-carta__fila',
          h('span.venta-prio.venta-prio--' + v.prioridad, v.prioridad.toUpperCase()),
          h('span.venta-cliente', v.cliente),
          h('span.venta-cal', calificacion(v) + '%')),
        h('p.venta-titulo', v.titulo),
        h('p.venta-meta',
          v.cerrada ? 'CERRADA' : h('span' + (vencida ? '.venta-vencida' : ''),
            (vencida ? '⚠ vencida · ' : 'seguimiento: ') + fechaBonita(v.fechaSeguimiento)),
          contactoVigente(v) ? ' · 👤 ' + contactoVigente(v) : '',
          h('span.venta-estatus', ' · ' + estatusActual(v)))
      ));
    }
  };

  await pintar();
}
