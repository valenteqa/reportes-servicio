// Editor de tablas.
//
// Pensado para teclear con una mano y guantes: celdas grandes, teclado numerico
// automatico en columnas de numero, primera columna congelada al hacer scroll
// horizontal, y guardado automatico (nunca hay que acordarse de un boton Guardar).

import * as db from '../db.js';
import { h, hoja, aviso, confirmar, campo, hora, fecha, orientarLibre, orientarHorizontal, orientarNormal } from '../ui.js';

let guardadoPendiente = null;

function guardarPronto(evento, indicador) {
  clearTimeout(guardadoPendiente);
  indicador.textContent = 'Guardando...';
  indicador.classList.add('estado--activo');
  guardadoPendiente = setTimeout(async () => {
    await db.eventoGuardar(evento);
    indicador.textContent = 'Guardado';
    setTimeout(() => indicador.classList.remove('estado--activo'), 1200);
  }, 400);
}

async function guardarYa(evento) {
  clearTimeout(guardadoPendiente);
  await db.eventoGuardar(evento);
}

async function editarColumna(evento, indice, repintar) {
  const col = evento.datos.columnas[indice];

  const resultado = await hoja('Columna', (cerrar) => {
    const cNombre = campo('Nombre', { value: col.nombre, placeholder: 'Voltaje' });
    const cUnidad = campo('Unidad', { value: col.unidad || '', placeholder: 'VDC' });

    const selTipo = h('div.segmentado',
      h('button.segmentado__op', { type: 'button', dataset: { t: 'texto' } }, 'Texto'),
      h('button.segmentado__op', { type: 'button', dataset: { t: 'numero' } }, 'Numero')
    );
    let tipo = col.tipo || 'texto';
    const marcar = () => Array.from(selTipo.children).forEach(b =>
      b.classList.toggle('segmentado__op--activa', b.dataset.t === tipo));
    marcar();
    selTipo.addEventListener('click', (ev) => {
      const b = ev.target.closest('.segmentado__op');
      if (b) { tipo = b.dataset.t; marcar(); }
    });

    return h('div',
      cNombre, cUnidad,
      h('label.campo', h('span.campo__etiqueta', 'Tipo de dato'), selTipo),
      h('p.pista', 'Las columnas de numero abren el teclado numerico y se alinean a la derecha.'),
      h('div.hoja__acciones',
        evento.datos.columnas.length > 1
          ? h('button.btn.btn--peligro.btn--pequeno', { type: 'button', onclick: () => cerrar({ borrar: true }) }, 'Eliminar')
          : null,
        h('span.crece'),
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: () => cerrar({
            nombre: cNombre.entrada.value.trim() || 'Columna',
            unidad: cUnidad.entrada.value.trim(),
            tipo,
          })
        }, 'Guardar')
      )
    );
  });

  if (!resultado) return;

  if (resultado.borrar) {
    const ok = await confirmar('Se elimina la columna "' + col.nombre + '" y sus datos.');
    if (!ok) return;
    evento.datos.columnas.splice(indice, 1);
    evento.datos.filas.forEach(f => f.splice(indice, 1));
  } else {
    Object.assign(col, resultado);
  }
  await guardarYa(evento);
  repintar();
}

