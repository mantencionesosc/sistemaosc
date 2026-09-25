/* Mantenciones OSC — Etapa 3: órdenes de compra, facturación, pagos y panel de ventas.
 * Usa las funciones y el estado de app.js (se cargan antes que este archivo se ejecute por primera vez).
 * Ojo: aquí no se usa nada de app.js a nivel superior, solo dentro de funciones.
 */

let FACT_TAB = null;       // 'resumen' | 'porfacturar' | 'facturas'
let SEL_OC = null;         // Set de N° OC seleccionadas para facturar
let PANEL = { periodo: 'mes', desde: '', hasta: '', cliente: '' };

// ════════════════════════════════════════════════════════ AYUDAS
const listaCSV = v => String(v ?? '').split(',').map(x => x.trim()).filter(Boolean);
const ocsDeCot = c => S.ordenesCompra.filter(o => listaCSV(o.cots).some(id => {
  const x = S.cotizaciones.find(k => k.id === id);
  return x && claveCot(x) === claveCot(c);
}));
const clienteDe = id => S.clientes.find(c => c.id === id) || {};
const nombreCliente = id => { const c = clienteDe(id); return c.nombreCorto || c.razonSocial || ''; };
const sumar = (xs, k) => xs.reduce((s, x) => s + Calc.num(x[k]), 0);
const montosOC = o => ({ neto: Calc.num(o.neto), iva: Calc.num(o.iva), total: Calc.num(o.monto) });

function actualizarOTsEnEstado(ots) {
  (ots || []).forEach(o => { S.ots = S.ots.filter(x => String(x.nOT) !== String(o.nOT)).concat([o]); });
}

/** Tres campos neto / IVA / total que se completan entre sí (IVA según Config). */
function camposMontos(pref, m) {
  return `<div class="row">
      <div><label for="${pref}-neto">Neto</label><input id="${pref}-neto" inputmode="numeric" value="${m.neto ? Math.round(m.neto).toLocaleString('es-CL') : ''}"></div>
      <div><label for="${pref}-iva">IVA</label><input id="${pref}-iva" inputmode="numeric" value="${m.iva ? Math.round(m.iva).toLocaleString('es-CL') : ''}"></div>
    </div>
    <label for="${pref}-total">Total (bruto)</label><input id="${pref}-total" inputmode="numeric" value="${m.total ? Math.round(m.total).toLocaleString('es-CL') : ''}">`;
}
function enlazarMontos(pref, onCambio) {
  const g = k => $('#' + pref + '-' + k);
  const val = k => Number(soloDigitos(g(k).value) || 0);
  const fmt = (k, v) => { g(k).value = v ? Math.round(v).toLocaleString('es-CL') : ''; };
  const ivaPct = Calc.num(S.config.IVA_PCT || 19);
  g('neto').addEventListener('input', () => { const n = val('neto'); fmt('neto', n); fmt('iva', Math.round(n * ivaPct / 100)); fmt('total', n + Math.round(n * ivaPct / 100)); onCambio && onCambio(); });
  g('iva').addEventListener('input', () => { fmt('iva', val('iva')); fmt('total', val('neto') + val('iva')); onCambio && onCambio(); });
  g('total').addEventListener('input', () => { fmt('total', val('total')); onCambio && onCambio(); });
  return () => ({ neto: val('neto'), iva: val('iva'), total: val('total') });
}

function leerArchivo(file) {
  if (!file) return Promise.resolve(null);
  if (file.type.startsWith('image/')) return comprimirImagen(file, 2000, 0.82).then(data => ({ data, mime: 'image/jpeg' }));
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('El archivo supera 8 MB'));
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ data: String(r.result).split(',')[1], mime: file.type || 'application/pdf' });
    r.onerror = () => rej(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(file);
  });
}

// ════════════════════════════════════════════════════════ OC DESDE LA COTIZACIÓN
function bloqueOC(c) {
  const ocs = ocsDeCot(c);
  const e = estadoCot(c);
  if (ocs.length) {
    return `<div class="card"><h2>🧾 Orden de compra</h2>
      ${ocs.map(o => `<div class="list-item" data-oc="${esc(o.nOC)}"><div class="li-body">
        <div class="li-tit">OC ${esc(o.nOC)} ${o.folio ? `<span class="badge b-folio">Folio ${esc(o.folio)}</span>` : '<span class="badge b-pendiente">Por facturar</span>'}</div>
        <div class="li-sub">${fechaCorta(o.fecha)} · Total ${clp(o.monto)}</div></div><span class="chev">›</span></div>`).join('')}
    </div>`;
  }
  if (!c.numero || !['Vigente', 'Aprobada'].includes(e)) return '';
  return `<div class="card"><h2>🧾 Orden de compra</h2>
    <p class="hint">Cuando el cliente envíe la OC, regístrala aquí: la cotización queda aprobada y todas sus OT quedan con el N° de OC.</p>
    <button class="btn btn-primary btn-full" style="margin-top:10px" id="cd-oc">🧾 Asignar OC</button></div>`;
}

function enlazarBloqueOC(app, c) {
  const b = app.querySelector('#cd-oc'); if (b) b.onclick = () => modalAsignarOC(c);
  app.querySelectorAll('[data-oc]').forEach(el => el.onclick = () => modalOC(el.dataset.oc));
}

