// Pantalla inicial: lista de trabajos (servicios, pruebas de laboratorio, generales).

import * as db from '../db.js';
import { h, campo, campoArea, hoja, aviso, confirmar, fecha, vacio } from '../ui.js';
import * as media from '../media.js';
import { APP_VERSION } from '../version.js';
import { temaActual, alternarTema } from '../tema.js';

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

async function formularioTrabajo(existente, tipoClave) {
  const previo = existente || {};
  const tipo = db.TIPOS[tipoClave] || db.tipoDe(previo);
  const ultimoTecnico = await db.ajusteLeer('ultimoTecnico', '');

  return hoja(tipo.icono + '  ' + tipo.nombre, (cerrar) => {
    const cCliente = campo('Cliente',            { value: previo.cliente || '', placeholder: 'Nombre del cliente' });
    const cPlanta  = campo('Planta / sitio',     { value: previo.planta  || '', placeholder: 'Planta Norte' });
    const cModelo  = campo('Modelo de maquina',  { value: previo.modelo  || '', placeholder: 'Engel Victory 200' });
    const cSerie   = campo('Numero de serie',    { value: previo.serie   || '', placeholder: 'SN-48213' });
    const cTecnico = campo('Tecnico',            { value: previo.tecnico || ultimoTecnico, placeholder: 'Tu nombre' });
    const cDesc    = campoArea('Descripcion de la falla', {
      value: previo.descripcion || '', rows: 3,
      placeholder: 'Que reporta el cliente, que sintoma presenta la maquina'
    });

    return h('div',
      cCliente, cPlanta, cModelo, cSerie, cTecnico, cDesc,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => cerrar({
            cliente: cCliente.entrada.value.trim(),
            planta:  cPlanta.entrada.value.trim(),
            modelo:  cModelo.entrada.value.trim(),
            serie:   cSerie.entrada.value.trim(),
            tecnico: cTecnico.entrada.value.trim(),
            descripcion: cDesc.entrada.value.trim(),
          })
        }, existente ? 'Guardar' : 'Crear')
      )
    );
  }, { altura: 'alta' });
}

export async function nuevoServicio() {
  const tipo = await elegirTipo();
  if (!tipo) return;

  const datos = await formularioTrabajo(null, tipo);
  if (!datos) return;
  if (!datos.cliente && !datos.planta) {
    aviso('Pon al menos cliente o planta', 'error');
    return;
  }
  if (datos.tecnico) await db.ajusteGuardar('ultimoTecnico', datos.tecnico);
  const trabajo = await db.servicioNuevo(Object.assign({ tipo }, datos));
  location.hash = '#/s/' + trabajo.id;
}

export async function editarServicio(trabajo) {
  const datos = await formularioTrabajo(trabajo, trabajo.tipo);
  if (!datos) return false;
  Object.assign(trabajo, datos);
  await db.servicioGuardar(trabajo);
  if (datos.tecnico) await db.ajusteGuardar('ultimoTecnico', datos.tecnico);
  return true;
}

/* ---------------------------------------------------------------- */
/* Tarjeta de la lista                                               */
/* ---------------------------------------------------------------- */

function tarjetaTrabajo(trabajo, resumen, refrescar) {
  const totales = Object.values(resumen).reduce((acc, r) => {
    acc.total += r.total; acc.foto += r.foto || 0;
    acc.nota += r.nota || 0; acc.tabla += r.tabla || 0;
    return acc;
  }, { total: 0, foto: 0, nota: 0, tabla: 0 });

  const tipo = db.tipoDe(trabajo);
  const titulo = trabajo.cliente || trabajo.planta || 'Sin nombre';
  const maquina = [trabajo.modelo, trabajo.serie].filter(Boolean).join(' · ');

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
      totales.foto  ? h('span.contador', '📷 ' + totales.foto)  : null,
      totales.tabla ? h('span.contador', '▦ ' + totales.tabla)  : null,
      totales.nota  ? h('span.contador', '📝 ' + totales.nota)  : null,
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
