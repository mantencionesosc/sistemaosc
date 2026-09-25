/* Mantenciones OSC — App web (v2: OT, gestión de compras, fotos, cotización PDF, Clientes, Config)
 * Fuente de verdad: Google Sheets vía Apps Script (Web App).
 */

// ════════════════════════════════════════════════════════ ALMACENAMIENTO LOCAL
const LS = {
  get(k, d = '') { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } }
};

let API_URL = LS.get('osc_url');
let TOKEN = LS.get('osc_token');
let DEMO = LS.get('osc_demo') === '1';

const S = { config: {}, categorias: [], tiposItem: [], unidades: [], tarifario: [], clientes: [], solicitantes: [], ubicaciones: [], ots: [], lineas: [], fotos: [], cotizaciones: [], ordenesCompra: [], facturas: [] };
const FOTOS = {};   // nOT -> [{...foto, data}] (se cargan al abrir la OT)
let SYNCED = false;
const APP_VERSION = '3.1.1';
const API_REQUERIDA = '3.1.1';
/** OT cerrada: con OC asignada o facturada. Se muestra como informe de solo lectura. */
const otCerrada = o => !!(o && (String(o.folioSII || '').trim() || String(o.nOC || '').trim()));  // versión mínima del Apps Script que necesita esta app
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
let API_VERSION = '';

// ════════════════════════════════════════════════════════ CÁLCULO (compartido con demo.js)
const TIPOS_LINEA = ['Compra', 'Tiempo de gestión', 'Mano de obra'];
const Calc = {
  num(v) {
    if (typeof v === 'number') return v;
    const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  },
  vacio: v => v === '' || v === null || v === undefined,
  tipoDe: l => (l.tipo === 'Material' ? 'Compra' : TIPOS_LINEA.includes(l.tipo) ? l.tipo : 'Mano de obra'),
  catGestion: cats => cats.find(c => c.uso === 'Gestión'),
  esCantidad: l => Calc.tipoDe(l) === 'Mano de obra' && l.modo === 'Cantidad',
  normalizarLinea(l, i, cfg, cats, tipos, tarifas = []) {
    const tipo = Calc.tipoDe(l);
    const n = 'La línea ' + (i + 1);
    const desc = String(l.descripcion || '').trim();
    if (!desc) throw new Error(n + ' no tiene descripción');
    const o = {
      id: l.id || '', nOT: l.nOT || '', orden: i + 1, fecha: l.fecha || '', tipo,
      categoriaId: '', categoria: '', descripcion: desc,
      horas: '', hh: '', factor: '', cantidad: '', costoUnit: '', recargoPct: '',
      monto: 0, incluida: l.incluida !== false, tipoItemId: '', tipoItem: '',
      modo: '', unidad: '', precioUnit: '', tarifaId: ''
    };
    if (tipo === 'Mano de obra' && l.modo === 'Cantidad') {
      const tarifa = l.tarifaId ? tarifas.find(t => t.id === l.tarifaId) : null;
      const cat = cats.find(c => c.id === (l.categoriaId || (tarifa && tarifa.categoriaId)));
      if (!cat) throw new Error(n + ' necesita una categoría');
      if (cat.uso === 'Gestión') throw new Error(n + ': el tiempo de gestión de compras va en su propio bloque');
      const cant = Calc.num(l.cantidad);
      if (!(cant > 0)) throw new Error(n + ': la cantidad debe ser mayor que 0');
      const unidad = String(l.unidad || (tarifa && tarifa.unidad) || '').trim();
      if (!unidad) throw new Error(n + ': falta la unidad');
      const precio = Calc.vacio(l.precioUnit) ? (tarifa ? Calc.num(tarifa.precio) : 0) : Calc.num(l.precioUnit);
      if (!(precio > 0)) throw new Error(n + ': falta el precio unitario');
      Object.assign(o, { modo: 'Cantidad', categoriaId: cat.id, categoria: cat.nombre, cantidad: cant, unidad, precioUnit: precio, tarifaId: tarifa ? tarifa.id : '' });
      o.monto = Calc.montoLinea(o);
      return o;
    }
    if (tipo === 'Compra') {
      const t = tipos.find(x => x.id === l.tipoItemId);
      if (!t) throw new Error(n + ': elige el tipo de ítem (material, insumo…)');
      const cant = Calc.num(l.cantidad);
      if (!(cant > 0)) throw new Error(n + ': la cantidad debe ser mayor que 0');
      o.tipoItemId = t.id; o.tipoItem = t.nombre;
      o.cantidad = cant;
      o.costoUnit = Calc.num(l.costoUnit);
      o.recargoPct = 0;  // desde v2.1 los ítems van al costo; el recargo se aplica sobre el neto de la OT
      o.monto = Calc.montoLinea(o);
      return o;
    }
    let cat;
    if (tipo === 'Tiempo de gestión') {
      cat = Calc.catGestion(cats);
      if (!cat) throw new Error('Falta la categoría de Gestión de compras (ejecuta setup en Apps Script)');
    } else {
      cat = cats.find(c => c.id === l.categoriaId);
      if (!cat) throw new Error(n + ' necesita una categoría');
      if (cat.uso === 'Gestión') throw new Error(n + ': el tiempo de gestión de compras va en su propio bloque');
    }
    const horas = Calc.num(l.horas);
    if (horas < 1) throw new Error(n + ': mínimo 1 hora');
    if (Math.round(horas * 2) !== horas * 2) throw new Error(n + ': las horas van de media en media (1; 1,5; 2…)');
    o.categoriaId = cat.id; o.categoria = cat.nombre; o.modo = 'Horas';
    o.horas = horas;
    o.hh = Calc.vacio(l.hh) ? Calc.num(cat.valorHora) : Calc.num(l.hh);   // valor hora congelado
    o.factor = Calc.vacio(l.factor) ? 1 : Calc.num(l.factor);
    o.monto = Calc.montoLinea(o);
    return o;
  },
  montoLinea(l) {
    if (Calc.esCantidad(l)) return Math.round(Calc.num(l.cantidad) * Calc.num(l.precioUnit));
    if (Calc.tipoDe(l) === 'Compra') return Math.round(Calc.num(l.cantidad) * Calc.num(l.costoUnit) * (1 + Calc.num(l.recargoPct) / 100));
    return Math.round(Calc.num(l.horas) * Calc.num(l.hh) * (Calc.vacio(l.factor) ? 1 : Calc.num(l.factor)));
  },
  subtotal: lineas => lineas.reduce((s, l) => s + (l.incluida !== false ? Calc.montoLinea(l) : 0), 0),
  // subtotal (costo) + recargo general = neto; + IVA = total
  totales(lineas, ivaPct, recargoPct = 0) {
    const subtotal = Calc.subtotal(lineas);
    const recargo = Math.round(subtotal * Calc.num(recargoPct) / 100);
    const neto = subtotal + recargo;
    const iva = Math.round(neto * Calc.num(ivaPct) / 100);
    return { subtotal, recargoPct: Calc.num(recargoPct), recargo, neto, iva, total: neto + iva };
  }
};

// ════════════════════════════════════════════════════════ FORMATO
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clp = n => '$' + Math.round(Calc.num(n)).toLocaleString('es-CL');
const dec = n => { const x = Calc.num(n); return Number.isInteger(x) ? String(x) : String(x).replace('.', ','); };
const otNum = n => 'OT-' + String(n).padStart(4, '0');
const hoyISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fechaCorta = iso => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return d && m ? `${d}-${m}-${y}` : iso; };
const soloDigitos = v => String(v ?? '').replace(/[^\d]/g, '');
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-');
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const $ = sel => document.querySelector(sel);

const ESTADOS = ['Pendiente', 'En curso', 'Terminada', 'Anulada'];
const ICONOS_CAT = { 'gestion de compras': '🛒', 'mantenciones (varios)': '🧰', 'electricidad': '⚡', 'muebleria': '🪑', 'carpinteria': '🪚', 'gasfiteria': '🚰' };
const iconoCat = nombre => ICONOS_CAT[norm(nombre)] || '🔧';

// ════════════════════════════════════════════════════════ TOAST
let toastTimer = null;
function toast(msg, tipo = 'load', dur = 2600) {
  const t = $('#toast');
  $('#toast-spin').style.display = tipo === 'load' ? 'block' : 'none';
  $('#toast-msg').textContent = msg;
  t.className = 'toast show' + (tipo === 'ok' ? ' ok' : tipo === 'err' ? ' err' : '');
  clearTimeout(toastTimer);
  if (tipo !== 'load') toastTimer = setTimeout(() => t.classList.remove('show'), tipo === 'err' ? 5000 : dur);
}

// ════════════════════════════════════════════════════════ API
async function api(action, body = {}, intento = 1, reqId = '') {
  if (DEMO) return Demo.call(action, body);
  // Mismo reqId en todos los reintentos: si Google ya ejecutó la petición pero no entregó la respuesta,
  // el servidor devuelve el resultado guardado en vez de repetir la escritura.
  reqId = reqId || Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  if (!API_URL || !TOKEN) throw new Error('Falta conectar la planilla (Config)');
  let texto;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(Object.assign({ action, token: TOKEN, reqId }, body)),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
    texto = await res.text();
  } catch (e) {
    if (intento < 3) { await new Promise(r => setTimeout(r, 800 * intento)); return api(action, body, intento + 1, reqId); }
    throw new Error('Sin conexión con la planilla. Revisa la señal e inténtalo de nuevo.');
  }
  let d;
  try { d = JSON.parse(texto); } catch (e) {
    // Google a veces entrega una página de error intermitente: se reintenta
    if (intento < 5) { await new Promise(r => setTimeout(r, 700 * intento)); return api(action, body, intento + 1, reqId); }
    throw new Error('Google no entregó una respuesta válida. Prueba de nuevo en unos segundos.');
  }
  if (d.error) throw new Error(d.error);
  return d;
}

async function sync(silencioso = false) {
  if (!DEMO && (!API_URL || !TOKEN)) { location.hash = '#/config'; return; }
  if (!silencioso) toast('Sincronizando…');
  try {
    const d = await api('getAll');
    Object.assign(S, {
      config: d.config || {}, categorias: d.categorias || [], tiposItem: d.tiposItem || [], unidades: d.unidades || [], tarifario: d.tarifario || [], clientes: d.clientes || [],
      solicitantes: d.solicitantes || [], ubicaciones: d.ubicaciones || [], ots: d.ots || [], lineas: d.lineas || [],
      fotos: d.fotos || [], cotizaciones: d.cotizaciones || [], ordenesCompra: d.ordenesCompra || [], facturas: d.facturas || []
    });
    SYNCED = true;
    API_VERSION = d.version || '(anterior a 2.1.2)';
    Object.keys(FOTOS).forEach(k => delete FOTOS[k]);  // se vuelven a pedir al abrir cada OT
    guardarCache();
    actualizarEstado();
    if (!silencioso) toast('✓ Sincronizado', 'ok', 1400); else $('#toast').classList.remove('show');
    if (!(ED && ED.dirty) && !MODAL_OPEN) { ED = null; render(); }
  } catch (e) {
    toast('Error: ' + e.message, 'err');
    actualizarEstado(e.message);
  }
}

function guardarCache() { if (!DEMO) LS.set('osc_cache', JSON.stringify(S)); }
function cargarCache() {
  if (DEMO) return;
  try { const c = JSON.parse(LS.get('osc_cache') || 'null'); if (c) Object.assign(S, c); } catch (e) { /* */ }
}

function actualizarEstado(err) {
  $('#demo-tag').classList.toggle('hidden', !DEMO);
  const st = $('#sync-status');
  if (err) { st.textContent = '⚠ ' + err; return; }
  if (!DEMO && (!API_URL || !TOKEN)) { st.textContent = 'Sin conectar'; return; }
  const activas = S.ots.filter(o => o.estado !== 'Anulada').length;
  st.textContent = (SYNCED ? 'Sincronizado' : 'Datos guardados') + ' · ' + activas + ' OT';
}

// ════════════════════════════════════════════════════════ RUTEO
let ED = null;          // estado del editor de OT
let MODAL_OPEN = false;
let RUTA_ACTUAL = '';

