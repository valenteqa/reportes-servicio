// Pantalla inicial: lista de trabajos (servicios, pruebas de laboratorio, generales).

import * as db from '../db.js';
import { h, campo, campoArea, hoja, aviso, confirmar, fecha, vacio, ocupado, libre, animarMarca, ensayoDeMarca } from '../ui.js';
import * as media from '../media.js';
import { APP_VERSION } from '../version.js';
import { temaActual, alternarTema, zoomActual, aplicarZoom } from '../tema.js';
import { esNativa, compartirArchivoNativo, guardarEnCarpetaNativa, nombreSeguro, guardarUltimoRespaldo, leerUltimoRespaldo, instalarActualizacionApk } from '../nativo.js';
import { DEPTOS, ROLES, rolesParaDepto, ajustarRolAlDepto, organizacion, organizacionGuardar, quienSoy, quienSoyReal, serYo, esAdmin, claveDelDia, claveDeManana, activarTest, estadoPrueba } from '../organizacion.js';

// La ⚙ completa se abre con la CLAVE DEL DIA (solo el administrador la
// tiene). Una vez dada, queda abierta hasta cerrar la app: variable en
// memoria a proposito — no se persiste, asi reabrir (o reinstalar) vuelve
// a pedirla.
let configDesbloqueada = false;

export async function abrirConfiguracion() {
  // El ADMINISTRADOR entra sin clave: su identidad REAL (no la simulada
  // del modo prueba) esta sellada en su telefono. Reinstalar borra la
  // identidad, asi que un telefono recien instalado siempre pide clave.
  if (!configDesbloqueada && esAdmin(await quienSoyReal())) configDesbloqueada = true;
  if (configDesbloqueada) return hojaConfiguracion();
  const ok = await hoja('🔐  Clave de administrador', (cerrar) => {
    const c = campo('Clave del dia (6 digitos)', { type: 'password', inputMode: 'numeric', maxLength: 6, autocomplete: 'off' });
    return h('div',
      c,
      h('p.pista', 'Solo el administrador configura la app. La clave cambia cada dia.'),
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(false) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: async () => {
            const valor = c.querySelector('input').value.trim();
            if (valor === await claveDelDia()) { cerrar(true); return; }
            aviso('Clave incorrecta.', 'error');
            c.querySelector('input').value = '';
          },
        }, 'Entrar')));
  });
  if (!ok) return;
  configDesbloqueada = true;
  await hojaConfiguracion();
}

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

// Clientes conocidos de TODA la app (catalogo global). Exportado para que
// otras pantallas (p. ej. Ventas) usen EL MISMO selector: consistencia.
export async function clientesConocidos() {
  return distintosDe(await historialServicios(), 'cliente', {});
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

// Linea con la version de la app (web) y la del cascaron APK. La del APK
// se pregunta al plugin App y llega un instante despues.
export function lineaVersion() {
  const linea = h('p.pista', { style: { marginTop: '.6rem' } },
    'Version de la app: ' + APP_VERSION + (esNativa() ? '' : ' · WEB (navegador)'));
  if (esNativa()) {
    (async () => {
      try {
        const info = await window.Capacitor.Plugins.App.getInfo();
        linea.textContent = 'Version de la app: ' + APP_VERSION +
          ' · APK ' + info.version + ' (' + info.build + ')';
      } catch (e) {
        linea.textContent = 'Version de la app: ' + APP_VERSION + ' · APK';
      }
    })();
  }
  return linea;
}

export async function hojaConfiguracion() {
  const accion = await hoja('⚙  Configuracion', (cerrar) => {
    // Huevo de pascua: el probador de animaciones esta OCULTO; se abre
    // tocando 10 veces seguidas el TITULO de la hoja (max 1.5s entre
    // toques o el conteo se reinicia). El listener se engancha tras el
    // montaje (microtask: corre despues de que hoja() ya apendio el panel,
    // y no lo frena el throttling de pestañas en segundo plano).
    queueMicrotask(() => {
      const titulo = [...document.querySelectorAll('.hoja h2')].pop();
      if (!titulo || !titulo.textContent.includes('Configuracion')) return;
      let toques = 0;
      let ultimo = 0;
      titulo.addEventListener('click', () => {
        const ahora = Date.now();
        if (ahora - ultimo > 1500) toques = 0;
        ultimo = ahora;
        toques += 1;
        if (toques >= 10) { toques = 0; cerrar('probador'); }
      });
    });
    return h('div',
      h('div.lista-acciones',
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('tecnico') },
          '👤  Nombre del tecnico'),
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('usuarios') },
          '👥  Usuarios y deptos'),
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('catalogo') },
          '🗂  Clientes y datos de maquina'),
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('tablas') },
          '▦  Tablas predeterminadas'),
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('zoom') },
          '🔍  Tamaño de la interfaz'),
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('diag') },
          '🩺  Diagnostico de foto'),
        h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('prueba') },
          '🧪  Test Mode')
      ),
      h('p.pista', 'Administra las sugerencias que salen al crear o editar un servicio. Los servicios y reportes ya guardados no se tocan.'),
      lineaVersion()
    );
  });
  if (accion === 'tecnico') await hojaTecnico();
  if (accion === 'usuarios') await hojaUsuarios();
  if (accion === 'catalogo') await hojaCampoCatalogo();
  if (accion === 'tablas') await hojaTablasPredeterminadas();
  if (accion === 'zoom') await hojaZoom();
  if (accion === 'diag') await hojaDiagnostico();
  if (accion === 'prueba') await hojaPrueba();
  if (accion === 'probador') await hojaProbador();
}

