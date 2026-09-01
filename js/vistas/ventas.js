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

import { h, aviso, vaciar, confirmar, hoja, campo, campoArea, ocupado, libre } from '../ui.js';
import * as db from '../db.js';
import * as media from '../media.js';
import { organizacion, quienSoy, puedeCrearVentas, puedeAccionarVentas, puedeGestionarVentas, veTodasLasVentas, puedeEditarContactos, fechaSimulada } from '../organizacion.js';
import { clientesConocidos } from './servicios.js';

// PRIORIDADES tipo A1/A2/B1/C3 (regla de Vale, 31 ago 2026): a cada
// oportunidad se le elige la LETRA (A, B o C) y el NUMERO se asigna
// solo — el siguiente libre en la fila de ese vendedor; el orden se
// cambia ARRASTRANDO en la hoja de prioridades (desde editar).
// Los valores viejos (alta/media/baja) simplemente no pasan el patron
// y se muestran como "sin prioridad".
const RE_PRIORIDAD = /^[ABC][1-9]\d*$/;
function prioridadValida(p) { return typeof p === 'string' && RE_PRIORIDAD.test(p); }

// Clave ordenable: A antes que B/C, numero con ceros; sin prioridad al final.
function clavePrio(v) {
  return prioridadValida(v.prioridad) ? v.prioridad[0] + v.prioridad.slice(1).padStart(4, '0') : 'Z9999';
}

// La FILA de una letra es GLOBAL del depto (regla de Vale): abiertas,
// por numero, sin importar el vendedor. Los vendedores solo VEN las
// suyas (el reordenador vive en EDITAR, que es del lider/admin).
function filaDePrioridad(ventas, letra) {
  return ventas
    .filter(v => !v.cerrada && prioridadValida(v.prioridad) && v.prioridad[0] === letra)
    .sort((a, b) => parseInt(a.prioridad.slice(1), 10) - parseInt(b.prioridad.slice(1), 10));
}

// Renumera 1..n la fila (saltando la venta con id saltarId) y guarda
// solo las que cambiaron.
async function compactarFila(ventas, letra, saltarId) {
  const fila = filaDePrioridad(ventas, letra).filter(v => v.id !== saltarId);
  for (let k = 0; k < fila.length; k++) {
    const nueva = letra + (k + 1);
    if (fila[k].prioridad !== nueva) { fila[k].prioridad = nueva; await db.ventaGuardar(fila[k]); }
  }
}

// Cambia la LETRA de una oportunidad ('' = sin prioridad): libera y
// compacta la fila que deja, y toma el siguiente numero libre de la nueva.
async function asignarPrioridad(v, letra) {
  const letraVieja = prioridadValida(v.prioridad) ? v.prioridad[0] : '';
  if (letraVieja === letra) return;
  const todas = await db.ventasTodas();
  if (letraVieja) await compactarFila(todas, letraVieja, v.id);
  v.prioridad = letra
    ? letra + (filaDePrioridad(todas, letra).filter(x => x.id !== v.id).length + 1)
    : '';
  await db.ventaGuardar(v);
}

// Botonera A/B/C (toque para elegir, retocar para quitar).
function botoneraPrioridad(inicial, alCambiar) {
  let elegida = inicial || '';
  const botones = ['A', 'B', 'C'].map(l => h('button.venta-prio-op', {
    type: 'button',
    onclick: () => {
      elegida = elegida === l ? '' : l;
      botones.forEach(b => b.classList.toggle('venta-prio-op--activa', b.textContent === elegida));
      if (alCambiar) alCambiar(elegida);
    },
  }, l));
  botones.forEach(b => b.classList.toggle('venta-prio-op--activa', b.textContent === elegida));
  const el = h('div.venta-prio-fila', ...botones);
  el.valorPrio = () => elegida;
  return el;
}

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

// El registro "Oportunidad creada" de ventas viejas NO cuenta como accion
// (regla de Vale): ni en la calificacion ni en las listas.
function esCreacionLegada(e) {
  return e.tipo === 'estatus' && e.texto === 'Oportunidad creada';
}

function calificacion(v) {
  const n = (v.historial || []).filter(e => !esCreacionLegada(e)).length || 1;
  return Math.round(100 / n);
}

function estatusActual(v) {
  const hist = (v.historial || []).filter(e => !esCreacionLegada(e));
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

// La FECHA COMPROMISO es POR ACCION (regla de Vale): la vigente de la
// oportunidad es la de su ultima accion (los atrasos automaticos no
// cuentan como accion). Ventas viejas caen a su fechaSeguimiento legada.
function compromisoVigente(v) {
  const hist = v.historial || [];
  for (let k = hist.length - 1; k >= 0; k--) {
    if (hist[k].tipo === 'estatus') return hist[k].compromiso || '';
  }
  return v.fechaSeguimiento || '';
}

// Semaforo de la accion vigente segun su fecha compromiso: "En tiempo"
// (verde), "Cerca de vencer" (ambar, a menos de 3 dias) o "Vencida por X
// dias" (rojo).
// Clase del circulo semaforo de la calificacion (detalle y tablero):
// >90 verde, 50-90 amarillo, <50 rojo.
function claseCal(cal) {
  return cal > 90 ? 'venta-cal-solo--verde' : cal >= 50 ? 'venta-cal-solo--ambar' : 'venta-cal-solo--rojo';
}

// Dias que faltan para una fecha clave (negativos = ya vencio). Es el
// MISMO umbral del chip y de los filtros. refClave opcional: comparar
// contra OTRO dia (p. ej. el del CIERRE, para congelar el estatus).
function diasPara(comp, refClave) {
  return Math.round((new Date(comp + 'T12:00:00') - new Date((refClave || fechaClave()) + 'T12:00:00')) / 86400000);
}

// El color del semaforo a partir de los dias (mismo umbral en chips,
// filtros y el numero de "Dias para vencimiento" del detalle).
function colorPorDias(dias) {
  return dias < 0 ? 'rojo' : dias < 3 ? 'ambar' : 'verde';
}

// corto: sin el "por X dias" (en el detalle los dias van aparte, en su
// propia linea "Dias para vencimiento" — regla de Vale).
function chipEstadoCompromiso(comp, refClave, corto) {
  const dias = diasPara(comp, refClave);
  const color = colorPorDias(dias);
  const texto = color === 'rojo'
    ? (corto ? '⚠ Vencida' : '⚠ Vencida por ' + (-dias) + (dias === -1 ? ' dia' : ' dias'))
    : color === 'ambar' ? '⏳ Cerca de vencer' : '✓ En tiempo';
  return h('span.venta-estado-chip.venta-estado-chip--' + color, texto);
}

// Numero de dias que faltan (negativo = ya vencio) como chip de color.
function chipDias(dias) {
  return h('span.venta-estado-chip.venta-estado-chip--' + colorPorDias(dias), String(dias));
}

// Una venta CONCLUIDA por el vendedor (con evidencia) espera la REVISION
// del lider: mientras tanto se congela como el historial.
function enRevision(v) {
  return !!(v.conclusion && !v.conclusion.revisada);
}

// Chip del cierre de una accion (completada / cancelada, regla de Vale).
function chipCierre(cierre) {
  return cierre.tipo === 'cancelada'
    ? h('span.venta-estado-chip.venta-estado-chip--rojo', '✕ Cancelada')
    : h('span.venta-estado-chip.venta-estado-chip--verde', '✔ Completada');
}

// Calendarito estilo emoji 📅 pero con DATOS REALES (pedido de Vale):
// banda roja con el mes y el dia en cuerpo claro, igual en ambos temas
// (colores fijos, como un emoji).
const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
// chico: version tamano emoji (la linea de creacion del detalle).
function calendarioMini(clave, chico) {
  const d = new Date(clave + 'T12:00:00');
  return h('span.venta-calmini' + (chico ? '.venta-calmini--chico' : ''),
    h('span.venta-calmini__mes', MESES_CORTOS[d.getMonth()]),
    h('span.venta-calmini__dia', String(d.getDate())));
}

// dd/mm/aa para la linea del pie de la tarjeta.
function fechaCorta(clave) {
  return clave.slice(8, 10) + '/' + clave.slice(5, 7) + '/' + clave.slice(2, 4);
}

// Toda accion DEBE llevar fecha compromiso (regla de Vale, 31 ago 2026):
// el formulario ya no deja guardar sin ella, y a las acciones viejas que
// quedaron sin fecha se les asigna una AL AZAR (2 a 10 dias despues de la
// creacion de la accion). Si la de la accion vigente cae ya vencida,
// registrarAtrasos anota su atraso en la misma pasada — flujo normal.
async function asignarCompromisosFaltantes(ventas) {
  for (const v of ventas) {
    let cambio = false;
    for (const e of (v.historial || [])) {
      if (e.tipo !== 'estatus' || esCreacionLegada(e) || e.compromiso) continue;
      const base = new Date((e.fecha || fechaClave()) + 'T12:00:00');
      base.setDate(base.getDate() + 2 + Math.floor(Math.random() * 9));
      e.compromiso = fechaClave(base);
      cambio = true;
    }
    if (cambio) await db.ventaGuardar(v);
  }
}

// Un ATRASO automatico por cada fecha compromiso vencida sin accion nueva.
async function registrarAtrasos(ventas) {
  const hoy = fechaClave();
  for (const v of ventas) {
    if (v.cerrada) continue;
    const comp = compromisoVigente(v);
    if (!comp || comp >= hoy) continue;
    const ya = (v.historial || []).some(e => e.tipo === 'atraso' && e.porFecha === comp);
    if (ya) continue;
    v.historial.push({
      ts: db.marcaDeTiempo(), fecha: hoy, tipo: 'atraso', porFecha: comp,
      texto: 'ATRASO: fecha compromiso vencida el ' + fechaBonita(comp),
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
// vendedores: null para un vendedor (la oportunidad es suya), o la lista
// [{id,nombre}] con EL PRIMERO siendo quien crea (lider/admin) para que
// pueda ASIGNARLA a cualquiera del equipo (pedido de Vale).
function hojaNuevaOportunidad(clientes, vendedores) {
  return hoja('💲  Nueva oportunidad', (cerrar) => {
    const sel = { cliente: '', sede: '' };
    let vendedorElegido = vendedores ? vendedores[0] : null;
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

    // CALCADO del pintarEntrada del asistente de Servicio (consistencia).
    function pintarEntrada(titulo, placeholder, opciones, alContinuar, omitible) {
      const entrada = h('input.campo__entrada', { type: 'text', placeholder });
      poner(
        cabeza(titulo),
        entrada,
        h('div.hoja__acciones',
          opciones.length
            ? h('button.btn.btn--fantasma', { type: 'button', onclick: () => pintarPaso() }, 'Ver opciones')
            : h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
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
            clientes.map(o => h('button.asistente__op', { type: 'button', onclick: () => elegirCliente(o) }, o)))
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
          h('button.asistente__omitir', {
            type: 'button',
            onclick: () => continuarSede('')
          }, 'Omitir este paso →')
        );
        return;
      }

      // La fecha compromiso NO es de la oportunidad: la trae cada accion
      // (la primera se pide justo despues, obligatoria).
      const cTitulo = campo('Oportunidad', { maxLength: 160, placeholder: 'p. ej. Refacciones para H400' });
      const botonesPrio = botoneraPrioridad('');

      // El lider (o el admin) ASIGNA la oportunidad: botones de todo el
      // equipo, el suyo primero y preseleccionado.
      let filaVendedores = null;
      if (vendedores) {
        const botones = vendedores.map(u => h('button.venta-prio-op.venta-vend-op', {
          type: 'button',
          onclick: (ev) => {
            vendedorElegido = u;
            for (const b of ev.currentTarget.parentElement.children) {
              b.classList.toggle('venta-prio-op--activa', b === ev.currentTarget);
            }
          },
        }, u.nombre));
        botones[0].classList.add('venta-prio-op--activa');
        filaVendedores = h('label.campo',
          h('span.campo__etiqueta', 'Asignar al vendedor'),
          h('div.venta-vend-fila', ...botones));
      }

      poner(
        cabeza('La oportunidad'),
        cTitulo,
        h('label.campo', h('span.campo__etiqueta', 'Prioridad (opcional)'), botonesPrio),
        filaVendedores,
        h('div.hoja__acciones',
          h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
          h('button.btn.btn--primario', {
            type: 'button',
            onclick: () => {
              const titulo = cTitulo.querySelector('input').value.trim();
              if (!titulo) { aviso('Describe la oportunidad.', 'error'); return; }
              cerrar({
                cliente: sel.cliente, sede: sel.sede, titulo,
                prioridadLetra: botonesPrio.valorPrio(),
                vendedor: vendedorElegido ? { id: vendedorElegido.id, nombre: vendedorElegido.nombre } : null,
              });
            },
          }, 'Crear'))
      );

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
        cabeza('Contacto (opcional)'),
        entrada,
        h('p.pista', 'El contacto es opcional: puedes Continuar sin escribir nada.'),
        h('div.hoja__acciones',
          (contactos.length || globales.length)
            ? h('button.btn.btn--fantasma', { type: 'button', onclick: () => pintarPaso() }, 'Ver opciones')
            : h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
          h('button.btn.btn--primario', {
            type: 'button',
            onclick: () => { sel.contacto = entrada.value.trim(); avanzar(); }
          }, 'Continuar')
        )
      );

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
          cabeza(modoGlobal ? 'Contacto global (opcional)' : 'Contacto (opcional)'),
          h('button.asistente__nuevo', { type: 'button', onclick: () => pintarEntradaContacto() },
            '＋  Agregar contacto'),
          rejilla.length ? h('div.asistente__rejilla', rejilla)
            : h('p.pista', modoGlobal ? 'Aun no hay contactos en la organizacion.' : 'Sin contactos de este cliente y sede.'),
          globales.length ? h('button.btn.btn--fantasma.venta-btn-mini', {
            type: 'button',
            onclick: () => { modoGlobal = !modoGlobal; pintarPaso(); },
          }, modoGlobal ? '👤  VER CONTACTOS DE ESTE CLIENTE' : '🌐  VER LISTA DE CONTACTOS GLOBAL') : null,
          h('button.asistente__omitir', {
            type: 'button',
            onclick: () => { sel.contacto = ''; avanzar(); }
          }, 'Omitir este paso →')
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
              // Sin fecha compromiso NO se registra la accion (regla de
              // Vale): de esa fecha viven el semaforo y los atrasos.
              const fecha = cFecha.querySelector('input').value;
              if (!fecha) { aviso('Elige la fecha compromiso.', 'error'); return; }
              cerrar({ texto, fecha, contacto: sel.contacto });
            },
          }, 'Guardar'))
      );

    }

    pintarPaso();
    return cont;
  });
}

