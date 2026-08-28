// Pantalla inicial: lista de trabajos (servicios, pruebas de laboratorio, generales).

import * as db from '../db.js';
import { h, campo, campoArea, hoja, aviso, confirmar, fecha, vacio } from '../ui.js';
import * as media from '../media.js';
import { APP_VERSION } from '../version.js';
import { temaActual, alternarTema, zoomActual, aplicarZoom } from '../tema.js';

// Catalogo precargado: clientes y maquinas conocidos aunque el telefono aun
// no tenga historial propio. El primero es el del reporte de referencia.
// El historial real siempre tiene prioridad sobre esto.
const PRECARGADOS = [
  {
    cliente: 'CLIENTE',
    planta: 'PLANTA',
    marca: 'HUSKY',
    modelo: 'H400 RS65/60',
    serie: '0000000',
    noMaquina: '',
  },
];

const norm = (x) => (x || '').trim().toLowerCase();

// Las sugerencias salen del CATALOGO de maquinas (administrable en ⚙
// Configuracion). La primera vez se siembra con lo precargado y con los
// servicios ya capturados; despues cada servicio nuevo/editado lo alimenta.
async function historialServicios() {
  if (!(await db.ajusteLeer('catalogoMaquinas1', false))) {
    for (const m of PRECARGADOS) await db.maquinaRecordar(m);
    for (const t of await db.serviciosTodos()) {
      if ((t.tipo || 'servicio') === 'servicio') await db.maquinaRecordar(t);
    }
    await db.ajusteGuardar('catalogoMaquinas1', true);
  }
  return db.maquinasCatalogo();
}

// Valores distintos de un campo, filtrados por lo ya elegido, en orden a-z.
function distintosDe(historial, campoDe, filtro) {
  const vistos = new Map();
  for (const t of historial) {
    let pasa = true;
    for (const [k, v] of Object.entries(filtro || {})) {
      if (v && norm(t[k]) !== norm(v)) { pasa = false; break; }
    }
    if (!pasa) continue;
    const val = (t[campoDe] || '').trim();
    if (val && !vistos.has(val.toLowerCase())) vistos.set(val.toLowerCase(), val);
  }
  return Array.from(vistos.values()).sort((a, b) => a.localeCompare(b, 'es'));
}

/* ---------------------------------------------------------------- */
/* Configuracion: administrar el catalogo de sugerencias.            */
/* Renombrar o eliminar aqui NO toca servicios ni reportes ya        */
/* guardados: ellos llevan sus propios datos.                        */
/* ---------------------------------------------------------------- */

const CAMPOS_CATALOGO = [
  ['cliente', 'Clientes'],
  ['planta',  'Plantas / sitios'],
  ['marca',   'Tipos de maquina'],
  ['modelo',  'Modelos'],
  ['serie',   'Numeros de serie'],
];

async function hojaConfiguracion() {
  const accion = await hoja('⚙  Configuracion', (cerrar) => h('div',
    h('div.lista-acciones',
      h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('catalogo') },
        '🗂  Clientes y datos de maquina'),
      h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('zoom') },
        '🔍  Tamaño de la interfaz')
    ),
    h('p.pista', 'Administra las sugerencias que salen al crear o editar un servicio. Los servicios y reportes ya guardados no se tocan.')
  ));
  if (accion === 'catalogo') await hojaCampoCatalogo();
  if (accion === 'zoom') await hojaZoom();
}

async function hojaZoom() {
  await hoja('🔍  Tamaño de la interfaz', (cerrar) => {
    const cont = h('div');
    const pintar = () => {
      const actual = zoomActual();
      cont.replaceChildren(
        h('p.pista', 'Textos, botones y menus crecen; las fotos se quedan de su tamaño. El cambio se aplica al instante.'),
        h('div.asistente__rejilla',
          [['normal', 'Normal'], ['110', '110%'], ['125', '125%'], ['150', '150%']].map(([z, etq]) =>
            h('button.asistente__op' + (actual === z ? '.asistente__op--actual' : ''),
              { type: 'button', onclick: () => { aplicarZoom(z); pintar(); } }, etq))
        ),
        h('div.hoja__acciones',
          h('button.btn.btn--primario', { type: 'button', onclick: () => cerrar(true) }, 'Listo'))
      );
    };
    pintar();
    return cont;
  });
}

