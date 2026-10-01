/* Mantenciones OSC — Análisis (v3.5)
 * Neto, IVA débito (y crédito cuando exista el registro de gastos), composición del neto
 * (costo directo, desgaste de herramientas, margen de contribución, utilidad), por periodo, cliente y OT.
 * Usa PANEL, rangoPanel, enRango, sumar, graficoMeses, graficoCategorias, netoPorCategoria y activarTooltips de facturacion.js.
 */
const ANA = { base: 'fact', etapas: new Set(['Guardada', 'Cotizada', 'OC', 'Facturada']), sel: new Set() };
const ETAPAS_ANA = ['Guardada', 'Cotizada', 'OC', 'Facturada'];

/** Desglose de una OT: costo directo + desgaste + margen + recargo = neto */
function desgloseOT(o) {
  const ls = S.lineas.filter(l => String(l.nOT) === String(o.nOT) && l.incluida !== false);
  const neto = Calc.num(o.neto), rec = Calc.num(o.recargo), marg = Calc.num(o.margen), desg = Calc.num(o.desgaste);
  const sub = Calc.num(o.subtotal) || Math.max(0, neto - rec - marg);
  const mo = Calc.subtotal(ls.filter(l => Calc.tipoDe(l) === 'Mano de obra'));
  return { costo: sub - desg, desg, marg, rec, sub, neto, iva: Calc.num(o.iva), total: Calc.num(o.total), mo };
}
const sumaD = ds => ds.reduce((a, d) => { Object.keys(d).forEach(k => { a[k] = (a[k] || 0) + d[k]; }); return a; },
  { costo: 0, desg: 0, marg: 0, rec: 0, sub: 0, neto: 0, iva: 0, total: 0, mo: 0 });
const pctDe = (a, b) => b ? (Math.round(a / b * 1000) / 10).toString().replace('.', ',') + '%' : '—';

function datosAnalisis() {
  const rango = rangoPanel();
  const cli = PANEL.cliente;
  const porCli = x => !cli || x.clienteId === cli;
  const facs = S.facturas.filter(f => porCli(f) && enRango(f.fecha, rango));
  let ots;
  if (ANA.base === 'fact') {
    ots = [...new Set(facs.flatMap(f => listaCSV(f.ots)))].map(n => S.ots.find(o => String(o.nOT) === n)).filter(Boolean);
  } else {
    ots = S.ots.filter(o => porCli(o) && enRango(o.fechaInicio, rango) && ETAPAS_ANA.includes(etapaOT(o)) && ANA.etapas.has(etapaOT(o)));
  }
  ots.sort((a, b) => String(b.fechaInicio).localeCompare(String(a.fechaInicio)) || b.nOT - a.nOT);
  [...ANA.sel].forEach(n => { if (!ots.some(o => String(o.nOT) === n)) ANA.sel.delete(n); });
  const elegidas = ANA.sel.size ? ots.filter(o => ANA.sel.has(String(o.nOT))) : ots;
  const tot = sumaD(elegidas.map(desgloseOT));
  // En "Facturado" sin selección, neto e IVA salen de las facturas (lo declarado ante el SII)
  const usarFacturas = ANA.base === 'fact' && !ANA.sel.size;
  const neto = usarFacturas ? sumar(facs, 'neto') : tot.neto;
  const debito = usarFacturas ? sumar(facs, 'iva') : tot.iva;
  const debitoReal = ANA.base === 'fact' ? debito : sumar(elegidas.filter(o => etapaOT(o) === 'Facturada'), 'iva');
  const porEtapa = ETAPAS_ANA.map(e => { const os = ots.filter(o => etapaOT(o) === e); return { e, n: os.length, neto: sumar(os, 'neto'), total: sumar(os, 'total') }; }).filter(x => x.n);
  return { rango, facs, ots, elegidas, tot, neto, debito, debitoReal, porEtapa, categorias: netoPorCategoria(elegidas) };
}

