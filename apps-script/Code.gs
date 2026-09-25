/**
 * Mantenciones OSC — Backend (Google Apps Script)
 * ------------------------------------------------
 * La planilla de Google Sheets es la fuente de verdad.
 * Este script expone una API (Web App) que la app web llama con POST.
 *
 * Instalación (resumen, ver README):
 *   1. Pegar este archivo en Extensiones → Apps Script de la planilla.
 *   2. Ejecutar la función `setup` una vez (crea hojas y muestra el TOKEN en el registro).
 *   3. Implementar → Nueva implementación → Aplicación web
 *      (Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario).
 */

const VERSION = '3.1.1';
const ESTADOS_COT = ['Vigente', 'Reemplazada', 'Descartada', 'Aprobada'];

// ════════════════════════════════════════════════════════════ ESQUEMA
// Cada hoja: lista de [claveJS, encabezadoEnLaHoja]. El orden define las columnas.
const SCHEMA = {
  Config: [
    ['clave', 'Clave'], ['valor', 'Valor'], ['descripcion', 'Descripción']
  ],
  Categorias: [
    ['id', 'ID'], ['nombre', 'Nombre'], ['factor', 'Factor'], ['orden', 'Orden'], ['activa', 'Activa'],
    ['uso', 'Uso'],  // 'Gestión' (tiempo de gestión de compras) u 'Oficio' (mano de obra)
    ['valorHora', 'Valor hora']  // CLP neto por hora (desde v2.1; la columna Factor ya no se usa)
  ],
  TiposItem: [
    ['id', 'ID'], ['nombre', 'Nombre'], ['orden', 'Orden'], ['activo', 'Activo']
  ],
  // desde v3.1: trabajos cobrados por cantidad (m², metro lineal, pulgada…)
  Unidades: [
    ['id', 'ID'], ['nombre', 'Unidad'], ['orden', 'Orden'], ['activo', 'Activo']
  ],
  Tarifario: [
    ['id', 'ID'], ['nombre', 'Servicio'], ['categoriaId', 'Categoría ID'], ['unidad', 'Unidad'],
    ['precio', 'Precio unitario'], ['orden', 'Orden'], ['activo', 'Activo']
  ],
  Clientes: [
    ['id', 'ID'], ['razonSocial', 'Razón social'], ['nombreCorto', 'Nombre corto'], ['rut', 'RUT'],
    ['giro', 'Giro'], ['direccion', 'Dirección'], ['comuna', 'Comuna'], ['contacto', 'Contacto'],
    ['correo', 'Correo'], ['telefono', 'Teléfono'], ['activo', 'Activo']
  ],
  Solicitantes: [
    ['id', 'ID'], ['clienteId', 'Cliente ID'], ['nombre', 'Nombre'], ['cargo', 'Cargo'],
    ['unidad', 'Unidad / Depto.'], ['correo', 'Correo'], ['telefono', 'Teléfono'], ['activo', 'Activo']
  ],
  Ubicaciones: [
    ['id', 'ID'], ['clienteId', 'Cliente ID'], ['edificio', 'Edificio'], ['detalle', 'Detalle / Sector'],
    ['activo', 'Activo']
  ],
  OT: [
    ['nOT', 'N° OT'], ['fechaInicio', 'Fecha inicio'],
    ['clienteId', 'Cliente ID'], ['cliente', 'Cliente'],
    ['solicitanteId', 'Solicitante ID'], ['solicitante', 'Solicitante'],
    ['ubicacionId', 'Ubicación ID'], ['ubicacion', 'Ubicación'],
    ['titulo', 'Título'], ['descripcion', 'Descripción'], ['estado', 'Estado'],
    ['nOC', 'N° OC'], ['folioSII', 'Folio SII'],
    ['neto', 'Neto'], ['ivaPct', 'IVA %'], ['iva', 'IVA'], ['total', 'Total'],
    ['notas', 'Notas'], ['creada', 'Creada'], ['actualizada', 'Actualizada'],
    ['detallar', 'Detallar en cotización'],  // IDs de tipos de ítem a desglosar, separados por coma
    ['subtotal', 'Subtotal (costo)'], ['recargoPct', 'Recargo %'], ['recargo', 'Recargo']  // neto = subtotal + recargo
  ],
  OT_Lineas: [
    ['id', 'ID'], ['nOT', 'N° OT'], ['orden', 'Orden'], ['fecha', 'Fecha'], ['tipo', 'Tipo'],
    ['categoriaId', 'Categoría ID'], ['categoria', 'Categoría'], ['descripcion', 'Descripción'],
    ['horas', 'Horas'], ['hh', 'HH aplicado'], ['factor', 'Factor aplicado'],
    ['cantidad', 'Cantidad'], ['costoUnit', 'Costo unitario'], ['recargoPct', '% Recargo'],
    ['monto', 'Monto'], ['incluida', 'Incluida'],
    ['tipoItemId', 'Tipo de ítem ID'], ['tipoItem', 'Tipo de ítem'],
    // desde v3.1: mano de obra por cantidad
    ['modo', 'Modo (Horas/Cantidad)'], ['unidad', 'Unidad'], ['precioUnit', 'Precio unitario'], ['tarifaId', 'Tarifa ID']
  ],
  Fotos: [
    ['id', 'ID'], ['nOT', 'N° OT'], ['fecha', 'Fecha'], ['etapa', 'Etapa'], ['descripcion', 'Descripción'],
    ['fileId', 'Archivo Drive ID'], ['url', 'URL'], ['enPresupuesto', 'Mostrar en cotización']
  ],
  Cotizaciones: [
    ['id', 'ID'], ['nOT', 'N° OT'], ['version', 'Versión'], ['fecha', 'Fecha'],
    ['neto', 'Neto'], ['total', 'Total'], ['pdfUrl', 'PDF (Drive)'], ['fileId', 'Archivo Drive ID'],
    // desde v2.3: correlativo COT-AAAA-NNN, una o varias OT, estado
    ['numero', 'N° cotización'], ['ots', 'OT incluidas'], ['estado', 'Estado'],
    ['clienteId', 'Cliente ID'], ['solicitanteId', 'Atención (solicitante ID)'], ['iva', 'IVA']
  ],
  // Hojas de la etapa 3 (se crean ahora para dejar la estructura lista)
  OrdenesCompra: [
    ['nOC', 'N° OC'], ['fecha', 'Fecha'], ['clienteId', 'Cliente ID'], ['monto', 'Total (bruto)'], ['notas', 'Notas'],
    // desde v3.0
    ['neto', 'Neto'], ['iva', 'IVA'], ['cots', 'Cotizaciones (ID)'], ['ots', 'OT incluidas'],
    ['archivoUrl', 'Documento OC (Drive)'], ['archivoId', 'Documento Drive ID'], ['folio', 'Folio factura'], ['creada', 'Registrada']
  ],
  Facturas: [
    ['folio', 'Folio SII'], ['fecha', 'Fecha'], ['clienteId', 'Cliente ID'], ['nOC', 'N° OC'],
    ['neto', 'Neto'], ['iva', 'IVA'], ['total', 'Total'], ['estadoPago', 'Estado de pago'],
    // desde v3.0
    ['ots', 'OT incluidas'], ['fechaPago', 'Fecha de pago'], ['refPago', 'Referencia de pago'], ['notas', 'Notas'], ['creada', 'Registrada']
  ]
};