async function hojaCampoCatalogo() {
  await historialServicios();   // garantiza el catalogo sembrado
  for (;;) {
    const campo = await hoja('🗂  ¿Que quieres modificar?', (cerrar) => h('div.lista-acciones',
      CAMPOS_CATALOGO.map(([k, titulo]) =>
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar(k) }, titulo))
    ));
    if (!campo) return;
    await hojaValoresCatalogo(campo);
  }
}

async function hojaValoresCatalogo(campo) {
  const titulo = CAMPOS_CATALOGO.find(c => c[0] === campo)[1];
  for (;;) {
    const maquinas = await db.maquinasCatalogo();
    const valores = distintosDe(maquinas, campo, {});
    const elegido = await hoja(titulo, (cerrar) => h('div',
      valores.length
        ? h('div.lista-acciones', valores.map(v =>
            h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar(v) },
              v,
              h('span.config-conteo', 'en ' + maquinas.filter(m => norm(m[campo]) === norm(v)).length + ' maquina(s)'))))
        : h('p.pista', 'No hay valores guardados todavia.'),
      valores.length ? h('p.pista', 'Toca uno para renombrarlo o quitarlo de las sugerencias.') : null
    ), { altura: 'alta' });
    if (!elegido) return;
    await hojaEditarValor(campo, elegido);
  }
}

async function hojaEditarValor(campo, valor) {
  const accion = await hoja(valor, (cerrar) => h('div',
    h('p.pista', 'Los servicios y reportes ya guardados NO cambian ni se eliminan: esto solo afecta las sugerencias para nuevos servicios.'),
    h('div.lista-acciones',
      h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('renombrar') }, '✎  Renombrar'),
      h('button.lista-acciones__item.lista-acciones__item--peligro',
        { type: 'button', onclick: () => cerrar('eliminar') }, '🗑  Quitar de las sugerencias')
    )
  ));

  if (accion === 'renombrar') {
    const nuevo = await editarTextoCampo('Renombrar "' + valor + '"', valor, false);
    if (nuevo === null || !nuevo.trim() || nuevo.trim() === valor) return;
    const n = await db.maquinasRenombrar(campo, valor, nuevo.trim());
    aviso('Renombrado en ' + n + ' registro(s) de sugerencias', 'ok');
  } else if (accion === 'eliminar') {
    const ok = await confirmar('Se quita "' + valor + '" de las sugerencias, junto con sus maquinas asociadas. Los servicios y reportes ya guardados NO cambian ni se eliminan.',
      { textoOk: 'Quitar' });
    if (!ok) return;
    const n = await db.maquinasEliminarValor(campo, valor);
    aviso('Quitado de las sugerencias (' + n + ' registro(s))', 'ok');
  }
}

async function bannerAlmacenamiento() {
  const info = await db.estadoAlmacenamiento();
  if (!info.soportado || info.persistente) return null;

  const banner = h('div.banner.banner--aviso',
    h('div',
      h('strong', 'Protege tus datos'),
      h('p', 'Android podria borrar los datos de la app si el telefono se queda sin espacio. Un toque lo evita.')
    ),
    h('button.btn.btn--pequeno', {
      type: 'button',
      onclick: async () => {
        const ok = await db.pedirPersistencia();
        if (ok) { aviso('Datos protegidos', 'ok'); banner.remove(); }
        else aviso('Android no concedio el permiso. Instala la app desde el menu de Chrome e intenta de nuevo.', 'error');
      }
    }, 'Proteger')
  );
  return banner;
}