export async function render(contenedor, refrescar, params) {
  const evento = await db.eventoLeer(params.eventoId);
  if (!evento || evento.tipo !== 'tabla') { location.replace('#/s/' + params.sid); return; }

  const servicio = await db.servicioLeer(evento.servicioId);
  // history.back() en vez de asignar el hash: asi el boton atras del telefono
  // y el de la app recorren la misma jerarquia (tabla → arbol → lista).
  const volver = () => {
    guardarYa(evento).then(() => history.back());
  };

  const indicador = h('span.estado', 'Guardado');

  const cTitulo = h('input.titulo-tabla', {
    type: 'text',
    value: evento.datos.titulo || '',
    placeholder: 'Titulo de la tabla',
    oninput: () => { evento.datos.titulo = cTitulo.value; guardarPronto(evento, indicador); },
  });

  // En tablas el giro queda libre (para capturar a lo ancho); el boton 🔁
  // fuerza horizontal. La pantalla usa TODO el ancho disponible. Al salir
  // se vuelve a anclar vertical y al ancho normal.
  let horizontal = false;
  orientarLibre();
  document.body.classList.add('pantalla-ancha');
  window.addEventListener('hashchange', () => {
    orientarNormal();
    document.body.classList.remove('pantalla-ancha');
  }, { once: true });

  const cabecera = h('header.cabecera',
    h('div.cabecera__fila',
      h('button.icono-btn', { type: 'button', 'aria-label': 'Volver', onclick: volver }, '←'),
      h('div.cabecera__titulo', cTitulo),
      h('button.icono-btn', {
        type: 'button', 'aria-label': 'Girar pantalla',
        onclick: async () => {
          const ok = horizontal ? await orientarLibre() : await orientarHorizontal();
          if (!ok) { aviso('Este dispositivo no deja girar la pantalla desde la app', 'error'); return; }
          horizontal = !horizontal;
        }
      }, '🔁'),
      indicador
    ),
    h('div.cabecera__meta',
      h('span', hora(evento.ts) + ' · ' + fecha(evento.ts)),
      h('span.crece'),
      h('button.enlace', {
        type: 'button',
        onclick: async () => {
          const ok = await confirmar('Se elimina la tabla completa.');
          if (!ok) return;
          // OJO: no usar volver() aqui — su guardarYa re-escribiria la tabla
          // recien borrada (la resucitaba). Cancelar el autoguardado y salir.
          clearTimeout(guardadoPendiente);
          await db.eventoBorrar(evento.id);
          aviso('Tabla eliminada');
          history.back();
        }
      }, 'Eliminar tabla')
    )
  );

  const zona = h('div.zona-tabla');

  function repintar() {
    const cols = evento.datos.columnas;
    const filas = evento.datos.filas;

    const tabla = h('table.rejilla');

    const encabezado = h('tr',
      cols.map((c, i) => h('th', {
        class: c.tipo === 'numero' ? 'rejilla__th--num' : '',
        onclick: () => editarColumna(evento, i, repintar),
      },
        h('span.rejilla__nombre', c.nombre),
        c.unidad ? h('span.rejilla__unidad', c.unidad) : null,
        h('span.rejilla__lapiz', '✎')
      )),
      h('th.rejilla__accion',
        h('button.icono-btn.icono-btn--mini', {
          type: 'button', 'aria-label': 'Agregar columna',
          onclick: async () => {
            cols.push({ nombre: 'Columna ' + (cols.length + 1), unidad: '', tipo: 'numero' });
            filas.forEach(f => f.push(''));
            await guardarYa(evento);
            repintar();
          }
        }, '+'))
    );
    tabla.append(h('thead', encabezado));

    const cuerpo = h('tbody');
    filas.forEach((fila, iFila) => {
      const tr = h('tr',
        cols.map((c, iCol) => {
          const entrada = h('input.celda', {
            type: 'text',
            inputmode: c.tipo === 'numero' ? 'decimal' : 'text',
            value: fila[iCol] === undefined ? '' : fila[iCol],
            class: c.tipo === 'numero' ? 'celda--num' : '',
            oninput: () => { fila[iCol] = entrada.value; guardarPronto(evento, indicador); },
            onkeydown: (ev) => {
              if (ev.key !== 'Enter') return;
              ev.preventDefault();
              const celdas = Array.from(tabla.querySelectorAll('.celda'));
              const pos = celdas.indexOf(entrada);
              if (pos > -1 && celdas[pos + 1]) celdas[pos + 1].focus();
              else entrada.blur();
            },
          });
          return h('td', entrada);
        }),
        h('td.rejilla__accion',
          h('button.icono-btn.icono-btn--mini.icono-btn--tenue', {
            type: 'button', 'aria-label': 'Eliminar fila',
            onclick: async () => {
              filas.splice(iFila, 1);
              if (!filas.length) filas.push(cols.map(() => ''));
              await guardarYa(evento);
              repintar();
            }
          }, '−'))
      );
      cuerpo.append(tr);
    });
    tabla.append(cuerpo);

    zona.replaceChildren(
      h('div.zona-tabla__scroll', tabla),
      h('div.zona-tabla__botones',
        h('button.btn.btn--bloque', {
          type: 'button',
          onclick: async () => {
            filas.push(cols.map(() => ''));
            await guardarYa(evento);
            repintar();
            const celdas = zona.querySelectorAll('tbody tr:last-child .celda');
            if (celdas.length) celdas[0].focus();
          }
        }, '+  Agregar fila'),
        h('p.pista', 'Toca el nombre de una columna para cambiarla. Enter salta a la siguiente celda.')
      )
    );
  }

  repintar();
  contenedor.append(cabecera, h('main.contenido',
    h('p.pista.pista--tabla', 'Desliza hacia la izquierda y derecha para ver el resto de la tabla.'),
    zona));
}