const TEXT_COLS = {
  Config: ['valor'],
  Clientes: ['rut', 'telefono'],
  Solicitantes: ['telefono'],
  OT: ['nOC', 'folioSII'],
  OrdenesCompra: ['nOC', 'cots', 'ots', 'folio'],
  Facturas: ['folio', 'nOC', 'ots', 'refPago'],
  Cotizaciones: ['ots', 'numero']  // "3,4" no debe convertirse en el número 3,4
};

const CONFIG_DEFAULTS = [
  ['HH_BASE', 0, '(Ya no se usa desde v2.1: cada categoría tiene su valor hora)'],
  ['IVA_PCT', 19, 'IVA en %'],
  ['RECARGO_MATERIALES_PCT', 30, 'Recargo general en %: se aplica sobre el neto de cada OT y se reparte en las líneas de la cotización'],
  ['EMPRESA_NOMBRE', 'Mantenciones OSC', 'Nombre de fantasía'],
  ['EMPRESA_RAZON_SOCIAL', '', 'Razón social (como aparece en el SII)'],
  ['EMPRESA_RUT', '', 'RUT de la empresa'],
  ['EMPRESA_GIRO', '', 'Giro'],
  ['EMPRESA_DIRECCION', '', 'Dirección'],
  ['EMPRESA_TELEFONO', '', 'Teléfono'],
  ['EMPRESA_CORREO', '', 'Correo'],
  ['EMPRESA_FIRMA', '', 'Nombre de quien firma las cotizaciones'],
  ['COT_CONDICIONES', '', 'Texto de condiciones para el pie de la cotización (validez, forma de pago…)'],
  ['COT_INCLUIR_CONDICIONES', 'NO', 'SI/NO: valor por defecto de "Incluir condiciones" al generar una cotización'],
  ['COT_MO_AGRUPADA', 'NO', 'SI/NO: valor por defecto de "Mano de obra agrupada por categoría"'],
  ['COT_DETALLE_COMPRAS', 'NO', 'SI/NO: valor por defecto de "Mostrar gestión de compras" (NO = cotización resumida)'],
  ['COT_DETALLE_MO', 'NO', 'SI/NO: valor por defecto de "Mostrar mano de obra" (NO = cotización resumida)'],
  ['COT_MOSTRAR_CANTIDAD', 'SI', 'SI/NO: al mostrar la mano de obra, indicar la cantidad de los trabajos por cantidad (ej: 81,6 m²)']
];

const ETAPAS_FOTO = ['Antes', 'Durante', 'Después'];

const CATEGORIAS_DEFAULT = [
  'Gestión de compras', 'Mantenciones (varios)', 'Electricidad', 'Mueblería', 'Carpintería', 'Gasfitería'
];
const TIPOS_ITEM_DEFAULT = ['Material', 'Insumo', 'Arriendo de herramienta', 'Flete / transporte', 'Combustible'];
const UNIDADES_DEFAULT = ['m²', 'm lineal', 'pulgada', 'unidad', 'punto'];
const TIPOS_LINEA = ['Compra', 'Tiempo de gestión', 'Mano de obra'];

const ESTADOS_OT = ['Pendiente', 'En curso', 'Terminada', 'Anulada'];
const TZ = 'America/Santiago';

// ════════════════════════════════════════════════════════════ SETUP
/** Ejecutar UNA vez desde el editor. Es seguro volver a ejecutarla: no borra datos. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SCHEMA[name].map(function (c) { return c[1]; });
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Columnas de texto (para no perder ceros a la izquierda en folios, OC, RUT, teléfonos)
    (TEXT_COLS[name] || []).forEach(function (key) {
      const idx = SCHEMA[name].findIndex(function (c) { return c[0] === key; });
      if (idx !== -1) sh.getRange(2, idx + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  });

  // Config por defecto (solo agrega claves que falten)
  const cfgSh = ss.getSheetByName('Config');
  const existentes = readTable_('Config').map(function (r) { return r.clave; });
  CONFIG_DEFAULTS.forEach(function (d) {
    if (existentes.indexOf(d[0]) === -1) cfgSh.appendRow(d);
  });

  // Categorías por defecto (valor hora en 0: ajústalo en la app → Config)
  if (readTable_('Categorias').length === 0) {
    const catSh = ss.getSheetByName('Categorias');
    CATEGORIAS_DEFAULT.forEach(function (n, i) {
      catSh.appendRow(['CAT-' + (i + 1), n, 1, i + 1, true, i === 0 ? 'Gestión' : 'Oficio', 0]);
    });
  } else {
    // Migración: completa la columna Uso en categorías antiguas
    const catSh = ss.getSheetByName('Categorias');
    const usoCol = SCHEMA.Categorias.findIndex(function (c) { return c[0] === 'uso'; }) + 1;
    readTable_('Categorias').forEach(function (c, i) {
      if (!c.uso) catSh.getRange(i + 2, usoCol).setValue(normTxt_(c.nombre) === 'gestion de compras' ? 'Gestión' : 'Oficio');
    });
  }

  // Migración v2.1: valor hora por categoría = HH base × factor (si está vacío)
  {
    const catSh = ss.getSheetByName('Categorias');
    const vhCol = SCHEMA.Categorias.findIndex(function (c) { return c[0] === 'valorHora'; }) + 1;
    const hhBase = num_(configObj_().HH_BASE);
    readTable_('Categorias').forEach(function (c, i) {
      if (c.valorHora === '' || c.valorHora == null) catSh.getRange(i + 2, vhCol).setValue(Math.round(hhBase * (num_(c.factor) || 1)));
    });
  }

  // Unidades por defecto (v3.1)
  if (readTable_('Unidades').length === 0) {
    const uSh = ss.getSheetByName('Unidades');
    UNIDADES_DEFAULT.forEach(function (n, i) { uSh.appendRow(['UNI-' + (i + 1), n, i + 1, true]); });
  }

  // Tipos de ítem de compra por defecto
  if (readTable_('TiposItem').length === 0) {
    const tSh = ss.getSheetByName('TiposItem');
    TIPOS_ITEM_DEFAULT.forEach(function (n, i) { tSh.appendRow(['TIP-' + (i + 1), n, i + 1, true]); });
  }

  // Actualiza descripciones de Config
  const cfgRows = readTable_('Config');
  CONFIG_DEFAULTS.forEach(function (d) {
    const idx = cfgRows.findIndex(function (r) { return r.clave === d[0]; });
    if (idx !== -1) cfgSh.getRange(idx + 2, 3).setValue(d[2]);
  });

  // Cliente inicial
  if (readTable_('Clientes').length === 0) {
    ss.getSheetByName('Clientes').appendRow(
      ['CLI-1', 'Universidad de Concepción', 'UdeC', '', '', '', 'Concepción', '', '', '', true]);
  }

  // Hoja1 vacía que crea Google por defecto
  const h1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Hoja1') || ss.getSheetByName('Sheet1');
  if (h1 && ss.getSheets().length > 1 && h1.getLastRow() === 0) ss.deleteSheet(h1);

  // Token de acceso (se guarda en Propiedades del script, no en la planilla)
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    props.setProperty('TOKEN', token);
  }
  // Carpeta de Drive para fotos y cotizaciones (aquí Google pide el permiso de Drive)
  const carpeta = carpetaRaiz_();
  Logger.log('📁 Carpeta de archivos en Drive: ' + carpeta.getName());
  Logger.log('✅ Planilla lista. TOKEN de acceso para la app: ' + token);
  return token;
}

/** Si necesitas un token nuevo (por ejemplo, si se filtró), ejecuta esta función. */
function regenerarToken() {
  const token = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  Logger.log('🔑 Nuevo TOKEN: ' + token + ' (actualízalo en la app → Config)');
  return token;
}

