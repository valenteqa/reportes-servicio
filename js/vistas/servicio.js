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

const TAMANOS_FOTO = [
  ['chico',   'PEQUEÑO',  'tamaño parrafo'],
  ['mediano', 'MEDIANO',  'media hoja'],
  ['grande',  'GRANDE',   'hoja completa'],
];

// Antes de generar el Word: ¿de que tamaño salen las fotos? Un tamaño para
// todas, o "elegir por imagen" (asistente foto por foto). Devuelve false si
// el usuario cancelo (no se genera).
async function elegirTamanoFotos(fotos) {
  const op = await hoja('Tamaño de las fotos en el reporte', (cerrar) => h('div',
    h('div.lista-acciones',
      TAMANOS_FOTO.map(([clave, etiqueta, pista]) =>
        h('button.lista-acciones__item.opcion-fuerte', { type: 'button', onclick: () => cerrar(clave) },
          etiqueta + ' — ' + pista)),
      h('button.lista-acciones__item.opcion-fuerte', { type: 'button', onclick: () => cerrar('porImagen') },
        '🖼  ELEGIR POR IMAGEN')
    ),
    h('p.pista', 'Aplica a las ' + fotos.length + ' foto(s) del reporte. Con "elegir por imagen" decides una por una, viendo cada foto.')
  ));
  if (!op) return false;
  if (op !== 'porImagen') {
    for (const f of fotos) { f.datos.tamImagen = op; await db.eventoGuardar(f); }
    return true;
  }
  return elegirTamanoPorImagen(fotos);
}

async function elegirTamanoPorImagen(fotos) {
  for (let i = 0; i < fotos.length; i++) {
    const ev = fotos[i];
    const foto = await db.fotoLeer(ev.datos.fotoId);
    if (!foto) continue;
    const url = URL.createObjectURL(foto.blob);
    const eleccion = await hoja('Foto ' + (i + 1) + ' de ' + fotos.length, (cerrar) => h('div.eleccion-tam',
      h('img.eleccion-tam__img', { src: url, alt: '' }),
      ev.datos.pie ? h('p.pista', ev.datos.pie) : null,
      h('div.eleccion-tam__botones',
        TAMANOS_FOTO.map(([clave, etiqueta]) =>
          h('button.btn.opcion-fuerte' + (ev.datos.tamImagen === clave ? '.btn--primario' : '.btn--fantasma'),
            { type: 'button', onclick: () => cerrar(clave) }, etiqueta))
      ),
      h('p.pista', 'PEQUEÑO = parrafo · MEDIANO = media hoja · GRANDE = hoja completa')
    ), { altura: 'alta' });
    URL.revokeObjectURL(url);
    if (!eleccion) return false;   // cancelo: no se genera
    ev.datos.tamImagen = eleccion;
    await db.eventoGuardar(ev);
  }
  return confirmar('¿Generar Reporte?', { textoOk: 'Generar', peligro: false });
}

