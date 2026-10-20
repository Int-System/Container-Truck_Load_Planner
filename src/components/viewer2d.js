/* Container & Truck Load Planner — components/viewer2d.js
 * 2D orthographic views rendered as SVG (also reused by the PDF report).
 *   top  : looking down.   horizontal = length (front ← → door), vertical = width (x=0 at bottom)
 *   side : seen from the left side (x=0).  horizontal = length, vertical = height
 *   door : seen from the door.            horizontal = width (x=0 left), vertical = height
 * "Left" everywhere means left when standing at the door looking in.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function r1(v) { return Math.round(v * 10) / 10; }

  function textColor(hex) {
    var h = String(hex || '#888').replace('#', '');
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? '#111' : '#fff';
  }

  /** Project a placement into view coordinates → {u, v, du, dv, depth} (v measured from top of SVG). */
  function project(view, p, C) {
    if (view === 'top') return { u: p.y, v: C.W - (p.x + p.w), du: p.l, dv: p.w, depth: p.z + p.h };
    if (view === 'side') return { u: p.y, v: C.H - (p.z + p.h), du: p.l, dv: p.h, depth: -p.x };
    return { u: p.x, v: C.H - (p.z + p.h), du: p.w, dv: p.h, depth: p.y + p.l };
  }

  function dims(view, C) {
    if (view === 'top') return { U: C.L, V: C.W };
    if (view === 'side') return { U: C.L, V: C.H };
    return { U: C.W, V: C.H };
  }

  /**
   * ctx: { C, placements, specs, flags, tiers, selected, layer, hiddenSku, cut, step, cog, showLabels, forPrint }
   */
  // ---- colour modes (Display → "Colour by"): shared by the 2D views and viewer3d.js
  LP.DROP_COLORS = ['#1D9E75', '#378ADD', '#7F77DD', '#D85A30', '#D4537E', '#BA7517', '#5F5E5A', '#639922'];
  var WEIGHT_STOPS = [[0, [253, 233, 196]], [0.5, [239, 163, 61]], [1, [163, 45, 45]]];
  LP.weightColor = function (t) {
    t = Math.max(0, Math.min(1, t || 0));
    var a = t <= 0.5 ? WEIGHT_STOPS[0] : WEIGHT_STOPS[1], b = t <= 0.5 ? WEIGHT_STOPS[1] : WEIGHT_STOPS[2], k = (t - a[0]) / (b[0] - a[0]);
    return '#' + [0, 1, 2].map(function (i) { return ('0' + Math.round(a[1][i] + (b[1][i] - a[1][i]) * k).toString(16)).slice(-2); }).join('');
  };
  /** Colour of one placed item: 'sku' (default) · 'weight' (heat map on a log scale between the lightest
   *  and heaviest piece, so 6 kg and 24 kg cartons still differ next to a 450 kg pallet) · 'drop' · 'fragile'. */
  LP.cargoColor = function (p, spec, mode, maxW, minW) {
    spec = spec || {};
    if (mode === 'weight') {
      var w = Math.max(p.weight || 0, 0.01), lo = Math.max(minW || 0.01, 0.01), hi = Math.max(maxW || 1, lo * 1.0001);
      return LP.weightColor(hi / lo < 1.5 ? w / hi : Math.log(w / lo) / Math.log(hi / lo));
    }
    if (mode === 'drop') return LP.DROP_COLORS[((+spec.dropOrder || 1) - 1) % LP.DROP_COLORS.length];
    if (mode === 'fragile') return spec.fragile ? '#e24b4a' : '#d5dbe3';
    return spec.color || '#888888';
  };
  LP.maxWeight = function (placements) { return placements.reduce(function (m, p) { return Math.max(m, p.weight || 0); }, 0); };
  LP.minWeight = function (placements) { return placements.reduce(function (m, p) { return Math.min(m, p.weight || m); }, Infinity); };

  LP.svg2D = function (view, ctx) {
    var C = ctx.C, t = LP.t, U = LP.units;
    var d = dims(view, C);
    var big = Math.max(d.U, d.V);
    var fs = big * 0.024;
    var m = fs * 3.2;
    var vb = [-m, -m * 1.1, d.U + m * 2, d.V + m * 2.3];
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" class="svg2d" viewBox="' + vb.map(r1).join(' ') + '" preserveAspectRatio="xMidYMid meet" font-family="system-ui, Segoe UI, Noto Sans Thai, sans-serif">');
    // container outline + floor tint
    out.push('<rect x="0" y="0" width="' + d.U + '" height="' + d.V + '" class="c-floor" fill="#94a3b8" fill-opacity="0.10" stroke="#64748b" stroke-width="2" vector-effect="non-scaling-stroke"/>');
    // grid every 50 cm (100 cm when big)
    var step = big > 900 ? 100 : 50, g = [];
    for (var gu = step; gu < d.U; gu += step) g.push('M' + gu + ' 0V' + d.V);
    for (var gv = step; gv < d.V; gv += step) g.push('M0 ' + (d.V - gv) + 'H' + d.U);
    out.push('<path d="' + g.join('') + '" stroke="#94a3b8" stroke-opacity="0.35" stroke-width="0.6" vector-effect="non-scaling-stroke" fill="none"/>');

    var maxW = ctx.colorBy === 'weight' ? LP.maxWeight(ctx.placements) : 0, minW = ctx.colorBy === 'weight' ? LP.minWeight(ctx.placements) : 0;
    var list = ctx.placements.filter(function (p) {
      if (ctx.hiddenSku && ctx.hiddenSku[p.sku]) return false;
      if (ctx.cut != null && ctx.cut < 1 && p.y >= C.L * ctx.cut) return false;
      if (ctx.step != null && (p.seq || 0) > ctx.step) return false;
      return true;
    });
    var layer = ctx.layer || 0;
    var skuNo = {};   // 1-based position in the cargo list — short label for boxes too small for the SKU
    Object.keys(ctx.specs || {}).forEach(function (k, i) { skuNo[k] = i + 1; });
    list.sort(function (a, b) {
      var pa = project(view, a, C), pb = project(view, b, C);
      return pa.depth - pb.depth;
    });
    list.forEach(function (p) {
      var tier = ctx.tiers ? ctx.tiers[p.uid] : null;
      var faint = false;
      if (layer) {
        if (view === 'top' && tier > layer) return;
        faint = tier !== layer;
      }
      if (ctx.highlightFrom && (p.seq || 0) < ctx.highlightFrom) faint = true;   // already loaded in earlier steps
      var s = ctx.specs[p.sku] || {}, pr = project(view, p, C);
      var col = ctx.colorBy && ctx.colorBy !== 'sku' ? LP.cargoColor(p, s, ctx.colorBy, maxW, minW) : (s.color || '#888');
      var bad = ctx.flags && ctx.flags[p.uid] && ctx.flags[p.uid].some(function (c) { return c !== 'heavyOnLight' && c !== 'deliveryBlocked'; });
      var sel = ctx.selected === p.uid;
      var stroke = sel ? '#facc15' : bad ? '#dc2626' : 'rgba(0,0,0,0.55)';
      var sw = sel || bad ? 2.5 : 0.8;
      out.push('<g data-uid="' + esc(p.uid) + '" class="b2d' + (faint ? ' faint' : '') + '"' + (faint ? ' opacity="0.22"' : '') + '>');
      var cyl = s.pkg === 'cylinder' && ((view === 'top' && (p.ax || 'z') === 'z') || (view === 'side' && p.ax === 'x') || (view === 'door' && p.ax === 'y'));
      if (cyl) {
        out.push('<ellipse cx="' + r1(pr.u + pr.du / 2) + '" cy="' + r1(pr.v + pr.dv / 2) + '" rx="' + r1(pr.du / 2) + '" ry="' + r1(pr.dv / 2) + '" fill="' + col + '" stroke="' + stroke + '" stroke-width="' + sw + '" vector-effect="non-scaling-stroke"/>');
      } else {
        out.push('<rect x="' + r1(pr.u) + '" y="' + r1(pr.v) + '" width="' + r1(pr.du) + '" height="' + r1(pr.dv) + '" fill="' + col + '" stroke="' + stroke + '" stroke-width="' + sw + '" vector-effect="non-scaling-stroke"/>');
        if (s.pkg === 'pallet' && view !== 'top') {
          var ph = Math.min(15, p.h * 0.2);
          out.push('<rect x="' + r1(pr.u) + '" y="' + r1(pr.v + pr.dv - ph) + '" width="' + r1(pr.du) + '" height="' + r1(ph) + '" fill="#8b5a2b" fill-opacity="0.85"/>');
        }
        if (s.fragile) out.push('<path d="M' + r1(pr.u) + ' ' + r1(pr.v) + 'l' + r1(pr.du) + ' ' + r1(pr.dv) + '" stroke="rgba(0,0,0,0.25)" stroke-width="0.8" vector-effect="non-scaling-stroke"/>');
      }
      out.push('<title>' + esc((s.sku || '') + (s.name ? ' · ' + s.name : '') + ' — ' + r1(p.w) + '×' + r1(p.l) + '×' + r1(p.h) + ' cm') + '</title>');
      if (ctx.showLabels !== false && !faint) {
        var label = s.sku || '';
        var size = Math.min(fs * 0.85, pr.dv * 0.34, pr.du / Math.max(3, label.length * 0.72));
        if (size <= big * 0.006 && skuNo[p.sku]) {   // SKU doesn't fit → show its list number instead
          label = String(skuNo[p.sku]);
          size = Math.min(fs * 0.7, pr.dv * 0.55, pr.du * 0.8 / (label.length * 0.72));
        }
        if (size > big * 0.006) {
          var tc = textColor(col);
          var dimTxt = r1(p.w) + '×' + r1(p.l) + '×' + r1(p.h);
          var two = label === s.sku && pr.dv > size * 3.2 && pr.du / (dimTxt.length * 0.55) > size * 0.6;
          var cy = pr.v + pr.dv / 2 + (two ? -size * 0.25 : size * 0.35);
          out.push('<text x="' + r1(pr.u + pr.du / 2) + '" y="' + r1(cy) + '" font-size="' + r1(size) + '" text-anchor="middle" fill="' + tc + '" font-weight="600" pointer-events="none">' + esc(label) + '</text>');
          if (two) {
            var s2 = Math.min(size * 0.8, pr.du / (dimTxt.length * 0.58));
            out.push('<text x="' + r1(pr.u + pr.du / 2) + '" y="' + r1(cy + size * 1.05) + '" font-size="' + r1(s2) + '" text-anchor="middle" fill="' + tc + '" fill-opacity="0.85" pointer-events="none">' + dimTxt + '</text>');
          }
        }
      }
      out.push('</g>');
    });

    // clear door opening (door view)
    if (view === 'door' && C.doorW > 0 && C.doorH > 0 && (C.doorW < C.W - 0.5 || C.doorH < C.H - 0.5)) {
      out.push('<rect x="' + r1((C.W - C.doorW) / 2) + '" y="' + r1(C.H - C.doorH) + '" width="' + r1(C.doorW) + '" height="' + r1(C.doorH) + '" fill="none" stroke="#ea580c" stroke-width="2" stroke-dasharray="8 5" vector-effect="non-scaling-stroke" pointer-events="none"/>');
      out.push('<text x="' + r1(C.W / 2) + '" y="' + r1(C.H - C.doorH - fs * 0.4) + '" font-size="' + r1(fs * 0.75) + '" text-anchor="middle" fill="#ea580c" pointer-events="none">' +
        esc(t('doorOpening')) + ' ' + U.fmt(C.doorW, 0) + ' × ' + U.fmt(C.doorH, 0) + ' cm</text>');
    }

    // centre of gravity marker
    if (ctx.cog && ctx.placements.length) {
      var cg = view === 'top' ? { u: ctx.cog.y, v: C.W - ctx.cog.x } : view === 'side' ? { u: ctx.cog.y, v: C.H - ctx.cog.z } : { u: ctx.cog.x, v: C.H - ctx.cog.z };
      var cr = big * 0.014;
      out.push('<g class="cog" pointer-events="none"><circle cx="' + r1(cg.u) + '" cy="' + r1(cg.v) + '" r="' + r1(cr) + '" fill="#fff" stroke="#111" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
        '<path d="M' + r1(cg.u - cr) + ' ' + r1(cg.v) + 'H' + r1(cg.u + cr) + 'M' + r1(cg.u) + ' ' + r1(cg.v - cr) + 'V' + r1(cg.v + cr) + '" stroke="#111" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
        '<path d="M' + r1(cg.u) + ' ' + r1(cg.v) + 'm-' + r1(cr) + ' 0a' + r1(cr) + ' ' + r1(cr) + ' 0 0 1 ' + r1(cr) + '-' + r1(cr) + 'V' + r1(cg.v) + 'z" fill="#111"/></g>');
      // geometric centre lines
      out.push('<path d="M' + r1(d.U / 2) + ' 0V' + d.V + (view === 'top' ? 'M0 ' + r1(d.V / 2) + 'H' + d.U : '') + '" stroke="#ef4444" stroke-opacity="0.45" stroke-dasharray="6 6" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>');
    }

    // dimension annotations
    var dimCol = 'currentColor';
    function hdim(len, y, label) {
      out.push('<path d="M0 ' + r1(y) + 'H' + r1(len) + 'M0 ' + r1(y - fs * 0.4) + 'v' + r1(fs * 0.8) + 'M' + r1(len) + ' ' + r1(y - fs * 0.4) + 'v' + r1(fs * 0.8) + '" stroke="' + dimCol + '" stroke-opacity="0.6" stroke-width="1" vector-effect="non-scaling-stroke"/>');
      out.push('<text x="' + r1(len / 2) + '" y="' + r1(y + fs * 1.25) + '" font-size="' + r1(fs) + '" text-anchor="middle" fill="' + dimCol + '">' + label + '</text>');
    }
    function vdim(len, x, label) {
      out.push('<path d="M' + r1(x) + ' 0V' + r1(len) + 'M' + r1(x - fs * 0.4) + ' 0h' + r1(fs * 0.8) + 'M' + r1(x - fs * 0.4) + ' ' + r1(len) + 'h' + r1(fs * 0.8) + '" stroke="' + dimCol + '" stroke-opacity="0.6" stroke-width="1" vector-effect="non-scaling-stroke"/>');
      out.push('<text x="' + r1(x - fs * 0.7) + '" y="' + r1(len / 2) + '" font-size="' + r1(fs) + '" text-anchor="middle" fill="' + dimCol + '" transform="rotate(-90 ' + r1(x - fs * 0.7) + ' ' + r1(len / 2) + ')">' + label + '</text>');
    }
    function cm(v) { return U.fmt(v, 1) + ' cm'; }
    hdim(d.U, d.V + fs * 1.2, (view === 'door' ? t('width') : t('length')) + ' ' + cm(d.U));
    vdim(d.V, -fs * 1.2, (view === 'top' ? t('width') : t('height')) + ' ' + cm(d.V));
    // orientation labels
    var lab = function (x, y, txt, anchor, col) {
      out.push('<text x="' + r1(x) + '" y="' + r1(y) + '" font-size="' + r1(fs * 0.95) + '" font-weight="700" text-anchor="' + anchor + '" fill="' + (col || dimCol) + '">' + esc(txt) + '</text>');
    };
    if (view === 'door') {
      lab(0, -fs * 0.6, '◀ ' + t('left'), 'start');
      lab(d.U, -fs * 0.6, t('right') + ' ▶', 'end');
    } else {
      lab(0, -fs * 0.6, '◀ ' + t('frontHere'), 'start');
      lab(d.U, -fs * 0.6, t('doorHere') + ' ▶', 'end', '#ea580c');
      out.push('<rect x="' + r1(d.U - 2) + '" y="0" width="' + r1(Math.max(4, fs * 0.35)) + '" height="' + d.V + '" fill="#ea580c" fill-opacity="0.85"/>');
      if (view === 'top') {
        lab(d.U + fs * 0.5, d.V - fs * 0.2, t('left'), 'start');
        lab(d.U + fs * 0.5, fs * 0.9, t('right'), 'start');
      }
    }
    out.push('</svg>');
    return out.join('');
  };

  /** Mount a live 2D viewer with click-to-select. */
  LP.Viewer2D = function (el, onSelect) {
    el.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('[data-uid]');
      onSelect(g ? g.getAttribute('data-uid') : null);
    });
    return {
      render: function (view, ctx) { el.innerHTML = LP.svg2D(view, ctx); }
    };
  };
})(this);
