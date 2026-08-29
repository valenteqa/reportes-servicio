// Organizacion: deptos, usuarios y roles del Diario.
//
// FASE LOCAL: el padron vive en ajustes de este telefono y cada telefono
// declara de quien es ("diario:yo"). Cuando entre Firebase (lunes), esto
// se espeja a la nube con login real y reglas que si obligan; mientras,
// los candados son de buena fe.
//
// Roles: 'usuario' (normal), 'lider' (de area) y 'admin' (Vale).
// Regla de Vale: un usuario normal NO puede modificar ni eliminar
// actividades — ni las suyas —; eso lo aprueba y lo hace su lider.

import { ajusteLeer, ajusteGuardar, nuevoId } from './db.js';

export const DEPTOS = ['Administracion', 'Electronica', 'Hidraulica', 'Ventas'];

export const ROLES = {
  usuario: 'Usuario',
  lider:   'Lider de area',
  admin:   'Administrador',
};

export const AVISO_SOLO_LIDER =
  'Pide a tu lider de area que apruebe y haga el cambio: solo el puede hacerlo.';

// Padron inicial dictado por Vale (los deptos los asigna el admin en ⚙).
const SEMILLA = [
  { nombre: 'Usuario',   rol: 'admin' },
  { nombre: 'Usuario2', rol: 'usuario' },
  { nombre: 'Usuario3',   rol: 'usuario' },
  { nombre: 'Usuario4',       rol: 'usuario' },
  { nombre: 'Usuario5',     rol: 'usuario' },
  { nombre: 'Usuario6',   rol: 'usuario' },
  { nombre: 'Usuario7',     rol: 'usuario' },
  { nombre: 'Usuario8',  rol: 'usuario' },
];

export async function organizacion() {
  let org = await ajusteLeer('organizacion');
  if (!org || !Array.isArray(org.usuarios) || !org.usuarios.length) {
    org = { usuarios: SEMILLA.map(u => ({ id: nuevoId(), depto: '', ...u })) };
    await ajusteGuardar('organizacion', org);
  }
  // Migracion v2: Usuario2 es el LIDER de VENTAS (dictado por Vale). Solo
  // se aplica si el admin no lo ha movido a otra cosa a mano.
  if (!org.v || org.v < 2) {
    const juan = org.usuarios.find(u => u.nombre === 'Usuario2');
    if (juan) {
      if (!juan.depto) juan.depto = 'Ventas';
      if (juan.rol === 'usuario') juan.rol = 'lider';
    }
    org.v = 2;
    await ajusteGuardar('organizacion', org);
  }
  return org;
}

export function organizacionGuardar(org) {
  return ajusteGuardar('organizacion', org);
}

// Quien dice ser el dueño de ESTE telefono (elegido en ⚙ → Usuarios).
// En MODO PRUEBA, el admin puede "ver como" otro usuario: esa identidad
// simulada manda mientras este activa.
export async function quienSoy() {
  const org = await organizacion();
  const comoId = await ajusteLeer('test:como');
  const yoId = comoId || await ajusteLeer('diario:yo');
  return org.usuarios.find(u => u.id === yoId) || null;
}

export function serYo(id) {
  return ajusteGuardar('diario:yo', id);
}

// Sin identificarse se trata como usuario normal (lo mas restrictivo).
export function puedeEditarActividades(yo) {
  return !!yo && (yo.rol === 'lider' || yo.rol === 'admin');
}

export function esAdmin(yo) {
  return !!yo && yo.rol === 'admin';
}

// Ventas: crear oportunidades es del LIDER de Ventas (o admin); registrar
// acciones/estatus es de cualquiera del depto Ventas (o admin).
export function puedeCrearVentas(yo) {
  return !!yo && (yo.rol === 'admin' || (yo.rol === 'lider' && yo.depto === 'Ventas'));
}
export function puedeAccionarVentas(yo) {
  return !!yo && (yo.rol === 'admin' || yo.depto === 'Ventas');
}

// Ver las ACTIVIDADES de alguien (no solo sus porcentajes): uno mismo,
// el admin, o el lider con la gente de SU depto. Los porcentajes si son
// publicos para todos.
export function puedeVerActividadesDe(yo, u) {
  if (!yo || !u) return false;
  if (yo.id === u.id) return true;
  if (yo.rol === 'admin') return true;
  if (yo.rol === 'lider' && yo.depto && yo.depto === u.depto) return true;
  return false;
}

/* ---------------------------------------------------------------- */
/* Clave dinamica de administrador                                   */
/* ---------------------------------------------------------------- */

// La ⚙ Configuracion completa (incluida la eleccion de identidad) se abre
// solo con la CLAVE DEL DIA: 6 digitos derivados de la fecha con una
// semilla. Cambia sola cada dia y desinstalar/instalar no la brinca.
// (Vale tiene su tarjeta de claves; con Firebase esto pasara a login real.)
const SEMILLA_CLAVE = 'SerPro-Fenix-2026-Vale';

function fechaClaveLocal(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export async function claveDelDia(fechaStr) {
  const fecha = fechaStr || fechaClaveLocal();
  const datos = new TextEncoder().encode(SEMILLA_CLAVE + '|' + fecha);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', datos));
  const num = ((hash[0] << 16) | (hash[1] << 8) | hash[2]) % 1000000;
  return String(num).padStart(6, '0');
}

export function claveDeManana() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return claveDelDia(fechaClaveLocal(d));
}

/* ---------------------------------------------------------------- */
/* Modo prueba (solo tras la clave de admin en ⚙)                    */
/* ---------------------------------------------------------------- */

// Fecha simulada: Diario y Ventas viven en esa fecha (atrasos, candados,
// semanas). La clave de ⚙ sigue siendo la del dia REAL, para no dejar al
// admin fuera. El cache es sincrono porque fechaClave() se llama por todas
// partes sin await; se carga al arrancar la app.
let _fechaSimulada = null;

export function fechaSimulada() {
  return _fechaSimulada;
}

export async function cargarModoPrueba() {
  _fechaSimulada = (await ajusteLeer('test:fecha')) || null;
}

export async function simularFecha(fecha) {
  _fechaSimulada = fecha || null;
  await ajusteGuardar('test:fecha', fecha || '');
}

export async function verComo(id) {
  await ajusteGuardar('test:como', id || '');
}

export async function estadoPrueba() {
  const comoId = (await ajusteLeer('test:como')) || '';
  let comoNombre = '';
  if (comoId) {
    const org = await organizacion();
    comoNombre = (org.usuarios.find(u => u.id === comoId) || {}).nombre || '';
  }
  return { fecha: _fechaSimulada || '', comoId, comoNombre };
}
