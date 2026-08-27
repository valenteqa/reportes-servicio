// Capa de datos: IndexedDB.
// Todo vive en el telefono. Nada se sube a ningun servidor.

const DB_NOMBRE  = 'app-reportes';
const DB_VERSION = 1;

export const GENERAL = '__general__';

// No todo lo que se registra es un servicio. El tipo se elige al crear y define
// como se rotula en las listas y en el reporte.
export const TIPOS = {
  servicio:    { nombre: 'Servicio',              icono: '🔧' },
  laboratorio: { nombre: 'Pruebas de laboratorio', icono: '🧪' },
  general:     { nombre: 'General',                icono: '📋' },
};

export function tipoDe(trabajo) {
  return TIPOS[trabajo && trabajo.tipo] || TIPOS.servicio;
}

let _db = null;

export function nuevoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

// Los indices ordenan por [clave, ts]. Si dos eventos caen en el mismo
// milisegundo -- pasa al importar varias fotos de golpe -- IndexedDB desempata
// por el id, que es aleatorio, y la linea de tiempo sale desordenada.
// Esta marca nunca se repite: como mucho corre unos milisegundos por delante,
// algo que no se nota en pantalla y mantiene el orden real de captura.
let _ultimoTs = 0;

export function marcaDeTiempo() {
  const ahora = Date.now();
  _ultimoTs = ahora > _ultimoTs ? ahora : _ultimoTs + 1;
  return _ultimoTs;
}

export function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains('servicios')) {
        const s = db.createObjectStore('servicios', { keyPath: 'id' });
        s.createIndex('creado', 'creado');
        s.createIndex('estado', 'estado');
      }

      if (!db.objectStoreNames.contains('equipos')) {
        const e = db.createObjectStore('equipos', { keyPath: 'id' });
        e.createIndex('servicioId', 'servicioId');
      }

      if (!db.objectStoreNames.contains('eventos')) {
        const v = db.createObjectStore('eventos', { keyPath: 'id' });
        v.createIndex('servicioId', 'servicioId');
        v.createIndex('porServicioTs', ['servicioId', 'ts']);
        v.createIndex('porEquipoTs', ['equipoId', 'ts']);
      }

      if (!db.objectStoreNames.contains('fotos')) {
        db.createObjectStore('fotos', { keyPath: 'id' });
      }

      // Nombres de equipo ya usados, para autocompletar mas adelante.
      if (!db.objectStoreNames.contains('catalogo')) {
        const c = db.createObjectStore('catalogo', { keyPath: 'clave' });
        c.createIndex('tipo', 'tipo');
      }

      if (!db.objectStoreNames.contains('ajustes')) {
        db.createObjectStore('ajustes', { keyPath: 'clave' });
      }
    };

    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(stores, modo, fn) {
  return abrir().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(stores, modo);
    let resultado;
    t.oncomplete = () => resolve(resultado);
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error || new Error('Transaccion abortada'));

    const obj = {};
    for (const s of [].concat(stores)) obj[s] = t.objectStore(s);

    Promise.resolve(fn(obj, t)).then(
      r => { resultado = r; },
      err => { reject(err); try { t.abort(); } catch (e) {} }
    );
  }));
}