function modalAsignarOC(cot) {
  const clienteId = cot.clienteId || (S.ots.find(o => otsDeCot(cot).includes(Number(o.nOT))) || {}).clienteId;
  // Otras cotizaciones del mismo cliente que podrían ir en la misma OC
  const otras = gruposCot().map(g => g.ultima).filter(x => x.id !== cot.id && x.numero && ['Vigente', 'Aprobada'].includes(estadoCot(x)) && !ocsDeCot(x).length
    && (x.clienteId || (S.ots.find(o => otsDeCot(x).includes(Number(o.nOT))) || {}).clienteId) === clienteId);
  const sel = new Set([cot.id]);
  const sumaCots = () => {
    const cs = S.cotizaciones.filter(x => sel.has(x.id));
    const neto = sumar(cs, 'neto'), total = sumar(cs, 'total');
    return { neto, total, iva: total - neto };
  };
  const m0 = sumaCots();
  const m = abrirModal(`
    <h3>Asignar OC<button class="x" data-cerrar>✕</button></h3>
    <p class="hint" style="margin:0">${esc(etiquetaCot(cot))} · ${esc(nombreCliente(clienteId))}</p>
    <div class="row">
      <div><label for="oc-n">N° de OC</label><input id="oc-n" inputmode="text" placeholder="Ej: 4500123456"></div>
      <div><label for="oc-f">Fecha OC</label><input id="oc-f" type="date" value="${hoyISO()}"></div>
    </div>
    ${otras.length ? `<label>¿Esta OC cubre otras cotizaciones?</label>
      ${otras.map(x => `<label class="check" style="margin-top:6px"><input type="checkbox" data-otra="${esc(x.id)}"> ${esc(etiquetaCot(x))} · ${clp(x.total)}</label>`).join('')}` : ''}
    <p class="hint" style="margin-top:12px">Montos tal como vienen en la OC:</p>
    ${camposMontos('oc', m0)}
    <div id="oc-cmp" class="hint" style="margin-top:8px"></div>
    <label for="oc-doc">Documento de la OC (opcional, PDF o foto)</label>
    <input id="oc-doc" type="file" accept="application/pdf,image/*">
    <label for="oc-notas">Notas</label><input id="oc-notas" placeholder="Opcional">
    <div class="btn-row"><button class="btn btn-primary" id="oc-ok">Guardar OC</button></div>`);
  const leer = enlazarMontos('oc', () => comparar());
  const comparar = () => {
    const c = sumaCots(), o = leer();
    const dif = o.total - c.total;
    $('#oc-cmp').innerHTML = `Cotización${sel.size > 1 ? 'es' : ''}: neto ${clp(c.neto)} · total ${clp(c.total)}` +
      (o.total && Math.abs(dif) > 1 ? `<br><b style="color:#B3261E">⚠ La OC ${dif > 0 ? 'supera' : 'es menor que'} la cotización por ${clp(Math.abs(dif))}</b>` : o.total ? '<br>✓ Cuadra con la cotización' : '');
  };
  m.querySelectorAll('[data-otra]').forEach(cb => cb.onchange = () => {
    if (cb.checked) sel.add(cb.dataset.otra); else sel.delete(cb.dataset.otra);
    const s = sumaCots();
    ['neto', 'iva', 'total'].forEach(k => { $('#oc-' + k).value = s[k] ? Math.round(s[k]).toLocaleString('es-CL') : ''; });
    comparar();
  });
  comparar();
  $('#oc-ok').onclick = async () => {
    const nOC = $('#oc-n').value.trim();
    if (!nOC) { toast('Escribe el N° de OC', 'err'); return; }
    const montos = leer();
    if (!(montos.total > 0)) { toast('Falta el total de la OC', 'err'); return; }
    const c = sumaCots();
    if (Math.abs(montos.total - c.total) > 1 && !confirm(`La OC es de ${clp(montos.total)} y la cotización de ${clp(c.total)}. ¿Guardar igual?`)) return;
    m.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const archivo = await leerArchivo($('#oc-doc').files[0]);
      toast('Guardando OC…');
      const r = await api('saveOC', Object.assign({ nOC, fecha: $('#oc-f').value, notas: $('#oc-notas').value.trim(), cots: [...sel], archivo }, montos));
      S.ordenesCompra.push(r.item);
      const aprob = new Set(r.cots);
      S.cotizaciones = S.cotizaciones.map(x => aprob.has(x.id) ? Object.assign({}, x, { estado: 'Aprobada' }) : x);
      actualizarOTsEnEstado(r.ots);
      guardarCache();
      toast('✓ OC ' + nOC + ' registrada', 'ok');
      cerrarModal(); render();
    } catch (e) {
      toast('No se guardó: ' + e.message, 'err');
      m.querySelectorAll('button').forEach(b => b.disabled = false);
    }
  };
}

function modalOC(nOC) {
  const o = S.ordenesCompra.find(x => String(x.nOC) === String(nOC)); if (!o) return;
  const cots = listaCSV(o.cots).map(id => S.cotizaciones.find(c => c.id === id)).filter(Boolean);
  const ots = listaCSV(o.ots).map(n => S.ots.find(x => String(x.nOT) === n)).filter(Boolean);
  const m = abrirModal(`
    <h3>OC ${esc(o.nOC)}<button class="x" data-cerrar>✕</button></h3>
    <p style="margin:0 0 6px">${o.folio ? `<span class="badge b-folio">Facturada · folio ${esc(o.folio)}</span>` : '<span class="badge b-pendiente">Por facturar</span>'}</p>
    <p class="hint">${esc(nombreCliente(o.clienteId))} · ${fechaCorta(o.fecha)}</p>
    <div class="res-row"><span>Neto</span><span>${clp(o.neto)}</span></div>
    <div class="res-row"><span>IVA</span><span>${clp(o.iva)}</span></div>
    <div class="res-row fuerte"><span>Total</span><span>${clp(o.monto)}</span></div>
    <p class="hint" style="margin-top:10px">Cotizaciones: ${cots.map(c => esc(etiquetaCot(c))).join(', ') || '—'}<br>
    OT: ${ots.map(x => otNum(x.nOT) + ' · ' + esc(x.titulo)).join('<br>') || '—'}</p>
    ${o.notas ? `<p class="hint">📝 ${esc(o.notas)}</p>` : ''}
    <div class="btn-row" style="flex-direction:column">
      ${o.archivoUrl ? `<a class="btn btn-sec" href="${esc(o.archivoUrl)}" target="_blank" rel="noopener">📎 Ver documento de la OC</a>` : ''}
      ${o.folio ? '' : '<button class="btn btn-danger" id="moc-del">Quitar OC</button>'}
    </div>`);
  const del = m.querySelector('#moc-del');
  if (del) del.onclick = async () => {
    if (!confirm(`¿Quitar la OC ${o.nOC}? Las OT quedan sin OC y la cotización vuelve a Vigente.`)) return;
    toast('Quitando OC…');
    try {
      await api('deleteOC', { nOC: o.nOC });
      await sync(true);
      toast('✓ OC quitada', 'ok'); cerrarModal(); render();
    } catch (e) { toast('No se pudo: ' + e.message, 'err'); }
  };
}

