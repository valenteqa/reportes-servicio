// ⚙ → Nube OneDrive (Excel): conectar la cuenta Microsoft de ESTE
// telefono, configurar el ID de aplicacion y el enlace de la carpeta
// compartida, sincronizar a mano y descargar/compartir el Excel con lo
// de este telefono (eso funciona aunque la nube no este configurada).
// Misma familia de hojas que Almacenamiento y respaldo.

import { h, aviso, hoja, campo, campoArea, confirmar } from '../ui.js';
import { esNativa, compartirArchivoNativo, guardarEnCarpetaNativa } from '../nativo.js';
import * as nube from '../nube.js';

function cuando(ts) {
  if (!ts) return 'nunca';
  return new Date(ts).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function textoError(est) {
  if (!est.error) return '';
  if (est.error === 'reconectar') return 'La sesion de Microsoft caduco: vuelve a conectar.';
  return est.error;
}

// Entrega el Excel de este telefono: en el APK guarda en la carpeta de la
// app o abre el menu nativo; en navegador, compartir o descarga directa.
async function entregarExcel(modo, estado) {
  estado.textContent = 'Armando el Excel...';
  try {
    const r = await nube.libroLocal();
    if (esNativa()) {
      if (modo === 'guardar') {
        await guardarEnCarpetaNativa(r.blob, 'Excel/' + r.nombreArchivo);
        estado.textContent = 'Guardado en Documentos/ReportesServicio/Excel/' + r.nombreArchivo + '.';
        aviso('Excel guardado en la carpeta de la app', 'ok');
        return;
      }
      await compartirArchivoNativo(r.blob, r.nombreArchivo, r.nombreArchivo);
    } else {
      const archivo = new File([r.blob], r.nombreArchivo, { type: r.blob.type });
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
    estado.textContent = 'Excel listo: ' + r.resumen.ventas + ' objetivos, ' + r.resumen.contactos + ' contactos.';
    aviso('Excel generado', 'ok');
  } catch (e) {
    if (e && (e.name === 'AbortError' || /cancel/i.test((e.message || '') + e))) { estado.textContent = ''; return; }
    console.error(e);
    estado.textContent = 'Fallo: ' + (e && e.message ? e.message : e);
    aviso('No se pudo generar el Excel', 'error');
  }
}

export async function hojaNube() {
  await hoja('☁  Nube OneDrive (Excel)', () => {
    const cuerpo = h('div');
    const pinta = async () => {
      const cfg = await nube.configNube();
      const est = await nube.estadoNube();
      const cuenta = await nube.cuentaConectada();
      const lista = await nube.configurada();
      const estadoExcel = h('p.pista', '');
      const estadoSync = h('p.pista', '');
      const err = textoError(est);

      const cId = campo('ID de aplicacion (client id)', { value: cfg.clientId || '', maxLength: 80, autocomplete: 'off', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' });
      const cEnlace = campoArea('Enlace de la carpeta compartida (OneDrive)', { maxLength: 600, rows: 3, placeholder: 'https://1drv.ms/f/...' });
      cEnlace.entrada.value = cfg.enlace || '';
      const selAuto = h('select.org-select',
        h('option', { value: 'si', selected: cfg.auto !== false }, 'Sincronizar automaticamente'),
        h('option', { value: 'no', selected: cfg.auto === false }, 'Solo cuando yo toque Sincronizar'));

      const sincronizar = async () => {
        estadoSync.textContent = 'Sincronizando...';
        try {
          const r = await nube.sincronizar({ motivo: 'manual', manual: true });
          estadoSync.textContent = 'Listo: ' + (r.subidas || 0) + ' subidos, ' + (r.bajadas || 0) + ' bajados' +
            (r.subio === false ? ' (sin cambios que subir)' : '') + '.';
          aviso('Nube sincronizada', 'ok');
        } catch (e) {
          estadoSync.textContent = 'Fallo: ' + (e && e.message ? e.message : e);
          aviso('No se pudo sincronizar', 'error');
        }
        pinta();
      };

      cuerpo.replaceChildren(...[
        h('p.parrafo', 'La app guarda y lee un Excel intermediario (' + nube.NOMBRE_ARCHIVO + ') en la carpeta de OneDrive que se comparte con el equipo. Cada telefono entra con su propia cuenta Microsoft; los Excel del jefe se alimentan de ese archivo.'),

        h('h3.venta-grupo', '☁ ESTADO'),
        h('p.parrafo', cuenta
          ? 'Cuenta: ' + (cuenta.nombre || '') + (cuenta.correo ? ' (' + cuenta.correo + ')' : '')
          : 'Sin cuenta Microsoft conectada en este telefono.'),
        h('p.parrafo', 'Ultima sincronizacion: ' + cuando(est.ultimaSync) +
          (est.ultimaSync ? ' · ' + (est.subidas || 0) + ' subidos, ' + (est.bajadas || 0) + ' bajados' : '')),
        err ? h('p.parrafo', h('span.venta-carta__alerta', '⚠ ' + err)) : null,
        !lista ? h('p.pista', 'Para conectar, primero guarda abajo el ID de aplicacion y el enlace de la carpeta.') : null,
        (!cuenta || est.error === 'reconectar') ? h('button.btn.btn--primario.venta-btn', {
          type: 'button', disabled: !lista,
          onclick: async () => {
            try { await nube.conectar(); } catch (e) { aviso(e.message, 'error'); }
          },
        }, cuenta ? '🔁  VOLVER A CONECTAR' : '🔗  CONECTAR CON MICROSOFT') : null,
        cuenta ? h('button.btn.btn--primario.venta-btn', {
          type: 'button', disabled: nube.estaSincronizando(), onclick: sincronizar,
        }, '☁  SINCRONIZAR AHORA') : null,
        estadoSync,
        cuenta ? h('button.btn.btn--fantasma.venta-btn-mini', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmar('¿Desconectar la cuenta de Microsoft de este telefono? Los datos locales no se tocan.', { textoOk: 'Desconectar', peligro: false }))) return;
            await nube.desconectar();
            aviso('Cuenta desconectada.');
            pinta();
          },
        }, '✕  DESCONECTAR') : null,

        h('h3.venta-grupo', '📄 EXCEL DE ESTE TELEFONO'),
        h('p.pista', 'El mismo libro que va a la nube, con lo que hay en este telefono. Sirve aunque la nube no este configurada.'),
        h('div.venta-cierre-fila',
          h('button.btn.btn--fantasma', { type: 'button', onclick: () => entregarExcel(esNativa() ? 'guardar' : 'descargar', estadoExcel) },
            esNativa() ? '💾  GUARDAR' : '⬇  DESCARGAR'),
          h('button.btn.btn--fantasma', { type: 'button', onclick: () => entregarExcel('compartir', estadoExcel) }, '📤  COMPARTIR')),
        estadoExcel,

        h('h3.venta-grupo', '⚙ CONFIGURACION'),
        cId,
        cEnlace,
        h('label.campo', h('span.campo__etiqueta', 'Sincronizacion'), selAuto),
        h('button.btn.btn--primario.venta-btn', {
          type: 'button',
          onclick: async () => {
            const clientId = cId.entrada.value.trim();
            const enlace = cEnlace.entrada.value.trim();
            if (enlace && !/^https?:\/\//i.test(enlace)) { aviso('El enlace debe empezar con https://', 'error'); return; }
            await nube.configNubeGuardar({ ...cfg, clientId, enlace, auto: selAuto.value === 'si' });
            aviso('Configuracion guardada', 'ok');
            pinta();
          },
        }, '💾  GUARDAR CONFIGURACION'),
        h('p.pista', 'URL de retorno para registrar la app en Microsoft (plataforma "Aplicacion de una sola pagina"): ' + nube.urlDeRetorno()),
        h('p.pista', 'En Test Mode la nube no se toca, y los datos de ensayo nunca suben.'),
      ].filter(Boolean));
    };
    pinta();
    return cuerpo;
  }, { altura: 'completa' });
}

// Aviso de portada: la nube esta configurada pero la sesion de Microsoft
// caduco (o nunca se conecto este telefono).
export async function bannerNube() {
  try {
    if (!(await nube.configurada())) return null;
    const est = await nube.estadoNube();
    const cuenta = await nube.cuentaConectada();
    if (cuenta && est.error !== 'reconectar') return null;
    return h('div.banner.banner--aviso',
      h('div',
        h('strong', '☁ ' + (cuenta ? 'Vuelve a conectar OneDrive' : 'Conecta OneDrive')),
        h('p', cuenta ? 'La sesion de Microsoft caduco; sin ella este telefono no sincroniza.' : 'Este telefono aun no entra a la nube del equipo.')),
      h('button.btn', {
        type: 'button',
        onclick: async () => {
          try { await nube.conectar(); } catch (e) { aviso(e.message, 'error'); }
        },
      }, 'CONECTAR'));
  } catch (e) { return null; }
}
