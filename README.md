# Mantenciones OSC — App de órdenes de trabajo

App web para registrar las **órdenes de trabajo (OT)** de Mantenciones OSC desde el celular.
La fuente de verdad es una **planilla de Google Sheets** y el backend es **Apps Script**.

**Versión 3.1.1 (esta versión):** OT con bitácora de gestión de compras (ítems + tiempo) y mano de obra, fotos (antes / durante / después) y cotización en PDF, clientes con solicitantes y ubicaciones, y configuración de valor hora por categoría, recargo general, IVA y datos de la empresa.

**Incluye también (v3.0):** órdenes de compra, facturación con folio SII, registro de pagos y panel de ventas.

---

## Cálculo

Cada OT tiene dos bloques:

**🛒 Gestión de compras** (uno por OT)
- *Ítems de compra*: tipo (Material, Insumo, Arriendo de herramienta, Flete / transporte, Combustible… editable en Config) · cantidad × costo unitario, **al costo**. Si un ítem se marca como **descartado**, queda anotado pero no suma.
- *Tiempo de gestión*: horas × valor hora de la categoría "Gestión de compras". Mínimo 1 h, de media en media.

**🛠 Mano de obra**, en dos modos:
- *Por horas*: horas × valor hora de la categoría de oficio.
- *Por cantidad*: cantidad × precio unitario (ej: 81,6 m² × $8.000). El precio sale del **Tarifario** (Config) o se escribe a mano, y queda congelado en la línea. Las unidades (m², m lineal, pulgada, unidad, punto…) se editan en Config.

**Totales**
- Subtotal (costo) = suma de lo incluido
- Recargo general (por defecto 30%, en Config) = Subtotal × %
- Neto = Subtotal + Recargo · IVA = Neto × 19% · Total = Neto + IVA

En la **cotización** el recargo no aparece como línea: se reparte proporcionalmente en cada monto, y la suma coincide exactamente con el neto.

Cada línea guarda el valor hora vigente cuando se creó y cada OT guarda el % de recargo con que se creó. Si cambias Config, las OT antiguas no se modifican.

**En la cotización**, la gestión de compras aparece como una sola línea, *"Gestión de compras y materiales"*, salvo los tipos que marques con "Detallar" en cada OT.

## Fotos y cotizaciones
- Las fotos se achican en el teléfono (máx. 1600 px) y se guardan en Google Drive, en **Mantenciones OSC — Archivos / OT-0001 / …**
- Cada cotización generada se guarda en PDF en la misma carpeta de la OT y queda registrada en la hoja `Cotizaciones`, como v1, v2…
- **Por defecto la cotización es resumida:** una sola fila con lo que pidió el cliente, el detalle del pedido y el valor neto; después, IVA y total.
- Al generarla puedes marcar **"Mostrar gestión de compras"** (lista lo comprado; se puede ocultar por tipo) y **"Mostrar mano de obra"** (cada proceso, o agrupada por categoría). Lo que no marques queda en una línea resumida.
- El recargo general nunca aparece como línea: se reparte en los montos.
- **Numeración:** todas las cotizaciones usan un solo correlativo, **COT-AAAA-NNN** (por ejemplo, COT-2026-001), con versiones v1, v2… Las generadas antes de la versión 2.3 conservan su número (OT-0001 v1).
- **Varias OT en una cotización:** en la lista de OT, *☑ Seleccionar para cotizar juntas* → marca las OT (mismo cliente) → *Cotizar juntas*. La app avisa si las OT tienen solicitantes o edificios distintos. Cada OT aparece con su título, detalle y valor; las fotos vienen desmarcadas por defecto.
- **Atención:** al generar se elige una persona, que va en el encabezado.
- **Sección 📄 Cotizaciones:** lista todas las cotizaciones (última versión de cada una) con filtros por estado y buscador. Al tocar una se ven sus OT, el historial de versiones con los PDF y los botones para generar una nueva versión, aprobar o descartar. En la cotización múltiple, cada OT muestra su fecha.
- **Estados:** *Vigente* (la última), *Reemplazada* (automático al generar una versión nueva), *Descartada* y *Aprobada* (manuales, tocando la cotización en la OT).
- Los valores por defecto de estas casillas y las condiciones se configuran en Config → Cotizaciones. La firma y los datos del emisor salen de Config → Datos de la empresa.

