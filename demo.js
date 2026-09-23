/* Mantenciones OSC — Modo demo
 * Simula la API de Apps Script con datos de ejemplo guardados solo en este navegador.
 * Sirve para probar la app antes de conectar la planilla. Nada de esto llega a Google Sheets.
 */
const Demo = (() => {
  const KEY = 'osc_demo_db';

  function seed() {
    const hoy = new Date().toISOString().slice(0, 10);
    return {
      config: {
        HH_BASE: 10000, IVA_PCT: 19, RECARGO_MATERIALES_PCT: 10,
        EMPRESA_NOMBRE: 'Mantenciones OSC', EMPRESA_RAZON_SOCIAL: '', EMPRESA_RUT: '',
        EMPRESA_GIRO: '', EMPRESA_DIRECCION: '', EMPRESA_TELEFONO: '', EMPRESA_CORREO: ''
      },
      categorias: [
        { id: 'CAT-1', nombre: 'Gestión de compras', factor: 1, orden: 1, activa: true },
        { id: 'CAT-2', nombre: 'Mantenciones (varios)', factor: 1, orden: 2, activa: true },
        { id: 'CAT-3', nombre: 'Electricidad', factor: 1.5, orden: 3, activa: true },
        { id: 'CAT-4', nombre: 'Mueblería', factor: 1.3, orden: 4, activa: true },
        { id: 'CAT-5', nombre: 'Carpintería', factor: 1.3, orden: 5, activa: true },
        { id: 'CAT-6', nombre: 'Gasfitería', factor: 1.5, orden: 6, activa: true }
      ],
      clientes: [
        { id: 'CLI-1', razonSocial: 'Universidad de Concepción', nombreCorto: 'UdeC', rut: '', giro: '', direccion: '', comuna: 'Concepción', contacto: '', correo: '', telefono: '', activo: true }
      ],
      solicitantes: [
        { id: 'SOL-1', clienteId: 'CLI-1', nombre: 'Jefa de ejemplo', cargo: 'Jefa de Administración', unidad: 'Administración', correo: '', telefono: '', activo: true }
      ],
      ubicaciones: [
        { id: 'UBI-1', clienteId: 'CLI-1', edificio: 'Edificio de ejemplo', detalle: 'Baño 2° piso', activo: true }
      ],
      ots: [
        { nOT: 1, fechaInicio: hoy, clienteId: 'CLI-1', cliente: 'UdeC', solicitanteId: 'SOL-1', solicitante: 'Jefa de ejemplo',
          ubicacionId: 'UBI-1', ubicacion: 'Edificio de ejemplo — Baño 2° piso', titulo: 'Cambio de lavamanos',
          descripcion: 'La jefa pide cambiar el lavamanos del baño del 2° piso.', estado: 'En curso',
          nOC: '', folioSII: '', neto: 114500, ivaPct: 19, iva: 21755, total: 136255, notas: '', creada: hoy, actualizada: hoy }
      ],
      lineas: [
        { id: 'L-1-a', nOT: 1, orden: 1, fecha: hoy, tipo: 'Mano de obra', categoriaId: 'CAT-6', categoria: 'Gasfitería', descripcion: 'Desinstalación de lavamanos', horas: 1, hh: 10000, factor: 1.5, cantidad: '', costoUnit: '', recargoPct: '', monto: 15000, incluida: true },
        { id: 'L-1-b', nOT: 1, orden: 2, fecha: hoy, tipo: 'Mano de obra', categoriaId: 'CAT-1', categoria: 'Gestión de compras', descripcion: 'Cotización y compra de lavamanos e insumos', horas: 2, hh: 10000, factor: 1, cantidad: '', costoUnit: '', recargoPct: '', monto: 20000, incluida: true },
        { id: 'L-1-c', nOT: 1, orden: 3, fecha: hoy, tipo: 'Material', categoriaId: '', categoria: '', descripcion: 'Lavamanos loza blanco', horas: '', hh: '', factor: '', cantidad: 1, costoUnit: 45000, recargoPct: 10, monto: 49500, incluida: true },
        { id: 'L-1-d', nOT: 1, orden: 4, fecha: hoy, tipo: 'Material', categoriaId: '', categoria: '', descripcion: 'Lavamanos opción 2 (descartado)', horas: '', hh: '', factor: '', cantidad: 1, costoUnit: 62000, recargoPct: 10, monto: 68200, incluida: false },
        { id: 'L-1-e', nOT: 1, orden: 5, fecha: hoy, tipo: 'Mano de obra', categoriaId: 'CAT-6', categoria: 'Gasfitería', descripcion: 'Instalación de lavamanos y conexiones', horas: 2, hh: 10000, factor: 1.5, cantidad: '', costoUnit: '', recargoPct: '', monto: 30000, incluida: true }
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
  const hoy = () => new Date().toISOString().slice(0, 10);
  const ahora = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

  function upsert(arr, key, obj) {
    const i = arr.findIndex(x => String(x[key]) === String(obj[key]));
    if (i === -1) arr.push(obj); else arr[i] = obj;
  }

  const actions = {
    ping: () => ({ ok: true }),
    getAll: () => clone(load()),
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
      if (!(num(item.factor) > 0)) throw new Error('El factor debe ser mayor que 0');
      const o = { id: item.id || nextId('CAT', d.categorias), nombre: item.nombre.trim(), factor: num(item.factor), orden: item.orden || d.categorias.length + 1, activa: item.activa !== false };
      upsert(d.categorias, 'id', o);
      return { item: clone(o) };
    },
    saveCliente: ({ item }) => saveSimple('clientes', 'CLI', item, o => { if (!String(o.razonSocial || '').trim()) throw new Error('El cliente necesita razón social'); }),
    saveSolicitante: ({ item }) => saveSimple('solicitantes', 'SOL', item, o => { if (!String(o.nombre || '').trim()) throw new Error('El solicitante necesita nombre'); }),
    saveUbicacion: ({ item }) => saveSimple('ubicaciones', 'UBI', item, o => { if (!String(o.edificio || '').trim()) throw new Error('La ubicación necesita el nombre del edificio'); }),
    saveOT: ({ ot, lineas }) => {
      const d = load();
      const esNueva = !ot.nOT;
      const previa = esNueva ? null : d.ots.find(o => String(o.nOT) === String(ot.nOT));
      if (!esNueva && !previa) throw new Error('No existe la OT ' + ot.nOT);
      if (previa && previa.folioSII) throw new Error('La OT ya está facturada y no se puede editar');
      if (!String(ot.titulo || '').trim()) throw new Error('La OT necesita un título (ej: "Cambio de lavamanos")');
      const cli = d.clientes.find(c => c.id === ot.clienteId);
      if (!cli) throw new Error('Selecciona un cliente');
      const sol = d.solicitantes.find(s => s.id === ot.solicitanteId);
      const ubi = d.ubicaciones.find(u => u.id === ot.ubicacionId);
      const nOT = esNueva ? d.ots.reduce((m, o) => Math.max(m, +o.nOT), 0) + 1 : +ot.nOT;
      const ls = lineas.map((l, i) => {
        const r = Calc.normalizarLinea(l, i, d.config, d.categorias);
        r.id = l.id || ('L-' + nOT + '-' + Math.random().toString(36).slice(2, 10));
        r.nOT = nOT; r.fecha = l.fecha || hoy();
        return r;
      });
      const neto = ls.reduce((s, l) => s + (l.incluida ? l.monto : 0), 0);
      const ivaPct = previa && previa.ivaPct !== '' ? num(previa.ivaPct) : num(d.config.IVA_PCT);
      const iva = Math.round(neto * ivaPct / 100);
      const o = {
        nOT, fechaInicio: ot.fechaInicio || hoy(), clienteId: cli.id, cliente: cli.nombreCorto || cli.razonSocial,
        solicitanteId: sol ? sol.id : '', solicitante: sol ? sol.nombre : '',
        ubicacionId: ubi ? ubi.id : '', ubicacion: ubi ? ubi.edificio + (ubi.detalle ? ' — ' + ubi.detalle : '') : '',
        titulo: ot.titulo.trim(), descripcion: ot.descripcion || '', estado: ot.estado || 'Pendiente',
        nOC: previa ? previa.nOC : '', folioSII: previa ? previa.folioSII : '',
        neto, ivaPct, iva, total: neto + iva, notas: ot.notas || '',
        creada: previa ? previa.creada : ahora(), actualizada: ahora()
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