/* ---------------------------------------------------------------- */
/* Alta: primero el tipo, luego los datos                            */
/* ---------------------------------------------------------------- */

const PISTA_TIPO = {
  servicio:      'Mantenimiento o reparacion en sitio',
  laboratorio:   'Pruebas y mediciones en banco',
  general:       'Cualquier otro registro',
  procedimiento: 'Guia paso a paso — genera PowerPoint',
};

function elegirTipo() {
  return hoja('¿Que vas a registrar?', (cerrar) => h('div.selector-tipo',
    Object.entries(db.TIPOS).map(([clave, t]) =>
      h('button.selector-tipo__op', { type: 'button', onclick: () => cerrar(clave) },
        h('span.selector-tipo__icono', t.icono),
        h('span.selector-tipo__texto',
          h('strong', t.nombre),
          h('span', PISTA_TIPO[clave])
        ),
        h('span.selector-tipo__flecha', '›')
      )
    )
  ));
}

// Alta/edicion de laboratorio, general y procedimiento: solo el titulo.
// (Los servicios se crean con el asistente y se editan con el menu de campos.)
async function formularioTrabajo(existente, tipoClave) {
  const previo = existente || {};
  const tipo = db.TIPOS[tipoClave] || db.tipoDe(previo);

  return hoja(tipo.icono + '  ' + tipo.nombre, (cerrar) => {
    const cTitulo = campo('Titulo', {
      value: previo.titulo || '',
      placeholder: tipoClave === 'laboratorio' ? 'Pruebas de tarjeta IPC'
        : tipoClave === 'procedimiento' ? 'Cambio de sellos de bomba hidraulica'
        : 'Revision mensual',
    });
    return h('div',
      cTitulo,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => cerrar({ titulo: cTitulo.entrada.value.trim() })
        }, existente ? 'Guardar' : 'Crear')
      )
    );
  });
}

/* ---------------------------------------------------------------- */
/* Asistente de alta de servicio: un paso por dato, a puros botones. */
/* Cuadricula con lo ya guardado (filtrado en cascada), "+ Agregar"  */
/* hasta arriba, Omitir en No. de maquina, y texto libre solo en la  */
/* descripcion del problema.                                         */
/* ---------------------------------------------------------------- */

const PASOS_SERVICIO = [
  { campo: 'cliente',   titulo: 'Cliente',          nuevo: 'Agregar cliente' },
  { campo: 'planta',    titulo: 'Planta / sitio',   nuevo: 'Agregar planta' },
  { campo: 'marca',     titulo: 'Tipo de maquina',  nuevo: 'Agregar tipo' },
  { campo: 'modelo',    titulo: 'Modelo',           nuevo: 'Agregar modelo' },
  { campo: 'serie',     titulo: 'Numero de serie',  nuevo: 'Agregar serie' },
  { campo: 'noMaquina', titulo: 'No. de maquina',   nuevo: 'Agregar numero', omitible: true },
];