/** Prueba directa de Drive, sin mensajes propios: sirve para ver el error original de Google. */
function probarDrive() {
  const f = DriveApp.createFolder('Prueba OSC (se borra sola)');
  Logger.log('✅ Drive funciona: ' + f.getUrl());
  f.setTrashed(true);
}

// ════════════════════════════════════════════════════════════ API
function doGet() {
  return json_({ ok: true, app: 'Mantenciones OSC', msg: 'API activa. Usa POST.' });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || req.token !== token) return json_({ error: 'Token inválido. Revisa Config en la app.' });

    const fn = ACTIONS[req.action];
    if (!fn) return json_({ error: 'Acción desconocida: ' + req.action });

    // Idempotencia: si Google no entregó la respuesta y la app reintenta la misma petición (mismo reqId),
    // se devuelve el resultado ya calculado en vez de volver a escribir (evita OT o fotos duplicadas).
    const cache = CacheService.getScriptCache();
    if (req.reqId) {
      const previo = cache.get('req_' + req.reqId);
      if (previo) return ContentService.createTextOutput(previo).setMimeType(ContentService.MimeType.JSON);
    }
    const out = JSON.stringify(fn(req));
    if (req.reqId && out.length < 90000) { try { cache.put('req_' + req.reqId, out, 600); } catch (e) { /* sin caché */ } }
    return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

const ACTIONS = {
  ping: function () { return { ok: true, hora: now_(), version: VERSION }; },
  getAll: getAll_,
  saveConfig: function (r) { return withLock_(function () { return saveConfig_(r.values || {}); }); },
  saveCategoria: function (r) { return withLock_(function () { return saveCategoria_(r.item); }); },
  saveTipoItem: function (r) { return withLock_(function () { return saveTipoItem_(r.item); }); },
  // Guardado en lote: una sola petición para varias filas
  saveCategorias: function (r) { return withLock_(function () { return { items: (r.items || []).map(saveCategoria_) }; }); },
  saveTiposItem: function (r) { return withLock_(function () { return { items: (r.items || []).map(saveTipoItem_) }; }); },
  saveUnidades: function (r) { return withLock_(function () { return { items: (r.items || []).map(saveUnidad_) }; }); },
  saveTarifario: function (r) { return withLock_(function () { return { items: (r.items || []).map(saveTarifa_) }; }); },
  saveCliente: function (r) { return withLock_(function () { return saveSimple_('Clientes', 'CLI', r.item, validarCliente_); }); },
  saveSolicitante: function (r) { return withLock_(function () { return saveSimple_('Solicitantes', 'SOL', r.item, validarSolicitante_); }); },
  saveUbicacion: function (r) { return withLock_(function () { return saveSimple_('Ubicaciones', 'UBI', r.item, validarUbicacion_); }); },
  saveOT: function (r) { return withLock_(function () { return saveOT_(r.ot, r.lineas || []); }); },
  getFotos: function (r) { return getFotos_(r.nOT); },
  uploadFoto: function (r) { return withLock_(function () { return uploadFoto_(r); }); },
  updateFoto: function (r) { return withLock_(function () { return updateFoto_(r.item); }); },
  deleteFoto: function (r) { return withLock_(function () { return deleteFoto_(r.id); }); },
  saveCotizacion: function (r) { return withLock_(function () { return saveCotizacion_(r); }); },
  setEstadoCotizacion: function (r) { return withLock_(function () { return setEstadoCotizacion_(r.id, r.estado); }); },
  saveOC: function (r) { return withLock_(function () { return saveOC_(r); }); },
  deleteOC: function (r) { return withLock_(function () { return deleteOC_(r.nOC); }); },
  saveFactura: function (r) { return withLock_(function () { return saveFactura_(r); }); },
  deleteFactura: function (r) { return withLock_(function () { return deleteFactura_(r.folio); }); },
  setPago: function (r) { return withLock_(function () { return setPago_(r); }); }
};

function getAll_() {
  return {
    version: VERSION,
    config: configObj_(),
    categorias: readTable_('Categorias'),
    tiposItem: readTable_('TiposItem'),
    unidades: readTable_('Unidades'),
    tarifario: readTable_('Tarifario'),
    clientes: readTable_('Clientes'),
    solicitantes: readTable_('Solicitantes'),
    ubicaciones: readTable_('Ubicaciones'),
    ots: readTable_('OT'),
    lineas: readTable_('OT_Lineas'),
    fotos: readTable_('Fotos'),
    cotizaciones: readTable_('Cotizaciones'),
    ordenesCompra: readTable_('OrdenesCompra'),
    facturas: readTable_('Facturas')
  };
}

// ════════════════════════════════════════════════════════════ CONFIG / CATÁLOGOS
function configObj_() {
  const o = {};
  readTable_('Config').forEach(function (r) { if (r.clave) o[r.clave] = r.valor; });
  return o;
}

function saveConfig_(values) {
  const sh = sheet_('Config');
  const rows = readTable_('Config');
  const numericas = ['HH_BASE', 'IVA_PCT', 'RECARGO_MATERIALES_PCT'];
  Object.keys(values).forEach(function (k) {
    if (!/^[A-Z_]+$/.test(k)) throw new Error('Clave inválida: ' + k);
    let v = values[k];
    if (numericas.indexOf(k) !== -1) {
      v = num_(v);
      if (v < 0) throw new Error(k + ' no puede ser negativo');
    } else {
      v = String(v == null ? '' : v).trim();
    }
    const idx = rows.findIndex(function (r) { return r.clave === k; });
    if (idx === -1) sh.appendRow([k, v, '']);
    else sh.getRange(idx + 2, 2).setValue(v);
  });
  return { config: configObj_() };
}

