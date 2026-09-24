/* Mantenciones OSC — Generador de cotización en PDF (jsPDF)
 * No depende del resto de la app: recibe los datos ya armados y devuelve el documento.
 */
const Cotizacion = (() => {
  const C = {
    terra: [185, 86, 42], cafe: [74, 50, 34], cafe2: [122, 90, 69], arena: [243, 236, 226],
    linea: [228, 216, 200], gris: [140, 123, 110], blanco: [255, 255, 255]
  };
  const M = 16, W = 210, H = 297, ANCHO = W - 2 * M, PIE = 20;

  // Helvetica estándar de jsPDF usa WinAnsi: se reemplazan caracteres fuera de ese juego
  const t = s => String(s ?? '').replace(/[—–]/g, '-').replace(/…/g, '...').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\x00-\xFF]/g, '');
  const clp = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL');
  const fecha = iso => { const [y, m, d] = String(iso || '').slice(0, 10).split('-'); return d ? `${d}-${m}-${y}` : ''; };
  const otNum = n => 'OT-' + String(n).padStart(4, '0');

  /** Filas de la tabla según las opciones. Devuelve [{seccion} | {desc, sub?, monto, principal?}]
   *  Sin detalle: una sola fila con lo que pidió el cliente (título + detalle) y su valor.
   *  detalleCompras: lista lo comprado (salvo los tipos ocultos, que se suman a la línea de gestión).
   *  detalleMO: lista cada proceso de mano de obra (o por categoría si agruparMO). */
  function filas(lineas, { ot = {}, detalleCompras = false, detalleMO = false, agruparMO = false, tiposOcultos = [], montoLinea }) {
    const inc = lineas.filter(l => l.incluida !== false);
    const suma = ls => ls.reduce((s, l) => s + montoLinea(l), 0);
    const compras = inc.filter(l => l.tipo === 'Compra' || l.tipo === 'Material');
    const tiempos = inc.filter(l => l.tipo === 'Tiempo de gestión');
    const mo = inc.filter(l => l.tipo === 'Mano de obra');
    if (!detalleCompras && !detalleMO) {
      return inc.length ? [{ desc: ot.titulo || 'Trabajo', sub: ot.descripcion || '', monto: suma(inc), principal: true }] : [];
    }
    const out = [];
    if (compras.length || tiempos.length) {
      out.push({ seccion: 'Gestión de compras' });
      if (detalleCompras) {
        const ocultos = new Set(tiposOcultos);
        const visibles = compras.filter(l => !ocultos.has(l.tipoItemId));
        const agregados = compras.filter(l => ocultos.has(l.tipoItemId)).concat(tiempos);
        visibles.forEach(l => {
          const cant = Number(l.cantidad) || 0;
          out.push({ desc: `${l.descripcion}${cant !== 1 ? ` (${String(cant).replace('.', ',')} un.)` : ''}`, monto: montoLinea(l) });
        });
        if (agregados.length) out.push({ desc: agregados.some(l => l.tipo !== 'Tiempo de gestión') ? 'Gestión de compras y otros materiales' : 'Gestión de compras', monto: suma(agregados) });
      } else {
        out.push({ desc: compras.length ? 'Gestión de compras y materiales' : 'Gestión de compras', monto: suma(compras.concat(tiempos)) });
      }
    }
    if (mo.length) {
      out.push({ seccion: 'Mano de obra' });
      if (!detalleMO) out.push({ desc: 'Mano de obra', monto: suma(mo) });
      else if (agruparMO) {
        const g = new Map();
        mo.forEach(l => g.set(l.categoria || 'Mano de obra', (g.get(l.categoria || 'Mano de obra') || 0) + montoLinea(l)));
        g.forEach((monto, cat) => out.push({ desc: cat, monto }));
      } else {
        mo.forEach(l => out.push({ desc: l.descripcion, monto: montoLinea(l) }));
      }
    }
    return out;
  }

  /** Reparte el recargo general en los montos (el cliente no lo ve como línea aparte).
   *  Cada monto se escala por neto/subtotal y el redondeo se ajusta en la fila mayor para que sumen exactamente el neto. */
  function repartirRecargo(rows, neto) {
    const items = rows.filter(r => !r.seccion);
    const base = items.reduce((s, r) => s + r.monto, 0);
    if (!base || !neto || base === neto) return rows;
    const k = neto / base;
    items.forEach(r => { r.monto = Math.round(r.monto * k); });
    const dif = neto - items.reduce((s, r) => s + r.monto, 0);
    if (dif) items.reduce((a, b) => (b.monto > a.monto ? b : a)).monto += dif;
    return rows;
  }

  /**
   * datos: { ot, lineas, cfg, cliente, solicitante, ubicacion, version, fechaISO,
   *          opciones: { detalleCompras, detalleMO, agruparMO, tiposOcultos[], incluirCondiciones }, fotos: [{etapa, descripcion, data}], logo (dataURL),
   *          montoLinea, totales: {neto, iva, total, ivaPct} }
   */
  function generar(datos) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const { ot, cfg = {}, cliente = {}, solicitante, ubicacion, version, opciones = {}, totales } = datos;
    const numero = `${otNum(ot.nOT)} v${version}`;
    let y = M;

    const color = (c, tipo = 'text') => tipo === 'text' ? doc.setTextColor(...c) : tipo === 'fill' ? doc.setFillColor(...c) : doc.setDrawColor(...c);
    const font = (estilo = 'normal', size = 10, c = C.cafe) => { doc.setFont('helvetica', estilo); doc.setFontSize(size); color(c); };
    const wrap = (txt, ancho) => doc.splitTextToSize(t(txt), ancho);
    const saltoSi = (alto, alSaltar) => {
      if (y + alto > H - PIE) { doc.addPage(); y = M + 4; if (alSaltar) alSaltar(); return true; }
      return false;
    };

    // ── Encabezado
    if (datos.logo) {
      const p = doc.getImageProperties(datos.logo);
      const lw = 44, lh = lw * p.height / p.width;
      doc.addImage(datos.logo, 'PNG', M, y, lw, lh);
    }
    font('bold', 20, C.terra); doc.text('COTIZACIÓN', W - M, y + 8, { align: 'right' });
    font('bold', 11); doc.text(t('N° ' + numero), W - M, y + 15, { align: 'right' });
    font('normal', 10, C.cafe2); doc.text('Fecha: ' + fecha(datos.fechaISO), W - M, y + 21, { align: 'right' });
    y += 30;
    color(C.terra, 'draw'); doc.setLineWidth(0.8); doc.line(M, y, W - M, y);
    y += 6;

    // ── Emisor / Cliente
    const colW = (ANCHO - 6) / 2;
    const emisor = [
      cfg.EMPRESA_RAZON_SOCIAL || cfg.EMPRESA_NOMBRE || 'Mantenciones OSC',
      cfg.EMPRESA_RUT && 'RUT ' + cfg.EMPRESA_RUT,
      cfg.EMPRESA_GIRO,
      cfg.EMPRESA_DIRECCION,
      [cfg.EMPRESA_TELEFONO, cfg.EMPRESA_CORREO].filter(Boolean).join(' · ')
    ].filter(Boolean);
    const receptor = [
      cliente.razonSocial,
      cliente.rut && 'RUT ' + cliente.rut,
      [cliente.direccion, cliente.comuna].filter(Boolean).join(', '),
      solicitante && ('Atención: ' + solicitante.nombre + (solicitante.cargo ? ' - ' + solicitante.cargo : '')),
      solicitante && solicitante.unidad,
      ubicacion && ('Ubicación: ' + ubicacion.edificio + (ubicacion.detalle ? ' - ' + ubicacion.detalle : ''))
    ].filter(Boolean);
    const caja = (x, titulo, lineas) => {
      let yy = y + 6;
      font('bold', 8, C.terra); doc.text(titulo, x + 4, yy);
      yy += 5;
      lineas.forEach((ln, i) => {
        font(i === 0 ? 'bold' : 'normal', i === 0 ? 10 : 9, i === 0 ? C.cafe : C.cafe2);
        wrap(ln, colW - 8).forEach(w => { doc.text(w, x + 4, yy); yy += 4.4; });
      });
      return yy - y + 2;
    };
    // medir alto y dibujar fondo
    const medir = ls => 9 + ls.reduce((s, ln) => { doc.setFontSize(10); return s + wrap(ln, colW - 8).length * 4.4; }, 0);
    const altoCaja = Math.max(medir(emisor), medir(receptor));
    color(C.arena, 'fill');
    doc.roundedRect(M, y, colW, altoCaja, 2, 2, 'F');
    doc.roundedRect(M + colW + 6, y, colW, altoCaja, 2, 2, 'F');
    caja(M, 'DE', emisor);
    caja(M + colW + 6, 'PARA', receptor);
    y += altoCaja + 8;

    const resumida = !opciones.detalleCompras && !opciones.detalleMO;

    // ── Trabajo solicitado (en la versión resumida va dentro de la tabla)
    if (!resumida) {
      font('bold', 8, C.terra); doc.text('TRABAJO SOLICITADO', M, y); y += 5.5;
      font('bold', 12); wrap(ot.titulo, ANCHO).forEach(w => { doc.text(w, M, y); y += 5.5; });
      if (ot.descripcion) {
        font('normal', 9.5, C.cafe2);
        wrap(ot.descripcion, ANCHO).forEach(w => { saltoSi(5); doc.text(w, M, y); y += 4.5; });
      }
      y += 5;
    }

    // ── Tabla
    const colMonto = 36;
    const encabezadoTabla = () => {
      color(C.cafe, 'fill'); doc.rect(M, y, ANCHO, 8, 'F');
      font('bold', 9, C.blanco);
      doc.text('DESCRIPCIÓN', M + 3, y + 5.4);
      doc.text('MONTO', W - M - 3, y + 5.4, { align: 'right' });
      y += 8;
    };
    encabezadoTabla();
    const rows = filas(datos.lineas, {
      ot, detalleCompras: !!opciones.detalleCompras, detalleMO: !!opciones.detalleMO, agruparMO: !!opciones.agruparMO,
      tiposOcultos: opciones.tiposOcultos || [], montoLinea: datos.montoLinea
    });
    repartirRecargo(rows, totales.neto);
    rows.forEach(r => {
      if (r.seccion) {
        saltoSi(16, encabezadoTabla);
        color(C.arena, 'fill'); doc.rect(M, y, ANCHO, 7, 'F');
        font('bold', 8.5, C.terra); doc.text(t(r.seccion.toUpperCase()), M + 3, y + 4.8);
        y += 7;
        return;
      }
      const anchoTxt = ANCHO - colMonto - 6;
      font(r.principal ? 'bold' : 'normal', r.principal ? 10.5 : 9.5);
      const ls = wrap(r.desc, anchoTxt);
      doc.setFontSize(9.5);
      const subs = r.sub ? wrap(r.sub, anchoTxt) : [];
      const alto = Math.max(7.5, ls.length * 4.6 + subs.length * 4.3 + (subs.length ? 1.5 : 0) + 3.2);
      saltoSi(alto, encabezadoTabla);
      font(r.principal ? 'bold' : 'normal', r.principal ? 10.5 : 9.5);
      ls.forEach((w, i) => doc.text(w, M + 3, y + 5 + i * 4.6));
      if (subs.length) {
        font('normal', 9.5, C.cafe2);
        subs.forEach((w, i) => doc.text(w, M + 3, y + 5 + ls.length * 4.6 + 1.5 + i * 4.3));
      }
      font('bold', r.principal ? 10.5 : 9.5, C.cafe); doc.text(clp(r.monto), W - M - 3, y + 5, { align: 'right' });
      color(C.linea, 'draw'); doc.setLineWidth(0.2); doc.line(M, y + alto, W - M, y + alto);
      y += alto;
    });
    if (!rows.length) { font('italic', 9.5, C.gris); doc.text('Sin ítems incluidos.', M + 3, y + 5); y += 8; }

    // ── Totales
    y += 4;
    saltoSi(28);
    const tx = W - M - 78;
    const filaTot = (etq, val, destacado) => {
      if (destacado) { color(C.terra, 'fill'); doc.roundedRect(tx, y - 1, 78, 9, 1.5, 1.5, 'F'); }
      font(destacado ? 'bold' : 'normal', destacado ? 11 : 10, destacado ? C.blanco : C.cafe);
      doc.text(etq, tx + 4, y + 5); doc.text(val, W - M - 3, y + 5, { align: 'right' });
      y += destacado ? 10 : 7;
    };
    filaTot('Neto', clp(totales.neto));
    filaTot('IVA ' + String(totales.ivaPct).replace('.', ',') + '%', clp(totales.iva));
    filaTot('TOTAL', clp(totales.total), true);
    y += 6;

    // ── Condiciones
    const cond = String(cfg.COT_CONDICIONES || '').trim();
    if (opciones.incluirCondiciones && cond) {
      saltoSi(16);
      font('bold', 8, C.terra); doc.text('CONDICIONES', M, y); y += 5;
      font('normal', 9, C.cafe2);
      cond.split(/\r?\n/).forEach(p => wrap(p, ANCHO).forEach(w => { saltoSi(5); doc.text(w, M, y); y += 4.3; }));
      y += 5;
    }

    // ── Firma
    const firma = [cfg.EMPRESA_FIRMA, cfg.EMPRESA_NOMBRE || 'Mantenciones OSC', cfg.EMPRESA_TELEFONO, cfg.EMPRESA_CORREO].filter(Boolean);
    saltoSi(12 + firma.length * 5);
    font('normal', 10); doc.text('Atentamente,', M, y); y += 7;
    firma.forEach((ln, i) => { font(i === 0 ? 'bold' : 'normal', i === 0 ? 10.5 : 9.5, i === 0 ? C.cafe : C.cafe2); doc.text(t(ln), M, y); y += 4.8; });

    // ── Anexo fotográfico
    const fotos = (datos.fotos || []).filter(f => f.data);
    if (fotos.length) {
      doc.addPage(); y = M + 2;
      font('bold', 14, C.terra); doc.text('Anexo fotográfico', M, y + 4);
      font('normal', 10, C.cafe2); doc.text(t(numero + ' · ' + ot.titulo), M, y + 10);
      y += 17;
      const gw = (ANCHO - 8) / 2, gh = 72;
      const orden = ['Antes', 'Durante', 'Después'];
      const lista = fotos.slice().sort((a, b) => orden.indexOf(a.etapa) - orden.indexOf(b.etapa));
      const leyenda = f => [String(f.etapa || '').toUpperCase()].concat(f.descripcion ? wrap(f.descripcion, gw) : []);
      for (let i = 0; i < lista.length; i += 2) {
        const par = lista.slice(i, i + 2);
        doc.setFontSize(8.5);
        const capAlto = Math.max(...par.map(f => leyenda(f).length * 3.8));
        saltoSi(gh + capAlto + 6);
        par.forEach((f, k) => {
          const x = M + k * (gw + 8);
          const src = 'data:image/jpeg;base64,' + f.data;
          let p; try { p = doc.getImageProperties(src); } catch (e) { return; }
          const r = Math.min(gw / p.width, gh / p.height);
          const iw = p.width * r, ih = p.height * r;
          color(C.arena, 'fill'); doc.rect(x, y, gw, gh, 'F');
          doc.addImage(src, 'JPEG', x + (gw - iw) / 2, y + (gh - ih) / 2, iw, ih, undefined, 'FAST');
          leyenda(f).forEach((w, j) => {
            font(j === 0 ? 'bold' : 'normal', j === 0 ? 8 : 8.5, j === 0 ? C.terra : C.cafe2);  // etapa en color, descripción debajo
            doc.text(w, x, y + gh + 4.5 + j * 3.8);
          });
        });
        y += gh + capAlto + 8;
      }
    }

    // ── Pie en todas las páginas
    const n = doc.getNumberOfPages();
    const pie = t([cfg.EMPRESA_NOMBRE || 'Mantenciones OSC', cfg.EMPRESA_RUT && 'RUT ' + cfg.EMPRESA_RUT, cfg.EMPRESA_CORREO].filter(Boolean).join(' · '));
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      color(C.linea, 'draw'); doc.setLineWidth(0.3); doc.line(M, H - 13, W - M, H - 13);
      font('normal', 8, C.gris);
      doc.text(pie, M, H - 8.5);
      doc.text(t(`${numero} · Página ${i} de ${n}`), W - M, H - 8.5, { align: 'right' });
    }
    doc.setProperties({ title: 'Cotización ' + numero, author: t(cfg.EMPRESA_NOMBRE || 'Mantenciones OSC') });
    return doc;
  }

  return { generar, filas, repartirRecargo };
})();
