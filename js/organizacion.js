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
  return org;
}

export function organizacionGuardar(org) {
  return ajusteGuardar('organizacion', org);
}

// Quien dice ser el dueño de ESTE telefono (elegido en ⚙ → Usuarios).
export async function quienSoy() {
  const org = await organizacion();
  const yoId = await ajusteLeer('diario:yo');
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
