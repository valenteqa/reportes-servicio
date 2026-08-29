// Menu principal: la portada de la app. De aqui se entra al area de
// trabajo del tecnico; los demas modulos se iran sumando como botones.

import { h, aviso, animarMarca } from '../ui.js';
import { esNativa } from '../nativo.js';
import { temaActual, alternarTema } from '../tema.js';
import { hojaConfiguracion, hojaAlmacenamiento, bannerActualizacion, lineaVersion } from './servicios.js';

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
      boton('📔', 'Diario', () => { location.hash = '#/d'; }),
      boton('📦', 'Inventario', () => aviso('Inventario esta en desarrollo'), 'EN DESARROLLO'),
      boton('⚙', 'Configuracion', () => hojaConfiguracion())
    ),
    lineaVersion()
  );

  contenedor.append(pantalla);

  // Aviso de cascaron (APK) nuevo, tambien aqui en la portada.
  bannerActualizacion().then(b => { if (b) pantalla.prepend(b); }).catch(() => {});
}
