// NUBE de la app = un Excel INTERMEDIARIO en OneDrive (decision de Vale,
// 31 ago 2026): NO hay base de datos ni servidor. Un solo archivo
// compartido con el equipo (SERPRO_APP_DATOS.xlsx) donde cada telefono
// escribe lo suyo y lee lo de los demas; los Excel del JEFE quedan
// privados y se alimentan de este (Power Query o copia).
//
// Como funciona:
//   - Cada telefono entra con SU cuenta Microsoft (gratuita) via OAuth con
//     PKCE (sin secreto, sin backend); Vale comparte la carpeta con todos.
//   - Sincronizar = bajar el archivo, MEZCLAR por id (gana la copia con
//     `actualizado` mas nuevo), regenerar el libro completo y subirlo con
//     If-Match (ETag): si otro telefono lo movio entre tanto, se reintenta.
//   - Las hojas visibles (Objetivos, Estatus, Actividades, Anotaciones,
//     Contactos, Equipo) son para el jefe y sus Power Query; las ocultas
//     (_datos, _app) llevan el JSON integro de cada registro: de ahi lee
//     la app, sin perder nada por el camino.
//   - Nunca se sube desde TEST MODE ni datos de ensayo; nunca se borra:
//     lo que no esta en el telefono se baja, lo mas nuevo se sube.
//
// Registro en Microsoft (lo hace Vale una sola vez, gratis): app de tipo
// "Aplicacion de una sola pagina" (SPA) con la URL de retorno de la app
// (urlDeRetorno()) y permisos delegados Files.ReadWrite.All + User.Read +
// offline_access; el ID de aplicacion (client id) se pega en ⚙ → Nube.
// Los tokens de una SPA se renuevan solos ~24 h; despues se intenta una
// renovacion SILENCIOSA (rebote a Microsoft y de vuelta, sin preguntar)
// y si tampoco, la portada pide volver a conectar.

import * as db from './db.js';
import { APP_VERSION } from './version.js';
import { crearLibro, leerLibro, MIME_XLSX } from './excel.js';
import { organizacion, quienSoyReal, testActivo } from './organizacion.js';
import {
  estatusResueltos, estatusPendiente, calificacion, nombreEntidad, prioridadValida,
} from './vistas/ventas.js';

export const NOMBRE_ARCHIVO = 'SERPRO_APP_DATOS.xlsx';
const FORMATO = 'serpro-app-datos';
const VERSION_FORMATO = 1;
const AUTORIDAD = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'openid profile offline_access User.Read Files.ReadWrite.All';
const TROZO_JSON = 30000;                 // caracteres por celda (limite 32767)
const SILENCIO_CADA = 6 * 3600 * 1000;    // entre intentos de renovacion silenciosa
const MIN_ESTATUS = 4;                    // columnas de estatus como el Excel del jefe

/* ---------------------------------------------------------------- */
/* Configuracion y estado (almacen 'ajustes': nunca es sandbox)      */
/* ---------------------------------------------------------------- */

export async function configNube() {
  const c = await db.ajusteLeer('nube:config');
  return Object.assign({ clientId: '', enlace: '', archivo: NOMBRE_ARCHIVO, auto: true }, c || {});
}

export function configNubeGuardar(cfg) {
  return db.ajusteGuardar('nube:config', cfg);
}

export async function configurada() {
  const c = await configNube();
  return !!(c.clientId && c.enlace);
}

export async function estadoNube() {
  return (await db.ajusteLeer('nube:estado')) || {};
}

async function estadoGuardar(parcial) {
  const e = await estadoNube();
  Object.assign(e, parcial);
  await db.ajusteGuardar('nube:estado', e);
  return e;
}

function tokenLeer() { return db.ajusteLeer('nube:token'); }

// { nombre, correo } de la cuenta Microsoft de este telefono, o null.
export async function cuentaConectada() {
  const t = await tokenLeer();
  return t && t.cuenta && (t.cuenta.nombre || t.cuenta.correo) ? t.cuenta : null;
}

async function dispositivoId() {
  let id = await db.ajusteLeer('nube:dispositivo');
  if (!id) { id = db.nuevoId(); await db.ajusteGuardar('nube:dispositivo', id); }
  return id;
}

let _sincronizando = false;
export function estaSincronizando() { return _sincronizando; }

/* ---------------------------------------------------------------- */
/* OAuth 2 con PKCE (sin secreto)                                    */
/* ---------------------------------------------------------------- */

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function aleatorio(n) { return base64url(crypto.getRandomValues(new Uint8Array(n))); }

async function sha256url(texto) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))));
}