function renderAnalisis(app) {
  const d = datosAnalisis();
  const p = datosPanel();   // cobranza y facturado por mes (facturacion.js)
  const clientes = S.clientes.filter(c => c.activo !== false);
  const per = [['semana', 'Semana'], ['mes', 'Mes'], ['mesant', 'Mes anterior'], ['anio', 'Año'], ['custom', 'Personalizado']];
  const tile = (t, v, s, dest) => `<div class="kpi ${dest ? 'kpi-dest' : ''}"><div class="kpi-t">${t}</div><div class="kpi-v">${v}</div>${s ? `<div class="kpi-s">${s}</div>` : ''}</div>`;
  const t = d.tot;
  const fact = ANA.base === 'fact';
  const nSel = ANA.sel.size;

  app.innerHTML = `${noConectado()}
    ${tituloSeccion('Análisis')}
    <div class="seg" id="an-base" style="margin-bottom:10px">
      <button type="button" data-v="fact" class="${fact ? 'on' : ''}">🧾 Facturado</button>
      <button type="button" data-v="todas" class="${fact ? '' : 'on'}">📋 Todas las OT</button>
    </div>
    <div class="chips">${per.map(([k, x]) => `<button class="chip ${PANEL.periodo === k ? 'on' : ''}" data-per="${k}">${x}</button>`).join('')}</div>
    ${PANEL.periodo === 'custom' ? `<div class="row" style="margin-bottom:10px"><div><label for="pn-d">Desde</label><input type="date" id="pn-d" value="${esc(d.rango[0])}"></div><div><label for="pn-h">Hasta</label><input type="date" id="pn-h" value="${esc(d.rango[1])}"></div></div>` : ''}
    ${clientes.length > 1 ? `<select id="pn-cli" style="margin-bottom:10px"><option value="">Todos los clientes</option>${clientes.map(c => `<option value="${esc(c.id)}" ${PANEL.cliente === c.id ? 'selected' : ''}>${esc(c.nombreCorto || c.razonSocial)}</option>`).join('')}</select>` : ''}
    ${fact ? '' : `<div class="chips" id="an-etapas">${ETAPAS_ANA.map(e => `<button class="chip ${ANA.etapas.has(e) ? 'on' : ''}" data-et="${e}">${esc((ETAPAS.find(x => x[0] === e) || [])[2] || e)}</button>`).join('')}</div>`}
    <p class="hint" style="margin:0 0 10px">📅 ${fechaCorta(d.rango[0])} al ${fechaCorta(d.rango[1])} · ${fact ? 'OT facturadas en el periodo (por fecha de factura)' : 'OT por fecha de la OT (sin borradores ni anuladas)'}</p>
    ${nSel ? `<div class="sel-banner an-sel">Analizando <b>${nSel} OT seleccionada${nSel === 1 ? '' : 's'}</b> <button class="btn btn-sec btn-sm" id="an-limpiar">Ver todas</button></div>` : ''}

    <div class="kpis">
      ${tile('Neto', clp(d.neto), fact && !nSel ? `${d.facs.length} factura${d.facs.length === 1 ? '' : 's'} · total ${clp(sumar(d.facs, 'total'))}` : `${d.elegidas.length} OT · bruto ${clp(t.total)}`, true)}
      ${tile('IVA débito', clp(d.debito), fact ? 'IVA de las facturas emitidas' : `proyectado · real (facturado): ${clp(d.debitoReal)}`)}
      ${tile('IVA crédito', '—', 'Próximamente, con el registro de gastos (facturas de compra)')}
      ${tile('IVA a pagar (estimado)', clp(d.debito), 'débito − crédito (aún sin crédito)')}
      ${tile('Herramientas', pctDe(t.desg, t.neto), `${clp(t.desg)} del neto · ${pctDe(t.desg, t.mo)} de la mano de obra`)}
      ${tile('Margen de contribución', pctDe(t.marg, t.neto), `${clp(t.marg)} del neto · ${pctDe(t.marg, t.sub)} sobre el costo`)}
      ${tile('Utilidad (recargo)', pctDe(t.rec, t.neto), `${clp(t.rec)} del neto · ${pctDe(t.rec, t.sub + t.marg)} sobre costo + margen`)}
      ${tile('Costo directo', pctDe(t.costo, t.neto), `${clp(t.costo)} · compras, gestión y mano de obra`)}
    </div>

    <div class="card">
      <h2>¿De qué se compone el neto? <span class="extra">${clp(t.neto)}</span></h2>
      ${t.neto ? graficoCategorias([['Costo directo', t.costo], ['Herramientas', t.desg], ['Margen de contribución', t.marg], ['Utilidad (recargo)', t.rec]].filter(x => x[1] > 0)) : '<p class="hint">Sin OT en el periodo.</p>'}
      ${fact && !nSel && Math.abs(t.neto - d.neto) > 1 ? `<p class="hint" style="margin-top:8px">El neto de las OT (${clp(t.neto)}) difiere del facturado (${clp(d.neto)}): alguna OC o factura se registró por un monto distinto.</p>` : ''}
    </div>

    ${!fact && d.porEtapa.length ? `<div class="card">
      <h2>Por etapa</h2>
      <table class="tabla"><tr><th>Etapa</th><th>OT</th><th>Neto</th><th>Bruto</th></tr>
      ${d.porEtapa.map(x => `<tr><td><span class="badge b-${slug(x.e)}">${esc(etapaLabel(x.e))}</span></td><td>${x.n}</td><td>${clp(x.neto)}</td><td>${clp(x.total)}</td></tr>`).join('')}</table>
    </div>` : ''}

    <div class="card">
      <h2>OT del análisis <span class="extra">${d.ots.length}</span></h2>
      <p class="hint" style="margin:0 0 6px">Marca una o varias para analizarlas solas. Toca el título para abrir la OT. Los % de cada fila son los aplicados: herramientas sobre la mano de obra, margen sobre el costo y utilidad sobre costo + margen.</p>
      ${d.ots.length ? d.ots.map(o => filaAnalisis(o)).join('') : '<p class="hint">No hay OT con estos filtros.</p>'}
    </div>

    <div class="card">
      <h2>Neto por categoría <span class="extra">${nSel ? 'OT seleccionadas' : 'OT del análisis'}</span></h2>
      ${graficoCategorias(d.categorias)}
    </div>

    <div class="card">
      <h2>Facturado por mes <span class="extra">neto · últimos 6 meses</span></h2>
      ${graficoMeses(p.meses)}
      <details class="tabla-det"><summary>Ver tabla</summary>
        <table class="tabla"><tr><th>Mes</th><th>Facturas</th><th>Neto</th><th>IVA</th></tr>
        ${p.meses.map(m => `<tr><td>${m.etiqueta}</td><td>${m.n}</td><td>${clp(m.neto)}</td><td>${clp(m.iva)}</td></tr>`).join('')}</table>
      </details>
    </div>

    <div class="sub-h" style="margin:4px 2px 8px">Cobranza</div>
    <div class="kpis">
      ${tile('Cobrado', clp(sumar(p.cobradas, 'total')), `${p.cobradas.length} pago${p.cobradas.length === 1 ? '' : 's'} en el periodo`)}
      ${tile('Por cobrar', clp(sumar(p.porCobrar, 'total')), `${p.porCobrar.length} factura${p.porCobrar.length === 1 ? '' : 's'} pendiente${p.porCobrar.length === 1 ? '' : 's'} (total)`)}
      ${tile('En camino', clp(sumar(p.cotsVig, 'neto') + sumar(p.ocsSinFac, 'neto')), `cotizado sin OC ${clp(sumar(p.cotsVig, 'neto'))}<br>con OC sin factura ${clp(sumar(p.ocsSinFac, 'neto'))}`)}
      ${tile('OT del periodo', String(p.ots.length), `neto ${clp(sumar(p.ots, 'neto'))}`)}
    </div>

    <button class="btn btn-primary btn-full" id="pn-pdf">⬇ Descargar resumen PDF</button>
    <p class="hint" style="margin:8px 0 70px">El PDF incluye las OT del periodo con su COT, OC, folio y neto, más los totales facturados.</p>`;

  const re = () => renderAnalisis(app);
  app.querySelectorAll('#an-base button').forEach(b => b.onclick = () => { ANA.base = b.dataset.v; ANA.sel.clear(); re(); });
  app.querySelectorAll('[data-per]').forEach(c => c.onclick = () => { PANEL.periodo = c.dataset.per; re(); });
  app.querySelectorAll('[data-et]').forEach(c => c.onclick = () => { const e = c.dataset.et; ANA.etapas.has(e) ? ANA.etapas.delete(e) : ANA.etapas.add(e); if (!ANA.etapas.size) ANA.etapas.add(e); re(); });
  const dd = $('#pn-d'), hh = $('#pn-h');
  if (dd) dd.onchange = () => { PANEL.desde = dd.value; re(); };
  if (hh) hh.onchange = () => { PANEL.hasta = hh.value; re(); };
  const pc = $('#pn-cli'); if (pc) pc.onchange = () => { PANEL.cliente = pc.value; ANA.sel.clear(); re(); };
  const lim = $('#an-limpiar'); if (lim) lim.onclick = () => { ANA.sel.clear(); re(); };
  app.querySelectorAll('[data-an-sel]').forEach(c => c.onchange = () => { c.checked ? ANA.sel.add(c.dataset.anSel) : ANA.sel.delete(c.dataset.anSel); re(); });
  activarTooltips(app);
  $('#pn-pdf').onclick = () => descargarResumenPDF(p);
}

