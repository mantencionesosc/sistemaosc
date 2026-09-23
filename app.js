/* Mantenciones OSC — App web (etapa 1: OT, Clientes, Config)
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

const S = { config: {}, categorias: [], clientes: [], solicitantes: [], ubicaciones: [], ots: [], lineas: [] };
let SYNCED = false;

// ════════════════════════════════════════════════════════ CÁLCULO (compartido con demo.js)
const Calc = {
  num(v) {
    if (typeof v === 'number') return v;
    const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  },
  vacio: v => v === '' || v === null || v === undefined,
  normalizarLinea(l, i, cfg, cats) {
    const tipo = l.tipo === 'Material' ? 'Material' : 'Mano de obra';
    const desc = String(l.descripcion || '').trim();
    if (!desc) throw new Error('La línea ' + (i + 1) + ' no tiene descripción');
    const o = {
      id: l.id || '', nOT: l.nOT || '', orden: i + 1, fecha: l.fecha || '', tipo,
      categoriaId: '', categoria: '', descripcion: desc,
      horas: '', hh: '', factor: '', cantidad: '', costoUnit: '', recargoPct: '',
      monto: 0, incluida: l.incluida !== false
    };
    if (tipo === 'Mano de obra') {
      const cat = cats.find(c => c.id === l.categoriaId);
      if (!cat) throw new Error('La línea ' + (i + 1) + ' necesita una categoría');
      const horas = Calc.num(l.horas);
      if (horas < 1) throw new Error('La línea ' + (i + 1) + ': mínimo 1 hora');
      if (Math.round(horas * 2) !== horas * 2) throw new Error('La línea ' + (i + 1) + ': las horas van de media en media (1; 1,5; 2…)');
      o.categoriaId = cat.id; o.categoria = cat.nombre;
      o.horas = horas;
      o.hh = Calc.vacio(l.hh) ? Calc.num(cfg.HH_BASE) : Calc.num(l.hh);
      o.factor = Calc.vacio(l.factor) ? Calc.num(cat.factor) : Calc.num(l.factor);
      o.monto = Math.round(o.horas * o.hh * o.factor);
    } else {
      const cant = Calc.num(l.cantidad);
      if (!(cant > 0)) throw new Error('La línea ' + (i + 1) + ': la cantidad debe ser mayor que 0');
      o.cantidad = cant;
      o.costoUnit = Calc.num(l.costoUnit);
      o.recargoPct = Calc.vacio(l.recargoPct) ? Calc.num(cfg.RECARGO_MATERIALES_PCT) : Calc.num(l.recargoPct);
      o.monto = Math.round(o.cantidad * o.costoUnit * (1 + o.recargoPct / 100));
    }
    return o;
  },
  montoLinea(l) {
    if (l.tipo === 'Material') return Math.round(Calc.num(l.cantidad) * Calc.num(l.costoUnit) * (1 + Calc.num(l.recargoPct) / 100));
    return Math.round(Calc.num(l.horas) * Calc.num(l.hh) * Calc.num(l.factor));
  },
  totales(lineas, ivaPct) {
    const neto = lineas.reduce((s, l) => s + (l.incluida !== false ? Calc.montoLinea(l) : 0), 0);
    const iva = Math.round(neto * Calc.num(ivaPct) / 100);
    return { neto, iva, total: neto + iva };
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
async function api(action, body = {}, intento = 1) {
  if (DEMO) return Demo.call(action, body);
  if (!API_URL || !TOKEN) throw new Error('Falta conectar la planilla (Config)');
  let texto;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(Object.assign({ action, token: TOKEN }, body)),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
    texto = await res.text();
  } catch (e) {
    if (intento < 3) { await new Promise(r => setTimeout(r, 800 * intento)); return api(action, body, intento + 1); }
    throw new Error('Sin conexión con la planilla. Revisa la señal e inténtalo de nuevo.');
  }
  let d;
  try { d = JSON.parse(texto); } catch (e) {
    // Google a veces entrega una página de error intermitente: se reintenta
    if (intento < 5) { await new Promise(r => setTimeout(r, 700 * intento)); return api(action, body, intento + 1); }
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
      config: d.config || {}, categorias: d.categorias || [], clientes: d.clientes || [],
      solicitantes: d.solicitantes || [], ubicaciones: d.ubicaciones || [], ots: d.ots || [], lineas: d.lineas || []
    });
    SYNCED = true;
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
  document.querySelectorAll('.bottom-nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === (vista === 'ot' ? 'ots' : vista === 'cliente' ? 'clientes' : vista)));
  document.body.classList.toggle('editor-open', vista === 'ot');
  const app = $('#app');
  if (vista !== 'ot') ED = null;
  if (vista === 'ot') return renderEditor(param);
  if (vista === 'clientes') return renderClientes(app);
  if (vista === 'cliente') return renderCliente(app, param);
  if (vista === 'config') return renderConfig(app);
  return renderOTs(app);
}

// ════════════════════════════════════════════════════════ LISTA DE OT
let FILTRO = LS.get('osc_filtro', 'activas');
let BUSQ = '';

function renderOTs(app) {
  const filtros = [['activas', 'Activas'], ['Pendiente', 'Pendientes'], ['En curso', 'En curso'], ['Terminada', 'Terminadas'], ['Anulada', 'Anuladas'], ['todas', 'Todas']];
  const q = norm(BUSQ);
  let lista = S.ots.slice().sort((a, b) => b.nOT - a.nOT);
  if (FILTRO === 'activas') lista = lista.filter(o => o.estado !== 'Anulada');
  else if (FILTRO !== 'todas') lista = lista.filter(o => o.estado === FILTRO);
  if (q) lista = lista.filter(o => norm([otNum(o.nOT), o.nOT, o.titulo, o.ubicacion, o.solicitante, o.cliente, o.nOC, o.folioSII].join(' ')).includes(q));

  const sinHH = !(Calc.num(S.config.HH_BASE) > 0) && (SYNCED || DEMO);
  app.innerHTML = `
    ${noConectado()}
    ${sinHH ? `<div class="warn-banner">⚠ Falta configurar el <b>valor HH</b>. Sin él, la mano de obra sale en $0. <a href="#/config">Ir a Config →</a></div>` : ''}
    <input class="search" type="search" id="busq" placeholder="Buscar OT, título, edificio, solicitante…" value="${esc(BUSQ)}">
    <div class="chips">${filtros.map(([k, t]) => `<button class="chip ${FILTRO === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
    <div id="ot-list" style="padding-bottom:64px">${lista.length ? lista.map(itemOT).join('') : `<div class="empty"><span class="big">📋</span>${S.ots.length ? 'No hay OT con este filtro.' : 'Aún no hay órdenes de trabajo.<br>Crea la primera con el botón de abajo.'}</div>`}</div>
    <button class="fab" id="btn-nueva">＋ Nueva OT</button>`;
  $('#busq').addEventListener('input', e => { BUSQ = e.target.value; const pos = e.target.selectionStart; renderOTs(app); const b = $('#busq'); b.focus(); b.setSelectionRange(pos, pos); });
  app.querySelectorAll('.chip').forEach(c => c.onclick = () => { FILTRO = c.dataset.f; LS.set('osc_filtro', FILTRO); renderOTs(app); });
  $('#btn-nueva').onclick = () => { location.hash = '#/ot/nueva'; };
}

function itemOT(o) {
  const nLin = S.lineas.filter(l => String(l.nOT) === String(o.nOT)).length;
  return `<a class="ot-item e-${slug(o.estado)}" href="#/ot/${o.nOT}">
    <div class="ot-top"><span class="ot-num">${otNum(o.nOT)}</span><span>${fechaCorta(o.fechaInicio)}</span></div>
    <div class="ot-tit">${esc(o.titulo)}</div>
    <div class="ot-meta">${esc([o.ubicacion, o.solicitante].filter(Boolean).join(' · ') || o.cliente)}</div>
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
        ot: { nOT: '', fechaInicio: hoyISO(), clienteId: cls.length === 1 ? cls[0].id : '', solicitanteId: '', ubicacionId: '', titulo: '', descripcion: '', estado: 'Pendiente', notas: '', nOC: '', folioSII: '', ivaPct: '' },
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
  const ro = !!o.folioSII;
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
      <label for="f-titulo">¿Qué pidió el cliente?</label>
      <input id="f-titulo" placeholder="Ej: Cambio de lavamanos" value="${esc(o.titulo)}" ${ro ? 'readonly' : ''}>

      <label>Estado del trabajo</label>
      <div class="seg" id="f-estado">${ESTADOS.map(e => `<button type="button" data-v="${e}" class="${o.estado === e ? 'on' : ''}" ${ro ? 'disabled' : ''}>${e}</button>`).join('')}</div>

      <div class="row">
        <div><label for="f-fecha">Fecha inicio</label><input type="date" id="f-fecha" value="${esc(String(o.fechaInicio || '').slice(0, 10))}" ${ro ? 'readonly' : ''}></div>
        ${cls.length > 1 || !o.clienteId ? `<div><label for="f-cliente">Cliente</label>
          <select id="f-cliente" ${ro ? 'disabled' : ''}><option value="">Seleccionar…</option>${cls.map(c => `<option value="${esc(c.id)}" ${c.id === o.clienteId ? 'selected' : ''}>${esc(c.nombreCorto || c.razonSocial)}</option>`).join('')}</select></div>`
        : `<div><label>Cliente</label><input readonly value="${esc((cls.find(c => c.id === o.clienteId) || {}).nombreCorto || (cls[0] || {}).razonSocial || '')}"></div>`}
      </div>

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

      <label for="f-desc">Detalle del pedido</label>
      <textarea id="f-desc" placeholder="Lo que pidió el cliente, con el detalle que haga falta" ${ro ? 'readonly' : ''}>${esc(o.descripcion)}</textarea>
    </div>

    <div class="card">
      <h2>🛠 Bitácora de trabajo <span class="extra">${ED.lineas.length} línea${ED.lineas.length === 1 ? '' : 's'}</span></h2>
      <div id="lineas">${ED.lineas.length ? ED.lineas.map(htmlLinea).join('') : `<p class="hint">Anota fila por fila cada acción: desinstalación, compra de materiales, instalación…</p>`}</div>
      ${ro ? '' : `<div class="add-lineas">
        <button class="btn btn-primary" id="add-mo">＋ Mano de obra</button>
        <button class="btn btn-sec" id="add-mat">＋ Material</button>
      </div>`}
    </div>

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
  $('#add-mat').onclick = () => abrirLinea(-1, false, 'Material');
  app.querySelectorAll('.linea').forEach(el => el.onclick = () => abrirLinea(+el.dataset.i));
  $('#ed-save').onclick = guardarOT;
}

function htmlLinea(l, i) {
  const mo = l.tipo !== 'Material';
  const calc = mo
    ? `${dec(l.horas)} h × ${clp(l.hh)} × ${dec(l.factor)}`
    : `${dec(l.cantidad)} × ${clp(l.costoUnit)}${Calc.num(l.recargoPct) ? ' + ' + dec(l.recargoPct) + '%' : ''}`;
  return `<div class="linea ${l.incluida === false ? 'excluida' : ''}" data-i="${i}">
    <div class="l-ico">${mo ? iconoCat(l.categoria) : '📦'}</div>
    <div class="l-body">
      <div class="l-cat">${esc(mo ? l.categoria : 'Material')}${l.incluida === false ? '<span class="tag-excl">No incluida</span>' : ''}</div>
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

function pintarTotales() {
  const ivaPct = Calc.vacio(ED.ot.ivaPct) ? S.config.IVA_PCT : ED.ot.ivaPct;
  const t = Calc.totales(ED.lineas, ivaPct);
  $('#ed-tot').innerHTML = `Neto ${clp(t.neto)} · IVA ${clp(t.iva)}<br><b>Total ${clp(t.total)}</b>`;
}

async function guardarOT() {
  const o = ED.ot;
  if (!String(o.titulo || '').trim()) { toast('Escribe qué pidió el cliente (título)', 'err'); $('#f-titulo').focus(); return; }
  if (!o.clienteId) { toast('Selecciona un cliente', 'err'); return; }
  const btn = $('#ed-save'); btn.disabled = true;
  toast('Guardando…');
  try {
    const r = await api('saveOT', { ot: o, lineas: ED.lineas });
    S.ots = S.ots.filter(x => String(x.nOT) !== String(r.ot.nOT)).concat([r.ot]);
    S.lineas = S.lineas.filter(x => String(x.nOT) !== String(r.ot.nOT)).concat(r.lineas);
    guardarCache();
    const eraNueva = !o.nOT;
    ED = { ot: r.ot, lineas: r.lineas, dirty: false };
    toast('✓ ' + otNum(r.ot.nOT) + ' guardada', 'ok');
    actualizarEstado();
    if (eraNueva) { history.replaceState(null, '', '#/ot/' + r.ot.nOT); }
    render();
  } catch (e) {
    toast('No se guardó: ' + e.message, 'err');
    btn.disabled = false;
  }
}

// ── Modal de línea ──────────────────────────────────
function abrirLinea(i, soloLectura = false, tipoNuevo = 'Mano de obra') {
  const nueva = i < 0;
  const cats = catsActivas();
  const l = nueva
    ? { tipo: tipoNuevo, fecha: hoyISO(), categoriaId: '', descripcion: '', horas: 1, hh: '', factor: '', cantidad: 1, costoUnit: '', recargoPct: '', incluida: true }
    : JSON.parse(JSON.stringify(ED.lineas[i]));
  // Valores congelados al crear la línea
  if (nueva) { l.hh = Calc.num(S.config.HH_BASE); l.recargoPct = Calc.num(S.config.RECARGO_MATERIALES_PCT); }
  const ro = soloLectura;

  function cuerpo() {
    const mo = l.tipo !== 'Material';
    const catActual = S.categorias.find(c => c.id === l.categoriaId);
    const catsLista = catActual && catActual.activa === false ? cats.concat([catActual]) : cats;
    const hhCfg = Calc.num(S.config.HH_BASE);
    const difiere = mo && !nueva && catActual && (Calc.num(l.hh) !== hhCfg || Calc.num(l.factor) !== Calc.num(catActual.factor));
    return `
      <h3>${nueva ? 'Nueva línea' : 'Línea ' + (i + 1)}<button class="x" data-cerrar aria-label="Cerrar">✕</button></h3>
      <div class="seg" id="l-tipo">
        <button type="button" data-v="Mano de obra" class="${mo ? 'on' : ''}" ${ro ? 'disabled' : ''}>🛠 Mano de obra</button>
        <button type="button" data-v="Material" class="${!mo ? 'on' : ''}" ${ro ? 'disabled' : ''}>📦 Material</button>
      </div>
      ${mo ? `<label>Categoría</label>
        <div class="cat-grid" id="l-cats">${catsLista.map(c => `<button type="button" class="cat-btn ${c.id === l.categoriaId ? 'on' : ''}" data-id="${esc(c.id)}" ${ro ? 'disabled' : ''}>${iconoCat(c.nombre)} ${esc(c.nombre)}<small>factor ${dec(c.factor)}</small></button>`).join('')}</div>` : ''}
      <label for="l-desc">${mo ? '¿Qué se hizo?' : '¿Qué material?'}</label>
      <textarea id="l-desc" placeholder="${mo ? 'Ej: Desinstalación de lavamanos' : 'Ej: Lavamanos loza blanco + sifón'}" ${ro ? 'readonly' : ''}>${esc(l.descripcion)}</textarea>
      ${mo ? `<label for="l-horas">Horas (mínimo 1, de media en media)</label>
        <div class="stepper">
          <button type="button" id="h-menos" ${ro ? 'disabled' : ''}>−</button>
          <input id="l-horas" inputmode="decimal" value="${dec(l.horas)}" ${ro ? 'readonly' : ''}>
          <button type="button" id="h-mas" ${ro ? 'disabled' : ''}>＋</button>
        </div>`
      : `<div class="row">
          <div><label for="l-cant">Cantidad</label><input id="l-cant" inputmode="decimal" value="${dec(l.cantidad)}" ${ro ? 'readonly' : ''}></div>
          <div><label for="l-costo">Costo unitario $</label><input id="l-costo" inputmode="numeric" placeholder="0" value="${l.costoUnit === '' ? '' : Math.round(Calc.num(l.costoUnit)).toLocaleString('es-CL')}" ${ro ? 'readonly' : ''}></div>
        </div>
        <label for="l-rec">Recargo %</label>
        <input id="l-rec" inputmode="decimal" value="${dec(l.recargoPct)}" ${ro ? 'readonly' : ''}>`}
      <label for="l-fecha">Fecha</label>
      <input type="date" id="l-fecha" value="${esc(String(l.fecha || '').slice(0, 10))}" ${ro ? 'readonly' : ''}>
      <label class="check"><input type="checkbox" id="l-incl" ${l.incluida !== false ? 'checked' : ''} ${ro ? 'disabled' : ''}> Incluir en la cotización</label>
      <div class="preview"><div class="calc" id="l-calc"></div><div class="monto" id="l-monto"></div></div>
      ${difiere && !ro ? `<div class="congelado">Esta línea usa los valores de cuando se creó: HH ${clp(l.hh)} y factor ${dec(l.factor)}. Config actual: HH ${clp(hhCfg)}, factor ${dec(catActual.factor)}. <button type="button" id="l-actualizar">Usar valores actuales</button></div>` : ''}
      ${ro ? '' : `<div class="btn-row">
        ${nueva ? '' : '<button class="btn btn-danger" id="l-del">Eliminar</button>'}
        <button class="btn btn-primary" id="l-ok">${nueva ? 'Agregar línea' : 'Listo'}</button>
      </div>
      ${nueva || ED.lineas.length < 2 ? '' : `<div class="mini-actions">
        <button class="btn btn-sec btn-sm" id="l-up" ${i === 0 ? 'disabled' : ''}>↑ Subir</button>
        <button class="btn btn-sec btn-sm" id="l-down" ${i === ED.lineas.length - 1 ? 'disabled' : ''}>↓ Bajar</button>
      </div>`}`}`;
  }

  function preview() {
    const mo = l.tipo !== 'Material';
    $('#l-calc').textContent = mo
      ? `${dec(l.horas)} h × ${clp(l.hh)} × ${l.factor === '' ? '—' : dec(l.factor)}`
      : `${dec(l.cantidad)} × ${clp(l.costoUnit)}${Calc.num(l.recargoPct) ? ' + ' + dec(l.recargoPct) + '%' : ''}`;
    $('#l-monto').textContent = clp(Calc.montoLinea(l));
  }

  function montar() {
    const m = abrirModal(cuerpo());
    preview();
    if (ro) return;
    m.querySelectorAll('#l-tipo button').forEach(b => b.onclick = () => {
      guardarDesc(); l.tipo = b.dataset.v; montar();
    });
    m.querySelectorAll('#l-cats .cat-btn').forEach(b => b.onclick = () => {
      guardarDesc();
      const c = S.categorias.find(x => x.id === b.dataset.id);
      l.categoriaId = c.id; l.categoria = c.nombre; l.factor = Calc.num(c.factor);
      montar();
    });
    const desc = $('#l-desc');
    const guardarDesc = () => { l.descripcion = desc.value; };
    desc.addEventListener('input', guardarDesc);
    $('#l-fecha').addEventListener('change', e => { l.fecha = e.target.value; });
    $('#l-incl').addEventListener('change', e => { l.incluida = e.target.checked; });
    if (l.tipo !== 'Material') {
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
        l.hh = Calc.num(S.config.HH_BASE); l.factor = Calc.num(c.factor); montar();
      };
    } else {
      $('#l-cant').addEventListener('input', e => { l.cantidad = Calc.num(e.target.value); preview(); });
      const co = $('#l-costo');
      co.addEventListener('input', () => {
        const d = soloDigitos(co.value);
        l.costoUnit = d === '' ? '' : Number(d);
        co.value = d === '' ? '' : Number(d).toLocaleString('es-CL');
        preview();
      });
      $('#l-rec').addEventListener('input', e => { l.recargoPct = Calc.num(e.target.value); preview(); });
    }
    $('#l-ok').onclick = () => {
      guardarDesc();
      try {
        if (l.tipo === 'Material') { l.categoriaId = ''; l.categoria = ''; l.horas = ''; l.hh = ''; l.factor = ''; if (l.costoUnit === '') l.costoUnit = 0; }
        else {
          l.cantidad = ''; l.costoUnit = ''; l.recargoPct = '';
          if (Calc.vacio(l.hh)) l.hh = Calc.num(S.config.HH_BASE);
        }
        Calc.normalizarLinea(l, nueva ? ED.lineas.length : i, S.config, S.categorias);
      } catch (e) { const m = e.message.replace(/^La línea \d+:? ?/, ''); toast(m.charAt(0).toUpperCase() + m.slice(1), 'err'); return; }
      l.monto = Calc.montoLinea(l);
      if (nueva) ED.lineas.push(l); else ED.lineas[i] = l;
      marcar(); cerrarModal(); renderEditor(ruta()[1]);
    };
    const del = $('#l-del');
    if (del) del.onclick = () => {
      if (!confirm('¿Eliminar esta línea?')) return;
      ED.lineas.splice(i, 1); marcar(); cerrarModal(); renderEditor(ruta()[1]);
    };
    const mover = d => { guardarDesc(); ED.lineas[i] = l; const j = i + d; [ED.lineas[i], ED.lineas[j]] = [ED.lineas[j], ED.lineas[i]]; marcar(); cerrarModal(); renderEditor(ruta()[1]); };
    const up = $('#l-up'); if (up) up.onclick = () => mover(-1);
    const dn = $('#l-down'); if (dn) dn.onclick = () => mover(1);
  }
  montar();
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
  const hh = Calc.num(cfg.HH_BASE);
  const cats = S.categorias.slice().sort((a, b) => Calc.num(a.orden) - Calc.num(b.orden));
  const emp = [['EMPRESA_NOMBRE', 'Nombre de fantasía'], ['EMPRESA_RAZON_SOCIAL', 'Razón social'], ['EMPRESA_RUT', 'RUT'], ['EMPRESA_GIRO', 'Giro'], ['EMPRESA_DIRECCION', 'Dirección'], ['EMPRESA_TELEFONO', 'Teléfono'], ['EMPRESA_CORREO', 'Correo']];

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
      <label for="v-hh">Valor HH base (neto)</label>
      <input id="v-hh" inputmode="numeric" value="${hh ? hh.toLocaleString('es-CL') : ''}" placeholder="Ej: 10.000">
      <div class="row">
        <div><label for="v-iva">IVA %</label><input id="v-iva" inputmode="decimal" value="${dec(cfg.IVA_PCT ?? 19)}"></div>
        <div><label for="v-rec">Recargo mat. %</label><input id="v-rec" inputmode="decimal" value="${dec(cfg.RECARGO_MATERIALES_PCT ?? 0)}"></div>
      </div>
      <p class="hint">Mano de obra = horas × HH base × factor de la categoría. Materiales = cantidad × costo × (1 + recargo). Las líneas ya creadas conservan sus valores.</p>
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="v-ok">Guardar valores</button>
    </div>

    <div class="card">
      <h2>🏷 Categorías y factores</h2>
      <div class="cat-head"><span>Categoría</span><span>Factor</span><span>Activa</span></div>
      <div id="cats">${cats.map(c => `
        <div class="cat-row" data-id="${esc(c.id)}">
          <input class="c-nom" value="${esc(c.nombre)}">
          <input class="c-fac" inputmode="decimal" value="${dec(c.factor)}">
          <input class="c-act" type="checkbox" ${c.activa !== false ? 'checked' : ''}>
          <div class="ejemplo">1 h = ${clp(hh * Calc.num(c.factor))}</div>
        </div>`).join('')}</div>
      <button class="btn btn-sec btn-sm" id="cat-add">＋ Agregar categoría</button>
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="cat-ok">Guardar categorías</button>
    </div>

    <div class="card">
      <h2>🏠 Datos de la empresa</h2>
      <p class="hint" style="margin:-6px 0 4px">Aparecerán en las cotizaciones.</p>
      ${emp.map(([k, t]) => `<label for="e-${k}">${t}</label><input id="e-${k}" value="${esc(cfg[k])}">`).join('')}
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="e-ok">Guardar datos</button>
    </div>` : ''}

    <p class="hint" style="text-align:center;margin:18px 0">Mantenciones OSC · etapa 1</p>`;

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
    Object.assign(S, { config: {}, categorias: [], clientes: [], solicitantes: [], ubicaciones: [], ots: [], lineas: [] });
    SYNCED = false; cargarCache(); actualizarEstado(); render();
    if (API_URL && TOKEN) sync(true);
  };
  const rs = $('#k-demo-reset');
  if (rs) rs.onclick = async () => { if (!confirm('¿Borrar los datos de la demo y volver a los de ejemplo?')) return; Demo.reset(); await sync(true); render(); };
  if (!conectado) return;

  const hhIn = $('#v-hh');
  hhIn.addEventListener('input', () => { const d = soloDigitos(hhIn.value); hhIn.value = d ? Number(d).toLocaleString('es-CL') : ''; });
  $('#v-ok').onclick = async () => {
    const values = { HH_BASE: Number(soloDigitos(hhIn.value) || 0), IVA_PCT: Calc.num($('#v-iva').value), RECARGO_MATERIALES_PCT: Calc.num($('#v-rec').value) };
    if (values.IVA_PCT < 0 || values.RECARGO_MATERIALES_PCT < 0) { toast('Los porcentajes no pueden ser negativos', 'err'); return; }
    await guardarConfig(values);
  };
  $('#e-ok').onclick = async () => {
    const values = {}; emp.forEach(([k]) => { values[k] = $('#e-' + k).value.trim(); });
    await guardarConfig(values);
  };
  $('#cat-add').onclick = () => {
    const div = document.createElement('div');
    div.className = 'cat-row'; div.dataset.id = '';
    div.innerHTML = `<input class="c-nom" placeholder="Nombre"><input class="c-fac" inputmode="decimal" value="1"><input class="c-act" type="checkbox" checked>`;
    $('#cats').appendChild(div); div.querySelector('.c-nom').focus();
  };
  $('#cat-ok').onclick = async () => {
    const filas = [...document.querySelectorAll('#cats .cat-row')];
    const cambios = [];
    for (const [idx, f] of filas.entries()) {
      const item = { id: f.dataset.id, nombre: f.querySelector('.c-nom').value.trim(), factor: Calc.num(f.querySelector('.c-fac').value), activa: f.querySelector('.c-act').checked, orden: idx + 1 };
      if (!item.id && !item.nombre) continue;
      if (!item.nombre) { toast('Hay una categoría sin nombre', 'err'); return; }
      if (!(item.factor > 0)) { toast('El factor de "' + item.nombre + '" debe ser mayor que 0', 'err'); return; }
      const prev = S.categorias.find(c => c.id === item.id);
      if (!prev || prev.nombre !== item.nombre || Calc.num(prev.factor) !== item.factor || (prev.activa !== false) !== item.activa || Calc.num(prev.orden) !== item.orden) cambios.push(item);
    }
    if (!cambios.length) { toast('No hay cambios', 'ok', 1200); return; }
    const btn = $('#cat-ok'); btn.disabled = true; toast('Guardando categorías…');
    try {
      for (const item of cambios) {
        const r = await api('saveCategoria', { item });
        S.categorias = S.categorias.filter(c => c.id !== r.item.id).concat([r.item]);
      }
      guardarCache(); toast('✓ Categorías guardadas', 'ok'); renderConfig(app);
    } catch (e) { toast('No se guardó: ' + e.message, 'err'); btn.disabled = false; }
  };
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