async function asistenteServicio() {
  const historial = await historialServicios(null);

  return hoja('🔧  Nuevo servicio', (cerrar) => {
    const sel = { cliente: '', planta: '', marca: '', modelo: '', serie: '', noMaquina: '', descripcion: '' };
    let i = 0;
    const cont = h('div.asistente');
    const TOTAL = PASOS_SERVICIO.length + 1;

    // replaceChildren no ignora null (lo pinta como texto); este si.
    const poner = (...nodos) => cont.replaceChildren(...nodos.filter(Boolean));

    const filtroPara = (campo) => {
      const f = {};
      if (campo !== 'cliente') f.cliente = sel.cliente;
      if (campo === 'marca')     f.planta = sel.planta;
      if (campo === 'modelo')    f.marca  = sel.marca;
      if (campo === 'serie')     f.modelo = sel.modelo;
      if (campo === 'noMaquina') f.serie  = sel.serie;
      return f;
    };

    const cabeza = (titulo) => {
      const miga = Object.values(sel).slice(0, i).filter(Boolean).join(' · ');
      return h('div.asistente__cab',
        h('div.asistente__fila',
          i > 0 ? h('button.icono-btn', { type: 'button', 'aria-label': 'Paso anterior',
            onclick: () => { i--; pintarPaso(); } }, '←') : null,
          h('div.crece',
            h('p.asistente__paso', 'PASO ' + (i + 1) + ' / ' + TOTAL),
            h('h3.asistente__titulo', titulo)
          )
        ),
        miga ? h('p.asistente__miga', miga) : null
      );
    };

    const avanzar = () => { i++; pintarPaso(); };

    function pintarEntrada(p, opciones) {
      const entrada = h('input.campo__entrada', { type: 'text', placeholder: p.titulo });
      poner(
        cabeza(p.titulo),
        entrada,
        h('div.hoja__acciones',
          opciones.length
            ? h('button.btn.btn--fantasma', { type: 'button', onclick: () => pintarPaso() }, 'Ver opciones')
            : h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
          h('button.btn.btn--primario', {
            type: 'button',
            onclick: () => { sel[p.campo] = entrada.value.trim(); avanzar(); }
          }, 'Continuar')
        )
      );
      setTimeout(() => entrada.focus(), 80);
    }

    function pintarPaso() {
      if (i >= PASOS_SERVICIO.length) return pintarDescripcion();
      const p = PASOS_SERVICIO[i];
      const opciones = distintosDe(historial, p.campo, filtroPara(p.campo));

      // Sin nada guardado no hay cuadricula que mostrar: directo a escribir.
      if (!opciones.length && !p.omitible) return pintarEntrada(p, opciones);

      poner(
        cabeza(p.titulo),
        h('button.asistente__nuevo', { type: 'button', onclick: () => pintarEntrada(p, opciones) },
          '＋  ' + p.nuevo),
        opciones.length ? h('div.asistente__rejilla',
          opciones.map(o => h('button.asistente__op', {
            type: 'button',
            onclick: () => { sel[p.campo] = o; avanzar(); }
          }, o))) : null,
        p.omitible ? h('button.asistente__omitir', {
          type: 'button',
          onclick: () => { sel[p.campo] = ''; avanzar(); }
        }, 'Omitir este paso →') : null
      );
    }

    function pintarDescripcion() {
      const area = h('textarea.campo__entrada.campo__entrada--area', {
        rows: 5, placeholder: 'Falla de SERVODRIVE Screw Not Ready',
        // guardar mientras escribe: asi ningun camino de "atras" pierde el texto
        oninput: () => { sel.descripcion = area.value.trim(); },
      });
      area.value = sel.descripcion || '';
      // La descripcion es OBLIGATORIA: es el titulo del trabajo y del reporte.
      poner(
        cabeza('Descripcion del problema'),
        area,
        h('div.hoja__acciones',
          h('button.btn.btn--fantasma', { type: 'button',
            onclick: () => { sel.descripcion = area.value.trim(); i--; pintarPaso(); } }, '← Anterior'),
          h('button.btn.btn--primario', {
            type: 'button',
            onclick: () => {
              sel.descripcion = area.value.trim();
              if (!sel.descripcion) {
                aviso('Describe la falla: es el titulo del servicio y del reporte', 'error');
                area.focus();
                return;
              }
              if (!sel.cliente && !sel.planta) {
                aviso('Pon al menos cliente o planta', 'error');
                i = 0; pintarPaso();
                return;
              }
              cerrar(sel);
            }
          }, 'Crear servicio')
        )
      );
    }

    pintarPaso();
    return cont;
  }, { altura: 'alta' });
}