/* ---------------------------------------------------------------- */
/* Edicion (SOLO lider de Ventas o admin: "poder cambiar todo")      */
/* ---------------------------------------------------------------- */

// Submenu de cliente y sede para EDITAR (regla de Vale: nada de teclear
// cliente ni sede a mano) — CALCO de los pasos 1 y 2 del asistente de
// nueva oportunidad: mismas cuadriculas, "＋ Agregar" y N/A / Omitir.
function hojaElegirClienteSede(clientes) {
  return hoja('🏢  Cliente y sede', (cerrar) => {
    const sel = { cliente: '' };
    let sedes = [];
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
      i > 0 ? h('p.asistente__miga', sel.cliente) : null
    );

    const elegirCliente = async (nombre) => {
      sel.cliente = nombre;
      sedes = await sedesDe(nombre);
      i = 1;
      pintarPaso();
    };
    const terminar = (sede) => cerrar({ cliente: sel.cliente, sede });

    function pintarEntrada(titulo, placeholder, opciones, alContinuar, omitible) {
      const entrada = h('input.campo__entrada', { type: 'text', placeholder });
      poner(
        cabeza(titulo),
        entrada,
        h('div.hoja__acciones',
          opciones.length
            ? h('button.btn.btn--fantasma', { type: 'button', onclick: () => pintarPaso() }, 'Ver opciones')
            : h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
          h('button.btn.btn--primario', {
            type: 'button',
            onclick: () => {
              const t = entrada.value.trim();
              if (!t && !omitible) return;
              alContinuar(t);
            }
          }, 'Continuar')
        )
      );
    }

    function pintarPaso() {
      if (i === 0) {
        if (!clientes.length) return pintarEntrada('Cliente', 'Cliente', clientes, (t) => { if (t) elegirCliente(t); }, false);
        poner(
          cabeza('Cliente'),
          h('button.asistente__nuevo', {
            type: 'button',
            onclick: () => pintarEntrada('Cliente', 'Cliente', clientes, (t) => { if (t) elegirCliente(t); }, false)
          }, '＋  Agregar cliente'),
          h('div.asistente__rejilla',
            clientes.map(o => h('button.asistente__op', { type: 'button', onclick: () => elegirCliente(o) }, o)))
        );
        return;
      }
      poner(
        cabeza('Sede'),
        h('button.asistente__nuevo', {
          type: 'button',
          onclick: () => pintarEntrada('Sede', 'Sede / planta del cliente', ['N/A', ...sedes], terminar, true)
        }, '＋  Agregar sede'),
        h('div.asistente__rejilla',
          h('button.asistente__op', { type: 'button', onclick: () => terminar('N/A') }, 'N/A'),
          sedes.map(o => h('button.asistente__op', { type: 'button', onclick: () => terminar(o) }, o))),
        h('button.asistente__omitir', {
          type: 'button',
          onclick: () => terminar('')
        }, 'Omitir este paso →')
      );
    }

    pintarPaso();
    return cont;
  });
}

async function hojaEditarOportunidad(v) {
  // El lider tambien puede REASIGNAR la oportunidad a otro vendedor.
  const org = await organizacion();
  const equipoVentas = org.usuarios.filter(u => u.depto === 'Ventas');
  const clientes = await clientesGlobales();

  return hoja('✎  Editar oportunidad', (cerrar) => {
    // Cliente y sede NO se teclean a mano (regla de Vale): el boton con
    // vestido de select abre su submenu de cuadriculas.
    const sel = { cliente: v.cliente || '', sede: v.sede || '' };
    const textoCliSede = () => (sel.cliente + (sedeBonita(sel.sede) ? ' ' + sedeBonita(sel.sede) : '')).toUpperCase();
    const valorCliSede = h('span.crece', textoCliSede());
    const btnCliSede = h('button.org-select.venta-edit-clisede', {
      type: 'button',
      onclick: async () => {
        const r = await hojaElegirClienteSede(clientes);
        if (!r) return;
        sel.cliente = r.cliente;
        sel.sede = r.sede;
        valorCliSede.textContent = textoCliSede();
      },
    }, valorCliSede, h('span', '▾'));
    const cTitulo = campo('Oportunidad', { maxLength: 160, value: v.titulo || '' });
    const letraActual = prioridadValida(v.prioridad) ? v.prioridad[0] : '';
    const botonesPrio = botoneraPrioridad(letraActual);
    const selVendedor = h('select.org-select',
      h('option', { value: '' }, 'Sin vendedor'),
      ...equipoVentas.map(u => h('option', { value: u.id, selected: v.duenoId === u.id }, u.nombre)));
    return h('div',
      // El VENDEDOR hasta arriba (pedido de Vale).
      h('label.campo', h('span.campo__etiqueta', 'Vendedor asignado'), selVendedor),
      h('label.campo', h('span.campo__etiqueta', 'Cliente y sede'), btnCliSede),
      cTitulo,
      h('label.campo', h('span.campo__etiqueta', 'Prioridad' + (prioridadValida(v.prioridad) ? ' (actual: ' + v.prioridad + ')' : '')), botonesPrio),
      // El orden dentro de la letra se cambia ARRASTRANDO en su hoja
      // (fila GLOBAL: el lider ve todas, de todos los vendedores).
      letraActual ? h('button.btn.btn--fantasma.venta-btn-mini', {
        type: 'button',
        onclick: () => hojaPrioridades(letraActual),
      }, '⇅  ORDENAR PRIORIDADES ' + letraActual) : null,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => {
            const titulo = cTitulo.querySelector('input').value.trim();
            if (!sel.cliente || !titulo) { aviso('El cliente y la oportunidad no pueden quedar vacios.', 'error'); return; }
            const dueno = equipoVentas.find(u => u.id === selVendedor.value);
            cerrar({
              cliente: sel.cliente,
              sede: sel.sede,
              titulo,
              prioridadLetra: botonesPrio.valorPrio(),
              duenoId: dueno ? dueno.id : '',
              dueno: dueno ? dueno.nombre : '',
            });
          },
        }, 'Guardar')));
  });
}

