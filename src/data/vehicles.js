/* Container & Truck Load Planner — data/vehicles.js
 * Vehicle geometry shared by the 3D model and the axle-load calculation, plus default
 * tare weights and limits. Engine coordinates: y = 0 front wall of the cargo box, y = L door; cm / kg.
 *
 * DEFAULT WEIGHTS/LIMITS ARE APPROXIMATIONS for planning — every value can be edited per job in the
 * container panel (Advanced → Axle loads). Check them against the actual vehicle registration and the
 * applicable regulation (e.g. Department of Highways limits) before relying on them.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};

  // Shipping containers default to 'container' = the box only, standing on the ground (no vehicle,
  // no axle loads). 'trailer' (tractor + chassis) can still be chosen manually per job.
  var BY_PRESET = { pk4: 'pickup', t4big: 'truck4', t6: 'truck6', t10: 'truck10', c20: 'container', c40: 'container', c40hc: 'container', c45hc: 'container', rf20: 'container', rf40: 'container' };

  /** Which vehicle carries this box (custom sizes are guessed from the length). */
  LP.vehicleType = function (C) {
    if (C.vehicle) return C.vehicle;
    if (BY_PRESET[C.presetId]) return BY_PRESET[C.presetId];
    var L = C.L;
    return L <= 330 ? 'pickup' : L <= 480 ? 'truck4' : L <= 680 ? 'truck6' : L <= 1000 ? 'truck10' : 'container';
  };

  /** Drawing dimensions (cm): deck height, wheel radius, tyre width, cab length / roof height. */
  LP.VEHICLE_DIMS = {
    pickup: { deck: 80, r: 34, tw: 22, cabL: 235, cabTop: 185, style: 'pickup' },
    truck4: { deck: 95, r: 39, tw: 24, cabL: 165, cabTop: 225, style: 'cabover' },
    truck6: { deck: 110, r: 48, tw: 26, cabL: 185, cabTop: 275, style: 'cabover' },
    truck10: { deck: 122, r: 52, tw: 28, cabL: 205, cabTop: 300, style: 'cabover' },
    trailer: { deck: 138, r: 52, tw: 28, cabL: 215, cabTop: 310, style: 'cabover' },
    container: { deck: 18, style: 'none' }      // container on the ground: floor structure + bottom rails only
  };

  /** Default tare (unladen weight carried by each axle group) and limits, kg. */
  var DEFAULTS = {
    pickup: { gvw: 3150, body: 250, groups: { front: [1150, 1400], rear: [550, 2100] } },
    truck4: { gvw: 9500, body: 500, groups: { front: [1500, 3000], rear: [900, 6500] } },
    truck6: { gvw: 15000, body: 1000, groups: { front: [2600, 6000], rear: [1600, 10000] } },
    truck10: { gvw: 25000, body: 1500, groups: { front: [3600, 6500], rear: [4200, 20000] } },
    trailer: { gvw: 50500, body: 6000, groups: { steer: [5200, 7500], drive: [3800, 20000], trailer: [0, 24000] } }
  };
  var CONTAINER_TARE = { c20: 2200, c40: 3750, c40hc: 3900, c45hc: 4800, rf20: 3000, rf40: 4800 };

  /** Axle positions (engine y) for the vehicle model. */
  LP.vehicleLayout = function (C, type) {
    var d = LP.VEHICLE_DIMS[type];
    if (!d || d.style === 'none') return null;   // no axles (container on the ground)
    var L = C.L, r = d.r;
    var gap = type === 'trailer' ? 34 : 12, y1 = -gap, y0 = y1 - d.cabL;
    var steer = y0 + (d.style === 'pickup' ? 62 : d.cabL * 0.42);
    var out = { type: type, cabFront: y0, cabRear: y1, axles: [], groups: [] };
    function grp(key, ys, dual) {
      ys.forEach(function (y) { out.axles.push({ y: y, dual: dual, group: key }); });
      out.groups.push({ key: key, y: ys.reduce(function (s, v) { return s + v; }, 0) / ys.length, n: ys.length, dual: dual });
    }
    if (type === 'trailer') {
      grp('steer', [steer], false);
      grp('drive', [40, 40 + r * 2 + 16], true);
      var n = L > 900 ? 3 : 2, ts = [];
      for (var k = 0; k < n; k++) ts.push(L - 95 - k * (r * 2 + 22));
      grp('trailer', ts.reverse(), true);
      out.kingpin = 50;
    } else {
      grp('front', [steer], false);
      if (type === 'pickup') grp('rear', [L * 0.5], false);
      else if (type === 'truck4') grp('rear', [L * 0.64], false);
      else if (type === 'truck6') grp('rear', [L * 0.66], true);
      else { var a1 = L * 0.6; grp('rear', [a1, a1 + r * 2 + 18], true); }
    }
    return out;
  };

  /** Full axle-load configuration for the engine: positions + tare/limits (defaults merged with user overrides). */
  LP.axleConfig = function (C) {
    var type = LP.vehicleType(C), lay = LP.vehicleLayout(C, type);
    if (!lay) return null;
    var df = DEFAULTS[type], ov = C.axle || {};
    var body = df.body + (type === 'trailer' ? (CONTAINER_TARE[C.presetId] || (C.L > 900 ? 3800 : 2300)) : 0);
    if (type === 'trailer' && lay.groups[2].n === 2) df = Object.assign({}, df, { groups: Object.assign({}, df.groups, { trailer: [0, 18000] }) });
    return {
      type: type,
      kind: type === 'trailer' ? 'semi' : 'rigid',
      kingpinY: lay.kingpin,
      bodyTare: ov.bodyTare != null ? +ov.bodyTare : body,
      bodyY: C.L / 2,
      gvwLimit: ov.gvw != null ? +ov.gvw : df.gvw,
      groups: lay.groups.map(function (g, i) {
        var o = (ov.groups && ov.groups[i]) || {};
        return { key: g.key, y: g.y, n: g.n, dual: g.dual, tare: o.tare != null ? +o.tare : df.groups[g.key][0], limit: o.limit != null ? +o.limit : df.groups[g.key][1] };
      }),
      layout: lay
    };
  };
})(this);
