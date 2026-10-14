/* Container & Truck Load Planner — engine/packer.js
 *
 * Algorithm: Empty-Maximal-Space (EMS) block building + GRASP multi-start.
 *  - The free volume is kept as a list of maximal empty cuboids (spaces). Placements never
 *    intersect because a block is only placed fully inside a free space.
 *  - At every step the space nearest the front-bottom-left corner is taken ('wall' order: y,z,x —
 *    walls from the bulkhead toward the door; or 'layer' order: z,y,x — floor layers first).
 *  - Candidate *blocks* (nx × ny × nz identical items, same orientation) are generated per SKU and
 *    orientation. Repetition counts per axis come from the max count plus counts suggested by a
 *    1-D fill of the space with other item lengths (e.g. 239 = 2×40 + 5×30), so mixed
 *    orientations can tile the space.
 *  - Blocks are scored by value (count or volume) + a one-step look-ahead estimate of how well the
 *    residual slabs can be filled.
 *  - Feasibility: support ratio, fragile / non-stackable, stack tiers, load-on-top (propagated down
 *    the stack), heavy-on-light, payload, and (delivery mode) door access by drop order.
 *  - GRASP: several deterministic runs, then randomised runs (choose among top-δ blocks) until the
 *    time budget is used; the best solution by the chosen objective is kept.
 * Block building makes homogeneous cargo (hundreds of identical cartons) very fast because a whole
 * wall/layer is placed in one step.
 */
