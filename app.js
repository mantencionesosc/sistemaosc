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

const S = { config: {}, categorias: [], tiposItem: [], clientes: [], solicitantes: [], ubicaciones: [], ots: [], lineas: [], fotos: [], cotizaciones: [] };
const FOTOS = {};   // nOT -> [{...foto, data}] (se cargan al abrir la OT)
let SYNCED = false;

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
  normalizarLinea(l, i, cfg, cats, tipos) {
    const tipo = Calc.tipoDe(l);
    const n = 'La línea ' + (i + 1);
    const desc = String(l.descripcion || '').trim();
    if (!desc) throw new Error(n + ' no tiene descripción');
    const o = {
      id: l.id || '', nOT: l.nOT || '', orden: i + 1, fecha: l.fecha || '', tipo,
      categoriaId: '', categoria: '', descripcion: desc,
      horas: '', hh: '', factor: '', cantidad: '', costoUnit: '', recargoPct: '',
      monto: 0, incluida: l.incluida !== false, tipoItemId: '', tipoItem: ''
    };
    if (tipo === 'Compra') {
      const t = tipos.find(x => x.id === l.tipoItemId);
      if (!t) throw new Error(n + ': elige el tipo de ítem (material, insumo…)');
      const cant = Calc.num(l.cantidad);
      if (!(cant > 0)) throw new Error(n + ': la cantidad debe ser mayor que 0');
      o.tipoItemId = t.id; o.tipoItem = t.nombre;
      o.cantidad = cant;
      o.costoUnit = Calc.num(l.costoUnit);
      o.recargoPct = Calc.vacio(l.recargoPct) ? Calc.num(cfg.RECARGO_MATERIALES_PCT) : Calc.num(l.recargoPct);
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
    o.categoriaId = cat.id; o.categoria = cat.nombre;
    o.horas = horas;
    o.hh = Calc.vacio(l.hh) ? Calc.num(cfg.HH_BASE) : Calc.num(l.hh);
    o.factor = Calc.vacio(l.factor) ? Calc.num(cat.factor) : Calc.num(l.factor);
    o.monto = Calc.montoLinea(o);
    return o;
  },
  montoLinea(l) {
    if (Calc.tipoDe(l) === 'Compra') return Math.round(Calc.num(l.cantidad) * Calc.num(l.costoUnit) * (1 + Calc.num(l.recargoPct) / 100));
    return Math.round(Calc.num(l.horas) * Calc.num(l.hh) * Calc.num(l.factor));
  },
  subtotal: lineas => lineas.reduce((s, l) => s + (l.incluida !== false ? Calc.montoLinea(l) : 0), 0),
  totales(lineas, ivaPct) {
    const neto = Calc.subtotal(lineas);
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
      config: d.config || {}, categorias: d.categorias || [], tiposItem: d.tiposItem || [], clientes: d.clientes || [],
      solicitantes: d.solicitantes || [], ubicaciones: d.ubicaciones || [], ots: d.ots || [], lineas: d.lineas || [],
      fotos: d.fotos || [], cotizaciones: d.cotizaciones || []
    });
    SYNCED = true;
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
    <div class="ot-meta">${esc([o.ubicacion, o.solicitante].filter(Boolean).join(' · ') || o.cliente)}${(() => { const nf = S.fotos.filter(f => String(f.nOT) === String(o.nOT)).length, nc = S.cotizaciones.filter(c => String(c.nOT) === String(o.nOT)).length; return (nf ? ' · 📷 ' + nf : '') + (nc ? ' · 📄 v' + nc : ''); })()}</div>
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

    ${bloqueCompras(ro)}

    <div class="card">
      <h2>🛠 Mano de obra <span class="extra">${clp(Calc.subtotal(grupo('Mano de obra').map(x => x[0])))}</span></h2>
      ${grupo('Mano de obra').map(([l, i]) => htmlLinea(l, i)).join('') || `<p class="hint">Cada acción de oficio: desinstalación, instalación, reparación…</p>`}
      ${ro ? '' : `<button class="btn btn-primary btn-full" style="margin-top:12px" id="add-mo">＋ Mano de obra</button>`}
    </div>

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
  app.querySelectorAll('[data-det]').forEach(cb => cb.addEventListener('change', () => {
    const set = new Set(String(o.detallar || '').split(',').filter(Boolean));
    if (cb.checked) set.add(cb.dataset.det); else set.delete(cb.dataset.det);
    o.detallar = [...set].join(','); marcar();
  }));
  app.querySelectorAll('.linea').forEach(el => el.onclick = () => abrirLinea(+el.dataset.i));
  $('#ed-save').onclick = guardarOT;
}