// Test Mode (solo tras la clave / admin): una SESION SANDBOX de pruebas.
// Diario y Ventas usan almacenes gemelos (los datos reales no se tocan),
// y desde la BARRA SUPERIOR se cambian al momento la fecha simulada y el
// usuario con el que se ve la app. La sesion queda guardada al salir y se
// reanuda al volver a entrar.
async function hojaPrueba() {
  const estado = await estadoPrueba();

  await hoja('🧪  Test Mode', (cerrar) => h('div',
    h('p.parrafo', estado.activo
      ? 'Test Mode esta ACTIVO: usa la barra superior para cambiar usuario y fecha, o su boton SALIR para terminar.'
      : 'Al entrar, la app se vuelve un SANDBOX de pruebas: el Diario y Ventas usan datos de ensayo aparte (los reales no se tocan), y arriba aparece una barra para cambiar al momento la fecha simulada y el usuario con el que ves la app.'),
    h('p.pista', 'La sesion de test se guarda al salir y se reanuda al volver a entrar. La clave de ⚙ siempre es la del dia REAL.'),
    h('div.hoja__acciones',
      h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
      estado.activo
        ? h('button.btn.btn--primario', {
          type: 'button',
          onclick: async () => { await activarTest(false); aviso('Saliste de Test Mode. Datos reales de vuelta.'); cerrar('listo'); },
        }, 'SALIR DE TEST MODE')
        : h('button.btn.btn--primario', {
          type: 'button',
          onclick: async () => { await activarTest(true); aviso('Test Mode activo: sandbox de pruebas.'); cerrar('listo'); },
        }, 'ENTRAR A TEST MODE'))
  ));
  // repintar la vista y la barra con el estado nuevo
  window.dispatchEvent(new Event('hashchange'));
}