// Hoja de PRIORIDADES de una letra: TODAS las de esa letra en orden
// (fila global; cada fila muestra su vendedor); se mantiene presionada
// una fila y se ARRASTRA para reordenar (los numeros se reasignan
// 1..n al soltar). Solo llega aqui el lider o el admin (via EDITAR).
function hojaPrioridades(letra) {
  return hoja('⇅  Prioridades ' + letra, (cerrar) => {
    const listaEl = h('div.prio-lista');
    let fila = [];

    const pinta = async () => {
      fila = filaDePrioridad(await db.ventasTodas(), letra);
      if (!fila.length) {
        listaEl.replaceChildren(h('p.pista', 'No hay oportunidades abiertas con prioridad ' + letra + '.'));
        return;
      }
      listaEl.replaceChildren(...fila.map((v, idx) => {
        const el = h('div.prio-fila',
          h('span.prio-num', letra + (idx + 1)),
          h('span.prio-tit', v.titulo,
            v.dueno ? h('span.prio-dueno', '👤 ' + v.dueno) : null),
          h('span.prio-asa', '↕'));
        el.onpointerdown = (ev) => arrastrar(ev, el, idx);
        return el;
      }));
    };

    async function arrastrar(ev, el, desde) {
      ev.preventDefault();
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* punteros sinteticos */ }
      const filas = [...listaEl.children];
      const alto = (filas.length > 1 ? filas[1].offsetTop - filas[0].offsetTop : el.offsetHeight) || 44;
      const y0 = ev.clientY;
      let destino = desde;
      el.classList.add('prio-fila--envuelo');
      const mover = (e2) => {
        const dy = e2.clientY - y0;
        el.style.transform = 'translateY(' + dy + 'px)';
        const nuevo = Math.max(0, Math.min(filas.length - 1, desde + Math.round(dy / alto)));
        if (nuevo !== destino) {
          destino = nuevo;
          filas.forEach((f, k) => {
            if (f === el) return;
            let corr = 0;
            if (desde < destino && k > desde && k <= destino) corr = -alto;
            if (desde > destino && k >= destino && k < desde) corr = alto;
            f.style.transform = corr ? 'translateY(' + corr + 'px)' : '';
          });
        }
      };
      const soltar = async () => {
        el.removeEventListener('pointermove', mover);
        el.removeEventListener('pointerup', soltar);
        el.removeEventListener('pointercancel', soltar);
        el.classList.remove('prio-fila--envuelo');
        if (destino !== desde) {
          const orden = fila.slice();
          const [mov] = orden.splice(desde, 1);
          orden.splice(destino, 0, mov);
          for (let k = 0; k < orden.length; k++) {
            const nueva = letra + (k + 1);
            if (orden[k].prioridad !== nueva) { orden[k].prioridad = nueva; await db.ventaGuardar(orden[k]); }
          }
        }
        await pinta();
      };
      el.addEventListener('pointermove', mover);
      el.addEventListener('pointerup', soltar);
      el.addEventListener('pointercancel', soltar);
    }

    pinta();
    return h('div',
      h('p.pista', 'Manten presionada una fila y arrastrala hacia arriba o abajo.'),
      listaEl,
      h('div.hoja__acciones',
        h('button.btn.btn--primario', { type: 'button', onclick: () => cerrar(true) }, 'Listo')));
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
            // Editar tampoco puede dejar la accion sin fecha compromiso
            // (regla de Vale: toda accion lleva la suya).
            const compromiso = cFecha.querySelector('input').value;
            if (!compromiso) { aviso('Elige la fecha compromiso.', 'error'); return; }
            cerrar({
              texto,
              contacto: cContacto.querySelector('input').value.trim(),
              compromiso,
            });
          },
        }, 'Guardar')));
  });
}

// Texto OBLIGATORIO al cerrar una accion: el resultado (completada) o el
// motivo (cancelada) — regla de Vale.
function hojaMotivo(titulo, etiqueta) {
  return hoja(titulo, (cerrar) => {
    const cTexto = campoArea(etiqueta, { maxLength: 400 });
    return h('div',
      cTexto,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => {
            const texto = cTexto.querySelector('textarea, input').value.trim();
            if (!texto) { aviso('Este dato es obligatorio.', 'error'); return; }
            cerrar(texto);
          },
        }, 'Guardar')));
  });
}