export async function nuevoServicio() {
  const tipo = await elegirTipo();
  if (!tipo) return;

  const datos = tipo === 'servicio'
    ? await asistenteServicio()
    : await formularioTrabajo(null, tipo);
  if (!datos) return;

  if (tipo === 'servicio' && !datos.cliente && !datos.planta) {
    aviso('Pon al menos cliente o planta', 'error');
    return;
  }
  if (tipo !== 'servicio' && !datos.titulo) {
    aviso('Ponle un titulo', 'error');
    return;
  }

  const usuario = await db.ajusteLeer('usuario', 'Usuario');
  const trabajo = await db.servicioNuevo(Object.assign({ tipo, tecnico: usuario }, datos));
  if (tipo === 'servicio') db.maquinaRecordar(trabajo);   // alimenta las sugerencias
  location.hash = '#/s/' + trabajo.id;
}

/* ---------------------------------------------------------------- */
/* Edicion de servicio: menu de campos. Nada de teclado al entrar:   */
/* el usuario elige QUE editar. Cliente/planta/maquina/modelo/serie  */
/* se eligen de cuadricula (como el asistente, con "+ Agregar");     */
/* solo No. de maquina y la descripcion abren teclado.               */
/* ---------------------------------------------------------------- */

function elegirDeCuadricula(etiqueta, actual, opciones, nombreNuevo) {
  // El valor actual siempre esta entre las opciones, aunque el historial
  // (que excluye al servicio en edicion) no lo traiga.
  if (actual && !opciones.some(o => norm(o) === norm(actual))) {
    opciones = opciones.concat(actual).sort((a, b) => a.localeCompare(b, 'es'));
  }

  return hoja(etiqueta, (cerrar) => {
    const cont = h('div');

    const modoRejilla = () => {
      cont.replaceChildren(
        h('button.asistente__nuevo', { type: 'button', onclick: modoEntrada }, '＋  ' + nombreNuevo),
        opciones.length
          ? h('div.asistente__rejilla', opciones.map(o =>
              h('button.asistente__op' + (norm(o) === norm(actual) ? '.asistente__op--actual' : ''), {
                type: 'button', onclick: () => cerrar(o),
              }, o)))
          : h('p.pista', 'Nada guardado todavia. Agrega uno nuevo.')
      );
    };

    const modoEntrada = () => {
      const inp = h('input.campo__entrada', { type: 'text', value: actual || '' });
      cont.replaceChildren(inp,
        h('div.hoja__acciones',
          opciones.length
            ? h('button.btn.btn--fantasma', { type: 'button', onclick: modoRejilla }, 'Ver opciones')
            : h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
          h('button.btn.btn--primario', { type: 'button', onclick: () => cerrar(inp.value.trim()) }, 'Guardar')
        ));
      setTimeout(() => inp.focus(), 80);
    };

    if (opciones.length) modoRejilla(); else modoEntrada();
    return cont;
  });
}

function editarTextoCampo(etiqueta, actual, esArea) {
  return hoja(etiqueta, (cerrar) => {
    const c = esArea
      ? campoArea('', { rows: 4, value: actual || '' })
      : campo('', { value: actual || '' });
    return h('div', c,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', { type: 'button', onclick: () => cerrar(c.entrada.value.trim()) }, 'Guardar')
      ));
  });
}