// Probador: el ensayo del logo (pantalla propia con animaciones y sonidos)
// y cada cameo, por nombre. Para elegir favoritas y presumir el show.
// Padron de la organizacion: quien es quien, su depto y su rol. Solo el
// ADMINISTRADOR cambia roles y deptos; elegir "de quien es este telefono"
// esta abierto (es la identificacion). Con Firebase esto tendra login real.
async function hojaUsuarios() {
  const org = await organizacion();
  const yo = await quienSoy();
  const soyAdmin = esAdmin(yo);

  await hoja('👥  Usuarios y deptos', (cerrar) => {
    // La identidad del telefono se elige UNA sola vez (regla de Vale): ya
    // elegida, se muestra fija y sin selector. El cambio real de identidad
    // llegara con el inicio de sesion en la nube.
    let bloqueYo;
    if (yo) {
      bloqueYo = h('div',
        h('label.campo',
          h('span.campo__etiqueta', 'Este telefono es de'),
          h('p.org-yo-fijo', '🔒 ' + yo.nombre + (yo.depto ? ' · ' + yo.depto : ''))),
        h('p.pista', 'La identidad se elige una sola vez por telefono.'));
    } else {
      const selYo = h('select.org-select',
        h('option', { value: '' }, '— elegir —'),
        ...org.usuarios.map(u => h('option', { value: u.id }, u.nombre)));
      selYo.onchange = async () => {
        const u = org.usuarios.find(x => x.id === selYo.value);
        if (!u) return;
        const ok = await confirmar(
          '¿Este telefono es de ' + u.nombre + '? Solo se puede elegir UNA vez: ya no podras cambiarlo.',
          { textoOk: 'Si, soy yo', peligro: false });
        if (!ok) { selYo.value = ''; return; }
        await serYo(u.id);
        aviso('Identidad guardada: ' + u.nombre);
        cerrar(null);
      };
      bloqueYo = h('div',
        h('label.campo', h('span.campo__etiqueta', 'Este telefono es de'), selYo),
        h('p.pista', 'Elige con cuidado: solo se puede elegir UNA vez por telefono.'));
    }

    // Al admin se le muestran la clave de HOY y la de MAÑANA (para no
    // depender de la tarjeta cuando trae su telefono a la mano).
    const lineaClaves = h('p.pista.org-claves');
    if (soyAdmin) {
      Promise.all([claveDelDia(), claveDeManana()]).then(([hoy, man]) => {
        lineaClaves.textContent = '🔐 Clave de hoy: ' + hoy + ' · de mañana: ' + man;
      }).catch(() => {});
    }

    // Nombre para crear o renombrar (solo el admin/developer llega aqui).
    const pedirNombre = (titulo, valor) => hoja(titulo, (cerrarNombre) => {
      const c = campo('Nombre completo', { maxLength: 80, value: valor || '' });
      return h('div', c,
        h('div.hoja__acciones',
          h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrarNombre(null) }, 'Cancelar'),
          h('button.btn.btn--primario', {
            type: 'button',
            onclick: () => {
              const v = c.querySelector('input').value.trim();
              if (!v) { aviso('Escribe el nombre.', 'error'); return; }
              cerrarNombre(v);
            },
          }, 'Guardar')));
    });

    const cuerpo = h('div');
    const pinta = () => {
      const filas = org.usuarios.map(u => {
        const selDepto = h('select.org-select',
          h('option', { value: '' }, 'Sin depto'),
          ...DEPTOS.map(d => h('option', { value: d, selected: u.depto === d }, d)));
        // Los roles disponibles dependen del depto (Ventas: vendedor/lider;
        // los demas: usuario/lider). Cambiar de depto ajusta el rol solo.
        const roles = rolesParaDepto(u.depto);
        const selRol = h('select.org-select',
          ...Object.keys(roles).map(r => h('option', { value: r, selected: u.rol === r }, roles[r])));
        selDepto.onchange = async () => {
          u.depto = selDepto.value;
          ajustarRolAlDepto(u);
          await organizacionGuardar(org);
          pinta();
        };
        selRol.onchange = async () => { u.rol = selRol.value; await organizacionGuardar(org); };
        if (!soyAdmin) { selDepto.disabled = true; selRol.disabled = true; }
        return h('div.org-fila',
          h('div.org-fila__cab',
            h('span.org-nombre', u.nombre),
            soyAdmin ? h('button.icono-btn.org-mini', {
              type: 'button', 'aria-label': 'Renombrar usuario',
              onclick: async () => {
                const nuevo = await pedirNombre('✎  Renombrar usuario', u.nombre);
                if (!nuevo) return;
                u.nombre = nuevo;
                await organizacionGuardar(org);
                pinta();
              },
            }, '✎') : null,
            soyAdmin ? h('button.icono-btn.org-mini', {
              type: 'button', 'aria-label': 'Eliminar usuario',
              onclick: async () => {
                if (yo && u.id === yo.id) { aviso('No puedes eliminarte a ti mismo.', 'error'); return; }
                if (u.rol === 'admin' && org.usuarios.filter(x => x.rol === 'admin').length <= 1) {
                  aviso('No puedes eliminar al unico administrador.', 'error');
                  return;
                }
                if (!(await confirmar('¿Eliminar a ' + u.nombre + ' del padron?'))) return;
                org.usuarios = org.usuarios.filter(x => x !== u);
                await organizacionGuardar(org);
                pinta();
              },
            }, '🗑') : null),
          h('div.org-selects', selDepto, selRol));
      });

      cuerpo.replaceChildren(...[
        bloqueYo,
        h('p.pista', soyAdmin
          ? 'Eres administrador: puedes crear, renombrar y eliminar usuarios, y asignar depto y rol.'
          : 'Solo el administrador puede cambiar el padron, los deptos y los roles.'),
        soyAdmin ? lineaClaves : null,
        soyAdmin ? h('button.btn.btn--fantasma.org-agregar', {
          type: 'button',
          onclick: async () => {
            const nombre = await pedirNombre('＋  Nuevo usuario', '');
            if (!nombre) return;
            org.usuarios.push({ id: db.nuevoId(), nombre, depto: '', rol: 'usuario' });
            await organizacionGuardar(org);
            pinta();
          },
        }, '＋  AGREGAR USUARIO') : null,
        h('div.org-lista', ...filas),
        h('p.pista', 'Deptos: ' + DEPTOS.join(', ') + '. El lider de area puede modificar o eliminar actividades de su gente; los usuarios solo agregan y marcan.'),
      ].filter(Boolean));
    };
    pinta();
    return cuerpo;
  });
}