// Líneas de un tipo, con su índice en ED.lineas
const grupo = tipo => ED.lineas.map((l, i) => [l, i]).filter(([l]) => Calc.tipoDe(l) === tipo);

function bloqueCompras(ro) {
  const compras = grupo('Compra'), tiempos = grupo('Tiempo de gestión');
  const sub = Calc.subtotal(compras.concat(tiempos).map(x => x[0]));
  const presentes = [...new Map(compras.map(([l]) => [l.tipoItemId, l.tipoItem || (S.tiposItem.find(t => t.id === l.tipoItemId) || {}).nombre])).entries()].filter(([id]) => id);
  const det = new Set(String(ED.ot.detallar || '').split(',').filter(Boolean));
  return `<div class="card">
    <h2>🛒 Gestión de compras <span class="extra">${clp(sub)}</span></h2>
    <div class="sub-h">Ítems comprados o cotizados</div>
    ${compras.map(([l, i]) => htmlLinea(l, i)).join('') || `<p class="hint">Materiales, insumos, arriendo de herramientas, flete… Anota también las alternativas cotizadas y marca la elegida.</p>`}
    ${ro ? '' : `<button class="btn btn-sec btn-full" style="margin-top:10px" id="add-compra">＋ Ítem de compra</button>`}
    <div class="sub-h" style="margin-top:18px">Tiempo de gestión</div>
    ${tiempos.map(([l, i]) => htmlLinea(l, i)).join('') || `<p class="hint">Horas usadas en cotizar, comprar y retirar.</p>`}
    ${ro ? '' : `<button class="btn btn-sec btn-full" style="margin-top:10px" id="add-tiempo">＋ Tiempo de gestión</button>`}
    ${presentes.length ? `<div class="det-box">
      <div class="sub-h" style="margin:0 0 4px">En la cotización</div>
      <p class="hint" style="margin:0 0 4px">Sin marcar, todo va en una sola línea: <i>Gestión de compras y materiales</i>.</p>
      ${presentes.map(([id, nom]) => `<label class="check"><input type="checkbox" data-det="${esc(id)}" ${det.has(id) ? 'checked' : ''} ${ro ? 'disabled' : ''}> Detallar ${esc(nom)}</label>`).join('')}
    </div>` : ''}
  </div>`;
}