function saveCategoria_(item) {
  if (!item) throw new Error('Falta la categoría');
  const nombre = String(item.nombre || '').trim();
  if (!nombre) throw new Error('La categoría necesita un nombre');
  const valorHora = Math.round(num_(item.valorHora));
  if (!(valorHora > 0)) throw new Error('El valor hora de "' + nombre + '" debe ser mayor que 0');
  const rows = readTable_('Categorias');
  const prev = item.id ? rows.find(function (c) { return c.id === item.id; }) : null;
  const obj = {
    id: item.id || nextId_('CAT', rows, 'id'),
    nombre: nombre,
    factor: prev && prev.factor !== '' ? prev.factor : 1,
    valorHora: valorHora,
    orden: item.orden != null && item.orden !== '' ? num_(item.orden) : rows.length + 1,
    activa: item.activa !== false,
    uso: prev && prev.uso ? prev.uso : 'Oficio'  // el uso no se cambia desde la app
  };
  if (obj.uso === 'Gestión' && !obj.activa) throw new Error('La categoría de gestión de compras no se puede desactivar');
  upsert_('Categorias', 'id', obj);
  return { item: obj };
}

function saveTipoItem_(item) {
  if (!item) throw new Error('Falta el tipo de ítem');
  const nombre = String(item.nombre || '').trim();
  if (!nombre) throw new Error('El tipo de ítem necesita un nombre');
  const rows = readTable_('TiposItem');
  const obj = {
    id: item.id || nextId_('TIP', rows, 'id'),
    nombre: nombre,
    orden: item.orden != null && item.orden !== '' ? num_(item.orden) : rows.length + 1,
    activo: item.activo !== false
  };
  upsert_('TiposItem', 'id', obj);
  return { item: obj };
}

function saveUnidad_(item) {
  const nombre = String(item && item.nombre || '').trim();
  if (!nombre) throw new Error('La unidad necesita un nombre');
  const rows = readTable_('Unidades');
  const obj = { id: item.id || nextId_('UNI', rows, 'id'), nombre: nombre, orden: item.orden != null && item.orden !== '' ? num_(item.orden) : rows.length + 1, activo: item.activo !== false };
  upsert_('Unidades', 'id', obj);
  return obj;
}

function saveTarifa_(item) {
  const nombre = String(item && item.nombre || '').trim();
  if (!nombre) throw new Error('El servicio del tarifario necesita un nombre');
  const cat = readTable_('Categorias').find(function (c) { return c.id === item.categoriaId; });
  if (!cat || cat.uso === 'Gestión') throw new Error('"' + nombre + '" necesita una categoría de oficio');
  const unidad = String(item.unidad || '').trim();
  if (!unidad) throw new Error('"' + nombre + '" necesita una unidad');
  const precio = Math.round(num_(item.precio));
  if (!(precio > 0)) throw new Error('El precio de "' + nombre + '" debe ser mayor que 0');
  const rows = readTable_('Tarifario');
  const obj = { id: item.id || nextId_('TAR', rows, 'id'), nombre: nombre, categoriaId: cat.id, unidad: unidad, precio: precio,
    orden: item.orden != null && item.orden !== '' ? num_(item.orden) : rows.length + 1, activo: item.activo !== false };
  upsert_('Tarifario', 'id', obj);
  return obj;
}

function validarCliente_(o) {
  o.razonSocial = String(o.razonSocial || '').trim();
  if (!o.razonSocial) throw new Error('El cliente necesita razón social');
}
function validarSolicitante_(o) {
  o.nombre = String(o.nombre || '').trim();
  if (!o.nombre) throw new Error('El solicitante necesita nombre');
  if (!o.clienteId) throw new Error('El solicitante debe pertenecer a un cliente');
}
function validarUbicacion_(o) {
  o.edificio = String(o.edificio || '').trim();
  if (!o.edificio) throw new Error('La ubicación necesita el nombre del edificio');
  if (!o.clienteId) throw new Error('La ubicación debe pertenecer a un cliente');
}

function saveSimple_(sheetName, prefix, item, validar) {
  if (!item) throw new Error('Faltan datos');
  const cols = SCHEMA[sheetName].map(function (c) { return c[0]; });
  const obj = {};
  cols.forEach(function (k) { obj[k] = item[k] == null ? '' : item[k]; });
  obj.activo = item.activo !== false;
  validar(obj);
  if (!obj.id) obj.id = nextId_(prefix, readTable_(sheetName), 'id');
  upsert_(sheetName, 'id', obj);
  return { item: obj };
}

// ════════════════════════════════════════════════════════════ OT
function saveOT_(ot, lineas) {
  if (!ot) throw new Error('Faltan los datos de la OT');
  const ots = readTable_('OT');
  const esNueva = !ot.nOT;
  let previa = null;
  if (!esNueva) {
    previa = ots.find(function (o) { return String(o.nOT) === String(ot.nOT); });
    if (!previa) throw new Error('No existe la OT ' + ot.nOT);
    otCerrada_(previa);
  }

  // Validaciones de cabecera
  const titulo = String(ot.titulo || '').trim();
  if (!titulo) throw new Error('La OT necesita un título (ej: "Cambio de lavamanos")');
  if (!ot.clienteId) throw new Error('Selecciona un cliente');
  const estado = ot.estado || 'Pendiente';
  if (ESTADOS_OT.indexOf(estado) === -1) throw new Error('Estado inválido: ' + estado);

  const clientes = readTable_('Clientes');
  const cli = clientes.find(function (c) { return c.id === ot.clienteId; });
  if (!cli) throw new Error('Cliente no encontrado');
  const sol = ot.solicitanteId ? readTable_('Solicitantes').find(function (s) { return s.id === ot.solicitanteId; }) : null;
  const ubi = ot.ubicacionId ? readTable_('Ubicaciones').find(function (u) { return u.id === ot.ubicacionId; }) : null;

  // Líneas: se recalcula el monto en el servidor con los valores congelados de cada línea
  const cfg = configObj_();
  const cats = readTable_('Categorias');
  const tipos = readTable_('TiposItem');
  const tarifas = readTable_('Tarifario');
  const nOT = esNueva ? nextNumber_(ots, 'nOT') : Number(ot.nOT);
  const hoy = today_();
  const lineasOk = lineas.map(function (l, i) { return normalizarLinea_(l, i, nOT, cfg, cats, tipos, hoy, tarifas); });

  // Subtotal al costo + recargo general (congelado en la OT al crearla) = neto
  const subtotal = lineasOk.reduce(function (s, l) { return s + (l.incluida ? l.monto : 0); }, 0);
  const recargoPct = previa && previa.recargoPct !== '' && previa.recargoPct != null ? num_(previa.recargoPct) : num_(cfg.RECARGO_MATERIALES_PCT);
  const recargo = Math.round(subtotal * recargoPct / 100);
  const neto = subtotal + recargo;
  const ivaPct = previa && previa.ivaPct !== '' && previa.ivaPct != null ? num_(previa.ivaPct) : num_(cfg.IVA_PCT);
  const iva = Math.round(neto * ivaPct / 100);

  const obj = {
    nOT: nOT,
    fechaInicio: ot.fechaInicio || hoy,
    clienteId: cli.id,
    cliente: cli.nombreCorto || cli.razonSocial,
    solicitanteId: sol ? sol.id : '',
    solicitante: sol ? sol.nombre : '',
    ubicacionId: ubi ? ubi.id : '',
    ubicacion: ubi ? (ubi.edificio + (ubi.detalle ? ' — ' + ubi.detalle : '')) : '',
    titulo: titulo,
    descripcion: String(ot.descripcion || ''),
    estado: estado,
    nOC: previa ? previa.nOC : '',
    folioSII: previa ? previa.folioSII : '',
    neto: neto,
    ivaPct: ivaPct,
    iva: iva,
    total: neto + iva,
    notas: String(ot.notas || ''),
    creada: previa ? previa.creada : now_(),
    actualizada: now_(),
    detallar: String(ot.detallar || '').split(',').map(function (x) { return x.trim(); })
      .filter(function (x) { return x && tipos.some(function (t) { return t.id === x; }); }).join(','),
    subtotal: subtotal, recargoPct: recargoPct, recargo: recargo
  };

  upsert_('OT', 'nOT', obj);
  replaceLineas_(nOT, lineasOk);
  return { ot: obj, lineas: lineasOk };
}