function pedir(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function porIndice(store, indice, rango) {
  return pedir(store.index(indice).getAll(rango));
}

/* ---------------------------------------------------------------- */
/* Servicios                                                         */
/* ---------------------------------------------------------------- */

export function servicioNuevo(datos) {
  datos = datos || {};
  const ahora = Date.now();
  const servicio = {
    id: nuevoId(),
    tipo:        datos.tipo        || 'servicio',
    titulo:      datos.titulo      || '',   // pruebas de laboratorio y general solo llevan titulo
    cliente:     datos.cliente     || '',
    planta:      datos.planta      || '',
    marca:       datos.marca       || '',   // "Tipo de Maquina" en el reporte (HUSKY)
    modelo:      datos.modelo      || '',
    noMaquina:   datos.noMaquina   || '',   // linea de produccion o numero de maquina (opcional)
    serie:       datos.serie       || '',
    tecnico:     datos.tecnico     || '',
    descripcion: datos.descripcion || '',   // descripcion de la falla
    estado: 'abierto',
    inicio: ahora,
    fin: null,
    creado: ahora,
    actualizado: ahora,
  };
  return tx('servicios', 'readwrite', st => pedir(st.servicios.add(servicio)))
    .then(() => servicio);
}

export function servicioLeer(id) {
  return tx('servicios', 'readonly', st => pedir(st.servicios.get(id)));
}

export function serviciosTodos() {
  return tx('servicios', 'readonly', st => pedir(st.servicios.getAll()))
    .then(lista => lista.sort((a, b) => b.creado - a.creado));
}

export function servicioGuardar(servicio) {
  servicio.actualizado = Date.now();
  return tx('servicios', 'readwrite', st => pedir(st.servicios.put(servicio)))
    .then(() => servicio);
}

export function servicioBorrar(id) {
  return tx(['servicios', 'equipos', 'eventos', 'fotos'], 'readwrite', async (st) => {
    const eventos = await porIndice(st.eventos, 'servicioId', IDBKeyRange.only(id));
    for (const ev of eventos) {
      if (ev.tipo === 'foto' && ev.datos && ev.datos.fotoId) st.fotos.delete(ev.datos.fotoId);
      st.eventos.delete(ev.id);
    }
    const equipos = await porIndice(st.equipos, 'servicioId', IDBKeyRange.only(id));
    for (const eq of equipos) st.equipos.delete(eq.id);
    st.servicios.delete(id);
  });
}

/* ---------------------------------------------------------------- */
/* Equipos                                                           */
/* ---------------------------------------------------------------- */

export function equipoNuevo(servicioId, datos) {
  datos = datos || {};
  return tx(['equipos', 'catalogo'], 'readwrite', async (st) => {
    const existentes = await porIndice(st.equipos, 'servicioId', IDBKeyRange.only(servicioId));
    const equipo = {
      id: nuevoId(),
      servicioId,
      nombre:      (datos.nombre || 'Equipo sin nombre').trim(),
      tag:         datos.tag || '',
      descripcion: datos.descripcion || '',
      orden:       existentes.length,
      creado:      Date.now(),
    };
    await pedir(st.equipos.add(equipo));

    const clave = 'equipo:' + equipo.nombre.toLowerCase();
    const previo = await pedir(st.catalogo.get(clave));
    await pedir(st.catalogo.put({
      clave,
      tipo: 'equipo',
      valor: equipo.nombre,
      usos: (previo ? previo.usos : 0) + 1,
      ultimoUso: Date.now(),
    }));
    return equipo;
  });
}

export function equiposDeServicio(servicioId) {
  return tx('equipos', 'readonly',
    st => porIndice(st.equipos, 'servicioId', IDBKeyRange.only(servicioId)))
    .then(lista => lista.sort((a, b) => a.orden - b.orden));
}

export function equipoLeer(id) {
  return tx('equipos', 'readonly', st => pedir(st.equipos.get(id)));
}

export function equipoGuardar(equipo) {
  return tx('equipos', 'readwrite', st => pedir(st.equipos.put(equipo))).then(() => equipo);
}

export function equipoBorrar(id) {
  return tx(['equipos', 'eventos', 'fotos'], 'readwrite', async (st) => {
    const eventos = await porIndice(st.eventos, 'porEquipoTs',
      IDBKeyRange.bound([id, 0], [id, Infinity]));
    for (const ev of eventos) {
      if (ev.tipo === 'foto' && ev.datos && ev.datos.fotoId) st.fotos.delete(ev.datos.fotoId);
      st.eventos.delete(ev.id);
    }
    st.equipos.delete(id);
  });
}

export function catalogoEquipos() {
  return tx('catalogo', 'readonly',
    st => porIndice(st.catalogo, 'tipo', IDBKeyRange.only('equipo')))
    .then(lista => lista.sort((a, b) => b.usos - a.usos || b.ultimoUso - a.ultimoUso));
}

/* ---------------------------------------------------------------- */
/* Eventos: nota | tabla | foto                                      */
/* ---------------------------------------------------------------- */

export function eventoNuevo(servicioId, equipoId, tipo, datos) {
  const evento = {
    id: nuevoId(),
    servicioId,
    equipoId: equipoId || GENERAL,
    tipo,
    ts: marcaDeTiempo(),
    incluir: true,           // se respeta al armar el reporte
    datos: datos || {},
  };
  return tx('eventos', 'readwrite', st => pedir(st.eventos.add(evento))).then(() => evento);
}

export function eventoLeer(id) {
  return tx('eventos', 'readonly', st => pedir(st.eventos.get(id)));
}

export function eventoGuardar(evento) {
  return tx('eventos', 'readwrite', st => pedir(st.eventos.put(evento))).then(() => evento);
}

export function eventoBorrar(id) {
  return tx(['eventos', 'fotos'], 'readwrite', async (st) => {
    const ev = await pedir(st.eventos.get(id));
    if (ev && ev.tipo === 'foto' && ev.datos && ev.datos.fotoId) st.fotos.delete(ev.datos.fotoId);
    st.eventos.delete(id);
  });
}

export function eventosDeEquipo(equipoId) {
  return tx('eventos', 'readonly', st => porIndice(st.eventos, 'porEquipoTs',
    IDBKeyRange.bound([equipoId, 0], [equipoId, Infinity])));
}

export function eventosDeServicio(servicioId) {
  return tx('eventos', 'readonly', st => porIndice(st.eventos, 'porServicioTs',
    IDBKeyRange.bound([servicioId, 0], [servicioId, Infinity])));
}

export function resumenPorEquipo(servicioId) {
  return eventosDeServicio(servicioId).then(eventos => {
    const mapa = {};
    for (const ev of eventos) {
      const k = ev.equipoId;
      if (!mapa[k]) mapa[k] = { total: 0, nota: 0, tabla: 0, foto: 0, ultimo: 0 };
      mapa[k].total++;
      mapa[k][ev.tipo] = (mapa[k][ev.tipo] || 0) + 1;
      if (ev.ts > mapa[k].ultimo) mapa[k].ultimo = ev.ts;
    }
    return mapa;
  });
}

/* ---------------------------------------------------------------- */
/* Fotos (blobs)                                                     */
/* ---------------------------------------------------------------- */

export function fotoGuardar(registro) {
  return tx('fotos', 'readwrite', st => pedir(st.fotos.put(registro))).then(() => registro);
}

export function fotoLeer(id) {
  return tx('fotos', 'readonly', st => pedir(st.fotos.get(id)));
}

/* ---------------------------------------------------------------- */
/* Ajustes                                                           */
/* ---------------------------------------------------------------- */

export function ajusteLeer(clave, porDefecto) {
  return tx('ajustes', 'readonly', st => pedir(st.ajustes.get(clave)))
    .then(r => (r ? r.valor : (porDefecto === undefined ? null : porDefecto)));
}

export function ajusteGuardar(clave, valor) {
  return tx('ajustes', 'readwrite', st => pedir(st.ajustes.put({ clave, valor })));
}

/* ---------------------------------------------------------------- */
/* Respaldo: acceso a stores completos                               */
/* ---------------------------------------------------------------- */

const STORES_RESPALDO = ['servicios', 'equipos', 'eventos', 'catalogo', 'ajustes'];

export function todosDe(nombre) {
  return tx(nombre, 'readonly', st => pedir(st[nombre].getAll()));
}

export function volcadoCompleto() {
  return Promise.all(STORES_RESPALDO.map(s => todosDe(s)))
    .then(([servicios, equipos, eventos, catalogo, ajustes]) =>
      ({ servicios, equipos, eventos, catalogo, ajustes }));
}

export function restaurarVolcado(volcado, fotos) {
  return tx(['servicios', 'equipos', 'eventos', 'catalogo', 'ajustes', 'fotos'], 'readwrite', (st) => {
    let n = 0;
    for (const s of STORES_RESPALDO) {
      for (const registro of (volcado[s] || [])) { st[s].put(registro); n++; }
    }
    for (const f of (fotos || [])) { st.fotos.put(f); n++; }
    return n;
  });
}

/* ---------------------------------------------------------------- */
/* Almacenamiento                                                    */
/* ---------------------------------------------------------------- */

export async function estadoAlmacenamiento() {
  const info = { persistente: false, usado: 0, cuota: 0, soportado: false };
  try {
    if (navigator.storage && navigator.storage.persisted) {
      info.soportado = true;
      info.persistente = await navigator.storage.persisted();
    }
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      info.usado = est.usage || 0;
      info.cuota = est.quota || 0;
    }
  } catch (e) { /* navegador sin soporte */ }
  return info;
}

export async function pedirPersistencia() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) {}
  return false;
}