async function hojaProbador() {
  const cam = await import('../cameos.js');
  await hoja('🎬  Probador de animaciones', (cerrar) => h('div',
    h('div.lista-acciones',
      h('button.lista-acciones__item', { type: 'button', onclick: () => ensayoDeMarca() },
        '✨  Ensayo del logo (animaciones y sonidos)')
    ),
    h('p.pista', 'Cameos (se asoman por abajo):'),
    h('div.lista-acciones',
      cam.CAMEOS.map(c =>
        h('button.lista-acciones__item', { type: 'button', onclick: () => cam.mostrarCameo(c) },
          '🎭  ' + c.nombre))
    )
  ));
}

// Administrar las tablas predeterminadas GUARDADAS (renombrar / eliminar).
// La "Tabla de Valores de VT" es de fabrica: siempre esta, no se toca.
async function hojaTablasPredeterminadas() {
  for (;;) {
    const lista = await db.tablasPredeterminadas();
    const eleccion = await hoja('▦  Tablas predeterminadas', (cerrar) => h('div',
      h('div.lista-acciones',
        h('button.lista-acciones__item', { type: 'button', disabled: true, style: { opacity: '.55' } },
          '▦  Tabla de Valores de VT — de fabrica'),
        lista.map(t => h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar(t) },
          '▦  ' + t.nombre + ' (' + (t.tabla.columnas || []).length + ' col · ' + (t.tabla.filas || []).length + ' filas)'))
      ),
      lista.length ? null : h('p.pista', 'Aun no guardas tablas propias: al terminar una tabla nueva en un trabajo, la app ofrece guardarla aqui.'),
      h('p.pista', 'Renombrar o eliminar una plantilla NO toca las tablas ya capturadas en los trabajos.')
    ));
    if (!eleccion) return;

    const accion = await hoja('▦  ' + eleccion.nombre, (cerrar) => h('div.lista-acciones',
      h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('renombrar') }, '✎  Renombrar'),
      h('button.lista-acciones__item', { type: 'button', onclick: () => cerrar('eliminar') }, '🗑  Eliminar')
    ));

    if (accion === 'eliminar') {
      const ok = await confirmar('Se elimina la plantilla "' + eleccion.nombre + '" del menu de tablas. Las tablas ya capturadas no cambian. ¿Eliminar?',
        { textoOk: 'Eliminar', peligro: true });
      if (ok) {
        await db.tablaPredeterminadaEliminar(eleccion.clave);
        aviso('Plantilla eliminada', 'ok');
      }
    }

    if (accion === 'renombrar') {
      await hoja('✎  Renombrar tabla', (cerrar) => {
        const cNombre = campo('Nombre', { value: eleccion.nombre });
        return h('div',
          cNombre,
          h('div.hoja__acciones',
            h('button.btn.btn--primario', {
              type: 'button',
              onclick: async () => {
                const v = cNombre.querySelector('input').value.trim();
                if (!v) { aviso('Ponle un nombre', 'error'); return; }
                const r = await db.tablaPredeterminadaRenombrar(eleccion.clave, v);
                if (r && r.choque) { aviso('Ya hay una tabla con ese nombre', 'error'); return; }
                aviso('Tabla renombrada', 'ok');
                cerrar(true);
              }
            }, 'Guardar'))
        );
      });
    }
  }
}

