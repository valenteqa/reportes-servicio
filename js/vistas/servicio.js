// Detalle del trabajo: UNA sola vista en forma de arbol (tipo skill tree).
//
// El tronco es el trabajo; cada rama es una ACTIVIDAD (pruebas de una IPC,
// ajuste de bombas, mediciones de temperatura...) y de cada rama cuelgan sus
// notas, tablas, fotos y pruebas en orden cronologico.
//
// La rama seleccionada es el destino de la barra de captura. "General" es el
// tronco: siempre existe y recibe lo que no pertenece a una actividad.

import * as db from '../db.js';
import * as media from '../media.js';
import { h, campo, hoja, aviso, confirmar, fecha, hora, duracion, icono } from '../ui.js';
import { lineaDeTiempo, menuAgregar, galeriaDelTrabajo } from './eventos.js';
import { editarServicio } from './servicios.js';
import { generarReporte } from '../reporte.js';
import { vistaPreviaReporte } from './previa.js';
import { esNativa, compartirArchivoNativo, guardarEnCarpetaNativa } from '../nativo.js';

/* ---------------------------------------------------------------- */
/* Generar el reporte Word y entregarlo (compartir o descargar)      */
/* ---------------------------------------------------------------- */

async function hojaReporte(servicio) {
  const esProc = servicio.tipo === 'procedimiento';
  const eventos = await db.eventosDeServicio(servicio.id);
  const incluidos = eventos.filter(e => e.incluir !== false);
  const excluidos = eventos.length - incluidos.length;
  const n = (tipo) => incluidos.filter(e => e.tipo === tipo).length;
  const pruebasAbiertas = incluidos.filter(e => e.tipo === 'prueba' && !e.datos.resultado).length;
  const pasosConContenido = new Set(incluidos.map(e => e.equipoId)).size;

  await hoja(esProc ? '📊  Generar presentacion' : '📄  Generar reporte', (cerrar) => {
    const resumen = h('div.reporte-resumen',
      esProc
        ? h('p.parrafo', pasosConContenido + ' pasos con contenido · ' + n('nota') + ' textos · ' +
            n('foto') + ' fotos · ' + n('tabla') + ' tablas · ' + n('pendiente') + ' pendientes')
        : h('p.parrafo',
            n('nota') + ' textos · ' + n('tabla') + ' tablas · ' + n('foto') + ' fotos · ' +
            n('prueba') + ' pruebas · ' + n('pendiente') + ' pendientes'),
      excluidos ? h('p.pista', excluidos + ' registro(s) marcados "fuera del reporte" no saldran.') : null,
      (!esProc && pruebasAbiertas) ? h('p.pista', '⚠ ' + pruebasAbiertas + ' prueba(s) sin resultado: saldran como "(pendiente de resultado)".') : null,
      h('p.pista', esProc
        ? 'El PowerPoint se genera en el telefono, sin internet: portada + una diapositiva por paso, con su texto y sus fotos (mas de 4 fotos continua en otra diapositiva).'
        : 'El Word se genera en el telefono, sin internet. El indice se actualiza solo al abrirlo en Word. Las observaciones y recomendaciones se agregan en su seccion, al final del arbol.')
    );

    const estado = h('p.pista', '');

    // Android solo abre el menu de compartir si se pide "recien tocado el
    // boton" (la activacion del toque caduca en ~5 s). Generar el archivo
    // toma segundos, asi que se prepara desde que abre esta hoja: al tocar
    // Compartir ya esta listo y el menu abre al instante.
    let preparado = null;
    let prepPromesa = null;
    const preparar = () => {
      if (preparado) return Promise.resolve(preparado);
      if (!prepPromesa) {
        prepPromesa = (esProc
          ? import('../presentacion.js').then(m => m.generarPresentacion(servicio.id))
          : generarReporte(servicio.id))
          .then(res => {
            preparado = res;
            estado.textContent = 'Archivo listo.';
            return res;
          })
          .catch(e => { prepPromesa = null; throw e; });
      }
      return prepPromesa;
    };
    estado.textContent = 'Preparando el archivo...';
    preparar().catch(() => { estado.textContent = ''; });

    // La URL vive 90 s: en telefonos lentos la descarga tarda en arrancar y
    // revocarla antes la cancela sin ningun aviso.
    const descargar = (blob, nombreArchivo) => {
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: nombreArchivo });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 90000);
    };

    // Genera (o toma el ya preparado) y le pasa el archivo a la accion.
    const conArchivo = async (accion) => {
      let res;
      try {
        if (!preparado) estado.textContent = 'Generando...';
        res = await preparar();
      } catch (e) {
        console.error(e);
        estado.textContent = 'Fallo al generar: ' + (e && e.message ? e.message : e);
        aviso('No se pudo generar el reporte', 'error');
        return;
      }
      await accion(res);
    };

    // Guardar en...: abre el explorador de Android para elegir carpeta
    // (ahi tambien aparece OneDrive). Si el navegador no tiene el selector,
    // cae a la descarga directa.
    const guardarEn = async ({ blob, nombreArchivo }) => {
      // En el APK, Descargar guarda DIRECTO en la carpeta de la app:
      // Documentos/ReportesServicio/Reportes. Compartir queda para OneDrive.
      if (esNativa()) {
        try {
          await guardarEnCarpetaNativa(blob, 'Reportes/' + nombreArchivo);
          estado.textContent = 'Guardado en Documentos/ReportesServicio/Reportes/' + nombreArchivo;
          aviso('Reporte guardado en la carpeta de la app', 'ok');
        } catch (e) {
          console.error(e);
          estado.textContent = 'No se pudo guardar [' + (e && e.message ? e.message : e) + ']. Usa Compartir.';
        }
        return;
      }
      if (!window.showSaveFilePicker) {
        descargar(blob, nombreArchivo);
        estado.textContent = 'Este navegador no deja elegir carpeta; se descargo directo. Busca "' +
          nombreArchivo + '" en la carpeta Descargas.';
        aviso('Reporte descargado', 'ok');
        return;
      }
      try {
        const ext = '.' + nombreArchivo.split('.').pop().toLowerCase();
        const destino = await showSaveFilePicker({
          suggestedName: nombreArchivo,
          types: [{ description: 'Reporte', accept: { [blob.type]: [ext] } }],
        });
        const flujo = await destino.createWritable();
        await flujo.write(blob);
        await flujo.close();
        estado.textContent = 'Guardado: ' + (destino.name || nombreArchivo);
        aviso('Archivo guardado', 'ok');
      } catch (e) {
        if (e && e.name === 'AbortError') { estado.textContent = 'Guardado cancelado.'; return; }
        console.error(e);
        descargar(blob, nombreArchivo);
        estado.textContent = 'No abrio el selector (' + (e && e.name ? e.name : e) +
          '); se descargo directo. Busca "' + nombreArchivo + '" en Descargas.';
      }
    };

    // Compartir: el menu nativo de Android (apps, imprimir, Drive...).
    // En el APK (Capacitor) va por el puente nativo: acepta Word/PowerPoint.
    // En navegador, Android solo lo abre si se pide EN el mismo toque, sin
    // ningun await antes del share — por eso la parte web no es async.
    const compartir = (res) => {
      const { blob, nombreArchivo } = res;
      if (esNativa()) {
        compartirArchivoNativo(blob, nombreArchivo, nombreArchivo)
          .then(() => { estado.textContent = 'Compartido.'; aviso('Reporte compartido', 'ok'); })
          .catch((e) => {
            if (e && /cancel/i.test((e.message || '') + e)) { estado.textContent = 'Menu cerrado sin elegir app.'; return; }
            console.error(e);
            estado.textContent = 'No se pudo compartir [' + (e && e.message ? e.message : e) + ']. Usa Descargar.';
          });
        return;
      }
      if (!navigator.share) {
        estado.textContent = 'Este navegador no tiene menu de compartir. Usa Descargar.';
        return;
      }
      const archivo = new File([blob], nombreArchivo, { type: blob.type });
      const t0 = Date.now();
      navigator.share({ files: [archivo], title: nombreArchivo })
        .then(() => {
          const seg = Math.round((Date.now() - t0) / 100) / 10;
          estado.textContent = 'Compartido en ' + seg + ' s.'
            + (seg < 1.5 ? ' Si no se abrio ninguna app, usa Descargar.' : '');
          aviso('Reporte compartido', 'ok');
        })
        .catch((e) => {
          console.error(e);
          if (e && e.name === 'AbortError') { estado.textContent = 'Menu cerrado sin elegir app.'; return; }
          // Chrome tiene lista fija de tipos compartibles (fotos, video,
          // audio, texto, PDF); Word y PowerPoint NO estan.
          estado.textContent = (e && e.name === 'NotAllowedError')
            ? 'Chrome no deja pasar Word/PowerPoint por el menu de Android. Usa Descargar: ahi eliges OneDrive.'
            : 'No se pudo compartir [' + (e && e.name ? e.name : e) + ']. Usa Descargar.';
        });
    };

    return h('div',
      resumen, estado,
      esProc ? null : h('div.hoja__acciones',
        h('button.btn.btn--fantasma.crece', {
          type: 'button',
          onclick: () => vistaPreviaReporte(servicio.id)
        }, '👁  Vista previa del reporte')
      ),
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', {
          type: 'button',
          // Con el archivo ya listo, compartir se lanza EN el toque mismo;
          // solo la primera vez (aun generando) pasa por la espera.
          onclick: () => { if (preparado) compartir(preparado); else conArchivo(compartir); }
        }, icono('compartir'), ' Compartir'),
        h('button.btn.btn--primario', { type: 'button', onclick: () => conArchivo(guardarEn) },
          icono('descargar'), ' Descargar')
      )
    );
  });
}