// La URL exacta de la app sin ruta interna: es la que se registra en
// Microsoft como "URI de redireccion" (una por sitio: GitHub Pages, local…).
export function urlDeRetorno() {
  return location.origin + location.pathname;
}

async function pedirToken(params) {
  const r = await fetch(AUTORIDAD + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const e = new Error(j.error_description || j.error || ('HTTP ' + r.status));
    e.codigo = j.error || '';
    throw e;
  }
  return j;
}

async function guardarToken(tok, cuenta) {
  const previo = (await tokenLeer()) || {};
  await db.ajusteGuardar('nube:token', {
    access: tok.access_token,
    refresh: tok.refresh_token || previo.refresh || '',
    expira: Date.now() + ((tok.expires_in || 3600) - 90) * 1000,
    cuenta: cuenta || previo.cuenta || {},
    desde: previo.desde || Date.now(),
  });
}

/**
 * Lleva al usuario a Microsoft a autorizar la app (o, silencioso=true, a
 * renovar la sesion sin preguntar). Regresa a la app con ?code=…; ahi
 * terminarConexion() cambia el codigo por tokens.
 */
export async function conectar({ silencioso = false } = {}) {
  const cfg = await configNube();
  if (!cfg.clientId) throw new Error('Falta el ID de aplicacion (client id) en la configuracion de la nube.');
  const verificador = aleatorio(48);
  const estado = aleatorio(16);
  sessionStorage.setItem('nube:pkce', JSON.stringify({ verificador, estado, volver: location.hash || '#/', silencioso }));
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: urlDeRetorno(),
    response_mode: 'query',
    scope: SCOPES,
    state: estado,
    code_challenge: await sha256url(verificador),
    code_challenge_method: 'S256',
    prompt: silencioso ? 'none' : 'select_account',
  });
  const cuenta = await cuentaConectada();
  if (silencioso && cuenta && cuenta.correo) p.set('login_hint', cuenta.correo);
  if (silencioso) await estadoGuardar({ silencioIntento: Date.now() });
  location.assign(AUTORIDAD + '/authorize?' + p.toString());
}

// Al arrancar, ANTES de rutear: si venimos de Microsoft (?code= o
// ?error=), cerrar la conexion y limpiar la URL (volviendo a la ruta
// donde estaba el usuario). Devuelve true si habia algo que atender.
export async function terminarConexion() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;
  const crudo = sessionStorage.getItem('nube:pkce');
  sessionStorage.removeItem('nube:pkce');
  let pk = null;
  try { pk = crudo ? JSON.parse(crudo) : null; } catch (e) { pk = null; }

  const limpiar = () => {
    const volver = (pk && pk.volver) || '#/';
    history.replaceState(null, '', location.pathname + '#/');
    if (volver !== '#/') history.pushState(null, '', location.pathname + volver);
  };

  if (!pk || q.get('state') !== pk.estado) {
    limpiar();
    await estadoGuardar({ error: 'La respuesta de Microsoft no corresponde a esta app; intenta conectar de nuevo.' });
    return true;
  }
  if (q.has('error')) {
    const desc = q.get('error_description') || q.get('error');
    await estadoGuardar(pk.silencioso
      ? { error: 'reconectar', silencioFallo: Date.now() }
      : { error: 'Microsoft no autorizo la conexion: ' + desc });
    limpiar();
    return true;
  }
  try {
    const cfg = await configNube();
    const tok = await pedirToken({
      grant_type: 'authorization_code',
      code: q.get('code'),
      redirect_uri: urlDeRetorno(),
      code_verifier: pk.verificador,
      client_id: cfg.clientId,
      scope: SCOPES,
    });
    let cuenta = null;
    try {
      const yo = await graph(tok.access_token, '/me?$select=displayName,mail,userPrincipalName');
      cuenta = { nombre: yo.displayName || '', correo: yo.mail || yo.userPrincipalName || '' };
    } catch (e) { /* sin nombre: no es fatal */ }
    await guardarToken(tok, cuenta);
    await estadoGuardar({ error: '', silencioFallo: 0 });
    limpiar();
    setTimeout(() => sincronizar({ motivo: 'conexion' }).catch(() => {}), 1500);
  } catch (e) {
    await estadoGuardar({ error: 'No se pudo completar la conexion: ' + e.message });
    limpiar();
  }
  return true;
}

export async function desconectar() {
  await db.ajusteGuardar('nube:token', null);
  await estadoGuardar({ error: '', silencioFallo: 0 });
}

