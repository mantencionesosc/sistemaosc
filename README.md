# Mantenciones OSC — App de órdenes de trabajo

App web para registrar las **órdenes de trabajo (OT)** de Mantenciones OSC desde el celular.
La fuente de verdad es una **planilla de Google Sheets** y el backend es **Apps Script**.

**Versión 1.1 (esta versión):** OT con bitácora de gestión de compras (ítems + tiempo) y mano de obra, clientes con solicitantes y ubicaciones, y configuración de HH, IVA, recargo, categorías con factor y datos de la empresa.

**Próximas etapas:** fotos y PDF de cotización (etapa 2). Asignación de OC, folio SII y resumen por cliente (etapa 3).

---

## Cálculo

Cada OT tiene dos bloques:

**🛒 Gestión de compras** (uno por OT)
- *Ítems de compra*: tipo (Material, Insumo, Arriendo de herramienta, Flete / transporte, Combustible… editable en Config) · cantidad × costo unitario × (1 + % recargo compras). Si un ítem se marca como **descartado**, queda anotado pero no suma.
- *Tiempo de gestión*: horas × HH base × factor de la categoría "Gestión de compras". Mínimo 1 h, de media en media.

**🛠 Mano de obra**: horas × HH base × factor de la categoría de oficio.

**Totales**: Neto = suma de lo incluido · IVA = Neto × IVA % · Total = Neto + IVA.

Cada línea guarda el HH, el factor y el recargo vigentes cuando se creó. Por eso, si cambias Config, las OT antiguas no se modifican.

**En la cotización** (etapa 2), la gestión de compras aparece como una sola línea, *"Gestión de compras y materiales"*, salvo los tipos que marques con "Detallar" en cada OT.

---

## Instalación (una sola vez, con la cuenta de Google de Mantenciones)

### 1. Planilla y Apps Script
1. Inicia sesión en Google con la cuenta de Mantenciones y crea una planilla nueva, por ejemplo **"OSC — Base de datos"**.
2. En la planilla, abre **Extensiones → Apps Script**.
3. Borra el contenido de `Código.gs` y pega el contenido de **`apps-script/Code.gs`**. Guarda con el ícono 💾.
4. Arriba, en el selector de funciones, elige **`setup`** y presiona **Ejecutar**.
   - Google pedirá permisos: *Revisar permisos → elige la cuenta → Configuración avanzada → Ir a (proyecto) → Permitir*.
5. Abre **Registro de ejecución** y copia el **TOKEN** que aparece (12 caracteres).
   - En la planilla ya quedaron creadas todas las hojas, las 6 categorías y el cliente UdeC.
6. Presiona **Implementar → Nueva implementación** y elige el tipo **Aplicación web**.
   - *Ejecutar como:* **Yo**
   - *Quién tiene acceso:* **Cualquier usuario**
   - Presiona **Implementar** y copia la **URL** (termina en `/exec`).

> Si después modificas `Code.gs`, entra a **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar**. Así la URL no cambia.

### 2. GitHub Pages
1. Crea la cuenta de GitHub con el correo de Mantenciones, por ejemplo `mantencionesosc`.
2. Crea un repositorio **público** llamado, por ejemplo, `osc-app`.
3. Sube **todos** los archivos de esta carpeta con *Add file → Upload files*, manteniendo la carpeta `img/`.
4. Entra a **Settings → Pages → Branch: `main` / root → Save**.
5. En 1 o 2 minutos la app queda en `https://mantencionesosc.github.io/osc-app/`.

### 3. Conectar la app
1. Abre la app en el celular y entra a **⚙️ Config**.
2. Pega la **URL** y el **TOKEN**, y presiona **Conectar y probar**.
3. Configura el **valor HH**, el **recargo de materiales** y el **factor de cada categoría**.
4. Completa los **datos de la empresa** y los del cliente (RUT, dirección, etc.).
5. En el celular, usa *Compartir → Agregar a pantalla de inicio* para dejar la app como ícono.

Tu hermano hace lo mismo en su teléfono, con la misma URL y el mismo token.

---

## Actualizar a una versión nueva
1. En Apps Script, reemplaza todo el contenido de `Código.gs` por el nuevo `apps-script/Code.gs` y guarda.
2. Ejecuta **`setup`** otra vez. No borra datos: solo agrega las hojas o columnas nuevas.
3. **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar.** La URL no cambia.
4. En GitHub, sube los archivos nuevos encima de los anteriores (*Add file → Upload files → Commit changes*).
5. En el celular, abre la app y recarga. Si se ve la versión anterior, cierra y vuelve a abrir la pestaña.

## Seguridad
- El token protege la API: sin él nadie puede leer ni escribir en la planilla.
- El token **no** está en el código ni en GitHub. Se guarda solo en cada teléfono.
- Si el token se filtra, ejecuta `regenerarToken` en Apps Script y pega el nuevo en la app.

## Modo demo
En Config, **"Probar en modo demo"** carga datos de ejemplo guardados solo en ese navegador. Sirve para probar sin conectar la planilla. Los datos de la demo nunca llegan a Google Sheets.

## Archivos
```
index.html          estructura de la app
styles.css          estilos (paleta tierra)
app.js              lógica de la app
demo.js             backend simulado para el modo demo
manifest.json       ícono y nombre al agregar a pantalla de inicio
img/                logo e íconos
apps-script/Code.gs backend (se pega en Apps Script, no lo usa GitHub Pages)
```

## Hojas de la planilla
`Config` · `Categorias` · `TiposItem` · `Clientes` · `Solicitantes` · `Ubicaciones` · `OT` · `OT_Lineas`. También quedan creadas, para las próximas etapas, `Fotos` · `Cotizaciones` · `OrdenesCompra` · `Facturas`.

No cambies el orden de las columnas ni los nombres de las hojas. Sí puedes agregar filtros y formatos, y mirar los datos cuando quieras.
