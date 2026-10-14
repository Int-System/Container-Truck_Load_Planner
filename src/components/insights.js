/* Container & Truck Load Planner — components/insights.js
 * Right-panel tabs: step-by-step loading instructions and multi-container plan.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};

  /**
   * Group the loading sequence into wall sections (front → door). A new step starts when the
   * sequence moves more than `depth` cm toward the door. Each step lists its SKU counts.
   */
  LP.buildSteps = function (placements, L) {
    var seq = placements.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
    var depth = Math.max(60, (L || 600) / 10);
    var groups = [], g = null;
    seq.forEach(function (p, i) {
      var n = i + 1;
      if (!g || p.y >= g.start + depth) {
        g = { start: p.y, from: n, to: n, n: 0, weight: 0, y0: Infinity, y1: 0, z1: 0, skus: {}, order: [] };
        groups.push(g);
      }
      g.to = n; g.n++; g.weight += +p.weight || 0;
      g.y0 = Math.min(g.y0, p.y); g.y1 = Math.max(g.y1, p.y + p.l); g.z1 = Math.max(g.z1, p.z + p.h);
      if (!g.skus[p.sku]) { g.skus[p.sku] = 0; g.order.push(p.sku); }
      g.skus[p.sku]++;
    });
    return groups;
  };

  LP.renderSteps = function (el, d) {
    var t = LP.t, U = LP.units, esc = LP.esc, I = LP.icon;
    if (!d.placements.length) { el.innerHTML = '<div class="empty">' + I('list') + t('noSteps') + '</div>'; return; }
    var groups = LP.buildSteps(d.placements, d.L), step = d.step;
    var h = ['<div class="steps-h"><b>' + t('stepsCount', { n: groups.length }) + ' · ' + d.placements.length + ' ' + t('pcs') + '</b><span class="sp"></span>' +
      '<button class="btn sm" data-steps-play>' + I(d.playing ? 'pause' : 'play') + t(d.playing ? 'pause' : 'play') + '</button>' +
      (step != null ? '<button class="btn sm ghost" data-steps-all>' + t('showAll') + '</button>' : '') + '</div>',
    '<div class="row gap wrap" style="margin:0 0 10px"><button class="btn sm primary" data-checklist>' + I('check') + t('checklist') + '</button>' +
      '<button class="btn sm" data-stepsheet>' + I('file') + t('stepSheet') + '</button></div>',
    '<div class="muted small" style="margin-bottom:8px">' + t('stepsIntro') + '</div><ol class="steps">'];
    groups.forEach(function (g, i) {
      var cls = step == null ? '' : step >= g.from && step <= g.to ? 'on' : g.to < step ? 'done' : '';
      var skus = g.order.map(function (id) {
        var s = d.specs[id] || {};
        return '<span class="sku-c"><span class="sw" style="background:' + esc(s.color) + '"></span>' + esc(s.sku || id) + ' ×' + g.skus[id] + '</span>';
      }).join('');
      var where = t('atLength', { a: U.fmt(g.y0, 0), b: U.fmt(g.y1, 0) }) + ' · ' + t('heightTo', { h: U.fmt(g.z1, 0) });
      h.push('<li class="' + cls + '" data-to="' + g.to + '"><span class="no">' + (i + 1) + '</span>' +
        '<span class="st"><span class="sku-list">' + skus + '</span><span>' + where + '</span></span>' +
        '<span class="rng-s"><b>' + g.n + ' ' + t('pcs') + '</b><br>#' + g.from + (g.to > g.from ? '–' + g.to : '') + ' · ' + U.fmt(g.weight, 0) + ' ' + t('kg') + '</span></li>');
    });
    h.push('</ol>');
    el.innerHTML = h.join('');
  };

  LP.renderMulti = function (el, d) {
    var t = LP.t, U = LP.units, esc = LP.esc, I = LP.icon, m = d.multi;
    var h = ['<div class="muted small" style="margin:12px 0 8px">' + t('multiIntro') + ': <b>' + esc(d.containerName) + '</b></div>',
      '<button class="btn sm primary" data-multi-run>' + I('stack') + t('multiRun') + '</button>'];
    if (d.multiBusy) h.push('<div class="banner info"><div class="spinner" style="width:16px;height:16px;border-width:2px"></div>' + t('checking') + '</div>');
    else if (m) {
      if (m.fleet) h.push('<div class="banner info">' + I('stack') + esc(t('fleetBanner', { n: m.containers })) + '</div>');
      else if (m.containers <= 1 && m.complete) h.push('<div class="banner ok">' + I('check') + t('multiNone') + '</div>');
      else {
        h.push('<div class="banner ' + (m.complete ? 'info' : 'bad') + '">' + I(m.complete ? 'info' : 'alert') + esc(t('needContainers', { n: m.containers + (m.complete ? '' : '+'), name: d.containerName })) + '</div>');
      }
      h.push('<div class="mcards">');
      m.loads.forEach(function (l, i) {
        var on = d.active === i;
        h.push('<div class="mcard' + (on ? ' on' : '') + '"><span class="mno">' + (i + 1) + '</span><div class="mt"><b>' + (l.name ? esc(l.name) : t('containerN', { n: i + 1 })) + '</b> · ' + U.fmt(l.count, 0) + ' ' + t('pcs') +
          '<div class="muted">' + U.fmt(l.weight, 0) + ' ' + t('kg') + ' · ' + U.fmt(l.volUtil, 1) + '% ' + t('volume') + '</div>' +
          '<div class="bar-t"><span style="width:' + Math.min(100, l.volUtil).toFixed(1) + '%"></span></div></div>' +
          '<button class="btn sm' + (on ? ' primary' : '') + '" data-multi-open="' + i + '">' + (on ? t('viewing') : t('viewThis')) + '</button></div>');
      });
      h.push('</div>');
      if (m.leftover && m.leftover.length) {
        h.push('<div class="banner bad">' + I('alert') + t('w_unplaced', { n: m.leftover.reduce(function (s, x) { return s + x.qty; }, 0) }) + '</div>');
      }
    }
    el.innerHTML = h.join('');
  };
})(this);