async function editarServicioMenu(trabajo) {
  const historial = await historialServicios(trabajo.id);
  let cambio = false;

  const CAMPOS = [
    { k: 'cliente',   etiqueta: 'Cliente',          lista: true, nuevo: 'Agregar cliente', filtro: () => ({}) },
    { k: 'planta',    etiqueta: 'Planta / sitio',   lista: true, nuevo: 'Agregar planta',  filtro: () => ({ cliente: trabajo.cliente }) },
    { k: 'marca',     etiqueta: 'Tipo de maquina',  lista: true, nuevo: 'Agregar tipo',    filtro: () => ({ cliente: trabajo.cliente, planta: trabajo.planta }) },
    { k: 'modelo',    etiqueta: 'Modelo',           lista: true, nuevo: 'Agregar modelo',  filtro: () => ({ cliente: trabajo.cliente, marca: trabajo.marca }) },
    { k: 'serie',     etiqueta: 'Numero de serie',  lista: true, nuevo: 'Agregar serie',   filtro: () => ({ cliente: trabajo.cliente, modelo: trabajo.modelo }) },
    { k: 'noMaquina', etiqueta: 'No. de maquina',   lista: false },
    { k: 'descripcion', etiqueta: 'Descripcion del problema', lista: false, area: true, obligatorio: true },
  ];

  await hoja('✎  Editar datos', (cerrar) => {
    const cont = h('div');

    const pintar = () => {
      cont.replaceChildren(
        h('div.campos-menu', CAMPOS.map(c =>
          h('button.campos-menu__fila', { type: 'button', onclick: () => alCampo(c) },
            h('span.campos-menu__cuerpo',
              h('span.campos-menu__etq', c.etiqueta),
              h('span.campos-menu__valor' + (trabajo[c.k] ? '' : '.campos-menu__valor--vacio'),
                trabajo[c.k] || 'Sin valor')
            ),
            h('span.campos-menu__flecha', '›')
          ))),
        h('div.hoja__acciones',
          h('button.btn.btn--primario', { type: 'button', onclick: () => cerrar(true) }, 'Listo'))
      );
    };

    async function alCampo(c) {
      const nuevo = c.lista
        ? await elegirDeCuadricula(c.etiqueta, trabajo[c.k] || '',
            distintosDe(historial, c.k, c.filtro()), c.nuevo)
        : await editarTextoCampo(c.etiqueta, trabajo[c.k] || '', !!c.area);

      if (nuevo === null || nuevo === (trabajo[c.k] || '')) return;
      if (c.obligatorio && !nuevo) {
        aviso('La descripcion del problema es obligatoria', 'error');
        return;
      }
      trabajo[c.k] = nuevo;
      await db.servicioGuardar(trabajo);
      db.maquinaRecordar(trabajo);   // alimenta las sugerencias
      cambio = true;
      pintar();
    }

    pintar();
    return cont;
  }, { altura: 'alta' });

  return cambio;
}

export async function editarServicio(trabajo) {
  if ((trabajo.tipo || 'servicio') === 'servicio') return editarServicioMenu(trabajo);
  const datos = await formularioTrabajo(trabajo, trabajo.tipo);
  if (!datos) return false;
  Object.assign(trabajo, datos);
  await db.servicioGuardar(trabajo);
  return true;
}

/* ---------------------------------------------------------------- */
/* Tarjeta de la lista                                               */
/* ---------------------------------------------------------------- */