function filaAnalisis(o) {
  const x = desgloseOT(o), e = etapaOT(o);
  const sel = ANA.sel.has(String(o.nOT));
  return `<div class="an-fila ${sel ? 'on' : ''}">
    <input type="checkbox" data-an-sel="${o.nOT}" ${sel ? 'checked' : ''} aria-label="Seleccionar ${otNum(o.nOT)}">
    <div class="an-body">
      <a href="#/ot/${o.nOT}" class="an-tit"><b>${otNum(o.nOT)}</b> · ${esc(o.titulo || '(sin título)')}</a>
      <div class="an-meta"><span class="badge b-${slug(e)}">${esc(etapaLabel(e))}</span> ${fechaCorta(o.fechaInicio)}${o.folioSII ? ' · ' + folioTxt(o.folioSII) : ''}${Calc.bool(o.ajustado) ? ' · ✎ ajustado' : ''}</div>
      <div class="an-des">Costo ${clp(x.costo)} · Herr. ${clp(x.desg)} (${pctDe(x.desg, x.mo)} MO) · Margen ${clp(x.marg)} (${pctDe(x.marg, x.sub)}) · Utilidad ${clp(x.rec)} (${pctDe(x.rec, x.sub + x.marg)}) · IVA ${clp(x.iva)}</div>
    </div>
    <div class="an-neto">${clp(x.neto)}<small>neto</small></div>
  </div>`;
}
