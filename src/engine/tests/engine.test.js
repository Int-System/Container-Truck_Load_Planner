/* Container & Truck Load Planner — engine unit tests
 * Browser: open tests.html     Node (if installed): node src/engine/tests/engine.test.js
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && typeof require === 'function';
  var E = isNode ? require('../index.js') : root.LPEngine;
  var U = isNode ? require('../../utils/units.js') : (root.LP && root.LP.units);
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

  var C20 = { W: 235, L: 590, H: 239, maxPayload: 28000 };
  var C40 = { W: 235, L: 1203, H: 239, maxPayload: 26500 };
  function sku(o) {
    var d = { id: 'A', sku: 'A', w: 40, l: 30, h: 30, weight: 10, qty: 1, rotation: 'all', stackable: true, maxStack: 0, maxLoad: 0, fragile: false, pkg: 'box', dropOrder: 1 };
    for (var k in o) d[k] = o[k];
    return d;
  }
  function specMap(list) { var m = {}; list.forEach(function (c) { m[c.id] = c; }); return m; }
  function errorsOf(C, placements, list) {
    var v = E.validate(C, placements, specMap(list), {});
    return { v: v, errs: v.issues.filter(function (i) { return i.severity === 'error'; }) };
  }
  function assertValid(C, res, list) {
    var r = errorsOf(C, res.placements, list);
    assert(!r.errs.length, 'validation errors: ' + r.errs.map(function (e) { return e.code + '×' + e.params.n; }).join(', '));
    return r.v;
  }
  function count(res, id) { return res.placements.filter(function (p) { return p.sku === id; }).length; }

  // ---- Acceptance criterion 1: 40×30×30 cm / 10 kg cartons in a 20' container -------------
  test('AC1: 40x30x30 cartons fill a 20ft close to theoretical, no collisions', function () {
    var list = [sku({ maxMode: true })];
    var res = E.pack(C20, list, { objective: 'count', timeLimit: 2500 });
    var theory = Math.floor(235 * 590 * 239 / (40 * 30 * 30));
    var n = res.placements.length;
    assertValid(C20, res, list);
    assert(n >= theory * 0.85, 'only ' + n + ' of theoretical ' + theory);
    return n + ' boxes / theoretical ' + theory + ' (' + (n / theory * 100).toFixed(1) + '%), ' + res.timeMs + ' ms, ' + res.iterations + ' runs';
  });

  test('AC1b: upright-only cartons still pack densely', function () {
    var list = [sku({ maxMode: true, rotation: 'upright' })];
    var res = E.pack(C20, list, { objective: 'count', timeLimit: 1500 });
    assertValid(C20, res, list);
    var n = res.placements.length;
    assert(n >= 700, 'only ' + n);
    return n + ' boxes';
  });

  // ---- Acceptance criterion 2: no floating / no collision on mixed cargo ------------------
  test('AC2: mixed cargo — every box supported, no collisions, inside container', function () {
    var list = [
      sku({ id: 'A', w: 120, l: 100, h: 110, weight: 400, qty: 8, pkg: 'pallet', rotation: 'upright' }),
      sku({ id: 'B', w: 60, l: 40, h: 40, weight: 18, qty: 60 }),
      sku({ id: 'C', w: 55, l: 35, h: 25, weight: 8, qty: 90 }),
      sku({ id: 'D', w: 58, l: 58, h: 90, weight: 60, qty: 12, pkg: 'cylinder' }),
      sku({ id: 'E', w: 80, l: 45, h: 33, weight: 15, qty: 40, rotation: 'fixed' }),
      sku({ id: 'F', w: 30, l: 30, h: 30, weight: 5, qty: 120 })
    ];
    var res = E.pack(C20, list, { objective: 'volume', timeLimit: 2000 });
    var v = assertValid(C20, res, list);
    assert(!v.flags || !Object.keys(v.flags).some(function (u) { return v.flags[u].indexOf('floating') >= 0; }), 'floating box');
    return res.placements.length + ' placed, unplaced ' + JSON.stringify(res.unplaced);
  });

  // ---- Acceptance criterion 3: payload limit ----------------------------------------------
  test('AC3: stops at payload limit and warns', function () {
    var pickup = { W: 165, L: 270, H: 165, maxPayload: 1500 };
    var list = [sku({ w: 40, l: 40, h: 30, weight: 100, qty: 300 })];
    var res = E.pack(pickup, list, { timeLimit: 800 });
    var w = res.placements.reduce(function (s, p) { return s + p.weight; }, 0);
    assert(w <= 1500 + 1e-6, 'weight ' + w + ' exceeds payload');
    assert(res.placements.length === 15, 'expected 15, got ' + res.placements.length);
    assert(res.payloadHit, 'payloadHit flag missing');
    assert(res.warnings.some(function (x) { return x.code === 'payloadReached'; }), 'warning missing');
    return w + ' kg / 1500 kg, unplaced ' + res.unplaced[0].qty;
  });

  test('AC3b: validator flags an overweight manual layout', function () {
    var C = { W: 200, L: 400, H: 200, maxPayload: 100 };
    var list = [sku({ weight: 60 })];
    var pl = [{ uid: 1, sku: 'A', x: 0, y: 0, z: 0, w: 40, l: 30, h: 30, weight: 60 }, { uid: 2, sku: 'A', x: 50, y: 0, z: 0, w: 40, l: 30, h: 30, weight: 60 }];
    var v = E.validate(C, pl, specMap(list), {});
    assert(v.issues.some(function (i) { return i.code === 'overweight'; }), 'no overweight issue');
  });

  // ---- Acceptance criterion 5: performance ------------------------------------------------
  test('AC5: 600 mixed items auto-packed in < 5 s', function () {
    var list = [
      sku({ id: 'A', w: 60, l: 40, h: 40, weight: 20, qty: 100 }),
      sku({ id: 'B', w: 50, l: 30, h: 35, weight: 12, qty: 100 }),
      sku({ id: 'C', w: 45, l: 45, h: 45, weight: 25, qty: 100 }),
      sku({ id: 'D', w: 80, l: 60, h: 50, weight: 35, qty: 100 }),
      sku({ id: 'E', w: 35, l: 25, h: 20, weight: 6, qty: 100 }),
      sku({ id: 'F', w: 100, l: 50, h: 40, weight: 30, qty: 100, rotation: 'upright' })
    ];
    var t0 = Date.now();
    var res = E.pack(C40, list, { timeLimit: 3000 });
    var ms = Date.now() - t0;
    assertValid(C40, res, list);
    assert(ms < 5000, 'took ' + ms + ' ms');
    return res.placements.length + '/600 placed in ' + ms + ' ms (' + res.iterations + ' runs)';
  });

  // ---- Stacking constraints --------------------------------------------------------------
  test('Fragile items carry nothing on top', function () {
    var list = [sku({ id: 'G', w: 50, l: 50, h: 40, weight: 5, qty: 40, fragile: true }), sku({ id: 'H', w: 50, l: 50, h: 40, weight: 5, qty: 200 })];
    var res = E.pack(C20, list, { timeLimit: 800 });
    var v = assertValid(C20, res, list);
    var fragile = res.placements.filter(function (p) { return p.sku === 'G'; });
    fragile.forEach(function (f) { assert((v.loads[f.uid] || 0) === 0, 'load on fragile'); });
    return count(res, 'G') + ' fragile, ' + count(res, 'H') + ' normal';
  });

  test('Max stack tiers and max load on top are respected', function () {
    var list = [
      sku({ id: 'S', w: 60, l: 60, h: 30, weight: 10, qty: 300, maxStack: 3, rotation: 'fixed' }),
      sku({ id: 'M', w: 60, l: 60, h: 30, weight: 10, qty: 300, maxLoad: 20, rotation: 'fixed' })
    ];
    var res = E.pack(C20, list, { timeLimit: 800 });
    var v = assertValid(C20, res, list);
    res.placements.forEach(function (p) {
      if (p.sku === 'S') assert(v.tiers[p.uid] <= 3, 'tier ' + v.tiers[p.uid]);
      if (p.sku === 'M') assert(v.loads[p.uid] <= 20 + 1e-6, 'load ' + v.loads[p.uid]);
    });
    return res.placements.length + ' placed';
  });

  test('Non-stackable pallets are not stacked on', function () {
    var list = [sku({ id: 'P', w: 120, l: 100, h: 100, weight: 500, qty: 10, stackable: false, pkg: 'pallet', rotation: 'upright' })];
    var res = E.pack(C20, list, { timeLimit: 500 });
    assertValid(C20, res, list);
    res.placements.forEach(function (p) { assert(p.z === 0, 'pallet stacked'); });
    return res.placements.length + ' pallets on floor';
  });

  test('Heavy items never sit on lighter items', function () {
    var list = [sku({ id: 'L', w: 50, l: 50, h: 50, weight: 5, qty: 60 }), sku({ id: 'K', w: 50, l: 50, h: 50, weight: 50, qty: 60 })];
    var res = E.pack(C20, list, { timeLimit: 800 });
    var v = assertValid(C20, res, list);
    assert(!v.issues.some(function (i) { return i.code === 'heavyOnLight'; }), 'heavy on light');
  });

  test('Fuzz: random constrained cargo always validates (10 seeds × 4 objectives)', function () {
    var seed = 99;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var objectives = ['volume', 'count', 'balance', 'delivery'], total = 0;
    for (var s = 0; s < 10; s++) {
      var list = [];
      for (var i = 0; i < 6; i++) {
        list.push(sku({
          id: 'R' + i, w: 20 + Math.round(rnd() * 80), l: 20 + Math.round(rnd() * 80), h: 15 + Math.round(rnd() * 60),
          weight: 2 + Math.round(rnd() * 60), qty: 5 + Math.round(rnd() * 40),
          rotation: ['fixed', 'upright', 'all'][Math.floor(rnd() * 3)], fragile: rnd() < 0.15,
          stackable: rnd() > 0.1, maxStack: rnd() < 0.3 ? 2 + Math.floor(rnd() * 3) : 0,
          maxLoad: rnd() < 0.3 ? 20 + Math.round(rnd() * 100) : 0, dropOrder: 1 + Math.floor(rnd() * 3),
          pkg: rnd() < 0.15 ? 'cylinder' : 'box',
          segGroup: s % 3 === 1 && rnd() < 0.4 ? (rnd() < 0.5 ? 'X' : 'Y') : '',
          tempZone: s % 3 === 2 ? ['frozen', 'chilled', 'ambient'][Math.floor(rnd() * 3)] : ''
        }));
      }
      var obj = objectives[s % 4], fl = s % 2 ? 2500 : 0;
      var res = E.pack(C20, list, { objective: obj, timeLimit: 250, seed: s + 1, floorLoad: fl });
      var v0 = E.validate(C20, res.placements, specMap(list), { floorLoad: fl });
      var r = { errs: v0.issues.filter(function (i) { return i.severity === 'error'; }) };
      assert(!r.errs.length, 'seed ' + s + ' (' + obj + '): ' + r.errs.map(function (e) { return e.code + '×' + e.params.n; }).join(', '));
      total += res.placements.length;
    }
    return total + ' boxes placed across 10 random jobs';
  });

  // ---- Delivery order --------------------------------------------------------------------
  test('Delivery mode: earlier drops are never blocked by later drops', function () {
    var list = [
      sku({ id: 'D1', w: 60, l: 40, h: 40, weight: 15, qty: 80, dropOrder: 1 }),
      sku({ id: 'D2', w: 50, l: 50, h: 40, weight: 15, qty: 80, dropOrder: 2 }),
      sku({ id: 'D3', w: 40, l: 30, h: 30, weight: 10, qty: 150, dropOrder: 3 })
    ];
    var res = E.pack(C20, list, { objective: 'delivery', timeLimit: 1500 });
    var v = assertValid(C20, res, list);
    var blocked = v.issues.filter(function (i) { return i.code === 'deliveryBlocked'; });
    assert(!blocked.length, blocked.length ? blocked[0].params.n + ' blocked' : '');
    var avg = function (id) { var a = res.placements.filter(function (p) { return p.sku === id; }); return a.reduce(function (s, p) { return s + p.y; }, 0) / a.length; };
    assert(avg('D1') > avg('D3'), 'drop 1 should be nearer the door');
    return res.placements.length + ' placed, avg y: D1=' + avg('D1').toFixed(0) + ' D3=' + avg('D3').toFixed(0);
  });

  // ---- Hybrid ---------------------------------------------------------------------------
  test('Hybrid: locked items stay put and count toward the quantity', function () {
    var list = [sku({ id: 'A', qty: 100 })];
    var fixed = [{ uid: 'L1', sku: 'A', x: 100, y: 200, z: 0, w: 40, l: 30, h: 30, weight: 10, locked: true }];
    var res = E.pack(C20, list, { fixed: fixed, timeLimit: 600 });
    assertValid(C20, res, list);
    var l1 = res.placements.filter(function (p) { return p.uid === 'L1'; })[0];
    assert(l1 && l1.x === 100 && l1.y === 200 && l1.z === 0, 'locked item moved');
    assert(res.placements.length === 100, 'expected 100 total, got ' + res.placements.length);
  });

  // ---- Validator ------------------------------------------------------------------------
  test('Validator detects collision, floating and out-of-bounds', function () {
    var C = { W: 200, L: 300, H: 200, maxPayload: 1000 };
    var list = [sku({})];
    var pl = [
      { uid: 'a', sku: 'A', x: 0, y: 0, z: 0, w: 40, l: 30, h: 30, weight: 10 },
      { uid: 'b', sku: 'A', x: 20, y: 10, z: 0, w: 40, l: 30, h: 30, weight: 10 },   // collides with a
      { uid: 'c', sku: 'A', x: 100, y: 100, z: 50, w: 40, l: 30, h: 30, weight: 10 }, // floating
      { uid: 'd', sku: 'A', x: 180, y: 0, z: 0, w: 40, l: 30, h: 30, weight: 10 }     // outside
    ];
    var v = E.validate(C, pl, specMap(list), {});
    assert(v.flags.a.indexOf('collision') >= 0 && v.flags.b.indexOf('collision') >= 0, 'collision');
    assert(v.flags.c.indexOf('floating') >= 0, 'floating');
    assert(v.flags.d.indexOf('outOfBounds') >= 0, 'bounds');
  });

  test('Centre of gravity and balance split', function () {
    var C = { W: 200, L: 400, H: 200, maxPayload: 1000 };
    var st = E.computeStats(C, [{ sku: 'A', x: 0, y: 0, z: 0, w: 100, l: 100, h: 100, weight: 100 }, { sku: 'A', x: 100, y: 300, z: 0, w: 100, l: 100, h: 100, weight: 100 }], null);
    assert(Math.abs(st.cog.x - 100) < 1e-9 && Math.abs(st.cog.y - 200) < 1e-9, 'cog');
    assert(Math.abs(st.leftPct - 50) < 1e-9 && Math.abs(st.frontPct - 50) < 1e-9, 'split');
    var st2 = E.computeStats(C, [{ sku: 'A', x: 0, y: 0, z: 0, w: 50, l: 50, h: 50, weight: 100 }], null);
    assert(st2.leftPct === 100 && st2.warnings.some(function (w) { return w.code === 'cogLateral'; }), 'lateral warning');
  });

  test('Balance objective centres the load', function () {
    var list = [sku({ id: 'A', w: 120, l: 100, h: 100, weight: 600, qty: 4, rotation: 'upright' })];
    var res = E.pack(C40, list, { objective: 'balance', timeLimit: 600 });
    var st = E.computeStats(C40, res.placements, list);
    assert(Math.abs(st.cogOffset.y) < 10, 'longitudinal offset ' + st.cogOffset.y.toFixed(1) + '%');
    return 'CoG offset x ' + st.cogOffset.x.toFixed(1) + '%, y ' + st.cogOffset.y.toFixed(1) + '%';
  });

  test('Load sequence puts supports before what they carry', function () {
    var list = [sku({ qty: 200 })];
    var res = E.pack(C20, list, { timeLimit: 500 });
    var pos = {};
    res.placements.forEach(function (p) { pos[p.uid] = p.seq; });
    res.placements.forEach(function (p) {
      res.placements.forEach(function (q) {
        if (Math.abs(q.z + q.h - p.z) < 0.05 && E.footprintOverlap(p, q) > 0) assert(pos[q.uid] < pos[p.uid], 'support loaded after');
      });
    });
  });

  // ---- Multi container ------------------------------------------------------------------
  test('Multi-container: 2000 cartons need several 20ft containers', function () {
    var list = [sku({ qty: 2000 })];
    var m = E.packMulti(C20, list, { multiTimeLimit: 300 });
    assert(m.complete, 'not complete');
    assert(m.containers >= 3 && m.containers <= 3, 'containers ' + m.containers);
    return m.containers + ' containers: ' + m.loads.map(function (l) { return l.count; }).join(' + ');
  });

  test('Suggest containers that fit everything', function () {
    var presets = [
      { id: 'p4', name: 'Pickup', W: 165, L: 270, H: 165, maxPayload: 1200 },
      { id: 't6', name: '6W', W: 230, L: 600, H: 230, maxPayload: 5500 },
      { id: 'c20', name: '20ft', W: 235, L: 590, H: 239, maxPayload: 28000 }
    ];
    var s = E.suggestContainers(presets, [sku({ qty: 300 })], {});
    assert(s.length && s[0].id !== 'p4', 'unexpected ' + JSON.stringify(s));
    return s.map(function (x) { return x.name; }).join(', ');
  });

  test('Compare options ranks a sensible best choice', function () {
    var presets = [
      { id: 'c20', name: '20ft', W: 235, L: 590, H: 239, maxPayload: 28000, cost: 15000 },
      { id: 'c40', name: '40ft', W: 235, L: 1203, H: 239, maxPayload: 26500, cost: 22000 }
    ];
    var r = E.compare(presets, [sku({ qty: 1200 })], { compareTimeLimit: 400, multiTimeLimit: 250 });
    assert(r.bestId === 'c40', 'best ' + r.bestId);
    return r.rows.map(function (x) { return x.name + ': ' + x.containersNeeded + ' units, ' + x.totalCost; }).join(' | ');
  });

  test('Compare uses the plan on screen as a baseline (never worse than Auto Pack)', function () {
    var P = { id: 'c20', name: '20ft', W: 235, L: 590, H: 239, maxPayload: 28000 };
    var cargo = [sku({ qty: 400 })];
    var full = E.pack(P, cargo, { timeLimit: 600, seed: 7 });
    assert(full.unplaced.length === 0, 'baseline pack incomplete');
    // a tiny compare budget on purpose; the baseline must win
    var r = E.compare([P], cargo, { compareTimeLimit: 1, multiTimeLimit: 50, maxIter: 1, baseline: { c20: full.placements } });
    var row = r.rows[0];
    assert(row.placed >= full.placements.length && row.unplaced === 0 && row.containersNeeded === 1 && row.complete, JSON.stringify(row));
    // a partial baseline reports the missing pieces
    var part = E.compare([P], cargo, { compareTimeLimit: 1, maxIter: 1, baseline: { c20: full.placements.slice(0, 10) } });
    assert(part.rows[0].placed >= 10, 'partial baseline');
    return row.placed + ' placed, ' + row.containersNeeded + ' unit';
  });

  // ---- Door opening ----------------------------------------------------------------------
  test('Door: items taller than the door are refused (fixed) or laid down (rotatable)', function () {
    var C = { W: 235, L: 590, H: 239, maxPayload: 28000, doorW: 234, doorH: 228 };
    var fixed = [sku({ id: 'T', w: 60, l: 60, h: 235, weight: 20, qty: 4, rotation: 'fixed' })];
    var r1 = E.pack(C, fixed, { timeLimit: 200 });
    assert(r1.placements.length === 0, 'tall fixed item was placed');
    assert(r1.unplaced[0] && r1.unplaced[0].reason === 'door' && r1.unplaced[0].qty === 4, 'door reason missing');
    assert(r1.warnings.some(function (w) { return w.code === 'doorTooSmall'; }), 'doorTooSmall warning missing');
    var free = [sku({ id: 'T', w: 60, l: 60, h: 235, weight: 20, qty: 4, rotation: 'all' })];
    var r2 = E.pack(C, free, { timeLimit: 200 });
    assert(r2.placements.length === 4, 'rotatable item not placed');
    r2.placements.forEach(function (p) { assert(p.h <= 228 && p.w <= 234, 'placed orientation does not pass the door'); });
    var v = E.validate(C, [{ uid: 'x', sku: 'T', x: 0, y: 0, z: 0, w: 60, l: 60, h: 235, weight: 20 }], specMap(fixed), {});
    assert(v.flags.x && v.flags.x.indexOf('doorClear') >= 0, 'validator did not flag doorClear');
    return 'fixed: 0 placed (door) · rotatable: 4 placed lying down';
  });

  // ---- Axle loads ------------------------------------------------------------------------
  test('Axle loads: rigid truck lever arms and limits', function () {
    var C = { W: 230, L: 600, H: 230 };
    var cfg = { kind: 'rigid', bodyTare: 0, bodyY: 300, gvwLimit: 2800, groups: [{ key: 'front', y: -100, tare: 1000, limit: 1400 }, { key: 'rear', y: 400, tare: 1000, limit: 2000 }] };
    var pl = [{ sku: 'A', x: 0, y: 100, z: 0, w: 100, l: 100, h: 100, weight: 1000 }];   // centre y = 150
    var a = E.axleLoads(C, pl, cfg);
    assert(Math.abs(a.groups[0].load - 1500) < 1e-6 && Math.abs(a.groups[1].load - 1500) < 1e-6, 'loads ' + a.groups.map(function (g) { return g.load; }));
    assert(Math.abs(a.gross - 3000) < 1e-6, 'gross');
    assert(a.warnings.some(function (w) { return w.code === 'axleOver' && w.params.group === 'front'; }), 'front over not flagged');
    assert(a.warnings.some(function (w) { return w.code === 'gvwOver'; }), 'gvw over not flagged');
    return 'front ' + a.groups[0].load + ' / rear ' + a.groups[1].load + ' kg';
  });

  test('Axle loads: semi-trailer conserves total weight', function () {
    var C = { W: 235, L: 1203, H: 239 };
    var cfg = { kind: 'semi', kingpinY: 50, bodyTare: 9000, bodyY: 601, gvwLimit: 50500,
      groups: [{ key: 'steer', y: -150, tare: 5200, limit: 6500 }, { key: 'drive', y: 92, tare: 3800, limit: 20000 }, { key: 'trailer', y: 1000, tare: 0, limit: 24000 }] };
    var pl = [];
    for (var i = 0; i < 10; i++) pl.push({ sku: 'A', x: 0, y: i * 110, z: 0, w: 100, l: 100, h: 100, weight: 1500 });
    var a = E.axleLoads(C, pl, cfg);
    var expect = 5200 + 3800 + 9000 + 15000;
    assert(Math.abs(a.gross - expect) < 1e-6, 'gross ' + a.gross + ' vs ' + expect);
    a.groups.forEach(function (g) { assert(g.load > 0, g.key + ' not loaded'); });
    return a.groups.map(function (g) { return g.key + ' ' + Math.round(g.load); }).join(' · ');
  });

  // ---- Round 4: drums, special rules, VGM, axle-aware packing, fleet --------------------
  test('Drums nest in a hexagonal pattern and fit more than a square grid', function () {
    var C = { W: 235, L: 590, H: 120, maxPayload: 28000 };
    // 50 cm drums: 4 per row and 4 in the shifted rows (4.5 × 50 = 225 ≤ 235), rows every 43.3 cm
    var list = [sku({ id: 'D', w: 50, l: 50, h: 88, weight: 50, maxMode: true, pkg: 'cylinder', rotation: 'upright', stackable: false })];
    var grid = E.pack(C, list, { timeLimit: 400, hexDrums: false }).placements.length;
    var res = E.pack(C, list, { timeLimit: 400 });
    assertValid(C, res, list);
    assert(res.placements.length > grid, 'hex ' + res.placements.length + ' vs grid ' + grid);
    return 'grid ' + grid + ' → hex ' + res.placements.length + ' drums (no collisions)';
  });

  test('Floor load rating limits column weight', function () {
    var C = { W: 235, L: 590, H: 239, maxPayload: 28000 };
    var list = [sku({ id: 'S', w: 40, l: 40, h: 30, weight: 100, qty: 100, rotation: 'fixed' })];   // 625 kg/m² per tier
    var res = E.pack(C, list, { timeLimit: 400, floorLoad: 2000 });
    var v = E.validate(C, res.placements, specMap(list), { floorLoad: 2000 });
    assert(!v.issues.some(function (i) { return i.code === 'floorOverload'; }), 'floor overloaded');
    res.placements.forEach(function (p) { assert(v.tiers[p.uid] <= 3, 'tier ' + v.tiers[p.uid] + ' exceeds 2000 kg/m²'); });
    return res.placements.length + ' placed, max 3 tiers';
  });

  test('Segregation groups keep their distance', function () {
    var C = { W: 235, L: 590, H: 239, maxPayload: 28000 };
    var list = [
      sku({ id: 'A', w: 50, l: 50, h: 50, weight: 10, qty: 30, segGroup: 'DG3' }),
      sku({ id: 'B', w: 50, l: 50, h: 50, weight: 10, qty: 30, segGroup: 'FOOD' })
    ];
    var res = E.pack(C, list, { timeLimit: 600, segDistance: 150 });
    var v = E.validate(C, res.placements, specMap(list), { segDistance: 150 });
    assert(!v.issues.some(function (i) { return i.code === 'segregation'; }), 'segregation violated');
    assert(count(res, 'A') > 0 && count(res, 'B') > 0, 'one group missing');
    return 'A ' + count(res, 'A') + ' / B ' + count(res, 'B') + ' placed ≥150 cm apart';
  });

  test('Temperature zones: frozen at the front, then chilled, then ambient', function () {
    var C = { W: 229, L: 544, H: 227, maxPayload: 27000 };
    var list = [
      sku({ id: 'AM', w: 40, l: 40, h: 40, weight: 10, qty: 60, tempZone: 'ambient' }),
      sku({ id: 'CH', w: 40, l: 40, h: 40, weight: 10, qty: 60, tempZone: 'chilled' }),
      sku({ id: 'FZ', w: 40, l: 40, h: 40, weight: 10, qty: 60, tempZone: 'frozen' })
    ];
    var res = E.pack(C, list, { timeLimit: 600 });
    var v = assertValid(C, res, list);
    assert(!v.issues.some(function (i) { return i.code === 'tempZone'; }), 'zone order violated');
    function maxY(id) { return Math.max.apply(null, res.placements.filter(function (p) { return p.sku === id; }).map(function (p) { return p.y + p.l; })); }
    function minY(id) { return Math.min.apply(null, res.placements.filter(function (p) { return p.sku === id; }).map(function (p) { return p.y; })); }
    assert(maxY('FZ') <= minY('CH') + 0.1 && maxY('CH') <= minY('AM') + 0.1, 'zones overlap');
    return 'frozen 0–' + maxY('FZ').toFixed(0) + ' · chilled –' + maxY('CH').toFixed(0) + ' · ambient –' + maxY('AM').toFixed(0) + ' cm';
  });

  test('Pallet fork-entry face is kept toward the door', function () {
    var list = [sku({ id: 'P', w: 80, l: 120, h: 100, weight: 300, qty: 10, pkg: 'pallet', rotation: 'all', forkFace: 'width' })];
    var res = E.pack(C20, list, { timeLimit: 300 });
    res.placements.forEach(function (p) { assert(p.w === 80 && p.h === 100, 'orientation ' + p.w + 'x' + p.l + 'x' + p.h); });
    return res.placements.length + ' pallets, all 80 cm side facing the door';
  });

  test('VGM = tare + cargo + dunnage, flagged above max gross', function () {
    var C = { W: 235, L: 590, H: 239, tare: 2200, maxGross: 30480 };
    var pl = [{ weight: 20000 }, { weight: 8500 }];
    var r = E.vgm(C, pl, 150);
    assert(r.vgm === 2200 + 28500 + 150, 'vgm ' + r.vgm);
    assert(r.warnings.some(function (w) { return w.code === 'vgmOver'; }), 'vgmOver missing');
    return 'VGM ' + r.vgm + ' kg (max 30,480)';
  });

  test('Axle-aware packing slides the load to relieve an overloaded axle', function () {
    var C = { W: 230, L: 600, H: 230, maxPayload: 9000 };
    var axle = { kind: 'rigid', bodyTare: 0, bodyY: 300, gvwLimit: 20000, groups: [{ key: 'front', y: -100, tare: 2600, limit: 4500 }, { key: 'rear', y: 400, tare: 1600, limit: 10000 }] };
    var list = [sku({ id: 'H', w: 100, l: 100, h: 100, weight: 900, qty: 4, rotation: 'fixed', stackable: false })];
    var plain = E.pack(C, list, { timeLimit: 300 });
    var aw = E.pack(C, list, { timeLimit: 300, axle: axle });
    var a0 = E.axleLoads(C, plain.placements, axle), a1 = E.axleLoads(C, aw.placements, axle);
    assert(a0.groups[0].load > 4500, 'test setup: front not overloaded (' + a0.groups[0].load + ')');
    assert(a1.groups[0].load <= 4500 + 1e-6, 'front still ' + a1.groups[0].load);
    assert(aw.warnings.some(function (w) { return w.code === 'axleShift'; }), 'axleShift info missing');
    return 'front axle ' + Math.round(a0.groups[0].load) + ' → ' + Math.round(a1.groups[0].load) + ' kg';
  });

  test('Fleet plan finds a cheaper mix than one vehicle type', function () {
    var presets = [
      { id: 'c20', name: '20ft', W: 235, L: 590, H: 239, maxPayload: 28000, cost: 15000 },
      { id: 'c40', name: '40ft', W: 235, L: 1203, H: 239, maxPayload: 26500, cost: 22000 }
    ];
    var r = E.fleetPlan(presets, [sku({ qty: 2400 })], { fleetTimeLimit: 200, multiTimeLimit: 200 });
    assert(r.complete, 'not complete');
    var placed = r.units.reduce(function (s, u) { return s + u.count; }, 0);
    assert(placed === 2400, 'placed ' + placed);
    assert(r.total <= 44000 + 1e-6, 'total ' + r.total);
    return r.summary.map(function (s) { return s.n + '×' + s.name; }).join(' + ') + ' = ' + r.total + ' ฿' + (r.bestSingle ? ' (single best ' + r.bestSingle.total + ')' : '');
  });

  test('Requested quantities are placed before "as many as possible" items', function () {
    var C = { W: 230, L: 600, H: 230, maxPayload: 5500 };
    var list = [sku({ id: 'MAX', w: 40, l: 30, h: 30, weight: 2, maxMode: true }), sku({ id: 'REQ', w: 50, l: 40, h: 30, weight: 12, qty: 6, rotation: 'upright' })];
    ['count', 'volume'].forEach(function (obj) {
      var res = E.pack(C, list, { objective: obj, timeLimit: 300 });
      assertValid(C, res, list);
      assert(count(res, 'REQ') === 6, obj + ': REQ ' + count(res, 'REQ') + '/6');
      assert(count(res, 'MAX') > 0, obj + ': MAX did not fill the rest');
    });
    return 'REQ 6/6 + MAX fills the remaining space';
  });

  // ---- Units ---------------------------------------------------------------------------
  test('Unit conversion', function () {
    if (!U) return 'skipped (units not loaded)';
    assert(Math.abs(U.toCm(1, 'm') - 100) < 1e-9 && Math.abs(U.toCm(10, 'mm') - 1) < 1e-9 && Math.abs(U.toCm(1, 'in') - 2.54) < 1e-9, 'length');
    assert(Math.abs(U.toKg(1, 'lb') - 0.45359237) < 1e-9, 'weight');
    assert(Math.abs(U.fromCm(U.toCm(12.5, 'in'), 'in') - 12.5) < 1e-9, 'round trip');
  });

  function run(log) {
    var pass = 0, fail = 0, results = [];
    tests.forEach(function (t) {
      var t0 = Date.now(), r = { name: t.name };
      try { r.note = t.fn() || ''; r.ok = true; pass++; } catch (e) { r.ok = false; r.error = e.message; fail++; }
      r.ms = Date.now() - t0;
      results.push(r);
      if (log) log(r);
    });
    return { pass: pass, fail: fail, results: results };
  }

  if (isNode && require.main === module) {
    var s = run(function (r) { console.log((r.ok ? '  ✔ ' : '  ✘ ') + r.name + ' (' + r.ms + ' ms)' + (r.note ? ' — ' + r.note : '') + (r.error ? '\n      ' + r.error : '')); });
    console.log('\n' + s.pass + ' passed, ' + s.fail + ' failed');
    process.exitCode = s.fail ? 1 : 0;
  } else if (!isNode) {
    root.LPTests = { run: run, tests: tests };
  }
})(this);