// VENTA COMPLETADA (regla de Vale): solo con EVIDENCIA — foto de la
// orden de compra, la hoja de entrega o el reporte — queda marcada, y el
// lider la encuentra en "CONCLUIDAS POR REVISAR" en el tablero.
async function flujoVentaCompletada(v) {
  const TIPOS = [['🧾', 'Orden de compra'], ['📄', 'Hoja de entrega'], ['📋', 'Reporte']];
  const tipo = await hoja('💰  Venta completada', (cerrar) => h('div',
    h('p.pista', 'Para confirmarla se adjunta la evidencia. ¿Que vas a fotografiar?'),
    ...TIPOS.map(([ico, t]) => h('button.btn.btn--fantasma.venta-btn', {
      type: 'button', onclick: () => cerrar(t),
    }, ico + '  ' + t.toUpperCase())),
    h('div.hoja__acciones',
      h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'))));
  if (!tipo) return null;

  const modo = await hoja('📎  Evidencia: ' + tipo, (cerrar) => h('div',
    h('button.btn.btn--primario.venta-btn', { type: 'button', onclick: () => cerrar('camara') }, '📷  TOMAR FOTO'),
    h('button.btn.btn--fantasma.venta-btn', { type: 'button', onclick: () => cerrar('galeria') }, '🖼  DE LA GALERIA'),
    h('div.hoja__acciones',
      h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'))));
  if (!modo) return null;

  const archivos = await media.elegirImagenes({
    camara: modo === 'camara',
    multiple: modo === 'galeria',
    alRegresar: () => ocupado('Procesando la evidencia...'),
  });
  if (!archivos.length) { libre(); aviso('Sin evidencia no se puede confirmar la venta.', 'error'); return null; }
  ocupado('Procesando la evidencia...');
  const ids = [];
  try {
    for (const archivo of archivos) {
      try {
        const { _ms, ...procesada } = await media.procesarImagen(archivo);
        const fotoId = db.nuevoId();
        await db.fotoGuardar(Object.assign({ id: fotoId }, procesada));
        ids.push(fotoId);
      } catch (e) { aviso('No se pudo procesar una foto: ' + e.message, 'error'); }
    }
  } finally { libre(); }
  if (!ids.length) { aviso('Sin evidencia no se puede confirmar la venta.', 'error'); return null; }

  const yo = await quienSoy();
  v.conclusion = {
    ts: db.marcaDeTiempo(), fecha: fechaClave(), tipo,
    porId: yo ? yo.id : '', por: yo ? yo.nombre : '',
    evidencias: ids, revisada: false,
  };
  delete v.pendienteAccion;
  await db.ventaGuardar(v);
  aviso('Venta marcada como COMPLETADA: el lider revisara la evidencia.', 'ok');
  return true;
}

// Tras COMPLETAR o CANCELAR la accion vigente es OBLIGATORIO dejar la
// siguiente accion (o concluir la venta con evidencia): este menu se
// repite hasta resolverse (regla de Vale); si el usuario se sale de la
// app, el CANDADO lo trae de vuelta aqui al volver a entrar.
async function resolverPendiente(v) {
  for (;;) {
    const opcion = await hoja('⏭  ¿Que sigue?', (cerrar) => h('div',
      h('p.pista', 'La accion vigente de "' + v.titulo + '" (' + v.cliente + ') quedo cerrada: registra la SIGUIENTE accion, o marca la venta como completada con su evidencia.'),
      h('button.btn.btn--primario.venta-btn', { type: 'button', onclick: () => cerrar('accion') }, '✚  REGISTRAR SIGUIENTE ACCION'),
      h('button.btn.btn--fantasma.venta-btn', { type: 'button', onclick: () => cerrar('venta') }, '💰  VENTA COMPLETADA')));
    if (opcion === 'accion') {
      const accion = await hojaNuevaAccion(v, await contactosDe(v.cliente, v.sede), await contactosGlobales());
      if (!accion) continue;
      v.historial.push({ ts: db.marcaDeTiempo(), fecha: fechaClave(), tipo: 'estatus', texto: accion.texto, contacto: accion.contacto || '', compromiso: accion.fecha || '' });
      delete v.pendienteAccion;
      await db.ventaGuardar(v);
      aviso('Siguiente accion registrada.', 'ok');
      return true;
    }
    if (opcion === 'venta') {
      if (await flujoVentaCompletada(v)) return true;
    }
  }
}

/* ---------------------------------------------------------------- */
/* Candado de ventas: siguiente accion pendiente                     */
/* ---------------------------------------------------------------- */

// Calco del candado del Diario: si quedo una accion cerrada SIN su
// siguiente (v.pendienteAccion), la app se BLOQUEA para el implicado
// (quien la cerro, o el dueño de la venta) hasta resolverla. La capa va
// BAJO las hojas (z50): las del propio flujo se abren encima, y el back
// las cierra pero NUNCA brinca la capa.
let capaCandadoVentas = null;
let _revisarCandadoVentas = null;

function mostrarCandadoVentas(v, alTerminar) {
  const cuerpo = h('div.candado-cuerpo');
  capaCandadoVentas = h('div.candado-diario.candado-diario--ventas', cuerpo);
  document.body.appendChild(capaCandadoVentas);
  cuerpo.append(
    h('div.candado-tarjeta',
      h('div.candado-icono', '💲'),
      h('h2', 'Falta la siguiente accion'),
      h('p.pista', 'Cerraste la accion vigente de "' + v.titulo + '" (' + v.cliente + ') sin dejar la siguiente. Registrala — o marca la venta como completada — para seguir usando la app.'),
      h('button.btn.btn--primario.candado-btn', {
        type: 'button',
        onclick: async () => {
          await resolverPendiente(v);
          if (capaCandadoVentas) { capaCandadoVentas.remove(); capaCandadoVentas = null; }
          if (alTerminar) alTerminar();
          revisarCandadoVentas();   // por si hay OTRA venta pendiente
        },
      }, '⏭  RESOLVER AHORA')));
}

export function instalarCandadoVentas(alTerminar) {
  const revisar = async () => {
    try {
      const yo = await quienSoy();
      if (!yo) return;
      const pend = (await db.ventasTodas()).find(x => !x.cerrada && x.pendienteAccion &&
        (x.pendienteAccion.porId === yo.id || x.duenoId === yo.id));
      if (capaCandadoVentas) {
        // Test Mode puede cambiar de usuario: si ya no aplica, se quita.
        if (!pend) { capaCandadoVentas.remove(); capaCandadoVentas = null; }
        return;
      }
      if (pend) mostrarCandadoVentas(pend, alTerminar);
    } catch (e) { /* sin datos aun */ }
  };
  _revisarCandadoVentas = revisar;
  revisar();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revisar();
  });
}

// Para el Test Mode (cambio de usuario al momento) y los flujos vivos.
export function revisarCandadoVentas() {
  if (_revisarCandadoVentas) _revisarCandadoVentas();
}

// Detalle COMPLETO de una accion: PANTALLA COMPLETA con el estilo de la
// casa (pedido de Vale). Aqui viven COMPLETADO / CANCELADO — cierran la
// accion vigente con su texto obligatorio y piden la siguiente — y el
// boton EDITAR (solo lider/admin); borrar acciones no existe.
async function hojaDetalleAccion(e, esVigente, v, permisos, alCambiar) {
  const yo = await quienSoy();
  await hoja('📄  Detalle de la accion', () => {
    const cuerpo = h('div');
    const pinta = () => {
      const viva = esVigente && !v.cerrada && !enRevision(v) && !e.cierre;
      // COMPLETADO / CANCELADO: texto obligatorio, se guarda el cierre y
      // queda PENDIENTE la siguiente accion (candado si se sale sin ella).
      const cerrarAccion = async (tipo) => {
        const texto = await hojaMotivo(
          tipo === 'completada' ? '✔  Accion completada' : '✕  Accion cancelada',
          tipo === 'completada' ? 'Resultado de la accion' : 'Motivo de cancelacion');
        if (!texto) return;
        e.cierre = { tipo, texto, fecha: fechaClave(), ts: db.marcaDeTiempo(), porId: yo ? yo.id : '', por: yo ? yo.nombre : '' };
        v.pendienteAccion = { ts: db.marcaDeTiempo(), porId: yo ? yo.id : '' };
        await db.ventaGuardar(v);
        pinta();
        alCambiar();
        await resolverPendiente(v);
        pinta();
        alCambiar();
      };
      cuerpo.replaceChildren(...[
        h('h3.venta-grupo', '⚡ LA ACCION',
          viva && e.compromiso ? chipEstadoCompromiso(e.compromiso, '', true) : null,
          e.cierre ? chipCierre(e.cierre) : null),
        h('div.venta-evento.venta-evento--plano',
          h('p.venta-evento__cuerpo', h('span.venta-carta__etiqueta', 'Descripcion: '), e.texto),
          (e.contacto || (viva && e.compromiso)) ? h('div.venta-evento__fechas',
            h('span.venta-evento__contacto', e.contacto ? '👤 ' + e.contacto : ''),
            viva && e.compromiso ? h('span', 'Dias para vencimiento: ', chipDias(diasPara(e.compromiso))) : null) : null,
          h('div.venta-evento__fechas',
            h('span', 'Fecha de creacion: ' + fechaBonita(e.fecha)),
            e.compromiso ? h('span.venta-fecha-cal', calendarioMini(e.compromiso, true), 'Fecha compromiso: ' + fechaBonita(e.compromiso)) : null)),
        e.cierre ? h('h3.venta-grupo', e.cierre.tipo === 'cancelada' ? '✕ MOTIVO DE CANCELACION' : '✔ RESULTADO DE LA ACCION') : null,
        e.cierre ? h('div.venta-evento.venta-evento--plano',
          h('p.venta-evento__cuerpo', e.cierre.texto),
          h('div.venta-evento__fechas',
            h('span', 'Cerrada el ' + fechaBonita(e.cierre.fecha) + (e.cierre.por ? ' por ' + e.cierre.por : '')))) : null,
        viva && permisos.accionar ? h('div.venta-cierre-fila',
          h('button.btn.btn--primario', { type: 'button', onclick: () => cerrarAccion('completada') }, '✔  COMPLETADO'),
          h('button.btn.btn--peligro', { type: 'button', onclick: () => cerrarAccion('cancelada') }, '✕  CANCELADO')) : null,
        permisos.gestionar ? h('button.btn.btn--fantasma.venta-btn-mini', {
          type: 'button',
          onclick: async () => {
            const datos = await hojaEditarAccion(e);
            if (!datos) return;
            e.texto = datos.texto;
            e.contacto = datos.contacto;
            e.compromiso = datos.compromiso;
            await db.ventaGuardar(v);
            pinta();
            alCambiar();
          },
        }, '✎  EDITAR ACCION') : null,
      ].filter(Boolean));
    };
    pinta();
    return cuerpo;
  }, { altura: 'completa' });
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

// Rejilla de la EVIDENCIA de venta (miniaturas del store de fotos, como
// las rejillas del modulo Tecnico); tocar una abre la foto grande.
function seccionEvidencia(v) {
  const rejilla = h('div.venta-evidencia__fotos');
  (async () => {
    for (const id of (v.conclusion.evidencias || [])) {
      try {
        const f = await db.fotoLeer(id);
        if (!f) continue;
        const img = h('img.venta-evi-foto', { src: media.urlDe(f.mini || f.blob), alt: v.conclusion.tipo });
        img.onclick = () => hoja('📎  ' + v.conclusion.tipo, () =>
          h('img.venta-evi-grande', { src: media.urlDe(f.blob) }), { altura: 'completa' });
        rejilla.append(img);
      } catch (e) { /* foto perdida */ }
    }
    if (!rejilla.children.length) rejilla.append(h('p.pista', 'La evidencia no esta en este telefono.'));
  })();
  return h('div.venta-evidencia',
    h('p.venta-meta', 'Marcada como completada por ' + (v.conclusion.por || '—') + ' el ' + fechaBonita(v.conclusion.fecha)),
    rejilla);
}

async function hojaDetalle(v, permisos, alCambiar) {
  // En la CABECERA de la hoja van el TITULO (con su efecto) y el CLIENTE
  // en lugar de la ✕ (pedido de Vale): la hoja se cierra con el atras
  // del telefono, como todas las capas. El header lo construye hoja(),
  // asi que se ajusta tras el montaje (microtask); pintaCab() mantiene
  // los textos al dia (si el lider edita). Ahi mismo se monta el GAFETE
  // flotante de seccion (ACCION ACTUAL / HISTORIAL / ANOTACIONES).
  // Misma regla que la tarjeta: el vendedor solo se muestra en la vista
  // que ve TODAS las cajas (lider/admin).
  const veTodas = veTodasLasVentas(await quienSoy());
  let tituloCabEl = null;
  let clienteCabEl = null;
  let actualizarGafete = () => {};
  const pintaCab = () => {
    if (tituloCabEl) tituloCabEl.textContent = v.titulo;
    if (clienteCabEl) clienteCabEl.textContent = v.cliente + (sedeBonita(v.sede) ? ' ' + sedeBonita(v.sede) : '');
  };
  queueMicrotask(() => {
    const cab = [...document.querySelectorAll('.hoja .hoja__titulo')].pop();
    if (!cab) return;
    const equis = cab.querySelector('.icono-btn');
    if (equis) equis.remove();
    clienteCabEl = h('span.venta-carta__cliente.venta-cliente-cab');
    cab.append(clienteCabEl);
    tituloCabEl = cab.querySelector('h2');
    if (tituloCabEl) tituloCabEl.classList.add('venta-titulo--detalle');
    const panel = cab.closest('.hoja');
    const cuerpoHoja = panel ? panel.querySelector('.hoja__cuerpo') : null;
    if (panel && cuerpoHoja) actualizarGafete = montarGafete(panel, cuerpoHoja, true);
    pintaCab();
    actualizarGafete();
  });

  await hoja(v.titulo, (cerrar) => {
    const cuerpo = h('div');
    const pinta = () => {
      // En el HISTORIAL (cerradas) TODO es de solo lectura: estos
      // permisos "de vista" apagan editar/agregar; lo unico vivo es
      // REACTIVAR, que usa los permisos reales (regla de Vale).
      // Cerrada O en revision del lider: solo lectura (permisos de vista).
      const pv = (v.cerrada || enRevision(v))
        ? { crear: false, accionar: false, gestionar: false }
        : permisos;
      const cal = calificacion(v);
      pintaCab();
      // Semaforo y dias: contra HOY en abiertas; en cerradas CONGELADOS
      // al dia del cierre (null = cerrada legada sin fecha: sin semaforo).
      const refCierre = v.cerrada ? (v.cerrado ? fechaClave(new Date(v.cerrado)) : null) : '';
      const acciones = (v.historial || []).filter(e => e.tipo === 'estatus' && !esCreacionLegada(e));
      const vigente = acciones[acciones.length - 1] || null;
      // Estado con que TERMINO cada accion anterior (regla de Vale, sin
      // importar por cuantos dias): CANCELADA = no completada; completada
      // (o legada con siguiente) = A TIEMPO si llego en o antes del
      // compromiso, VENCIDA si despues; sin datos = NO COMPLETADA.
      const estadoDe = (e, sig) => {
        if (e.cierre && e.cierre.tipo === 'cancelada') {
          return { clase: 'rojo', texto: '✕ No completada', aTiempo: false };
        }
        const ref = (e.cierre && e.cierre.fecha) || (sig && sig.fecha) || '';
        if (!e.compromiso || !ref) return { clase: 'rojo', texto: '✕ No completada', aTiempo: false };
        return ref <= e.compromiso
          ? { clase: 'verde', texto: '✓ A tiempo', aTiempo: true }
          : { clase: 'rojo', texto: '⚠ Vencida', aTiempo: false };
      };
      // Las anteriores van aparte, bajo HISTORIAL; la vigente encabeza
      // su propia seccion ACCION ACTUAL. Mas nueva primero, como siempre.
      const anteriores = acciones.slice(0, -1)
        .map((e, i) => ({ e, estado: estadoDe(e, acciones[i + 1]) }))
        .reverse();
      const aTiempo = anteriores.filter(x => x.estado.aTiempo).length;
      const pctATiempo = anteriores.length ? Math.round(100 * aTiempo / anteriores.length) : 0;
      // datoDer: lo que va a la DERECHA en la linea del contacto, arriba
      // de la fecha compromiso — la vigente lleva sus dias para vencer;
      // las anteriores, el estado con que terminaron.
      const eventoEl = (e, esVigente, datoDer) =>
        h('div.venta-evento', {
          // Toque en el cuadro = ver el detalle completo (ahi vive
          // EDITAR para el lider; borrar acciones ya no existe).
          onclick: () => hojaDetalleAccion(e, esVigente, v, pv, () => { pinta(); alCambiar(); }),
        },
          h('p.venta-evento__cuerpo', h('span.venta-carta__etiqueta', 'Descripcion: '), e.texto),
          (e.contacto || datoDer) ? h('div.venta-evento__fechas',
            h('span.venta-evento__contacto', e.contacto ? '👤 ' + e.contacto : ''),
            datoDer) : null,
          h('div.venta-evento__fechas',
            h('span', 'Fecha de creacion: ' + fechaBonita(e.fecha)),
            // La ACCION ACTUAL lleva su calendarito real (pedido de Vale).
            e.compromiso ? h('span' + (esVigente ? '.venta-fecha-cal' : ''),
              esVigente ? calendarioMini(e.compromiso, true) : null,
              'Fecha compromiso: ' + fechaBonita(e.compromiso)) : null));
      // Vigente ya CERRADA (esperando su siguiente): el chip del cierre
      // sustituye al semaforo y a los dias.
      const cierreVig = vigente && vigente.cierre;
      const hayEstatus = vigente && vigente.compromiso && refCierre !== null && !cierreVig;
      const datoDias = hayEstatus
        ? h('span', 'Dias para vencimiento: ', chipDias(diasPara(vigente.compromiso, refCierre)))
        : (cierreVig ? chipCierre(vigente.cierre) : null);
      // OJO: append(null) pinta el texto "null" (h() si filtra nulos);
      // aqui los condicionales entregan null, se filtran antes de anexar.
      const claveCreada = fechaClave(new Date(v.creado));
      const partes = [
        // Cabecera CALCADA de la tarjeta del tablero (pedido de Vale):
        // F1 vendedor | prioridad | % (misma rejilla, prioridad al centro
        // exacto); F2 la fecha de creacion con su calendarito REAL (el
        // cliente subio a la cabecera de la hoja, junto al titulo).
        h('div.venta-detalle-cab',
          h('div.venta-carta__f1',
            veTodas && v.dueno
              ? h('p.venta-dueno', avatarVendedor(v.dueno), h('span.venta-dueno__nombre', sinApellido(v.dueno)))
              : h('span'),
            prioridadValida(v.prioridad)
              ? h('span.venta-prio-badge.venta-prio-badge--' + COLOR_PRIO[v.prioridad[0]], v.prioridad)
              : h('span'),
            h('span.venta-cal-solo.' + claseCal(cal), cal + '%')),
          h('p.venta-linea-creada',
            calendarioMini(claveCreada, true),
            h('span.venta-carta__etiqueta', 'Fecha de creacion: '),
            h('span.venta-carta__pie-fecha', fechaCorta(claveCreada))),
          v.cerrada ? h('p.venta-meta', 'CERRADA' + (v.cerrado ? ' el ' + fechaDeTs(v.cerrado) : '')) : null,
          enRevision(v) ? h('p.venta-meta.venta-meta--revision', '🔔 CONCLUIDA — EN REVISION DEL LIDER') : null),
        pv.gestionar ? h('button.btn.btn--fantasma.venta-btn-mini', {
          type: 'button',
          onclick: async () => {
            const datos = await hojaEditarOportunidad(v);
            if (!datos) return;
            const { prioridadLetra, ...resto } = datos;
            Object.assign(v, resto);
            await db.ventaGuardar(v);
            await asignarPrioridad(v, prioridadLetra);
            pinta();
            alCambiar();
          },
        }, '✎  EDITAR OPORTUNIDAD') : null,

        // EVIDENCIA de la venta completada (arriba: es lo que el lider
        // viene a revisar); tras aprobarse queda visible en el historial.
        v.conclusion ? h('h3.venta-grupo', '📎 EVIDENCIA DE VENTA',
          h('span.sem-dato', v.conclusion.tipo)) : null,
        v.conclusion ? seccionEvidencia(v) : null,
        enRevision(v) && permisos.gestionar ? h('button.btn.btn--primario.venta-btn', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmar('¿Aprobar la venta "' + v.titulo + '"? Se cierra con calificacion ' + calificacion(v) + '% y pasa al historial.', { textoOk: 'Aprobar', peligro: false }))) return;
            v.conclusion.revisada = true;
            v.cerrada = true;
            v.cerrado = db.marcaDeTiempo();
            await db.ventaGuardar(v);
            pinta();
            alCambiar();
          },
        }, '✔  APROBAR Y CERRAR VENTA') : null,
        enRevision(v) && permisos.gestionar ? h('button.btn.btn--fantasma.venta-btn', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmar('¿Devolver "' + v.titulo + '" al vendedor? La conclusion se descarta y debera registrar la siguiente accion.', { textoOk: 'Devolver', peligro: true }))) return;
            delete v.conclusion;
            v.pendienteAccion = { ts: db.marcaDeTiempo(), porId: v.duenoId || '' };
            await db.ventaGuardar(v);
            pinta();
            alCambiar();
          },
        }, '↩  DEVOLVER AL VENDEDOR') : null,

        // Solo ACCIONES: ni los atrasos (su presentacion esta por definirse
        // con Vale) ni el "Oportunidad creada" legado se listan aqui —
        // ambos siguen contando para la calificacion segun sus reglas.
        // Titulos de seccion con el MISMO formato de grupo del tablero.
        // ACCION ACTUAL lleva su ESTATUS a la derecha (sin los dias: esos
        // van aparte, en "Dias para vencimiento" — regla de Vale).
        h('h3.venta-grupo', '⚡ ACCION ACTUAL',
          hayEstatus ? chipEstadoCompromiso(vigente.compromiso, refCierre, true) : null,
          cierreVig ? chipCierre(vigente.cierre) : null),
        vigente
          ? h('div.venta-historial', eventoEl(vigente, true, datoDias))
          : h('p.pista', 'Aun no hay acciones. Agrega la primera.'),
        // El HISTORIAL lleva el % de acciones completadas A TIEMPO con
        // los colores del semaforo (pedido de Vale).
        anteriores.length ? h('h3.venta-grupo', '📜 HISTORIAL DE ACCIONES',
          h('span.venta-cal-solo.' + claseCal(pctATiempo), pctATiempo + '%')) : null,
        anteriores.length ? h('div.venta-historial', ...anteriores.map(x =>
          eventoEl(x.e, false, h('span.venta-estado-chip.venta-estado-chip--' + x.estado.clase, x.estado.texto)))) : null,
        pv.accionar ? h('button.btn.btn--primario.venta-btn', {
          type: 'button',
          onclick: async () => {
            const accion = await hojaNuevaAccion(v, await contactosDe(v.cliente, v.sede), await contactosGlobales());
            if (!accion) return;
            v.historial.push({ ts: db.marcaDeTiempo(), fecha: fechaClave(), tipo: 'estatus', texto: accion.texto, contacto: accion.contacto || '', compromiso: accion.fecha || '' });
            await db.ventaGuardar(v);
            pinta();
            alCambiar();
          },
        }, '✚  AGREGAR ACCION') : null,

        // Acciones y anotaciones son DOS cosas distintas: el subrayado
        // del titulo de grupo (como en el tablero) marca la frontera.
        h('h3.venta-grupo', '💡 ANOTACIONES',
          (v.anotaciones || []).length ? h('span.sem-dato',
            v.anotaciones.length + (v.anotaciones.length === 1 ? ' anotacion' : ' anotaciones')) : null),
        (v.anotaciones || []).length
          ? h('div.venta-notas',
            (v.anotaciones || []).slice().reverse().map(n =>
              h('div.venta-nota',
                h('span.venta-evento__fecha', fechaBonita(n.fecha)),
                h('span.venta-nota__texto', n.texto),
                pv.gestionar ? h('span.venta-evento__tools',
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
        pv.accionar ? h('button.btn.btn--fantasma.venta-btn-mini', {
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
        // agregan pero no tocan lo ya registrado. En revision no aparece:
        // ahi el cierre es APROBAR (arriba, junto a la evidencia).
        permisos.gestionar && !v.cerrada && !enRevision(v) ? h('button.btn.btn--fantasma.venta-btn', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmar('¿Cerrar la oportunidad "' + v.titulo + '"? Su calificacion queda en ' + calificacion(v) + '%.', { textoOk: 'Cerrar', peligro: false }))) return;
            v.cerrada = true;
            v.cerrado = db.marcaDeTiempo();   // para ordenar el historial
            await db.ventaGuardar(v);
            pinta();
            alCambiar();
          },
        }, '✔  CERRAR OPORTUNIDAD') : null,
        // En el HISTORIAL lo unico vivo es REACTIVAR (solo el lider o el
        // admin): la oportunidad regresa al tablero de abiertas.
        permisos.gestionar && v.cerrada ? h('button.btn.btn--fantasma.venta-btn', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmar('¿Reactivar la oportunidad "' + v.titulo + '"? Regresa al tablero de abiertas.', { textoOk: 'Reactivar', peligro: false }))) return;
            v.cerrada = false;
            delete v.cerrado;
            await db.ventaGuardar(v);
            // Su numero de prioridad pudo tomarlo otra abierta mientras
            // estuvo cerrada: retoma el siguiente libre de su letra.
            if (prioridadValida(v.prioridad)) {
              const letra = v.prioridad[0];
              v.prioridad = '';
              await asignarPrioridad(v, letra);
            }
            pinta();
            alCambiar();
          },
        }, '↺  REACTIVAR OPORTUNIDAD') : null,
      ];
      vaciar(cuerpo).append(...partes.filter(Boolean));
      actualizarGafete();
    };
    pinta();
    return cuerpo;
  }, { altura: 'completa' });   // la oportunidad se ve a PANTALLA COMPLETA
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
    const s = sedeBonita(sede);   // "N/A" y vacio son la misma no-sede
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
  // Contactos agregados A MANO en el directorio (viven como fichas).
  try {
    for (const f of await db.contactosFichasTodas()) {
      if (!f.cliente || !f.nombre) continue;
      const sede = asegura(f.cliente, f.sede);
      if (sede && !sede.contactos.has(f.nombre.toLowerCase())) sede.contactos.set(f.nombre.toLowerCase(), f.nombre);
    }
  } catch (e) { /* sin fichas */ }
  return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// GAFETE flotante de grupo (mismo mecanismo que el arbol de Servicio):