// ════════════════════════════════════════════════════════ PESTAÑA FACTURACIÓN
function renderFact(app) {
  if (!FACT_TAB) FACT_TAB = LS.get('osc_fact_tab', 'resumen');
  const porFacturar = S.ordenesCompra.filter(o => !o.folio);
  const pendientes = S.facturas.filter(f => f.estadoPago !== 'Pagada');
  const tabs = [['resumen', '📊 Resumen'], ['porfacturar', `Por facturar${porFacturar.length ? ' (' + porFacturar.length + ')' : ''}`], ['facturas', `Facturas${pendientes.length ? ' (' + pendientes.length + ')' : ''}`]];
  app.innerHTML = `${noConectado()}
    <div class="seg" id="ft-tabs" style="margin-bottom:12px">${tabs.map(([k, t]) => `<button type="button" data-v="${k}" class="${FACT_TAB === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div id="ft-body"></div>`;
  app.querySelectorAll('#ft-tabs button').forEach(b => b.onclick = () => { FACT_TAB = b.dataset.v; LS.set('osc_fact_tab', FACT_TAB); SEL_OC = null; renderFact(app); });
  const body = $('#ft-body');
  if (FACT_TAB === 'porfacturar') return renderPorFacturar(body, porFacturar);
  if (FACT_TAB === 'facturas') return renderFacturas(body);
  return renderPanel(body);
}

function renderPorFacturar(body, ocs) {
  if (!SEL_OC) SEL_OC = new Set();
  ocs = ocs.slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const selOCs = ocs.filter(o => SEL_OC.has(String(o.nOC)));
  const tot = { neto: sumar(selOCs, 'neto'), iva: sumar(selOCs, 'iva'), total: sumar(selOCs, 'monto') };
  body.innerHTML = ocs.length ? `
    <p class="hint" style="margin:0 0 10px">Marca las OC que van en una misma factura (mismo cliente).</p>
    ${ocs.map(o => {
      const sel = SEL_OC.has(String(o.nOC));
      const ots = listaCSV(o.ots).map(n => S.ots.find(x => String(x.nOT) === n)).filter(Boolean);
      const cots = listaCSV(o.cots).map(id => S.cotizaciones.find(c => c.id === id)).filter(Boolean);
      return `<div class="ot-item ${sel ? 'sel' : ''}" data-oc-sel="${esc(o.nOC)}" style="cursor:pointer">
        <div class="ot-top"><span class="ot-num"><span class="selbox">${sel ? '☑' : '☐'}</span> OC ${esc(o.nOC)}</span><span>${fechaCorta(o.fecha)}</span></div>
        <div class="ot-meta" style="margin-top:4px">${esc(nombreCliente(o.clienteId))} · ${cots.map(c => esc(etiquetaCot(c))).join(', ')}<br>${ots.map(x => otNum(x.nOT) + ' · ' + esc(x.titulo)).join('<br>')}</div>
        <div class="ot-bottom"><button class="btn btn-sec btn-sm" data-ver-oc="${esc(o.nOC)}">Ver OC</button><div class="ot-total">${clp(o.monto)}<div class="hint" style="text-align:right;margin:0">neto ${clp(o.neto)}</div></div></div>
      </div>`;
    }).join('')}
    <div style="height:96px"></div>
    <div class="sel-bar"><div class="inner" style="flex-wrap:wrap">
      <div class="hint" style="width:100%;margin:0 0 6px">${selOCs.length ? `${selOCs.length} OC · neto ${clp(tot.neto)} · IVA ${clp(tot.iva)} · <b>total ${clp(tot.total)}</b>` : 'Ninguna OC marcada'}</div>
      <button class="btn btn-sec" id="pf-copiar" ${selOCs.length ? '' : 'disabled'}>📋 Copiar datos</button>
      <button class="btn btn-primary" id="pf-folio" ${selOCs.length ? '' : 'disabled'}>🧾 Registrar folio</button>
    </div></div>`
    : `<div class="empty"><span class="big">🧾</span>No hay OC por facturar.<br>Las OC se asignan desde la cotización aprobada.</div>`;
  body.querySelectorAll('[data-oc-sel]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-ver-oc]')) return;
    const n = el.dataset.ocSel;
    const o = ocs.find(x => String(x.nOC) === n);
    if (SEL_OC.has(n)) SEL_OC.delete(n);
    else {
      const otro = selOCs.find(x => x.clienteId !== o.clienteId);
      if (otro) { toast('Solo OC del mismo cliente', 'err'); return; }
      SEL_OC.add(n);
    }
    renderPorFacturar(body, ocs);
  });
  body.querySelectorAll('[data-ver-oc]').forEach(b => b.onclick = e => { e.stopPropagation(); modalOC(b.dataset.verOc); });
  const cp = $('#pf-copiar'); if (cp) cp.onclick = () => copiarDatosFactura(selOCs, tot);
  const fo = $('#pf-folio'); if (fo) fo.onclick = () => modalRegistrarFolio(selOCs, tot);
}

function textoFactura(ocs, tot) {
  const cli = clienteDe(ocs[0].clienteId);
  const detalle = ocs.map(o => {
    const cots = listaCSV(o.cots).map(id => S.cotizaciones.find(c => c.id === id)).filter(Boolean).map(c => claveCot(c));
    const ots = listaCSV(o.ots).map(n => S.ots.find(x => String(x.nOT) === n)).filter(Boolean).map(x => `${otNum(x.nOT)} ${x.titulo}`);
    return `OC ${o.nOC} (${[...new Set(cots)].join(', ')}): ${ots.join('; ')}`;
  }).join(' / ');
  const cab = [
    `Cliente: ${cli.razonSocial || ''}`,
    cli.rut && `RUT: ${cli.rut}`,
    cli.giro && `Giro: ${cli.giro}`,
    [cli.direccion, cli.comuna].filter(Boolean).length && `Dirección: ${[cli.direccion, cli.comuna].filter(Boolean).join(', ')}`
  ].filter(Boolean);
  const refs = [
    `Referencias (OC, código 801): ${ocs.map(o => `N° ${o.nOC} del ${fechaCorta(o.fecha)}`).join(' · ')}`,
    `Detalle: Servicios de mantención según ${detalle}`
  ];
  const montos = [`Neto: ${clp(tot.neto)}`, `IVA ${dec(S.config.IVA_PCT || 19)}%: ${clp(tot.iva)}`, `Total: ${clp(tot.total)}`];
  return [cab.join('\n'), refs.join('\n'), montos.join('\n')].join('\n\n');
}