function pareceSesionCaduca(e) {
  return e.codigo === 'invalid_grant' || e.codigo === 'interaction_required' || e.codigo === 'login_required' ||
    /AADSTS(70008|700082|700084|50173|50076|50078|65001|9002313|70000)/.test(e.message || '');
}

// Token vigente (renovado si hizo falta). null = hay que volver a conectar.
async function tokenValido() {
  const t = await tokenLeer();
  if (!t) return null;
  if (t.access && Date.now() < t.expira) return t.access;
  if (!t.refresh) return null;
  const cfg = await configNube();
  try {
    const tok = await pedirToken({
      grant_type: 'refresh_token', refresh_token: t.refresh, client_id: cfg.clientId, scope: SCOPES,
    });
    await guardarToken(tok);
    return tok.access_token;
  } catch (e) {
    if (pareceSesionCaduca(e)) {
      await db.ajusteGuardar('nube:token', { ...t, access: '', refresh: '', expira: 0 });
      return null;
    }
    throw e;   // red caida u otro tropiezo: no es sesion perdida
  }
}

/* ---------------------------------------------------------------- */
/* Microsoft Graph: el archivo en OneDrive                           */
/* ---------------------------------------------------------------- */

async function graph(token, ruta, opciones = {}) {
  const r = await fetch(ruta.startsWith('http') ? ruta : GRAPH + ruta, {
    ...opciones,
    headers: { Authorization: 'Bearer ' + token, ...(opciones.headers || {}) },
  });
  if (r.status === 204) return null;
  const tipo = r.headers.get('content-type') || '';
  const cuerpo = tipo.includes('json') ? await r.json().catch(() => ({})) : null;
  if (!r.ok) {
    const msg = (cuerpo && cuerpo.error && cuerpo.error.message) || ('HTTP ' + r.status);
    const e = new Error(msg);
    e.status = r.status;
    e.codigo = (cuerpo && cuerpo.error && cuerpo.error.code) || '';
    throw e;
  }
  return cuerpo;
}

// Enlace "Compartir" de OneDrive → id de share para Graph.
function idDeEnlace(url) {
  return 'u!' + base64url(new TextEncoder().encode(String(url).trim()));
}

// El enlace puede apuntar a la CARPETA compartida (lo normal: ahi se busca
// o se crea el archivo) o directamente al archivo.
async function localizarArchivo(token, cfg) {
  const raiz = await graph(token, '/shares/' + idDeEnlace(cfg.enlace) + '/driveItem');
  const driveId = raiz.parentReference && raiz.parentReference.driveId;
  if (!driveId) throw new Error('OneDrive no devolvio la unidad del enlace compartido.');
  if (raiz.file) {
    return { driveId, id: raiz.id, nombre: raiz.name, eTag: raiz.eTag, descarga: raiz['@microsoft.graph.downloadUrl'], tam: raiz.size || 0 };
  }
  if (!raiz.folder) throw new Error('El enlace no apunta a una carpeta ni a un archivo de OneDrive.');
  const nombre = (cfg.archivo || NOMBRE_ARCHIVO).trim();
  const hijos = await graph(token, '/drives/' + driveId + '/items/' + raiz.id + '/children?$select=id,name,file&$top=500');
  const hit = (hijos.value || []).find(x => x.file && (x.name || '').toLowerCase() === nombre.toLowerCase());
  if (hit) {
    const item = await graph(token, '/drives/' + driveId + '/items/' + hit.id);
    return { driveId, id: item.id, nombre: item.name, eTag: item.eTag, descarga: item['@microsoft.graph.downloadUrl'], tam: item.size || 0 };
  }
  return { driveId, id: null, carpetaId: raiz.id, nombre, tam: 0 };
}

async function descargar(token, item) {
  if (!item.id || !item.tam) return new Uint8Array(0);
  let r = null;
  if (item.descarga) {
    try { r = await fetch(item.descarga); } catch (e) { r = null; }
  }
  if (!r || !r.ok) {
    r = await fetch(GRAPH + '/drives/' + item.driveId + '/items/' + item.id + '/content', {
      headers: { Authorization: 'Bearer ' + token },
    });
  }
  if (!r.ok) throw new Error('No se pudo descargar ' + item.nombre + ' (HTTP ' + r.status + ')');
  return new Uint8Array(await r.arrayBuffer());
}

async function subir(token, item, blob) {
  const ruta = item.id
    ? '/drives/' + item.driveId + '/items/' + item.id + '/content'
    : '/drives/' + item.driveId + '/items/' + item.carpetaId + ':/' + encodeURIComponent(item.nombre) +
      ':/content?@microsoft.graph.conflictBehavior=fail';
  const headers = { 'Content-Type': MIME_XLSX };
  if (item.id && item.eTag) headers['If-Match'] = item.eTag;
  return graph(token, ruta, { method: 'PUT', headers, body: blob });
}