function normalizarLinea_(l, i, nOT, cfg, cats, tipos, hoy, tarifas) {
  let tipo = l.tipo === 'Material' ? 'Compra' : l.tipo;  // compatibilidad con la versión anterior
  if (TIPOS_LINEA.indexOf(tipo) === -1) tipo = 'Mano de obra';
  const n = 'La línea ' + (i + 1);
  const desc = String(l.descripcion || '').trim();
  if (!desc) throw new Error(n + ' no tiene descripción');
  const o = {
    id: l.id || ('L-' + nOT + '-' + Utilities.getUuid().slice(0, 8)),
    nOT: nOT, orden: i + 1, fecha: l.fecha || hoy, tipo: tipo,
    categoriaId: '', categoria: '', descripcion: desc,
    horas: '', hh: '', factor: '', cantidad: '', costoUnit: '', recargoPct: '',
    monto: 0, incluida: l.incluida !== false, tipoItemId: '', tipoItem: '',
    modo: '', unidad: '', precioUnit: '', tarifaId: ''
  };
  if (tipo === 'Mano de obra' && l.modo === 'Cantidad') {
    // Trabajo cobrado por cantidad: cantidad × precio unitario (congelado en la línea)
    const tarifa = l.tarifaId ? (tarifas || []).find(function (t) { return t.id === l.tarifaId; }) : null;
    const catC = cats.find(function (c) { return c.id === (l.categoriaId || (tarifa && tarifa.categoriaId)); });
    if (!catC) throw new Error(n + ' necesita una categoría');
    if (catC.uso === 'Gestión') throw new Error(n + ': el tiempo de gestión de compras va en su propio bloque');
    const cant = num_(l.cantidad);
    if (!(cant > 0)) throw new Error(n + ': la cantidad debe ser mayor que 0');
    const unidad = String(l.unidad || (tarifa && tarifa.unidad) || '').trim();
    if (!unidad) throw new Error(n + ': falta la unidad');
    const precio = l.precioUnit !== '' && l.precioUnit != null ? num_(l.precioUnit) : (tarifa ? num_(tarifa.precio) : 0);
    if (!(precio > 0)) throw new Error(n + ': falta el precio unitario');
    o.modo = 'Cantidad'; o.categoriaId = catC.id; o.categoria = catC.nombre;
    o.cantidad = cant; o.unidad = unidad; o.precioUnit = precio; o.tarifaId = tarifa ? tarifa.id : '';
    o.monto = Math.round(cant * precio);
    return o;
  }
  if (tipo === 'Compra') {
    const t = tipos.find(function (x) { return x.id === l.tipoItemId; });
    if (!t) throw new Error(n + ': elige el tipo de ítem (material, insumo…)');
    const cant = num_(l.cantidad);
    if (!(cant > 0)) throw new Error(n + ': la cantidad debe ser mayor que 0');
    const costo = num_(l.costoUnit);
    if (costo < 0) throw new Error(n + ': costo inválido');
    // Desde v2.1 los ítems van al costo: el recargo se aplica al final, sobre el neto de la OT
    o.tipoItemId = t.id; o.tipoItem = t.nombre;
    o.cantidad = cant; o.costoUnit = costo; o.recargoPct = 0;
    o.monto = Math.round(cant * costo);
    return o;
  }
  // Horas (Tiempo de gestión o Mano de obra)
  let cat;
  if (tipo === 'Tiempo de gestión') {
    cat = cats.find(function (c) { return c.uso === 'Gestión'; });
    if (!cat) throw new Error('Falta la categoría de Gestión de compras. Ejecuta setup() en Apps Script.');
  } else {
    cat = cats.find(function (c) { return c.id === l.categoriaId; });
    if (!cat) throw new Error(n + ' necesita una categoría');
    if (cat.uso === 'Gestión') throw new Error(n + ': el tiempo de gestión de compras va en su propio bloque');
  }
  const horas = num_(l.horas);
  if (horas < 1) throw new Error(n + ': mínimo 1 hora');
  if (Math.round(horas * 2) !== horas * 2) throw new Error(n + ': las horas van de media en media (1; 1,5; 2…)');
  // Valor hora congelado: si la línea ya lo trae se respeta; si es nueva se toma el de la categoría
  const hh = l.hh !== '' && l.hh != null ? num_(l.hh) : num_(cat.valorHora);
  const factor = l.factor !== '' && l.factor != null ? num_(l.factor) : 1;
  o.categoriaId = cat.id; o.categoria = cat.nombre; o.modo = 'Horas';
  o.horas = horas; o.hh = hh; o.factor = factor;
  o.monto = Math.round(horas * hh * factor);
  return o;
}