async function copiarDatosFactura(ocs, tot) {
  const txt = textoFactura(ocs, tot);
  let ok = false;
  try { await navigator.clipboard.writeText(txt); ok = true; } catch (e) { /* sin permiso: se muestra para copiar a mano */ }
  abrirModal(`<h3>Datos para la factura<button class="x" data-cerrar>✕</button></h3>
    <p class="hint">${ok ? '✓ Copiado. Pégalo en el portal del SII al emitir la factura.' : 'Selecciona y copia el texto:'}</p>
    <textarea readonly style="min-height:240px;font-size:14px">${esc(txt)}</textarea>`);
}

function modalRegistrarFolio(ocs, tot) {
  const m = abrirModal(`
    <h3>Registrar factura<button class="x" data-cerrar>✕</button></h3>
    <p class="hint" style="margin:0">${esc(nombreCliente(ocs[0].clienteId))} · OC ${ocs.map(o => esc(o.nOC)).join(', ')}</p>
    <div class="row">
      <div><label for="fa-folio">Folio SII</label><input id="fa-folio" inputmode="numeric" placeholder="Ej: 125"></div>
      <div><label for="fa-fecha">Fecha factura</label><input id="fa-fecha" type="date" value="${hoyISO()}"></div>
    </div>
    <p class="hint" style="margin-top:12px">Montos de la factura emitida:</p>
    ${camposMontos('fa', tot)}
    <label for="fa-notas">Notas</label><input id="fa-notas" placeholder="Opcional">
    <p class="hint" style="margin-top:10px">Al registrar el folio, las OT de estas OC quedan facturadas y en solo lectura.</p>
    <div class="btn-row"><button class="btn btn-primary" id="fa-ok">Registrar factura</button></div>`);
  const leer = enlazarMontos('fa');
  $('#fa-ok').onclick = async () => {
    const folio = $('#fa-folio').value.trim();
    if (!folio) { toast('Escribe el folio SII', 'err'); return; }
    const montos = leer();
    if (!(montos.total > 0)) { toast('Falta el total', 'err'); return; }
    if (!confirm(`¿Registrar la factura folio ${folio} por ${clp(montos.total)}?`)) return;
    m.querySelectorAll('button').forEach(b => b.disabled = true);
    toast('Registrando…');
    try {
      const r = await api('saveFactura', Object.assign({ folio, fecha: $('#fa-fecha').value, ocs: ocs.map(o => o.nOC), notas: $('#fa-notas').value.trim() }, montos));
      S.facturas.push(r.item);
      const set = new Set(r.ocs.map(String));
      S.ordenesCompra = S.ordenesCompra.map(o => set.has(String(o.nOC)) ? Object.assign({}, o, { folio }) : o);
      actualizarOTsEnEstado(r.ots);
      guardarCache();
      SEL_OC = null; FACT_TAB = 'facturas';
      toast('✓ Factura ' + folio + ' registrada', 'ok'); cerrarModal(); render();
    } catch (e) {
      toast('No se registró: ' + e.message, 'err');
      m.querySelectorAll('button').forEach(b => b.disabled = false);
    }
  };
}

let FILTRO_FAC = 'pendientes';
function renderFacturas(body) {
  let fs = S.facturas.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.folio).localeCompare(String(a.folio)));
  if (FILTRO_FAC === 'pendientes') fs = fs.filter(f => f.estadoPago !== 'Pagada');
  else if (FILTRO_FAC === 'pagadas') fs = fs.filter(f => f.estadoPago === 'Pagada');
  const pend = S.facturas.filter(f => f.estadoPago !== 'Pagada');
  body.innerHTML = `
    <div class="chips">${[['pendientes', 'Por cobrar'], ['pagadas', 'Pagadas'], ['todas', 'Todas']].map(([k, t]) => `<button class="chip ${FILTRO_FAC === k ? 'on' : ''}" data-ff="${k}">${t}</button>`).join('')}</div>
    ${pend.length ? `<div class="warn-banner" style="background:var(--azul-bg);color:var(--azul)">Por cobrar: <b>${clp(sumar(pend, 'total'))}</b> en ${pend.length} factura${pend.length === 1 ? '' : 's'}</div>` : ''}
    ${fs.length ? fs.map(f => `<div class="ot-item e-${f.estadoPago === 'Pagada' ? 'terminada' : 'pendiente'}" data-fac="${esc(f.folio)}" style="cursor:pointer">
        <div class="ot-top"><span class="ot-num">Folio ${esc(f.folio)}</span><span>${fechaCorta(f.fecha)}</span></div>
        <div class="ot-meta" style="margin-top:4px">${esc(nombreCliente(f.clienteId))} · OC ${esc(listaCSV(f.nOC).join(', '))} · ${listaCSV(f.ots).length} OT</div>
        <div class="ot-bottom"><div class="badges">${f.estadoPago === 'Pagada' ? `<span class="badge b-terminada">Pagada ${fechaCorta(f.fechaPago)}</span>` : '<span class="badge b-pendiente">Pendiente de pago</span>'}</div>
          <div class="ot-total">${clp(f.total)}<div class="hint" style="text-align:right;margin:0">IVA ${clp(f.iva)}</div></div></div>
      </div>`).join('') : `<div class="empty"><span class="big">💰</span>No hay facturas en esta vista.</div>`}
    <div style="height:40px"></div>`;
  body.querySelectorAll('[data-ff]').forEach(c => c.onclick = () => { FILTRO_FAC = c.dataset.ff; renderFacturas(body); });
  body.querySelectorAll('[data-fac]').forEach(el => el.onclick = () => modalFactura(el.dataset.fac));
}