export async function agregarActividad(servicioId, esPaso) {
  const catalogo = esPaso ? [] : await db.catalogoEquipos();

  const nombre = await hoja(esPaso ? 'Nuevo paso' : 'Nueva actividad', (cerrar) => {
    const cNombre = campo(esPaso ? 'Titulo del paso' : 'Titulo de la actividad', {
      placeholder: esPaso ? 'Retirar guarda de seguridad' : 'Pruebas de tarjeta IPC',
      autocomplete: 'off',
    });

    const rapidas = catalogo.length
      ? h('div.chips',
          h('span.pista', 'Usadas antes:'),
          catalogo.slice(0, 6).map(c => h('button.chip', {
            type: 'button',
            onclick: () => { cNombre.entrada.value = c.valor; cNombre.entrada.focus(); }
          }, c.valor))
        )
      : null;

    return h('div',
      cNombre, rapidas,
      h('p.pista', esPaso
        ? 'Cada paso sera una diapositiva de la presentacion, con su texto y sus fotos.'
        : 'Cada actividad es una rama del arbol: ahi caen sus notas, tablas, fotos y pruebas. En el reporte sera una seccion.'),
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button', onclick: () => cerrar(cNombre.entrada.value.trim())
        }, esPaso ? 'Crear paso' : 'Crear rama')
      )
    );
  });

  if (!nombre) return null;
  const actividad = await db.equipoNuevo(servicioId, { nombre });
  aviso(esPaso ? 'Paso creado' : 'Actividad creada', 'ok');
  return actividad;
}

