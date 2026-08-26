// Pantalla inicial: lista de servicios.

import * as db from '../db.js';
import { h, campo, campoArea, hoja, aviso, confirmar, fecha, relativo, duracion, vacio } from '../ui.js';
import * as media from '../media.js';

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

async function formularioServicio(servicioExistente) {
  const previo = servicioExistente || {};
  const ultimoTecnico = await db.ajusteLeer('ultimoTecnico', '');

  return hoja(servicioExistente ? 'Datos del servicio' : 'Nuevo servicio', (cerrar) => {
    const cCliente = campo('Cliente',      { value: previo.cliente || '', placeholder: 'Nombre del cliente' });
    const cPlanta  = campo('Planta / sitio', { value: previo.planta || '', placeholder: 'Planta Norte' });
    const cArea    = campo('Area',         { value: previo.area || '', placeholder: 'Cuarto de bombas' });
    const cFolio   = campo('Folio / OT',   { value: previo.folio || '', placeholder: 'OT-1042' });
    const cTecnico = campo('Tecnico',      { value: previo.tecnico || ultimoTecnico, placeholder: 'Tu nombre' });
    const cDesc    = campoArea('Descripcion del servicio', {
      value: previo.descripcion || '', rows: 3,
      placeholder: 'Calibracion de bombas hidraulicas'
    });

    return h('div',
      cCliente, cPlanta, cArea, cFolio, cTecnico, cDesc,
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => cerrar({
            cliente: cCliente.entrada.value.trim(),
            planta:  cPlanta.entrada.value.trim(),
            area:    cArea.entrada.value.trim(),
            folio:   cFolio.entrada.value.trim(),
            tecnico: cTecnico.entrada.value.trim(),
            descripcion: cDesc.entrada.value.trim(),
          })
        }, servicioExistente ? 'Guardar' : 'Crear servicio')
      )
    );
  }, { altura: 'alta' });
}

export async function nuevoServicio() {
  const datos = await formularioServicio(null);
  if (!datos) return;
  if (!datos.cliente && !datos.planta) {
    aviso('Pon al menos cliente o planta', 'error');
    return;
  }
  if (datos.tecnico) await db.ajusteGuardar('ultimoTecnico', datos.tecnico);
  const servicio = await db.servicioNuevo(datos);
  location.hash = '#/s/' + servicio.id;
}

export async function editarServicio(servicio) {
  const datos = await formularioServicio(servicio);
  if (!datos) return false;
  Object.assign(servicio, datos);
  await db.servicioGuardar(servicio);
  if (datos.tecnico) await db.ajusteGuardar('ultimoTecnico', datos.tecnico);
  return true;
}

function tarjetaServicio(servicio, resumen, refrescar) {
  const totales = Object.values(resumen).reduce((acc, r) => {
    acc.total += r.total; acc.foto += r.foto || 0;
    acc.nota += r.nota || 0; acc.tabla += r.tabla || 0;
    return acc;
  }, { total: 0, foto: 0, nota: 0, tabla: 0 });

  const titulo = servicio.cliente || servicio.planta || 'Servicio sin nombre';
  const sub = [servicio.planta, servicio.area].filter(Boolean).join(' · ');

  return h('article.tarjeta-servicio', {
    onclick: () => { location.hash = '#/s/' + servicio.id; }
  },
    h('div.tarjeta-servicio__cabeza',
      h('div',
        h('h3', titulo),
        sub ? h('p.tarjeta-servicio__sub', sub) : null
      ),
      servicio.estado === 'abierto'
        ? h('span.etiqueta.etiqueta--abierto', 'Abierto')
        : h('span.etiqueta.etiqueta--cerrado', 'Cerrado')
    ),
    servicio.descripcion ? h('p.tarjeta-servicio__desc', servicio.descripcion) : null,
    h('div.tarjeta-servicio__pie',
      h('span', fecha(servicio.inicio)),
      servicio.folio ? h('span', '· ' + servicio.folio) : null,
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
            servicio.estado === 'abierto' ? '🔒  Cerrar servicio' : '🔓  Reabrir servicio'),
          h('button.lista-acciones__item.lista-acciones__item--peligro',
            { type: 'button', onclick: () => cerrar('borrar') }, '🗑  Eliminar servicio')
        ));

        if (accion === 'editar') { if (await editarServicio(servicio)) refrescar(); }
        else if (accion === 'estado') {
          servicio.estado = servicio.estado === 'abierto' ? 'cerrado' : 'abierto';
          servicio.fin = servicio.estado === 'cerrado' ? Date.now() : null;
          await db.servicioGuardar(servicio);
          refrescar();
        } else if (accion === 'borrar') {
          const ok = await confirmar('Se elimina "' + titulo + '" con todos sus equipos, notas, tablas y fotos. Esto no se puede deshacer.');
          if (ok) { await db.servicioBorrar(servicio.id); aviso('Servicio eliminado'); refrescar(); }
        }
      }
    }, '⋯')
  );
}

export async function render(contenedor, refrescar) {
  media.liberarUrls();
  const servicios = await db.serviciosTodos();

  const cabecera = h('header.cabecera',
    h('div.cabecera__fila',
      h('h1', 'Servicios'),
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
            h('p.pista', 'Todo se guarda unicamente en este telefono.')
          ));
        }
      }, '⛁')
    )
  );

  const lista = h('div.lista-servicios');
  const banner = await bannerAlmacenamiento();
  if (banner) lista.append(banner);

  if (!servicios.length) {
    lista.append(vacio('🔧', 'Aun no hay servicios',
      'Crea uno al llegar a la planta y ve registrando conforme trabajas.'));
  } else {
    for (const s of servicios) {
      const resumen = await db.resumenPorEquipo(s.id);
      lista.append(tarjetaServicio(s, resumen, refrescar));
    }
  }

  contenedor.append(
    cabecera,
    h('main.contenido', lista),
    h('button.fab', { type: 'button', onclick: nuevoServicio },
      h('span.fab__mas', '+'), h('span', 'Nuevo servicio'))
  );
}