## OC, facturación y pagos (v3.0)
- **Asignar OC:** Cotizaciones → abrir una COT vigente → *🧾 Asignar OC*. Se ingresa N° de OC, fecha, neto, IVA y total (vienen con los montos de la cotización y la app avisa si no cuadran). Se puede adjuntar el PDF o una foto de la OC (queda en Drive, carpeta *Órdenes de compra*). Si la OC cubre varias cotizaciones del mismo cliente, se marcan ahí. La COT queda **Aprobada** y todas sus OT quedan con el N° de OC.
- **Facturar:** Facturación → *Por facturar* → marcar una o varias OC del mismo cliente → *📋 Copiar datos* (texto para el portal del SII) → emitir la factura en el SII → *🧾 Registrar folio*. Las OT de esas OC quedan **facturadas y en solo lectura**.
- **Pagos:** Facturación → *Facturas* → tocar una factura → fecha de pago y referencia → *Registrar pago*.
- **OT cerradas:** una OT con OC asignada (o facturada) queda bloqueada: no se edita, no se le suben fotos y no se vuelve a cotizar. Se muestra como un informe de solo lectura con sus documentos (cotización, OC, factura y pago), compras, mano de obra y resumen. Su cotización también queda cerrada (sin nuevas versiones ni cambios de estado).
- **Corregir errores:** una OC sin factura se puede quitar desde su detalle; una factura pendiente se puede quitar del registro (no la anula en el SII).
- **Panel (Resumen):** por semana, mes, mes anterior, año o fechas a elección, y por cliente: facturado (neto, IVA, total), IVA del periodo (débito), cobrado, por cobrar, OT del periodo, lo que va en camino (cotizado sin OC y con OC sin factura), gráfico de facturado por mes y por categoría, y un PDF de resumen.
  - *Facturado* se cuenta por la fecha de la factura; *OT del periodo*, por la fecha de la OT; *Cobrado*, por la fecha de pago.
  - *Por categoría* reparte el neto de las OT facturadas en sus categorías (cada oficio, gestión de compras, materiales y compras), con el recargo incluido.

## Instalación (una sola vez, con la cuenta de Google de Mantenciones)

### 1. Planilla y Apps Script
1. Inicia sesión en Google con la cuenta de Mantenciones y crea una planilla nueva, por ejemplo **"OSC — Base de datos"**.
2. En la planilla, abre **Extensiones → Apps Script**.
3. Borra el contenido de `Código.gs` y pega el contenido de **`apps-script/Code.gs`**. Guarda con el ícono 💾.
4. En **⚙️ Configuración del proyecto**, activa *"Mostrar el archivo de manifiesto appsscript.json"*. Luego, en el editor, reemplaza el contenido de `appsscript.json` por el de **`apps-script/appsscript.json`**. Ese archivo declara los permisos de Sheets y Drive; sin él, Google puede no pedir el permiso de Drive.
5. Arriba, en el selector de funciones, elige **`setup`** y presiona **Ejecutar**.
   - Google pedirá permisos: *Revisar permisos → elige la cuenta → Configuración avanzada → Ir a (proyecto) → Permitir*.
6. Abre **Registro de ejecución** y copia el **TOKEN** que aparece (12 caracteres).
   - En la planilla ya quedaron creadas todas las hojas, las 6 categorías y el cliente UdeC.
7. Presiona **Implementar → Nueva implementación** y elige el tipo **Aplicación web**.
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
2. Ejecuta **`setup`** otra vez. No borra datos: solo agrega las hojas, columnas o claves nuevas. Si Google pide permisos nuevos (por ejemplo, Drive en la versión 2.0), acéptalos igual que la primera vez.
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
cotizacion.js       arma el PDF de la cotización
lib/jspdf.umd.min.js librería para generar PDF (incluida, no depende de internet)
manifest.json       ícono y nombre al agregar a pantalla de inicio
img/                logo e íconos
apps-script/Code.gs backend (se pega en Apps Script, no lo usa GitHub Pages)
```

## Hojas de la planilla
`Config` · `Categorias` · `TiposItem` · `Clientes` · `Solicitantes` · `Ubicaciones` · `OT` · `OT_Lineas`. También quedan creadas, para las próximas etapas, `Fotos` · `Cotizaciones` · `OrdenesCompra` · `Facturas`.

No cambies el orden de las columnas ni los nombres de las hojas. Sí puedes agregar filtros y formatos, y mirar los datos cuando quieras.
