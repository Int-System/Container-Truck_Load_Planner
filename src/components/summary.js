/* Container & Truck Load Planner — components/summary.js
 * Summary dashboard: KPIs, CoG / balance, warnings, suggestions, per-SKU table.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};
  function esc(s) { return LP.esc(s); }

  function ring(pct, tone) {
    var r = 16, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
    return '<svg class="ring ' + (tone || '') + '" viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="' + r + '"/>' +
      '<circle class="fg" cx="20" cy="20" r="' + r + '" stroke-dasharray="' + (c * p / 100).toFixed(2) + ' ' + c.toFixed(2) + '"/></svg>';
  }
  function kpi(label, value, sub, pct, tone) {
    return '<div class="kpi"><div class="kpi-l">' + esc(label) + '</div><div class="kpi-v">' + value + '</div>' +
      (pct == null ? '<span></span>' : ring(pct, tone)) + (sub ? '<div class="kpi-s">' + sub + '</div>' : '') + '</div>';
  }

  /** Translate an issue/warning object to a message. */
  LP.issueText = function (w) {
    var p = {}, U = LP.units;
    for (var k in (w.params || {})) {
      var v = w.params[k];
      p[k] = typeof v === 'number' ? (k === 'n' ? v : U.fmt(k === 'pct' ? Math.abs(v) : v, k === 'pct' ? 1 : 0)) : v;
    }
    if (p.group) p.group = LP.t('ax_' + p.group);
    if (p.dir) p.dir = LP.t('dir_' + p.dir);
    return LP.t('w_' + w.code, p);
  };

  function balanceSvg(st, C) {
    var Wd = 220, Hd = Math.max(46, Math.min(90, Wd * C.W / C.L));
    var cx = st.cog.y / C.L * Wd, cy = Hd - st.cog.x / C.W * Hd;
    var tx = Wd * 0.1, ty = Hd * 0.05;
    return '<svg viewBox="-4 -4 ' + (Wd + 8) + ' ' + (Hd + 8) + '" class="bal-svg">' +
      '<rect x="0" y="0" width="' + Wd + '" height="' + Hd + '" rx="4" class="bal-c"/>' +
      '<rect x="' + (Wd / 2 - tx) + '" y="' + (Hd / 2 - ty) + '" width="' + (2 * tx) + '" height="' + (2 * ty) + '" rx="2" class="bal-ok"/>' +
      '<path d="M' + Wd / 2 + ' 0V' + Hd + 'M0 ' + Hd / 2 + 'H' + Wd + '" class="bal-axis"/>' +
      '<rect x="' + (Wd - 3) + '" y="0" width="3" height="' + Hd + '" fill="#ea580c"/>' +
      (st.count ? '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="6" class="bal-dot"/>' : '') +
      '</svg><div class="bal-legend"><span>◀ ' + esc(LP.t('frontHere')) + '</span><span>' + esc(LP.t('doorHere')) + ' ▶</span></div>';
  }

  function tone(p) { return p > 100 ? 'bad' : p > 90 ? 'warn' : 'ok'; }

  /** Side diagram: cab + cargo box + axles coloured by load status. */
  function axleSvg(ax, cfg, C) {
    var lay = cfg.layout, x0 = Math.min(lay.cabFront, 0) - 8, x1 = C.L + 8, Wd = 260, s = Wd / (x1 - x0);
    var gY = 66, wr = 7, deckY = gY - wr * 2 - 3;                      // ground, wheel radius, chassis line
    var boxH = Math.max(18, Math.min(40, C.H * s)), cabH = cfg.kind === 'semi' ? boxH * 0.95 : boxH * 0.8;
    function X(y) { return ((y - x0) * s).toFixed(1); }
    var h = '<svg viewBox="0 0 ' + Wd + ' 90" class="axle-svg">';
    h += '<line x1="0" y1="' + gY + '" x2="' + Wd + '" y2="' + gY + '" class="ax-ground"/>';
    h += '<rect x="' + X(lay.cabFront) + '" y="' + (deckY - cabH + 6).toFixed(1) + '" width="' + ((lay.cabRear - lay.cabFront) * s).toFixed(1) + '" height="' + (cabH).toFixed(1) + '" rx="4" class="ax-cab"/>';
    h += '<rect x="' + X(0) + '" y="' + (deckY - boxH).toFixed(1) + '" width="' + (C.L * s).toFixed(1) + '" height="' + boxH.toFixed(1) + '" rx="2" class="ax-box"/>';
    h += '<line x1="' + X(lay.cabFront + 10) + '" y1="' + deckY + '" x2="' + X(C.L) + '" y2="' + deckY + '" class="ax-chassis"/>';
    if (cfg.kind === 'semi') h += '<path d="M' + X(cfg.kingpinY) + ' ' + (deckY + 1) + 'l-4 5h8z" class="ax-kp"/>';
    // cargo centre of gravity
    if (ax.cargo > 0 && LP.store) {
      var st = LP.store.state, mw = 0, my = 0;
      st.placements.forEach(function (p) { mw += +p.weight || 0; my += (+p.weight || 0) * (p.y + p.l / 2); });
      if (mw > 0) h += '<path d="M' + X(my / mw) + ' ' + (deckY - boxH - 7) + 'l-4 -6h8z" class="ax-cog"/>';
    }
    lay.axles.forEach(function (a) {
      var gi = cfg.groups.findIndex(function (g) { return g.key === a.group; }), gr = ax.groups[gi];
      h += '<circle cx="' + X(a.y) + '" cy="' + (gY - wr) + '" r="' + wr + '" class="ax-wheel ' + tone(gr.pct) + '"/>';
    });
    ax.groups.forEach(function (g) {
      h += '<text x="' + X(g.y) + '" y="' + (gY + 14) + '" text-anchor="middle" class="ax-t ' + tone(g.pct) + '">' + (g.load / 1000).toFixed(1) + ' t</text>';
    });
    return h + '</svg>';
  }

  function axleSection(ax, cfg, C) {
    var t = LP.t, U = LP.units;
    var h = '<div class="balance">' + axleSvg(ax, cfg, C);
    ax.groups.forEach(function (g) {
      h += '<div class="axrow"><span>' + LP.esc(t('ax_' + g.key)) + (g.n > 1 ? ' ×' + g.n : '') + '</span><div class="bar-t"><span class="' + tone(g.pct) + '" style="width:' + Math.min(100, Math.max(0, g.pct)).toFixed(1) + '%"></span></div>' +
        '<span class="n ' + (g.pct > 100 ? 'neg' : '') + '">' + U.fmt(g.load, 0) + ' / ' + U.fmt(g.limit, 0) + '</span></div>';
    });
    h += '<div class="axrow gross"><span>GVW</span><div class="bar-t"><span class="' + tone(ax.gvwPct) + '" style="width:' + Math.min(100, ax.gvwPct).toFixed(1) + '%"></span></div><span class="n ' + (ax.gvwPct > 100 ? 'neg' : '') + '">' + U.fmt(ax.gross, 0) + ' / ' + U.fmt(ax.gvwLimit, 0) + '</span></div>';
    h += '<div class="muted small" style="margin-top:6px">' + t('axleNote') + '</div></div>';
    return h;
  }

  function split(a, b, la, lb) {
    return '<div class="split"><span class="sl">' + esc(la) + ' ' + a.toFixed(0) + '%</span><div class="split-bar"><span style="width:' + a.toFixed(1) + '%"></span></div><span class="sr">' + b.toFixed(0) + '% ' + esc(lb) + '</span></div>';
  }

  LP.renderSummary = function (el, d) {
    var t = LP.t, U = LP.units, st = d.stats, C = d.C, I = LP.icon;
    var totalReq = 0, anyMax = false;
    (st.perSku || []).forEach(function (r) { if (r.requested == null) anyMax = true; else totalReq += r.requested; });
    var over = st.payload && st.weight > st.payload + 1e-6;
    var h = [];
    if (d.banner) h.push(d.banner);
    h.push('<div class="kpis">');
    var fill = anyMax || !totalReq ? null : st.count / totalReq * 100;
    h.push(kpi(t('itemsPlaced'), U.fmt(st.count, 0) + (fill == null ? '' : ' <small>/ ' + U.fmt(totalReq, 0) + '</small>'),
      st.unplacedTotal ? '<span class="neg">' + t('unplaced') + ' ' + U.fmt(st.unplacedTotal, 0) + ' ' + t('pcs') + '</span>' : (fill != null ? '<span class="pos">✓ 100%</span>' : ''),
      fill, st.unplacedTotal ? 'warn' : 'ok'));
    h.push(kpi(t('weightTotal'), U.fmt(st.weight, 0) + ' <small>' + t('kg') + '</small>',
      (over ? '<span class="neg">' : '') + U.fmt(st.payloadPct, 1) + '% ' + t('ofPayload') + (over ? '</span>' : '') + '<br>' + t('remaining') + ' ' + U.fmt(Math.max(0, st.remainingPayload), 0) + ' ' + t('kg'),
      st.payloadPct, over ? 'bad' : st.payloadPct > 90 ? 'warn' : 'ok'));
    h.push(kpi(t('volUtil'), U.fmt(st.volUtil, 1) + '<small>%</small>', U.fmt(st.volume / 1e6, 2) + ' / ' + U.fmt(st.containerVolume / 1e6, 2) + ' m³', st.volUtil, ''));
    h.push(kpi(t('floorUtil'), U.fmt(st.floorUtil, 1) + '<small>%</small>', t('usedLength') + ' ' + U.fmt(st.usedLength, 0) + ' / ' + U.fmt(C.L, 0) + ' cm', st.floorUtil, ''));
    h.push('</div>');

    var issues = (d.issues || []).concat(st.warnings.filter(function (w) {
      return w.code !== 'overweight' || !(d.issues || []).some(function (i) { return i.code === 'overweight'; });
    })).concat(d.axle ? d.axle.warnings : []).concat(d.vgm ? d.vgm.warnings : []).concat(d.runWarnings || []);
    if (d.vgm && d.ship && d.ship.containerNo && !LP.iso6346(d.ship.containerNo).ok) issues.push({ code: 'cnInvalid', severity: 'warning', params: { no: d.ship.containerNo } });
    h.push('<h3>' + I('alert') + t('warnings') + (issues.length ? ' <span class="badge">' + issues.length + '</span>' : '') + '</h3>');
    if (!issues.length) h.push('<div class="ok-msg">' + I('check') + t('noWarnings') + '</div>');
    else {
      h.push('<ul class="warns">');
      issues.forEach(function (w) {
        var ic = w.severity === 'error' ? 'alert' : w.severity === 'info' ? 'info' : 'alert';
        h.push('<li class="' + (w.severity || 'warning') + '"' + (w.uids && w.uids.length ? ' data-uids="' + esc(w.uids.slice(0, 200).join(',')) + '"' : '') + '>' + I(ic) + '<span>' + esc(LP.issueText(w)) + '</span></li>');
      });
      h.push('</ul>');
    }

    if (d.suggestion) h.push('<h3>' + I('info') + t('suggestions') + '</h3><div class="sugg">' + d.suggestion + '</div>');

    h.push('<h3>' + I('target') + t('cog') + '</h3><div class="balance">' + balanceSvg(st, C) +
      '<div class="cog-xyz">x ' + U.fmt(st.cog.x, 0) + ' · y ' + U.fmt(st.cog.y, 0) + ' · z ' + U.fmt(st.cog.z, 0) + ' cm</div>' +
      split(st.leftPct, st.rightPct, t('left'), t('right')) + split(st.frontPct, st.rearPct, t('front'), t('rear')) + '</div>');

    if (d.vgm) h.push('<h3>' + I('scale') + t('vgmTitle') + '</h3>' + LP.vgmSection(d.vgm, d.ship || {}));
    if (d.axle && d.axleCfg) h.push('<h3>' + I('scale') + t('axleLoads') + ' · ' + esc(t('veh_' + d.axleCfg.type)) + '</h3>' + axleSection(d.axle, d.axleCfg, C));

    h.push('<h3>' + I('list') + t('perSku') + '</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + t('sku') + '</th><th class="n">' + t('requested') + '</th><th class="n">' + t('placed') + '</th><th class="n">' + t('unplaced') + '</th><th class="n">' + t('kg') + '</th></tr></thead><tbody>');
    (st.perSku || []).forEach(function (r) {
      h.push('<tr><td title="' + esc(r.name) + '"><span class="sw" style="background:' + esc(r.color) + '"></span> ' + esc(r.sku) + '</td><td class="n">' + (r.requested == null ? 'MAX' : U.fmt(r.requested, 0)) +
        '</td><td class="n">' + U.fmt(r.placed, 0) + '</td><td class="n' + (r.unplaced ? ' neg' : '') + '">' + U.fmt(r.unplaced, 0) + '</td><td class="n">' + U.fmt(r.weight, 0) + '</td></tr>');
    });
    h.push('<tr class="tot"><td>' + t('total') + '</td><td class="n">' + (anyMax ? '–' : U.fmt(totalReq, 0)) + '</td><td class="n">' + U.fmt(st.count, 0) + '</td><td class="n">' + U.fmt(st.unplacedTotal || 0, 0) + '</td><td class="n">' + U.fmt(st.weight, 0) + '</td></tr>');
    h.push('</tbody></table></div>');
    if (st.count) h.push('<div class="row gap"><button class="btn sm" data-dn>' + I('truck') + t('dnMenu') + '</button></div>');

    if (d.lastRun) {
      h.push('<div class="runinfo">' + I('zap') + t('lastRun') + ': ' + U.fmt(d.lastRun.timeMs, 0) + ' ms · ' + d.lastRun.iterations + ' ' + t('runs') + ' · ' + t('obj' + cap(d.lastRun.objective)) + (d.lastRun.worker ? ' · ' + t('worker') : '') + '</div>');
    }
    el.innerHTML = h.join('');
  };
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
})(this);