var LPEngineParts = (typeof LPEngineParts !== 'undefined') ? LPEngineParts : [];
LPEngineParts.push(function packer(E) {
  'use strict';
  var EPS = E.EPS, TOPTOL = E.TOPTOL;
  var now = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); } : function () { return Date.now(); };

  function rng32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  E.DEFAULT_OPTIONS = {
    objective: 'volume',   // 'count' | 'volume' | 'balance' | 'delivery'
    timeLimit: 2500,       // ms budget for GRASP iterations
    maxIter: 400,
    minSupport: 0.75,      // min fraction of the base that must rest on something
    heavyBottom: true,     // never place a heavier item on top of a lighter one
    seed: 7,
    fixed: [],             // locked placements (hybrid mode)
    sideBalance: true,     // anchor floor blocks left/right to keep the lateral CoG centred
    candidateTypes: 8,     // SKUs evaluated per step
    floorLoad: 0,          // kg/m² floor rating (0 = not checked)
    segDistance: 150,      // cm between different segregation groups (DG classes etc.)
    axle: null,            // axle configuration → prefer layouts within axle limits, shift the load if needed
    hexDrums: true         // nest upright drums in a hexagonal pattern when it fits more
  };

  function prepare(C, cargo, opts) {
    var specs = {}, fixedCount = {};
    cargo.forEach(function (c) { specs[c.id] = c; });
    (opts.fixed || []).forEach(function (p) { fixedCount[p.sku] = (fixedCount[p.sku] || 0) + 1; });
    var types = [], doorBlocked = [];
    cargo.forEach(function (c) {
      if (!(c.w > 0 && c.l > 0 && c.h > 0)) return;
      var qty = c.maxMode ? Infinity : Math.max(0, Math.floor(+c.qty || 0) - (fixedCount[c.id] || 0));
      if (qty <= 0) return;
      var caps = E.capsOf(c), w = +c.weight || 0;
      var inZ = caps.maxStack;
      if (caps.cap !== Infinity) inZ = Math.min(inZ, w > 0 ? Math.floor(caps.cap / w + 1e-9) + 1 : Infinity);
      var ors = E.doorOrientations(c, C), md = Infinity;
      if (!ors.length) { if (qty !== Infinity) doorBlocked.push({ id: c.id, qty: qty }); return; }
      ors.forEach(function (o) { md = Math.min(md, o.w, o.l, o.h); });
      types.push({
        k: types.length, id: c.id, qty: qty, weight: w, vol: c.w * c.l * c.h, drop: +c.dropOrder || 1,
        ors: ors, inZ: Math.max(1, inZ), minDim: md, noTop: caps.cap === 0,
        limited: caps.cap !== Infinity || caps.maxStack !== Infinity,
        zone: E.zoneRank(c), seg: c.segGroup ? String(c.segGroup) : ''
      });
    });
    var drops = {}, zoned = cargo.some(function (c) { return c.tempZone; });
    types.forEach(function (t) { drops[t.drop] = 1; });
    (opts.fixed || []).forEach(function (p) { drops[(specs[p.sku] && +specs[p.sku].dropOrder) || 1] = 1; });
    var maxDrop = Math.max.apply(null, types.map(function (t) { return t.drop; }).concat([1]));
    var delivery = opts.objective === 'delivery';
    // sequential loading: temperature zones (coldest first, at the front) and/or drop order (last drop first)
    types.forEach(function (t) { t.seqKey = (zoned ? t.zone * 1000 : 0) + (delivery ? maxDrop - t.drop : 0); });
    return {
      C: C, specs: specs, types: types, opts: opts, fixed: opts.fixed || [], doorBlocked: doorBlocked,
      multiDrop: Object.keys(drops).length > 1, variantCache: new Map(), zoned: zoned,
      sequential: zoned || delivery, hasSeg: types.some(function (t) { return t.seg; }) || (opts.fixed || []).some(function (p) { return specs[p.sku] && specs[p.sku].segGroup; })
    };
  }

  function dedupeLens(arr) {
    var out = [];
    arr.sort(function (a, b) { return a - b; }).forEach(function (v) {
      if (!out.length || Math.abs(out[out.length - 1] - v) > EPS) out.push(v);
    });
    return out;
  }

  /** Candidate repetition counts along one axis of length D for item length a. */
  function variants(ctx, D, a, lens, max) {
    if (max <= 1) return [max];
    var key = D.toFixed(2) + '|' + a + '|' + lens.key + '|' + max;
    var hit = ctx.variantCache.get(key);
    if (hit) return hit;
    function fill(n) {
      var r = D - n * a, best = 0;
      for (var i = 0; i < lens.length; i++) {
        var b = lens[i];
        if (Math.abs(b - a) < EPS || b > r + EPS) continue;
        best = Math.max(best, Math.floor((r + EPS) / b) * b);
      }
      return n * a + best;
    }
    var fmax = fill(max), others = [];
    for (var n = 1; n < max; n++) {
      var f = fill(n);
      if (f > fmax + EPS) others.push({ n: n, f: f });
    }
    others.sort(function (p, q) { return q.f - p.f || q.n - p.n; });
    var res = [max];
    for (var i = 0; i < others.length && res.length < 3; i++) res.push(others[i].n);
    ctx.variantCache.set(key, res);
    return res;
  }

  function capQuantity(nx, ny, nz, q, order) {
    if (nx * ny * nz <= q) return [nx, ny, nz];
    if (order === 'layer') {           // keep full floor layers: reduce height first
      nz = Math.max(1, Math.floor(q / (nx * ny)));
      if (nx * ny * nz > q) { nz = 1; ny = Math.max(1, Math.floor(q / nx)); }
    } else {                           // keep full walls: reduce depth first
      ny = Math.max(1, Math.floor(q / (nx * nz)));
      if (nx * ny * nz > q) { ny = 1; nz = Math.max(1, Math.floor(q / nx)); }
    }
    if (nx * ny * nz > q) { ny = 1; nz = 1; nx = q; }
    return [nx, ny, nz];
  }

  function hexCount(nx, nOdd, ny, nz) { return nz * (Math.ceil(ny / 2) * nx + Math.floor(ny / 2) * nOdd); }

  /**
   * Axle overload of a layout, after the best rigid shift along the length (loads are linear in the shift).
   * Returns { over, over0, dy } — kg over the limits (sum over groups) at the best shift / unshifted.
   */
  function axleEval(ctx, placed, allowShift) {
    var cfg = ctx.opts.axle, C = ctx.C;
    if (!cfg || !placed.length) return null;
    var a0 = E.axleLoads(C, placed, cfg);
    if (!a0) return null;
    var lim = a0.groups.map(function (g) { return g.limit || Infinity; });
    var l0 = a0.groups.map(function (g) { return g.load; });
    function over(loads) { var s = 0; for (var i = 0; i < loads.length; i++) s += Math.max(0, loads[i] - lim[i]); return s; }
    var o0 = over(l0);
    if (!allowShift || o0 <= 0) return { over: o0, over0: o0, dy: 0 };
    var minY = Infinity, maxY = 0;
    placed.forEach(function (p) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + p.l); });
    var a1 = E.axleLoads(C, placed.map(function (p) { return { y: p.y + 100, l: p.l, weight: p.weight }; }), cfg);
    var slope = a1.groups.map(function (g, i) { return (g.load - l0[i]) / 100; });
    var lo = -minY, hi = C.L - maxY, cands = [0, lo, hi];
    slope.forEach(function (sl, i) { if (Math.abs(sl) > 1e-9 && lim[i] !== Infinity) { var d = (lim[i] - l0[i]) / sl; if (d > lo && d < hi) cands.push(d); } });
    var best = { over: o0, dy: 0 };
    cands.forEach(function (d) {
      var ov2 = over(l0.map(function (v, i) { return v + slope[i] * d; }));
      if (ov2 < best.over - 1e-6 || (Math.abs(ov2 - best.over) <= 1e-6 && Math.abs(d) < Math.abs(best.dy))) best = { over: ov2, dy: d };
    });
    return { over: best.over, over0: o0, dy: best.dy };
  }

  function cmpKey(a, b) {
    for (var i = 0; i < a.length; i++) {
      var d = a[i] - b[i], tol = 1e-9 * Math.max(1, Math.abs(a[i]), Math.abs(b[i]));
      if (d > tol) return 1;
      if (d < -tol) return -1;
    }
    return 0;
  }

  function packOnce(ctx, cfg, rng) {
    var C = ctx.C, T = ctx.types, opts = ctx.opts, obj = opts.objective;
    var delivery = obj === 'delivery';
    var rem = T.map(function (t) { return t.qty; });
    var lm = new E.LoadModel(ctx.specs, opts);
    var placed = [];
    var payload = +C.maxPayload > 0 ? +C.maxPayload : Infinity;
    var st = { tw: 0, mx: 0, my: 0, mz: 0, count: 0, vol: 0 };
    var minSupport = lm.minSupport;
    var spaces = [{ x0: 0, y0: 0, z0: 0, x1: C.W, y1: C.L, z1: C.H }];
    var dropOfSku = {};
    Object.keys(ctx.specs).forEach(function (id) { dropOfSku[id] = +ctx.specs[id].dropOrder || 1; });

    var bottoms = new Map(); // topKey(z of bottom face) → placements, to find overhangs above a new block
    function indexBottom(p) {
      var k = Math.round(p.z * 10), arr = bottoms.get(k);
      if (!arr) bottoms.set(k, arr = []);
      arr.push(p);
    }
    /** Would something already placed (an overhang) rest on top of this block in a forbidden way? */
    function touchedFromAbove(t, X, Y, Ztop, bx, by) {
      if (!t.limited && !lm.heavyBottom) return false;
      var k = Math.round(Ztop * 10), box = { x: X, y: Y, w: bx, l: by };
      for (var d = -1; d <= 1; d++) {
        var arr = bottoms.get(k + d);
        if (!arr) continue;
        for (var i = 0; i < arr.length; i++) {
          var p = arr[i];
          if (Math.abs(p.z - Ztop) > TOPTOL || E.footprintOverlap(p, box) <= EPS) continue;
          if (t.limited || (lm.heavyBottom && p.weight > t.weight + 1e-6)) return true;
        }
      }
      return false;
    }

    var zoneMaxY1 = [-Infinity, -Infinity, -Infinity];   // furthest extent toward the door per temperature zone
    function account(p, counted) {
      var w = +p.weight || 0;
      st.tw += w; st.mx += w * (p.x + p.w / 2); st.my += w * (p.y + p.l / 2); st.mz += w * (p.z + p.h / 2);
      if (counted) { st.count++; st.vol += E.solidVolume(p); }
      if (ctx.zoned) { var zr = E.zoneRank(ctx.specs[p.sku]); zoneMaxY1[zr] = Math.max(zoneMaxY1[zr], p.y + p.l); }
    }

    ctx.fixed.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (f) {
      var p = {};
      for (var k in f) p[k] = f[k];
      p.locked = true;
      lm.add(p); placed.push(p); account(p, false); indexBottom(p);
      spaces = E.splitSpaces(spaces, p, 0);
    });
    var segOf = function (p) { var s2 = ctx.specs[p.sku]; return s2 && s2.segGroup ? String(s2.segGroup) : ''; };
    var segDist = +opts.segDistance || 0;

    function calcMinDim() {
      var m = Infinity;
      T.forEach(function (t) { if (rem[t.k] > 0) m = Math.min(m, t.minDim); });
      return m === Infinity ? 0 : m;
    }
    var minDim = calcMinDim();
    spaces = E.pruneSpaces(spaces, minDim);

    // sequential groups: coldest zone first, then (delivery) the drop that is unloaded last
    var groups = [];
    T.forEach(function (t) { if (groups.indexOf(t.seqKey) < 0) groups.push(t.seqKey); });
    groups.sort(function (a, b) { return a - b; });
    var gi = 0, payloadHit = false, sequential = ctx.sequential;
    // requested quantities first; "as many as possible" items only fill what is left afterwards
    var finitePhase = T.some(function (t) { return t.qty !== Infinity; }) && T.some(function (t) { return t.qty === Infinity; });

    var noise = cfg.noise ? T.map(function () { return 1 + (rng() - 0.5) * cfg.noise; }) : null;
    function priority(t) {
      var v = obj === 'count' ? -t.vol : t.vol;
      return noise ? v * noise[t.k] : v;
    }

    function spaceCmp(a, b) {
      if (cfg.order === 'layer') return (a.z0 - b.z0) || (a.y0 - b.y0) || (a.x0 - b.x0);
      return (a.y0 - b.y0) || (a.z0 - b.z0) || (a.x0 - b.x0);
    }

    function fillEstimate(X, Y, Z, lookT, t, n) {
      if (X < minDim - EPS || Y < minDim - EPS || Z < minDim - EPS) return 0;
      var best = 0;
      for (var i = 0; i < lookT.length; i++) {
        var u = lookT[i], r = rem[u.k] - (u === t ? n : 0);
        if (r <= 0) continue;
        var unit = obj === 'count' ? 1 : u.vol;
        for (var j = 0; j < u.ors.length; j++) {
          var o = u.ors[j];
          var m = Math.floor((X + EPS) / o.w) * Math.floor((Y + EPS) / o.l) * Math.min(Math.floor((Z + EPS) / o.h), u.inZ);
          if (m > r) m = r;
          if (m * unit > best) best = m * unit;
        }
      }
      return best;
    }

    function lookahead(sx, sy, sz, bx, by, bz, t, n, lookT) {
      var top = t.noTop ? 0 : fillEstimate(bx, by, sz - bz, lookT, t, n);
      var a = fillEstimate(sx - bx, sy, sz, lookT, t, n) + fillEstimate(bx, sy - by, sz, lookT, t, n);
      var b = fillEstimate(sx, sy - by, sz, lookT, t, n) + fillEstimate(sx - bx, by, sz, lookT, t, n);
      return top + Math.max(a, b);
    }

    function cellOk(cell, weight) {
      var s = lm.supportsOf(cell);
      if (s.floor) return true;
      if (s.area / (cell.w * cell.l) < minSupport - 1e-9) return false;
      for (var n = 0; n < s.list.length; n++) {
        var i = s.list[n].i;
        if (lm.cap[i] <= 0) return false;
        if (lm.heavyBottom && weight > lm.weight[i] + 1e-6) return false;
      }
      return true;
    }

    function blocked(t, X, Y, Z, bx, by, bz) {
      for (var i = 0; i < placed.length; i++) {
        var p = placed[i];
        if ((dropOfSku[p.sku] || 1) <= t.drop) continue;
        if (p.y >= Y + by - TOPTOL && E.overlapLen(X, X + bx, p.x, p.x + p.w) > EPS &&
          E.overlapLen(Z, Z + bz, p.z, p.z + p.h) > EPS) return true;
      }
      return false;
    }

    /** Zone, segregation and access rules for a block occupying (X,Y,Z)+(bx,by,bz). */
    function rulesOk(t, X, Y, Z, bx, by, bz) {
      if (ctx.zoned) {
        var front = -Infinity;
        for (var zr = 0; zr < t.zone; zr++) front = Math.max(front, zoneMaxY1[zr]);
        if (Y < front - TOPTOL) return false;                      // warmer goods stay behind colder zones
      }
      if (ctx.hasSeg && t.seg && segDist > 0) {
        var blk = { x: X, y: Y, z: Z, w: bx, l: by, h: bz };
        for (var i = 0; i < placed.length; i++) {
          var sg = segOf(placed[i]);
          if (sg && sg !== t.seg && E.boxGap(blk, placed[i]) < segDist - 1e-6) return false;
        }
      }
      if (delivery && ctx.multiDrop && blocked(t, X, Y, Z, bx, by, bz)) return false;
      return true;
    }

    /**
     * Earliest Y (toward the door) inside space s where a floor block satisfies the zone frontier and
     * segregation distance — instead of discarding the whole space when its corner is too close.
     */
    function deeperY(t, X, Y, bx, by, bz, s) {
      var y = Y;
      for (var pass = 0; pass < 3; pass++) {
        if (ctx.zoned) for (var zr = 0; zr < t.zone; zr++) y = Math.max(y, zoneMaxY1[zr]);
        if (ctx.hasSeg && t.seg && segDist > 0) {
          var blk = { x: X, y: y, z: s.z0, w: bx, l: by, h: bz };
          for (var i = 0; i < placed.length; i++) {
            var sg = segOf(placed[i]);
            if (sg && sg !== t.seg && E.boxGap(blk, placed[i]) < segDist - 1e-6) y = Math.max(y, placed[i].y + placed[i].l + segDist);
          }
        }
      }
      return y + by <= s.y1 + EPS && y > Y + EPS ? y : null;
    }

    function tryPlaceHex(s, c) {
      var t = c.t, o = c.o, X = s.x0, nz = c.nz;
      if (opts.sideBalance !== false && st.tw > 0) {
        var Xr = s.x1 - c.bx;
        if (Xr > X + EPS) {
          var wB = c.n * t.weight;
          var cL = (st.mx + wB * (X + c.bx / 2)) / (st.tw + wB), cR = (st.mx + wB * (Xr + c.bx / 2)) / (st.tw + wB);
          if (Math.abs(cR - C.W / 2) < Math.abs(cL - C.W / 2)) X = Xr;
        }
      }
      var Y = s.y0;
      while (nz >= 1 && touchedFromAbove(t, X, Y, s.z0 + nz * o.h, c.bx, c.by)) nz--;
      if (nz < 1) return null;
      if (!rulesOk(t, X, Y, s.z0, c.bx, c.by, nz * o.h)) {
        var y2 = deeperY(t, X, Y, c.bx, c.by, nz * o.h, s);
        if (y2 == null || !rulesOk(t, X, y2, s.z0, c.bx, c.by, nz * o.h)) return null;
        Y = y2;
      }
      var r = {}; for (var k in c) r[k] = c[k];
      r.X = X; r.Y = Y; r.Z = s.z0; r.nz = nz; r.n = hexCount(c.nx, c.nOdd, c.ny, nz);
      return r;
    }

    function tryPlace(s, c) {
      if (c.hex) return tryPlaceHex(s, c);
      var o = c.o, t = c.t, nx = c.nx, ny = c.ny, nz = c.nz;
      var X = s.x0, Y = s.y0, Z = s.z0;
      if (Z > TOPTOL) {
        // shrink the block footprint to the largest fully supported rectangle at the anchor
        var lim = Infinity, bestA = 0, bnx = 0, bny = 0;
        for (var j = 0; j < ny; j++) {
          var i = 0;
          while (i < Math.min(nx, lim) && cellOk({ x: X + i * o.w, y: Y + j * o.l, z: Z, w: o.w, l: o.l }, t.weight)) i++;
          lim = Math.min(lim, i);
          if (lim === 0) break;
          if (lim * (j + 1) > bestA) { bestA = lim * (j + 1); bnx = lim; bny = j + 1; }
        }
        if (!bestA) return null;
        nx = bnx; ny = bny;
        var cells = [];
        for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) cells.push({ x: X + i * o.w, y: Y + j * o.l, z: Z, w: o.w, l: o.l, h: o.h });
        while (nz >= 1 && lm.checkColumns(cells, nz, t.weight)) nz--;
        if (nz < 1) return null;
      } else if (opts.sideBalance !== false && st.tw > 0) {
        // floor block: anchor it on the left or right edge of the space, whichever keeps the
        // lateral centre of gravity closer to the middle
        var bx0 = nx * o.w, Xr = s.x1 - bx0;
        if (Xr > X + EPS) {
          var wB = nx * ny * nz * t.weight;
          var cL = (st.mx + wB * (X + bx0 / 2)) / (st.tw + wB), cR = (st.mx + wB * (Xr + bx0 / 2)) / (st.tw + wB);
          if (Math.abs(cR - C.W / 2) < Math.abs(cL - C.W / 2)) X = Xr;
        }
      }
      while (nz >= 1 && touchedFromAbove(t, X, Y, Z + nz * o.h, nx * o.w, ny * o.l)) nz--;
      if (nz < 1) return null;
      if (!rulesOk(t, X, Y, Z, nx * o.w, ny * o.l, nz * o.h)) {
        if (Z > TOPTOL) return null;              // stacked blocks keep their support-checked anchor
        var y2 = deeperY(t, X, Y, nx * o.w, ny * o.l, nz * o.h, s);
        if (y2 == null) return null;
        while (ny > 1 && y2 + ny * o.l > s.y1 + EPS) ny--;
        if (y2 + ny * o.l > s.y1 + EPS || !rulesOk(t, X, y2, Z, nx * o.w, ny * o.l, nz * o.h)) return null;
        if (touchedFromAbove(t, X, y2, Z + nz * o.h, nx * o.w, ny * o.l)) return null;
        Y = y2;
      }
      return { t: t, o: o, X: X, Y: Y, Z: Z, nx: nx, ny: ny, nz: nz };
    }

    /**
     * Hexagonal (nested) block of upright drums on the floor: rows along x, alternate rows shifted by
     * half a diameter, row pitch d·√3/2. Only offered when it fits more drums than the square grid.
     */
    function hexCandidate(t, o, sdx, sdy, mzn, q) {
      var d = o.w, pitch = d * Math.sqrt(3) / 2;
      var nx = Math.floor((sdx + EPS) / d);
      if (nx < 1) return null;
      var nOdd = sdx + EPS >= nx * d + d / 2 ? nx : nx - 1;
      var ny = Math.floor((sdy - d + EPS) / pitch) + 1;
      if (ny < 2 || nOdd < 1) return null;
      if (hexCount(nx, nOdd, ny, 1) <= nx * Math.floor((sdy + EPS) / d)) return null;   // no gain over the grid
      var nz = mzn;
      while (nz > 1 && hexCount(nx, nOdd, ny, nz) > q) nz--;
      while (ny > 2 && hexCount(nx, nOdd, ny, nz) > q) ny--;
      if (hexCount(nx, nOdd, ny, nz) > q) return null;
      return { t: t, o: o, hex: true, nx: nx, nOdd: nOdd, ny: ny, nz: nz, pitch: pitch,
        bx: nOdd === nx ? nx * d + d / 2 : nx * d, by: d + (ny - 1) * pitch, n: hexCount(nx, nOdd, ny, nz) };
    }

    function chooseBlock(s, active, lens, lookT, free) {
      var sdx = s.x1 - s.x0, sdy = s.y1 - s.y0, sdz = s.z1 - s.z0;
      var cands = [], used = 0, seen = new Set();
      for (var ti = 0; ti < active.length && used < opts.candidateTypes; ti++) {
        var t = active[ti], fit = false;
        var q = rem[t.k];
        if (t.weight > 0) q = Math.min(q, Math.floor(free / t.weight + 1e-9));
        if (q < 1) continue;
        for (var oi = 0; oi < t.ors.length; oi++) {
          var o = t.ors[oi];
          if (o.w > sdx + EPS || o.l > sdy + EPS || o.h > sdz + EPS) continue;
          var mxn = Math.floor((sdx + EPS) / o.w), myn = Math.floor((sdy + EPS) / o.l);
          var mzn = Math.min(Math.floor((sdz + EPS) / o.h), t.inZ);
          var onFloor = s.z0 <= TOPTOL;
          if (onFloor && opts.floorLoad > 0 && t.weight > 0) {     // floor rating limits the column height
            mzn = Math.min(mzn, Math.floor(opts.floorLoad * E.footprintArea(o) / 1e4 / t.weight + 1e-9));
            if (mzn < 1) continue;
          }
          fit = true;
          if (onFloor && o.ax === 'z' && opts.hexDrums !== false) {
            var hc = hexCandidate(t, o, sdx, sdy, mzn, q);
            if (hc) {
              hc.score = hc.n * (obj === 'count' ? 1 : t.vol);
              if (cfg.look) hc.score += lookahead(sdx, sdy, sdz, hc.bx, hc.by, hc.nz * o.h, t, hc.n, lookT);
              cands.push(hc);
            }
          }
          var vx = variants(ctx, sdx, o.w, lens.x, mxn), vy = variants(ctx, sdy, o.l, lens.y, myn), vz = variants(ctx, sdz, o.h, lens.z, mzn);
          for (var a = 0; a < vx.length; a++) for (var b = 0; b < vy.length; b++) for (var d = 0; d < vz.length; d++) {
            var n3 = capQuantity(vx[a], vy[b], vz[d], q, cfg.order);
            var key = t.k + ':' + oi + ':' + n3.join(',');
            if (seen.has(key)) continue;
            seen.add(key);
            var n = n3[0] * n3[1] * n3[2];
            var score = n * (obj === 'count' ? 1 : t.vol);
            if (cfg.look) score += lookahead(sdx, sdy, sdz, n3[0] * o.w, n3[1] * o.l, n3[2] * o.h, t, n, lookT);
            cands.push({ t: t, o: o, nx: n3[0], ny: n3[1], nz: n3[2], score: score });
          }
        }
        if (fit) used++;
      }
      if (!cands.length) return null;
      cands.sort(function (p, q2) { return q2.score - p.score; });
      var thr = cands[0].score * (1 - (cfg.delta || 0)), poolN = 1;
      while (poolN < cands.length && cands[poolN].score >= thr - EPS) poolN++;
      var tries = cands.slice(0, Math.min(cands.length, poolN + 15));
      if (poolN > 1) { // GRASP: random pick inside the restricted candidate list
        var r = Math.floor(rng() * poolN), tmp = tries[0];
        tries[0] = tries[r]; tries[r] = tmp;
      }
      for (var k = 0; k < tries.length && k < 40; k++) {
        var pl = tryPlace(s, tries[k]);
        if (pl) return pl;
      }
      return null;
    }

    function commitHex(ch) {
      var o = ch.o, t = ch.t, d = o.w;
      for (var j = 0; j < ch.ny; j++) {
        var odd = j % 2 === 1, cnt = odd ? ch.nOdd : ch.nx, off = odd ? d / 2 : 0;
        for (var k = 0; k < ch.nz; k++) for (var i = 0; i < cnt; i++) {
          var p = { uid: null, sku: t.id, x: ch.X + off + i * d, y: ch.Y + j * ch.pitch, z: ch.Z + k * o.h, w: o.w, l: o.l, h: o.h, weight: t.weight, ax: 'z' };
          lm.add(p); placed.push(p); account(p, true); indexBottom(p);
        }
      }
      rem[t.k] -= ch.n;
      spaces = E.splitSpaces(spaces, { x: ch.X, y: ch.Y, z: ch.Z, w: ch.bx, l: ch.by, h: ch.nz * o.h }, minDim);
      if (rem[t.k] <= 0) {
        var m = calcMinDim();
        if (m > minDim + EPS) { minDim = m; spaces = E.pruneSpaces(spaces, minDim); }
      }
    }

    function commit(ch) {
      if (ch.hex) { commitHex(ch); return; }
      var o = ch.o, t = ch.t, n = ch.nx * ch.ny * ch.nz;
      for (var j = 0; j < ch.ny; j++) for (var k = 0; k < ch.nz; k++) for (var i = 0; i < ch.nx; i++) {
        var p = { uid: null, sku: t.id, x: ch.X + i * o.w, y: ch.Y + j * o.l, z: ch.Z + k * o.h, w: o.w, l: o.l, h: o.h, weight: t.weight };
        if (o.ax) p.ax = o.ax;
        lm.add(p);
        placed.push(p);
        account(p, true);
        indexBottom(p);
      }
      rem[t.k] -= n;
      spaces = E.splitSpaces(spaces, { x: ch.X, y: ch.Y, z: ch.Z, w: ch.nx * o.w, l: ch.ny * o.l, h: ch.nz * o.h }, minDim);
      if (rem[t.k] <= 0) {
        var m = calcMinDim();
        if (m > minDim + EPS) { minDim = m; spaces = E.pruneSpaces(spaces, minDim); }
      }
    }

    var guard = 0;
    while (spaces.length && guard++ < 50000) {
      var free = payload - st.tw, active = [];
      for (var ti = 0; ti < T.length; ti++) {
        var t = T[ti];
        if (rem[t.k] <= 0) continue;
        if (t.weight > free + 1e-9) { payloadHit = true; continue; }
        if (finitePhase && t.qty === Infinity) continue;
        if (sequential && t.seqKey !== groups[gi]) continue;
        active.push(t);
      }
      if (!active.length) {
        if (sequential && gi < groups.length - 1) { gi++; continue; }
        if (finitePhase) { finitePhase = false; gi = 0; continue; }
        break;
      }
      active.sort(function (a, b) { return priority(b) - priority(a); });
      var lens = { x: [], y: [], z: [] };
      active.forEach(function (u) { u.ors.forEach(function (o) { lens.x.push(o.w); lens.y.push(o.l); lens.z.push(o.h); }); });
      ['x', 'y', 'z'].forEach(function (ax) { lens[ax] = dedupeLens(lens[ax]); lens[ax].key = lens[ax].join(','); });
      var lookT = active.slice().sort(function (a, b) {
        return (rem[b.k] === Infinity ? 1e18 : rem[b.k] * b.vol) - (rem[a.k] === Infinity ? 1e18 : rem[a.k] * a.vol);
      }).slice(0, 6);

      spaces.sort(spaceCmp);
      var choice = null, keep = [];
      for (var si = 0; si < spaces.length; si++) {
        if (!choice) {
          choice = chooseBlock(spaces[si], active, lens, lookT, free);
          if (!choice && !sequential && !finitePhase) continue; // nothing will ever fit here again → drop the space
        }
        keep.push(spaces[si]);
      }
      spaces = keep;
      if (!choice) {
        if (sequential && gi < groups.length - 1) { gi++; continue; }
        if (finitePhase) { finitePhase = false; gi = 0; continue; }
        break;
      }
      commit(choice);
    }
    var remainingWeightLimited = T.some(function (u) { return rem[u.k] > 0 && u.weight > payload - st.tw + 1e-9; });
    return { placed: placed, rem: rem, st: st, payloadHit: payloadHit && remainingWeightLimited, cfg: cfg };
  }

  function solKey(ctx, sol) {
    var st = sol.st, dev = E.cogDeviation(ctx.C, st.tw, st.mx, st.my), key;
    switch (ctx.opts.objective) {
      case 'count': key = [st.count, st.vol, -dev]; break;
      // balance: volume in 0.5 % buckets of the container, then the best centre of gravity
      case 'balance': key = [Math.floor(st.vol / (0.005 * ctx.C.W * ctx.C.L * ctx.C.H) + 1e-9), -dev, st.vol]; break;
      default: key = [st.vol, st.count, -dev];
    }
    // vehicles: a layout that can be kept within the axle limits always wins (overload in 50 kg steps)
    if (ctx.opts.axle) {
      var ax = axleEval(ctx, sol.placed, !ctx.fixed.length);
      sol.axle = ax;
      key.unshift(ax ? -Math.ceil(ax.over / 50) : 0);
    }
    return key;
  }

  /** Physically feasible loading order: supports first, then front→door, bottom→top, left→right. */
  E.loadSequence = function (placements, specs) {
    var n = placements.length, lm = new E.LoadModel(specs, {});
    var order = placements.map(function (p, i) { return i; }).sort(function (a, b) { return placements[a].z - placements[b].z; });
    var lmToP = [], deps = new Array(n), kids = [], indeg = new Array(n);
    for (var i = 0; i < n; i++) kids.push([]);
    order.forEach(function (pi) {
      var s = lm.supportsOf(placements[pi]);
      var li = lm.add(placements[pi], s);
      lmToP[li] = pi;
      deps[pi] = s.list.map(function (e) { return lmToP[e.i]; });
    });
    for (i = 0; i < n; i++) { indeg[i] = deps[i].length; deps[i].forEach(function (d) { kids[d].push(i); }); }
    function less(a, b) {
      var A = placements[a], B = placements[b];
      return (Math.round(A.y) - Math.round(B.y)) || (A.z - B.z) || (A.x - B.x);
    }
    var heap = [];
    function push(v) {
      heap.push(v);
      var c = heap.length - 1;
      while (c > 0) { var p = (c - 1) >> 1; if (less(heap[c], heap[p]) >= 0) break; var t = heap[c]; heap[c] = heap[p]; heap[p] = t; c = p; }
    }
    function pop() {
      var top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        var c = 0;
        for (;;) {
          var l = 2 * c + 1, r = l + 1, m = c;
          if (l < heap.length && less(heap[l], heap[m]) < 0) m = l;
          if (r < heap.length && less(heap[r], heap[m]) < 0) m = r;
          if (m === c) break;
          var t = heap[c]; heap[c] = heap[m]; heap[m] = t; c = m;
        }
      }
      return top;
    }
    for (i = 0; i < n; i++) if (!indeg[i]) push(i);
    var seq = [];
    while (heap.length) {
      var v = pop();
      seq.push(v);
      kids[v].forEach(function (k) { if (--indeg[k] === 0) push(k); });
    }
    return seq;
  };

  var runCounter = 0;
  function finalize(ctx, best, iter, ms) {
    var C = ctx.C, run = (++runCounter).toString(36) + Date.now().toString(36).slice(-4);
    var placements = best.placed;
    var shifted = false;
    if (ctx.opts.objective === 'balance' && !ctx.fixed.length && placements.length) {
      // centre the whole load (rigid translation keeps every constraint valid)
      var st = best.st, minX = Infinity, maxX = 0, minY = Infinity, maxY = 0;
      placements.forEach(function (p) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + p.w);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + p.l);
      });
      var dy = Math.max(-minY, Math.min(C.L - maxY, C.L / 2 - st.my / st.tw));
      var dx = Math.max(-minX, Math.min(C.W - maxX, C.W / 2 - st.mx / st.tw));
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        shifted = true;
        placements.forEach(function (p) { p.x += dx; p.y += dy; });
      }
    }
    // keep axle groups within their limits by sliding the whole load along the length if possible
    var axleShift = 0;
    if (ctx.opts.axle && !ctx.fixed.length && placements.length) {
      var ae = axleEval(ctx, placements, true);
      if (ae && Math.abs(ae.dy) > 0.5 && ae.over < ae.over0 - 1) {
        axleShift = ae.dy;
        placements.forEach(function (p) { p.y += ae.dy; });
      }
    }
    var seq = E.loadSequence(placements, ctx.specs);
    var out = seq.map(function (pi, i) {
      var p = placements[pi];
      if (!p.uid) p.uid = 'a' + run + '_' + i;
      p.seq = i + 1;
      return p;
    });
    var unplaced = [];
    ctx.types.forEach(function (t) {
      var r = best.rem[t.k];
      if (r > 0 && r !== Infinity) unplaced.push({ id: t.id, qty: r });
    });
    ctx.doorBlocked.forEach(function (d) { unplaced.push({ id: d.id, qty: d.qty, reason: 'door' }); });
    var warnings = [];
    if (ctx.doorBlocked.length) warnings.push({ code: 'doorTooSmall', severity: 'error', params: { n: ctx.doorBlocked.reduce(function (s, d) { return s + d.qty; }, 0), skus: ctx.doorBlocked.map(function (d) { return (ctx.specs[d.id] || {}).sku || d.id; }).join(', ') } });
    if (best.payloadHit) warnings.push({ code: 'payloadReached', severity: 'error', params: { max: +C.maxPayload } });
    if (unplaced.length) warnings.push({ code: 'unplaced', severity: 'warning', params: { n: unplaced.reduce(function (s, u) { return s + u.qty; }, 0) } });
    if (shifted) warnings.push({ code: 'centered', severity: 'info', params: {} });
    if (axleShift) warnings.push({ code: 'axleShift', severity: 'info', params: { dy: Math.abs(axleShift), dir: axleShift > 0 ? 'door' : 'front' } });
    return {
      placements: out, unplaced: unplaced, payloadHit: best.payloadHit, warnings: warnings,
      iterations: iter, timeMs: Math.round(ms), objective: ctx.opts.objective, cfg: best.cfg
    };
  }

  /**
   * Auto-pack cargo into container C.
   * C: {W,L,H,maxPayload} in cm/kg. cargo: [{id,w,l,h,weight,qty,maxMode,rotation,stackable,maxStack,maxLoad,fragile,pkg,dropOrder}]
   */
  E.pack = function (C, cargo, options) {
    var opts = {}, k;
    for (k in E.DEFAULT_OPTIONS) opts[k] = E.DEFAULT_OPTIONS[k];
    for (k in (options || {})) if (options[k] !== undefined) opts[k] = options[k];
    var t0 = now();
    var ctx = prepare(C, cargo, opts);
    var rng = rng32(opts.seed || 1);
    var delivery = opts.objective === 'delivery';
    var base = [
      { order: 'wall', delta: 0, look: true }, { order: 'layer', delta: 0, look: true },
      { order: 'wall', delta: 0, look: false }, { order: 'layer', delta: 0, look: false }
    ].filter(function (c) { return !delivery || c.order === 'wall'; });
    var best = null, bestKey = null, iter = 0;
    for (;;) {
      var cfg = iter < base.length ? base[iter] : {
        order: delivery ? 'wall' : (rng() < 0.5 ? 'wall' : 'layer'),
        delta: 0.02 + rng() * 0.3, look: rng() < 0.85, noise: rng() < 0.5 ? 0.4 : 0
      };
      var sol = packOnce(ctx, cfg, rng);
      var key = solKey(ctx, sol);
      if (!best || cmpKey(key, bestKey) > 0) { best = sol; bestKey = key; }
      iter++;
      var elapsed = now() - t0;
      if (opts.onProgress) opts.onProgress({ iter: iter, placed: best.st.count, elapsed: elapsed });
      if (!ctx.types.length) break;
      var allIn = best.rem.every(function (r) { return r === 0; });
      // everything fits: keep searching a little for a better-balanced layout, then stop
      var extra = opts.objective === 'balance' ? 150 : 30;
      if (allIn && (iter >= base.length + extra || elapsed > opts.timeLimit * (opts.objective === 'balance' ? 0.8 : 0.4))) break;
      if (elapsed > opts.timeLimit || iter >= opts.maxIter) break;
      if (elapsed / iter * (iter + 1) > opts.timeLimit * 1.2) break; // next run would blow the budget
    }
    return finalize(ctx, best, iter, now() - t0);
  };

  /** First feasible position (front→door, bottom→top) for one item — used by manual "add". */
  E.findSpot = function (C, placements, spec, opts) {
    opts = opts || {};
    var lm = new E.LoadModel(opts.specs || {}, opts);
    placements.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (p) { lm.add(p); });
    var pts = [{ x: 0, y: 0, z: 0 }];
    placements.forEach(function (p) {
      pts.push({ x: p.x + p.w, y: p.y, z: p.z }, { x: p.x, y: p.y + p.l, z: p.z }, { x: p.x, y: p.y, z: p.z + p.h },
        { x: 0, y: p.y + p.l, z: 0 }, { x: p.x + p.w, y: 0, z: 0 });
    });
    pts.sort(function (a, b) { return (a.y - b.y) || (a.z - b.z) || (a.x - b.x); });
    var ors = E.doorOrientations(spec, C);
    var minSupport = opts.minSupport != null ? opts.minSupport : 0.75;
    for (var i = 0; i < pts.length; i++) {
      for (var j = 0; j < ors.length; j++) {
        var o = ors[j];
        var b = { x: pts[i].x, y: pts[i].y, z: pts[i].z, w: o.w, l: o.l, h: o.h };
        if (!E.insideContainer(b, C)) continue;
        var hit = false;
        for (var k = 0; k < placements.length && !hit; k++) if (E.intersects(b, placements[k])) hit = true;
        if (hit) continue;
        if (b.z > TOPTOL) {
          var s = lm.supportsOf(b);
          if (s.area / (b.w * b.l) < minSupport) continue;
          if (s.list.some(function (e) { return lm.cap[e.i] <= 0; })) continue;
        }
        if (o.ax) b.ax = o.ax;
        return b;
      }
    }
    return null;
  };
});
if (typeof module !== 'undefined' && module.exports) module.exports = LPEngineParts;