function htmlLinea(l, i) {
  const tipo = Calc.tipoDe(l);
  const compra = tipo === 'Compra';
  const calc = compra
    ? `${dec(l.cantidad)} × ${clp(l.costoUnit)}${Calc.num(l.recargoPct) ? ' + ' + dec(l.recargoPct) + '%' : ''}`
    : `${dec(l.horas)} h × ${clp(l.hh)} × ${dec(l.factor)}`;
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
    const ordenadas = TIPOS_LINEA.flatMap(t => ED.lineas.filter(l => Calc.tipoDe(l) === t));
    const r = await api('saveOT', { ot: o, lineas: ordenadas });
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
    l.hh = Calc.num(S.config.HH_BASE);
    l.recargoPct = Calc.num(S.config.RECARGO_MATERIALES_PCT);
    if (l.tipo === 'Tiempo de gestión' && gestion) { l.categoriaId = gestion.id; l.categoria = gestion.nombre; l.factor = Calc.num(gestion.factor); }
    if (l.tipo === 'Compra') { const t = tiposActivos()[0]; if (t) { l.tipoItemId = t.id; l.tipoItem = t.nombre; } }
  }
  const compra = l.tipo === 'Compra', tiempo = l.tipo === 'Tiempo de gestión';
  const titulo = compra ? 'Ítem de compra' : tiempo ? 'Tiempo de gestión' : 'Mano de obra';
  const mismoGrupo = ED.lineas.map((x, k) => k).filter(k => Calc.tipoDe(ED.lineas[k]) === l.tipo);
  const pos = mismoGrupo.indexOf(i);

  function cuerpo() {
    const catActual = S.categorias.find(c => c.id === l.categoriaId);
    const oficios = catsActivas().filter(c => c.uso !== 'Gestión');
    const catsLista = catActual && catActual.activa === false && catActual.uso !== 'Gestión' ? oficios.concat([catActual]) : oficios;
    const hhCfg = Calc.num(S.config.HH_BASE);
    const difiere = !compra && !nueva && catActual && (Calc.num(l.hh) !== hhCfg || Calc.num(l.factor) !== Calc.num(catActual.factor));
    const tipos = tiposActivos();
    const tipoActual = S.tiposItem.find(t => t.id === l.tipoItemId);
    const tiposLista = tipoActual && tipoActual.activo === false ? tipos.concat([tipoActual]) : tipos;
    return `
      <h3>${nueva ? titulo : titulo + ' · editar'}<button class="x" data-cerrar aria-label="Cerrar">✕</button></h3>
      ${compra ? `<label for="l-tipoitem">Tipo de ítem</label>
        <select id="l-tipoitem" ${ro ? 'disabled' : ''}>${tiposLista.map(t => `<option value="${esc(t.id)}" ${t.id === l.tipoItemId ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select>` : ''}
      ${tiempo ? `<p class="hint" style="margin:0 0 4px">🛒 ${esc(gestion ? gestion.nombre : 'Gestión de compras')} · factor ${dec(l.factor)}</p>` : ''}
      ${l.tipo === 'Mano de obra' ? `<label>Categoría</label>
        <div class="cat-grid" id="l-cats">${catsLista.map(c => `<button type="button" class="cat-btn ${c.id === l.categoriaId ? 'on' : ''}" data-id="${esc(c.id)}" ${ro ? 'disabled' : ''}>${iconoCat(c.nombre)} ${esc(c.nombre)}<small>factor ${dec(c.factor)}</small></button>`).join('')}</div>` : ''}
      <label for="l-desc">${compra ? '¿Qué se compró o cotizó?' : tiempo ? '¿Qué gestión se hizo?' : '¿Qué se hizo?'}</label>
      <textarea id="l-desc" placeholder="${compra ? 'Ej: Lavamanos loza blanco (Sodimac)' : tiempo ? 'Ej: Cotizar en 2 ferreterías' : 'Ej: Desinstalación de lavamanos'}" ${ro ? 'readonly' : ''}>${esc(l.descripcion)}</textarea>
      ${!compra ? `<label for="l-horas">Horas (mínimo 1, de media en media)</label>
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
      <label class="check"><input type="checkbox" id="l-incl" ${l.incluida !== false ? 'checked' : ''} ${ro ? 'disabled' : ''}> ${compra ? 'Elegido (se cobra)' : 'Incluir en la cotización'}</label>
      ${compra ? `<p class="hint" style="margin-top:4px">Desmárcalo si es una alternativa descartada: queda anotada pero no suma.</p>` : ''}
      <div class="preview"><div class="calc" id="l-calc"></div><div class="monto" id="l-monto"></div></div>
      ${difiere && !ro ? `<div class="congelado">Esta línea usa los valores de cuando se creó: HH ${clp(l.hh)} y factor ${dec(l.factor)}. Config actual: HH ${clp(hhCfg)}, factor ${dec(catActual.factor)}. <button type="button" id="l-actualizar">Usar valores actuales</button></div>` : ''}
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
    $('#l-calc').textContent = compra
      ? `${dec(l.cantidad)} × ${clp(l.costoUnit)}${Calc.num(l.recargoPct) ? ' + ' + dec(l.recargoPct) + '%' : ''}`
      : `${dec(l.horas)} h × ${clp(l.hh)} × ${l.factor === '' ? '—' : dec(l.factor)}`;
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
      l.categoriaId = c.id; l.categoria = c.nombre; l.factor = Calc.num(c.factor);
      montar();
    });
    $('#l-fecha').addEventListener('change', e => { l.fecha = e.target.value; });
    $('#l-incl').addEventListener('change', e => { l.incluida = e.target.checked; });
    if (!compra) {
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
      $('#l-rec').addEventListener('input', e => { l.recargoPct = Calc.num(e.target.value); preview(); });
    }
    $('#l-ok').onclick = () => {
      guardarDesc();
      if (compra && l.costoUnit === '') l.costoUnit = 0;
      if (!compra && Calc.vacio(l.hh)) l.hh = Calc.num(S.config.HH_BASE);
      try {
        Calc.normalizarLinea(l, nueva ? ED.lineas.length : i, S.config, S.categorias, S.tiposItem);
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
  const o = ED.ot, ro = !!o.folioSII, n = o.nOT;
  const meta = n ? S.fotos.filter(f => String(f.nOT) === String(n)) : [];
  const fotos = FOTOS[n];
  let grid;
  if (!n) grid = '<p class="hint">Guarda la OT para poder agregar fotos.</p>';
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

// ════════════════════════════════════════════════════════ COTIZACIÓN PDF
function renderCotCard() {
  const box = $('#cot-card'); if (!box || !ED) return;
  const n = ED.ot.nOT;
  const cots = n ? S.cotizaciones.filter(c => String(c.nOT) === String(n)).sort((a, b) => a.version - b.version) : [];
  const sig = cots.reduce((m, c) => Math.max(m, Calc.num(c.version)), 0) + 1;
  box.innerHTML = `<h2>📄 Cotización</h2>
    ${cots.length ? cots.map(c => `<div class="list-item" style="cursor:default">
        <div class="li-body"><div class="li-tit">${otNum(n)} v${esc(c.version)}</div><div class="li-sub">${fechaCorta(c.fecha)} ${esc(String(c.fecha).slice(11, 16))} · ${clp(c.total)}</div></div>
        ${c.pdfUrl ? `<a class="btn btn-sec btn-sm" href="${esc(c.pdfUrl)}" target="_blank" rel="noopener">Ver PDF</a>` : ''}
      </div>`).join('') : `<p class="hint">${n ? 'Aún no se ha generado ninguna cotización.' : 'Guarda la OT para generar la cotización.'}</p>`}
    ${n ? `<button class="btn btn-primary btn-full" style="margin-top:12px" id="cot-gen">📄 Generar cotización v${sig}</button>` : ''}`;
  const b = $('#cot-gen'); if (b) b.onclick = () => modalCotizacion(sig);
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

function modalCotizacion(version) {
  if (ED.dirty) { toast('Guarda los cambios de la OT antes de generar la cotización', 'err'); return; }
  const cfg = S.config;
  const hayCond = !!String(cfg.COT_CONDICIONES || '').trim();
  const nFotos = S.fotos.filter(f => String(f.nOT) === String(ED.ot.nOT) && f.enPresupuesto !== false).length;
  const det = String(ED.ot.detallar || '').split(',').filter(Boolean).map(id => (S.tiposItem.find(t => t.id === id) || {}).nombre).filter(Boolean);
  const m = abrirModal(`
    <h3>Cotización ${otNum(ED.ot.nOT)} v${version}<button class="x" data-cerrar>✕</button></h3>
    <label class="check"><input type="checkbox" id="c-agr" ${cfg.COT_MO_AGRUPADA === 'SI' ? 'checked' : ''}> Agrupar mano de obra por categoría</label>
    <label class="check"><input type="checkbox" id="c-cond" ${hayCond && cfg.COT_INCLUIR_CONDICIONES === 'SI' ? 'checked' : ''} ${hayCond ? '' : 'disabled'}> Incluir condiciones</label>
    ${hayCond ? '' : '<p class="hint">Para usar condiciones, escríbelas en Config → Cotizaciones.</p>'}
    <p class="hint" style="margin-top:12px">🛒 Compras: ${det.length ? 'se detallan ' + esc(det.join(', ')) + '; el resto va en una línea.' : 'todo en una línea (<i>Gestión de compras y materiales</i>).'} Se cambia en el bloque de gestión de compras.</p>
    <p class="hint">📷 ${nFotos ? nFotos + ' foto' + (nFotos === 1 ? '' : 's') + ' en el anexo fotográfico.' : 'Sin fotos marcadas para la cotización.'}</p>
    ${S.config.EMPRESA_RUT ? '' : '<p class="hint" style="color:#8A5310">⚠ Faltan datos de la empresa (RUT, etc.) en Config.</p>'}
    <div class="btn-row"><button class="btn btn-primary" id="c-ok">Generar</button></div>`);
  $('#c-ok').onclick = async () => {
    const opciones = { agruparMO: $('#c-agr').checked, incluirCondiciones: $('#c-cond').checked, detallar: String(ED.ot.detallar || '').split(',').filter(Boolean) };
    m.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const { doc, totales } = await armarPDF(version, opciones);
      toast('Guardando en Drive…');
      const pdf = doc.output('datauristring').split(',')[1];
      const r = await api('saveCotizacion', { nOT: ED.ot.nOT, version, pdf, neto: totales.neto, total: totales.total });
      S.cotizaciones.push(r.item); guardarCache();
      const nombre = `Cotizacion_${otNum(ED.ot.nOT)}_v${r.item.version}.pdf`;
      const file = new File([doc.output('blob')], nombre, { type: 'application/pdf' });
      toast('✓ Cotización lista', 'ok');
      renderCotCard();
      modalCompartir(file, r.item);
    } catch (e) {
      toast('No se generó: ' + e.message, 'err');
      m.querySelectorAll('button').forEach(b => b.disabled = false);
    }
  };
}

async function armarPDF(version, opciones) {
  toast('Preparando PDF…');
  await cargarScript('lib/jspdf.umd.min.js');
  const o = ED.ot;
  const [logo, fotos] = await Promise.all([dataUrlDe('img/logo-pdf.png').catch(() => null), cargarFotos(o.nOT).catch(() => [])]);
  const ivaPct = Calc.vacio(o.ivaPct) ? Calc.num(S.config.IVA_PCT) : Calc.num(o.ivaPct);
  const totales = Object.assign(Calc.totales(ED.lineas, ivaPct), { ivaPct });
  const doc = Cotizacion.generar({
    ot: o, lineas: ED.lineas.map(l => Object.assign({}, l, { tipo: Calc.tipoDe(l) })), cfg: S.config,
    cliente: S.clientes.find(c => c.id === o.clienteId) || {},
    solicitante: S.solicitantes.find(x => x.id === o.solicitanteId),
    ubicacion: S.ubicaciones.find(x => x.id === o.ubicacionId),
    version, fechaISO: hoyISO(), opciones, logo, totales, montoLinea: Calc.montoLinea,
    fotos: fotos.filter(f => f.enPresupuesto !== false)
  });
  return { doc, totales };
}

function modalCompartir(file, item) {
  const url = URL.createObjectURL(file);
  const puedeCompartir = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  abrirModal(`
    <h3>✓ ${esc(file.name.replace('.pdf', '').replace(/_/g, ' '))}<button class="x" data-cerrar>✕</button></h3>
    <p class="hint">Quedó guardada${item.pdfUrl ? ' en Drive' : ''} y registrada en la OT.</p>
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
  const hh = Calc.num(cfg.HH_BASE);
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
      <label for="v-hh">Valor HH base (neto)</label>
      <input id="v-hh" inputmode="numeric" value="${hh ? hh.toLocaleString('es-CL') : ''}" placeholder="Ej: 10.000">
      <div class="row">
        <div><label for="v-iva">IVA %</label><input id="v-iva" inputmode="decimal" value="${dec(cfg.IVA_PCT ?? 19)}"></div>
        <div><label for="v-rec">Recargo compras %</label><input id="v-rec" inputmode="decimal" value="${dec(cfg.RECARGO_MATERIALES_PCT ?? 0)}"></div>
      </div>
      <p class="hint">Mano de obra = horas × HH base × factor de la categoría. Ítems de compra = cantidad × costo × (1 + recargo). Las líneas ya creadas conservan sus valores.</p>
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="v-ok">Guardar valores</button>
    </div>

    <div class="card">
      <h2>🏷 Categorías y factores</h2>
      <div class="cat-head"><span>Categoría</span><span>Factor</span><span>Activa</span></div>
      <div id="cats">${cats.map(c => `
        <div class="cat-row" data-id="${esc(c.id)}">
          <input class="c-nom" value="${esc(c.nombre)}">
          <input class="c-fac" inputmode="decimal" value="${dec(c.factor)}">
          <input class="c-act" type="checkbox" ${c.activa !== false ? 'checked' : ''} ${c.uso === 'Gestión' ? 'disabled title="Siempre activa"' : ''}>
          ${c.uso === 'Gestión' ? '<div class="uso">🛒 Factor del tiempo de gestión de compras</div>' : ''}
          <div class="ejemplo">1 h = ${clp(hh * Calc.num(c.factor))}</div>
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
      <label class="check"><input type="checkbox" id="q-agr" ${cfg.COT_MO_AGRUPADA === 'SI' ? 'checked' : ''}> Agrupar mano de obra por categoría</label>
      <button class="btn btn-primary btn-full" style="margin-top:14px" id="q-ok">Guardar</button>
    </div>` : ''}

    <p class="hint" style="text-align:center;margin:18px 0">Mantenciones OSC · versión 2.0</p>`;

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
    Object.assign(S, { config: {}, categorias: [], tiposItem: [], clientes: [], solicitantes: [], ubicaciones: [], ots: [], lineas: [], fotos: [], cotizaciones: [] });
    Object.keys(FOTOS).forEach(k => delete FOTOS[k]);
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
  $('#q-ok').onclick = () => guardarConfig({
    COT_CONDICIONES: $('#q-cond').value.trim(),
    COT_INCLUIR_CONDICIONES: $('#q-inc').checked ? 'SI' : 'NO',
    COT_MO_AGRUPADA: $('#q-agr').checked ? 'SI' : 'NO'
  });
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
      for (const item of cambios) {
        const r = await api('saveTipoItem', { item });
        S.tiposItem = S.tiposItem.filter(t => t.id !== r.item.id).concat([r.item]);
      }
      guardarCache(); toast('✓ Tipos guardados', 'ok'); renderConfig(app);
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
