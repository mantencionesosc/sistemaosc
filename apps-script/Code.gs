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

// ════════════════════════════════════════════════════════════ ESQUEMA
// Cada hoja: lista de [claveJS, encabezadoEnLaHoja]. El orden define las columnas.
const SCHEMA = {
  Config: [
    ['clave', 'Clave'], ['valor', 'Valor'], ['descripcion', 'Descripción']
  ],
  Categorias: [
    ['id', 'ID'], ['nombre', 'Nombre'], ['factor', 'Factor'], ['orden', 'Orden'], ['activa', 'Activa']
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
    ['notas', 'Notas'], ['creada', 'Creada'], ['actualizada', 'Actualizada']
  ],
  OT_Lineas: [
    ['id', 'ID'], ['nOT', 'N° OT'], ['orden', 'Orden'], ['fecha', 'Fecha'], ['tipo', 'Tipo'],
    ['categoriaId', 'Categoría ID'], ['categoria', 'Categoría'], ['descripcion', 'Descripción'],
    ['horas', 'Horas'], ['hh', 'HH aplicado'], ['factor', 'Factor aplicado'],
    ['cantidad', 'Cantidad'], ['costoUnit', 'Costo unitario'], ['recargoPct', '% Recargo'],
    ['monto', 'Monto'], ['incluida', 'Incluida']
  ],
  // Hojas de etapas siguientes (se crean ahora para dejar la estructura lista)
  Fotos: [
    ['id', 'ID'], ['nOT', 'N° OT'], ['fecha', 'Fecha'], ['etapa', 'Etapa'], ['descripcion', 'Descripción'],
    ['fileId', 'Archivo Drive ID'], ['url', 'URL'], ['enPresupuesto', 'Mostrar en presupuesto']
  ],
  Cotizaciones: [
    ['id', 'ID'], ['nOT', 'N° OT'], ['version', 'Versión'], ['fecha', 'Fecha envío'],
    ['neto', 'Neto'], ['total', 'Total'], ['pdfUrl', 'PDF (Drive)']
  ],
  OrdenesCompra: [
    ['nOC', 'N° OC'], ['fecha', 'Fecha'], ['clienteId', 'Cliente ID'], ['monto', 'Monto'], ['notas', 'Notas']
  ],
  Facturas: [
    ['folio', 'Folio SII'], ['fecha', 'Fecha'], ['clienteId', 'Cliente ID'], ['nOC', 'N° OC'],
    ['neto', 'Neto'], ['iva', 'IVA'], ['total', 'Total'], ['estadoPago', 'Estado de pago']
  ]
};

const TEXT_COLS = {
  Config: ['valor'],
  Clientes: ['rut', 'telefono'],
  Solicitantes: ['telefono'],
  OT: ['nOC', 'folioSII'],
  OrdenesCompra: ['nOC'],
  Facturas: ['folio', 'nOC']
};

const CONFIG_DEFAULTS = [
  ['HH_BASE', 0, 'Valor hora base (CLP, neto). Mano de obra = horas × HH base × factor de la categoría'],
  ['IVA_PCT', 19, 'IVA en %'],
  ['RECARGO_MATERIALES_PCT', 0, '% de recargo por defecto sobre el costo de materiales (0 = al costo)'],
  ['EMPRESA_NOMBRE', 'Mantenciones OSC', 'Nombre de fantasía'],
  ['EMPRESA_RAZON_SOCIAL', '', 'Razón social (como aparece en el SII)'],
  ['EMPRESA_RUT', '', 'RUT de la empresa'],
  ['EMPRESA_GIRO', '', 'Giro'],
  ['EMPRESA_DIRECCION', '', 'Dirección'],
  ['EMPRESA_TELEFONO', '', 'Teléfono'],
  ['EMPRESA_CORREO', '', 'Correo']
];

const CATEGORIAS_DEFAULT = [
  'Gestión de compras', 'Mantenciones (varios)', 'Electricidad', 'Mueblería', 'Carpintería', 'Gasfitería'
];

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

  // Categorías por defecto (factor 1,0: ajústalo en la app → Config)
  if (readTable_('Categorias').length === 0) {
    const catSh = ss.getSheetByName('Categorias');
    CATEGORIAS_DEFAULT.forEach(function (n, i) { catSh.appendRow(['CAT-' + (i + 1), n, 1, i + 1, true]); });
  }

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
    return json_(fn(req));
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