function replaceLineas_(nOT, nuevas) {
  const sh = sheet_('OT_Lineas');
  const cols = SCHEMA.OT_Lineas;
  const lastRow = sh.getLastRow();
  let resto = [];
  if (lastRow > 1) {
    const data = sh.getRange(2, 1, lastRow - 1, cols.length).getValues();
    const idxOT = cols.findIndex(function (c) { return c[0] === 'nOT'; });
    resto = data.filter(function (r) { return String(r[idxOT]) !== String(nOT); });
  }
  const filas = resto.concat(nuevas.map(function (o) { return toRow_('OT_Lineas', o); }));
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, cols.length).clearContent();
  if (filas.length) sh.getRange(2, 1, filas.length, cols.length).setValues(filas);
}

// ════════════════════════════════════════════════════════════ DRIVE: FOTOS Y COTIZACIONES
const CARPETA_RAIZ = 'Mantenciones OSC — Archivos';

function carpetaRaiz_() {
  try { return carpetaRaizSinManejo_(); } catch (e) {
    const m = String(e && e.message || e);
    if (/permis|autoriz|authoriz|access/i.test(m)) {
      throw new Error('Falta autorizar Google Drive. En Apps Script elige la función setup, presiona Ejecutar y acepta los permisos. (Detalle de Google: ' + m + ')');
    }
    throw e;
  }
}

function carpetaRaizSinManejo_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ROOT_FOLDER');
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* se recrea */ }
  }
  const f = DriveApp.createFolder(CARPETA_RAIZ);
  props.setProperty('ROOT_FOLDER', f.getId());
  return f;
}

function carpetaOT_(nOT) {
  const raiz = carpetaRaiz_();
  const nombre = 'OT-' + String(nOT).padStart(4, '0');
  const it = raiz.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : raiz.createFolder(nombre);
}

function otExiste_(nOT) {
  const ot = readTable_('OT').find(function (o) { return String(o.nOT) === String(nOT); });
  if (!ot) throw new Error('No existe la OT ' + nOT + '. Guárdala antes de agregar fotos o cotizaciones.');
  return ot;
}

function getFotos_(nOT) {
  const fotos = readTable_('Fotos').filter(function (f) { return String(f.nOT) === String(nOT); });
  return {
    fotos: fotos.map(function (f) {
      let data = '';
      try { data = Utilities.base64Encode(DriveApp.getFileById(f.fileId).getBlob().getBytes()); } catch (e) { /* archivo borrado en Drive */ }
      return Object.assign({}, f, { data: data });
    })
  };
}

function uploadFoto_(r) {
  const ot = otExiste_(r.nOT);
  otCerrada_(ot);
  if (!r.data) throw new Error('Falta la imagen');
  const etapa = ETAPAS_FOTO.indexOf(r.etapa) !== -1 ? r.etapa : 'Durante';
  const ahora = new Date();
  const nombre = 'OT-' + String(r.nOT).padStart(4, '0') + '_' + slug_(etapa) + '_' +
    Utilities.formatDate(ahora, TZ, 'yyyyMMdd-HHmmss') + '_' + Utilities.getUuid().slice(0, 4) + '.jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(r.data), 'image/jpeg', nombre);
  const file = carpetaOT_(r.nOT).createFile(blob);
  const obj = {
    id: 'F-' + Utilities.getUuid().slice(0, 8),
    nOT: Number(r.nOT), fecha: today_(), etapa: etapa,
    descripcion: String(r.descripcion || '').trim(),
    fileId: file.getId(), url: file.getUrl(),
    enPresupuesto: r.enPresupuesto !== false
  };
  upsert_('Fotos', 'id', obj);
  return { item: obj };
}

function updateFoto_(item) {
  if (!item || !item.id) throw new Error('Falta la foto');
  const prev = readTable_('Fotos').find(function (f) { return f.id === item.id; });
  if (!prev) throw new Error('Foto no encontrada');
  otCerrada_(otExiste_(prev.nOT));
  const obj = Object.assign({}, prev, {
    etapa: ETAPAS_FOTO.indexOf(item.etapa) !== -1 ? item.etapa : prev.etapa,
    descripcion: String(item.descripcion == null ? prev.descripcion : item.descripcion).trim(),
    enPresupuesto: item.enPresupuesto !== false
  });
  upsert_('Fotos', 'id', obj);
  return { item: obj };
}

function deleteFoto_(id) {
  const sh = sheet_('Fotos');
  const rows = readTable_('Fotos');
  const idx = rows.findIndex(function (f) { return f.id === id; });
  if (idx === -1) throw new Error('Foto no encontrada');
  otCerrada_(otExiste_(rows[idx].nOT));
  try { DriveApp.getFileById(rows[idx].fileId).setTrashed(true); } catch (e) { /* ya no estaba */ }
  sh.deleteRow(idx + 2);
  return { ok: true, id: id };
}

/**
 * Guarda una cotización de una o varias OT.
 * r: { ots:[nOT], numero?: 'COT-2026-001' (solo para una versión nueva de una existente), version, pdf, neto, iva, total, solicitanteId }
 * El número y la versión los propone la app (van impresos en el PDF); aquí se verifica que no estén tomados.
 */
function saveCotizacion_(r) {
  if (!r.pdf) throw new Error('Falta el PDF');
  const ots = (r.ots && r.ots.length ? r.ots : [r.nOT]).map(Number).filter(Boolean);
  if (!ots.length) throw new Error('La cotización no tiene OT');
  const otsRows = ots.map(otExiste_);
  const clienteId = otsRows[0].clienteId;
  if (otsRows.some(function (o) { return o.clienteId !== clienteId; })) throw new Error('Todas las OT de una cotización deben ser del mismo cliente');
  otsRows.forEach(otCerrada_);  // una OT con OC o facturada ya no se vuelve a cotizar

  const todas = readTable_('Cotizaciones');
  const numero = String(r.numero || '').trim();
  if (!/^COT-\d{4}-\d{3,}$/.test(numero)) throw new Error('Número de cotización inválido');
  const mismas = todas.filter(function (c) { return c.numero === numero; });
  const ocCot = ocDeCotizacion_(mismas.map(function (c) { return c.id; }));
  if (ocCot) throw new Error(numero + ' está cerrada: tiene la OC ' + ocCot.nOC + ' asignada');
  const maxV = mismas.reduce(function (m, c) { return Math.max(m, Number(c.version) || 0); }, 0);
  const version = Number(r.version) || 1;
  if (version !== maxV + 1) {
    throw new Error('Alguien más generó ' + numero + (maxV ? ' v' + maxV : '') + ' al mismo tiempo. Sincroniza (⟳) y vuelve a generar.');
  }

  const nombre = 'Cotizacion_' + numero + '_v' + version + '.pdf';
  const blob = Utilities.newBlob(Utilities.base64Decode(r.pdf), 'application/pdf', nombre);
  const file = carpetaCotizaciones_().createFile(blob);

  // Las versiones anteriores vigentes pasan a "Reemplazada"
  mismas.forEach(function (c) {
    if (!c.estado || c.estado === 'Vigente') upsert_('Cotizaciones', 'id', Object.assign({}, c, { estado: 'Reemplazada' }));
  });
  const obj = {
    id: numero + '-v' + version, nOT: ots.length === 1 ? ots[0] : '', version: version, fecha: now_(),
    neto: num_(r.neto), total: num_(r.total), pdfUrl: file.getUrl(), fileId: file.getId(),
    numero: numero, ots: ots.join(','), estado: 'Vigente', clienteId: clienteId,
    solicitanteId: String(r.solicitanteId || ''), iva: num_(r.iva)
  };
  upsert_('Cotizaciones', 'id', obj);
  return { item: obj, reemplazadas: mismas.map(function (c) { return c.id; }) };
}

