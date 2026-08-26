# Reportes de Servicio

Bitácora de servicios de mantenimiento en planta. Registras conforme trabajas —
equipos, notas, tablas y fotos, cada cosa con su hora— y al final sale el reporte
en Word ya casi armado.

Es una **PWA**: se instala en la pantalla de inicio del teléfono y se comporta como
app nativa, pero por dentro es HTML/CSS/JavaScript sin dependencias ni compilación.

**Todos los datos viven únicamente en tu teléfono.** Nada se sube a ningún servidor.

---

## Probarla en la computadora

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Y abre <http://127.0.0.1:8123>. No hace falta instalar Node ni Python: el servidor
está escrito en PowerShell puro.

## Instalarla en el teléfono

La app ya está publicada en:

### <https://valenteqa.github.io/reportes-servicio/>

Ábrela en **Chrome de Android** → menú ⋮ → **Instalar aplicación**. Queda un icono
en la pantalla de inicio y se abre a pantalla completa, sin barra del navegador.

Después toca **Proteger** en el aviso amarillo, para que Android no borre tus datos
si el teléfono se queda sin espacio.

## Publicar cambios

1. Subir el número en **dos** lugares: `VERSION` en `sw.js` y `APP_VERSION` en
   `js/version.js` (deben avanzar juntos en cada publicación).
2. Luego:

```bash
git add -A && git commit -m "que cambio" && git push
```

En un minuto GitHub Pages reconstruye. Al abrir la app en el teléfono, ella
misma busca la versión nueva y **se recarga sola** en cuanto la tiene (salvo que
haya algo a medio escribir, en cuyo caso avisa). La versión activa se ve al pie
de la lista de trabajos, p. ej. `v2.0` — así se comprueba que llegó.

---

## Cómo está organizada

Al crear, primero eliges el **tipo**: 🔧 Servicio, 🧪 Pruebas de laboratorio o
📋 General. De ahí en adelante todo funciona igual.

```
Trabajo  (tipo, cliente, planta, modelo y serie de máquina,
          técnico, descripción de la falla)
├─ General          ← lo que no es de un equipo específico
│  └─ línea de tiempo
└─ Equipos[]
   └─ "Bomba hidráulica 2"
      └─ línea de tiempo ──> 08:42 nota
                             08:47 tabla
                             08:51 foto
```

Cada registro guarda su hora automáticamente. Puedes ver la línea de tiempo de un
equipo, o la del servicio completo con todo mezclado en orden cronológico.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Cascarón de la app |
| `css/app.css` | Todo el diseño visual |
| `js/db.js` | Base de datos (IndexedDB) |
| `js/media.js` | Captura y reescalado de fotos |
| `js/ui.js` | Construcción de DOM, formatos, hojas modales |
| `js/app.js` | Ruteo y arranque |
| `js/vistas/` | Una pantalla por archivo |
| `sw.js` | Service worker: hace que abra sin señal |
| `serve.ps1` | Servidor local de desarrollo |
| `generar-iconos.ps1` | Regenera los iconos PNG (solo si cambia el diseño) |

## Decisiones que vale la pena conocer

**Las fotos se reescalan a 1600 px al capturarse.** Una foto de celular pesa 3-5 MB;
reducida queda en ~350 KB sin perder legibilidad de un manómetro o una etiqueta. Un
servicio de 40 fotos ocupa ~14 MB en vez de ~160 MB, y el Word se puede mandar por
correo.

**Las marcas de tiempo son estrictamente crecientes.** Varios registros creados en
el mismo milisegundo —al importar varias fotos de golpe— compartían hora, y ahí
IndexedDB desempataba por un id aleatorio y la línea de tiempo salía desordenada.

**El service worker usa *stale-while-revalidate*.** Sirve de caché al instante y
refresca en segundo plano. Con caché-primero a secas, una corrección subida al
hosting nunca llegaba al teléfono si se olvidaba subir el número de versión.

**La cámara se abre con `<input type="file" capture>`,** no con `getUserMedia`. Así
se usa la app de cámara real del teléfono, con su enfoque, HDR y flash.

---

## Estado

Listo y probado:

- Servicios: crear, editar, cerrar, eliminar
- Equipos por servicio, con autocompletado de nombres ya usados
- Línea de tiempo por equipo y del servicio completo
- Notas, tablas y fotos, con su hora
- Editor de tablas: columnas de texto o número, teclado numérico automático,
  primera columna congelada, guardado automático
- Visor de fotos a pantalla completa con pie de foto editable
- Marcar registros como "fuera del reporte"
- Tema oscuro/claro alternable (☀️/🌙 en la cabecera); el claro es para sol
  directo en planta
- Funciona sin señal, instalable

Falta (fase 2):

- Pantalla de armado del reporte
- Generador de `.docx`
- Compartir a OneDrive con el menú de Android
