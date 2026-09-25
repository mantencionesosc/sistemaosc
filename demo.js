/* Mantenciones OSC — Modo demo
 * Simula la API de Apps Script con datos de ejemplo guardados solo en este navegador.
 * Sirve para probar la app antes de conectar la planilla. Nada de esto llega a Google Sheets.
 */
const Demo = (() => {
  const KEY = 'osc_demo_db_v8';
  const IMG = {};  // fotos de la demo: solo en memoria (no caben en el almacenamiento del navegador)

  function seed() {
    const loc = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
    const hoy = loc(new Date());
    const anio = new Date().getFullYear();
    const dm = new Date(); dm.setDate(1); dm.setMonth(dm.getMonth() - 1); dm.setDate(12);
    const mesAnt = loc(dm);
    const L = (k, orden, tipo, x) => Object.assign({ id: 'L-1-' + k, nOT: 1, orden, fecha: hoy, tipo, categoriaId: '', categoria: '', descripcion: '',
      horas: '', hh: '', factor: '', cantidad: '', costoUnit: '', recargoPct: '', monto: 0, incluida: true, tipoItemId: '', tipoItem: '' }, x);
    return {
      config: {
        HH_BASE: 0, IVA_PCT: 19, RECARGO_MATERIALES_PCT: 30,
        EMPRESA_NOMBRE: 'Mantenciones OSC', EMPRESA_RAZON_SOCIAL: '', EMPRESA_RUT: '',
        EMPRESA_GIRO: '', EMPRESA_DIRECCION: '', EMPRESA_TELEFONO: '', EMPRESA_CORREO: '', EMPRESA_FIRMA: '',
        COT_CONDICIONES: '', COT_INCLUIR_CONDICIONES: 'NO', COT_MO_AGRUPADA: 'NO', COT_DETALLE_COMPRAS: 'NO', COT_DETALLE_MO: 'NO', COT_MOSTRAR_CANTIDAD: 'SI'
      },
      categorias: [
        { id: 'CAT-1', nombre: 'Gestión de compras', factor: 1, valorHora: 10000, orden: 1, activa: true, uso: 'Gestión' },
        { id: 'CAT-2', nombre: 'Mantenciones (varios)', factor: 1, valorHora: 10000, orden: 2, activa: true, uso: 'Oficio' },
        { id: 'CAT-3', nombre: 'Electricidad', factor: 1, valorHora: 18000, orden: 3, activa: true, uso: 'Oficio' },
        { id: 'CAT-4', nombre: 'Mueblería', factor: 1, valorHora: 13000, orden: 4, activa: true, uso: 'Oficio' },
        { id: 'CAT-5', nombre: 'Carpintería', factor: 1, valorHora: 13000, orden: 5, activa: true, uso: 'Oficio' },
        { id: 'CAT-6', nombre: 'Gasfitería', factor: 1, valorHora: 15000, orden: 6, activa: true, uso: 'Oficio' }
      ],
      tiposItem: [
        { id: 'TIP-1', nombre: 'Material', orden: 1, activo: true },
        { id: 'TIP-2', nombre: 'Insumo', orden: 2, activo: true },
        { id: 'TIP-3', nombre: 'Arriendo de herramienta', orden: 3, activo: true },
        { id: 'TIP-4', nombre: 'Flete / transporte', orden: 4, activo: true },
        { id: 'TIP-5', nombre: 'Combustible', orden: 5, activo: true }
      ],
      unidades: ['m²', 'm lineal', 'pulgada', 'unidad', 'punto'].map((n, i) => ({ id: 'UNI-' + (i + 1), nombre: n, orden: i + 1, activo: true })),
      tarifario: [
        { id: 'TAR-1', nombre: 'Desinstalación de piso', categoriaId: 'CAT-5', unidad: 'm²', precio: 3000, orden: 1, activo: true },
        { id: 'TAR-2', nombre: 'Instalación de piso flotante', categoriaId: 'CAT-5', unidad: 'm²', precio: 8000, orden: 2, activo: true },
        { id: 'TAR-3', nombre: 'Pintura de muro (2 manos)', categoriaId: 'CAT-2', unidad: 'm²', precio: 4500, orden: 3, activo: true },
        { id: 'TAR-4', nombre: 'Instalación de punto eléctrico', categoriaId: 'CAT-3', unidad: 'punto', precio: 25000, orden: 4, activo: true }
      ],
      fotos: [],
      cotizaciones: [
        { id: `COT-${anio}-001-v1`, nOT: 3, version: 1, fecha: mesAnt + ' 10:00', neto: 61100, total: 72709, pdfUrl: '', fileId: '', numero: `COT-${anio}-001`, ots: '3', estado: 'Aprobada', clienteId: 'CLI-1', solicitanteId: 'SOL-1', iva: 11609 }
      ],
      ordenesCompra: [
        { nOC: '4500000001', fecha: mesAnt, clienteId: 'CLI-1', monto: 72709, notas: '', neto: 61100, iva: 11609, cots: `COT-${anio}-001-v1`, ots: '3', archivoUrl: '', archivoId: '', folio: '101', creada: mesAnt }
      ],
      facturas: [
        { folio: '101', fecha: mesAnt, clienteId: 'CLI-1', nOC: '4500000001', neto: 61100, iva: 11609, total: 72709, estadoPago: 'Pagada', ots: '3', fechaPago: hoy, refPago: 'Transferencia de ejemplo', notas: '', creada: mesAnt }
      ],
      clientes: [
        { id: 'CLI-1', razonSocial: 'Universidad de Concepción', nombreCorto: 'UdeC', rut: '', giro: '', direccion: '', comuna: 'Concepción', contacto: '', correo: '', telefono: '', activo: true }
      ],
      solicitantes: [
        { id: 'SOL-1', clienteId: 'CLI-1', nombre: 'Jefa de ejemplo', cargo: 'Jefa de Administración', unidad: 'Administración', correo: '', telefono: '', activo: true },
        { id: 'SOL-2', clienteId: 'CLI-1', nombre: 'Encargado de ejemplo', cargo: 'Encargado de Biblioteca', unidad: 'Biblioteca', correo: '', telefono: '', activo: true }
      ],
      ubicaciones: [
        { id: 'UBI-1', clienteId: 'CLI-1', edificio: 'Edificio de ejemplo', detalle: 'Baño 2° piso', activo: true },
        { id: 'UBI-2', clienteId: 'CLI-1', edificio: 'Biblioteca', detalle: 'Sala de lectura', activo: true }
      ],
      ots: [
        { nOT: 1, fechaInicio: hoy, clienteId: 'CLI-1', cliente: 'UdeC', solicitanteId: 'SOL-1', solicitante: 'Jefa de ejemplo',
          ubicacionId: 'UBI-1', ubicacion: 'Edificio de ejemplo — Baño 2° piso', titulo: 'Cambio de lavamanos',
          descripcion: 'La jefa pide cambiar el lavamanos del baño del 2° piso.', estado: 'En curso',
          nOC: '', folioSII: '', neto: 159120, ivaPct: 19, iva: 30233, total: 189353, notas: '', creada: hoy, actualizada: hoy, detallar: '',
          subtotal: 122400, recargoPct: 30, recargo: 36720 },
        { nOT: 2, fechaInicio: hoy, clienteId: 'CLI-1', cliente: 'UdeC', solicitanteId: 'SOL-2', solicitante: 'Encargado de ejemplo',
          ubicacionId: 'UBI-2', ubicacion: 'Biblioteca — Sala de lectura', titulo: 'Cambio de enchufes',
          descripcion: 'Reemplazo de 6 enchufes dañados en la sala de lectura.', estado: 'Pendiente',
          nOC: '', folioSII: '', neto: 87100, ivaPct: 19, iva: 16549, total: 103649, notas: '', creada: hoy, actualizada: hoy, detallar: '',
          subtotal: 67000, recargoPct: 30, recargo: 20100 },
        { nOT: 3, fechaInicio: mesAnt, clienteId: 'CLI-1', cliente: 'UdeC', solicitanteId: 'SOL-1', solicitante: 'Jefa de ejemplo',
          ubicacionId: 'UBI-1', ubicacion: 'Edificio de ejemplo — Baño 2° piso', titulo: 'Reparación de puerta',
          descripcion: 'Cambio de bisagras y ajuste de puerta.', estado: 'Terminada',
          nOC: '4500000001', folioSII: '101', neto: 61100, ivaPct: 19, iva: 11609, total: 72709, notas: '', creada: mesAnt, actualizada: mesAnt, detallar: '',
          subtotal: 47000, recargoPct: 30, recargo: 14100 }
      ],
      lineas: [
        L('a', 1, 'Compra', { tipoItemId: 'TIP-1', tipoItem: 'Material', descripcion: 'Lavamanos loza blanco (Sodimac)', cantidad: 1, costoUnit: 45000, recargoPct: 0, monto: 45000 }),
        L('b', 2, 'Compra', { tipoItemId: 'TIP-1', tipoItem: 'Material', descripcion: 'Lavamanos Fanaloza (Easy)', cantidad: 1, costoUnit: 62000, recargoPct: 0, monto: 62000, incluida: false }),
        L('c', 3, 'Compra', { tipoItemId: 'TIP-2', tipoItem: 'Insumo', descripcion: 'Sifón + flexibles', cantidad: 1, costoUnit: 8900, recargoPct: 0, monto: 8900 }),
        L('d', 4, 'Compra', { tipoItemId: 'TIP-4', tipoItem: 'Flete / transporte', descripcion: 'Flete', cantidad: 1, costoUnit: 6000, recargoPct: 0, monto: 6000 }),
        L('e', 5, 'Tiempo de gestión', { categoriaId: 'CAT-1', categoria: 'Gestión de compras', descripcion: 'Cotizar en 2 ferreterías', horas: 1, hh: 10000, factor: 1, monto: 10000 }),
        L('f', 6, 'Tiempo de gestión', { categoriaId: 'CAT-1', categoria: 'Gestión de compras', descripcion: 'Compra y retiro', horas: 1.5, hh: 10000, factor: 1, monto: 15000 }),
        L('g', 7, 'Mano de obra', { categoriaId: 'CAT-6', categoria: 'Gasfitería', descripcion: 'Desinstalación de lavamanos', horas: 1, hh: 15000, factor: 1, monto: 15000 }),
        L('h', 8, 'Mano de obra', { categoriaId: 'CAT-6', categoria: 'Gasfitería', descripcion: 'Instalación de lavamanos y conexiones', horas: 1.5, hh: 15000, factor: 1, monto: 22500 }),
        L('i', 1, 'Compra', { id: 'L-2-i', nOT: 2, tipoItemId: 'TIP-1', tipoItem: 'Material', descripcion: 'Enchufes dobles', cantidad: 6, costoUnit: 3500, recargoPct: 0, monto: 21000 }),
        L('j', 2, 'Tiempo de gestión', { id: 'L-2-j', nOT: 2, categoriaId: 'CAT-1', categoria: 'Gestión de compras', descripcion: 'Compra de enchufes', horas: 1, hh: 10000, factor: 1, monto: 10000 }),
        L('k', 3, 'Mano de obra', { id: 'L-2-k', nOT: 2, categoriaId: 'CAT-3', categoria: 'Electricidad', descripcion: 'Cambio de 6 enchufes', horas: 2, hh: 18000, factor: 1, monto: 36000 }),
        L('l', 1, 'Compra', { id: 'L-3-l', nOT: 3, fecha: mesAnt, tipoItemId: 'TIP-1', tipoItem: 'Material', descripcion: 'Bisagras', cantidad: 4, costoUnit: 2000, recargoPct: 0, monto: 8000 }),
        L('m', 2, 'Mano de obra', { id: 'L-3-m', nOT: 3, fecha: mesAnt, categoriaId: 'CAT-5', categoria: 'Carpintería', descripcion: 'Cambio de bisagras y ajuste', horas: 3, hh: 13000, factor: 1, monto: 39000 })
      ]
    };
  }

  let db = null;
  function load() {
    if (db) return db;
    try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { db = null; }
    if (!db) db = seed();
    return db;
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* sin almacenamiento: queda en memoria */ } }
  function reset() { db = seed(); persist(); }

  const clone = o => JSON.parse(JSON.stringify(o));
  const num = v => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  const nextId = (prefix, rows) => prefix + '-' + (rows.reduce((m, r) => { const x = String(r.id).match(/-(\d+)$/); return x ? Math.max(m, +x[1]) : m; }, 0) + 1);
  const hoy = () => ahora().slice(0, 10);
  const ahora = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16).replace('T', ' '); };

  function upsert(arr, key, obj) {
    const i = arr.findIndex(x => String(x[key]) === String(obj[key]));
    if (i === -1) arr.push(obj); else arr[i] = obj;
  }

  const actions = {
    ping: () => ({ ok: true }),
    getAll: () => Object.assign(clone(load()), { version: 'demo' }),
    saveConfig: ({ values }) => {
      const d = load();
      Object.keys(values).forEach(k => {
        d.config[k] = ['HH_BASE', 'IVA_PCT', 'RECARGO_MATERIALES_PCT'].includes(k) ? num(values[k]) : String(values[k] ?? '').trim();
      });
      return { config: clone(d.config) };
    },
    saveCategoria: ({ item }) => {
      const d = load();
      if (!String(item.nombre || '').trim()) throw new Error('La categoría necesita un nombre');
      if (!(num(item.valorHora) > 0)) throw new Error('El valor hora de "' + item.nombre + '" debe ser mayor que 0');
      const prev = d.categorias.find(c => c.id === item.id);
      const o = { id: item.id || nextId('CAT', d.categorias), nombre: item.nombre.trim(), factor: 1, valorHora: Math.round(num(item.valorHora)), orden: item.orden || d.categorias.length + 1, activa: item.activa !== false, uso: prev && prev.uso ? prev.uso : 'Oficio' };
      if (o.uso === 'Gestión' && !o.activa) throw new Error('La categoría de gestión de compras no se puede desactivar');
      upsert(d.categorias, 'id', o);
      return { item: clone(o) };
    },
    getFotos: ({ nOT }) => {
      const d = load();
      return { fotos: d.fotos.filter(f => String(f.nOT) === String(nOT)).map(f => Object.assign({}, f, { data: IMG[f.id] || '' })) };
    },
    uploadFoto: r => {
      const d = load();
      if (!d.ots.some(o => String(o.nOT) === String(r.nOT))) throw new Error('No existe la OT ' + r.nOT);
      const o = { id: 'F-' + Math.random().toString(36).slice(2, 10), nOT: +r.nOT, fecha: hoy(), etapa: ['Antes', 'Durante', 'Después'].includes(r.etapa) ? r.etapa : 'Durante',
        descripcion: String(r.descripcion || ''), fileId: '', url: '', enPresupuesto: r.enPresupuesto !== false };
      IMG[o.id] = r.data; d.fotos.push(o);
      return { item: clone(o) };
    },
    updateFoto: ({ item }) => {
      const d = load(); const f = d.fotos.find(x => x.id === item.id);
      if (!f) throw new Error('Foto no encontrada');
      Object.assign(f, { etapa: item.etapa || f.etapa, descripcion: item.descripcion ?? f.descripcion, enPresupuesto: item.enPresupuesto !== false });
      return { item: clone(f) };
    },
    deleteFoto: ({ id }) => { const d = load(); d.fotos = d.fotos.filter(f => f.id !== id); delete IMG[id]; return { ok: true, id }; },
    saveCotizacion: r => {
      const d = load();
      const mismas = d.cotizaciones.filter(c => c.numero === r.numero);
      const maxV = mismas.reduce((m, c) => Math.max(m, c.version), 0);
      if (+r.version !== maxV + 1) throw new Error('Alguien más generó ' + r.numero + ' al mismo tiempo. Sincroniza y vuelve a generar.');
      mismas.forEach(c => { if (!c.estado || c.estado === 'Vigente') c.estado = 'Reemplazada'; });
      const ots = (r.ots || []).map(Number);
      const o = { id: r.numero + '-v' + r.version, nOT: ots.length === 1 ? ots[0] : '', version: +r.version, fecha: ahora(), neto: num(r.neto), total: num(r.total),
        pdfUrl: '', fileId: '', numero: r.numero, ots: ots.join(','), estado: 'Vigente', clienteId: '', solicitanteId: r.solicitanteId || '', iva: num(r.iva) };
      d.cotizaciones.push(o);
      return { item: clone(o), reemplazadas: mismas.map(c => c.id) };
    },
    setEstadoCotizacion: ({ id, estado }) => {
      const d = load(); const c = d.cotizaciones.find(x => x.id === id);
      if (!c) throw new Error('Cotización no encontrada');
      c.estado = estado; return { item: clone(c) };
    },
    saveOC: r => {
      const d = load();
      if (d.ordenesCompra.some(o => String(o.nOC) === String(r.nOC))) throw new Error('La OC ' + r.nOC + ' ya está registrada');
      const cots = r.cots.map(id => d.cotizaciones.find(c => c.id === id));
      const ots = [...new Set(cots.flatMap(c => String(c.ots || c.nOT).split(',').filter(Boolean)))];
      const otRows = ots.map(n => d.ots.find(o => String(o.nOT) === n));
      if (otRows.some(o => o.folioSII)) throw new Error('Alguna OT ya está facturada');
      const o = { nOC: String(r.nOC), fecha: r.fecha || hoy(), clienteId: otRows[0].clienteId, monto: num(r.total), notas: r.notas || '', neto: num(r.neto), iva: num(r.iva),
        cots: r.cots.join(','), ots: ots.join(','), archivoUrl: '', archivoId: '', folio: '', creada: ahora() };
      d.ordenesCompra.push(o);
      cots.forEach(c => { c.estado = 'Aprobada'; });
      otRows.forEach(x => { x.nOC = [...new Set(String(x.nOC || '').split(',').map(v => v.trim()).filter(Boolean).concat([o.nOC]))].join(', '); });
      return { item: clone(o), cots: r.cots, ots: clone(otRows) };
    },
    deleteOC: ({ nOC }) => {
      const d = load(); const o = d.ordenesCompra.find(x => String(x.nOC) === String(nOC));
      if (!o) throw new Error('OC no encontrada'); if (o.folio) throw new Error('La OC ya está facturada');
      d.ordenesCompra = d.ordenesCompra.filter(x => x !== o);
      String(o.ots).split(',').forEach(n => { const ot = d.ots.find(x => String(x.nOT) === n); if (ot) ot.nOC = String(ot.nOC).split(',').map(v => v.trim()).filter(v => v && v !== String(nOC)).join(', '); });
      String(o.cots).split(',').forEach(id => { const c = d.cotizaciones.find(x => x.id === id); if (c && c.estado === 'Aprobada') c.estado = 'Vigente'; });
      return { ok: true };
    },
    saveFactura: r => {
      const d = load();
      if (d.facturas.some(f => String(f.folio) === String(r.folio))) throw new Error('El folio ' + r.folio + ' ya está registrado');
      const ocs = r.ocs.map(n => d.ordenesCompra.find(o => String(o.nOC) === String(n)));
      if (ocs.some(o => o.folio)) throw new Error('Alguna OC ya está facturada');
      const ots = [...new Set(ocs.flatMap(o => String(o.ots).split(',').filter(Boolean)))];
      const f = { folio: String(r.folio), fecha: r.fecha || hoy(), clienteId: ocs[0].clienteId, nOC: ocs.map(o => o.nOC).join(','), neto: num(r.neto), iva: num(r.iva), total: num(r.total),
        estadoPago: 'Pendiente', ots: ots.join(','), fechaPago: '', refPago: '', notas: r.notas || '', creada: ahora() };
      d.facturas.push(f);
      ocs.forEach(o => { o.folio = f.folio; });
      const otRows = ots.map(n => d.ots.find(o => String(o.nOT) === n)); otRows.forEach(o => { o.folioSII = f.folio; });
      return { item: clone(f), ocs: ocs.map(o => o.nOC), ots: clone(otRows) };
    },
    deleteFactura: ({ folio }) => {
      const d = load(); const f = d.facturas.find(x => String(x.folio) === String(folio));
      if (!f) throw new Error('Factura no encontrada'); if (f.estadoPago === 'Pagada') throw new Error('La factura está pagada');
      d.facturas = d.facturas.filter(x => x !== f);
      d.ordenesCompra.forEach(o => { if (String(o.folio) === String(folio)) o.folio = ''; });
      d.ots.forEach(o => { if (String(o.folioSII) === String(folio)) o.folioSII = ''; });
      return { ok: true };
    },
    setPago: r => {
      const d = load(); const f = d.facturas.find(x => String(x.folio) === String(r.folio));
      if (!f) throw new Error('Factura no encontrada');
      const pag = r.estadoPago === 'Pagada';
      Object.assign(f, { estadoPago: pag ? 'Pagada' : 'Pendiente', fechaPago: pag ? (r.fechaPago || hoy()) : '', refPago: pag ? (r.refPago || '') : '' });
      return { item: clone(f) };
    },
    saveTipoItem: ({ item }) => {
      const d = load();
      if (!String(item.nombre || '').trim()) throw new Error('El tipo de ítem necesita un nombre');
      const o = { id: item.id || nextId('TIP', d.tiposItem), nombre: item.nombre.trim(), orden: item.orden || d.tiposItem.length + 1, activo: item.activo !== false };
      upsert(d.tiposItem, 'id', o);
      return { item: clone(o) };
    },
    saveCategorias: ({ items }) => ({ items: items.map(item => actions.saveCategoria({ item }).item) }),
    saveTiposItem: ({ items }) => ({ items: items.map(item => actions.saveTipoItem({ item }).item) }),
    saveUnidades: ({ items }) => {
      const d = load();
      return { items: items.map(it => { if (!String(it.nombre || '').trim()) throw new Error('La unidad necesita un nombre');
        const o = { id: it.id || nextId('UNI', d.unidades), nombre: it.nombre.trim(), orden: it.orden || d.unidades.length + 1, activo: it.activo !== false }; upsert(d.unidades, 'id', o); return clone(o); }) };
    },
    saveTarifario: ({ items }) => {
      const d = load();
      return { items: items.map(it => {
        const cat = d.categorias.find(c => c.id === it.categoriaId);
        if (!String(it.nombre || '').trim()) throw new Error('El servicio necesita un nombre');
        if (!cat || cat.uso === 'Gestión') throw new Error('"' + it.nombre + '" necesita una categoría de oficio');
        if (!it.unidad || !(num(it.precio) > 0)) throw new Error('Completa unidad y precio de "' + it.nombre + '"');
        const o = { id: it.id || nextId('TAR', d.tarifario), nombre: it.nombre.trim(), categoriaId: cat.id, unidad: it.unidad, precio: Math.round(num(it.precio)), orden: it.orden || d.tarifario.length + 1, activo: it.activo !== false };
        upsert(d.tarifario, 'id', o); return clone(o); }) };
    },
    saveCliente: ({ item }) => saveSimple('clientes', 'CLI', item, o => { if (!String(o.razonSocial || '').trim()) throw new Error('El cliente necesita razón social'); }),
    saveSolicitante: ({ item }) => saveSimple('solicitantes', 'SOL', item, o => { if (!String(o.nombre || '').trim()) throw new Error('El solicitante necesita nombre'); }),
    saveUbicacion: ({ item }) => saveSimple('ubicaciones', 'UBI', item, o => { if (!String(o.edificio || '').trim()) throw new Error('La ubicación necesita el nombre del edificio'); }),
    saveOT: ({ ot, lineas }) => {
      const d = load();
      const esNueva = !ot.nOT;
      const previa = esNueva ? null : d.ots.find(o => String(o.nOT) === String(ot.nOT));
      if (!esNueva && !previa) throw new Error('No existe la OT ' + ot.nOT);
      if (previa && (previa.folioSII || String(previa.nOC || '').trim())) throw new Error('La OT tiene OC o está facturada y no se puede modificar');
      if (!String(ot.titulo || '').trim()) throw new Error('La OT necesita un título (ej: "Cambio de lavamanos")');
      const cli = d.clientes.find(c => c.id === ot.clienteId);
      if (!cli) throw new Error('Selecciona un cliente');
      const sol = d.solicitantes.find(s => s.id === ot.solicitanteId);
      const ubi = d.ubicaciones.find(u => u.id === ot.ubicacionId);
      const nOT = esNueva ? d.ots.reduce((m, o) => Math.max(m, +o.nOT), 0) + 1 : +ot.nOT;
      const ls = lineas.map((l, i) => {
        const r = Calc.normalizarLinea(l, i, d.config, d.categorias, d.tiposItem, d.tarifario || []);
        r.id = l.id || ('L-' + nOT + '-' + Math.random().toString(36).slice(2, 10));
        r.nOT = nOT; r.fecha = l.fecha || hoy();
        return r;
      });
      const subtotal = ls.reduce((s, l) => s + (l.incluida ? l.monto : 0), 0);
      const recargoPct = previa && previa.recargoPct !== '' && previa.recargoPct != null ? num(previa.recargoPct) : num(d.config.RECARGO_MATERIALES_PCT);
      const recargo = Math.round(subtotal * recargoPct / 100);
      const neto = subtotal + recargo;
      const ivaPct = previa && previa.ivaPct !== '' ? num(previa.ivaPct) : num(d.config.IVA_PCT);
      const iva = Math.round(neto * ivaPct / 100);
      const o = {
        nOT, fechaInicio: ot.fechaInicio || hoy(), clienteId: cli.id, cliente: cli.nombreCorto || cli.razonSocial,
        solicitanteId: sol ? sol.id : '', solicitante: sol ? sol.nombre : '',
        ubicacionId: ubi ? ubi.id : '', ubicacion: ubi ? ubi.edificio + (ubi.detalle ? ' — ' + ubi.detalle : '') : '',
        titulo: ot.titulo.trim(), descripcion: ot.descripcion || '', estado: ot.estado || 'Pendiente',
        nOC: previa ? previa.nOC : '', folioSII: previa ? previa.folioSII : '',
        neto, ivaPct, iva, total: neto + iva, notas: ot.notas || '', subtotal, recargoPct, recargo,
        creada: previa ? previa.creada : ahora(), actualizada: ahora(),
        detallar: String(ot.detallar || '').split(',').filter(x => d.tiposItem.some(t => t.id === x)).join(',')
      };
      upsert(d.ots, 'nOT', o);
      d.lineas = d.lineas.filter(l => String(l.nOT) !== String(nOT)).concat(ls);
      return { ot: clone(o), lineas: clone(ls) };
    }
  };

  function saveSimple(coll, prefix, item, validar) {
    const d = load();
    const o = Object.assign({}, item, { activo: item.activo !== false });
    validar(o);
    if (!o.id) o.id = nextId(prefix, d[coll]);
    upsert(d[coll], 'id', o);
    return { item: clone(o) };
  }

  async function call(action, body) {
    await new Promise(r => setTimeout(r, 150)); // simula la red
    const fn = actions[action];
    if (!fn) throw new Error('Acción desconocida: ' + action);
    const res = fn(clone(body || {}));
    persist();
    return res;
  }

  return { call, reset };
})();