function menuRama(actividad, conteo, refrescar) {
  return h('button.icono-btn.icono-btn--mini.icono-btn--tenue', {
    type: 'button', 'aria-label': 'Opciones',
    onclick: async (ev) => {
      ev.stopPropagation();
      const accion = await hoja(actividad.nombre, (cerrar) => h('div.lista-acciones',
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('renombrar') }, '✎  Renombrar'),
        h('button.lista-acciones__item.lista-acciones__item--peligro',
          { type: 'button', onclick: () => cerrar('borrar') }, '🗑  Eliminar actividad')
      ));

      if (accion === 'renombrar') {
        const nombre = await hoja('Renombrar actividad', (cerrar) => {
          const cNombre = campo('Titulo', { value: actividad.nombre });
          return h('div', cNombre,
            h('div.hoja__acciones',
              h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
              h('button.btn.btn--primario', {
                type: 'button', onclick: () => cerrar(cNombre.entrada.value.trim())
              }, 'Guardar')));
        });
        if (nombre) { actividad.nombre = nombre; await db.equipoGuardar(actividad); refrescar(); }
      } else if (accion === 'borrar') {
        const ok = await confirmar('Se elimina "' + actividad.nombre + '" con sus ' +
          conteo + ' registros. Esto no se puede deshacer.');
        if (ok) { await db.equipoBorrar(actividad.id); aviso('Actividad eliminada'); refrescar(); }
      }
    }
  }, '⋯');
}

// Estado de colapso por trabajo: lista de ids de rama cerradas. Se recuerda
// entre visitas para poder ir cerrando las actividades ya terminadas.
function ramasCerradas(servicioId) {
  try { return JSON.parse(localStorage.getItem('colapso:' + servicioId)) || []; }
  catch (e) { return []; }
}

function guardarCerradas(servicioId, lista) {
  localStorage.setItem('colapso:' + servicioId, JSON.stringify(lista));
}