/** Una OT con OC o con folio SII es un documento cerrado: no se edita ni se vuelve a cotizar. */
function otCerrada_(o) {
  if (o.folioSII) throw new Error('La OT ' + o.nOT + ' está facturada (folio ' + o.folioSII + ') y no se puede modificar');
  if (String(o.nOC || '').trim()) throw new Error('La OT ' + o.nOT + ' tiene la OC ' + o.nOC + ' asignada y no se puede modificar. Si hay un error, quita primero la OC.');
}

/** OC asignada a alguna de estas cotizaciones (por ID de versión), o null. */
function ocDeCotizacion_(ids) {
  return readTable_('OrdenesCompra').find(function (o) {
    return lista_(o.cots).some(function (id) { return ids.indexOf(id) !== -1; });
  }) || null;
}

function setEstadoCotizacion_(id, estado) {
  if (ESTADOS_COT.indexOf(estado) === -1) throw new Error('Estado inválido: ' + estado);
  const c = readTable_('Cotizaciones').find(function (x) { return x.id === id; });
  if (!c) throw new Error('Cotización no encontrada');
  const ocC = ocDeCotizacion_([id]);
  if (ocC) throw new Error('La cotización está cerrada: tiene la OC ' + ocC.nOC + ' asignada');
  const obj = Object.assign({}, c, { estado: estado });
  upsert_('Cotizaciones', 'id', obj);
  return { item: obj };
}

function carpetaCotizaciones_() {
  const raiz = carpetaRaiz_();
  const it = raiz.getFoldersByName('Cotizaciones');
  return it.hasNext() ? it.next() : raiz.createFolder('Cotizaciones');
}

function slug_(s) { return normTxt_(s).replace(/[^a-z0-9]+/g, '-'); }

// ════════════════════════════════════════════════════════════ OC, FACTURAS Y PAGOS
const lista_ = v => String(v == null ? '' : v).split(',').map(function (x) { return x.trim(); }).filter(Boolean);

/** Actualiza campos de varias OT de una vez (sin tocar sus líneas). */
function actualizarOTs_(nOTs, fn) {
  const set = nOTs.map(String);
  readTable_('OT').forEach(function (o) {
    if (set.indexOf(String(o.nOT)) !== -1) upsert_('OT', 'nOT', Object.assign({}, o, fn(o), { actualizada: now_() }));
  });
}

function guardarArchivo_(archivo, carpetaNombre, nombreBase) {
  if (!archivo || !archivo.data) return null;
  const raiz = carpetaRaiz_();
  const it = raiz.getFoldersByName(carpetaNombre);
  const carpeta = it.hasNext() ? it.next() : raiz.createFolder(carpetaNombre);
  const mime = archivo.mime || 'application/octet-stream';
  const ext = mime === 'application/pdf' ? '.pdf' : mime.indexOf('image/') === 0 ? '.jpg' : '';
  const file = carpeta.createFile(Utilities.newBlob(Utilities.base64Decode(archivo.data), mime, nombreBase + ext));
  return file;
}

/**
 * Registra una OC para una o varias cotizaciones (mismo cliente).
 * r: { nOC, fecha, neto, iva, total, notas, cots:[idCotizacion], archivo?:{data,mime} }
 */
