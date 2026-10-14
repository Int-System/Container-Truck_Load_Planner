/* Container & Truck Load Planner — engine/cog.js
 * Load statistics: totals, utilisation, centre of gravity, left/right & front/rear balance.
 */
var LPEngineParts = (typeof LPEngineParts !== 'undefined') ? LPEngineParts : [];
LPEngineParts.push(function cog(E) {
  'use strict';
  var TOPTOL = E.TOPTOL;

  E.BALANCE_LIMITS = { lateral: 0.05, longitudinal: 0.10, height: 0.5 };

  E.computeStats = function (C, placements, cargo) {
    var bySku = {}, tw = 0, vol = 0, floor = 0, mx = 0, my = 0, mz = 0, left = 0, front = 0;
    var W = C.W, L = C.L, H = C.H;
    placements.forEach(function (p) {
      var w = +p.weight || 0;
      bySku[p.sku] = (bySku[p.sku] || 0) + 1;
      tw += w;
      vol += E.solidVolume(p);
      if (p.z <= TOPTOL) floor += E.footprintArea(p);
      mx += w * (p.x + p.w / 2);
      my += w * (p.y + p.l / 2);
      mz += w * (p.z + p.h / 2);
      left += w * Math.max(0, Math.min(1, (W / 2 - p.x) / p.w));
      front += w * Math.max(0, Math.min(1, (L / 2 - p.y) / p.l));
    });
    var payload = +C.maxPayload || 0;
    var cogP = tw > 0 ? { x: mx / tw, y: my / tw, z: mz / tw } : { x: W / 2, y: L / 2, z: 0 };
    var st = {
      count: placements.length,
      bySku: bySku,
      weight: tw,
      payload: payload,
      remainingPayload: payload ? payload - tw : Infinity,
      payloadPct: payload ? tw / payload * 100 : 0,
      volume: vol,
      containerVolume: W * L * H,
      volUtil: vol / (W * L * H) * 100,
      floorUtil: floor / (W * L) * 100,
      usedLength: placements.reduce(function (m, p) { return Math.max(m, p.y + p.l); }, 0),
      cog: cogP,
      // offsets from geometric centre, as % of the dimension (+x = right side, +y = toward door)
      cogOffset: { x: (cogP.x - W / 2) / W * 100, y: (cogP.y - L / 2) / L * 100, zPct: cogP.z / H * 100 },
      leftPct: tw ? left / tw * 100 : 50,
      rightPct: tw ? 100 - left / tw * 100 : 50,
      frontPct: tw ? front / tw * 100 : 50,
      rearPct: tw ? 100 - front / tw * 100 : 50,
      warnings: []
    };
    if (tw > 0) {
      var lim = E.BALANCE_LIMITS;
      if (Math.abs(st.cogOffset.x) > lim.lateral * 100) st.warnings.push({ code: 'cogLateral', severity: 'warning', params: { pct: st.cogOffset.x } });
      if (Math.abs(st.cogOffset.y) > lim.longitudinal * 100) st.warnings.push({ code: 'cogLongitudinal', severity: 'warning', params: { pct: st.cogOffset.y } });
      if (st.cogOffset.zPct > lim.height * 100) st.warnings.push({ code: 'cogHigh', severity: 'warning', params: { pct: st.cogOffset.zPct } });
    }
    if (payload && tw > payload + 1e-6) st.warnings.push({ code: 'overweight', severity: 'error', params: { weight: tw, max: payload, over: tw - payload } });
    if (cargo) {
      st.perSku = cargo.map(function (c) {
        var placed = bySku[c.id] || 0;
        var req = c.maxMode ? null : Math.max(0, Math.floor(+c.qty || 0));
        return {
          id: c.id, sku: c.sku, name: c.name, color: c.color, requested: req, placed: placed,
          unplaced: req == null ? 0 : Math.max(0, req - placed),
          weight: placed * (+c.weight || 0), volume: placed * c.w * c.l * c.h
        };
      });
      st.unplacedTotal = st.perSku.reduce(function (s, r) { return s + r.unplaced; }, 0);
    }
    return st;
  };

  /**
   * Verified Gross Mass of a packed shipping container (SOLAS VGM, method 2 = sum of parts):
   * VGM = container tare + cargo + dunnage/securing material. Checked against the container's max gross.
   */
  E.vgm = function (C, placements, dunnage) {
    var cargo = placements.reduce(function (s, p) { return s + (+p.weight || 0); }, 0);
    var tare = +C.tare || 0, dn = +dunnage || 0, total = tare + cargo + dn, max = +C.maxGross || 0;
    var r = { cargo: cargo, tare: tare, dunnage: dn, vgm: total, maxGross: max, pct: max ? total / max * 100 : 0, warnings: [] };
    if (max && total > max + 1e-6) r.warnings.push({ code: 'vgmOver', severity: 'error', params: { load: total, limit: max, over: total - max } });
    return r;
  };

  /**
   * Axle-group loads from static equilibrium (cargo + body treated as a rigid beam).
   * cfg: { kind: 'rigid'|'semi', groups: [{key,y,tare,limit}], kingpinY, bodyTare, bodyY, gvwLimit }
   *  rigid: the load box rests on the front and rear groups.
   *  semi : the container/trailer rests on the kingpin and the trailer group; the kingpin load is
   *         shared between the tractor steer and drive groups by lever arm.
   * y is measured from the front wall of the cargo box (cm); loads in kg.
   */
  E.axleLoads = function (C, placements, cfg) {
    if (!cfg || !cfg.groups || cfg.groups.length < 2) return null;
    var P = +cfg.bodyTare || 0, M0 = P * (cfg.bodyY != null ? cfg.bodyY : C.L / 2), cargo = 0;
    placements.forEach(function (p) {
      var w = +p.weight || 0;
      cargo += w; P += w; M0 += w * (p.y + p.l / 2);
    });
    var g = cfg.groups, loads = g.map(function (x) { return +x.tare || 0; });
    function split(total, moment, ya, yb) {          // reactions at ya / yb for a load with first moment `moment`
      var rb = (moment - total * ya) / (yb - ya);
      return [total - rb, rb];
    }
    if (cfg.kind === 'semi' && g.length >= 3) {
      var kp = cfg.kingpinY != null ? cfg.kingpinY : 50;
      var r = split(P, M0, kp, g[2].y);                // kingpin / trailer group
      loads[2] += r[1];
      var k = split(r[0], r[0] * kp, g[0].y, g[1].y);   // kingpin load → steer / drive
      loads[0] += k[0]; loads[1] += k[1];
    } else {
      var rr = split(P, M0, g[0].y, g[g.length - 1].y);
      loads[0] += rr[0]; loads[g.length - 1] += rr[1];
    }
    var gross = loads.reduce(function (s, v) { return s + v; }, 0);
    var res = {
      groups: g.map(function (x, i) {
        return { key: x.key, y: x.y, n: x.n, load: loads[i], limit: +x.limit || 0, pct: x.limit ? loads[i] / x.limit * 100 : 0 };
      }),
      gross: gross, gvwLimit: +cfg.gvwLimit || 0, gvwPct: cfg.gvwLimit ? gross / cfg.gvwLimit * 100 : 0, cargo: cargo,
      warnings: []
    };
    res.groups.forEach(function (x) {
      if (x.limit && x.load > x.limit + 1e-6) res.warnings.push({ code: 'axleOver', severity: 'error', params: { group: x.key, load: x.load, limit: x.limit, over: x.load - x.limit } });
      if (x.load < -1e-6) res.warnings.push({ code: 'axleLift', severity: 'error', params: { group: x.key } });
    });
    if (res.gvwLimit && gross > res.gvwLimit + 1e-6) res.warnings.push({ code: 'gvwOver', severity: 'error', params: { load: gross, limit: res.gvwLimit, over: gross - res.gvwLimit } });
    // steering needs weight on the front axle (rule of thumb ≥ 20 % of gross)
    if (cargo > 0 && gross > 0 && loads[0] / gross < 0.2) res.warnings.push({ code: 'steerLight', severity: 'warning', params: { pct: loads[0] / gross * 100 } });
    return res;
  };

  /** CoG deviation normalised by the warning limits (1.0 = at the limit), lateral + longitudinal averaged. */
  E.cogDeviation = function (C, tw, mx, my) {
    if (tw <= 0) return 0;
    var lim = E.BALANCE_LIMITS;
    var lat = Math.abs(mx / tw - C.W / 2) / C.W / lim.lateral;
    var lon = Math.abs(my / tw - C.L / 2) / C.L / lim.longitudinal;
    return (lat + lon) / 2;
  };
});
if (typeof module !== 'undefined' && module.exports) module.exports = LPEngineParts;