function modalFactura(folio) {
  const f = S.facturas.find(x => String(x.folio) === String(folio)); if (!f) return;
  const pagada = f.estadoPago === 'Pagada';
  const ots = listaCSV(f.ots).map(n => S.ots.find(x => String(x.nOT) === n)).filter(Boolean);
  const m = abrirModal(`
    <h3>Factura folio ${esc(f.folio)}<button class="x" data-cerrar>✕</button></h3>
    <p style="margin:0 0 6px">${pagada ? `<span class="badge b-terminada">Pagada el ${fechaCorta(f.fechaPago)}</span>` : '<span class="badge b-pendiente">Pendiente de pago</span>'}</p>
    <p class="hint">${esc(nombreCliente(f.clienteId))} · ${fechaCorta(f.fecha)} · OC ${esc(listaCSV(f.nOC).join(', '))}</p>
    <div class="res-row"><span>Neto</span><span>${clp(f.neto)}</span></div>
    <div class="res-row"><span>IVA</span><span>${clp(f.iva)}</span></div>
    <div class="res-row fuerte"><span>Total</span><span>${clp(f.total)}</span></div>
    <p class="hint" style="margin-top:10px">${ots.map(x => otNum(x.nOT) + ' · ' + esc(x.titulo)).join('<br>')}</p>
    ${pagada ? `${f.refPago ? `<p class="hint">Referencia: ${esc(f.refPago)}</p>` : ''}
      <div class="btn-row"><button class="btn btn-sec" id="mf-pend">↺ Marcar pendiente</button></div>`
    : `<div class="card" style="background:var(--crema);box-shadow:none;margin-top:12px">
        <div class="row">
          <div><label for="mf-fp">Fecha de pago</label><input id="mf-fp" type="date" value="${hoyISO()}"></div>
          <div><label for="mf-ref">Referencia</label><input id="mf-ref" placeholder="N° transferencia"></div>
        </div>
        <button class="btn btn-primary btn-full" style="margin-top:12px" id="mf-pag">✓ Registrar pago</button>
      </div>
      <div class="btn-row"><button class="btn btn-danger" id="mf-del">Quitar factura</button></div>`}`);
  const guardarPago = async body => {
    toast('Guardando…');
    try {
      const r = await api('setPago', Object.assign({ folio: f.folio }, body));
      S.facturas = S.facturas.map(x => String(x.folio) === String(f.folio) ? r.item : x); guardarCache();
      toast('✓ Guardado', 'ok'); cerrarModal(); render();
    } catch (e) { toast('No se guardó: ' + e.message, 'err'); }
  };
  const on = (sel, fn) => { const el = m.querySelector(sel); if (el) el.onclick = fn; };
  on('#mf-pag', () => guardarPago({ estadoPago: 'Pagada', fechaPago: $('#mf-fp').value, refPago: $('#mf-ref').value.trim() }));
  on('#mf-pend', () => guardarPago({ estadoPago: 'Pendiente' }));
  on('#mf-del', async () => {
    if (!confirm(`¿Quitar el registro de la factura ${f.folio}? Sus OC vuelven a "Por facturar" y las OT se pueden editar otra vez. (No anula la factura en el SII.)`)) return;
    toast('Quitando…');
    try { await api('deleteFactura', { folio: f.folio }); await sync(true); toast('✓ Factura quitada', 'ok'); cerrarModal(); render(); }
    catch (e) { toast('No se pudo: ' + e.message, 'err'); }
  });
}

// ════════════════════════════════════════════════════════ PANEL (RESUMEN)
const isoLocal = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function rangoPanel() {
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
  const p = PANEL.periodo;
  if (p === 'semana') { const d = new Date(hoy); const dia = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dia); const f = new Date(d); f.setDate(d.getDate() + 6); return [isoLocal(d), isoLocal(f), 'Semana actual']; }
  if (p === 'mesant') { const d = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1, 12); const f = new Date(hoy.getFullYear(), hoy.getMonth(), 0, 12); return [isoLocal(d), isoLocal(f), MESES[d.getMonth()] + ' ' + d.getFullYear()]; }
  if (p === 'anio') return [hoy.getFullYear() + '-01-01', hoy.getFullYear() + '-12-31', 'Año ' + hoy.getFullYear()];
  if (p === 'custom') return [PANEL.desde || isoLocal(hoy), PANEL.hasta || isoLocal(hoy), 'Personalizado'];
  const d = new Date(hoy.getFullYear(), hoy.getMonth(), 1, 12), f = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 12);
  return [isoLocal(d), isoLocal(f), MESES[d.getMonth()] + ' ' + d.getFullYear()];
}
const enRango = (iso, [a, b]) => { const x = String(iso || '').slice(0, 10); return x >= a && x <= b; };

/** Neto por categoría de un conjunto de OT, con el recargo repartido. */
function netoPorCategoria(ots) {
  const m = new Map();
  ots.forEach(o => {
    const ls = S.lineas.filter(l => String(l.nOT) === String(o.nOT) && l.incluida !== false);
    const sub = Calc.subtotal(ls);
    const k = sub ? Calc.num(o.neto) / sub : 1;
    ls.forEach(l => {
      const t = Calc.tipoDe(l);
      const cat = t === 'Compra' ? 'Materiales y compras' : t === 'Tiempo de gestión' ? 'Gestión de compras' : (l.categoria || 'Mano de obra');
      m.set(cat, (m.get(cat) || 0) + Calc.montoLinea(l) * k);
    });
  });
  return [...m.entries()].map(([cat, v]) => [cat, Math.round(v)]).sort((a, b) => b[1] - a[1]);
}

function datosPanel() {
  const rango = rangoPanel();
  const cli = PANEL.cliente;
  const porCli = x => !cli || x.clienteId === cli;
  const facs = S.facturas.filter(porCli);
  const facPeriodo = facs.filter(f => enRango(f.fecha, rango));
  const cobradas = facs.filter(f => f.estadoPago === 'Pagada' && enRango(f.fechaPago, rango));
  const porCobrar = facs.filter(f => f.estadoPago !== 'Pagada');
  const ots = S.ots.filter(o => porCli(o) && o.estado !== 'Anulada' && enRango(o.fechaInicio, rango));
  const cotsVig = gruposCot().map(g => g.ultima).filter(c => estadoCot(c) === 'Vigente' && !ocsDeCot(c).length
    && (!cli || (c.clienteId || (S.ots.find(o => otsDeCot(c).includes(Number(o.nOT))) || {}).clienteId) === cli));
  const ocsSinFac = S.ordenesCompra.filter(o => porCli(o) && !o.folio);
  const otsFacturadas = [...new Set(facPeriodo.flatMap(f => listaCSV(f.ots)))].map(n => S.ots.find(o => String(o.nOT) === n)).filter(Boolean);
  // Últimos 6 meses (hasta el mes del fin del periodo)
  const hoyIso = isoLocal(new Date());
  const fin = new Date((rango[1] < hoyIso ? rango[1] : hoyIso) + 'T12:00:00');
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(fin.getFullYear(), fin.getMonth() - i, 1, 12);
    const clave = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const fsM = facs.filter(f => String(f.fecha).slice(0, 7) === clave);
    meses.push({ clave, etiqueta: MESES[d.getMonth()] + (d.getMonth() === 0 || i === 5 ? ' ' + String(d.getFullYear()).slice(2) : ''), neto: sumar(fsM, 'neto'), iva: sumar(fsM, 'iva'), n: fsM.length });
  }
  const estados = {};
  ots.forEach(o => { estados[o.estado] = (estados[o.estado] || 0) + 1; });
  return {
    rango, facPeriodo, cobradas, porCobrar, ots, estados, cotsVig, ocsSinFac, meses,
    fact: { neto: sumar(facPeriodo, 'neto'), iva: sumar(facPeriodo, 'iva'), total: sumar(facPeriodo, 'total') },
    categorias: netoPorCategoria(otsFacturadas)
  };
}