function ruta() { return (location.hash || '#/ots').replace(/^#\/?/, '').split('/'); }

window.addEventListener('hashchange', () => {
  const nueva = location.hash;
  if (ED && ED.dirty && nueva !== '#/ot/' + (ED.ot.nOT || 'nueva')) {
    if (!confirm('Tienes cambios sin guardar en esta OT. ¿Salir sin guardar?')) {
      history.replaceState(null, '', RUTA_ACTUAL);
      return;
    }
    ED = null;
  }
  cerrarModal();
  render();
});

window.addEventListener('beforeunload', e => { if (ED && ED.dirty) { e.preventDefault(); e.returnValue = ''; } });

function render() {
  const [vista, param] = ruta();
  RUTA_ACTUAL = location.hash || '#/ots';
  document.querySelectorAll('.bottom-nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === ({ ot: 'ots', cliente: 'clientes', cot: 'cots' }[vista] || vista)));
  document.body.classList.toggle('editor-open', vista === 'ot');
  const app = $('#app');
  if (vista !== 'ot') ED = null;
  if (vista !== 'ots' && vista !== '') SEL = null;
  if (vista === 'ot') return renderEditor(param);
  if (vista === 'clientes') return renderClientes(app);
  if (vista === 'cliente') return renderCliente(app, param);
  if (vista === 'config') return renderConfig(app);
  if (vista === 'cots') return renderCots(app);
  if (vista === 'fact') return renderFact(app);
  if (vista === 'cot') return renderCot(app, decodeURIComponent(param || ''));
  return renderOTs(app);
}

// ════════════════════════════════════════════════════════ LISTA DE OT
let FILTRO = LS.get('osc_filtro', 'activas');
let SEL = null;  // Set de N° OT seleccionadas para cotizar juntas (null = modo normal)
let BUSQ = '';

function renderOTs(app) {
  const filtros = [['activas', 'Activas'], ['Pendiente', 'Pendientes'], ['En curso', 'En curso'], ['Terminada', 'Terminadas'], ['Anulada', 'Anuladas'], ['todas', 'Todas']];
  const q = norm(BUSQ);
  let lista = S.ots.slice().sort((a, b) => b.nOT - a.nOT);
  if (FILTRO === 'activas') lista = lista.filter(o => o.estado !== 'Anulada');
  else if (FILTRO !== 'todas') lista = lista.filter(o => o.estado === FILTRO);
  if (q) lista = lista.filter(o => norm([otNum(o.nOT), o.nOT, o.titulo, o.ubicacion, o.solicitante, o.cliente, o.nOC, o.folioSII].join(' ')).includes(q));

  const sinHH = S.categorias.some(c => c.activa !== false && !(Calc.num(c.valorHora) > 0)) && (SYNCED || DEMO);
  app.innerHTML = `
    ${noConectado()}
    ${sinHH ? `<div class="warn-banner">⚠ Hay categorías sin <b>valor hora</b>. Sus líneas salen en $0. <a href="#/config">Ir a Config →</a></div>` : ''}
    <input class="search" type="search" id="busq" placeholder="Buscar OT, título, edificio, solicitante…" value="${esc(BUSQ)}">
    <div class="chips">${filtros.map(([k, t]) => `<button class="chip ${FILTRO === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
    ${SEL ? `<div class="sel-banner">Toca las OT que quieres cotizar juntas (mismo cliente).</div>`
          : (S.ots.length > 1 ? `<button class="btn btn-sec btn-sm" id="btn-sel" style="margin-bottom:10px">☑ Seleccionar para cotizar juntas</button>` : '')}
    <div id="ot-list" style="padding-bottom:${SEL ? 90 : 64}px">${lista.length ? lista.map(itemOT).join('') : `<div class="empty"><span class="big">📋</span>${S.ots.length ? 'No hay OT con este filtro.' : 'Aún no hay órdenes de trabajo.<br>Crea la primera con el botón de abajo.'}</div>`}</div>
    ${SEL ? `<div class="sel-bar"><div class="inner">
        <button class="btn btn-sec" id="sel-cancel">Cancelar</button>
        <button class="btn btn-primary" id="sel-ok" ${SEL.size ? '' : 'disabled'}>📄 Cotizar juntas (${SEL.size})</button>
      </div></div>` : `<button class="fab" id="btn-nueva">＋ Nueva OT</button>`}`;
  $('#busq').addEventListener('input', e => { BUSQ = e.target.value; const pos = e.target.selectionStart; renderOTs(app); const b = $('#busq'); b.focus(); b.setSelectionRange(pos, pos); });
  app.querySelectorAll('.chip').forEach(c => c.onclick = () => { FILTRO = c.dataset.f; LS.set('osc_filtro', FILTRO); renderOTs(app); });
  if (!SEL) {
    $('#btn-nueva').onclick = () => { location.hash = '#/ot/nueva'; };
    const bs = $('#btn-sel'); if (bs) bs.onclick = () => { SEL = new Set(); renderOTs(app); };
    return;
  }
  app.querySelectorAll('.ot-item').forEach(el => el.onclick = e => {
    e.preventDefault();
    const n = Number(el.dataset.n);
    const o = S.ots.find(x => Number(x.nOT) === n);
    if (o.estado === 'Anulada') { toast('Una OT anulada no se puede cotizar', 'err'); return; }
    if (otCerrada(o)) { toast(otNum(o.nOT) + ' ya tiene OC: no se puede volver a cotizar', 'err'); return; }
    if (SEL.has(n)) SEL.delete(n);
    else {
      const otro = [...SEL].map(k => S.ots.find(x => Number(x.nOT) === k)).find(x => x && x.clienteId !== o.clienteId);
      if (otro) { toast('Solo OT del mismo cliente (' + (otro.cliente || '') + ')', 'err'); return; }
      SEL.add(n);
    }
    renderOTs(app);
  });
  $('#sel-cancel').onclick = () => { SEL = null; renderOTs(app); };
  $('#sel-ok').onclick = () => abrirGenerar([...SEL].sort((a, b) => a - b));
}

function itemOT(o) {
  const nLin = S.lineas.filter(l => String(l.nOT) === String(o.nOT)).length;
  const sel = SEL && SEL.has(Number(o.nOT));
  return `<a class="ot-item e-${slug(o.estado)} ${sel ? 'sel' : ''}" href="#/ot/${o.nOT}" data-n="${o.nOT}">
    <div class="ot-top"><span class="ot-num">${SEL ? `<span class="selbox">${sel ? '☑' : '☐'}</span> ` : ''}${otNum(o.nOT)}</span><span>${fechaCorta(o.fechaInicio)}</span></div>
    <div class="ot-tit">${esc(o.titulo)}</div>
    <div class="ot-meta">${esc([o.ubicacion, o.solicitante].filter(Boolean).join(' · ') || o.cliente)}${(() => { const nf = S.fotos.filter(f => String(f.nOT) === String(o.nOT)).length, nc = cotsDeOT(o.nOT).filter(c => !['Reemplazada', 'Descartada'].includes(estadoCot(c))); return (nf ? ' · 📷 ' + nf : '') + (nc.length ? ' · 📄 ' + nc.map(c => c.numero || 'v' + c.version).join(', ') : ''); })()}</div>
    <div class="ot-bottom">
      <div class="badges">
        <span class="badge b-${slug(o.estado)}">${esc(o.estado)}</span>
        ${o.nOC ? `<span class="badge b-oc">OC ${esc(o.nOC)}</span>` : ''}
        ${o.folioSII ? `<span class="badge b-folio">Folio ${esc(o.folioSII)}</span>` : ''}
      </div>
      <div class="ot-total">${clp(o.total)}<div class="hint" style="text-align:right;margin:0">${nLin} línea${nLin === 1 ? '' : 's'}</div></div>
    </div>
  </a>`;
}

function noConectado() {
  if (DEMO || (API_URL && TOKEN)) return '';
  return `<div class="warn-banner">👋 Para empezar, conecta la planilla de Google o prueba el <b>modo demo</b>. <a href="#/config">Ir a Config →</a></div>`;
}

// ════════════════════════════════════════════════════════ EDITOR DE OT
const clientesActivos = () => S.clientes.filter(c => c.activo !== false);
const catsActivas = () => S.categorias.filter(c => c.activa !== false).sort((a, b) => Calc.num(a.orden) - Calc.num(b.orden));

function renderEditor(param) {
  const app = $('#app');
  if (!ED || String(ED.ot.nOT || 'nueva') !== String(param)) {
    if (param === 'nueva') {
      const cls = clientesActivos();
      ED = {
        ot: { nOT: '', fechaInicio: hoyISO(), clienteId: cls.length === 1 ? cls[0].id : '', solicitanteId: '', ubicacionId: '', titulo: '', descripcion: '', estado: 'Pendiente', notas: '', nOC: '', folioSII: '', ivaPct: '', detallar: '' },
        lineas: [], dirty: false
      };
    } else {
      const ot = S.ots.find(o => String(o.nOT) === String(param));
      if (!ot) { app.innerHTML = `<div class="empty"><span class="big">🔍</span>No se encontró la ${esc(otNum(param))}.<br><br><a class="btn btn-sec" href="#/ots">Volver</a></div>`; return; }
      ED = {
        ot: JSON.parse(JSON.stringify(ot)),
        lineas: S.lineas.filter(l => String(l.nOT) === String(param)).sort((a, b) => a.orden - b.orden).map(l => JSON.parse(JSON.stringify(l))),
        dirty: false
      };
    }
  }
  const o = ED.ot;
  const ro = otCerrada(o);
  if (ro) return renderInformeOT(app, o, ED.lineas);
  const cls = clientesActivos();
  const sols = S.solicitantes.filter(s => s.clienteId === o.clienteId && (s.activo !== false || s.id === o.solicitanteId));
  const ubis = S.ubicaciones.filter(u => u.clienteId === o.clienteId && (u.activo !== false || u.id === o.ubicacionId));

  app.innerHTML = `
    <div class="ed-head">
      <button class="back" id="ed-back" aria-label="Volver">←</button>
      <h2>${o.nOT ? otNum(o.nOT) : 'Nueva OT'}</h2>
      <span class="dirty ${ED.dirty ? '' : 'hidden'}" id="ed-dirty">Sin guardar</span>
    </div>
    ${ro ? `<div class="readonly-banner">🧾 Facturada con folio <b>${esc(o.folioSII)}</b>. Solo lectura.</div>` : ''}

    <div class="card">
      <h2>👤 Cliente</h2>
      <label for="f-fecha">Fecha</label>
      <input type="date" id="f-fecha" value="${esc(String(o.fechaInicio || '').slice(0, 10))}" ${ro ? 'readonly' : ''}>

      ${cls.length > 1 || !o.clienteId ? `<label for="f-cliente">Cliente</label>
        <select id="f-cliente" ${ro ? 'disabled' : ''}><option value="">Seleccionar…</option>${cls.map(c => `<option value="${esc(c.id)}" ${c.id === o.clienteId ? 'selected' : ''}>${esc(c.nombreCorto || c.razonSocial)}</option>`).join('')}</select>`
      : `<label>Cliente</label><input readonly value="${esc((cls.find(c => c.id === o.clienteId) || {}).razonSocial || (cls[0] || {}).razonSocial || '')}">`}

      <label for="f-sol">Solicitante</label>
      <div class="select-add">
        <select id="f-sol" ${ro || !o.clienteId ? 'disabled' : ''}><option value="">—</option>${sols.map(s => `<option value="${esc(s.id)}" ${s.id === o.solicitanteId ? 'selected' : ''}>${esc(s.nombre)}${s.unidad ? ' · ' + esc(s.unidad) : ''}</option>`).join('')}</select>
        ${ro ? '' : `<button class="btn btn-sec" id="add-sol" type="button" title="Nuevo solicitante" ${!o.clienteId ? 'disabled' : ''}>＋</button>`}
      </div>

      <label for="f-ubi">Ubicación</label>
      <div class="select-add">
        <select id="f-ubi" ${ro || !o.clienteId ? 'disabled' : ''}><option value="">—</option>${ubis.map(u => `<option value="${esc(u.id)}" ${u.id === o.ubicacionId ? 'selected' : ''}>${esc(u.edificio)}${u.detalle ? ' — ' + esc(u.detalle) : ''}</option>`).join('')}</select>
        ${ro ? '' : `<button class="btn btn-sec" id="add-ubi" type="button" title="Nueva ubicación" ${!o.clienteId ? 'disabled' : ''}>＋</button>`}
      </div>
    </div>

    <div class="card">
      <h2>📝 Trabajo</h2>
      <label for="f-titulo">¿Qué pidió el cliente?</label>
      <input id="f-titulo" placeholder="Ej: Cambio de lavamanos" value="${esc(o.titulo)}" ${ro ? 'readonly' : ''}>

      <label for="f-desc">Detalle del pedido</label>
      <textarea id="f-desc" placeholder="Ej: Desinstalación e instalación de lavamanos en baño del segundo piso" ${ro ? 'readonly' : ''}>${esc(o.descripcion)}</textarea>

      <label>Estado del trabajo</label>
      <div class="seg" id="f-estado">${ESTADOS.map(e => `<button type="button" data-v="${e}" class="${o.estado === e ? 'on' : ''}" ${ro ? 'disabled' : ''}>${e}</button>`).join('')}</div>
    </div>

    ${bloqueCompras(ro)}

    <div class="card">
      <h2>🛠 Mano de obra <span class="extra">${clp(Calc.subtotal(grupo('Mano de obra').map(x => x[0])))}</span></h2>
      ${grupo('Mano de obra').map(([l, i]) => htmlLinea(l, i)).join('') || `<p class="hint">Cada acción de oficio: desinstalación, instalación, reparación…</p>`}
      ${ro ? '' : `<button class="btn btn-primary btn-full" style="margin-top:12px" id="add-mo">＋ Mano de obra</button>`}
    </div>

    <div class="card"><h2>🧮 Resumen</h2><div id="ed-resumen"></div></div>

    <div class="card" id="fotos-card"></div>
    <div class="card" id="cot-card"></div>

    <div class="card">
      <label for="f-notas">Notas internas</label>
      <textarea id="f-notas" placeholder="Solo para ustedes, no sale en la cotización" ${ro ? 'readonly' : ''}>${esc(o.notas)}</textarea>
      ${o.nOC || o.folioSII ? `<p class="hint" style="margin-top:10px">${o.nOC ? 'OC: <b>' + esc(o.nOC) + '</b>' : ''} ${o.folioSII ? ' · Folio SII: <b>' + esc(o.folioSII) + '</b>' : ''}</p>` : ''}
    </div>

    <div class="ed-footer"><div class="inner">
      <div class="tot" id="ed-tot"></div>
      ${ro ? '' : `<button class="btn btn-primary" id="ed-save" ${ED.dirty ? '' : 'disabled'}>Guardar</button>`}
    </div></div>`;

  pintarTotales();
  renderFotosCard();
  renderCotCard();

  $('#ed-back').onclick = () => { location.hash = '#/ots'; };
  if (ro) { app.querySelectorAll('.linea').forEach(el => el.onclick = () => abrirLinea(+el.dataset.i, true)); return; }

  const bind = (id, campo, ev = 'input') => $(id).addEventListener(ev, e => { o[campo] = e.target.value; marcar(); });
  bind('#f-titulo', 'titulo'); bind('#f-fecha', 'fechaInicio', 'change'); bind('#f-desc', 'descripcion'); bind('#f-notas', 'notas');
  $('#f-sol').addEventListener('change', e => { o.solicitanteId = e.target.value; marcar(); });
  $('#f-ubi').addEventListener('change', e => { o.ubicacionId = e.target.value; marcar(); });
  const fc = $('#f-cliente');
  if (fc) fc.addEventListener('change', e => { o.clienteId = e.target.value; o.solicitanteId = ''; o.ubicacionId = ''; marcar(); renderEditor(param); });
  $('#f-estado').querySelectorAll('button').forEach(b => b.onclick = () => {
    o.estado = b.dataset.v; marcar();
    $('#f-estado').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  $('#add-sol').onclick = () => modalSolicitante({ clienteId: o.clienteId }, s => { o.solicitanteId = s.id; marcar(); renderEditor(param); });
  $('#add-ubi').onclick = () => modalUbicacion({ clienteId: o.clienteId }, u => { o.ubicacionId = u.id; marcar(); renderEditor(param); });
  $('#add-mo').onclick = () => abrirLinea(-1, false, 'Mano de obra');
  $('#add-compra').onclick = () => abrirLinea(-1, false, 'Compra');
  $('#add-tiempo').onclick = () => abrirLinea(-1, false, 'Tiempo de gestión');
  app.querySelectorAll('.linea').forEach(el => el.onclick = () => abrirLinea(+el.dataset.i));
  $('#ed-save').onclick = guardarOT;
}

// Líneas de un tipo, con su índice en ED.lineas
const grupo = tipo => ED.lineas.map((l, i) => [l, i]).filter(([l]) => Calc.tipoDe(l) === tipo);

function bloqueCompras(ro) {
  const compras = grupo('Compra'), tiempos = grupo('Tiempo de gestión');
  const sub = Calc.subtotal(compras.concat(tiempos).map(x => x[0]));
  return `<div class="card">
    <h2>🛒 Gestión de compras <span class="extra">${clp(sub)}</span></h2>
    <div class="sub-h">Ítems comprados o cotizados</div>
    ${compras.map(([l, i]) => htmlLinea(l, i)).join('') || `<p class="hint">Materiales, insumos, arriendo de herramientas, flete… Anota también las alternativas cotizadas y marca la elegida.</p>`}
    ${ro ? '' : `<button class="btn btn-sec btn-full" style="margin-top:10px" id="add-compra">＋ Ítem de compra</button>`}
    <div class="sub-h" style="margin-top:18px">Tiempo de gestión</div>
    ${tiempos.map(([l, i]) => htmlLinea(l, i)).join('') || `<p class="hint">Horas usadas en cotizar, comprar y retirar.</p>`}
    ${ro ? '' : `<button class="btn btn-sec btn-full" style="margin-top:10px" id="add-tiempo">＋ Tiempo de gestión</button>`}
  </div>`;
}

function htmlLinea(l, i) {
  const tipo = Calc.tipoDe(l);
  const compra = tipo === 'Compra';
  const calc = Calc.esCantidad(l)
    ? `${dec(l.cantidad)} ${esc(l.unidad)} × ${clp(l.precioUnit)}`
    : compra
    ? `${dec(l.cantidad)} × ${clp(l.costoUnit)}${Calc.num(l.recargoPct) ? ' + ' + dec(l.recargoPct) + '%' : ''}`
    : `${dec(l.horas)} h × ${clp(l.hh)}${Calc.vacio(l.factor) || Calc.num(l.factor) === 1 ? '' : ' × ' + dec(l.factor)}`;
  const etiqueta = compra ? (l.tipoItem || 'Ítem') : tipo === 'Tiempo de gestión' ? 'Tiempo de gestión' : l.categoria;
  const icono = compra ? '📦' : tipo === 'Tiempo de gestión' ? '⏱' : iconoCat(l.categoria);
  const excl = l.incluida === false ? `<span class="tag-excl">${compra ? 'Descartado' : 'No incluida'}</span>` : '';
  return `<div class="linea ${l.incluida === false ? 'excluida' : ''}" data-i="${i}">
    <div class="l-ico">${icono}</div>
    <div class="l-body">
      <div class="l-cat">${esc(etiqueta)}${excl}</div>
      <div class="l-desc">${esc(l.descripcion)}</div>
      <div class="l-calc">${calc}${l.fecha ? ' · <span class="f">' + fechaCorta(l.fecha) + '</span>' : ''}</div>
    </div>
    <div class="l-monto">${clp(Calc.montoLinea(l))}</div>
  </div>`;
}

function marcar() {
  if (!ED) return;
  ED.dirty = true;
  const d = $('#ed-dirty'); if (d) d.classList.remove('hidden');
  const b = $('#ed-save'); if (b) b.disabled = false;
}

const pctOT = (o, campo, clave) => Calc.vacio(o[campo]) ? Calc.num(S.config[clave]) : Calc.num(o[campo]);
const totalesED = () => Calc.totales(ED.lineas, pctOT(ED.ot, 'ivaPct', 'IVA_PCT'), pctOT(ED.ot, 'recargoPct', 'RECARGO_MATERIALES_PCT'));

function pintarTotales() {
  const t = totalesED();
  $('#ed-tot').innerHTML = `Neto ${clp(t.neto)} · IVA ${clp(t.iva)}<br><b>Total ${clp(t.total)}</b>`;
  const r = $('#ed-resumen');
  if (r) r.innerHTML = `
    <div class="res-row"><span>Subtotal (costo)</span><span>${clp(t.subtotal)}</span></div>
    <div class="res-row"><span>Recargo ${dec(t.recargoPct)}% <small>(no se muestra al cliente)</small></span><span>${clp(t.recargo)}</span></div>
    <div class="res-row fuerte"><span>Neto</span><span>${clp(t.neto)}</span></div>
    <div class="res-row"><span>IVA ${dec(pctOT(ED.ot, 'ivaPct', 'IVA_PCT'))}%</span><span>${clp(t.iva)}</span></div>
    <div class="res-row total"><span>Total</span><span>${clp(t.total)}</span></div>`;
}

async function guardarOT() {
  const o = ED.ot;
  if (!String(o.titulo || '').trim()) { toast('Escribe qué pidió el cliente (título)', 'err'); $('#f-titulo').focus(); return; }
  if (!o.clienteId) { toast('Selecciona un cliente', 'err'); return; }
  const btn = $('#ed-save'); btn.disabled = true;
  toast('Guardando…');
  try {
    const ordenadas = TIPOS_LINEA.flatMap(t => ED.lineas.filter(l => Calc.tipoDe(l) === t));
    const r = await api('saveOT', { ot: o, lineas: ordenadas });
    S.ots = S.ots.filter(x => String(x.nOT) !== String(r.ot.nOT)).concat([r.ot]);
    S.lineas = S.lineas.filter(x => String(x.nOT) !== String(r.ot.nOT)).concat(r.lineas);
    guardarCache();
    const eraNueva = !o.nOT;
    ED = null;
    toast('✓ ' + otNum(r.ot.nOT) + (eraNueva ? ' creada' : ' guardada'), 'ok');
    actualizarEstado();
    location.hash = '#/ots';  // vuelve a la lista de OT
  } catch (e) {
    toast('No se guardó: ' + e.message, 'err');
    btn.disabled = false;
  }
}

// ── Modal de línea ──────────────────────────────────
const tiposActivos = () => S.tiposItem.filter(t => t.activo !== false).sort((a, b) => Calc.num(a.orden) - Calc.num(b.orden));

function abrirLinea(i, soloLectura = false, tipoNuevo = 'Mano de obra') {
  const nueva = i < 0;
  const ro = soloLectura;
  const l = nueva
    ? { tipo: tipoNuevo, fecha: hoyISO(), categoriaId: '', descripcion: '', horas: 1, hh: '', factor: '', cantidad: 1, costoUnit: '', recargoPct: '', incluida: true, tipoItemId: '', tipoItem: '' }
    : JSON.parse(JSON.stringify(ED.lineas[i]));
  l.tipo = Calc.tipoDe(l);
  const gestion = Calc.catGestion(S.categorias);
  // Valores congelados al crear la línea
  if (nueva) {
    l.hh = ''; l.factor = 1; l.recargoPct = 0;
    if (l.tipo === 'Tiempo de gestión' && gestion) { l.categoriaId = gestion.id; l.categoria = gestion.nombre; l.hh = Calc.num(gestion.valorHora); }
    if (l.tipo === 'Compra') { const t = tiposActivos()[0]; if (t) { l.tipoItemId = t.id; l.tipoItem = t.nombre; } }
    if (l.tipo === 'Mano de obra') { l.modo = 'Horas'; l.unidad = ''; l.precioUnit = ''; l.tarifaId = ''; }
  }
  const porCant = () => l.tipo === 'Mano de obra' && l.modo === 'Cantidad';
  const tarifasActivas = () => S.tarifario.filter(t => t.activo !== false).sort((a, b) => Calc.num(a.orden) - Calc.num(b.orden));
  const unidadesActivas = () => S.unidades.filter(u => u.activo !== false).sort((a, b) => Calc.num(a.orden) - Calc.num(b.orden));
  const compra = l.tipo === 'Compra', tiempo = l.tipo === 'Tiempo de gestión';
  const titulo = compra ? 'Ítem de compra' : tiempo ? 'Tiempo de gestión' : 'Mano de obra';
  const mismoGrupo = ED.lineas.map((x, k) => k).filter(k => Calc.tipoDe(ED.lineas[k]) === l.tipo);
  const pos = mismoGrupo.indexOf(i);

  function cuerpo() {
    const catActual = S.categorias.find(c => c.id === l.categoriaId);
    const oficios = catsActivas().filter(c => c.uso !== 'Gestión');
    const catsLista = catActual && catActual.activa === false && catActual.uso !== 'Gestión' ? oficios.concat([catActual]) : oficios;
    const vhActual = catActual ? Calc.num(catActual.valorHora) : 0;
    const difiere = !compra && !porCant() && !nueva && catActual && Calc.num(Calc.montoLinea(Object.assign({}, l, { horas: 1 }))) !== vhActual;
    const tarifa = porCant() && l.tarifaId ? S.tarifario.find(t => t.id === l.tarifaId) : null;
    const difierePrecio = porCant() && !nueva && tarifa && Calc.num(tarifa.precio) !== Calc.num(l.precioUnit);
    const unis = unidadesActivas().map(u => u.nombre);
    if (l.unidad && !unis.includes(l.unidad)) unis.push(l.unidad);
    const tipos = tiposActivos();
    const tipoActual = S.tiposItem.find(t => t.id === l.tipoItemId);
    const tiposLista = tipoActual && tipoActual.activo === false ? tipos.concat([tipoActual]) : tipos;
    return `
      <h3>${nueva ? titulo : titulo + ' · editar'}<button class="x" data-cerrar aria-label="Cerrar">✕</button></h3>
      ${compra ? `<label for="l-tipoitem">Tipo de ítem</label>
        <select id="l-tipoitem" ${ro ? 'disabled' : ''}>${tiposLista.map(t => `<option value="${esc(t.id)}" ${t.id === l.tipoItemId ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select>` : ''}
      ${tiempo ? `<p class="hint" style="margin:0 0 4px">🛒 ${esc(gestion ? gestion.nombre : 'Gestión de compras')} · ${clp(l.hh)} por hora</p>` : ''}
      ${l.tipo === 'Mano de obra' ? `<div class="seg" id="l-modo" style="margin-bottom:4px">
          <button type="button" data-v="Horas" class="${!porCant() ? 'on' : ''}" ${ro ? 'disabled' : ''}>⏱ Por horas</button>
          <button type="button" data-v="Cantidad" class="${porCant() ? 'on' : ''}" ${ro ? 'disabled' : ''}>📐 Por cantidad</button>
        </div>
        ${porCant() ? `<label for="l-tarifa">Tarifario</label>
          <select id="l-tarifa" ${ro ? 'disabled' : ''}><option value="">— Precio libre —</option>${tarifasActivas().concat(tarifa && tarifa.activo === false ? [tarifa] : []).map(t => `<option value="${esc(t.id)}" ${t.id === l.tarifaId ? 'selected' : ''}>${esc(t.nombre)} · ${clp(t.precio)} / ${esc(t.unidad)}</option>`).join('')}</select>` : ''}
        <label>Categoría</label>
        <div class="cat-grid" id="l-cats">${catsLista.map(c => `<button type="button" class="cat-btn ${c.id === l.categoriaId ? 'on' : ''}" data-id="${esc(c.id)}" ${ro ? 'disabled' : ''}>${iconoCat(c.nombre)} ${esc(c.nombre)}${porCant() ? '' : `<small>${clp(c.valorHora)} / h</small>`}</button>`).join('')}</div>` : ''}
      <label for="l-desc">${compra ? '¿Qué se compró o cotizó?' : tiempo ? '¿Qué gestión se hizo?' : '¿Qué se hizo?'}</label>
      <textarea id="l-desc" placeholder="${compra ? 'Ej: Lavamanos loza blanco (Sodimac)' : tiempo ? 'Ej: Cotizar en 2 ferreterías' : 'Ej: Desinstalación de lavamanos'}" ${ro ? 'readonly' : ''}>${esc(l.descripcion)}</textarea>
      ${porCant() ? `<div class="row">
          <div><label for="l-cant">Cantidad</label><input id="l-cant" inputmode="decimal" value="${dec(l.cantidad)}" ${ro ? 'readonly' : ''}></div>
          <div><label for="l-unidad">Unidad</label><select id="l-unidad" ${ro ? 'disabled' : ''}><option value="">—</option>${unis.map(u => `<option ${u === l.unidad ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></div>
        </div>
        <label for="l-precio">Precio por ${esc(l.unidad || 'unidad')}</label>
        <input id="l-precio" inputmode="numeric" placeholder="$" value="${Calc.vacio(l.precioUnit) ? '' : Math.round(Calc.num(l.precioUnit)).toLocaleString('es-CL')}" ${ro ? 'readonly' : ''}>`
      : !compra ? `<label for="l-horas">Horas (mínimo 1, de media en media)</label>
        <div class="stepper">
          <button type="button" id="h-menos" ${ro ? 'disabled' : ''}>−</button>
          <input id="l-horas" inputmode="decimal" value="${dec(l.horas)}" ${ro ? 'readonly' : ''}>
          <button type="button" id="h-mas" ${ro ? 'disabled' : ''}>＋</button>
        </div>`
      : `<div class="row">
          <div><label for="l-cant">Cantidad</label><input id="l-cant" inputmode="decimal" value="${dec(l.cantidad)}" ${ro ? 'readonly' : ''}></div>
          <div><label for="l-costo">Costo unitario $</label><input id="l-costo" inputmode="numeric" placeholder="0" value="${l.costoUnit === '' ? '' : Math.round(Calc.num(l.costoUnit)).toLocaleString('es-CL')}" ${ro ? 'readonly' : ''}></div>
        </div>
`}
      <label for="l-fecha">Fecha</label>
      <input type="date" id="l-fecha" value="${esc(String(l.fecha || '').slice(0, 10))}" ${ro ? 'readonly' : ''}>
      <label class="check"><input type="checkbox" id="l-incl" ${l.incluida !== false ? 'checked' : ''} ${ro ? 'disabled' : ''}> ${compra ? 'Elegido (se cobra)' : 'Incluir en la cotización'}</label>
      ${compra ? `<p class="hint" style="margin-top:4px">Desmárcalo si es una alternativa descartada: queda anotada pero no suma.</p>` : ''}
      <div class="preview"><div class="calc" id="l-calc"></div><div class="monto" id="l-monto"></div></div>
      ${difierePrecio && !ro ? `<div class="congelado">Esta línea usa el precio de cuando se creó (${clp(l.precioUnit)}). Precio actual del tarifario: ${clp(tarifa.precio)}. <button type="button" id="l-act-precio">Usar precio actual</button></div>` : ''}
      ${difiere && !ro ? `<div class="congelado">Esta línea usa el valor hora de cuando se creó (${clp(Calc.montoLinea(Object.assign({}, l, { horas: 1 })))}). Valor actual de ${esc(catActual.nombre)}: ${clp(vhActual)}. <button type="button" id="l-actualizar">Usar valor actual</button></div>` : ''}
      ${ro ? '' : `<div class="btn-row">
        ${nueva ? '' : '<button class="btn btn-danger" id="l-del">Eliminar</button>'}
        <button class="btn btn-primary" id="l-ok">${nueva ? 'Agregar' : 'Listo'}</button>
      </div>
      ${nueva || mismoGrupo.length < 2 ? '' : `<div class="mini-actions">
        <button class="btn btn-sec btn-sm" id="l-up" ${pos === 0 ? 'disabled' : ''}>↑ Subir</button>
        <button class="btn btn-sec btn-sm" id="l-down" ${pos === mismoGrupo.length - 1 ? 'disabled' : ''}>↓ Bajar</button>
      </div>`}`}`;
  }

  function preview() {
    $('#l-calc').textContent = porCant()
      ? `${dec(l.cantidad)} ${l.unidad || ''} × ${Calc.vacio(l.precioUnit) ? '—' : clp(l.precioUnit)}`
      : compra
      ? `${dec(l.cantidad)} × ${clp(l.costoUnit)}`
      : `${dec(l.horas)} h × ${Calc.vacio(l.hh) ? '—' : clp(Calc.montoLinea(Object.assign({}, l, { horas: 1 })))}`;
    $('#l-monto').textContent = clp(Calc.montoLinea(l));
  }

  function montar() {
    const m = abrirModal(cuerpo());
    preview();
    if (ro) return;
    const desc = $('#l-desc');
    const guardarDesc = () => { l.descripcion = desc.value; };
    desc.addEventListener('input', guardarDesc);
    m.querySelectorAll('#l-cats .cat-btn').forEach(b => b.onclick = () => {
      guardarDesc();
      const c = S.categorias.find(x => x.id === b.dataset.id);
      l.categoriaId = c.id; l.categoria = c.nombre;
      if (!porCant()) { l.hh = Calc.num(c.valorHora); l.factor = 1; }
      montar();
    });
    m.querySelectorAll('#l-modo button').forEach(b => b.onclick = () => {
      guardarDesc(); l.modo = b.dataset.v;
      if (porCant() && Calc.vacio(l.cantidad)) l.cantidad = 1;
      montar();
    });
    $('#l-fecha').addEventListener('change', e => { l.fecha = e.target.value; });
    $('#l-incl').addEventListener('change', e => { l.incluida = e.target.checked; });
    if (porCant()) {
      $('#l-tarifa').addEventListener('change', e => {
        guardarDesc();
        const t = S.tarifario.find(x => x.id === e.target.value);
        if (t) {
          const c = S.categorias.find(x => x.id === t.categoriaId);
          Object.assign(l, { tarifaId: t.id, unidad: t.unidad, precioUnit: Calc.num(t.precio) });
          if (c) { l.categoriaId = c.id; l.categoria = c.nombre; }
          if (!String(l.descripcion || '').trim()) l.descripcion = t.nombre;
        } else l.tarifaId = '';
        montar();
      });
      $('#l-cant').addEventListener('input', e => { l.cantidad = Calc.num(e.target.value); preview(); });
      $('#l-unidad').addEventListener('change', e => { l.unidad = e.target.value; preview(); const lb = m.querySelector('label[for="l-precio"]'); if (lb) lb.textContent = 'Precio por ' + (l.unidad || 'unidad'); });
      const pr = $('#l-precio');
      pr.addEventListener('input', () => {
        const d = soloDigitos(pr.value);
        l.precioUnit = d === '' ? '' : Number(d);
        pr.value = d === '' ? '' : Number(d).toLocaleString('es-CL');
        preview();
      });
      const ap = $('#l-act-precio');
      if (ap) ap.onclick = () => { guardarDesc(); const t = S.tarifario.find(x => x.id === l.tarifaId); l.precioUnit = Calc.num(t.precio); montar(); };
    } else if (!compra) {
      const hi = $('#l-horas');
      const setH = h => { l.horas = Math.max(1, Math.round(h * 2) / 2); hi.value = dec(l.horas); preview(); };
      $('#h-menos').onclick = () => setH(Calc.num(l.horas) - 0.5);
      $('#h-mas').onclick = () => setH(Calc.num(l.horas) + 0.5);
      hi.addEventListener('input', () => { l.horas = Calc.num(hi.value); preview(); });
      hi.addEventListener('blur', () => setH(Calc.num(hi.value)));
      const act = $('#l-actualizar');
      if (act) act.onclick = () => {
        guardarDesc();
        const c = S.categorias.find(x => x.id === l.categoriaId);
        l.hh = Calc.num(c.valorHora); l.factor = 1; montar();
      };
    } else {
      $('#l-tipoitem').addEventListener('change', e => {
        const t = S.tiposItem.find(x => x.id === e.target.value);
        l.tipoItemId = t.id; l.tipoItem = t.nombre;
      });
      $('#l-cant').addEventListener('input', e => { l.cantidad = Calc.num(e.target.value); preview(); });
      const co = $('#l-costo');
      co.addEventListener('input', () => {
        const d = soloDigitos(co.value);
        l.costoUnit = d === '' ? '' : Number(d);
        co.value = d === '' ? '' : Number(d).toLocaleString('es-CL');
        preview();
      });
    }
    $('#l-ok').onclick = () => {
      guardarDesc();
      if (compra && l.costoUnit === '') l.costoUnit = 0;
      if (porCant()) { l.horas = ''; l.hh = ''; l.factor = ''; }
      else if (l.tipo === 'Mano de obra') { l.modo = 'Horas'; l.unidad = ''; l.precioUnit = ''; l.tarifaId = ''; }
      if (!compra && !porCant() && Calc.vacio(l.hh)) { const c = S.categorias.find(x => x.id === l.categoriaId); if (c) l.hh = Calc.num(c.valorHora); }
      try {
        Calc.normalizarLinea(l, nueva ? ED.lineas.length : i, S.config, S.categorias, S.tiposItem, S.tarifario);
      } catch (e) { const msg = e.message.replace(/^La línea \d+:? ?/, ''); toast(msg.charAt(0).toUpperCase() + msg.slice(1), 'err'); return; }
      l.monto = Calc.montoLinea(l);
      if (nueva) ED.lineas.push(l); else ED.lineas[i] = l;
      marcar(); cerrarModal(); renderEditor(ruta()[1]);
    };
    const del = $('#l-del');
    if (del) del.onclick = () => {
      if (!confirm('¿Eliminar esta línea?')) return;
      ED.lineas.splice(i, 1); marcar(); cerrarModal(); renderEditor(ruta()[1]);
    };
    const mover = d => {
      guardarDesc(); ED.lineas[i] = l;
      const j = mismoGrupo[pos + d];
      [ED.lineas[i], ED.lineas[j]] = [ED.lineas[j], ED.lineas[i]];
      marcar(); cerrarModal(); renderEditor(ruta()[1]);
    };
    const up = $('#l-up'); if (up) up.onclick = () => mover(-1);
    const dn = $('#l-down'); if (dn) dn.onclick = () => mover(1);
  }
  montar();
}

// ════════════════════════════════════════════════════════ FOTOS
const ETAPAS_FOTO = ['Antes', 'Durante', 'Después'];
const etapaSugerida = () => ({ 'Pendiente': 'Antes', 'En curso': 'Durante', 'Terminada': 'Después' }[ED && ED.ot.estado] || 'Durante');

async function cargarFotos(nOT, forzar = false) {
  if (FOTOS[nOT] && !forzar) return FOTOS[nOT];
  const r = await api('getFotos', { nOT });
  FOTOS[nOT] = r.fotos || [];
  return FOTOS[nOT];
}

function renderFotosCard() {
  const box = $('#fotos-card'); if (!box || !ED) return;
  const o = ED.ot, ro = otCerrada(o), n = o.nOT;
  const meta = n ? S.fotos.filter(f => String(f.nOT) === String(n)) : [];
  const fotos = FOTOS[n];
  let grid;
  if (!n) grid = '<p class="hint">Guarda la OT para poder agregar fotos.</p>';
  else if (!meta.length && ro) grid = '<p class="hint">Sin fotos.</p>';
  else if (!meta.length && !fotos) grid = '<p class="hint">Sin fotos todavía. Saca fotos del antes, durante y después.</p>';
  else if (!fotos) grid = `<p class="hint">Cargando ${meta.length} foto${meta.length === 1 ? '' : 's'}…</p>`;
  else if (!fotos.length) grid = '<p class="hint">Sin fotos todavía. Saca fotos del antes, durante y después.</p>';
  else grid = ETAPAS_FOTO.map(et => {
    const fs = fotos.filter(f => f.etapa === et);
    if (!fs.length) return '';
    return `<div class="sub-h" style="margin-top:6px">${et}</div><div class="foto-grid">${fs.map(f => `
      <button type="button" class="foto" data-foto="${esc(f.id)}">
        ${f.data ? `<img src="data:image/jpeg;base64,${f.data}" alt="">` : '<span class="hint">sin archivo</span>'}
        ${f.enPresupuesto !== false ? '<span class="foto-tag" title="Va en la cotización">📄</span>' : ''}
      </button>`).join('')}</div>`;
  }).join('');
  box.innerHTML = `<h2>📷 Fotos <span class="extra">${meta.length || ''}</span></h2>${grid}
    ${n && !ro ? `<label class="btn btn-sec btn-full" style="margin-top:12px">＋ Agregar fotos<input type="file" id="foto-input" accept="image/*" multiple hidden></label>` : ''}`;
  if (n && meta.length && !fotos) cargarFotos(n).then(() => renderFotosCard()).catch(e => toast('No se pudieron cargar las fotos: ' + e.message, 'err'));
  box.querySelectorAll('[data-foto]').forEach(b => b.onclick = () => modalFoto(b.dataset.foto, ro));
  const inp = $('#foto-input');
  if (inp) inp.onchange = () => { const files = [...inp.files]; inp.value = ''; if (files.length) modalSubirFotos(files); };
}

async function comprimirImagen(file, max = 1600, q = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q).split(',')[1];
  } finally { URL.revokeObjectURL(url); }
}

function modalSubirFotos(files) {
  let etapa = etapaSugerida();
  const m = abrirModal(`
    <h3>Subir ${files.length} foto${files.length === 1 ? '' : 's'}<button class="x" data-cerrar>✕</button></h3>
    <label>Etapa</label>
    <div class="seg" id="sf-etapa">${ETAPAS_FOTO.map(e => `<button type="button" data-v="${e}" class="${e === etapa ? 'on' : ''}">${e}</button>`).join('')}</div>
    <label for="sf-desc">Descripción (opcional)</label>
    <input id="sf-desc" placeholder="Ej: Lavamanos antiguo con filtración">
    <label class="check"><input type="checkbox" id="sf-cot" checked> Mostrar en la cotización</label>
    <div class="btn-row"><button class="btn btn-primary" id="sf-ok">Subir</button></div>`);
  m.querySelectorAll('#sf-etapa button').forEach(b => b.onclick = () => { etapa = b.dataset.v; m.querySelectorAll('#sf-etapa button').forEach(x => x.classList.toggle('on', x === b)); });
  $('#sf-ok').onclick = async () => {
    const desc = $('#sf-desc').value.trim(), enCot = $('#sf-cot').checked, nOT = ED.ot.nOT;
    cerrarModal();
    let ok = 0;
    for (const [k, f] of files.entries()) {
      toast(`Subiendo foto ${k + 1} de ${files.length}…`);
      try {
        const data = await comprimirImagen(f);
        const r = await api('uploadFoto', { nOT, etapa, descripcion: desc, enPresupuesto: enCot, data });
        S.fotos.push(r.item);
        (FOTOS[nOT] = FOTOS[nOT] || []).push(Object.assign({}, r.item, { data }));
        ok++;
        renderFotosCard();
      } catch (e) { toast(`Foto ${k + 1}: ${e.message}`, 'err'); }
    }
    guardarCache();
    if (ok) toast(`✓ ${ok} foto${ok === 1 ? '' : 's'} subida${ok === 1 ? '' : 's'}`, 'ok');
  };
}

function modalFoto(id, ro) {
  const nOT = ED.ot.nOT;
  const f = (FOTOS[nOT] || []).find(x => x.id === id); if (!f) return;
  let etapa = f.etapa;
  const m = abrirModal(`
    <h3>Foto · ${esc(f.etapa)}<button class="x" data-cerrar>✕</button></h3>
    ${f.data ? `<img class="foto-grande" src="data:image/jpeg;base64,${f.data}" alt="">` : ''}
    ${ro ? `<p>${esc(f.descripcion || '')}</p>` : `
    <label>Etapa</label>
    <div class="seg" id="mf-etapa">${ETAPAS_FOTO.map(e => `<button type="button" data-v="${e}" class="${e === etapa ? 'on' : ''}">${e}</button>`).join('')}</div>
    <label for="mf-desc">Descripción</label>
    <input id="mf-desc" value="${esc(f.descripcion)}">
    <label class="check"><input type="checkbox" id="mf-cot" ${f.enPresupuesto !== false ? 'checked' : ''}> Mostrar en la cotización</label>
    <div class="btn-row"><button class="btn btn-danger" id="mf-del">Eliminar</button><button class="btn btn-primary" id="mf-ok">Guardar</button></div>`}`);
  if (ro) return;
  m.querySelectorAll('#mf-etapa button').forEach(b => b.onclick = () => { etapa = b.dataset.v; m.querySelectorAll('#mf-etapa button').forEach(x => x.classList.toggle('on', x === b)); });
  $('#mf-ok').onclick = async () => {
    toast('Guardando…');
    try {
      const r = await api('updateFoto', { item: { id, etapa, descripcion: $('#mf-desc').value.trim(), enPresupuesto: $('#mf-cot').checked } });
      Object.assign(f, r.item);
      S.fotos = S.fotos.map(x => x.id === id ? r.item : x); guardarCache();
      cerrarModal(); renderFotosCard(); toast('✓ Foto actualizada', 'ok', 1200);
    } catch (e) { toast('No se guardó: ' + e.message, 'err'); }
  };
  $('#mf-del').onclick = async () => {
    if (!confirm('¿Eliminar esta foto? Se mueve a la papelera de Drive.')) return;
    toast('Eliminando…');
    try {
      await api('deleteFoto', { id });
      FOTOS[nOT] = FOTOS[nOT].filter(x => x.id !== id);
      S.fotos = S.fotos.filter(x => x.id !== id); guardarCache();
      cerrarModal(); renderFotosCard(); toast('✓ Foto eliminada', 'ok', 1200);
    } catch (e) { toast('No se eliminó: ' + e.message, 'err'); }
  };
}

// ════════════════════════════════════════════════════════ COTIZACIONES (una o varias OT)
// Número: COT-AAAA-NNN con versiones (v1, v2…). Las anteriores a v2.3 se muestran como "OT-0001 v1".
const otsDeCot = c => String(c.ots || c.nOT || '').split(',').map(x => x.trim()).filter(Boolean).map(Number);
const etiquetaCot = c => (c.numero || otNum(c.nOT)) + ' v' + c.version;
const estadoCot = c => c.estado || 'Vigente';
const cotsDeOT = n => S.cotizaciones.filter(c => otsDeCot(c).includes(Number(n)));
const ordenCots = (a, b) => String(b.numero || b.id).localeCompare(String(a.numero || a.id)) || b.version - a.version;

function siguienteNumeroCot() {
  const anio = new Date().getFullYear();
  const re = new RegExp('^COT-' + anio + '-(\\d+)$');
  const max = S.cotizaciones.reduce((m, c) => { const x = String(c.numero || '').match(re); return x ? Math.max(m, +x[1]) : m; }, 0);
  return `COT-${anio}-${String(max + 1).padStart(3, '0')}`;
}

function badgeCot(c) {
  const e = estadoCot(c);
  const cls = { Vigente: 'b-en-curso', Aprobada: 'b-terminada', Reemplazada: 'b-anulada', Descartada: 'b-anulada' }[e] || '';
  return `<span class="badge ${cls}">${esc(e)}</span>`;
}

function renderCotCard() {
  const box = $('#cot-card'); if (!box || !ED) return;
  const n = ED.ot.nOT;
  const cots = n ? cotsDeOT(n).sort(ordenCots) : [];
  box.innerHTML = `<h2>📄 Cotización</h2>
    ${cots.length ? cots.map(c => {
      const otras = otsDeCot(c).filter(x => x !== Number(n));
      const apagada = ['Reemplazada', 'Descartada'].includes(estadoCot(c));
      return `<div class="list-item ${apagada ? 'inactivo' : ''}" data-cot="${esc(c.id)}">
        <div class="li-body"><div class="li-tit">${esc(etiquetaCot(c))} ${badgeCot(c)}</div>
        <div class="li-sub">${fechaCorta(c.fecha)} · ${clp(c.total)}${otras.length ? ' · junto a ' + otras.map(otNum).join(', ') : ''}</div></div>
        <span class="chev">›</span></div>`;
    }).join('') : `<p class="hint">${n ? 'Aún no se ha generado ninguna cotización para esta OT.' : 'Guarda la OT para generar la cotización.'}</p>`}
    ${n ? `<button class="btn btn-primary btn-full" style="margin-top:12px" id="cot-gen">📄 Nueva cotización</button>
      <p class="hint" style="margin-top:8px">Para cotizar varias OT juntas: en la lista de OT usa "☑ Seleccionar".</p>` : ''}`;
  const b = $('#cot-gen'); if (b) b.onclick = () => abrirGenerar([Number(n)]);
  box.querySelectorAll('[data-cot]').forEach(el => el.onclick = () => modalCot(el.dataset.cot));
}

function modalCot(id) {
  const c = S.cotizaciones.find(x => x.id === id); if (!c) return;
  const cerrada = ocsDeCot(c).length > 0;
  const e = cerrada ? 'cerrada' : estadoCot(c);
  const ots = otsDeCot(c);
  const m = abrirModal(`
    <h3>${esc(etiquetaCot(c))}<button class="x" data-cerrar>✕</button></h3>
    <p style="margin:0 0 6px">${badgeCot(c)}</p>
    <p class="hint">${fechaCorta(c.fecha)} ${esc(String(c.fecha).slice(11, 16))} · Neto ${clp(c.neto)} · Total ${clp(c.total)}</p>
    <p class="hint">OT incluidas: ${ots.map(x => { const o = S.ots.find(z => Number(z.nOT) === x); return otNum(x) + (o ? ' · ' + esc(o.titulo) : ''); }).join('<br>')}</p>
    <div class="btn-row" style="flex-direction:column">
      ${c.pdfUrl ? `<a class="btn btn-sec" href="${esc(c.pdfUrl)}" target="_blank" rel="noopener">👁 Ver PDF en Drive</a>` : ''}
      ${cerrada ? `<p class="hint">🔒 Cerrada: tiene la OC ${esc(ocsDeCot(c).map(o => o.nOC).join(', '))}.</p>` : ''}
      ${c.numero && !cerrada ? `<button class="btn btn-primary" id="mc-ver">📄 Generar nueva versión</button>` : ''}
      ${!cerrada && e !== 'Aprobada' && e !== 'Reemplazada' ? '<button class="btn btn-sec" id="mc-apr">✅ Marcar como aprobada</button>' : ''}
      ${!cerrada && e !== 'Descartada' && e !== 'Reemplazada' ? '<button class="btn btn-danger" id="mc-desc">✕ Descartar</button>' : ''}
      ${e === 'Aprobada' || e === 'Descartada' ? '<button class="btn btn-sec" id="mc-vig">↺ Volver a vigente</button>' : ''}
    </div>`);
  const cambiar = async estado => {
    toast('Guardando…');
    try {
      const r = await api('setEstadoCotizacion', { id, estado });
      S.cotizaciones = S.cotizaciones.map(x => x.id === id ? r.item : x); guardarCache();
      toast('✓ ' + etiquetaCot(r.item) + ': ' + estado, 'ok'); cerrarModal(); if (ED) renderCotCard(); else render();
    } catch (err) { toast('No se guardó: ' + err.message, 'err'); }
  };
  const on = (sel, fn) => { const el = m.querySelector(sel); if (el) el.onclick = fn; };
  on('#mc-apr', () => cambiar('Aprobada'));
  on('#mc-desc', () => { if (confirm('¿Descartar ' + etiquetaCot(c) + '? Quedará en gris en el historial.')) cambiar('Descartada'); });
  on('#mc-vig', () => cambiar('Vigente'));
  on('#mc-ver', () => { cerrarModal(); abrirGenerar(ots, c.numero); });
}

// ── Sección 📄 Cotizaciones ──────────────────────────
const claveCot = c => c.numero || otNum(c.nOT);   // agrupa las versiones de una misma cotización
let FILTRO_COT = LS.get('osc_filtro_cot', 'Vigente');
let BUSQ_COT = '';

function gruposCot() {
  const g = new Map();
  S.cotizaciones.forEach(c => { const k = claveCot(c); if (!g.has(k)) g.set(k, []); g.get(k).push(c); });
  return [...g.entries()].map(([clave, vs]) => {
    vs.sort((a, b) => b.version - a.version);
    return { clave, versiones: vs, ultima: vs[0], ots: otsDeCot(vs[0]) };
  }).sort((a, b) => String(b.ultima.fecha).localeCompare(String(a.ultima.fecha)) || b.clave.localeCompare(a.clave));
}

function renderCots(app) {
  const filtros = [['Vigente', 'Vigentes'], ['Aprobada', 'Aprobadas'], ['Descartada', 'Descartadas'], ['todas', 'Todas']];
  const q = norm(BUSQ_COT);
  let lista = gruposCot();
  if (FILTRO_COT !== 'todas') lista = lista.filter(g => estadoCot(g.ultima) === FILTRO_COT);
  if (q) lista = lista.filter(g => norm([g.clave, ...g.ots.map(n => { const o = S.ots.find(x => Number(x.nOT) === n); return otNum(n) + ' ' + (o ? o.titulo + ' ' + o.ubicacion : ''); })].join(' ')).includes(q));
  app.innerHTML = `
    ${noConectado()}
    <input class="search" type="search" id="busq-cot" placeholder="Buscar COT, OT o título…" value="${esc(BUSQ_COT)}">
    <div class="chips">${filtros.map(([k, t]) => `<button class="chip ${FILTRO_COT === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
    <div style="padding-bottom:64px">${lista.length ? lista.map(g => {
      const c = g.ultima;
      const titulos = g.ots.map(n => { const o = S.ots.find(x => Number(x.nOT) === n); return `${otNum(n)}${o ? ' · ' + esc(o.titulo) : ''}`; });
      return `<a class="ot-item cot-item e-${slug(estadoCot(c))}" href="#/cot/${encodeURIComponent(g.clave)}">
        <div class="ot-top"><span class="ot-num">${esc(g.clave)} <span style="color:var(--gris);font-weight:600">v${esc(c.version)}</span></span><span>${fechaCorta(c.fecha)}</span></div>
        <div class="ot-meta" style="margin-top:4px">${titulos.join('<br>')}</div>
        <div class="ot-bottom"><div class="badges">${badgeCot(c)}${g.ots.length > 1 ? `<span class="badge b-oc">${g.ots.length} OT</span>` : ''}</div>
          <div class="ot-total">${clp(c.total)}</div></div>
      </a>`;
    }).join('') : `<div class="empty"><span class="big">📄</span>${S.cotizaciones.length ? 'No hay cotizaciones con este filtro.' : 'Aún no hay cotizaciones.<br>Se generan desde cada OT, o varias juntas con el botón de abajo.'}</div>`}</div>
    <button class="fab" id="btn-cot-multi">＋ Cotizar varias OT</button>`;
  $('#busq-cot').addEventListener('input', e => { BUSQ_COT = e.target.value; const pos = e.target.selectionStart; renderCots(app); const b = $('#busq-cot'); b.focus(); b.setSelectionRange(pos, pos); });
  app.querySelectorAll('.chip').forEach(c => c.onclick = () => { FILTRO_COT = c.dataset.f; LS.set('osc_filtro_cot', FILTRO_COT); renderCots(app); });
  $('#btn-cot-multi').onclick = () => { SEL = new Set(); location.hash = '#/ots'; };
}

function renderCot(app, clave) {
  const g = gruposCot().find(x => x.clave === clave);
  if (!g) { app.innerHTML = `<div class="empty"><span class="big">🔍</span>No se encontró la cotización ${esc(clave)}.<br><br><a class="btn btn-sec" href="#/cots">Volver</a></div>`; return; }
  const c = g.ultima, e = estadoCot(c);
  const ots = g.ots.map(n => S.ots.find(o => Number(o.nOT) === n) || { nOT: n, titulo: '(OT no encontrada)' });
  const sol = S.solicitantes.find(s => s.id === c.solicitanteId);
  app.innerHTML = `
    <div class="ed-head"><button class="back" onclick="location.hash='#/cots'" aria-label="Volver">←</button><h2>${esc(g.clave)}</h2>${badgeCot(c)}</div>
    <div class="card">
      <h2>📋 OT incluidas <span class="extra">${ots.length}</span></h2>
      ${ots.map(o => `<a class="list-item" href="#/ot/${o.nOT}" style="text-decoration:none;color:inherit">
        <div class="li-body"><div class="li-tit">${otNum(o.nOT)} · ${esc(o.titulo)}</div>
        <div class="li-sub">${fechaCorta(o.fechaInicio)}${o.ubicacion ? ' · ' + esc(o.ubicacion) : ''}${o.neto != null ? ' · Neto ' + clp(o.neto) : ''}</div></div><span class="chev">›</span></a>`).join('')}
      <div class="res-row fuerte" style="margin-top:8px"><span>Neto</span><span>${clp(c.neto)}</span></div>
      <div class="res-row total"><span>Total</span><span>${clp(c.total)}</span></div>
      ${sol ? `<p class="hint">Atención: ${esc(sol.nombre)}${sol.cargo ? ' · ' + esc(sol.cargo) : ''}</p>` : ''}
    </div>
    ${bloqueOC(c)}
    <div class="card">
      <h2>🗂 Versiones</h2>
      ${g.versiones.map(v => `<div class="list-item ${['Reemplazada', 'Descartada'].includes(estadoCot(v)) ? 'inactivo' : ''}" data-cot="${esc(v.id)}">
        <div class="li-body"><div class="li-tit">v${esc(v.version)} ${badgeCot(v)}</div><div class="li-sub">${fechaCorta(v.fecha)} ${esc(String(v.fecha).slice(11, 16))} · ${clp(v.total)}</div></div>
        ${v.pdfUrl ? `<a class="btn btn-sec btn-sm" href="${esc(v.pdfUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">PDF</a>` : ''}</div>`).join('')}
    </div>
    ${ocsDeCot(c).length ? `<div class="readonly-banner">🔒 Cotización cerrada: tiene la OC <b>${esc(ocsDeCot(c).map(o => o.nOC).join(', '))}</b> asignada. Para modificarla, primero quita la OC (solo si aún no está facturada).</div>` : `
    <div class="card">
      ${c.numero ? `<button class="btn btn-primary btn-full" id="cd-ver">📄 Generar nueva versión (v${Calc.num(c.version) + 1})</button>` : '<p class="hint">Cotización anterior a la numeración COT: para una versión nueva, genera una cotización nueva desde la OT.</p>'}
      <div class="btn-row">
        ${e !== 'Aprobada' ? '<button class="btn btn-sec" id="cd-apr">✅ Aprobada</button>' : ''}
        ${e !== 'Descartada' ? '<button class="btn btn-danger" id="cd-desc">✕ Descartar</button>' : ''}
        ${e === 'Aprobada' || e === 'Descartada' ? '<button class="btn btn-sec" id="cd-vig">↺ Vigente</button>' : ''}
      </div>
    </div>`}`;
  app.querySelectorAll('[data-cot]').forEach(el => el.onclick = () => modalCot(el.dataset.cot));
  enlazarBloqueOC(app, c);
  const cambiar = async estado => {
    toast('Guardando…');
    try {
      const r = await api('setEstadoCotizacion', { id: c.id, estado });
      S.cotizaciones = S.cotizaciones.map(x => x.id === c.id ? r.item : x); guardarCache();
      toast('✓ ' + etiquetaCot(r.item) + ': ' + estado, 'ok'); renderCot(app, clave);
    } catch (err) { toast('No se guardó: ' + err.message, 'err'); }
  };
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  on('#cd-ver', () => abrirGenerar(g.ots, c.numero));
  on('#cd-apr', () => cambiar('Aprobada'));
  on('#cd-desc', () => { if (confirm('¿Descartar ' + etiquetaCot(c) + '?')) cambiar('Descartada'); });
  on('#cd-vig', () => cambiar('Vigente'));
}

/** Valida la selección de OT y abre el diálogo de generación. */
function abrirGenerar(nOTs, numeroBase = '') {
  if (ED && ED.dirty && nOTs.includes(Number(ED.ot.nOT))) { toast('Guarda los cambios de la OT antes de generar la cotización', 'err'); return; }
  const ots = nOTs.map(n => S.ots.find(o => Number(o.nOT) === Number(n))).filter(Boolean);
  if (!ots.length) { toast('No se encontraron las OT', 'err'); return; }
  const cerrada = ots.find(otCerrada);
  if (cerrada) { toast(otNum(cerrada.nOT) + ' tiene OC asignada: la cotización está cerrada', 'err'); return; }
  if (new Set(ots.map(o => o.clienteId)).size > 1) { toast('Las OT deben ser del mismo cliente para cotizarlas juntas', 'err'); return; }
  if (ots.length > 1) {
    const sols = [...new Set(ots.map(o => o.solicitante || '(sin solicitante)'))];
    if (sols.length > 1 && !confirm('Estas OT fueron pedidas por personas distintas:\n\n' + ots.map(o => `${otNum(o.nOT)}: ${o.solicitante || '(sin solicitante)'}`).join('\n') + '\n\n¿Seguro que van en la misma cotización?')) return;
    const edifs = [...new Set(ots.map(o => (S.ubicaciones.find(u => u.id === o.ubicacionId) || {}).edificio || '(sin ubicación)'))];
    if (edifs.length > 1 && !confirm('Estas OT son de edificios distintos:\n\n' + ots.map(o => `${otNum(o.nOT)}: ${(S.ubicaciones.find(u => u.id === o.ubicacionId) || {}).edificio || '(sin ubicación)'}`).join('\n') + '\n\n¿Seguro que van en la misma cotización?')) return;
  }
  modalCotizacion(ots, numeroBase);
}

function cargarScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.dataset.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

async function dataUrlDe(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}

function modalCotizacion(ots, numeroBase) {
  const cfg = S.config;
  const multiple = ots.length > 1;
  const numero = numeroBase || siguienteNumeroCot();
  const version = S.cotizaciones.filter(c => c.numero === numero).reduce((m, c) => Math.max(m, Calc.num(c.version)), 0) + 1;
  const hayCond = !!String(cfg.COT_CONDICIONES || '').trim();
  const nums = ots.map(o => Number(o.nOT));
  const nFotos = S.fotos.filter(f => nums.includes(Number(f.nOT)) && f.enPresupuesto !== false).length;
  const incl = S.lineas.filter(l => nums.includes(Number(l.nOT)) && l.incluida !== false);
  const hayCompras = incl.some(l => ['Compra', 'Tiempo de gestión'].includes(Calc.tipoDe(l)));
  const hayMO = incl.some(l => Calc.tipoDe(l) === 'Mano de obra');
  const tiposPres = [...new Map(incl.filter(l => Calc.tipoDe(l) === 'Compra' && l.tipoItemId)
    .map(l => [l.tipoItemId, l.tipoItem || (S.tiposItem.find(t => t.id === l.tipoItemId) || {}).nombre || 'Ítem'])).entries()];
  const sols = S.solicitantes.filter(s => s.clienteId === ots[0].clienteId && (s.activo !== false || ots.some(o => o.solicitanteId === s.id)));
  const previa = numeroBase ? S.cotizaciones.filter(c => c.numero === numeroBase).sort((a, b) => b.version - a.version)[0] : null;
  const atDefecto = (previa && previa.solicitanteId) || (ots.find(o => o.solicitanteId) || {}).solicitanteId || '';
  const m = abrirModal(`
    <h3>${esc(numero)} v${version}<button class="x" data-cerrar>✕</button></h3>
    <p class="hint" style="margin:0 0 4px">${ots.map(o => `${otNum(o.nOT)} · ${esc(o.titulo)}`).join('<br>')}</p>
    <label for="c-at">Atención</label>
    <select id="c-at"><option value="">— Sin nombre —</option>${sols.map(s => `<option value="${esc(s.id)}" ${s.id === atDefecto ? 'selected' : ''}>${esc(s.nombre)}${s.cargo ? ' · ' + esc(s.cargo) : ''}</option>`).join('')}</select>
    <p class="hint" style="margin:10px 0 0">Sin marcar nada, la cotización muestra ${multiple ? 'cada OT con su título, detalle y valor' : 'solo el trabajo pedido y su valor'}.</p>
    <label class="check"><input type="checkbox" id="c-dc" ${cfg.COT_DETALLE_COMPRAS === 'SI' ? 'checked' : ''} ${hayCompras ? '' : 'disabled'}> Mostrar gestión de compras</label>
    <div class="sub-opts" id="c-dc-sub">${tiposPres.map(([id, nom]) => `<label class="check"><input type="checkbox" data-tipo="${esc(id)}" checked> Listar ${esc(nom)}</label>`).join('') || '<p class="hint">Solo hay tiempo de gestión.</p>'}</div>
    <label class="check"><input type="checkbox" id="c-dm" ${cfg.COT_DETALLE_MO === 'SI' ? 'checked' : ''} ${hayMO ? '' : 'disabled'}> Mostrar mano de obra</label>
    <div class="sub-opts" id="c-dm-sub"><label class="check"><input type="checkbox" id="c-agr" ${cfg.COT_MO_AGRUPADA === 'SI' ? 'checked' : ''}> Agrupada por categoría (en vez de cada proceso)</label>
      ${incl.some(l => Calc.esCantidad(l)) ? `<label class="check"><input type="checkbox" id="c-cant" ${cfg.COT_MOSTRAR_CANTIDAD !== 'NO' ? 'checked' : ''}> Mostrar cantidades (ej: 81,6 m²)</label>` : ''}</div>
    <hr class="sep">
    <label class="check"><input type="checkbox" id="c-fot" ${!multiple && nFotos ? 'checked' : ''} ${nFotos ? '' : 'disabled'}> Incluir fotos ${nFotos ? `(${nFotos})` : '(no hay fotos marcadas)'}</label>
    <label class="check"><input type="checkbox" id="c-cond" ${hayCond && cfg.COT_INCLUIR_CONDICIONES === 'SI' ? 'checked' : ''} ${hayCond ? '' : 'disabled'}> Incluir condiciones</label>
    ${hayCond ? '' : '<p class="hint">Para usar condiciones, escríbelas en Config → Cotizaciones.</p>'}
    ${cfg.EMPRESA_RUT ? '' : '<p class="hint" style="color:#8A5310">⚠ Faltan datos de la empresa (RUT, etc.) en Config.</p>'}
    ${version > 1 ? `<p class="hint">La versión anterior quedará como <b>Reemplazada</b>.</p>` : ''}
    <div class="btn-row"><button class="btn btn-primary" id="c-ok">Generar</button></div>`);
  const sync = () => {
    $('#c-dc-sub').classList.toggle('hidden', !$('#c-dc').checked);
    $('#c-dm-sub').classList.toggle('hidden', !$('#c-dm').checked);
  };
  $('#c-dc').onchange = sync; $('#c-dm').onchange = sync; sync();
  $('#c-ok').onclick = async () => {
    const opciones = {
      detalleCompras: $('#c-dc').checked && hayCompras, detalleMO: $('#c-dm').checked && hayMO,
      agruparMO: $('#c-agr').checked, incluirCondiciones: $('#c-cond').checked, incluirFotos: $('#c-fot').checked,
      mostrarCantidad: $('#c-cant') ? $('#c-cant').checked : false,
      tiposOcultos: [...m.querySelectorAll('[data-tipo]')].filter(cb => !cb.checked).map(cb => cb.dataset.tipo)
    };
    const atencionId = $('#c-at').value;
    m.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const { doc, totales } = await armarPDF(ots, numero, version, opciones, atencionId);
      toast('Guardando en Drive…');
      const pdf = doc.output('datauristring').split(',')[1];
      const r = await api('saveCotizacion', { ots: nums, numero, version, pdf, neto: totales.neto, iva: totales.iva, total: totales.total, solicitanteId: atencionId });
      const reemp = new Set(r.reemplazadas || []);
      S.cotizaciones = S.cotizaciones.map(c => reemp.has(c.id) ? Object.assign({}, c, { estado: 'Reemplazada' }) : c).concat([r.item]);
      guardarCache();
      const file = new File([doc.output('blob')], `Cotizacion_${numero}_v${r.item.version}.pdf`, { type: 'application/pdf' });
      toast('✓ Cotización lista', 'ok');
      SEL = null;
      if (ED) renderCotCard(); else render();
      modalCompartir(file, r.item);
    } catch (e) {
      toast('No se generó: ' + e.message, 'err');
      m.querySelectorAll('button').forEach(b => b.disabled = false);
    }
  };
}

async function armarPDF(ots, numero, version, opciones, atencionId) {
  toast('Preparando PDF…');
  await cargarScript('lib/jspdf.umd.min.js');
  const logo = await dataUrlDe('img/logo-pdf.png').catch(() => null);
  let fotos = [];
  if (opciones.incluirFotos) {
    for (const o of ots) {
      const fs = await cargarFotos(o.nOT).catch(() => []);
      fotos = fotos.concat(fs.filter(f => f.enPresupuesto !== false).map(f => Object.assign({}, f, { nOT: o.nOT })));
    }
  }
  const items = ots.map(o => ({
    ot: o,
    lineas: S.lineas.filter(l => Number(l.nOT) === Number(o.nOT)).sort((a, b) => a.orden - b.orden).map(l => Object.assign({}, l, { tipo: Calc.tipoDe(l) })),
    ubicacion: S.ubicaciones.find(u => u.id === o.ubicacionId),
    neto: Calc.num(o.neto)
  }));
  const ivaPct = Calc.vacio(ots[0].ivaPct) ? Calc.num(S.config.IVA_PCT) : Calc.num(ots[0].ivaPct);
  const neto = items.reduce((s, it) => s + it.neto, 0);
  const iva = Math.round(neto * ivaPct / 100);
  const totales = { neto, iva, total: neto + iva, ivaPct };
  const doc = Cotizacion.generar({
    numero, version, fechaISO: hoyISO(), cfg: S.config, logo, montoLinea: Calc.montoLinea,
    cliente: S.clientes.find(c => c.id === ots[0].clienteId) || {},
    solicitante: S.solicitantes.find(x => x.id === atencionId),
    items, opciones, fotos, totales
  });
  return { doc, totales };
}

function modalCompartir(file, item, mensaje) {
  const url = URL.createObjectURL(file);
  const puedeCompartir = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  abrirModal(`
    <h3>✓ ${esc(file.name.replace('.pdf', '').replace(/_/g, ' '))}<button class="x" data-cerrar>✕</button></h3>
    <p class="hint">${mensaje || `Quedó guardada${item.pdfUrl ? ' en Drive' : ''} y registrada en ${otsDeCot(item).length > 1 ? 'las OT incluidas' : 'la OT'}.`}</p>
    <div class="btn-row" style="flex-direction:column">
      ${puedeCompartir ? '<button class="btn btn-primary" id="cp-share">📤 Compartir (WhatsApp, correo…)</button>' : ''}
      <a class="btn ${puedeCompartir ? 'btn-sec' : 'btn-primary'}" href="${url}" download="${esc(file.name)}">⬇ Descargar PDF</a>
      <a class="btn btn-sec" href="${url}" target="_blank" rel="noopener">👁 Ver PDF</a>
    </div>`);
  const sh = $('#cp-share');
  if (sh) sh.onclick = async () => {
    try { await navigator.share({ files: [file], title: file.name }); }
    catch (e) { if (e.name !== 'AbortError') toast('No se pudo compartir: ' + e.message, 'err'); }
  };
}

// ════════════════════════════════════════════════════════ MODAL GENÉRICO
function abrirModal(html) {
  MODAL_OPEN = true;
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg"><div class="modal" role="dialog">${html}</div></div>`;
  const bg = root.querySelector('.modal-bg');
  bg.addEventListener('click', e => { if (e.target === bg) cerrarModal(); });
  root.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = cerrarModal);
  return root.querySelector('.modal');
}
function cerrarModal() { MODAL_OPEN = false; $('#modal-root').innerHTML = ''; }

// ── Solicitante / Ubicación (modales reutilizables) ───────
function modalSolicitante(s, onSaved) {
  const nuevo = !s.id;
  const m = abrirModal(`
    <h3>${nuevo ? 'Nuevo solicitante' : 'Editar solicitante'}<button class="x" data-cerrar>✕</button></h3>
    <label for="s-nombre">Nombre</label><input id="s-nombre" value="${esc(s.nombre)}" placeholder="Ej: María González">
    <label for="s-cargo">Cargo</label><input id="s-cargo" value="${esc(s.cargo)}" placeholder="Ej: Jefa de Administración">
    <label for="s-unidad">Unidad / Departamento</label><input id="s-unidad" value="${esc(s.unidad)}" placeholder="Ej: Facultad de Ingeniería">
    <div class="row">
      <div><label for="s-correo">Correo</label><input id="s-correo" type="email" value="${esc(s.correo)}"></div>
      <div><label for="s-tel">Teléfono</label><input id="s-tel" type="tel" value="${esc(s.telefono)}"></div>
    </div>
    ${nuevo ? '' : `<label class="check"><input type="checkbox" id="s-activo" ${s.activo !== false ? 'checked' : ''}> Activo</label>`}
    <div class="btn-row"><button class="btn btn-primary" id="s-ok">Guardar</button></div>`);
  setTimeout(() => $('#s-nombre').focus(), 50);
  $('#s-ok').onclick = async () => {
    const item = Object.assign({}, s, {
      nombre: $('#s-nombre').value.trim(), cargo: $('#s-cargo').value.trim(), unidad: $('#s-unidad').value.trim(),
      correo: $('#s-correo').value.trim(), telefono: $('#s-tel').value.trim(),
      activo: $('#s-activo') ? $('#s-activo').checked : true
    });
    if (!item.nombre) { toast('Escribe el nombre', 'err'); return; }
    await guardarCatalogo('saveSolicitante', 'solicitantes', item, onSaved, m);
  };
}

function modalUbicacion(u, onSaved) {
  const nuevo = !u.id;
  const m = abrirModal(`
    <h3>${nuevo ? 'Nueva ubicación' : 'Editar ubicación'}<button class="x" data-cerrar>✕</button></h3>
    <label for="u-edif">Edificio</label><input id="u-edif" value="${esc(u.edificio)}" placeholder="Ej: Facultad de Ingeniería">
    <label for="u-det">Detalle / sector</label><input id="u-det" value="${esc(u.detalle)}" placeholder="Ej: Baño 2° piso, ala norte">
    ${nuevo ? '' : `<label class="check"><input type="checkbox" id="u-activo" ${u.activo !== false ? 'checked' : ''}> Activa</label>`}
    <div class="btn-row"><button class="btn btn-primary" id="u-ok">Guardar</button></div>`);
  setTimeout(() => $('#u-edif').focus(), 50);
  $('#u-ok').onclick = async () => {
    const item = Object.assign({}, u, { edificio: $('#u-edif').value.trim(), detalle: $('#u-det').value.trim(), activo: $('#u-activo') ? $('#u-activo').checked : true });
    if (!item.edificio) { toast('Escribe el edificio', 'err'); return; }
    await guardarCatalogo('saveUbicacion', 'ubicaciones', item, onSaved, m);
  };
}

async function guardarCatalogo(action, coll, item, onSaved, modal) {
  const btns = modal.querySelectorAll('button'); btns.forEach(b => b.disabled = true);
  toast('Guardando…');
  try {
    const r = await api(action, { item });
    S[coll] = S[coll].filter(x => x.id !== r.item.id).concat([r.item]);
    guardarCache();
    toast('✓ Guardado', 'ok', 1200);
    cerrarModal();
    if (onSaved) onSaved(r.item);
  } catch (e) {
    toast('No se guardó: ' + e.message, 'err');
    btns.forEach(b => b.disabled = false);
  }
}

// ════════════════════════════════════════════════════════ CLIENTES
function renderClientes(app) {
  const lista = S.clientes.slice().sort((a, b) => (b.activo !== false) - (a.activo !== false) || String(a.razonSocial).localeCompare(b.razonSocial));
  app.innerHTML = `
    ${noConectado()}
    <div class="card">
      <h2>👥 Clientes</h2>
      ${lista.length ? lista.map(c => {
        const nOT = S.ots.filter(o => o.clienteId === c.id && o.estado !== 'Anulada').length;
        const nSol = S.solicitantes.filter(s => s.clienteId === c.id && s.activo !== false).length;
        const nUbi = S.ubicaciones.filter(u => u.clienteId === c.id && u.activo !== false).length;
        return `<a class="list-item ${c.activo === false ? 'inactivo' : ''}" href="#/cliente/${encodeURIComponent(c.id)}" style="text-decoration:none;color:inherit">
          <div class="li-body"><div class="li-tit">${esc(c.razonSocial)}${c.nombreCorto ? ' <span class="hint">(' + esc(c.nombreCorto) + ')</span>' : ''}</div>
          <div class="li-sub">${nOT} OT · ${nSol} solicitante${nSol === 1 ? '' : 's'} · ${nUbi} ubicaci${nUbi === 1 ? 'ón' : 'ones'}</div></div>
          <span class="chev">›</span></a>`;
      }).join('') : '<p class="hint">Aún no hay clientes.</p>'}
      <button class="btn btn-sec btn-full" style="margin-top:12px" onclick="location.hash='#/cliente/nuevo'">＋ Nuevo cliente</button>
    </div>`;
}

function renderCliente(app, idParam) {
  const id = decodeURIComponent(idParam || '');
  const nuevo = id === 'nuevo';
  const c = nuevo ? { razonSocial: '', nombreCorto: '', rut: '', giro: '', direccion: '', comuna: '', contacto: '', correo: '', telefono: '', activo: true } : S.clientes.find(x => x.id === id);
  if (!c) { app.innerHTML = `<div class="empty">Cliente no encontrado.<br><br><a class="btn btn-sec" href="#/clientes">Volver</a></div>`; return; }
  const sols = S.solicitantes.filter(s => s.clienteId === c.id).sort((a, b) => (b.activo !== false) - (a.activo !== false));
  const ubis = S.ubicaciones.filter(u => u.clienteId === c.id).sort((a, b) => (b.activo !== false) - (a.activo !== false));
  const campo = (k, t, ph = '', type = 'text') => `<label for="c-${k}">${t}</label><input id="c-${k}" type="${type}" value="${esc(c[k])}" placeholder="${esc(ph)}">`;
  app.innerHTML = `
    <div class="ed-head"><button class="back" onclick="location.hash='#/clientes'" aria-label="Volver">←</button><h2>${nuevo ? 'Nuevo cliente' : esc(c.nombreCorto || c.razonSocial)}</h2></div>
    <div class="card">
      <h2>Datos para cotización y factura</h2>
      ${campo('razonSocial', 'Razón social', 'Ej: Universidad de Concepción')}
      <div class="row"><div>${campo('nombreCorto', 'Nombre corto', 'Ej: UdeC')}</div><div>${campo('rut', 'RUT', '12.345.678-9')}</div></div>
      ${campo('giro', 'Giro')}
      <div class="row"><div>${campo('direccion', 'Dirección')}</div><div>${campo('comuna', 'Comuna')}</div></div>
      ${campo('contacto', 'Contacto facturación')}
      <div class="row"><div>${campo('correo', 'Correo', '', 'email')}</div><div>${campo('telefono', 'Teléfono', '', 'tel')}</div></div>
      ${nuevo ? '' : `<label class="check"><input type="checkbox" id="c-activo" ${c.activo !== false ? 'checked' : ''}> Cliente activo</label>`}
      <button class="btn btn-primary btn-full" style="margin-top:16px" id="c-ok">Guardar cliente</button>
    </div>
    ${nuevo ? '<p class="hint" style="text-align:center">Guarda el cliente para agregarle solicitantes y ubicaciones.</p>' : `
    <div class="card">
      <h2>🙋 Solicitantes <span class="extra">quienes piden trabajos</span></h2>
      ${sols.length ? sols.map(s => `<div class="list-item ${s.activo === false ? 'inactivo' : ''}" data-sol="${esc(s.id)}"><div class="li-body"><div class="li-tit">${esc(s.nombre)}</div><div class="li-sub">${esc([s.cargo, s.unidad].filter(Boolean).join(' · ') || '—')}</div></div><span class="chev">›</span></div>`).join('') : '<p class="hint">Sin solicitantes.</p>'}
      <button class="btn btn-sec btn-full" style="margin-top:10px" id="c-add-sol">＋ Agregar solicitante</button>
    </div>
    <div class="card">
      <h2>🏢 Ubicaciones <span class="extra">edificios y sectores</span></h2>
      ${ubis.length ? ubis.map(u => `<div class="list-item ${u.activo === false ? 'inactivo' : ''}" data-ubi="${esc(u.id)}"><div class="li-body"><div class="li-tit">${esc(u.edificio)}</div><div class="li-sub">${esc(u.detalle || '—')}</div></div><span class="chev">›</span></div>`).join('') : '<p class="hint">Sin ubicaciones.</p>'}
      <button class="btn btn-sec btn-full" style="margin-top:10px" id="c-add-ubi">＋ Agregar ubicación</button>
    </div>`}`;

  $('#c-ok').onclick = async () => {
    const item = Object.assign({}, c);
    ['razonSocial', 'nombreCorto', 'rut', 'giro', 'direccion', 'comuna', 'contacto', 'correo', 'telefono'].forEach(k => { item[k] = $('#c-' + k).value.trim(); });
    item.activo = $('#c-activo') ? $('#c-activo').checked : true;
    if (!item.razonSocial) { toast('Escribe la razón social', 'err'); return; }
    const btn = $('#c-ok'); btn.disabled = true; toast('Guardando…');
    try {
      const r = await api('saveCliente', { item });
      S.clientes = S.clientes.filter(x => x.id !== r.item.id).concat([r.item]);
      guardarCache(); toast('✓ Cliente guardado', 'ok');
      if (nuevo) location.hash = '#/cliente/' + encodeURIComponent(r.item.id); else renderCliente(app, idParam);
    } catch (e) { toast('No se guardó: ' + e.message, 'err'); btn.disabled = false; }
  };
  if (nuevo) return;
  const re = () => renderCliente(app, idParam);
  $('#c-add-sol').onclick = () => modalSolicitante({ clienteId: c.id }, re);
  $('#c-add-ubi').onclick = () => modalUbicacion({ clienteId: c.id }, re);
  app.querySelectorAll('[data-sol]').forEach(el => el.onclick = () => modalSolicitante(S.solicitantes.find(s => s.id === el.dataset.sol), re));
  app.querySelectorAll('[data-ubi]').forEach(el => el.onclick = () => modalUbicacion(S.ubicaciones.find(u => u.id === el.dataset.ubi), re));
}

// ════════════════════════════════════════════════════════ CONFIG
function renderConfig(app) {
  const cfg = S.config;
  const conectado = DEMO || (API_URL && TOKEN);
  const cats = S.categorias.slice().sort((a, b) => (b.uso === 'Gestión') - (a.uso === 'Gestión') || Calc.num(a.orden) - Calc.num(b.orden));
  const tipos = S.tiposItem.slice().sort((a, b) => Calc.num(a.orden) - Calc.num(b.orden));
  const emp = [['EMPRESA_NOMBRE', 'Nombre de fantasía'], ['EMPRESA_RAZON_SOCIAL', 'Razón social'], ['EMPRESA_RUT', 'RUT'], ['EMPRESA_GIRO', 'Giro'], ['EMPRESA_DIRECCION', 'Dirección'], ['EMPRESA_TELEFONO', 'Teléfono'], ['EMPRESA_CORREO', 'Correo'], ['EMPRESA_FIRMA', 'Nombre para la firma']];

  app.innerHTML = `
    <div class="card">
      <h2>🔌 Conexión con la planilla</h2>
      ${DEMO ? `<div class="warn-banner">Estás en <b>modo demo</b>: los datos son de ejemplo y se guardan solo en este teléfono. Nada llega a Google Sheets.</div>` : ''}
      <label for="k-url">URL del Web App (Apps Script)</label>
      <input id="k-url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(API_URL)}">
      <label for="k-token">Token</label>
      <input id="k-token" placeholder="Aparece al ejecutar setup() en Apps Script" value="${esc(TOKEN)}" autocomplete="off">
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="k-ok">Conectar y probar</button>
      <div class="btn-row">
        ${DEMO ? `<button class="btn btn-sec" id="k-demo-off">Salir del modo demo</button><button class="btn btn-sec" id="k-demo-reset">Reiniciar demo</button>`
               : `<button class="btn btn-sec" id="k-demo-on">Probar en modo demo</button>`}
      </div>
    </div>

    ${conectado ? `
    <div class="card">
      <h2>💲 Valores de cobro</h2>
      <div class="row">
        <div><label for="v-rec">Recargo general %</label><input id="v-rec" inputmode="decimal" value="${dec(cfg.RECARGO_MATERIALES_PCT ?? 30)}"></div>
        <div><label for="v-iva">IVA %</label><input id="v-iva" inputmode="decimal" value="${dec(cfg.IVA_PCT ?? 19)}"></div>
      </div>
      <p class="hint">Horas = horas × valor hora de la categoría. Ítems de compra al costo. El <b>recargo general</b> se aplica sobre el neto de cada OT y en la cotización se reparte en los montos (la jefa no lo ve). Cada OT conserva el % con que se creó.</p>
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="v-ok">Guardar valores</button>
    </div>

    <div class="card">
      <h2>🏷 Categorías y valor hora</h2>
      <div class="cat-head"><span>Categoría</span><span>Valor hora</span><span>Activa</span></div>
      <div id="cats">${cats.map(c => `
        <div class="cat-row" data-id="${esc(c.id)}">
          <input class="c-nom" value="${esc(c.nombre)}">
          <input class="c-vh" inputmode="numeric" value="${Calc.num(c.valorHora) ? Calc.num(c.valorHora).toLocaleString('es-CL') : ''}" placeholder="$">
          <input class="c-act" type="checkbox" ${c.activa !== false ? 'checked' : ''} ${c.uso === 'Gestión' ? 'disabled title="Siempre activa"' : ''}>
          ${c.uso === 'Gestión' ? '<div class="uso">🛒 Valor hora del tiempo de gestión de compras</div>' : ''}
        </div>`).join('')}</div>
      <button class="btn btn-sec btn-sm" id="cat-add">＋ Agregar categoría</button>
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="cat-ok">Guardar categorías</button>
    </div>

    <div class="card">
      <h2>📦 Tipos de ítem de compra</h2>
      <p class="hint" style="margin:-6px 0 10px">Opciones del desplegable al anotar un ítem en Gestión de compras.</p>
      <div class="cat-head" style="grid-template-columns:1fr 40px"><span>Tipo</span><span>Activo</span></div>
      <div id="tipos">${tipos.map(t => `
        <div class="tipo-row" data-id="${esc(t.id)}">
          <input class="t-nom" value="${esc(t.nombre)}">
          <input class="t-act" type="checkbox" ${t.activo !== false ? 'checked' : ''}>
        </div>`).join('')}</div>
      <button class="btn btn-sec btn-sm" id="tipo-add">＋ Agregar tipo</button>
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="tipo-ok">Guardar tipos</button>
    </div>

    <div class="card">
      <h2>📐 Tarifario <span class="extra">trabajos por cantidad</span></h2>
      <p class="hint" style="margin:-6px 0 10px">Servicios con precio fijo por unidad (m², m lineal…). Al anotar mano de obra "por cantidad" eliges el servicio y solo pones la cantidad.</p>
      <div id="tarifas">${S.tarifario.slice().sort((a, b) => Calc.num(a.orden) - Calc.num(b.orden)).map(filaTarifa).join('') || '<p class="hint" id="tar-vacio">Aún no hay servicios en el tarifario.</p>'}</div>
      <button class="btn btn-sec btn-sm" id="tar-add">＋ Agregar servicio</button>
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="tar-ok">Guardar tarifario</button>
    </div>

    <div class="card">
      <h2>📏 Unidades</h2>
      <div class="cat-head" style="grid-template-columns:1fr 40px"><span>Unidad</span><span>Activa</span></div>
      <div id="unis">${S.unidades.slice().sort((a, b) => Calc.num(a.orden) - Calc.num(b.orden)).map(u => `
        <div class="tipo-row" data-id="${esc(u.id)}"><input class="u-nom" value="${esc(u.nombre)}"><input class="u-act" type="checkbox" ${u.activo !== false ? 'checked' : ''}></div>`).join('')}</div>
      <button class="btn btn-sec btn-sm" id="uni-add">＋ Agregar unidad</button>
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="uni-ok">Guardar unidades</button>
    </div>

    <div class="card">
      <h2>🏠 Datos de la empresa</h2>
      <p class="hint" style="margin:-6px 0 4px">Aparecerán en las cotizaciones.</p>
      ${emp.map(([k, t]) => `<label for="e-${k}">${t}</label><input id="e-${k}" value="${esc(cfg[k])}">`).join('')}
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="e-ok">Guardar datos</button>
    </div>

    <div class="card">
      <h2>📄 Cotizaciones</h2>
      <label for="q-cond">Condiciones (pie de la cotización)</label>
      <textarea id="q-cond" placeholder="Ej: Validez de la cotización: 15 días. Forma de pago: 30 días desde la recepción de la factura.">${esc(cfg.COT_CONDICIONES)}</textarea>
      <p class="hint">Valores por defecto al generar una cotización (se pueden cambiar en cada una):</p>
      <label class="check"><input type="checkbox" id="q-inc" ${cfg.COT_INCLUIR_CONDICIONES === 'SI' ? 'checked' : ''}> Incluir condiciones</label>
      <label class="check"><input type="checkbox" id="q-dc" ${cfg.COT_DETALLE_COMPRAS === 'SI' ? 'checked' : ''}> Mostrar gestión de compras</label>
      <label class="check"><input type="checkbox" id="q-dm" ${cfg.COT_DETALLE_MO === 'SI' ? 'checked' : ''}> Mostrar mano de obra</label>
      <label class="check"><input type="checkbox" id="q-agr" ${cfg.COT_MO_AGRUPADA === 'SI' ? 'checked' : ''}> Mano de obra agrupada por categoría</label>
      <label class="check"><input type="checkbox" id="q-cant" ${cfg.COT_MOSTRAR_CANTIDAD !== 'NO' ? 'checked' : ''}> Mostrar cantidades (ej: 81,6 m²)</label>
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="q-ok">Guardar</button>
    </div>` : ''}

    <p class="hint" style="text-align:center;margin:18px 0">Mantenciones OSC · app ${APP_VERSION}${DEMO ? ' · modo demo' : API_VERSION ? ' · Apps Script ' + esc(API_VERSION) : ''}
      ${!DEMO && API_VERSION && !(cmpVer(API_VERSION, API_REQUERIDA) >= 0) ? '<br><span style="color:#B3261E;font-weight:700">⚠ Esta app necesita Apps Script ' + API_REQUERIDA + ' o superior: actualiza el Apps Script (nueva versión de la implementación).</span>' : ''}</p>`;

  $('#k-ok').onclick = async () => {
    const url = $('#k-url').value.trim(), tok = $('#k-token').value.trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) { toast('La URL debe ser la del Web App y terminar en /exec', 'err'); return; }
    if (!tok) { toast('Falta el token', 'err'); return; }
    const prev = [API_URL, TOKEN, DEMO];
    API_URL = url; TOKEN = tok; DEMO = false;
    toast('Probando conexión…');
    try {
      await api('ping');
      LS.set('osc_url', url); LS.set('osc_token', tok); LS.set('osc_demo', '0');
      S.ots = []; S.lineas = [];
      toast('✓ Conectado', 'ok');
      await sync(true);
      render();
    } catch (e) {
      [API_URL, TOKEN, DEMO] = prev;
      toast('No se pudo conectar: ' + e.message, 'err');
    }
  };
  const on = $('#k-demo-on');
  if (on) on.onclick = async () => { DEMO = true; LS.set('osc_demo', '1'); await sync(true); location.hash = '#/ots'; };
  const off = $('#k-demo-off');
  if (off) off.onclick = async () => {
    DEMO = false; LS.set('osc_demo', '0');
    Object.assign(S, { config: {}, categorias: [], tiposItem: [], unidades: [], tarifario: [], clientes: [], solicitantes: [], ubicaciones: [], ots: [], lineas: [], fotos: [], cotizaciones: [], ordenesCompra: [], facturas: [] });
    Object.keys(FOTOS).forEach(k => delete FOTOS[k]);
    SYNCED = false; cargarCache(); actualizarEstado(); render();
    if (API_URL && TOKEN) sync(true);
  };
  const rs = $('#k-demo-reset');
  if (rs) rs.onclick = async () => { if (!confirm('¿Borrar los datos de la demo y volver a los de ejemplo?')) return; Demo.reset(); await sync(true); render(); };
  if (!conectado) return;

  $('#cats').addEventListener('input', e => {
    if (!e.target.classList.contains('c-vh')) return;
    const d = soloDigitos(e.target.value); e.target.value = d ? Number(d).toLocaleString('es-CL') : '';
  });
  $('#v-ok').onclick = async () => {
    const values = { IVA_PCT: Calc.num($('#v-iva').value), RECARGO_MATERIALES_PCT: Calc.num($('#v-rec').value) };
    if (values.IVA_PCT < 0 || values.RECARGO_MATERIALES_PCT < 0) { toast('Los porcentajes no pueden ser negativos', 'err'); return; }
    await guardarConfig(values);
  };
  $('#q-ok').onclick = () => guardarConfig({
    COT_CONDICIONES: $('#q-cond').value.trim(),
    COT_INCLUIR_CONDICIONES: $('#q-inc').checked ? 'SI' : 'NO',
    COT_MO_AGRUPADA: $('#q-agr').checked ? 'SI' : 'NO',
    COT_DETALLE_COMPRAS: $('#q-dc').checked ? 'SI' : 'NO',
    COT_DETALLE_MO: $('#q-dm').checked ? 'SI' : 'NO',
    COT_MOSTRAR_CANTIDAD: $('#q-cant').checked ? 'SI' : 'NO'
  });
  $('#e-ok').onclick = async () => {
    const values = {}; emp.forEach(([k]) => { values[k] = $('#e-' + k).value.trim(); });
    await guardarConfig(values);
  };
  $('#cat-add').onclick = () => {
    const div = document.createElement('div');
    div.className = 'cat-row'; div.dataset.id = '';
    div.innerHTML = `<input class="c-nom" placeholder="Nombre"><input class="c-vh" inputmode="numeric" placeholder="$"><input class="c-act" type="checkbox" checked>`;
    $('#cats').appendChild(div); div.querySelector('.c-nom').focus();
  };
  $('#cat-ok').onclick = async () => {
    const filas = [...document.querySelectorAll('#cats .cat-row')];
    const cambios = [];
    for (const [idx, f] of filas.entries()) {
      const item = { id: f.dataset.id, nombre: f.querySelector('.c-nom').value.trim(), valorHora: Number(soloDigitos(f.querySelector('.c-vh').value) || 0), activa: f.querySelector('.c-act').checked, orden: idx + 1 };
      if (!item.id && !item.nombre) continue;
      if (!item.nombre) { toast('Hay una categoría sin nombre', 'err'); return; }
      if (!(item.valorHora > 0)) { toast('Falta el valor hora de "' + item.nombre + '"', 'err'); return; }
      const prev = S.categorias.find(c => c.id === item.id);
      if (!prev || prev.nombre !== item.nombre || Calc.num(prev.valorHora) !== item.valorHora || (prev.activa !== false) !== item.activa || Calc.num(prev.orden) !== item.orden) cambios.push(item);
    }
    if (!cambios.length) { toast('No hay cambios', 'ok', 1200); return; }
    const btn = $('#cat-ok'); btn.disabled = true; toast('Guardando categorías…');
    try {
      const r = await api('saveCategorias', { items: cambios });
      const ids = new Set(r.items.map(x => x.id));
      S.categorias = S.categorias.filter(c => !ids.has(c.id)).concat(r.items);
      guardarCache(); toast('✓ Categorías guardadas', 'ok'); renderConfig(app);
    } catch (e) { toast('No se guardó: ' + e.message, 'err'); btn.disabled = false; }
  };
  $('#tar-add').onclick = () => {
    const v = $('#tar-vacio'); if (v) v.remove();
    const div = document.createElement('div'); div.innerHTML = filaTarifa({ id: '', nombre: '', categoriaId: '', unidad: '', precio: '', activo: true });
    const el = div.firstElementChild; $('#tarifas').appendChild(el); el.querySelector('.tf-nom').focus();
  };
  $('#tarifas').addEventListener('input', e => {
    if (!e.target.classList.contains('tf-pre')) return;
    const d = soloDigitos(e.target.value); e.target.value = d ? Number(d).toLocaleString('es-CL') : '';
  });
  $('#tar-ok').onclick = async () => {
    const cambios = [];
    for (const [idx, f] of [...document.querySelectorAll('#tarifas .tar-row')].entries()) {
      const item = { id: f.dataset.id, nombre: f.querySelector('.tf-nom').value.trim(), categoriaId: f.querySelector('.tf-cat').value,
        unidad: f.querySelector('.tf-uni').value, precio: Number(soloDigitos(f.querySelector('.tf-pre').value) || 0), activo: f.querySelector('.tf-act').checked, orden: idx + 1 };
      if (!item.id && !item.nombre) continue;
      if (!item.nombre) { toast('Hay un servicio sin nombre', 'err'); return; }
      if (!item.categoriaId || !item.unidad || !(item.precio > 0)) { toast('Completa categoría, unidad y precio de "' + item.nombre + '"', 'err'); return; }
      const prev = S.tarifario.find(t => t.id === item.id);
      if (!prev || ['nombre', 'categoriaId', 'unidad'].some(k => String(prev[k]) !== String(item[k])) || Calc.num(prev.precio) !== item.precio || (prev.activo !== false) !== item.activo || Calc.num(prev.orden) !== item.orden) cambios.push(item);
    }
    if (!cambios.length) { toast('No hay cambios', 'ok', 1200); return; }
    const btn = $('#tar-ok'); btn.disabled = true; toast('Guardando tarifario…');
    try {
      const r = await api('saveTarifario', { items: cambios });
      const ids = new Set(r.items.map(x => x.id));
      S.tarifario = S.tarifario.filter(t => !ids.has(t.id)).concat(r.items);
      guardarCache(); toast('✓ Tarifario guardado', 'ok'); renderConfig(app);
    } catch (e) { toast('No se guardó: ' + e.message, 'err'); btn.disabled = false; }
  };
  $('#uni-add').onclick = () => {
    const div = document.createElement('div'); div.className = 'tipo-row'; div.dataset.id = '';
    div.innerHTML = '<input class="u-nom" placeholder="Ej: m³"><input class="u-act" type="checkbox" checked>';
    $('#unis').appendChild(div); div.querySelector('.u-nom').focus();
  };
  $('#uni-ok').onclick = async () => {
    const cambios = [];
    for (const [idx, f] of [...document.querySelectorAll('#unis .tipo-row')].entries()) {
      const item = { id: f.dataset.id, nombre: f.querySelector('.u-nom').value.trim(), activo: f.querySelector('.u-act').checked, orden: idx + 1 };
      if (!item.id && !item.nombre) continue;
      if (!item.nombre) { toast('Hay una unidad sin nombre', 'err'); return; }
      const prev = S.unidades.find(u => u.id === item.id);
      if (!prev || prev.nombre !== item.nombre || (prev.activo !== false) !== item.activo || Calc.num(prev.orden) !== item.orden) cambios.push(item);
    }
    if (!cambios.length) { toast('No hay cambios', 'ok', 1200); return; }
    const btn = $('#uni-ok'); btn.disabled = true; toast('Guardando unidades…');
    try {
      const r = await api('saveUnidades', { items: cambios });
      const ids = new Set(r.items.map(x => x.id));
      S.unidades = S.unidades.filter(u => !ids.has(u.id)).concat(r.items);
      guardarCache(); toast('✓ Unidades guardadas', 'ok'); renderConfig(app);
    } catch (e) { toast('No se guardó: ' + e.message, 'err'); btn.disabled = false; }
  };
  $('#tipo-add').onclick = () => {
    const div = document.createElement('div');
    div.className = 'tipo-row'; div.dataset.id = '';
    div.innerHTML = `<input class="t-nom" placeholder="Ej: Peajes"><input class="t-act" type="checkbox" checked>`;
    $('#tipos').appendChild(div); div.querySelector('.t-nom').focus();
  };
  $('#tipo-ok').onclick = async () => {
    const cambios = [];
    for (const [idx, f] of [...document.querySelectorAll('#tipos .tipo-row')].entries()) {
      const item = { id: f.dataset.id, nombre: f.querySelector('.t-nom').value.trim(), activo: f.querySelector('.t-act').checked, orden: idx + 1 };
      if (!item.id && !item.nombre) continue;
      if (!item.nombre) { toast('Hay un tipo sin nombre', 'err'); return; }
      const prev = S.tiposItem.find(t => t.id === item.id);
      if (!prev || prev.nombre !== item.nombre || (prev.activo !== false) !== item.activo || Calc.num(prev.orden) !== item.orden) cambios.push(item);
    }
    if (!cambios.length) { toast('No hay cambios', 'ok', 1200); return; }
    const btn = $('#tipo-ok'); btn.disabled = true; toast('Guardando tipos…');
    try {
      const r = await api('saveTiposItem', { items: cambios });
      const ids = new Set(r.items.map(x => x.id));
      S.tiposItem = S.tiposItem.filter(t => !ids.has(t.id)).concat(r.items);
      guardarCache(); toast('✓ Tipos guardados', 'ok'); renderConfig(app);
    } catch (e) { toast('No se guardó: ' + e.message, 'err'); btn.disabled = false; }
  };
}

function filaTarifa(t) {
  const oficios = catsActivas().filter(c => c.uso !== 'Gestión');
  const unis = S.unidades.filter(u => u.activo !== false || u.nombre === t.unidad).map(u => u.nombre);
  if (t.unidad && !unis.includes(t.unidad)) unis.push(t.unidad);
  return `<div class="tar-row ${t.activo === false ? 'inactivo' : ''}" data-id="${esc(t.id)}">
    <input class="tf-nom" value="${esc(t.nombre)}" placeholder="Servicio (ej: Instalación de piso flotante)">
    <div class="tar-sub">
      <select class="tf-cat"><option value="">Categoría…</option>${oficios.map(c => `<option value="${esc(c.id)}" ${c.id === t.categoriaId ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
      <select class="tf-uni"><option value="">Unidad…</option>${unis.map(u => `<option ${u === t.unidad ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
      <input class="tf-pre" inputmode="numeric" placeholder="$ precio" value="${Calc.num(t.precio) ? Calc.num(t.precio).toLocaleString('es-CL') : ''}">
      <label class="tf-actl"><input class="tf-act" type="checkbox" ${t.activo !== false ? 'checked' : ''}> activo</label>
    </div>
  </div>`;
}

async function guardarConfig(values) {
  toast('Guardando…');
  try {
    const r = await api('saveConfig', { values });
    S.config = r.config; guardarCache(); toast('✓ Guardado', 'ok'); renderConfig($('#app'));
  } catch (e) { toast('No se guardó: ' + e.message, 'err'); }
}

// ════════════════════════════════════════════════════════ INICIO
$('#btn-sync').onclick = () => {
  if (ED && ED.dirty) { toast('Guarda la OT antes de sincronizar', 'err'); return; }
  sync();
};
cargarCache();
actualizarEstado();
if (!location.hash) history.replaceState(null, '', (DEMO || (API_URL && TOKEN)) ? '#/ots' : '#/config');
render();
if (DEMO || (API_URL && TOKEN)) sync(true);