function tarjetaTrabajo(trabajo, resumen, refrescar) {
  const totales = Object.values(resumen).reduce((acc, r) => {
    acc.total += r.total; acc.foto += r.foto || 0;
    acc.nota += r.nota || 0; acc.tabla += r.tabla || 0;
    acc.prueba += r.prueba || 0;
    acc.pendiente += r.pendiente || 0;
    return acc;
  }, { total: 0, foto: 0, nota: 0, tabla: 0, prueba: 0, pendiente: 0 });

  const tipo = db.tipoDe(trabajo);
  const titulo = trabajo.titulo || trabajo.cliente || trabajo.planta || 'Sin nombre';
  const maquina = [[trabajo.marca, trabajo.modelo].filter(Boolean).join(' '), trabajo.serie,
    trabajo.noMaquina ? 'Maq. ' + trabajo.noMaquina : '']
    .filter(Boolean).join(' · ');

  return h('article.tarjeta-servicio', {
    onclick: () => { location.hash = '#/s/' + trabajo.id; }
  },
    h('div.tarjeta-servicio__cabeza',
      h('div',
        h('span.tipo-chip', tipo.icono + ' ' + tipo.nombre),
        h('h3', titulo),
        trabajo.planta ? h('p.tarjeta-servicio__sub', trabajo.planta) : null
      ),
      trabajo.estado === 'abierto'
        ? h('span.etiqueta.etiqueta--abierto', 'Abierto')
        : h('span.etiqueta.etiqueta--cerrado', 'Cerrado')
    ),
    maquina ? h('p.tarjeta-servicio__maquina', '⚙ ' + maquina) : null,
    trabajo.descripcion ? h('p.tarjeta-servicio__desc', trabajo.descripcion) : null,
    h('div.tarjeta-servicio__pie',
      h('span', fecha(trabajo.inicio)),
      h('span.crece'),
      totales.foto   ? h('span.contador', '📷 ' + totales.foto)   : null,
      totales.tabla  ? h('span.contador', '▦ ' + totales.tabla)   : null,
      totales.nota   ? h('span.contador', '📝 ' + totales.nota)   : null,
      totales.prueba ? h('span.contador', '🧪 ' + totales.prueba) : null,
      totales.pendiente ? h('span.contador', '⏳ ' + totales.pendiente) : null,
      !totales.total ? h('span.pista', 'Sin registros') : null
    ),
    h('button.icono-btn.tarjeta-servicio__menu', {
      type: 'button', 'aria-label': 'Opciones',
      onclick: async (ev) => {
        ev.stopPropagation();
        const accion = await hoja(titulo, (cerrar) => h('div.lista-acciones',
          h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('editar') }, '✎  Editar datos'),
          h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('estado') },
            trabajo.estado === 'abierto' ? '🔒  Cerrar' : '🔓  Reabrir'),
          h('button.lista-acciones__item.lista-acciones__item--peligro',
            { type: 'button', onclick: () => cerrar('borrar') }, '🗑  Eliminar')
        ));

        if (accion === 'editar') { if (await editarServicio(trabajo)) refrescar(); }
        else if (accion === 'estado') {
          trabajo.estado = trabajo.estado === 'abierto' ? 'cerrado' : 'abierto';
          trabajo.fin = trabajo.estado === 'cerrado' ? Date.now() : null;
          await db.servicioGuardar(trabajo);
          if (trabajo.estado === 'cerrado') {
            aviso('Trabajo cerrado. Buen momento para respaldar (boton ⛁).', 'ok');
          }
          refrescar();
        } else if (accion === 'borrar') {
          const ok = await confirmar('Se elimina "' + titulo + '" con todos sus equipos, notas, tablas y fotos. Esto no se puede deshacer.');
          if (ok) { await db.servicioBorrar(trabajo.id); aviso('Eliminado'); refrescar(); }
        }
      }
    }, '⋯')
  );
}

/* ---------------------------------------------------------------- */
/* Almacenamiento y respaldo                                         */
/* ---------------------------------------------------------------- */