function rama(servicio, actividad, eventos, refrescar, numeroPaso) {
  const esGeneral = actividad.id === db.GENERAL;
  const esObs = actividad.id === db.OBSERVACIONES;
  const esProc = (servicio.tipo === 'procedimiento');
  const sinResultado = eventos.filter(e => e.tipo === 'prueba' && !e.datos.resultado).length;
  const nombreVisible = numeroPaso ? numeroPaso + '. ' + actividad.nombre : actividad.nombre;
  const cerrada = ramasCerradas(servicio.id).includes(actividad.id);

  // Tocar el encabezado colapsa o expande la rama (la palomita ⋯ no: corta
  // la burbuja). El estado se guarda al instante.
  const alternar = () => {
    const quedo = seccion.classList.toggle('rama--cerrada');
    cabeza.setAttribute('aria-expanded', String(!quedo));
    const lista = ramasCerradas(servicio.id).filter(id => id !== actividad.id);
    if (quedo) lista.push(actividad.id);
    guardarCerradas(servicio.id, lista);
  };

  const cabeza = h('div.rama__cabeza', {
    role: 'button', tabindex: '0', 'aria-expanded': String(!cerrada),
    onclick: alternar,
    onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); alternar(); } },
  },
    h('span.rama__rombo'),
    h('span.rama__nombre', nombreVisible),
    eventos.length ? h('span.rama__conteo', String(eventos.length)) : null,
    sinResultado ? h('span.rama__pendiente', sinResultado + ' sin resultado') : null,
    h('span.crece'),
    (esGeneral || esObs) ? null : menuRama(actividad, eventos.length, refrescar),
    h('span.rama__flecha', '▾')
  );

  // El + va al FINAL de la linea de tiempo: el siguiente nodo de la secuencia.
  // En procedimientos cada paso es una diapositiva: texto, imagenes, tablas
  // y pendientes (sin pruebas). En la seccion fija de observaciones solo
  // entran textos e imagenes: cada texto sera una viñeta del reporte.
  const opciones = esObs ? ['camara', 'galeria', 'nota']
    : esProc ? ['camara', 'galeria', 'nota', 'tabla', 'pendiente']
    : null;

  const agregar = h('button.rama__agregar', {
    type: 'button', 'aria-label': 'Agregar en ' + actividad.nombre,
    onclick: () => menuAgregar(servicio.id, actividad.id, refrescar, nombreVisible, opciones, esProc),
  }, '+');

  const seccion = h('section.rama' + (esObs ? '.rama--fija' : '') + (cerrada ? '.rama--cerrada' : ''),
    { dataset: { rama: actividad.id } },
    cabeza,
    h('div.rama__cuerpo',
      esObs && !eventos.length
        ? h('p.rama__pista', 'Como quedo la maquina y que se recomienda. Cada texto sale como viñeta en el reporte.')
        : null,
      eventos.length ? lineaDeTiempo(eventos, refrescar) : null,
      agregar
    )
  );
  return seccion;
}