// al scrollear una lista agrupada larga, una pastilla bajo la cabecera
// dice en QUE grupo vas cuando su titulo ya no esta a la vista. Lo usan
// el tablero (vendedor con su avatar, cliente, prioridad), el directorio
// y el detalle de la oportunidad (enHoja: cabecera y z-index de la hoja).
function montarGafete(contenedor, cont, enHoja) {
  const gafete = h('div.rama-flotante.rama-flotante--ventas' + (enHoja ? '.rama-flotante--hoja' : ''),
    { style: { display: 'none' } });
  contenedor.append(gafete);
  const cabeceraEl = contenedor.querySelector(enHoja ? 'header.hoja__titulo' : 'header.cabecera');
  const actualizar = () => {
    const limite = cabeceraEl.getBoundingClientRect().bottom;
    let actual = null;
    for (const g of cont.querySelectorAll('h3.venta-grupo')) {
      if (g.getBoundingClientRect().top <= limite + 8) actual = g;
      else break;
    }
    if (!actual || actual.getBoundingClientRect().bottom > limite) {
      gafete.style.display = 'none';   // sin grupos, o el titulo aun se ve
      return;
    }
    // Agrupado por VENDEDOR: su avatar de iniciales en lugar del emoji.
    const partes = (actual.dataset.tipo === 'vendedor' && actual.dataset.grupo)
      ? [avatarVendedor(actual.dataset.grupo), h('strong', actual.dataset.grupo)]
      : [h('strong', actual.childNodes[0].textContent)];
    const dato = (actual.querySelector('.sem-dato') || { textContent: '' }).textContent;
    gafete.replaceChildren(...[...partes, dato ? h('span', '· ' + dato) : null].filter(Boolean));
    gafete.style.top = (limite + 6) + 'px';
    gafete.style.display = '';
  };
  let marco = null;
  cont.addEventListener('scroll', () => {
    if (marco) return;
    marco = requestAnimationFrame(() => { marco = null; actualizar(); });
  }, { passive: true });
  return actualizar;
}