// Huella del contenido que sale en el reporte: si cambia, el ultimo archivo
// generado quedo viejo. Incluye datos del servicio, ramas, cada registro
// incluido, y para las fotos su edicion (recortes/formas cambian la imagen).
async function huellaReporte(servicio, incluidos) {
  const nucleo = {
    s: [servicio.titulo, servicio.descripcion, servicio.cliente, servicio.planta,
      servicio.marca, servicio.modelo, servicio.serie, servicio.noMaquina,
      servicio.tecnico, servicio.folio],
    e: (await db.equiposDeServicio(servicio.id)).map(a => [a.id, a.nombre, a.orden]),
    v: [],
  };
  for (const ev of incluidos) {
    nucleo.v.push([ev.id, ev.tipo, ev.equipoId, JSON.stringify(ev.datos)]);
    if (ev.tipo === 'foto' && ev.datos && ev.datos.fotoId) {
      const f = await db.fotoLeer(ev.datos.fotoId);
      nucleo.v.push(['ed', ev.datos.fotoId,
        JSON.stringify((f && f.edicion) || null), (f && f.blob && f.blob.size) || 0]);
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(nucleo));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Si ya hay tamaños elegidos de un reporte anterior, pregunta si se dejan
// tal cual o se cambian; las fotos NUEVAS (sin tamaño) se preguntan una por
// una despues. Sin tamaños previos, va el flujo completo de siempre.
async function flujoTamanoFotos(fotos) {
  const conTam = fotos.filter(f => f.datos.tamImagen);
  const sinTam = fotos.filter(f => !f.datos.tamImagen);
  if (!conTam.length) return elegirTamanoFotos(fotos);

  const op = await hoja('Tamaño de las fotos', (cerrar) => h('div',
    h('p.parrafo', conTam.length + ' foto(s) ya tienen su tamaño elegido' +
      (sinTam.length ? ' y hay ' + sinTam.length + ' foto(s) nueva(s)' : '') +
      '. ¿Dejar el tamaño de las imagenes como esta, o cambiarlas?'),
    h('div.lista-acciones',
      h('button.lista-acciones__item.opcion-fuerte', { type: 'button', onclick: () => cerrar('dejar') },
        '✔  DEJAR COMO ESTAN'),
      h('button.lista-acciones__item.opcion-fuerte', { type: 'button', onclick: () => cerrar('cambiar') },
        '✎  CAMBIARLAS')
    ),
    sinTam.length ? h('p.pista', 'Las fotos nuevas se preguntan una por una en seguida.') : null
  ));
  if (!op) return false;
  if (op === 'cambiar') return elegirTamanoFotos(fotos);
  if (sinTam.length) return elegirTamanoPorImagen(sinTam);
  return true;
}

async function hojaReporte(servicio, previoAUsar) {
  const esProc = servicio.tipo === 'procedimiento';
  const eventos = await db.eventosDeServicio(servicio.id);
  const incluidos = eventos.filter(e => e.incluir !== false);

  // Sin observaciones y recomendaciones NO hay reporte: es la seccion que
  // el cliente siempre espera (los procedimientos no la llevan).
  if (!esProc && !incluidos.some(e => e.equipoId === db.OBSERVACIONES)) {
    aviso('Agrega al menos una observacion o recomendacion (seccion al final del arbol) antes de generar el reporte', 'error');
    return;
  }

  if (!previoAUsar) {
    // ¿Ya hay un reporte generado de este trabajo? Ofrecer reusarlo.
    const previo = await db.ajusteLeer('reporte:' + servicio.id);
    const valido = previo && previo.blob instanceof Blob && previo.blob.size > 0;
    if (valido) {
      const cuando = fecha(previo.fecha) + ' · ' + hora(previo.fecha);
      const sinCambios = previo.huella === await huellaReporte(servicio, incluidos);
      const op = await hoja(esProc ? '📊  Presentacion' : '📄  Reporte', (cerrar) => h('div',
        h('p.parrafo', sinCambios
          ? 'Ya hay un reporte generado de este trabajo (' + cuando + ') y no ha habido cambios desde entonces. ¿Deseas compartirlo o crear uno nuevo?'
          : 'Hubo cambios desde el ultimo reporte generado (' + cuando + '). ¿Generar el nuevo?'),
        h('div.lista-acciones',
          sinCambios
            ? [h('button.lista-acciones__item.opcion-fuerte', { type: 'button', onclick: () => cerrar('previo') },
                '📤  COMPARTIR EL GENERADO'),
              h('button.lista-acciones__item.opcion-fuerte', { type: 'button', onclick: () => cerrar('nuevo') },
                '📄  CREAR UNO NUEVO')]
            : [h('button.lista-acciones__item.opcion-fuerte', { type: 'button', onclick: () => cerrar('nuevo') },
                '📄  GENERAR EL NUEVO'),
              h('button.lista-acciones__item.opcion-fuerte', { type: 'button', onclick: () => cerrar('previo') },
                '📤  USAR EL ANTERIOR')]
        )
      ));
      if (!op) return;
      if (op === 'previo') return hojaReporte(servicio, previo);
    }
  }

  // Tamaño de las fotos (solo Word y solo al crear archivo nuevo).
  if (!esProc && !previoAUsar) {
    const fotos = incluidos.filter(e => e.tipo === 'foto');
    if (fotos.length && !(await flujoTamanoFotos(fotos))) return;
  }
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
      // Entregando el archivo YA generado: nada que regenerar.
      if (previoAUsar) {
        preparado = { blob: previoAUsar.blob, nombreArchivo: previoAUsar.nombre };
        estado.textContent = 'Archivo listo (generado el ' + fecha(previoAUsar.fecha) + ' · ' + hora(previoAUsar.fecha) + ').';
        return Promise.resolve(preparado);
      }
      if (!prepPromesa) {
        prepPromesa = (esProc
          ? import('../presentacion.js').then(m => m.generarPresentacion(servicio.id))
          : generarReporte(servicio.id))
          .then(async (res) => {
            preparado = res;
            estado.textContent = 'Archivo listo.';
            // Recordar el archivo y la huella del contenido: la proxima vez
            // se ofrece compartirlo directo o avisa si hubo cambios.
            try {
              const inc = (await db.eventosDeServicio(servicio.id)).filter(e => e.incluir !== false);
              await db.ajusteGuardar('reporte:' + servicio.id, {
                blob: res.blob,
                nombre: res.nombreArchivo,
                fecha: Date.now(),
                huella: await huellaReporte(servicio, inc),
              });
            } catch (e2) { console.error('memoria del reporte', e2); }
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
  const esAnte = actividad.id === db.ANTECEDENTES;
  const esFija = esObs || esAnte;
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
    (esGeneral || esFija) ? null : menuRama(actividad, eventos.length, refrescar),
    h('span.rama__flecha', '▾')
  );

  // El + va al FINAL de la linea de tiempo: el siguiente nodo de la secuencia.
  // TODOS los tipos de trabajo ofrecen el menu completo (foto, texto, tabla,
  // prueba, pendiente). Las secciones fijas (antecedentes y observaciones)
  // se limitan a textos e imagenes: cada texto sale como viñeta.
  const opciones = esFija ? ['camara', 'galeria', 'nota'] : null;

  const agregar = h('button.rama__agregar', {
    type: 'button', 'aria-label': 'Agregar en ' + actividad.nombre,
    onclick: () => menuAgregar(servicio.id, actividad.id, refrescar, nombreVisible, opciones, esProc),
  }, '+');

  const seccion = h('section.rama' + (esFija ? '.rama--fija' : '') + (cerrada ? '.rama--cerrada' : ''),
    { dataset: { rama: actividad.id } },
    cabeza,
    h('div.rama__cuerpo',
      esObs && !eventos.length
        ? h('p.rama__pista', 'Como quedo la maquina y que se recomienda. Cada texto sale como viñeta en el reporte.')
        : null,
      esAnte && !eventos.length
        ? h('p.rama__pista', 'El contexto previo al servicio (historial, sintomas, visitas anteriores). Si se queda vacia, la seccion NO sale en el reporte.')
        : null,
      eventos.length ? lineaDeTiempo(eventos, refrescar) : null,
      agregar
    )
  );
  return seccion;
}

// Pregunta (una vez) si la tabla recien creada se guarda como predeterminada.
// El nombre es OBLIGATORIO. Se guarda la estructura, no los valores.
async function ofrecerGuardarPlantilla(eventos) {
  const ev = eventos.find(e => e.tipo === 'tabla' && e.preguntarPlantilla);
  if (!ev) return;
  delete ev.preguntarPlantilla;   // pregunta una sola vez, decida lo que decida
  await db.eventoGuardar(ev);

  const t = ev.datos || {};
  if (!t.columnas || !t.columnas.length) return;
  // Si la dejo tal cual salio (2 columnas Punto/Valor, sin titulo ni datos),
  // no hay nada que valga la pena guardar: no molestar.
  const sinCambios = !String(t.titulo || '').trim() &&
    t.columnas.length === 2 &&
    (t.columnas[0].nombre || '') === 'Punto' && (t.columnas[1].nombre || '') === 'Valor' &&
    (t.filas || []).every(f => f.every(c => !String(c).trim()));
  if (sinCambios) return;

  const quiere = await confirmar(
    '¿Guardar esta tabla como PREDETERMINADA para reutilizarla en otros trabajos? Se guarda su estructura (titulo, columnas y renglones), no los valores.',
    { textoOk: 'Guardar', peligro: false });
  if (!quiere) return;

  let nombre = null;
  await hoja('Nombre de la tabla', (cerrar) => {
    const cNombre = campo('Nombre', { value: t.titulo || '' });
    return h('div',
      cNombre,
      h('p.pista', 'Obligatorio: con este nombre aparecera en el menu al agregar una tabla.'),
      h('div.hoja__acciones',
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => {
            const v = cNombre.querySelector('input').value.trim();
            if (!v) { aviso('Ponle un nombre', 'error'); return; }
            nombre = v;
            cerrar(true);
          }
        }, 'Guardar'))
    );
  });
  if (!nombre) return;
  await db.tablaPredeterminadaGuardar(nombre, t);
  aviso('Guardada en tablas predeterminadas', 'ok');
}

export async function render(contenedor, refrescar, params) {
  media.liberarUrls();
  const servicio = await db.servicioLeer(params.sid);
  if (!servicio) { location.replace('#/t'); return; }

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

  // Si el usuario acaba de construir una "tabla nueva", al volver al arbol se
  // ofrece guardarla como predeterminada (una sola vez por tabla).
  ofrecerGuardarPlantilla(eventos).catch(console.error);

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
      h('button.icono-btn', { type: 'button', 'aria-label': 'Tablas del trabajo',
        onclick: async () => {
          const m = await import('./tabla.js');
          await m.tablasDelTrabajo(servicio.id);
        } }, '▦'),
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

  // Indicador flotante de rama: al scrollear una linea de tiempo larga,
  // si el titulo de la rama actual ya no esta a la vista, un gafete arriba
  // dice EN QUE RAMA estas y la hora del registro visible.
  const gafete = h('div.rama-flotante', { style: { display: 'none' } });
  contenedor.appendChild(gafete);
  const actualizarGafete = () => {
    const limite = cabecera.getBoundingClientRect().bottom;
    let actual = null;
    for (const sec of cont.querySelectorAll('section.rama')) {
      if (sec.getBoundingClientRect().top <= limite + 8) actual = sec;
      else break;
    }
    if (!actual) { gafete.style.display = 'none'; return; }
    const cab = actual.querySelector('.rama__cabeza');
    if (!cab || cab.getBoundingClientRect().bottom > limite) {
      gafete.style.display = 'none';   // el titulo de la rama se ve: sobra
      return;
    }
    let horaVisible = '';
    for (const hEl of actual.querySelectorAll('.tarjeta__hora')) {
      if (hEl.getBoundingClientRect().bottom > limite) { horaVisible = hEl.textContent; break; }
    }
    gafete.replaceChildren(
      h('strong', (actual.querySelector('.rama__nombre') || { textContent: '' }).textContent),
      horaVisible ? ' · ' + horaVisible : ''
    );
    gafete.style.top = (limite + 6) + 'px';
    gafete.style.display = '';
  };
  let marcoGafete = null;
  cont.addEventListener('scroll', () => {
    if (marcoGafete) return;
    marcoGafete = requestAnimationFrame(() => { marcoGafete = null; actualizarGafete(); });
  }, { passive: true });
  cont.__actualizarGafete = actualizarGafete;   // gancho para pruebas

  const arbol = h('div.arbol',
    // Seccion fija al inicio: antecedentes (si queda vacia, no sale en el reporte).
    esProc ? null : rama(servicio,
      { id: db.ANTECEDENTES, nombre: 'Antecedentes' },
      porRama[db.ANTECEDENTES] || [], alRefrescar),
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
