/* Container & Truck Load Planner — engine/constraints.js
 * Support / stacking / load-bearing model + full layout validation (collision, bounds,
 * floating, fragile, stack limit, load limit, payload, delivery-order access).
 */
var LPEngineParts = (typeof LPEngineParts !== 'undefined') ? LPEngineParts : [];
LPEngineParts.push(function constraints(E) {
  'use strict';
  var EPS = E.EPS, TOPTOL = E.TOPTOL;

  /** cap = max kg allowed on top (0 = nothing on top), maxStack = max tiers in a stack incl. itself */
  E.capsOf = function (spec) {
    spec = spec || {};
    var noTop = !!spec.fragile || spec.stackable === false;
    return {
      cap: noTop ? 0 : (spec.maxLoad > 0 ? +spec.maxLoad : Infinity),
      maxStack: noTop ? 1 : (spec.maxStack > 0 ? +spec.maxStack : Infinity)
    };
  };

  function topKey(z) { return Math.round(z * 10); }

  /**
   * Incremental physical model of a stack of boxes. Boxes must be added bottom-up
   * (anything a box rests on must already be in the model).
   */
  function LoadModel(specs, opts) {
    opts = opts || {};
    this.specs = specs || {};
    this.minSupport = opts.minSupport != null ? opts.minSupport : 0.75;
    this.heavyBottom = opts.heavyBottom !== false;
    this.floorLoad = +opts.floorLoad || 0;   // kg/m² allowed on the floor (0 = not checked)
    this.items = []; this.sup = []; this.load = []; this.tier = [];
    this.effCap = []; this.cap = []; this.weight = [];
    this.tops = new Map();
  }
  E.LoadModel = LoadModel;

  /** Boxes whose top face touches the bottom face of b, with contact areas. */
  LoadModel.prototype.supportsOf = function (b) {
    var res = { area: 0, list: [], floor: false };
    if (b.z <= TOPTOL) { res.floor = true; res.area = b.w * b.l; return res; }
    var k = topKey(b.z);
    for (var d = -1; d <= 1; d++) {
      var arr = this.tops.get(k + d);
      if (!arr) continue;
      for (var n = 0; n < arr.length; n++) {
        var j = arr[n], p = this.items[j];
        if (Math.abs(p.z + p.h - b.z) > TOPTOL) continue;
        var a = E.footprintOverlap(p, b);
        if (a > EPS) { res.area += a; res.list.push({ i: j, a: a }); }
      }
    }
    return res;
  };

  LoadModel.prototype.supportRatio = function (b, s) {
    s = s || this.supportsOf(b);
    return s.floor ? 1 : Math.min(1, s.area / (b.w * b.l));
  };

  /** Push weight w down through support list (fractions f), accumulating into target (array or Map). */
  LoadModel.prototype._spread = function (list, w, target) {
    var stack = [];
    for (var n = 0; n < list.length; n++) stack.push(list[n].i, w * list[n].f);
    while (stack.length) {
      var ww = stack.pop(), i = stack.pop();
      if (target instanceof Map) target.set(i, (target.get(i) || 0) + ww);
      else target[i] += ww;
      var sl = this.sup[i];
      for (var m = 0; m < sl.length; m++) stack.push(sl[m].i, ww * sl[m].f);
    }
  };

  function withFractions(s) {
    var tot = 0, n;
    for (n = 0; n < s.list.length; n++) tot += s.list[n].a;
    for (n = 0; n < s.list.length; n++) s.list[n].f = tot > 0 ? s.list[n].a / tot : 0;
    return s.list;
  }

  /** Commit a box (no checks). Returns its index. */
  LoadModel.prototype.add = function (b, s) {
    var spec = this.specs[b.sku] || {};
    var caps = E.capsOf(spec);
    s = s || this.supportsOf(b);
    var list = withFractions(s);
    var tier = 1, eff = Infinity, n;
    for (n = 0; n < list.length; n++) {
      tier = Math.max(tier, this.tier[list[n].i] + 1);
      eff = Math.min(eff, this.effCap[list[n].i]);
    }
    var idx = this.items.length;
    var cap = caps.cap;
    // an item on the floor may carry only what the floor rating leaves over its footprint
    if (s.floor && this.floorLoad > 0) cap = Math.min(cap, Math.max(0, this.floorLoad * E.footprintArea(b) / 1e4 - (+b.weight || 0)));
    this.items.push(b);
    this.sup.push(list);
    this.load.push(0);
    this.tier.push(tier);
    this.effCap.push(Math.min(eff, tier + caps.maxStack - 1));
    this.cap.push(cap);
    this.weight.push(+b.weight || 0);
    var k = topKey(b.z + b.h);
    var arr = this.tops.get(k);
    if (!arr) this.tops.set(k, arr = []);
    arr.push(idx);
    if (b.weight > 0 && list.length) this._spread(list, +b.weight, this.load);
    return idx;
  };

  /**
   * Check whether a block of identical columns can be placed. cells = bottom boxes of each column,
   * nz = items per column, weight = weight per item. Returns null if OK, otherwise a reason code.
   * Optionally returns per-cell support info in out.supports.
   */
  LoadModel.prototype.checkColumns = function (cells, nz, weight, out) {
    var tmp = new Map(), supports = [];
    for (var c = 0; c < cells.length; c++) {
      var b = cells[c], s = this.supportsOf(b);
      supports.push(s);
      if (s.floor) {
        if (this.floorLoad > 0 && nz * weight > this.floorLoad * E.footprintArea(b) / 1e4 + 1e-6) return 'floor';
        continue;
      }
      if (s.area / (b.w * b.l) < this.minSupport - 1e-9) return 'floating';
      var list = withFractions(s), tier = 1, n;
      for (n = 0; n < list.length; n++) {
        var i = list[n].i;
        if (this.cap[i] <= 0) return 'noTop';
        if (this.heavyBottom && weight > this.weight[i] + 1e-6) return 'heavy';
        tier = Math.max(tier, this.tier[i] + 1);
      }
      var topTier = tier + nz - 1;
      for (n = 0; n < list.length; n++) if (this.effCap[list[n].i] < topTier) return 'stack';
      if (weight > 0) this._spread(list, nz * weight, tmp);
    }
    var bad = null, self = this;
    tmp.forEach(function (w, i) { if (!bad && self.load[i] + w > self.cap[i] + 1e-6) bad = 'load'; });
    if (bad) return bad;
    if (out) out.supports = supports;
    return null;
  };

  function code(map, uid, c) { (map[uid] || (map[uid] = [])).indexOf(c) < 0 && map[uid].push(c); }

  /**
   * Validate an arbitrary layout (auto or manual).
   * Returns { flags: {uid:[codes]}, issues:[{code,severity,uids,params}], totalWeight, tiers:{uid:tier}, loads:{uid:kg} }
   */
  E.validate = function (C, placements, specs, opts) {
    opts = opts || {};
    var flags = {}, issues = [];
    var minSupport = opts.minSupport != null ? opts.minSupport : 0.75;
    var lm = new LoadModel(specs, { minSupport: opts.minSupport, heavyBottom: opts.heavyBottom });  // floor rating checked below
    var order = placements.map(function (p, i) { return i; });
    order.sort(function (a, b) { return placements[a].z - placements[b].z || placements[a].y - placements[b].y; });
    var idxOf = {}, totalWeight = 0;
    var tally = {};
    function flag(p, c) { code(flags, p.uid, c); (tally[c] || (tally[c] = [])).push(p.uid); }

    order.forEach(function (oi) {
      var p = placements[oi];
      totalWeight += +p.weight || 0;
      if (!E.insideContainer(p, C)) flag(p, 'outOfBounds');
      if (!E.fitsDoor(p.w, p.h, C)) flag(p, 'doorClear');
      var s = lm.supportsOf(p);
      if (!s.floor && lm.supportRatio(p, s) < minSupport - 1e-9) flag(p, 'floating');
      var tier = 1;
      for (var n = 0; n < s.list.length; n++) {
        var q = lm.items[s.list[n].i];
        tier = Math.max(tier, lm.tier[s.list[n].i] + 1);
        if (lm.cap[s.list[n].i] <= 0) { flag(q, 'fragileLoaded'); flag(p, 'onNoStack'); }
        if (lm.heavyBottom && (+p.weight || 0) > lm.weight[s.list[n].i] + 1e-6) flag(p, 'heavyOnLight');
      }
      for (n = 0; n < s.list.length; n++) if (lm.effCap[s.list[n].i] < tier) flag(p, 'stackLimit');
      idxOf[p.uid] = lm.add(p, s);
    });

    var loads = {}, tiers = {}, floorLoad = +(opts.floorLoad != null ? opts.floorLoad : C.floorLoad) || 0;
    lm.items.forEach(function (p, i) {
      loads[p.uid] = lm.load[i];
      tiers[p.uid] = lm.tier[i];
      if (lm.cap[i] > 0 && lm.load[i] > lm.cap[i] + 1e-6) flag(p, 'overload');
      if (floorLoad > 0 && p.z <= TOPTOL && (lm.load[i] + (+p.weight || 0)) > floorLoad * E.footprintArea(p) / 1e4 + 1e-6) flag(p, 'floorOverload');
    });

    // segregation groups (e.g. DG classes, food vs chemicals) must keep a minimum distance
    var segDist = +(opts.segDistance != null ? opts.segDistance : 150);
    var seg = placements.filter(function (p) { return specs[p.sku] && specs[p.sku].segGroup; });
    for (var si = 0; si < seg.length; si++) for (var sj = si + 1; sj < seg.length; sj++) {
      var A = seg[si], B = seg[sj];
      if (specs[A.sku].segGroup === specs[B.sku].segGroup) continue;
      if (E.boxGap(A, B) < segDist - 1e-6) { flag(A, 'segregation'); flag(B, 'segregation'); }
    }
    // temperature zones: colder goods nearer the front (refrigeration unit), warmer zones behind them
    var zoned = placements.some(function (p) { return specs[p.sku] && specs[p.sku].tempZone; });
    if (zoned) {
      placements.forEach(function (a) {
        var ra = E.zoneRank(specs[a.sku]);
        for (var k = 0; k < placements.length; k++) {
          var b = placements[k];
          if (E.zoneRank(specs[b.sku]) < ra && a.y < b.y + b.l - TOPTOL) { flag(a, 'tempZone'); return; }
        }
      });
    }

    // collisions — sort & sweep on x
    var byX = placements.slice().sort(function (a, b) { return a.x - b.x; });
    var active = [];
    for (var i = 0; i < byX.length; i++) {
      var a = byX[i];
      active = active.filter(function (b) { return b.x + b.w > a.x + EPS; });
      for (var j = 0; j < active.length; j++) {
        if (E.intersects(a, active[j])) { flag(a, 'collision'); flag(active[j], 'collision'); }
      }
      active.push(a);
    }

    // delivery-order access: an item that is unloaded earlier (smaller dropOrder) must not be
    // blocked toward the door by an item unloaded later.
    var drops = {};
    placements.forEach(function (p) { drops[p.uid] = (specs[p.sku] && +specs[p.sku].dropOrder) || 1; });
    var multi = Object.keys(drops).some(function (u) { return drops[u] !== drops[placements[0].uid]; });
    if (multi) {
      placements.forEach(function (a) {
        for (var k = 0; k < placements.length; k++) {
          var b = placements[k];
          if (drops[b.uid] <= drops[a.uid]) continue;
          if (b.y >= a.y + a.l - TOPTOL && E.overlapLen(a.x, a.x + a.w, b.x, b.x + b.w) > EPS &&
            E.overlapLen(a.z, a.z + a.h, b.z, b.z + b.h) > EPS) { flag(a, 'deliveryBlocked'); return; }
        }
      });
    }

    var severity = {
      outOfBounds: 'error', doorClear: 'error', collision: 'error', floating: 'error', fragileLoaded: 'error', onNoStack: 'error',
      overload: 'error', stackLimit: 'error', heavyOnLight: 'warning', deliveryBlocked: 'warning',
      floorOverload: 'error', segregation: 'error', tempZone: 'error'
    };
    Object.keys(tally).forEach(function (c) {
      issues.push({ code: c, severity: severity[c] || 'warning', uids: tally[c], params: { n: tally[c].length } });
    });
    var payload = +C.maxPayload || Infinity;
    if (totalWeight > payload + 1e-6) {
      issues.push({ code: 'overweight', severity: 'error', uids: [], params: { weight: totalWeight, max: payload, over: totalWeight - payload } });
    }
    issues.sort(function (a, b) { return (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1); });
    return { flags: flags, issues: issues, totalWeight: totalWeight, tiers: tiers, loads: loads };
  };

  /** Fast check for a single moved box during drag: bounds + collisions only. */
  E.quickCheck = function (C, box, others) {
    if (!E.insideContainer(box, C)) return 'outOfBounds';
    for (var i = 0; i < others.length; i++) {
      if (others[i].uid !== box.uid && E.intersects(box, others[i])) return 'collision';
    }
    return null;
  };

  /** Lowest z at which box (x,y,w,l fixed) can rest without intersecting others (gravity drop). */
  E.dropZ = function (box, others, fromZ) {
    var z = 0, top = fromZ != null ? fromZ : Infinity;
    for (var i = 0; i < others.length; i++) {
      var o = others[i];
      if (o.uid === box.uid) continue;
      if (E.footprintOverlap(o, box) <= EPS) continue;
      var t = o.z + o.h;
      if (t <= top + TOPTOL && t > z) z = t;
    }
    return z;
  };
});
if (typeof module !== 'undefined' && module.exports) module.exports = LPEngineParts;
