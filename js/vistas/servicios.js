// Pantalla inicial: lista de trabajos (servicios, pruebas de laboratorio, generales).

import * as db from '../db.js';
import { h, campo, campoLista, campoArea, hoja, aviso, confirmar, fecha, vacio } from '../ui.js';
import * as media from '../media.js';
import { APP_VERSION } from '../version.js';
import { temaActual, alternarTema } from '../tema.js';

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

// Historial para sugerir: servicios previos + catalogo precargado (el
// historial real va primero, asi gana en autorrellenos y en el orden).
async function historialServicios(exceptoId) {
  return (await db.serviciosTodos())
    .filter(t => t.tipo === 'servicio' && t.id !== exceptoId)
    .concat(PRECARGADOS);
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
  servicio:    'Mantenimiento o reparacion en sitio',
  laboratorio: 'Pruebas y mediciones en banco',
  general:     'Cualquier otro registro',
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

// El tecnico ya no se pregunta: es el usuario de la app.
async function formularioTrabajo(existente, tipoClave) {
  const previo = existente || {};
  const tipo = db.TIPOS[tipoClave] || db.tipoDe(previo);
  const esServicio = tipoClave === 'servicio';

  const historial = esServicio ? await historialServicios(previo.id) : [];
  const distintos = (campoDe, filtro) => distintosDe(historial, campoDe, filtro);

  return hoja(tipo.icono + '  ' + tipo.nombre, (cerrar) => {
    // Pruebas de laboratorio y General: solo el titulo, para arrancar rapido.
    if (!esServicio) {
      const cTitulo = campo('Titulo', {
        value: previo.titulo || '',
        placeholder: tipoClave === 'laboratorio' ? 'Pruebas de tarjeta IPC' : 'Revision mensual',
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
    }

    // Mismos campos que la tabla de datos del reporte. Cada uno sugiere lo
    // ya guardado, filtrado en cascada por el cliente (y lo demas elegido).
    const v = (c) => c.entrada.value.trim();

    const cCliente = campoLista('Cliente', { value: previo.cliente || '', placeholder: 'CLIENTE' },
      { opciones: () => distintos('cliente') });

    const cPlanta = campoLista('Planta / sitio', { value: previo.planta || '', placeholder: 'Planta Norte' },
      { opciones: () => distintos('planta', { cliente: v(cCliente) }) });

    const cMarca = campoLista('Tipo de maquina', { value: previo.marca || '', placeholder: 'HUSKY' },
      { opciones: () => distintos('marca', { cliente: v(cCliente), planta: v(cPlanta) }) });

    const cModelo = campoLista('Modelo', { value: previo.modelo || '', placeholder: 'H400 RS65/60' },
      {
        opciones: () => distintos('modelo', { cliente: v(cCliente), marca: v(cMarca) }),
        alElegir: (valor) => {
          if (v(cMarca)) return;
          const reg = historial.find(t => norm(t.modelo) === norm(valor) && t.marca);
          if (reg) cMarca.entrada.value = reg.marca;
        },
      });

    const cSerie = campoLista('Numero de serie', { value: previo.serie || '', placeholder: '0000000' },
      {
        opciones: () => distintos('serie', { cliente: v(cCliente), modelo: v(cModelo) }),
        // Una serie identifica LA maquina: al elegirla se rellena lo que falte.
        alElegir: (valor) => {
          const reg = historial.find(t => norm(t.serie) === norm(valor) &&
            (!v(cCliente) || norm(t.cliente) === norm(v(cCliente))));
          if (!reg) return;
          let relleno = false;
          for (const [c, k] of [[cCliente, 'cliente'], [cPlanta, 'planta'], [cMarca, 'marca'], [cModelo, 'modelo'], [cNoMaq, 'noMaquina']]) {
            if (!v(c) && reg[k]) { c.entrada.value = reg[k]; relleno = true; }
          }
          if (relleno) aviso('Datos de la maquina rellenados', 'ok');
        },
      });

    const cNoMaq = campoLista('No. de maquina (opcional)', { value: previo.noMaquina || '', placeholder: 'Linea 3 / M-07' },
      { opciones: () => distintos('noMaquina', { cliente: v(cCliente), serie: v(cSerie) }) });

    const cDesc = campoArea('Descripcion de la falla', {
      value: previo.descripcion || '', rows: 3,
      placeholder: 'Falla de SERVODRIVE Screw Not Ready'
    });

    return h('div',
      cCliente, cPlanta, cMarca, cModelo, cSerie, cNoMaq, cDesc,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => cerrar({
            cliente:   cCliente.entrada.value.trim(),
            planta:    cPlanta.entrada.value.trim(),
            marca:     cMarca.entrada.value.trim(),
            modelo:    cModelo.entrada.value.trim(),
            serie:     cSerie.entrada.value.trim(),
            noMaquina: cNoMaq.entrada.value.trim(),
            descripcion: cDesc.entrada.value.trim(),
          })
        }, existente ? 'Guardar' : 'Crear')
      )
    );
  }, { altura: esServicio ? 'alta' : 'auto' });
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
  location.hash = '#/s/' + trabajo.id;
}

export async function editarServicio(trabajo) {
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
    return acc;
  }, { total: 0, foto: 0, nota: 0, tabla: 0, prueba: 0 });

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
        type: 'button', 'aria-label': 'Almacenamiento',
        onclick: async () => {
          const i = await db.estadoAlmacenamiento();
          hoja('Almacenamiento', () => h('div',
            h('p.parrafo', 'Usado: ' + media.formatoBytes(i.usado) +
              (i.cuota ? ' de ' + media.formatoBytes(i.cuota) + ' disponibles' : '')),
            h('p.parrafo', i.persistente
              ? '✓ Los datos estan protegidos contra borrado automatico.'
              : '⚠ Los datos NO estan protegidos. Instala la app desde el menu de Chrome y toca "Proteger".'),
            h('p.pista', 'Todo se guarda unicamente en este telefono.'),
            h('p.pista', 'Version de la app: ' + APP_VERSION)
          ));
        }
      }, '⛁')
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