function renderPanel(body) {
  const d = datosPanel();
  const clientes = S.clientes.filter(c => c.activo !== false);
  const per = [['semana', 'Semana'], ['mes', 'Mes'], ['mesant', 'Mes anterior'], ['anio', 'Año'], ['custom', 'Personalizado']];
  const tile = (titulo, valor, sub, destacado) => `<div class="kpi ${destacado ? 'kpi-dest' : ''}"><div class="kpi-t">${titulo}</div><div class="kpi-v">${valor}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ''}</div>`;
  body.innerHTML = `
    <div class="chips">${per.map(([k, t]) => `<button class="chip ${PANEL.periodo === k ? 'on' : ''}" data-per="${k}">${t}</button>`).join('')}</div>
    ${PANEL.periodo === 'custom' ? `<div class="row" style="margin-bottom:10px"><div><label for="pn-d">Desde</label><input type="date" id="pn-d" value="${esc(d.rango[0])}"></div><div><label for="pn-h">Hasta</label><input type="date" id="pn-h" value="${esc(d.rango[1])}"></div></div>` : ''}
    ${clientes.length > 1 ? `<select id="pn-cli" style="margin-bottom:10px"><option value="">Todos los clientes</option>${clientes.map(c => `<option value="${esc(c.id)}" ${PANEL.cliente === c.id ? 'selected' : ''}>${esc(c.nombreCorto || c.razonSocial)}</option>`).join('')}</select>` : ''}
    <p class="hint" style="margin:0 0 10px">📅 ${fechaCorta(d.rango[0])} al ${fechaCorta(d.rango[1])}</p>

    <div class="kpis">
      ${tile('Facturado (neto)', clp(d.fact.neto), `${d.facPeriodo.length} factura${d.facPeriodo.length === 1 ? '' : 's'} · total ${clp(d.fact.total)}`, true)}
      ${tile('IVA del periodo', clp(d.fact.iva), 'IVA de las facturas emitidas (débito)')}
      ${tile('Cobrado', clp(sumar(d.cobradas, 'total')), `${d.cobradas.length} pago${d.cobradas.length === 1 ? '' : 's'} en el periodo`)}
      ${tile('Por cobrar', clp(sumar(d.porCobrar, 'total')), `${d.porCobrar.length} factura${d.porCobrar.length === 1 ? '' : 's'} pendiente${d.porCobrar.length === 1 ? '' : 's'} (total)`)}
      ${tile('OT del periodo', String(d.ots.length), `neto ${clp(sumar(d.ots, 'neto'))}${Object.keys(d.estados).length ? '<br>' + Object.entries(d.estados).map(([e, n]) => `${n} ${e.toLowerCase()}`).join(' · ') : ''}`)}
      ${tile('En camino', clp(sumar(d.cotsVig, 'neto') + sumar(d.ocsSinFac, 'neto')), `cotizado sin OC ${clp(sumar(d.cotsVig, 'neto'))}<br>con OC sin factura ${clp(sumar(d.ocsSinFac, 'neto'))}`)}
    </div>

    <div class="card">
      <h2>Facturado por mes <span class="extra">neto · últimos 6 meses</span></h2>
      ${graficoMeses(d.meses)}
      <details class="tabla-det"><summary>Ver tabla</summary>
        <table class="tabla"><tr><th>Mes</th><th>Facturas</th><th>Neto</th><th>IVA</th></tr>
        ${d.meses.map(m => `<tr><td>${m.etiqueta}</td><td>${m.n}</td><td>${clp(m.neto)}</td><td>${clp(m.iva)}</td></tr>`).join('')}</table>
      </details>
    </div>

    <div class="card">
      <h2>Facturado por categoría <span class="extra">neto del periodo</span></h2>
      ${graficoCategorias(d.categorias)}
    </div>

    <button class="btn btn-primary btn-full" id="pn-pdf">⬇ Descargar resumen PDF</button>
    <p class="hint" style="margin:8px 0 60px">El resumen incluye las OT del periodo con su COT, OC, folio y neto, más los totales facturados.</p>`;
  body.querySelectorAll('[data-per]').forEach(c => c.onclick = () => { PANEL.periodo = c.dataset.per; renderPanel(body); });
  const dd = $('#pn-d'), hh = $('#pn-h');
  if (dd) dd.onchange = () => { PANEL.desde = dd.value; renderPanel(body); };
  if (hh) hh.onchange = () => { PANEL.hasta = hh.value; renderPanel(body); };
  const pc = $('#pn-cli'); if (pc) pc.onchange = () => { PANEL.cliente = pc.value; renderPanel(body); };
  activarTooltips(body);
  $('#pn-pdf').onclick = () => descargarResumenPDF(d);
}