function saveOC_(r) {
  const nOC = String(r.nOC || '').trim();
  if (!nOC) throw new Error('Falta el N° de OC');
  if (readTable_('OrdenesCompra').some(function (o) { return String(o.nOC) === nOC; })) throw new Error('La OC ' + nOC + ' ya está registrada');
  const cotIds = (r.cots || []).map(String);
  if (!cotIds.length) throw new Error('Elige al menos una cotización');
  const todas = readTable_('Cotizaciones');
  const cots = cotIds.map(function (id) {
    const c = todas.find(function (x) { return x.id === id; });
    if (!c) throw new Error('Cotización no encontrada: ' + id);
    if (['Reemplazada', 'Descartada'].indexOf(c.estado) !== -1) throw new Error((c.numero || id) + ' está ' + c.estado.toLowerCase() + '; usa la versión vigente');
    return c;
  });
  const ots = [];
  cots.forEach(function (c) { lista_(c.ots || c.nOT).forEach(function (n) { if (ots.indexOf(n) === -1) ots.push(n); }); });
  const otsRows = ots.map(otExiste_);
  const clienteId = otsRows[0].clienteId;
  if (otsRows.some(function (o) { return o.clienteId !== clienteId; })) throw new Error('Las cotizaciones deben ser del mismo cliente');
  const conOC = ocDeCotizacion_(cotIds);
  if (conOC) throw new Error('Esa cotización ya tiene la OC ' + conOC.nOC + ' asignada');
  otsRows.forEach(otCerrada_);

  const file = guardarArchivo_(r.archivo, 'Órdenes de compra', 'OC_' + nOC.replace(/[^\w-]+/g, '_'));
  const obj = {
    nOC: nOC, fecha: r.fecha || today_(), clienteId: clienteId, monto: num_(r.total), notas: String(r.notas || ''),
    neto: num_(r.neto), iva: num_(r.iva), cots: cotIds.join(','), ots: ots.join(','),
    archivoUrl: file ? file.getUrl() : '', archivoId: file ? file.getId() : '', folio: '', creada: now_()
  };
  upsert_('OrdenesCompra', 'nOC', obj);
  cots.forEach(function (c) { upsert_('Cotizaciones', 'id', Object.assign({}, c, { estado: 'Aprobada' })); });
  actualizarOTs_(ots, function (o) { return { nOC: lista_(o.nOC).concat([nOC]).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ') }; });
  return { item: obj, cots: cots.map(function (c) { return c.id; }), ots: readTable_('OT').filter(function (o) { return ots.indexOf(String(o.nOT)) !== -1; }) };
}

function deleteOC_(nOC) {
  const rows = readTable_('OrdenesCompra');
  const idx = rows.findIndex(function (o) { return String(o.nOC) === String(nOC); });
  if (idx === -1) throw new Error('OC no encontrada');
  const oc = rows[idx];
  if (oc.folio) throw new Error('La OC ' + nOC + ' ya está facturada (folio ' + oc.folio + '). Quita primero la factura.');
  const ots = lista_(oc.ots);
  actualizarOTs_(ots, function (o) { return { nOC: lista_(String(o.nOC).replace(/\s/g, '')).filter(function (x) { return x !== String(nOC); }).join(', ') }; });
  // Las cotizaciones vuelven a Vigente si no tienen otra OC
  const otras = rows.filter(function (o, i) { return i !== idx; });
  const todas = readTable_('Cotizaciones');
  lista_(oc.cots).forEach(function (id) {
    const c = todas.find(function (x) { return x.id === id; });
    const tieneOtra = otras.some(function (o) { return lista_(o.cots).indexOf(id) !== -1; });
    if (c && !tieneOtra && c.estado === 'Aprobada') upsert_('Cotizaciones', 'id', Object.assign({}, c, { estado: 'Vigente' }));
  });
  if (oc.archivoId) { try { DriveApp.getFileById(oc.archivoId).setTrashed(true); } catch (e) { /* ya no estaba */ } }
  sheet_('OrdenesCompra').deleteRow(idx + 2);
  return { ok: true, nOC: nOC };
}

/**
 * Registra el folio SII de una factura que cubre una o varias OC (mismo cliente).
 * r: { folio, fecha, ocs:[nOC], neto, iva, total, notas }
 */
function saveFactura_(r) {
  const folio = String(r.folio || '').trim();
  if (!folio) throw new Error('Falta el folio SII');
  if (readTable_('Facturas').some(function (f) { return String(f.folio) === folio; })) throw new Error('El folio ' + folio + ' ya está registrado');
  const ocsAll = readTable_('OrdenesCompra');
  const ocs = (r.ocs || []).map(function (n) {
    const oc = ocsAll.find(function (o) { return String(o.nOC) === String(n); });
    if (!oc) throw new Error('OC no encontrada: ' + n);
    if (oc.folio) throw new Error('La OC ' + n + ' ya está facturada (folio ' + oc.folio + ')');
    return oc;
  });
  if (!ocs.length) throw new Error('Elige al menos una OC');
  const clienteId = ocs[0].clienteId;
  if (ocs.some(function (o) { return o.clienteId !== clienteId; })) throw new Error('Las OC deben ser del mismo cliente');
  const ots = [];
  ocs.forEach(function (o) { lista_(o.ots).forEach(function (n) { if (ots.indexOf(n) === -1) ots.push(n); }); });
  const neto = num_(r.neto), iva = num_(r.iva), total = num_(r.total);
  if (!(total > 0)) throw new Error('El total de la factura debe ser mayor que 0');
  const obj = {
    folio: folio, fecha: r.fecha || today_(), clienteId: clienteId, nOC: ocs.map(function (o) { return o.nOC; }).join(','),
    neto: neto, iva: iva, total: total, estadoPago: 'Pendiente',
    ots: ots.join(','), fechaPago: '', refPago: '', notas: String(r.notas || ''), creada: now_()
  };
  upsert_('Facturas', 'folio', obj);
  ocs.forEach(function (o) { upsert_('OrdenesCompra', 'nOC', Object.assign({}, o, { folio: folio })); });
  actualizarOTs_(ots, function () { return { folioSII: folio }; });
  return { item: obj, ocs: ocs.map(function (o) { return o.nOC; }), ots: readTable_('OT').filter(function (o) { return ots.indexOf(String(o.nOT)) !== -1; }) };
}

function deleteFactura_(folio) {
  const rows = readTable_('Facturas');
  const idx = rows.findIndex(function (f) { return String(f.folio) === String(folio); });
  if (idx === -1) throw new Error('Factura no encontrada');
  const f = rows[idx];
  if (f.estadoPago === 'Pagada') throw new Error('La factura ' + folio + ' está pagada. Márcala como pendiente antes de quitarla.');
  readTable_('OrdenesCompra').forEach(function (o) { if (String(o.folio) === String(folio)) upsert_('OrdenesCompra', 'nOC', Object.assign({}, o, { folio: '' })); });
  actualizarOTs_(lista_(f.ots), function (o) { return String(o.folioSII) === String(folio) ? { folioSII: '' } : {}; });
  sheet_('Facturas').deleteRow(idx + 2);
  return { ok: true, folio: folio };
}

function setPago_(r) {
  const f = readTable_('Facturas').find(function (x) { return String(x.folio) === String(r.folio); });
  if (!f) throw new Error('Factura no encontrada');
  const pagada = r.estadoPago === 'Pagada';
  const obj = Object.assign({}, f, {
    estadoPago: pagada ? 'Pagada' : 'Pendiente',
    fechaPago: pagada ? (r.fechaPago || today_()) : '',
    refPago: pagada ? String(r.refPago || '') : ''
  });
  upsert_('Facturas', 'folio', obj);
  return { item: obj };
}

// ════════════════════════════════════════════════════════════ UTILIDADES DE HOJA
function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Falta la hoja "' + name + '". Ejecuta setup() en Apps Script.');
  return sh;
}

function readTable_(name) {
  const sh = sheet_(name);
  const cols = SCHEMA[name];
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const data = sh.getRange(2, 1, lastRow - 1, cols.length).getValues();
  return data
    .filter(function (r) { return r.some(function (v) { return v !== '' && v !== null; }); })
    .map(function (r) {
      const o = {};
      cols.forEach(function (c, i) {
        let v = r[i];
        if (v instanceof Date) v = Utilities.formatDate(v, TZ, (c[0] === 'creada' || c[0] === 'actualizada') ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
        if (v === 'TRUE' || v === 'VERDADERO') v = true;
        if (v === 'FALSE' || v === 'FALSO') v = false;
        o[c[0]] = v;
      });
      return o;
    });
}

function toRow_(name, obj) {
  return SCHEMA[name].map(function (c) { return obj[c[0]] == null ? '' : obj[c[0]]; });
}

function upsert_(name, keyField, obj) {
  const sh = sheet_(name);
  const cols = SCHEMA[name];
  const keyIdx = cols.findIndex(function (c) { return c[0] === keyField; });
  const lastRow = sh.getLastRow();
  const row = toRow_(name, obj);
  if (lastRow > 1) {
    const keys = sh.getRange(2, keyIdx + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(obj[keyField])) {
        sh.getRange(i + 2, 1, 1, cols.length).setValues([row]);
        return;
      }
    }
  }
  sh.getRange(lastRow + 1, 1, 1, cols.length).setValues([row]);
}

function nextId_(prefix, rows, field) {
  let max = 0;
  rows.forEach(function (r) {
    const m = String(r[field] || '').match(/-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return prefix + '-' + (max + 1);
}

function nextNumber_(rows, field) {
  return rows.reduce(function (m, r) { return Math.max(m, Number(r[field]) || 0); }, 0) + 1;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function normTxt_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function num_(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