// Micro-pruebas del pipeline de foto EN ESTE telefono: mide cada forma de
// comprimir un lienzo 1600x1200 y la version del motor. Para cazar WebViews
// con rutas rotas sin adivinar desde fuera.
async function hojaDiagnostico() {
  await hoja('🩺  Diagnostico de foto', (cerrar) => {
    const salida = h('pre.diag', 'Corriendo pruebas (unos segundos)...');

    (async () => {
      const L = [];
      const linea = (s) => { L.push(s); salida.textContent = L.join('\n'); };
      linea('Motor: ' + ((navigator.userAgent.match(/Chrome\/[\d.]+/) || ['?'])[0]));
      linea('Nativa: ' + (esNativa() ? 'si (APK)' : 'no (navegador)'));

      const cv = document.createElement('canvas');
      cv.width = 1600; cv.height = 1200;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const g = ctx.createLinearGradient(0, 0, 1600, 1200);
      g.addColorStop(0, '#f60'); g.addColorStop(1, '#06f');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1600, 1200);
      ctx.fillStyle = '#fff'; ctx.font = '90px sans-serif'; ctx.fillText('PRUEBA', 500, 620);

      const t = async (nombre, fn) => {
        const a = performance.now();
        try {
          await fn();
          linea(nombre + ': ' + Math.round(performance.now() - a) + ' ms');
        } catch (e) {
          linea(nombre + ': ERROR ' + (e && e.message ? e.message : e));
        }
      };
      const tb = (tipo, q) => new Promise((res, rej) => {
        try { cv.toBlob(b => b ? res(b) : rej(new Error('blob nulo')), tipo, q); }
        catch (e) { rej(e); }
      });
      const ctb = async () => {
        const oc = new OffscreenCanvas(1600, 1200);
        oc.getContext('2d').drawImage(cv, 0, 0);
        return oc.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
      };

      await t('toBlob JPEG (1a)', () => tb('image/jpeg', 0.82));
      await t('toBlob JPEG (2a)', () => tb('image/jpeg', 0.82));
      await t('toBlob WEBP', () => tb('image/webp', 0.82));
      await t('toBlob PNG', () => tb('image/png'));
      await t('toDataURL JPEG', async () => cv.toDataURL('image/jpeg', 0.82));
      await t('convertToBlob (1a)', ctb);
      await t('convertToBlob (2a)', ctb);
      await t('latencia del sistema', () => new Promise(r => setTimeout(r, 0)));
      linea('');
      linea('LISTO — mandame una captura de esta pantalla.');
    })();

    return h('div',
      salida,
      h('div.hoja__acciones',
        h('button.btn.btn--primario', { type: 'button', onclick: () => cerrar(true) }, 'Cerrar'))
    );
  }, { altura: 'alta' });
}

// Cada telefono tiene su tecnico: es quien firma los reportes nuevos.
async function hojaTecnico() {
  const actual = await db.ajusteLeer('usuario', 'Usuario');
  await hoja('👤  Nombre del tecnico', (cerrar) => {
    const cNombre = campo('Nombre completo', { value: actual });
    return h('div',
      cNombre,
      h('p.pista', 'Aparece como Tecnico en los reportes que generes en este telefono. Los servicios ya creados conservan el suyo.'),
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button.btn.btn--primario', {
          type: 'button',
          onclick: async () => {
            const nombre = cNombre.entrada.value.trim();
            if (!nombre) { aviso('Escribe el nombre', 'error'); return; }
            await db.ajusteGuardar('usuario', nombre);
            aviso('Nombre guardado', 'ok');
            cerrar(true);
          }
        }, 'Guardar')
      )
    );
  });
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
  // En el APK los datos viven en el almacen privado de la app: Android no
  // los purga por espacio y el permiso de persistencia ni aplica. En vez
  // del banner, la primera vez se orienta la migracion desde Chrome.
  if (esNativa()) {
    const trabajos = await db.serviciosTodos();
    if (trabajos.length) return null;
    return h('div.banner',
      h('div',
        h('strong', '¿Vienes de la version de Chrome?'),
        h('p', 'Tus trabajos no se copian solos: en la app de Chrome entra a ⛁ y toca Respaldar; luego aqui entra a ⛁ y toca Restaurar con ese ZIP.')
      )
    );
  }

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

/* Aviso de cascaron (APK) nuevo. Compara la version instalada contra
   apk/version.json publicado junto a la web. Desde el APK 1.9 el boton
   descarga, verifica la huella SHA-256 y abre el instalador de Android;
   en cascarones anteriores solo avisa (el 1.9 se instala a mano una vez). */