export async function render(contenedor, refrescar, params) {
  media.liberarUrls();
  const servicio = await db.servicioLeer(params.sid);
  if (!servicio) { location.replace('#/'); return; }

  // v3.18 guardaba observaciones/recomendaciones como campos de texto; hoy son
  // registros de la seccion fija. Migra al abrir (cada renglon, una viñeta).
  if ((servicio.observaciones || '').trim() || (servicio.recomendaciones || '').trim()) {
    const lineas = ((servicio.observaciones || '') + '\n' + (servicio.recomendaciones || ''))
      .split('\n').map(s => s.trim()).filter(Boolean);
    for (const texto of lineas) await db.eventoNuevo(servicio.id, db.OBSERVACIONES, 'nota', { texto });
    servicio.observaciones = '';
    servicio.recomendaciones = '';
    await db.servicioGuardar(servicio);
  }

  const actividades = await db.equiposDeServicio(servicio.id);
  const eventos = await db.eventosDeServicio(servicio.id);

  const porRama = {};
  for (const ev of eventos) {
    (porRama[ev.equipoId] = porRama[ev.equipoId] || []).push(ev);
  }

  // (declarados antes de la cabecera para que sus botones tambien guarden
  //  la posicion del scroll al refrescar)
  const cont = h('main.contenido');
  const claveScroll = 'scroll:' + servicio.id;
  const alRefrescar = () => {
    sessionStorage.setItem(claveScroll, String(cont.scrollTop));
    refrescar();
  };

  const tipo = db.tipoDe(servicio);
  const esServicio = (servicio.tipo || 'servicio') === 'servicio';

  // Titulo: icono del tipo + la falla. Debajo, cliente y sede.
  const titulo = esServicio && servicio.descripcion
    ? tipo.icono + ' ' + servicio.descripcion
    : (servicio.titulo || servicio.cliente || servicio.planta || tipo.nombre);
  const sub = esServicio
    ? [servicio.cliente, servicio.planta].filter(Boolean).join(' · ')
    : tipo.icono + ' ' + tipo.nombre + (servicio.planta ? ' · ' + servicio.planta : '');

  const maquina = [[servicio.marca, servicio.modelo].filter(Boolean).join(' '), servicio.serie,
    servicio.noMaquina ? 'Maq. ' + servicio.noMaquina : '']
    .filter(Boolean).join(' · ');

  const cabecera = h('header.cabecera',
    h('div.cabecera__fila',
      h('button.icono-btn', { type: 'button', 'aria-label': 'Volver',
        onclick: () => history.back() }, '←'),
      h('div.cabecera__titulo',
        h('h1.cabecera__h1doble', titulo),
        sub ? h('p', sub) : null
      ),
      h('button.icono-btn', { type: 'button', 'aria-label': 'Generar reporte',
        onclick: () => hojaReporte(servicio) }, '📄'),
      h('button.icono-btn', { type: 'button', 'aria-label': 'Fotos del trabajo',
        onclick: async () => {
          await galeriaDelTrabajo(servicio.id);
          alRefrescar();   // por si borro o excluyo fotos desde el visor
        } }, '🖼'),
      h('button.icono-btn', { type: 'button', 'aria-label': 'Editar datos',
        onclick: async () => { if (await editarServicio(servicio)) alRefrescar(); } }, '✎')
    ),
    maquina ? h('div.cabecera__maquina', '⚙ ' + maquina) : null,
    h('div.cabecera__meta',
      h('span', fecha(servicio.inicio) + ' · ' + hora(servicio.inicio)),
      servicio.tecnico ? h('span', '· ' + servicio.tecnico) : null,
      h('span.crece'),
      h('span', duracion(servicio.inicio, servicio.fin))
    )
  );

  const esProc = servicio.tipo === 'procedimiento';
  const general = { id: db.GENERAL, nombre: 'General' };
  const evGeneral = porRama[db.GENERAL] || [];

  const arbol = h('div.arbol',
    // En procedimientos el tronco General se oculta si esta vacio: ahi solo
    // cuentan los pasos (cada uno una diapositiva).
    (esProc && !evGeneral.length) ? null : rama(servicio, general, evGeneral, alRefrescar),
    actividades.map((a, i) => rama(servicio, a, porRama[a.id] || [], alRefrescar, esProc ? i + 1 : 0)),
    h('button.rama-nueva', {
      type: 'button',
      onclick: async () => { if (await agregarActividad(servicio.id, esProc)) alRefrescar(); }
    },
      h('span.rama-nueva__rombo', '+'),
      h('span', esProc ? 'Nuevo paso' : 'Nueva actividad')
    ),
    // Seccion fija al final: observaciones y recomendaciones del reporte.
    esProc ? null : rama(servicio,
      { id: db.OBSERVACIONES, nombre: 'Observaciones y recomendaciones' },
      porRama[db.OBSERVACIONES] || [], alRefrescar)
  );
  cont.append(arbol);
  contenedor.append(cabecera, cont);

  const ramaDestino = sessionStorage.getItem('irARama:' + servicio.id);
  if (ramaDestino !== null) {
    sessionStorage.removeItem('irARama:' + servicio.id);
    // setTimeout y no requestAnimationFrame: rAF no corre si la pestaña no
    // esta componiendo (p. ej. pantalla recién despierta) y el brinco se
    // perderia; el doble disparo cubre layouts tardios.
    const ir = () => {
      const fin = cont.querySelector('.rama[data-rama="' + ramaDestino + '"] .rama__agregar');
      if (fin) fin.scrollIntoView({ block: 'center' });
      sessionStorage.setItem(claveScroll, String(cont.scrollTop));
    };
    setTimeout(ir, 0);
    setTimeout(ir, 150);
  } else {
    const previo = sessionStorage.getItem(claveScroll);
    if (previo) cont.scrollTop = Number(previo);
  }

  let tScroll = null;
  cont.addEventListener('scroll', () => {
    if (tScroll) return;
    tScroll = setTimeout(() => {
      tScroll = null;
      sessionStorage.setItem(claveScroll, String(cont.scrollTop));
    }, 150);
  });
}
