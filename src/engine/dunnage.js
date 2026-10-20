/* Container & Truck Load Planner — engine/dunnage.js
 * Securing-material suggestions: finds voids the load could shift into and proposes airbags or timber
 * bracing (planning aid — not a substitute for checking the lashing on site).
 *   · door void        → timber bars across the width, fixed to the corner posts (the door can't take load)
 *   · void ≤ bagMaxGap → dunnage airbags sized to the load face
 *   · wider voids      → fill with empty pallets / timber (bracing estimate + warning)
 * Engine coordinates: x = width (0 = left wall), y = length (0 = front wall), z = up. Units cm / kg.
 */
var LPEngineParts = (typeof LPEngineParts !== 'undefined') ? LPEngineParts : [];
LPEngineParts.push(function dunnage(E) {
  'use strict';

  E.DUNNAGE_DEFAULTS = {
    minGap: 5,                       // smaller voids are ignored (friction / normal tolerance)
    bagMaxGap: 45,                   // airbags only up to this void width
    bagSizes: [[90, 120], [90, 180], [120, 180], [120, 210]],   // width × height (cm)
    timberSpacing: 60,               // vertical spacing of bracing bars (cm)
    timberKgPerM: 2.5,               // 2×4" (5×10 cm) softwood
    bagKgPerM2: 0.85,                // paper airbag
    minRun: 60                       // side / inner pockets shorter than this along the length are ignored (neighbours hold the load)
  };

  function cfgOf(c) {
    var o = {}, k, d = E.DUNNAGE_DEFAULTS;
    for (k in d) o[k] = d[k];
    for (k in (c || {})) if (c[k] != null && c[k] !== '') o[k] = c[k];
    if (typeof o.bagSizes === 'string') o.bagSizes = E.parseBagSizes(o.bagSizes);
    if (!o.bagSizes || !o.bagSizes.length) o.bagSizes = d.bagSizes;
    return o;
  }
  /** "90x120, 120x180" → [[90,120],[120,180]] */
  E.parseBagSizes = function (s) {
    return String(s || '').split(/[,;\s]+/).map(function (t) {
      var m = t.match(/^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/i);
      return m ? [+m[1], +m[2]] : null;
    }).filter(Boolean).sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
  };

  function pickBag(cfg, faceW, faceH) {
    var fits = cfg.bagSizes.filter(function (b) { return b[1] <= faceH + 10 && b[0] <= faceW + 10; });
    var best = (fits.length ? fits : cfg.bagSizes.slice(0, 1)).slice().sort(function (a, b) { return b[1] - a[1] || b[0] - a[0]; })[0];
    return { size: best, qty: Math.max(1, Math.ceil(faceW / (best[0] + 10))) };
  }

  /**
   * @returns {{ gaps: Array, items: Array, totalWeight: number, warnings: Array }}
   * gap: { type: 'door'|'trans'|'side'|'inner', x0, x1, y0, y1, h, t, faceW, solution: 'bag'|'timber', bag, qty, len, shapes }
   */
  E.dunnagePlan = function (C, placements, specs, cfgIn) {
    var cfg = cfgOf(cfgIn), out = { gaps: [], items: [], totalWeight: 0, warnings: [] };
    var ps = (placements || []).filter(function (p) { return p.l > 0 && p.w > 0; });
    if (!ps.length) return out;
    var W = C.W, L = C.L, step = 10;
    var maxY = ps.reduce(function (m, p) { return Math.max(m, p.y + p.l); }, 0);

    // 1. slice the loaded length; per slice: occupied x-intervals (with stack height) → voids
    var slices = [];
    for (var y0 = 0; y0 < maxY - 0.01; y0 += step) {
      var y1 = Math.min(maxY, y0 + step), iv = [];
      ps.forEach(function (p) { if (p.y < y1 - 0.5 && p.y + p.l > y0 + 0.5) iv.push([p.x, p.x + p.w, p.z + p.h]); });
      iv.sort(function (a, b) { return a[0] - b[0]; });
      var merged = [];
      iv.forEach(function (a) {
        var m = merged[merged.length - 1];
        if (m && a[0] <= m[1] + 0.5) { m[1] = Math.max(m[1], a[1]); m[2] = Math.max(m[2], a[2]); } else merged.push(a.slice());
      });
      var voids = [];
      if (!merged.length) voids.push({ type: 'trans', x0: 0, x1: W, h: 0 });
      else {
        if (merged[0][0] > cfg.minGap) voids.push({ type: 'side', wall: 'L', x0: 0, x1: merged[0][0], h: merged[0][2] });
        for (var i = 1; i < merged.length; i++) {
          if (merged[i][0] - merged[i - 1][1] > cfg.minGap) voids.push({ type: 'inner', x0: merged[i - 1][1], x1: merged[i][0], h: Math.min(merged[i - 1][2], merged[i][2]) });
        }
        var last = merged[merged.length - 1];
        if (W - last[1] > cfg.minGap) voids.push({ type: 'side', wall: 'R', x0: last[1], x1: W, h: last[2] });
      }
      slices.push({ y0: y0, y1: y1, voids: voids });
    }
    // 2. join voids of consecutive slices into regions. A void along a wall runs as long as there is any gap
    //    there; its width is the narrowest point (staggered drums touch the wall only every other row, so the
    //    load can only move as far as the smallest clearance). Inner voids keep the overlap of their x-ranges.
    var open = [], regions = [];
    slices.forEach(function (s) {
      var next = [];
      s.voids.forEach(function (v) {
        var r = open.filter(function (o) {
          if (o.type !== v.type) return false;
          if (v.type === 'side') return o.wall === v.wall;
          if (v.type === 'inner') return Math.min(o.x1, v.x1) - Math.max(o.x0, v.x0) > cfg.minGap;
          return true;
        })[0];
        if (r) {
          r.y1 = s.y1; r.h = Math.min(r.h || v.h, v.h || r.h);
          if (v.type === 'side' && v.wall === 'L') r.x1 = Math.min(r.x1, v.x1);
          else if (v.type === 'side') r.x0 = Math.max(r.x0, v.x0);
          else if (v.type === 'inner') { r.x0 = Math.max(r.x0, v.x0); r.x1 = Math.min(r.x1, v.x1); }
          open.splice(open.indexOf(r), 1); next.push(r);
        } else next.push({ type: v.type, wall: v.wall, x0: v.x0, x1: v.x1, y0: s.y0, y1: s.y1, h: v.h });
      });
      open.forEach(function (o) { regions.push(o); });
      open = next;
    });
    open.forEach(function (o) { regions.push(o); });
    function heightNear(y, span) {    // tallest stack touching the band [y - span, y + span]
      return ps.reduce(function (m, p) { return p.y < y + span && p.y + p.l > y - span ? Math.max(m, p.z + p.h) : m; }, 0);
    }
    regions.forEach(function (r) {
      if (r.type === 'trans') {          // full-width void between rows: face height = lower of the two rows
        if (r.y1 - r.y0 <= cfg.minGap) return;
        r.h = Math.min(heightNear(r.y0 - 1, 1), heightNear(r.y1 + 1, 1)) || heightNear(r.y0, r.y1 - r.y0);
        r.t = r.y1 - r.y0; r.faceW = W;
      } else {
        if (r.y1 - r.y0 < cfg.minRun || r.x1 - r.x0 <= cfg.minGap) return;
        r.t = r.x1 - r.x0; r.faceW = r.y1 - r.y0;
      }
      if (r.h > 0) out.gaps.push(r);
    });
    // 3. door void
    if (L - maxY > cfg.minGap) {
      var hd = heightNear(maxY - 15, 15);
      out.gaps.push({ type: 'door', x0: 0, x1: W, y0: maxY, y1: L, h: hd, t: L - maxY, faceW: W });
    }
    // 4. materials + 3D shapes (engine coords, min corner + size)
    out.gaps.forEach(function (g, gi) {
      g.id = 'g' + (gi + 1);
      g.shapes = [];
      var across = g.type === 'trans' || g.type === 'door';     // void spans the width (thickness along y)
      if (g.type !== 'door' && g.t <= cfg.bagMaxGap) {
        var b = pickBag(cfg, g.faceW, g.h), bw = b.size[0], bh = Math.min(b.size[1], g.h);
        g.solution = 'bag'; g.bag = b.size; g.qty = b.qty;
        var pitch = g.faceW / b.qty;
        for (var k = 0; k < b.qty; k++) {
          var c = (k + 0.5) * pitch, sw = Math.min(bw, pitch - 4);
          if (across) g.shapes.push({ kind: 'bag', x: c - sw / 2, y: g.y0 + 1, z: 4, w: sw, l: Math.max(2, g.t - 2), h: bh - 6 });
          else g.shapes.push({ kind: 'bag', x: g.x0 + 1, y: g.y0 + c - sw / 2, z: 4, w: Math.max(2, g.t - 2), l: sw, h: bh - 6 });
        }
      } else {
        var rows = Math.max(2, Math.ceil(g.h / cfg.timberSpacing)), sec = 9;
        g.solution = 'timber';
        if (across) {
          g.len = W; g.qty = rows;
          for (var r = 0; r < rows; r++) g.shapes.push({ kind: 'timber', x: 0, y: g.y0 + 1, z: Math.min(g.h - sec, 25 + r * (g.h - 40) / Math.max(1, rows - 1)), w: W, l: sec, h: sec });
        } else {
          var cols = Math.max(1, Math.ceil(g.faceW / 120));
          g.len = Math.round(g.t); g.qty = rows * cols;
          for (var cc = 0; cc < cols; cc++) for (var rr = 0; rr < rows; rr++) {
            g.shapes.push({ kind: 'timber', x: g.x0, y: g.y0 + (cc + 0.5) * g.faceW / cols - sec / 2, z: Math.min(g.h - sec, 25 + rr * (g.h - 40) / Math.max(1, rows - 1)), w: g.t, l: sec, h: sec });
          }
          out.warnings.push({ code: 'dnWide', severity: 'warning', params: { t: Math.round(g.t) } });
        }
      }
    });
    // 5. bill of materials
    var bom = {};
    out.gaps.forEach(function (g) {
      var key = g.solution === 'bag' ? 'bag|' + g.bag.join('x') : 'timber|' + Math.round(g.len);
      if (!bom[key]) bom[key] = g.solution === 'bag'
        ? { kind: 'bag', size: g.bag, qty: 0, unitKg: g.bag[0] * g.bag[1] / 1e4 * cfg.bagKgPerM2, gaps: [] }
        : { kind: 'timber', len: Math.round(g.len), qty: 0, unitKg: g.len / 100 * cfg.timberKgPerM, gaps: [] };
      bom[key].qty += g.qty;
      bom[key].gaps.push(g.id);
    });
    out.items = Object.keys(bom).map(function (k) { var it = bom[k]; it.weight = it.unitKg * it.qty; return it; })
      .sort(function (a, b) { return (a.kind === 'bag' ? 0 : 1) - (b.kind === 'bag' ? 0 : 1); });
    out.totalWeight = out.items.reduce(function (s, it) { return s + it.weight; }, 0);
    return out;
  };
});
if (typeof module !== 'undefined' && module.exports) module.exports = LPEngineParts;