/* ---------------------------------------------------------------- */
/* Datos: locales, remotos y su mezcla                               */
/* ---------------------------------------------------------------- */

// Marca mas reciente dentro de un registro viejo (sin `actualizado`).
function ultimaMarca(obj) {
  let m = 0;
  (function rec(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(rec); return; }
    for (const k in o) {
      const x = o[k];
      if ((k === 'ts' || k === 'creado') && typeof x === 'number') { if (x > m) m = x; }
      else if (x && typeof x === 'object') rec(x);
    }
  })(obj);
  return m || 1;
}

// Los almacenes REALES (aunque el sandbox este activo, la nube no lo es).
async function datosLocales() {
  const ventas = await db.todosDe('ventas');
  const contactos = await db.todosDe('contactos');
  const dias = await db.todosDe('diario');
  for (const v of ventas) {
    if (!v.actualizado) { v.actualizado = ultimaMarca(v); await db.guardarCrudo('ventas', v); }
  }
  for (const c of contactos) {
    if (!c.actualizado) { c.actualizado = ultimaMarca(c); await db.guardarCrudo('contactos', c); }
  }
  return { ventas, contactos, dias };
}

function leerApp(libro) {
  const app = {};
  for (const f of (libro.hoja('_app') || []).slice(1)) {
    if (f && f[0] != null) app[String(f[0])] = f[1] == null ? '' : f[1];
  }
  return app;
}

function tieneDatos(libro) {
  return libro.hojas.some(h => h.filas.some(f => f && f.some(v => v !== null && v !== undefined)));
}

function registrosRemotos(libro) {
  const out = { ventas: new Map(), contactos: new Map(), dispositivos: {} };
  const filas = libro.hoja('_datos') || [];
  for (let r = 1; r < filas.length; r++) {
    const f = filas[r];
    if (!f || f[0] == null) continue;
    const tipo = String(f[0]);
    const id = String(f[1] == null ? '' : f[1]);
    const partes = Math.max(1, Number(f[3]) || 1);
    let json = '';
    for (let k = 0; k < partes; k++) json += f[4 + k] == null ? '' : String(f[4 + k]);
    let obj;
    try { obj = JSON.parse(json); } catch (e) { continue; }
    if (!obj || typeof obj !== 'object') continue;
    if (tipo === 'venta' && id) out.ventas.set(id, obj);
    else if (tipo === 'contacto' && id) out.contactos.set(id, obj);
  }
  const app = leerApp(libro);
  for (const k in app) {
    if (k.startsWith('disp:')) {
      try { out.dispositivos[k.slice(5)] = JSON.parse(app[k]); } catch (e) { /* fila rara */ }
    }
  }
  return out;
}

// Por id: gana la copia con `actualizado` mas nuevo. Lo remoto mas nuevo
// se BAJA al telefono (escritura cruda, sin re-marcar); lo local mas
// nuevo cuenta como subida. Nada se borra.
async function mezclar(local, remoto) {
  const res = { ventas: [], contactos: [], dias: local.dias || [], subidas: 0, bajadas: 0 };
  const unir = async (lista, mapaRemoto, clave, store, destino) => {
    const locales = new Map(lista.map(x => [String(x[clave]), x]));
    const ids = new Set([...locales.keys(), ...mapaRemoto.keys()]);
    for (const id of ids) {
      const l = locales.get(id);
      const r = mapaRemoto.get(id);
      const tl = l ? (l.actualizado || 0) : -1;
      const tr = r ? (r.actualizado || 0) : -1;
      if (l && tl >= tr) {
        destino.push(l);
        if (tl > tr) res.subidas++;
      } else {
        destino.push(r);
        await db.guardarCrudo(store, r);
        res.bajadas++;
      }
    }
  };
  await unir(local.ventas, remoto.ventas, 'id', 'ventas', res.ventas);
  await unir(local.contactos, remoto.contactos, 'clave', 'contactos', res.contactos);
  return res;
}

/* ---------------------------------------------------------------- */
/* El libro intermediario                                            */
/* ---------------------------------------------------------------- */