// FICHA del contacto: cargo, correo y telefono viven en su propio store
// (db.contactoFicha*), colgados de la clave cliente|sede|nombre. Editar
// es SOLO para quien tenga el permiso especial (o el admin); eliminar
// no existe (regla de Vale).
function claveContacto(cliente, sede, nombre) {
  return (cliente + '|' + (sede || '') + '|' + nombre).toLowerCase();
}

// AGREGAR contacto a una empresa·sede: lo puede hacer CUALQUIERA que vea
// el directorio (editar si es con permiso; eliminar no existe).
function hojaNuevoContacto(cliente, sede) {
  return hoja('＋  Nuevo contacto', (cerrar) => {
    const cNombre = campo('Nombre', { maxLength: 80, placeholder: 'p. ej. Ing. Perez' });
    const cCargo = campo('Cargo', { maxLength: 80, placeholder: 'p. ej. Jefe de mantenimiento' });
    const cCorreo = campo('Correo(s)', { maxLength: 160, placeholder: 'correo@empresa.com' });
    const cTel = campo('Telefono(s)', { maxLength: 120, placeholder: '722 000 0000' });
    return h('div',
      h('p.pista', cliente + (sede ? ' ' + sede : '')),
      cNombre, cCargo, cCorreo, cTel,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => {
            const nombre = cNombre.querySelector('input').value.trim();
            if (!nombre) { aviso('Escribe el nombre del contacto.', 'error'); return; }
            cerrar({
              nombre,
              cargo: cCargo.querySelector('input').value.trim(),
              correo: cCorreo.querySelector('input').value.trim(),
              telefono: cTel.querySelector('input').value.trim(),
            });
          },
        }, 'Guardar')));
  });
}

function hojaEditarContacto(ficha) {
  return hoja('✎  ' + ficha.nombre, (cerrar) => {
    const cCargo = campo('Cargo', { maxLength: 80, value: ficha.cargo || '', placeholder: 'p. ej. Jefe de mantenimiento' });
    const cCorreo = campo('Correo(s)', { maxLength: 160, value: ficha.correo || '', placeholder: 'correo@empresa.com' });
    const cTel = campo('Telefono(s)', { maxLength: 120, value: ficha.telefono || '', placeholder: '722 000 0000' });
    return h('div',
      cCargo, cCorreo, cTel,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => cerrar({
            cargo: cCargo.querySelector('input').value.trim(),
            correo: cCorreo.querySelector('input').value.trim(),
            telefono: cTel.querySelector('input').value.trim(),
          }),
        }, 'Guardar')));
  });
}

async function hojaContacto(cliente, sede, nombre, puedeEditar) {
  const clave = claveContacto(cliente, sede, nombre);
  const ficha = (await db.contactoFicha(clave))
    || { clave, nombre, cliente, sede: sede || '', cargo: '', correo: '', telefono: '' };
  await hoja('👤  ' + nombre, (cerrar) => {
    const cuerpo = h('div');
    const dato = (etq, val) => h('p.contacto-dato',
      h('span.venta-carta__etiqueta', etq + ': '),
      val || h('span.venta-carta__accion--vacia', 'Sin registrar'));
    const pinta = () => {
      vaciar(cuerpo).append(...[
        h('p.pista', cliente + (sede ? ' · ' + sede : '')),
        dato('Cargo', ficha.cargo),
        dato('Correo', ficha.correo),
        dato('Telefono', ficha.telefono),
        puedeEditar ? h('button.btn.btn--fantasma.venta-btn-mini', {
          type: 'button',
          onclick: async () => {
            const nuevos = await hojaEditarContacto(ficha);
            if (!nuevos) return;
            Object.assign(ficha, nuevos);
            await db.contactoFichaGuardar(ficha);
            pinta();
          },
        }, '✎  EDITAR CONTACTO') : null,
      ].filter(Boolean));
    };
    pinta();
    return cuerpo;
  });
}

async function renderDirectorio(contenedor) {
  const yo = await quienSoy();
  // Sin flecha de regreso (pedido de Vale): se vuelve con el atras del
  // telefono; anclarCapa/rutas ya recorren la jerarquia correcta.
  contenedor.append(h('header.cabecera',
    h('div.cabecera__fila',
      h('h1', '📇 Directorio de clientes'),
    )));
  const cont = h('div.contenido.diario');
  contenedor.append(cont);
  const actualizarGafete = montarGafete(contenedor, cont);

  if (!veDirectorio(yo)) {
    cont.append(h('div.diario-carta', h('p.pista',
      'El directorio de clientes lo ven Ventas y Administracion. Si te falta depto, pide al administrador que te lo asigne en ⚙.')));
    return;
  }

  // Mismo formato que el tablero (pedido de Vale): grupo por EMPRESA ·
  // SEDE con el numero de contactos a la derecha, y cada contacto en su
  // tarjeta como las oportunidades. Tocar la tarjeta abre su FICHA
  // (cargo, correo, telefono); editarla es solo con permiso especial;
  // AGREGAR contacto lo puede hacer cualquiera del directorio.
  const puedeEd = puedeEditarContactos(yo);
  const pintar = async () => {
    vaciar(cont);
    const clientes = await directorioClientes();
    if (!clientes.length) {
      cont.append(h('div.diario-carta', h('p.pista', 'Aun no hay clientes dados de alta.')));
      return;
    }
    for (const c of clientes) {
      // Sedes con nombre primero (alfabetico); la "sin sede" al FINAL (el
      // viejo truco del '~' las mandaba al principio en collation es).
      const sedes = [...c.sedes.values()].sort((a, b) =>
        (!a.nombre - !b.nombre) || a.nombre.localeCompare(b.nombre, 'es'));
      for (const s of sedes) {
        const contactos = [...s.contactos.values()].sort((a, b) => a.localeCompare(b, 'es'));
        // Empresa y sede en MAYUSCULAS y seguidas, sin punto (pedido de
        // Vale — igual que en la tarjeta del tablero).
        cont.append(h('h3.venta-grupo', '🏢 ' + (c.nombre + (s.nombre ? ' ' + s.nombre : '')).toUpperCase(),
          h('span.sem-dato', contactos.length + ' contacto' + (contactos.length === 1 ? '' : 's'))));
        for (const nombre of contactos) {
          cont.append(h('button.venta-carta', {
            type: 'button',
            onclick: () => hojaContacto(c.nombre, s.nombre, nombre, puedeEd),
          }, h('p.venta-dueno', avatarVendedor(nombre), h('span.venta-dueno__nombre', nombre))));
        }
        cont.append(h('button.btn.btn--fantasma.venta-btn-mini', {
          type: 'button',
          onclick: async () => {
            const datos = await hojaNuevoContacto(c.nombre, s.nombre);
            if (!datos) return;
            if (s.contactos.has(datos.nombre.toLowerCase())) {
              aviso('Ese contacto ya existe en esta sede.', 'error');
              return;
            }
            const { nombre, ...resto } = datos;
            await db.contactoFichaGuardar({
              clave: claveContacto(c.nombre, s.nombre, nombre),
              nombre, cliente: c.nombre, sede: s.nombre || '', ...resto,
            });
            await pintar();
          },
        }, '＋  Agregar contacto'));
      }
    }
    cont.append(h('p.pista', 'Los contactos se registran solos con cada accion de venta y tambien puedes agregarlos aqui; editar su ficha es solo con permiso.'));
    actualizarGafete();
  };
  await pintar();
}

