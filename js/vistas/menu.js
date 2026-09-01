// Menu principal: la portada de la app. De aqui se entra al area de
// trabajo del tecnico; los demas modulos se iran sumando como botones.

import { h, aviso, animarMarca } from '../ui.js';
import { esNativa } from '../nativo.js';
import { temaActual, alternarTema } from '../tema.js';
import { abrirConfiguracion, hojaAlmacenamiento, bannerActualizacion, lineaVersion } from './servicios.js';
import * as db from '../db.js';
import { quienSoy, puedeGestionarVentas } from '../organizacion.js';

// Avisos de VENTAS en la portada (pedido de Vale): al LIDER, las ventas
// concluidas que esperan su revision; al VENDEDOR, la evidencia que el
// lider le devolvio. Ambos con su enlace directo al tablero.
async function bannersVentas() {
  const banners = [];
  try {
    const yo = await quienSoy();
    if (!yo) return banners;
    const ventas = await db.ventasTodas();
    const irVentas = h('button.btn', {
      type: 'button', onclick: () => { location.hash = '#/d/ventas'; },
    }, 'REVISAR');
    if (puedeGestionarVentas(yo)) {
      const n = ventas.filter(v => !v.cerrada && v.conclusion && !v.conclusion.revisada).length;
      if (n) {
        banners.push(h('div.banner.banner--aviso',
          h('div',
            h('strong', '🔔 ' + (n === 1 ? 'Una venta concluida' : n + ' ventas concluidas') + ' por revisar'),
            h('p', 'Marcadas como completadas: revisa su evidencia.')),
          irVentas));
      }
    }
    const dev = ventas.filter(v => !v.cerrada && v.devolucion && !v.devolucion.vista && v.duenoId === yo.id);
    if (dev.length) {
      banners.push(h('div.banner.banner--aviso',
        h('div',
          h('strong', '↩ No se acepto tu evidencia'),
          h('p', 'El lider devolvio "' + dev[0].titulo + '"' + (dev.length > 1 ? ' (y ' + (dev.length - 1) + ' mas)' : '') + ': revisa la razon.')),
        h('button.btn', {
          type: 'button', onclick: () => { location.hash = '#/d/ventas'; },
        }, 'VER')));
    }
  } catch (e) { /* sin datos aun */ }
  return banners;
}

function boton(icono, texto, alPulsar, chip) {
  return h('button.menu__boton', { type: 'button', onclick: alPulsar },
    h('span.menu__icono', icono),
    h('span.menu__texto', texto),
    chip ? h('span.menu__chip', chip) : h('span.menu__flecha', '›')
  );
}

export async function render(contenedor, refrescar) {
  const logo = h('img.menu__logo', { src: 'icons/logo-serpro.png', alt: 'Grupo Ser Pro' });
  const titulo = h('h1.menu__titulo.marca', 'SER PRO APP');
  logo.onclick = titulo.onclick = () => animarMarca(logo, titulo);

  const pantalla = h('div.menu',
    h('button.icono-btn.menu__respaldo', {
      type: 'button', 'aria-label': 'Almacenamiento y respaldo',
      onclick: () => hojaAlmacenamiento(refrescar),
    }, '⛁'),
    h('button.icono-btn.menu__tema', {
      type: 'button', 'aria-label': 'Cambiar tema',
      onclick: (ev) => {
        const nuevo = alternarTema();
        ev.currentTarget.textContent = nuevo === 'claro' ? '🌙' : '☀️';
      }
    }, temaActual() === 'claro' ? '🌙' : '☀️'),
    h('div.menu__marca',
      logo,
      titulo,
      esNativa() ? null : h('span.tag-web', 'WEB')
    ),
    h('div.menu__botones',
      boton('🔧', 'Tecnico', () => { location.hash = '#/t'; }),
      boton('📔', 'Gestion de Departamentos', () => { location.hash = '#/d'; }),
      boton('📦', 'Inventario', () => aviso('Inventario esta en desarrollo'), 'EN DESARROLLO'),
      boton('⚙', 'Configuracion', () => abrirConfiguracion())
    ),
    lineaVersion()
  );

  contenedor.append(pantalla);

  // Aviso de cascaron (APK) nuevo, tambien aqui en la portada.
  bannerActualizacion().then(b => { if (b) pantalla.prepend(b); }).catch(() => {});
  // Avisos de ventas (revision del lider / evidencia devuelta).
  bannersVentas().then(bs => { for (const b of bs) pantalla.prepend(b); }).catch(() => {});
}