function textoCorto(s, n = 2000) {
  s = s == null ? '' : String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function estadoVenta(v) {
  if (v.cerrada) return v.conclusion ? 'Cerrada (venta completada)' : 'Cerrada';
  if (v.conclusion && !v.conclusion.revisada) return 'Completada, por revisar';
  if (v.devolucion) return 'Evidencia devuelta';
  if (v.pendienteAccion) return 'Falta siguiente accion';
  return 'Abierta';
}

function clavePrio(v) {
  return prioridadValida(v.prioridad) ? v.prioridad[0] + v.prioridad.slice(1).padStart(4, '0') : 'Z9999';
}

function ordenarVentas(ventas) {
  return [...ventas].sort((a, b) => {
    if (!!a.cerrada !== !!b.cerrada) return a.cerrada ? 1 : -1;
    const p = clavePrio(a).localeCompare(clavePrio(b));
    if (p) return p;
    const t = (a.tema || '').localeCompare(b.tema || '', 'es');
    if (t) return t;
    return nombreEntidad(a).localeCompare(nombreEntidad(b), 'es');
  });
}

function trozos(json) {
  const partes = [];
  for (let i = 0; i < json.length; i += TROZO_JSON) partes.push(json.slice(i, i + TROZO_JSON));
  return partes.length ? partes : [''];
}

/**
 * Arma el libro con TODO: hojas legibles para el jefe + hojas ocultas con
 * el JSON integro. `dispositivos` = { id: {usuario, ultimaSync, app} } de
 * los otros telefonos (se conservan al regenerar).
 */
export async function libroDeDatos({ ventas, contactos, dias = [] }, dispositivos = {}) {
  const org = await organizacion();
  const yo = await quienSoyReal();
  const dispositivo = await dispositivoId();
  const ahora = Date.now();
  const lista = ordenarVentas(ventas);

  let nEstatus = MIN_ESTATUS;
  for (const v of lista) nEstatus = Math.max(nEstatus, (v.estatus || []).length);

  const colsObjetivos = [
    { titulo: 'Prioridad', ancho: 9 },
    { titulo: 'Tema', ancho: 20 },
    { titulo: 'Cliente / Proyecto', ancho: 24 },
    { titulo: 'Objetivo', ancho: 36, tipo: 'largo' },
    { titulo: 'Descripcion', ancho: 36, tipo: 'largo' },
    { titulo: 'Responsable', ancho: 20 },
    { titulo: 'Fecha Compromiso', ancho: 14, tipo: 'fecha' },
    { titulo: 'Ultimo Estatus', ancho: 13 },
    { titulo: 'Descripcion Ultimo Estatus', ancho: 36, tipo: 'largo' },
    { titulo: 'Calificacion', ancho: 11, tipo: 'porcentaje' },
  ];
  for (let k = 1; k <= nEstatus; k++) {
    colsObjetivos.push({ titulo: 'Estatus ' + k, ancho: 30, tipo: 'largo' });
    colsObjetivos.push({ titulo: 'Fecha Revision ' + k, ancho: 13, tipo: 'fecha' });
    colsObjetivos.push({ titulo: 'Cumplimiento ' + k, ancho: 13 });
  }
  colsObjetivos.push(
    { titulo: 'Estado', ancho: 22 },
    { titulo: 'Sede', ancho: 16 },
    { titulo: 'Proxima Revision', ancho: 13, tipo: 'fecha' },
    { titulo: 'Creado', ancho: 16, tipo: 'fechaHora' },
    { titulo: 'Actualizado', ancho: 16, tipo: 'fechaHora' },
    { titulo: 'ID', ancho: 38 },
  );

  const filasObjetivos = [];
  const filasEstatus = [];
  const filasAnotaciones = [];
  const filasDatos = [];
  let maxPartes = 1;

  for (const v of lista) {
    const entidad = nombreEntidad(v);
    const resueltos = estatusResueltos(v);
    const pendiente = estatusPendiente(v);
    const ultimo = resueltos[resueltos.length - 1] || null;

    const fila = [
      prioridadValida(v.prioridad) ? v.prioridad : '',
      v.tema || '',
      entidad,
      v.titulo || '',
      textoCorto(v.descripcion),
      v.dueno || '',
      v.objetivoCompromiso || '',
      resueltos.length ? 'Estatus ' + resueltos.length : '',
      ultimo ? textoCorto(ultimo.resultado.texto) : '',
      resueltos.length ? calificacion(v) / 100 : '',
    ];
    const estatus = v.estatus || [];
    for (let k = 0; k < nEstatus; k++) {
      const s = estatus[k];
      if (!s) { fila.push('', '', ''); continue; }
      fila.push(
        s.resultado ? textoCorto(s.resultado.texto) : '',
        s.fechaRevision || '',
        s.resultado ? (s.resultado.tipo === 'completado' ? 'SI' : 'NO') : '',
      );
    }
    fila.push(
      estadoVenta(v),
      v.sede || '',
      pendiente ? pendiente.fechaRevision || '' : '',
      v.creado || '',
      v.actualizado || '',
      v.id,
    );
    filasObjetivos.push(fila);

    estatus.forEach((s, k) => {
      filasEstatus.push([
        entidad, v.titulo || '', v.dueno || '', k + 1, s.fechaRevision || '',
        s.resultado ? (s.resultado.tipo === 'completado' ? 'Objetivo completado' : 'Sin completar') : 'Pendiente',
        s.resultado ? textoCorto(s.resultado.texto) : '',
        s.resultado ? s.resultado.fecha || '' : '',
        s.resultado ? s.resultado.por || '' : '',
        s.por || '', v.id,
      ]);
    });

    for (const a of (v.anotaciones || [])) {
      filasAnotaciones.push([entidad, v.titulo || '', a.fecha || '', textoCorto(a.texto), v.id]);
    }

    const partes = trozos(JSON.stringify(v));
    maxPartes = Math.max(maxPartes, partes.length);
    filasDatos.push(['venta', v.id, v.actualizado || 0, partes.length, ...partes]);
  }

  // ACTIVIDADES DIARIAS (el diario de cada quien; las de Ventas van
  // ligadas a su objetivo). Solo informativas: viajan al Excel, no de
  // regreso (el diario se guarda por fecha; su sincronizacion entre
  // telefonos queda para la fase de lectura).
  const filasActividades = [];
  for (const d of [...dias].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))) {
    for (const a of (d.actividades || [])) {
      const objetivo = a.ventaId ? ventas.find(v => v.id === a.ventaId) : null;
      filasActividades.push([
        d.fecha || '', d.usuario || '', textoCorto(a.texto),
        objetivo ? nombreEntidad(objetivo) : '', objetivo ? objetivo.titulo || '' : (a.ventaEtiqueta || ''),
        a.hecha ? 'SI' : 'NO', d.evaluado ? 'SI' : 'NO', a.ventaId || '',
      ]);
    }
  }

  const filasContactos = [...contactos]
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'))
    .map(c => [c.nombre || '', c.cliente || '', c.sede || '', c.cargo || '', c.correo || '', c.telefono || '', c.clave || '']);
  for (const c of contactos) {
    const partes = trozos(JSON.stringify(c));
    maxPartes = Math.max(maxPartes, partes.length);
    filasDatos.push(['contacto', c.clave, c.actualizado || 0, partes.length, ...partes]);
  }

  const filasEquipo = (org.usuarios || []).map(u => [
    u.nombre || '', u.depto || '', u.rol || '',
    Object.keys(u.permisos || {}).filter(k => u.permisos[k]).join(', '), u.id,
  ]);

  const disps = { ...dispositivos };
  disps[dispositivo] = { usuario: yo ? yo.nombre : '', ultimaSync: ahora, app: APP_VERSION };
  const filasApp = [
    ['formato', FORMATO], ['version', VERSION_FORMATO], ['app', APP_VERSION],
    ['generado', ahora], ['generadoEl', { v: ahora, t: 'fechaHora' }],
    ['dispositivo', dispositivo], ['usuario', yo ? yo.nombre : ''],
    ['ventas', ventas.length], ['contactos', contactos.length],
    ...Object.keys(disps).map(id => ['disp:' + id, JSON.stringify(disps[id])]),
  ];

  const colsDatos = [
    { titulo: 'Tipo', ancho: 10 }, { titulo: 'ID', ancho: 38 },
    { titulo: 'Actualizado', ancho: 16, tipo: 'numero' }, { titulo: 'Partes', ancho: 8, tipo: 'numero' },
  ];
  for (let k = 1; k <= maxPartes; k++) colsDatos.push({ titulo: 'JSON ' + k, ancho: 60 });

  const blob = crearLibro([
    { nombre: 'Objetivos', columnas: colsObjetivos, filas: filasObjetivos },
    { nombre: 'Estatus', filas: filasEstatus, columnas: [
      { titulo: 'Cliente / Proyecto', ancho: 24 }, { titulo: 'Objetivo', ancho: 36, tipo: 'largo' },
      { titulo: 'Responsable', ancho: 20 }, { titulo: 'N', ancho: 5, tipo: 'numero' },
      { titulo: 'Fecha Revision', ancho: 13, tipo: 'fecha' }, { titulo: 'Resultado', ancho: 20 },
      { titulo: 'Estatus', ancho: 40, tipo: 'largo' }, { titulo: 'Fecha Resuelto', ancho: 13, tipo: 'fecha' },
      { titulo: 'Resuelto Por', ancho: 20 }, { titulo: 'Agendado Por', ancho: 20 }, { titulo: 'ID Objetivo', ancho: 38 },
    ] },
    { nombre: 'Actividades', filas: filasActividades, columnas: [
      { titulo: 'Fecha', ancho: 12, tipo: 'fecha' }, { titulo: 'Responsable', ancho: 22 },
      { titulo: 'Actividad', ancho: 44, tipo: 'largo' },
      { titulo: 'Cliente / Proyecto', ancho: 24 }, { titulo: 'Objetivo', ancho: 36, tipo: 'largo' },
      { titulo: 'Completada', ancho: 12 }, { titulo: 'Dia Cerrado', ancho: 12 },
      { titulo: 'ID Objetivo', ancho: 38 },
    ] },
    { nombre: 'Anotaciones', filas: filasAnotaciones, columnas: [
      { titulo: 'Cliente / Proyecto', ancho: 24 }, { titulo: 'Objetivo', ancho: 36, tipo: 'largo' },
      { titulo: 'Fecha', ancho: 12, tipo: 'fecha' }, { titulo: 'Anotacion', ancho: 50, tipo: 'largo' },
      { titulo: 'ID Objetivo', ancho: 38 },
    ] },
    { nombre: 'Contactos', filas: filasContactos, columnas: [
      { titulo: 'Nombre', ancho: 26 }, { titulo: 'Cliente', ancho: 22 }, { titulo: 'Sede', ancho: 18 },
      { titulo: 'Cargo', ancho: 20 }, { titulo: 'Correo', ancho: 30 }, { titulo: 'Telefono', ancho: 18 },
      { titulo: 'Clave', ancho: 30 },
    ] },
    { nombre: 'Equipo', filas: filasEquipo, columnas: [
      { titulo: 'Nombre', ancho: 26 }, { titulo: 'Departamento', ancho: 16 }, { titulo: 'Rol', ancho: 10 },
      { titulo: 'Permisos', ancho: 24 }, { titulo: 'ID', ancho: 38 },
    ] },
    { nombre: '_app', oculta: true, filas: filasApp, columnas: [{ titulo: 'Clave', ancho: 44 }, { titulo: 'Valor', ancho: 60 }] },
    { nombre: '_datos', oculta: true, filas: filasDatos, columnas: colsDatos },
  ]);
  return { blob, nombreArchivo: NOMBRE_ARCHIVO, resumen: { ventas: ventas.length, contactos: contactos.length } };
}