/* ---------------------------------------------------------------- */
/* Tarjeta de oportunidad (compartida por tablero e historial)       */
/* ---------------------------------------------------------------- */

// Tarjeta por FILAS (pedido de Vale, con terminologia Office):
//   F1: vendedor | PRIORIDAD | % — centrados verticalmente entre si; la
//       prioridad EXACTAMENTE al centro horizontal de la tarjeta, en
//       hexagono (forma distintiva, distinta del %).
//   F2: CLIENTE alineado con el chip de estatus.
//   F3: el titulo (1 o 2 renglones, los que use; nunca mas de 2).
//   F4: "Accion Actual: " + la descripcion.
//   F5: "Ultima fecha compromiso: dd/mm/aa" (tamano de la descripcion) y
//       el calendarito hasta la derecha, alineados ON BOTTOM.
// El contacto y la fecha de creacion viven SOLO en el detalle.
// Colores de prioridad (regla de Vale, 31 ago 2026): A=verde, B=amarillo,
// C=rojo claro — el mismo hexagono en tarjeta y en la cabecera del detalle.
const COLOR_PRIO = { A: 'verde', B: 'ambar', C: 'rojo' };

// La sede solo se muestra cuando dice algo: vacia o "N/A" no aparece
// (pedido de Vale).
function sedeBonita(sede) {
  const s = (sede || '').trim();
  return s.toUpperCase() === 'N/A' ? '' : s;
}

// En la tarjeta el vendedor va SIN apellido (pedido de Vale): fuera la
// ultima palabra cuando el nombre trae mas de una.
function sinApellido(nombre) {
  const partes = (nombre || '').trim().split(/\s+/);
  return partes.length > 1 ? partes.slice(0, -1).join(' ') : (nombre || '');
}

// Avatar del vendedor: PLACEHOLDER con iniciales por ahora — aqui ira su
// FOTO cuando la organizacion la tenga.
function avatarVendedor(nombre) {
  const partes = (nombre || '').trim().split(/\s+/);
  const ini = partes.length >= 2
    ? partes[0][0] + partes[partes.length - 1][0]
    : (partes[0] || '?').slice(0, 2);
  return h('span.venta-avatar', ini.toUpperCase());
}
function tarjetaVenta(v, veTodas, permisos, alCambiar) {
  const comp = compromisoVigente(v);
  // La ACCION ACTUAL (misma regla que el detalle): ultima accion real.
  const acciones = (v.historial || []).filter(e => e.tipo === 'estatus' && !esCreacionLegada(e));
  const vigente = acciones[acciones.length - 1] || null;
  const cal = calificacion(v);
  return h('button.venta-carta' + (v.cerrada ? '.venta-carta--cerrada' : ''), {
    type: 'button',
    onclick: () => hojaDetalle(v, permisos, alCambiar),
  },
    h('div.venta-carta__f1',
      veTodas && v.dueno
        ? h('p.venta-dueno', avatarVendedor(v.dueno), h('span.venta-dueno__nombre', sinApellido(v.dueno)))
        : h('span'),
      prioridadValida(v.prioridad)
        ? h('span.venta-prio-badge.venta-prio-badge--' + COLOR_PRIO[v.prioridad[0]], v.prioridad)
        : h('span'),
      h('span.venta-cal-solo.' + claseCal(cal), cal + '%')),
    h('div.venta-carta__f2',
      h('span.venta-carta__cliente', v.cliente + (sedeBonita(v.sede) ? ' ' + sedeBonita(v.sede) : '')),
      // Abiertas: estatus contra HOY. Cerradas (historial): estatus
      // CONGELADO al dia del cierre (si cerro en tiempo, ahi se queda).
      comp && (!v.cerrada || v.cerrado)
        ? chipEstadoCompromiso(comp, v.cerrada ? fechaClave(new Date(v.cerrado)) : '')
        : null),
    h('p.venta-carta__titulo', v.titulo),
    h('p.venta-carta__accion',
      h('span.venta-carta__etiqueta', 'Accion Actual: '),
      vigente ? vigente.texto : h('span.venta-carta__alerta', 'SIN ACCIONES REGISTRADAS')),
    h('div.venta-carta__pie',
      // Etiqueta y fecha en un mismo flujo: la etiqueta es indivisible
      // (nowrap) y si el ancho no da, la fecha baja COMPLETA al segundo
      // renglon en vez de partir la etiqueta a media palabra.
      comp
        ? h('span.venta-carta__pie-texto',
          h('span.venta-carta__etiqueta', 'Ultima fecha compromiso: '),
          h('span.venta-carta__pie-fecha', fechaCorta(comp)))
        : h('span.venta-carta__pie-texto',
          h('span.venta-carta__alerta', 'SIN FECHA COMPROMISO')),
      comp ? calendarioMini(comp) : null));
}

/* ---------------------------------------------------------------- */
/* Historial de ventas (las oportunidades cerradas)                  */
/* ---------------------------------------------------------------- */

async function renderHistorial(contenedor) {
  const yo = await quienSoy();
  const permisos = {
    crear: puedeCrearVentas(yo),
    accionar: puedeAccionarVentas(yo),
    gestionar: puedeGestionarVentas(yo),
  };
  const veTodas = veTodasLasVentas(yo);

  contenedor.append(h('header.cabecera',
    h('div.cabecera__fila',
      h('h1', '📜 Historial de ventas'),
    )));
  const cont = h('div.contenido.diario');
  contenedor.append(cont);

  if (!veTablero(yo)) {
    cont.append(h('div.diario-carta', h('p.pista',
      'Las oportunidades de venta solo las ve el equipo de Ventas. El estatus del depto esta en 🏢 Organizacion.')));
    return;
  }

  const pintar = async () => {
    vaciar(cont);
    // Misma caja cerrada del tablero: el vendedor solo ve SU historial;
    // la mas recientemente cerrada va primero. (Y la misma migracion de
    // fechas compromiso, por si se recarga directo en el historial.)
    const todas = await db.ventasTodas();
    await asignarCompromisosFaltantes(todas);
    const cerradas = todas
      .filter(v => v.cerrada && (veTodas || (yo && v.duenoId === yo.id)))
      .sort((a, b) => (b.cerrado || b.creado || 0) - (a.cerrado || a.creado || 0));

    if (!cerradas.length) {
      cont.append(h('div.diario-carta', h('p.pista',
        'Aun no hay oportunidades cerradas. Cuando se cierre una, aqui queda guardada.')));
      return;
    }

    const prom = Math.round(cerradas.reduce((s, v) => s + calificacion(v), 0) / cerradas.length);
    cont.append(h('p.sem-total', cerradas.length + ' cerrada' + (cerradas.length === 1 ? '' : 's') + ' · calificacion promedio ' + prom + '%'));
    for (const v of cerradas) cont.append(tarjetaVenta(v, veTodas, permisos, pintar));
  };
  await pintar();
}

/* ---------------------------------------------------------------- */
/* Tablero                                                           */
/* ---------------------------------------------------------------- */

