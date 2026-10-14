/* Container & Truck Load Planner — engine/multi.js
 * Multi-container planning, container-size suggestion and option comparison.
 */
var LPEngineParts = (typeof LPEngineParts !== 'undefined') ? LPEngineParts : [];
LPEngineParts.push(function multi(E) {
  'use strict';

  function cloneOpts(opts, extra) {
    var o = {}, k;
    for (k in opts) if (k !== 'onProgress') o[k] = opts[k];
    for (k in extra) o[k] = extra[k];
    return o;
  }

  function requested(cargo) {
    return cargo.filter(function (c) { return !c.maxMode && +c.qty > 0; });
  }

  /** Pack all (non "max") cargo into as many containers of type C as needed. */
  E.packMulti = function (C, cargo, opts, maxContainers) {
    maxContainers = maxContainers || 20;
    var left = requested(cargo).map(function (c) { var d = {}; for (var k in c) d[k] = c[k]; return d; });
    var loads = [];
    while (left.length && loads.length < maxContainers) {
      var res = E.pack(C, left, cloneOpts(opts || {}, { fixed: [], timeLimit: (opts && opts.multiTimeLimit) || 400 }));
      if (!res.placements.length) break;
      var by = {}, w = 0, v = 0;
      res.placements.forEach(function (p) { by[p.sku] = (by[p.sku] || 0) + 1; w += +p.weight || 0; v += p.w * p.l * p.h; });
      loads.push({ count: res.placements.length, weight: w, volUtil: v / (C.W * C.L * C.H) * 100, bySku: by, placements: res.placements });
      left = left.map(function (c) { c.qty = c.qty - (by[c.id] || 0); return c; }).filter(function (c) { return c.qty > 0; });
    }
    return {
      containers: loads.length,
      complete: left.length === 0,
      loads: loads,
      leftover: left.map(function (c) { return { id: c.id, qty: c.qty }; })
    };
  };

  /** Totals of the requested cargo. */
  E.cargoTotals = function (cargo) {
    var t = { count: 0, weight: 0, volume: 0 };
    requested(cargo).forEach(function (c) {
      t.count += +c.qty; t.weight += c.qty * (+c.weight || 0); t.volume += c.qty * c.w * c.l * c.h;
    });
    return t;
  };

  /** Find presets that can take ALL requested cargo in a single load, smallest first. */
  E.suggestContainers = function (presets, cargo, opts) {
    var tot = E.cargoTotals(cargo), out = [];
    presets.forEach(function (P) {
      var C = { W: P.W, L: P.L, H: P.H, maxPayload: P.maxPayload, doorW: P.doorW, doorH: P.doorH };
      var vol = C.W * C.L * C.H;
      if (tot.volume > vol * 0.98 || (C.maxPayload && tot.weight > C.maxPayload)) return;
      var res = E.pack(C, requested(cargo), cloneOpts(opts || {}, { fixed: [], timeLimit: 300 }));
      if (!res.unplaced.length) out.push({ id: P.id, name: P.name, volUtil: tot.volume / vol * 100, payloadPct: C.maxPayload ? tot.weight / C.maxPayload * 100 : 0, volume: vol });
    });
    out.sort(function (a, b) { return a.volume - b.volume; });
    return out;
  };

  /**
   * Cheapest mix of vehicle/container types for all requested cargo (greedy):
   *  - if some type can take everything that is left, take the cheapest such type and stop;
   *  - otherwise add the type with the best (packed volume ÷ cost) and continue with the rest.
   * Missing costs are replaced by the box volume (m³) as a proxy, so the result then minimises space.
   * Also evaluates every single-type plan and returns whichever is cheaper.
   */
  E.fleetPlan = function (presets, cargo, opts, maxUnits) {
    maxUnits = maxUnits || 25;
    var useProxy = !presets.some(function (P) { return +P.cost > 0; });
    function costOf(P) { return useProxy ? P.W * P.L * P.H / 1e6 : (+P.cost > 0 ? +P.cost : Infinity); }
    function boxOf(P) { return { W: P.W, L: P.L, H: P.H, maxPayload: P.maxPayload, doorW: P.doorW, doorH: P.doorH, floorLoad: P.floorLoad }; }
    var tl = (opts && opts.fleetTimeLimit) || 250;
    function packIn(P, list) { return E.pack(boxOf(P), list, cloneOpts(opts || {}, { fixed: [], timeLimit: tl, floorLoad: +P.floorLoad || 0 })); }
    function remove(list, placements) {
      var by = {};
      placements.forEach(function (p) { by[p.sku] = (by[p.sku] || 0) + 1; });
      return list.map(function (c) { var d = {}; for (var k in c) d[k] = c[k]; d.qty = c.qty - (by[c.id] || 0); return d; }).filter(function (c) { return c.qty > 0; });
    }
    function unit(P, res) {
      var w = 0, v = 0;
      res.placements.forEach(function (p) { w += +p.weight || 0; v += E.solidVolume(p); });
      return { presetId: P.id, name: P.name, count: res.placements.length, weight: w, volUtil: v / (P.W * P.L * P.H) * 100, cost: +P.cost || 0, costUnit: costOf(P), placements: res.placements, preset: P };
    }
    var usable = presets.filter(function (P) { return costOf(P) < Infinity; });
    // greedy mix
    var left = requested(cargo).map(function (c) { var d = {}; for (var k in c) d[k] = c[k]; return d; }), units = [];
    while (left.length && units.length < maxUnits) {
      var trials = usable.map(function (P) { var r = packIn(P, left); return { P: P, r: r }; }).filter(function (x) { return x.r.placements.length; });
      if (!trials.length) break;
      var full = trials.filter(function (x) { return !x.r.unplaced.length; }).sort(function (a, b) { return costOf(a.P) - costOf(b.P); });
      var pick = full[0] || trials.sort(function (a, b) {
        var va = a.r.placements.reduce(function (s, p) { return s + E.solidVolume(p); }, 0) / costOf(a.P);
        var vb = b.r.placements.reduce(function (s, p) { return s + E.solidVolume(p); }, 0) / costOf(b.P);
        return vb - va;
      })[0];
      units.push(unit(pick.P, pick.r));
      left = remove(left, pick.r.placements);
    }
    var mix = { units: units, complete: !left.length, leftover: left.map(function (c) { return { id: c.id, qty: c.qty }; }) };
    mix.total = units.reduce(function (s, u) { return s + u.costUnit; }, 0);
    // single-type alternatives
    var singles = usable.map(function (P) {
      var m = E.packMulti(boxOf(P), cargo, cloneOpts(opts || {}, { multiTimeLimit: tl, floorLoad: +P.floorLoad || 0 }), maxUnits);
      return { P: P, m: m, total: m.containers * costOf(P) };
    }).filter(function (s) { return s.m.complete; }).sort(function (a, b) { return a.total - b.total; });
    var bestSingle = singles[0] || null;
    var result = mix;
    if (bestSingle && (!mix.complete || bestSingle.total < mix.total - 1e-6)) {
      result = {
        units: bestSingle.m.loads.map(function (l) { return { presetId: bestSingle.P.id, name: bestSingle.P.name, count: l.count, weight: l.weight, volUtil: l.volUtil, cost: +bestSingle.P.cost || 0, costUnit: costOf(bestSingle.P), placements: l.placements, preset: bestSingle.P }; }),
        complete: true, leftover: [], total: bestSingle.total, single: true
      };
    }
    // group summary: type → count
    var groups = {};
    result.units.forEach(function (u) { (groups[u.presetId] = groups[u.presetId] || { name: u.name, n: 0, cost: u.cost }).n++; });
    result.summary = Object.keys(groups).map(function (k) { return { presetId: k, name: groups[k].name, n: groups[k].n, cost: groups[k].cost }; });
    result.costProxy = useProxy;
    result.bestSingle = bestSingle ? { presetId: bestSingle.P.id, name: bestSingle.P.name, units: bestSingle.m.containers, total: bestSingle.total } : null;
    result.mixTotal = mix.complete ? mix.total : null;
    return result;
  };

  /** Compare several container/vehicle options for the same cargo.
   *  opts.baseline = { <presetId>: placements } — an existing valid plan for that option (the one on screen);
   *  used when it beats the quick compare pack, so Compare never reports worse than the main Auto Pack. */
  E.compare = function (presets, cargo, opts) {
    opts = opts || {};
    var tot = E.cargoTotals(cargo);
    function unplacedOf(placements) {
      var have = {};
      placements.forEach(function (p) { have[p.sku] = (have[p.sku] || 0) + 1; });
      return cargo.filter(function (c) { return !c.maxMode && (have[c.id] || 0) < c.qty; })
        .map(function (c) { return { id: c.id, qty: c.qty - (have[c.id] || 0) }; });
    }
    var rows = presets.map(function (P) {
      var C = { W: P.W, L: P.L, H: P.H, maxPayload: P.maxPayload, doorW: P.doorW, doorH: P.doorH, floorLoad: P.floorLoad };
      var po = cloneOpts(opts, { fixed: [], baseline: null, timeLimit: opts.compareTimeLimit || 800, floorLoad: +P.floorLoad || 0 });
      var single = E.pack(C, cargo, po);
      var base = opts.baseline && opts.baseline[P.id];
      if (base && base.length > single.placements.length) single = { placements: base, unplaced: unplacedOf(base), timeMs: single.timeMs };
      var st = E.computeStats(C, single.placements, cargo);
      var m = single.unplaced.length ? E.packMulti(C, cargo, po, 30) : { containers: tot.count ? 1 : 0, complete: true };
      var cost = +P.cost || 0;
      return {
        id: P.id, name: P.name, W: P.W, L: P.L, H: P.H, maxPayload: P.maxPayload,
        placed: single.placements.length, unplaced: single.unplaced.reduce(function (s, u) { return s + u.qty; }, 0),
        volUtil: st.volUtil, floorUtil: st.floorUtil, payloadPct: st.payloadPct, weight: st.weight,
        containersNeeded: m.containers, complete: m.complete,
        totalCost: cost ? cost * m.containers : null,
        costPerItem: cost && tot.count ? cost * m.containers / tot.count : null,
        timeMs: single.timeMs
      };
    });
    // best: fewest vehicles, then lowest cost, then highest utilisation
    var best = rows.slice().sort(function (a, b) {
      return (b.complete - a.complete) || (a.containersNeeded - b.containersNeeded) ||
        ((a.totalCost == null ? Infinity : a.totalCost) - (b.totalCost == null ? Infinity : b.totalCost)) ||
        (b.volUtil - a.volUtil);
    })[0];
    if (rows.some(function (r) { return r.totalCost != null; })) {
      best = rows.slice().sort(function (a, b) {
        return (b.complete - a.complete) || ((a.totalCost == null ? Infinity : a.totalCost) - (b.totalCost == null ? Infinity : b.totalCost)) ||
          (a.containersNeeded - b.containersNeeded);
      })[0];
    }
    return { rows: rows, bestId: best ? best.id : null, totals: tot };
  };
});
if (typeof module !== 'undefined' && module.exports) module.exports = LPEngineParts;