let apkPospuesto = 0;   // "Despues" oculta el aviso hasta reabrir la app

export async function bannerActualizacion() {
  if (!esNativa()) return null;
  let v, build;
  try {
    const res = await fetch('apk/version.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    v = await res.json();
    build = parseInt((await window.Capacitor.Plugins.App.getInfo()).build, 10);
  } catch (e) { return null; }   // sin señal o sin datos: silencio
  if (!v || !v.versionCode || !(build < v.versionCode) || apkPospuesto === v.versionCode) return null;

  const conBoton = build >= 10;   // el instalador integrado nacio en el 1.9
  const banner = h('div.banner.banner--aviso',
    h('div',
      h('strong', 'Nueva version del APK: ' + (v.versionName || v.versionCode)),
      h('p', conBoton
        ? 'Toca Actualizar: se descarga y Android te pide confirmar. Tus datos se conservan.'
        : 'Pidele el archivo a Vale e instalalo encima. Tus datos se conservan.')
    ),
    conBoton ? h('button.btn.btn--pequeno', {
      type: 'button', onclick: () => actualizarCascaron(v)
    }, 'Actualizar') : null,
    h('button.btn.btn--pequeno.btn--fantasma', {
      type: 'button', onclick: () => { apkPospuesto = v.versionCode; banner.remove(); }
    }, 'Despues')
  );
  return banner;
}

async function actualizarCascaron(v) {
  const Puente = window.Capacitor.Plugins.Puente;
  try {
    const p = await Puente.puedeInstalar();
    if (!p || !p.ok) {
      const ir = await confirmar(
        'Android va a pedir permitir que Ser Pro App instale sus actualizaciones. Es un permiso SOLO para esta app. Activalo en el ajuste que se abre, regresa y vuelve a tocar Actualizar.',
        { textoOk: 'Abrir ajuste', peligro: false });
      if (ir) await Puente.pedirPermisoInstalar();
      return;
    }
  } catch (e) { console.error(e); }

  ocupado('Descargando la actualizacion...');
  try {
    const r = await fetch(v.archivo || 'apk/SerProApp.apk', { cache: 'no-cache' });
    if (!r.ok) throw new Error('descarga fallo (' + r.status + ')');
    const blob = await r.blob();
    if (v.sha256) {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
        .map(b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== v.sha256) throw new Error('el archivo descargado no coincide con la huella publicada');
    }
    await instalarActualizacionApk(blob);
    libre();
  } catch (e) {
    libre();
    console.error(e);
    aviso('No se pudo actualizar: ' + (e && e.message ? e.message : e), 'error');
  }
}

/* ---------------------------------------------------------------- */
/* Alta: primero el tipo, luego los datos                            */
/* ---------------------------------------------------------------- */

const PISTA_TIPO = {
  servicio:      'Mantenimiento o reparacion en sitio',
  auditoria:     'Revision y evaluacion del estado de la maquina',
  geometrica:    'Medicion y ajuste de la geometria de la maquina',
  laboratorio:   'Pruebas y mediciones en banco',
  general:       'Cualquier otro registro',
  procedimiento: 'Guia paso a paso — genera PowerPoint',
};

// Tipos que llevan datos de maquina: se crean con el asistente completo y
// se editan con el menu de campos (los demas solo llevan titulo).
const conMaquina = (tipo) => tipo === 'servicio' || tipo === 'auditoria' || tipo === 'geometrica';

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

  const datos = conMaquina(tipo)
    ? await asistenteServicio()
    : await formularioTrabajo(null, tipo);
  if (!datos) return;

  if (conMaquina(tipo) && !datos.cliente && !datos.planta) {
    aviso('Pon al menos cliente o planta', 'error');
    return;
  }
  if (!conMaquina(tipo) && !datos.titulo) {
    aviso('Ponle un titulo', 'error');
    return;
  }

  const usuario = await db.ajusteLeer('usuario', 'Usuario');
  const trabajo = await db.servicioNuevo(Object.assign({ tipo, tecnico: usuario }, datos));
  if (conMaquina(tipo)) db.maquinaRecordar(trabajo);   // alimenta las sugerencias
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
  if (conMaquina(trabajo.tipo || 'servicio')) return editarServicioMenu(trabajo);
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

// Exportada: el boton ⛁ vive en la PORTADA (menu de inicio).
export async function hojaAlmacenamiento(refrescar) {
  const i = await db.estadoAlmacenamiento();

  await hoja('Almacenamiento y respaldo', (cerrar) => {
    const estado = h('p.pista', '');

    const entregar = async (modo) => {
      estado.textContent = 'Preparando respaldo...';
      try {
        const { crearRespaldo } = await import('../respaldo.js');
        const r = await crearRespaldo();

        // Copia privada del ultimo respaldo (solo APK): alimenta el boton
        // "Restaurar > Ultimo respaldo". No es fatal si falla, pero se avisa
        // en el estado para poder diagnosticarlo desde el telefono.
        let notaCopia = '';
        if (esNativa()) {
          try {
            const copia = await guardarUltimoRespaldo(r.blob);
            await db.ajusteGuardar('ultimoRespaldo',
              { fecha: Date.now(), nombre: r.nombreArchivo, tam: r.blob.size, partes: copia.partes });
            notaCopia = ' · Copia lista para Restaurar.';
          } catch (e2) {
            console.error('copia del ultimo respaldo', e2);
            notaCopia = ' · Sin copia para Restaurar: ' + (e2 && e2.message ? e2.message : e2);
          }
        }

        // En el APK: "Respaldar" guarda DIRECTO en la carpeta de la app
        // (Documentos/ReportesServicio/Respaldos) y "Compartir" abre el menu
        // nativo. El ancla de descarga web no funciona en el WebView.
        if (esNativa()) {
          if (modo === 'compartir') {
            await guardarEnCarpetaNativa(r.blob, 'Respaldos/' + r.nombreArchivo);
            estado.textContent = 'Guardado en Documentos/ReportesServicio/Respaldos/' + r.nombreArchivo +
              ' · ' + r.resumen.trabajos + ' trabajos, ' + r.resumen.fotos + ' fotos.' + notaCopia;
            aviso('Respaldo guardado en la carpeta de la app', 'ok');
            return;
          }
          await compartirArchivoNativo(r.blob, r.nombreArchivo, r.nombreArchivo);
        } else {
          const archivo = new File([r.blob], r.nombreArchivo, { type: 'application/zip' });
          if (modo === 'compartir' && navigator.canShare && navigator.canShare({ files: [archivo] })) {
            await navigator.share({ files: [archivo], title: r.nombreArchivo });
          } else {
            const url = URL.createObjectURL(r.blob);
            const a = h('a', { href: url, download: r.nombreArchivo });
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 90000);
          }
        }
        estado.textContent = 'Respaldo listo: ' + r.resumen.trabajos + ' trabajos, ' +
          r.resumen.registros + ' registros, ' + r.resumen.fotos + ' fotos.' + notaCopia;
        aviso('Respaldo generado', 'ok');
      } catch (e) {
        if (e && (e.name === 'AbortError' || /cancel/i.test((e.message || '') + e))) { estado.textContent = ''; return; }
        console.error(e);
        estado.textContent = 'Fallo: ' + (e && e.message ? e.message : e);
        aviso('No se pudo respaldar', 'error');
      }
    };

    const ejecutarRestauracion = async (archivo, nombre) => {
      const ok = await confirmar(
        'Se restaurara "' + nombre + '". Lo del respaldo se MEZCLA con lo que ya hay (mismos trabajos se sobreescriben, nada se borra). ¿Continuar?',
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
    };

    const buscarArchivo = () => {
      const input = h('input', { type: 'file', accept: '.zip,application/zip', style: { display: 'none' } });
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const archivo = input.files && input.files[0];
        input.remove();
        if (!archivo) return;
        ejecutarRestauracion(archivo, archivo.name);
      });
      input.click();
    };

    const restaurar = async () => {
      // En el APK el menu sale SIEMPRE: con copia ofrece restaurarla en un
      // toque; sin copia explica como tenerla. En navegador, buscador directo.
      if (!esNativa()) return buscarArchivo();
      const ult = await db.ajusteLeer('ultimoRespaldo');

      const cuando = ult ? new Date(ult.fecha).toLocaleString('es-MX',
        { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const eleccion = await hoja('Restaurar respaldo', (cerrarMenu) => h('div',
        h('div.lista-acciones',
          ult
            ? h('button.lista-acciones__item', { type: 'button', onclick: () => cerrarMenu('ultimo') },
              '⏪  Ultimo respaldo (' + cuando + ' · ' + media.formatoBytes(ult.tam || 0) + ')')
            : h('button.lista-acciones__item', { type: 'button', disabled: true, style: { opacity: '.55' } },
              '⏪  Ultimo respaldo — aun no hay ninguno'),
          h('button.lista-acciones__item', { type: 'button', onclick: () => cerrarMenu('buscar') },
            '📁  Buscar archivo del respaldo')
        ),
        h('p.pista', ult
          ? 'El ultimo respaldo es el mas reciente que hiciste aqui con Respaldar o Compartir.'
          : 'Cuando hagas un respaldo (💾 Respaldar a la carpeta o Compartir), quedara aqui listo para restaurarse en un toque.')
      ));
      if (eleccion === 'buscar') return buscarArchivo();
      if (eleccion !== 'ultimo' || !ult) return;
      try {
        const blob = await leerUltimoRespaldo(ult);
        await ejecutarRestauracion(blob, ult.nombre || 'ultimo respaldo');
      } catch (e) {
        console.error(e);
        aviso('No se encontro la copia del ultimo respaldo; busca el archivo', 'error');
        buscarArchivo();
      }
    };

    return h('div',
      h('p.parrafo', 'Usado: ' + media.formatoBytes(i.usado) +
        (i.cuota ? ' de ' + media.formatoBytes(i.cuota) + ' disponibles' : '')),
      // En el APK los datos viven en el almacen privado de la app: siempre
      // protegidos, y el permiso de Chrome ni existe.
      h('p.parrafo', esNativa()
        ? '✓ Los datos estan protegidos en el almacen de la app.'
        : (i.persistente
          ? '✓ Los datos estan protegidos contra borrado automatico.'
          : '⚠ Los datos NO estan protegidos. Instala la app desde el menu de Chrome y toca "Proteger".')),
      h('p.pista', 'Todo se guarda unicamente en este telefono. El respaldo es un ZIP con todos tus trabajos y fotos: guardalo en OneDrive de vez en cuando, y con el puedes migrar a otro telefono.'),
      h('div.hoja__acciones',
        h('button.btn.btn--fantasma', { type: 'button', onclick: restaurar }, 'Restaurar'),
        h('button.btn.btn--fantasma', { type: 'button', onclick: () => entregar('descargar') },
          esNativa() ? 'Compartir' : 'Descargar'),
        h('button.btn.btn--primario', { type: 'button', onclick: () => entregar('compartir') },
          esNativa() ? '💾 Respaldar a la carpeta' : 'Respaldar')
      ),
      estado,
      lineaVersion()
    );
  });
}

export async function render(contenedor, refrescar) {
  media.liberarUrls();
  const trabajos = await db.serviciosTodos();

  const logoCab = h('img.cabecera__logo', { src: 'icons/icono-192.png', alt: 'Grupo Ser Pro' });
  const tituloCab = h('h1.marca', 'SER PRO APP');
  logoCab.onclick = tituloCab.onclick = () => animarMarca(logoCab, tituloCab);

  const cabecera = h('header.cabecera',
    h('div.cabecera__fila',
      logoCab,
      tituloCab,
      // Etiqueta para distinguir la version de navegador del APK: ambos
      // comparten icono y nombre, y confundirlos divide los datos.
      esNativa() ? null : h('span.tag-web', 'WEB'),
      // Los botones van pegados a la derecha, lejos del titulo.
      h('span.crece'),
      h('button.icono-btn', {
        type: 'button', 'aria-label': 'Cambiar tema',
        onclick: (ev) => {
          const nuevo = alternarTema();
          ev.currentTarget.textContent = nuevo === 'claro' ? '🌙' : '☀️';
        }
      }, temaActual() === 'claro' ? '🌙' : '☀️'),
      h('button.icono-btn', {
        type: 'button', 'aria-label': 'Configuracion',
        onclick: () => abrirConfiguracion()
      }, '⚙')
    )
  );

  const lista = h('div.lista-servicios');
  const banner = await bannerAlmacenamiento();
  if (banner) lista.append(banner);
  // El aviso de APK nuevo consulta la red: se agrega cuando responda,
  // sin frenar el pintado de la lista.
  bannerActualizacion().then(b => { if (b) lista.prepend(b); }).catch(() => {});

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