const ACTIONS = {
  ping: function () { return { ok: true, hora: now_() }; },
  getAll: getAll_,
  saveConfig: function (r) { return withLock_(function () { return saveConfig_(r.values || {}); }); },
  saveCategoria: function (r) { return withLock_(function () { return saveCategoria_(r.item); }); },
  saveCliente: function (r) { return withLock_(function () { return saveSimple_('Clientes', 'CLI', r.item, validarCliente_); }); },
  saveSolicitante: function (r) { return withLock_(function () { return saveSimple_('Solicitantes', 'SOL', r.item, validarSolicitante_); }); },
  saveUbicacion: function (r) { return withLock_(function () { return saveSimple_('Ubicaciones', 'UBI', r.item, validarUbicacion_); }); },
  saveOT: function (r) { return withLock_(function () { return saveOT_(r.ot, r.lineas || []); }); }
};

function getAll_() {
  return {
    config: configObj_(),
    categorias: readTable_('Categorias'),
    clientes: readTable_('Clientes'),
    solicitantes: readTable_('Solicitantes'),
    ubicaciones: readTable_('Ubicaciones'),
    ots: readTable_('OT'),
    lineas: readTable_('OT_Lineas')
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
  const factor = num_(item.factor);
  if (!(factor > 0)) throw new Error('El factor debe ser mayor que 0');
  const rows = readTable_('Categorias');
  const obj = {
    id: item.id || nextId_('CAT', rows, 'id'),
    nombre: nombre,
    factor: factor,
    orden: item.orden != null && item.orden !== '' ? num_(item.orden) : rows.length + 1,
    activa: item.activa !== false
  };
  upsert_('Categorias', 'id', obj);
  return { item: obj };
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
    if (previa.folioSII) throw new Error('La OT ' + ot.nOT + ' ya está facturada (folio ' + previa.folioSII + ') y no se puede editar');
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
  const nOT = esNueva ? nextNumber_(ots, 'nOT') : Number(ot.nOT);
  const hoy = today_();
  const lineasOk = lineas.map(function (l, i) { return normalizarLinea_(l, i, nOT, cfg, cats, hoy); });

  const neto = lineasOk.reduce(function (s, l) { return s + (l.incluida ? l.monto : 0); }, 0);
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
    actualizada: now_()
  };

  upsert_('OT', 'nOT', obj);
  replaceLineas_(nOT, lineasOk);
  return { ot: obj, lineas: lineasOk };
}

function normalizarLinea_(l, i, nOT, cfg, cats, hoy) {
  const tipo = l.tipo === 'Material' ? 'Material' : 'Mano de obra';
  const desc = String(l.descripcion || '').trim();
  if (!desc) throw new Error('La línea ' + (i + 1) + ' no tiene descripción');
  const o = {
    id: l.id || ('L-' + nOT + '-' + Utilities.getUuid().slice(0, 8)),
    nOT: nOT,
    orden: i + 1,
    fecha: l.fecha || hoy,
    tipo: tipo,
    categoriaId: '', categoria: '',
    descripcion: desc,
    horas: '', hh: '', factor: '',
    cantidad: '', costoUnit: '', recargoPct: '',
    monto: 0,
    incluida: l.incluida !== false
  };
  if (tipo === 'Mano de obra') {
    const cat = cats.find(function (c) { return c.id === l.categoriaId; });
    if (!cat) throw new Error('La línea ' + (i + 1) + ' necesita una categoría');
    const horas = num_(l.horas);
    if (horas < 1) throw new Error('La línea ' + (i + 1) + ': mínimo 1 hora');
    if (Math.round(horas * 2) !== horas * 2) throw new Error('La línea ' + (i + 1) + ': las horas van de media en media (1; 1,5; 2…)');
    // Valores congelados: si la línea ya los trae se respetan; si es nueva se toman de Config
    const hh = l.hh !== '' && l.hh != null ? num_(l.hh) : num_(cfg.HH_BASE);
    const factor = l.factor !== '' && l.factor != null ? num_(l.factor) : num_(cat.factor);
    o.categoriaId = cat.id; o.categoria = cat.nombre;
    o.horas = horas; o.hh = hh; o.factor = factor;
    o.monto = Math.round(horas * hh * factor);
  } else {
    const cant = num_(l.cantidad);
    if (!(cant > 0)) throw new Error('La línea ' + (i + 1) + ': la cantidad debe ser mayor que 0');
    const costo = num_(l.costoUnit);
    if (costo < 0) throw new Error('La línea ' + (i + 1) + ': costo inválido');
    const rec = l.recargoPct !== '' && l.recargoPct != null ? num_(l.recargoPct) : num_(cfg.RECARGO_MATERIALES_PCT);
    o.cantidad = cant; o.costoUnit = costo; o.recargoPct = rec;
    o.monto = Math.round(cant * costo * (1 + rec / 100));
  }
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