// El libro con SOLO lo de este telefono (para descargar o compartir sin nube).
export async function libroLocal() {
  return libroDeDatos(await datosLocales());
}

/* ---------------------------------------------------------------- */
/* Sincronizacion                                                    */
/* ---------------------------------------------------------------- */

let _enCurso = null;

/**
 * Baja, mezcla y sube. manual=true lanza los errores (para mostrarlos);
 * en automatico se guardan en el estado y se sigue en silencio.
 */
export function sincronizar({ motivo = 'auto', manual = false } = {}) {
  if (_enCurso) return _enCurso;
  _enCurso = sincronizarDeVerdad(motivo, manual).finally(() => { _enCurso = null; });
  return _enCurso;
}

async function sincronizarDeVerdad(motivo, manual) {
  const cfg = await configNube();
  const omitir = (razon, mensaje) => {
    if (manual) throw new Error(mensaje);
    return { omitida: razon };
  };
  if (!cfg.clientId || !cfg.enlace) return omitir('sin configurar', 'Configura primero el ID de aplicacion y el enlace de la carpeta.');
  if (!manual && cfg.auto === false) return { omitida: 'auto apagado' };
  if (testActivo()) return omitir('test', 'En Test Mode la nube no se toca: sal del sandbox primero.');
  if (!navigator.onLine) return omitir('offline', 'Sin conexion a internet.');

  _sincronizando = true;
  try {
    let token;
    try { token = await tokenValido(); } catch (e) {
      await estadoGuardar({ error: 'Sin respuesta de Microsoft: ' + e.message, ultimoFallo: Date.now() });
      return omitir('red', 'Sin respuesta de Microsoft: ' + e.message);
    }
    if (!token) {
      await estadoGuardar({ error: 'reconectar', ultimoFallo: Date.now() });
      if (!manual) await intentarRenovacionSilenciosa();
      return omitir('sin sesion', 'Conecta tu cuenta de Microsoft (⚙ → Nube OneDrive).');
    }

    let resultado = null;
    for (let intento = 0; ; intento++) {
      const item = await localizarArchivo(token, cfg);
      let remoto = { ventas: new Map(), contactos: new Map(), dispositivos: {} };
      let appRemota = {};
      if (item.id) {
        const bytes = await descargar(token, item);
        if (bytes.length) {
          const libro = await leerLibro(bytes);
          appRemota = leerApp(libro);
          if (appRemota.formato !== FORMATO) {
            if (tieneDatos(libro)) throw new Error('El archivo ' + item.nombre + ' de la nube no es de la app y tiene contenido: no se toca.');
          } else if (Number(appRemota.version) > VERSION_FORMATO) {
            throw new Error('El archivo de la nube es de una version mas nueva de la app: actualiza la app.');
          } else {
            remoto = registrosRemotos(libro);
          }
        }
      }
      const local = await datosLocales();
      const union = await mezclar(local, remoto);
      const dispositivo = await dispositivoId();
      const mio = remoto.dispositivos[dispositivo];
      const hayQueSubir = !item.id || union.subidas > 0 || appRemota.app !== APP_VERSION ||
        !mio || (Date.now() - (mio.ultimaSync || 0)) > 6 * 3600 * 1000;
      resultado = { subidas: union.subidas, bajadas: union.bajadas, subio: hayQueSubir, archivo: item.nombre };
      if (!hayQueSubir) break;
      const { blob } = await libroDeDatos(union, remoto.dispositivos);
      try {
        await subir(token, item, blob);
        break;
      } catch (e) {
        // 412 = otro telefono subio entre tanto; 409 = alguien lo acaba de
        // crear: se vuelve a bajar y a mezclar (hasta 3 veces).
        if ((e.status === 412 || e.status === 409) && intento < 2) continue;
        if (e.status === 401) {
          const t = await tokenLeer();
          if (t) await db.ajusteGuardar('nube:token', { ...t, access: '', expira: 0 });
        }
        throw e;
      }
    }
    await estadoGuardar({ ultimaSync: Date.now(), error: '', ultimoFallo: 0, ...resultado, motivo });
    if (resultado.bajadas > 0) avisarBajada();
    return resultado;
  } catch (e) {
    console.error('nube', e);
    await estadoGuardar({ error: e.message || String(e), ultimoFallo: Date.now() });
    if (manual) throw e;
    return { error: e.message };
  } finally {
    _sincronizando = false;
  }
}