async function hojaAlmacenamiento(refrescar) {
  const i = await db.estadoAlmacenamiento();

  await hoja('Almacenamiento y respaldo', (cerrar) => {
    const estado = h('p.pista', '');

    const entregar = async (modo) => {
      estado.textContent = 'Preparando respaldo...';
      try {
        const { crearRespaldo } = await import('../respaldo.js');
        const r = await crearRespaldo();
        const archivo = new File([r.blob], r.nombreArchivo, { type: 'application/zip' });

        if (modo === 'compartir' && navigator.canShare && navigator.canShare({ files: [archivo] })) {
          await navigator.share({ files: [archivo], title: r.nombreArchivo });
        } else {
          const url = URL.createObjectURL(r.blob);
          const a = h('a', { href: url, download: r.nombreArchivo });
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
        }
        estado.textContent = 'Respaldo listo: ' + r.resumen.trabajos + ' trabajos, ' +
          r.resumen.registros + ' registros, ' + r.resumen.fotos + ' fotos.';
        aviso('Respaldo generado', 'ok');
      } catch (e) {
        if (e && e.name === 'AbortError') { estado.textContent = ''; return; }
        console.error(e);
        estado.textContent = 'Fallo: ' + (e && e.message ? e.message : e);
        aviso('No se pudo respaldar', 'error');
      }
    };

    const restaurar = () => {
      const input = h('input', { type: 'file', accept: '.zip,application/zip', style: { display: 'none' } });
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const archivo = input.files && input.files[0];
        input.remove();
        if (!archivo) return;
        const ok = await confirmar(
          'Se restaurara "' + archivo.name + '". Lo del respaldo se MEZCLA con lo que ya hay (mismos trabajos se sobreescriben, nada se borra). ¿Continuar?',
          { textoOk: 'Restaurar', peligro: false });
        if (!ok) return;
        estado.textContent = 'Restaurando...';
        try {
          const { restaurarRespaldo } = await import('../respaldo.js');
          const r = await restaurarRespaldo(archivo);
          estado.textContent = 'Restaurado: ' + r.trabajos + ' trabajos, ' + r.fotos + ' fotos.';
          aviso('Respaldo restaurado', 'ok');
          refrescar();
        } catch (e) {
          console.error(e);
          estado.textContent = 'Fallo: ' + (e && e.message ? e.message : e);
          aviso('No se pudo restaurar', 'error');
        }
      });
      input.click();
    };

    return h('div',
      h('p.parrafo', 'Usado: ' + media.formatoBytes(i.usado) +
        (i.cuota ? ' de ' + media.formatoBytes(i.cuota) + ' disponibles' : '')),
      h('p.parrafo', i.persistente
        ? '✓ Los datos estan protegidos contra borrado automatico.'
        : '⚠ Los datos NO estan protegidos. Instala la app desde el menu de Chrome y toca "Proteger".'),
      h('p.pista', 'Todo se guarda unicamente en este telefono. El respaldo es un ZIP con todos tus trabajos y fotos: guardalo en OneDrive de vez en cuando, y con el puedes migrar a otro telefono.'),
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: restaurar }, 'Restaurar'),
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => entregar('descargar') }, 'Descargar'),
        h('button.btn.btn--primario', { type: 'button', onclick: () => entregar('compartir') }, 'Respaldar')
      ),
      estado,
      h('p.pista', { style: { marginTop: '.6rem' } }, 'Version de la app: ' + APP_VERSION)
    );
  });
}

export async function render(contenedor, refrescar) {
  media.liberarUrls();
  const trabajos = await db.serviciosTodos();

  const cabecera = h('header.cabecera',
    h('div.cabecera__fila',
      h('h1', 'Trabajos'),
      h('button.icono-btn', {
        type: 'button', 'aria-label': 'Cambiar tema',
        onclick: (ev) => {
          const nuevo = alternarTema();
          ev.currentTarget.textContent = nuevo === 'claro' ? '🌙' : '☀️';
        }
      }, temaActual() === 'claro' ? '🌙' : '☀️'),
      h('button.icono-btn', {
        type: 'button', 'aria-label': 'Almacenamiento y respaldo',
        onclick: () => hojaAlmacenamiento(refrescar)
      }, '⛁'),
      h('button.icono-btn', {
        type: 'button', 'aria-label': 'Configuracion',
        onclick: () => hojaConfiguracion()
      }, '⚙')
    )
  );

  const lista = h('div.lista-servicios');
  const banner = await bannerAlmacenamiento();
  if (banner) lista.append(banner);

  if (!trabajos.length) {
    lista.append(vacio('🔧', 'Aun no hay trabajos',
      'Crea uno al llegar y ve registrando conforme avanzas.'));
  } else {
    for (const t of trabajos) {
      const resumen = await db.resumenPorEquipo(t.id);
      lista.append(tarjetaTrabajo(t, resumen, refrescar));
    }
  }

  lista.append(h('p.version-pie', 'v' + APP_VERSION));

  contenedor.append(
    cabecera,
    h('main.contenido', lista),
    h('button.fab', { type: 'button', onclick: nuevoServicio },
      h('span.fab__mas', '+'), h('span', 'Nuevo'))
  );
}