// ── Gráficos (SVG simple, un solo color: la magnitud se lee por el largo, la identidad por la etiqueta)
function graficoMeses(meses) {
  const W = 320, H = 150, pad = { l: 8, r: 8, t: 18, b: 22 };
  const max = Math.max(...meses.map(m => m.neto), 1);
  const bw = (W - pad.l - pad.r) / meses.length;
  const iMax = meses.reduce((b, m, i) => (m.neto > meses[b].neto ? i : b), 0);
  const barras = meses.map((m, i) => {
    const h = Math.round((m.neto / max) * (H - pad.t - pad.b));
    const x = pad.l + i * bw + bw * 0.18, w = bw * 0.64, y = H - pad.b - h;
    const etiqueta = (i === meses.length - 1 || i === iMax) && m.neto ? `<text x="${x + w / 2}" y="${y - 5}" text-anchor="middle" class="g-val">${abreviar(m.neto)}</text>` : '';
    return `<g class="g-hit" data-tip="${esc(m.etiqueta)}: ${clp(m.neto)} neto · ${m.n} factura${m.n === 1 ? '' : 's'}">
      <rect x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${H - pad.t - pad.b}" fill="transparent"/>
      ${h > 0 ? `<path d="${barraRedondeada(x, y, w, h)}" class="g-bar"/>` : ''}${etiqueta}
      <text x="${x + w / 2}" y="${H - 6}" text-anchor="middle" class="g-eje">${esc(m.etiqueta)}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="grafico" role="img" aria-label="Facturado por mes"><line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" class="g-base"/>${barras}</svg>`;
}

function graficoCategorias(cats) {
  if (!cats.length) return '<p class="hint">Sin facturas en el periodo.</p>';
  const total = cats.reduce((s, [, v]) => s + v, 0);
  const max = Math.max(...cats.map(([, v]) => v), 1);
  return `<div class="hbars">${cats.map(([cat, v]) => `
    <div class="hbar g-hit" data-tip="${esc(cat)}: ${clp(v)} (${Math.round(v / total * 100)}%)">
      <div class="hbar-l">${esc(cat)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(1.5, v / max * 100)}%"></div></div>
      <div class="hbar-v">${clp(v)}</div>
    </div>`).join('')}</div>`;
}

const barraRedondeada = (x, y, w, h) => { const r = Math.min(4, w / 2, h); return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`; };
const abreviar = n => n >= 1e6 ? '$' + (n / 1e6).toFixed(1).replace('.', ',') + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'k' : clp(n);

function activarTooltips(root) {
  let tip = document.getElementById('g-tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'g-tip'; tip.className = 'g-tip'; document.body.appendChild(tip); }
  const mostrar = (el, x, y) => { tip.textContent = el.dataset.tip; tip.style.left = Math.min(x + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (y - 36) + 'px'; tip.classList.add('on'); };
  root.querySelectorAll('.g-hit').forEach(el => {
    el.addEventListener('mousemove', e => mostrar(el, e.clientX, e.clientY));
    el.addEventListener('mouseleave', () => tip.classList.remove('on'));
    el.addEventListener('click', e => { mostrar(el, e.clientX, e.clientY); setTimeout(() => tip.classList.remove('on'), 2200); });
  });
}

// ── PDF de resumen
async function descargarResumenPDF(d) {
  try {
    toast('Preparando resumen…');
    await cargarScript('lib/jspdf.umd.min.js');
    const logo = await dataUrlDe('img/logo-pdf.png').catch(() => null);
    const filas = d.ots.slice().sort((a, b) => String(a.fechaInicio).localeCompare(String(b.fechaInicio)) || a.nOT - b.nOT).map(o => {
      const cots = cotsDeOT(o.nOT).filter(c => !['Reemplazada', 'Descartada'].includes(estadoCot(c)));
      return { fecha: fechaCorta(o.fechaInicio), ot: otNum(o.nOT), titulo: o.titulo, cot: [...new Set(cots.map(claveCot))].join(', '),
        oc: String(o.nOC || ''), folio: String(o.folioSII || ''), estado: o.estado, neto: Calc.num(o.neto) };
    });
    const doc = Cotizacion.resumen({
      cfg: S.config, logo, titulo: 'Resumen de trabajos y ventas',
      cliente: PANEL.cliente ? (clienteDe(PANEL.cliente).razonSocial || '') : 'Todos los clientes',
      periodo: `${fechaCorta(d.rango[0])} al ${fechaCorta(d.rango[1])}`, filas,
      kpis: [['Facturado neto', clp(d.fact.neto)], ['IVA facturado', clp(d.fact.iva)], ['Facturado total', clp(d.fact.total)],
        ['Cobrado en el periodo', clp(sumar(d.cobradas, 'total'))], ['Por cobrar (total)', clp(sumar(d.porCobrar, 'total'))], ['OT del periodo', String(d.ots.length)]],
      categorias: d.categorias.map(([c, v]) => [c, clp(v)])
    });
    const nombre = `Resumen_${d.rango[0]}_${d.rango[1]}.pdf`;
    modalCompartir(new File([doc.output('blob')], nombre, { type: 'application/pdf' }), { ots: '' , pdfUrl: '' }, 'Resumen listo para descargar o compartir.');
    toast('✓ Resumen listo', 'ok');
  } catch (e) { toast('No se generó: ' + e.message, 'err'); }
}

// ════════════════════════════════════════════════════════ INFORME DE OT CERRADA
/** Vista de solo lectura, tipo informe, para una OT con OC asignada o facturada. */
function renderInformeOT(app, o, lineas) {
  document.body.classList.remove('editor-open');
  const incl = lineas.filter(l => l.incluida !== false);
  const descartadas = lineas.length - incl.length;
  const compras = incl.filter(l => Calc.tipoDe(l) === 'Compra');
  const tiempos = incl.filter(l => Calc.tipoDe(l) === 'Tiempo de gestión');
  const mo = incl.filter(l => Calc.tipoDe(l) === 'Mano de obra');
  const sol = S.solicitantes.find(s => s.id === o.solicitanteId);
  const cli = clienteDe(o.clienteId);
  const ocs = S.ordenesCompra.filter(x => listaCSV(x.ots).includes(String(o.nOT)));
  const fac = S.facturas.find(f => String(f.folio) === String(o.folioSII));
  const cots = cotsDeOT(o.nOT).filter(c => ocs.some(x => listaCSV(x.cots).includes(c.id)));
  const cotsVista = cots.length ? cots : cotsDeOT(o.nOT).filter(c => estadoCot(c) === 'Aprobada');
  const sub = Calc.num(o.subtotal) || Calc.subtotal(incl);
  const recargo = Calc.num(o.recargo);
  const fila = (a, b, c, extra = '') => `<tr class="${extra}"><td>${a}</td><td class="num">${b}</td><td class="num">${c}</td></tr>`;
  const estadoTxt = fac ? (fac.estadoPago === 'Pagada' ? `Pagada el ${fechaCorta(fac.fechaPago)}` : 'Facturada · pendiente de pago') : 'Con OC · por facturar';

  app.innerHTML = `
    <div class="ed-head">
      <button class="back" onclick="location.hash='#/ots'" aria-label="Volver">←</button>
      <h2>${otNum(o.nOT)}</h2>
      <span class="badge ${fac && fac.estadoPago === 'Pagada' ? 'b-terminada' : fac ? 'b-folio' : 'b-oc'}">🔒 ${esc(estadoTxt)}</span>
    </div>

    <div class="card inf">
      <div class="inf-eyebrow">Orden de trabajo · ${esc(o.estado)}</div>
      <h1 class="inf-tit">${esc(o.titulo)}</h1>
      ${o.descripcion ? `<p class="inf-desc">${esc(o.descripcion)}</p>` : ''}
      <dl class="inf-dl">
        <dt>Fecha</dt><dd>${fechaCorta(o.fechaInicio)}</dd>
        <dt>Cliente</dt><dd>${esc(cli.razonSocial || o.cliente || '—')}</dd>
        ${sol ? `<dt>Solicitante</dt><dd>${esc(sol.nombre)}${sol.cargo ? ' · ' + esc(sol.cargo) : ''}</dd>` : ''}
        ${o.ubicacion ? `<dt>Ubicación</dt><dd>${esc(o.ubicacion)}</dd>` : ''}
      </dl>
    </div>

    <div class="card inf">
      <h2>📑 Documentos</h2>
      <table class="inf-tab">
        ${cotsVista.map(c => `<tr><td><b>Cotización</b><br><span class="hint">${fechaCorta(c.fecha)}</span></td><td>${esc(etiquetaCot(c))}</td>
          <td class="num">${c.pdfUrl ? `<a href="${esc(c.pdfUrl)}" target="_blank" rel="noopener">PDF</a>` : `<a href="#/cot/${encodeURIComponent(claveCot(c))}">Ver</a>`}</td></tr>`).join('')}
        ${ocs.map(x => `<tr><td><b>Orden de compra</b><br><span class="hint">${fechaCorta(x.fecha)} · ${clp(x.monto)}</span></td><td>N° ${esc(x.nOC)}</td>
          <td class="num">${x.archivoUrl ? `<a href="${esc(x.archivoUrl)}" target="_blank" rel="noopener">Documento</a>` : ''}</td></tr>`).join('')}
        ${fac ? `<tr><td><b>Factura</b><br><span class="hint">${fechaCorta(fac.fecha)} · ${clp(fac.total)}</span></td><td>Folio ${esc(fac.folio)}</td>
          <td class="num">${fac.estadoPago === 'Pagada' ? `✓ Pagada<br><span class="hint">${fechaCorta(fac.fechaPago)}</span>` : 'Pendiente'}</td></tr>` : ''}
      </table>
    </div>

    ${compras.length || tiempos.length ? `<div class="card inf">
      <h2>🛒 Gestión de compras</h2>
      <table class="inf-tab">
        <tr class="th"><td>Ítem</td><td class="num">Detalle</td><td class="num">Monto</td></tr>
        ${compras.map(l => fila(`${esc(l.descripcion)}<br><span class="hint">${esc(l.tipoItem || '')}</span>`, `${dec(l.cantidad)} × ${clp(l.costoUnit)}`, clp(Calc.montoLinea(l)))).join('')}
        ${tiempos.map(l => fila(`${esc(l.descripcion)}<br><span class="hint">Tiempo de gestión</span>`, `${dec(l.horas)} h × ${clp(l.hh)}`, clp(Calc.montoLinea(l)))).join('')}
        ${fila('<b>Subtotal</b>', '', '<b>' + clp(Calc.subtotal(compras.concat(tiempos))) + '</b>', 'tot')}
      </table>
    </div>` : ''}

    ${mo.length ? `<div class="card inf">
      <h2>🛠 Mano de obra</h2>
      <table class="inf-tab">
        <tr class="th"><td>Trabajo</td><td class="num">Detalle</td><td class="num">Monto</td></tr>
        ${mo.map(l => fila(`${esc(l.descripcion)}<br><span class="hint">${esc(l.categoria || '')}</span>`,
          Calc.esCantidad(l) ? `${dec(l.cantidad)} ${esc(l.unidad)} × ${clp(l.precioUnit)}` : `${dec(l.horas)} h × ${clp(l.hh)}`, clp(Calc.montoLinea(l)))).join('')}
        ${fila('<b>Subtotal</b>', '', '<b>' + clp(Calc.subtotal(mo)) + '</b>', 'tot')}
      </table>
    </div>` : ''}

    <div class="card inf">
      <h2>🧮 Resumen</h2>
      <div class="res-row"><span>Subtotal (costo)</span><span>${clp(sub)}</span></div>
      <div class="res-row"><span>Recargo ${dec(o.recargoPct || 0)}% <small>(interno)</small></span><span>${clp(recargo)}</span></div>
      <div class="res-row fuerte"><span>Neto</span><span>${clp(o.neto)}</span></div>
      <div class="res-row"><span>IVA ${dec(o.ivaPct || 19)}%</span><span>${clp(o.iva)}</span></div>
      <div class="res-row total"><span>Total</span><span>${clp(o.total)}</span></div>
      ${descartadas ? `<p class="hint" style="margin-top:8px">${descartadas} línea${descartadas === 1 ? '' : 's'} descartada${descartadas === 1 ? '' : 's'} en la bitácora (no suman).</p>` : ''}
    </div>

    <div class="card" id="fotos-card"></div>

    ${o.notas ? `<div class="card inf"><h2>📝 Notas internas</h2><p class="inf-desc">${esc(o.notas)}</p></div>` : ''}

    <p class="hint" style="text-align:center;margin:6px 0 70px">🔒 OT cerrada${fac ? ` · facturada con folio ${esc(fac.folio)}` : ` · OC ${esc(o.nOC)}`}. Para corregir algo, primero hay que quitar ${fac ? 'la factura y luego ' : ''}la OC.</p>`;
  renderFotosCard();
}