export async function render(contenedor, refrescar, params = {}) {
  if (params.sub === 'dir') return renderDirectorio(contenedor);
  if (params.sub === 'hist') return renderHistorial(contenedor);

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
      h('h1', '💲 Ventas'),
      // El directorio vive en la cabecera (pedido de Vale); el letrero de
      // "cajas" se fue — el filtro por vendedor ya cuenta esa historia.
      veDirectorio(yo) ? h('button.btn.btn--fantasma.btn--pequeno.cabecera__accion', {
        type: 'button', onclick: () => { location.hash = '#/d/ventas/dir'; },
      }, '📇  DIRECTORIO') : null
    )));
  const cont = h('div.contenido.diario');
  contenedor.append(cont);

  const actualizarGafete = montarGafete(contenedor, cont);

  // Las oportunidades SOLO las ve el equipo de Ventas (y el admin); los
  // porcentajes del depto siguen siendo publicos en Organizacion.
  if (!veTablero(yo)) {
    cont.append(h('div.diario-carta', h('p.pista',
      'Las oportunidades de venta solo las ve el equipo de Ventas. El estatus del depto esta en 🏢 Organizacion.')));
    return;
  }

  let filtroCliente = '';
  let filtroVendedor = '';
  // El aviso de "concluidas por revisar" (lider) suena UNA vez por visita.
  let avisoRevision = false;
  // Controles del lider (regla de Vale): AGRUPAR elegible (vendedor,
  // cliente, prioridad o nada) y orden elegible.
  let agruparPor = 'vendedor';
  let ordenarPor = 'prioridad';
  const AGRUPARES = [
    ['vendedor', 'Vendedor'],
    ['cliente', 'Cliente'],
    ['prioridad', 'Prioridad'],
    ['', 'Sin agrupar'],
  ];
  // Filtros por estado del compromiso (checkboxes): prendidos los dos
  // se ven ambas (vencidas + cerca de vencer).
  let soloVencidas = false;
  let soloPorVencer = false;
  // "Dias de atraso" se fue (pedido de Vale): ordenaba igual que la
  // fecha compromiso, solo que al reves.
  const ORDENES = [
    ['prioridad', 'Prioridad'],
    ['compromiso', 'Fecha compromiso'],
    ['creacion', 'Fecha de creacion'],
  ];

  const pintar = async () => {
    const todasLasVentas = await db.ventasTodas();
    await asignarCompromisosFaltantes(todasLasVentas);
    await registrarAtrasos(todasLasVentas);
    vaciar(cont);

    // Filtrado de caja: lo visible para quien mira.
    const ventas = todasLasVentas.filter(v => veTodas || (yo && v.duenoId === yo.id));
    // El tablero lista SOLO abiertas; las cerradas viven en el HISTORIAL
    // (boton al pie), asi que filtros y conteos salen de las abiertas.
    const abiertas = ventas.filter(v => !v.cerrada);

    const clientes = [...new Set(abiertas.map(v => v.cliente))].sort((a, b) => a.localeCompare(b));

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
          // El lider/admin puede ASIGNAR la oportunidad a cualquiera del
          // equipo de Ventas (el mismo primero); un vendedor crea la suya.
          let vendedores = null;
          if (permisos.gestionar && yo) {
            const equipo = (await organizacion()).usuarios
              .filter(u => u.depto === 'Ventas' && u.id !== yo.id)
              .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
            vendedores = [{ id: yo.id, nombre: yo.nombre },
              ...equipo.map(u => ({ id: u.id, nombre: u.nombre }))];
          }
          const datos = await hojaNuevaOportunidad(await clientesGlobales(), vendedores);
          if (!datos) return;
          // Se guarda de inmediato (sin forzar la primera accion) y la
          // oportunidad queda ABIERTA con su boton ✚ para agregarla.
          const { prioridadLetra, vendedor, ...restoDatos } = datos;
          const dueno = vendedor || (yo ? { id: yo.id, nombre: yo.nombre } : { id: '', nombre: '' });
          const v = {
            id: db.nuevoId(), ...restoDatos, prioridad: '', cerrada: false, creado: db.marcaDeTiempo(),
            duenoId: dueno.id, dueno: dueno.nombre,
            anotaciones: [],
            historial: [],
          };
          await db.ventaGuardar(v);
          // La letra elegida toma el siguiente numero libre de su fila.
          if (prioridadLetra) await asignarPrioridad(v, prioridadLetra);
          // cliente y sede nuevos → al catalogo global de toda la app
          try { await db.maquinaRecordar({ cliente: datos.cliente, planta: datos.sede }); } catch (e) { /* opcional */ }
          await pintar();
          hojaDetalle(v, permisos, pintar);
        },
      }, '✚  NUEVA') : null));

    // Filtro por VENDEDOR (solo la vista del lider ve todas las cajas).
    if (veTodas) {
      const duenos = [...new Set(abiertas.map(v => v.dueno).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      const haySinDueno = abiertas.some(v => !v.dueno);
      const selVendedor = h('select.org-select.venta-filtro',
        h('option', { value: '' }, 'Todos los vendedores'),
        ...duenos.map(d => h('option', { value: d, selected: filtroVendedor === d }, d)),
        haySinDueno ? h('option', { value: '__sin__', selected: filtroVendedor === '__sin__' }, 'Sin vendedor') : null);
      selVendedor.onchange = () => { filtroVendedor = selVendedor.value; pintar(); };
      cont.append(h('div.gd-nav', selVendedor));

      // Debajo del filtro: agrupar (izq) y ordenar por (der), ambos select.
      const selAgrupar = h('select.org-select',
        ...AGRUPARES.map(([val, n]) => h('option', { value: val, selected: agruparPor === val }, n)));
      selAgrupar.onchange = () => { agruparPor = selAgrupar.value; pintar(); };
      const selOrden = h('select.org-select',
        ...ORDENES.map(([val, n]) => h('option', { value: val, selected: ordenarPor === val }, n)));
      selOrden.onchange = () => { ordenarPor = selOrden.value; pintar(); };
      cont.append(h('div.venta-controles',
        h('label.venta-ordenar', 'Agrupar por', selAgrupar),
        h('label.venta-ordenar', 'Ordenar por', selOrden)));

      // Fila de filtros por estado (mismos umbrales que el chip).
      const chkVencidas = h('input', { type: 'checkbox' });
      chkVencidas.checked = soloVencidas;
      chkVencidas.onchange = () => { soloVencidas = chkVencidas.checked; pintar(); };
      const chkPorVencer = h('input', { type: 'checkbox' });
      chkPorVencer.checked = soloPorVencer;
      chkPorVencer.onchange = () => { soloPorVencer = chkPorVencer.checked; pintar(); };
      cont.append(h('div.venta-controles.venta-controles--filtros',
        h('label.venta-agrupar', chkVencidas, 'Ver solo vencidas'),
        h('label.venta-agrupar', chkPorVencer, 'Ver solo cerca de vencer')));
    }

    // CONCLUIDAS POR REVISAR (pedido de Vale): el vendedor marco la venta
    // como completada con evidencia y el LIDER debe revisarla. Van en su
    // seccion aparte (sin filtros: es una bandeja de pendientes) y no
    // cuentan en la lista ni en el promedio.
    const porRevisar = abiertas.filter(v => enRevision(v));
    if (porRevisar.length) {
      cont.append(h('h3.venta-grupo', '🔔 CONCLUIDAS POR REVISAR',
        h('span.sem-dato', porRevisar.length + (porRevisar.length === 1 ? ' venta' : ' ventas'))));
      for (const v of porRevisar) cont.append(tarjetaVenta(v, veTodas, permisos, pintar));
      // La "notificacion" del lider: un aviso al entrar al tablero.
      if (permisos.gestionar && !avisoRevision) {
        avisoRevision = true;
        aviso('🔔 ' + (porRevisar.length === 1 ? 'Hay una venta concluida' : 'Hay ' + porRevisar.length + ' ventas concluidas') + ' por revisar.');
      }
    }

    let lista = abiertas.filter(v => !enRevision(v) && (!filtroCliente || v.cliente === filtroCliente));
    if (veTodas && filtroVendedor) {
      lista = lista.filter(v => filtroVendedor === '__sin__' ? !v.dueno : v.dueno === filtroVendedor);
    }
    // Checkboxes del lider: dejar solo lo vencido y/o lo cerca de vencer
    // (sin fecha compromiso no entra en ninguno de los dos).
    if (soloVencidas || soloPorVencer) {
      lista = lista.filter(v => {
        const comp = compromisoVigente(v);
        if (!comp) return false;
        const dias = diasPara(comp);
        return (soloVencidas && dias < 0) || (soloPorVencer && dias >= 0 && dias < 3);
      });
    }

    // Orden segun el criterio elegido (lider); los vendedores conservan
    // el clasico: fecha compromiso y luego prioridad.
    const criterio = veTodas ? ordenarPor : 'compromiso';
    const porCompromiso = (a, b) => {
      const fa = compromisoVigente(a) || '9999';
      const fb = compromisoVigente(b) || '9999';
      return fa < fb ? -1 : fa > fb ? 1 : 0;
    };
    const porPrioridad = (a, b) => {
      const pa = clavePrio(a), pb = clavePrio(b);
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    };
    lista.sort((a, b) => {
      if (criterio === 'prioridad') return porPrioridad(a, b) || porCompromiso(a, b);
      if (criterio === 'creacion') return (b.creado || 0) - (a.creado || 0);
      return porCompromiso(a, b) || porPrioridad(a, b);
    });

    // El HISTORIAL (cerradas) siempre al pie, haya lo que haya arriba.
    const btnHistorial = h('button.btn.btn--fantasma.venta-abrir', {
      type: 'button', onclick: () => { location.hash = '#/d/ventas/hist'; },
    }, '📜  HISTORIAL');

    if (!lista.length) {
      const hayFiltro = filtroCliente || filtroVendedor || soloVencidas || soloPorVencer;
      cont.append(h('div.diario-carta', h('p.pista', hayFiltro
        ? 'Sin oportunidades abiertas con estos filtros.'
        : (ventas.length
          ? 'Sin oportunidades abiertas; las cerradas viven en el historial.'
          : (permisos.crear
            ? 'Aun no hay oportunidades de venta. Crea la primera con ✚ NUEVA.'
            : 'Aun no hay oportunidades de venta. Las crea el lider de Ventas.')))));
      cont.append(btnHistorial);
      return;
    }

    const prom = Math.round(lista.reduce((s, v) => s + calificacion(v), 0) / lista.length);
    cont.append(h('p.sem-total', lista.length + ' abierta' + (lista.length === 1 ? '' : 's') + ' · calificacion promedio ' + prom + '%'));

    // Sin agrupar (vendedor, o lider con "Sin agrupar"): lista corrida.
    if (!veTodas || !agruparPor) {
      for (const v of lista) cont.append(tarjetaVenta(v, veTodas, permisos, pintar));
    } else {
      // Vista del lider: AGRUPADAS por el criterio elegido (los "sin"
      // siempre al final; con prioridad el orden A, B, C sale solo).
      const ICONO_GRUPO = { vendedor: '🧑‍🔧 ', cliente: '🏢 ', prioridad: '🎯 ' };
      const claveDe = (v) => {
        if (agruparPor === 'cliente') {
          return ((v.cliente || 'Sin cliente') + (sedeBonita(v.sede) ? ' ' + sedeBonita(v.sede) : '')).toUpperCase();
        }
        if (agruparPor === 'prioridad') {
          return prioridadValida(v.prioridad) ? 'Prioridad ' + v.prioridad[0] : 'Sin prioridad';
        }
        return v.dueno || 'Sin vendedor';
      };
      const grupos = new Map();
      for (const v of lista) {
        const clave = claveDe(v);
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(v);
      }
      const nombres = [...grupos.keys()].sort((a, b) =>
        a.startsWith('Sin ') - b.startsWith('Sin ') || a.localeCompare(b, 'es'));
      for (const nombre of nombres) {
        const suyas = grupos.get(nombre);
        const promG = Math.round(suyas.reduce((s, v) => s + calificacion(v), 0) / suyas.length);
        const cabGrupo = h('h3.venta-grupo', ICONO_GRUPO[agruparPor] + nombre,
          h('span.sem-dato', suyas.length + ' abierta' + (suyas.length === 1 ? '' : 's') + ' · ' + promG + '%'));
        // El gafete flotante lee de aqui QUE es el grupo (para poner el
        // avatar del vendedor con sus iniciales, pedido de Vale).
        cabGrupo.dataset.tipo = agruparPor;
        cabGrupo.dataset.grupo = nombre;
        cont.append(cabGrupo);
        for (const v of suyas) cont.append(tarjetaVenta(v, veTodas, permisos, pintar));
      }
    }

    cont.append(btnHistorial);
    actualizarGafete();
  };

  await pintar();
}