// Renovacion silenciosa: solo si no hay nada a medio escribir, la app se
// ve, no fallo hace poco y no se intento en las ultimas horas.
async function intentarRenovacionSilenciosa() {
  try {
    const e = await estadoNube();
    const t = await tokenLeer();
    if (!t || !t.cuenta) return;                          // nunca se conecto: no hay a quien renovar
    if (document.visibilityState !== 'visible') return;
    if (document.querySelector('.hoja-fondo, .visor')) return;
    const tag = (document.activeElement || {}).tagName || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (Date.now() - (e.silencioIntento || 0) < SILENCIO_CADA) return;
    if (e.silencioFallo && Date.now() - e.silencioFallo < 24 * 3600 * 1000) return;
    await conectar({ silencioso: true });
  } catch (err) { /* se queda en 'reconectar' */ }
}

// Llegaron registros de otros telefonos: repintar la vista si no hay nada
// abierto (una hoja abierta se dejaria a medias).
function avisarBajada() {
  try {
    window.dispatchEvent(new CustomEvent('nube-bajada'));
    const abierto = document.querySelector('.hoja-fondo, .visor');
    const tag = (document.activeElement || {}).tagName || '';
    if (!abierto && tag !== 'INPUT' && tag !== 'TEXTAREA') window.dispatchEvent(new Event('hashchange'));
  } catch (e) { /* sin DOM */ }
}

/**
 * Enganches automaticos (se llama una vez al arrancar): sincroniza poco
 * despues de abrir, al volver a verse la app, al recuperar internet y unos
 * segundos despues de cada guardado de venta o contacto.
 */
export function instalarNube() {
  let timer = null;
  const agendar = (ms, motivo) => {
    clearTimeout(timer);
    timer = setTimeout(() => sincronizar({ motivo }).catch(() => {}), ms);
  };
  window.addEventListener('datos-guardados', (ev) => {
    if (ev.detail && ev.detail.test) return;
    agendar(8000, 'cambios');
  });
  window.addEventListener('online', () => agendar(3000, 'online'));
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const e = await estadoNube();
    if (!e.ultimaSync || Date.now() - e.ultimaSync > 5 * 60000) agendar(2500, 'visible');
  });
  agendar(4000, 'apertura');
}
