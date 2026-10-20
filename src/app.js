/* Container & Truck Load Planner — app.js
 * Wires the store (single source of truth) to all views, the engine worker, manual tools and IO.
 */
(function (root) {
  'use strict';
  var LP = root.LP, S = LP.store, E = root.LPEngine, t = LP.t, U = LP.units, esc = LP.esc, I = LP.icon;
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  try { LP.i18n.lang = localStorage.getItem('lp.lang') || 'th'; } catch (e) { /* ignore */ }
  LP.hydrateIcons();
  var client = E.createClient();
  LP.engineClient = client;
  Object.assign(S.ui, { tab: 'summary', multi: null, multiActive: null, multiBusy: false, multiSig: null, playing: false, showVehicle: true });
  try {
    S.ui.showVehicle = localStorage.getItem('lp.vehicle') !== '0';
    S.ui.cabColor = localStorage.getItem('lp.cabColor') || null;
    S.ui.logo = localStorage.getItem('lp.logo') || null;
  } catch (e) { /* ignore */ }
  function vehicleOpts() { return { type: LP.vehicleType(S.state.container), show: S.ui.showVehicle, cabColor: S.ui.cabColor, logo: S.ui.logo }; }
  function refreshVehicle() { if (v3d) v3d.setContainer(S.state.container, vehicleOpts()); }

  // ------------------------------------------------------------------ derived data
  var cache = { v: -1 };
  function compute() {
    var st = S.state, specs = S.specMap(), C = st.container;
    var opts = { minSupport: st.settings.minSupport, heavyBottom: st.settings.heavyBottom, floorLoad: +C.floorLoad || 0, segDistance: st.settings.segDistance != null ? +st.settings.segDistance : 150 };
    var val = E.validate(C, st.placements, specs, opts);
    var stats = E.computeStats(C, st.placements, st.cargo);
    var maxTier = 0;
    Object.keys(val.tiers).forEach(function (u) { maxTier = Math.max(maxTier, val.tiers[u]); });
    var axleCfg = LP.axleConfig(C), axle = axleCfg ? E.axleLoads(C, st.placements, axleCfg) : null;
    var ship = st.project.shipment || {};
    var vgm = (LP.isBoxContainer && LP.isBoxContainer(C)) ? E.vgm(C, st.placements, ship.dunnage) : null;
    return { v: S.version, specs: specs, val: val, stats: stats, maxTier: maxTier, axle: axle, axleCfg: axleCfg, vgm: vgm, ship: ship };
  }
  function derived() { if (cache.v !== S.version) cache = compute(); return cache; }

  // ------------------------------------------------------------------ components
  var containerUI = LP.ContainerSelect($('#containerPanel'));
  var cargoUI = LP.CargoForm($('#cargoPanel'), { addOne: addOne });
  var v2d = LP.Viewer2D($('#view2d'), select);
  var v3d = LP.Viewer3D($('#view3d'), { onSelect: select, onDrag: onDrag, onDragEnd: onDragEnd, onHover: onHover });

  // Display menu → "Axes and distances" (display-only options, remembered per browser)
  var AXES_DEFAULT = { gizmo: true, origin: true, ruler: false, rulerMode: 'manual', rulerStep: 50, cube: false };
  S.ui.axes = Object.assign({}, AXES_DEFAULT);
  try { Object.assign(S.ui.axes, JSON.parse(localStorage.getItem('lp.axes') || '{}')); } catch (e) { /* defaults */ }
  function setAxes(patch) {
    Object.assign(S.ui.axes, patch);
    try { localStorage.setItem('lp.axes', JSON.stringify(S.ui.axes)); } catch (e) { /* ignore */ }
    if (v3d) v3d.setAxes(S.ui.axes);
    renderAxesMenu();
    renderSelInfo();
  }
  function renderAxesMenu() {
    var a = S.ui.axes;
    $('#axGizmo').checked = a.gizmo; $('#axOrigin').checked = a.origin; $('#axRuler').checked = a.ruler; $('#axCube').checked = a.cube;
    $('#axRulerOpts').classList.toggle('dis', !a.ruler);
    $$('#axRulerMode [data-rm]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-rm') === a.rulerMode); });
    $('#axRulerStep').value = String(a.rulerStep);
  }
  if (v3d) v3d.setAxes(S.ui.axes);

  function filterCtx(d) {
    var ui = S.ui;
    return { hiddenSku: ui.hiddenSku, layer: ui.layer, tiers: d.val.tiers, cut: ui.cut, step: ui.step };
  }

  function render2D(d) {
    if (S.ui.view === '3d') return;
    d = d || derived();
    var st = S.state, ui = S.ui;
    v2d.render(ui.view, {
      C: st.container, placements: st.placements, specs: d.specs, flags: d.val.flags, tiers: d.val.tiers,
      selected: ui.selected, layer: ui.layer, hiddenSku: ui.hiddenSku, cut: ui.cut, step: ui.step, cog: d.stats.cog
    });
  }

  function cargoSignature(withContainer) {
    var st = S.state, C = st.container;
    return (withContainer === false ? '' : [C.W, C.L, C.H, C.maxPayload].join(',')) + '|' + st.cargo.map(function (c) {
      return [c.id, c.w, c.l, c.h, c.weight, c.qty, c.maxMode, c.rotation, c.stackable, c.maxStack, c.maxLoad, c.fragile, c.dropOrder].join(',');
    }).join(';');
  }

  function renderInsights(d) {
    var st = S.state, ui = S.ui;
    $$('#insTabs [data-tab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === ui.tab); });
    ['summary', 'steps', 'multi'].forEach(function (k) { $('#' + k).classList.toggle('hidden', ui.tab !== k); });
    var multiN = ui.multi && ui.multi.containers > 1 ? ui.multi.containers : 0;
    $('#multiBadge').classList.toggle('hidden', !multiN);
    $('#multiBadge').textContent = multiN;
    if (ui.tab === 'summary') {
      var banner = ui.multi && ui.multiActive != null && ui.multi.containers > 1
        ? '<div class="banner info">' + I('stack') + esc(t('multiBanner', { i: ui.multiActive + 1, n: ui.multi.containers })) + '</div>' : '';
      LP.renderSummary($('#summary'), {
        C: st.container, stats: d.stats, issues: d.val.issues, banner: banner, axle: d.axle, axleCfg: d.axleCfg, vgm: d.vgm, ship: d.ship,
        runWarnings: st.lastRun ? (st.lastRun.warnings || []).filter(function (w) { return w.code !== 'unplaced' && w.code !== 'overweight'; }) : [],
        lastRun: st.lastRun, suggestion: ui.suggestion
      });
    } else if (ui.tab === 'steps') {
      LP.renderSteps($('#steps'), { placements: st.placements, specs: d.specs, step: ui.step, playing: !!playTimer, L: st.container.L });
    } else {
      LP.renderMulti($('#multi'), { multi: ui.multi, active: ui.multiActive, multiBusy: ui.multiBusy, containerName: LP.containerLabel(st.container) });
    }
  }

  LP.containerLabel = function (C) { return (LP.i18n.lang === 'th' && C.nameTh) ? C.nameTh : C.name; };

  function renderPrecheck() {
    var st = S.state, C = st.container, tot = LP.cargoTotals(st.cargo);
    var cv = C.W * C.L * C.H, vp = tot.volume / cv * 100, wp = C.maxPayload ? tot.weight / C.maxPayload * 100 : 0;
    function pc(label, pct, txt) {
      var tone = pct > 100 ? 'bad' : pct > 85 ? 'warn' : 'ok';
      return '<div class="pc"><div class="pc-top"><span>' + esc(label) + '</span><b>' + U.fmt(pct, 0) + '%</b></div><div class="bar-t"><span class="' + tone + '" style="width:' + Math.min(100, pct).toFixed(1) + '%"></span></div><div class="pc-sub">' + txt + '</div></div>';
    }
    if (!st.cargo.length) { $('#precheck').innerHTML = ''; return; }
    var h = pc(t('cargoVol'), vp, U.fmt(tot.volume / 1e6, 2) + ' / ' + U.fmt(cv / 1e6, 1) + ' m³') + pc(t('cargoWt'), wp, U.fmt(tot.weight, 0) + ' / ' + U.fmt(C.maxPayload, 0) + ' kg');
    if (vp > 100) h += '<div class="pc-note bad">' + esc(t('overCapVol', { n: Math.ceil(vp / 90) })) + '</div>';
    else if (wp > 100) h += '<div class="pc-note bad">' + esc(t('overCapWt', { n: Math.ceil(wp / 100) })) + '</div>';
    else if (tot.anyMax) h += '<div class="pc-note">' + esc(t('capMaxNote')) + '</div>';
    $('#precheck').innerHTML = h;
  }

  function renderEmpty() {
    var st = S.state, el = $('#emptyOv');
    var show = !st.placements.length && !S.ui.packing;
    el.classList.toggle('hidden', !show);
    if (!show) return;
    el.innerHTML = st.cargo.length
      ? '<div class="empty-card">' + I('zap') + '<h3>' + t('emptyTitle') + '</h3><p>' + t('emptyText') + '</p><button class="btn primary" data-empty="pack">' + I('zap') + t('autoPack') + '</button></div>'
      : '<div class="empty-card">' + I('box') + '<h3>' + t('emptyNoCargo') + '</h3><p>' + t('emptyNoCargoText') + '</p><div class="row gap" style="justify-content:center"><button class="btn primary" data-empty="add">' + I('plus') + t('addItem') + '</button><button class="btn" data-empty="sample">' + I('box') + t('trySample') + '</button></div></div>';
  }

  function renderTools(d) {
    var ui = S.ui, st = S.state;
    $$('#viewSeg button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === ui.view); });
    $$('#modeSeg button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === ui.mode); });
    $$('#objGrid button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-obj') === st.settings.objective); });
    $('#view3d').classList.toggle('hidden', ui.view !== '3d');
    $('#view2d').classList.toggle('hidden', ui.view === '3d');
    $$('.only3d').forEach(function (e) { e.classList.toggle('hidden', ui.view !== '3d'); });
    $('#manualTools').classList.toggle('hidden', ui.mode !== 'manual' || ui.view !== '3d');
    $('#stage').classList.toggle('manual', ui.mode === 'manual' && ui.view === '3d');
    $('#tOpacity').value = ui.opacity;
    $('#tVehicle').checked = !!ui.showVehicle;
    $('#tCab').value = ui.cabColor || '#f5f6f8';
    $('#tLogoDel').disabled = !ui.logo;
    $('#tCut').value = ui.cut;
    renderAxesMenu();
    var lay = ['<option value="0">' + esc(t('allLayers')) + '</option>'];
    for (var i = 1; i <= d.maxTier; i++) lay.push('<option value="' + i + '">' + esc(t('layerN', { n: i })) + '</option>');
    $('#tLayer').innerHTML = lay.join('');
    if (ui.layer > d.maxTier) ui.layer = 0;
    $('#tLayer').value = String(ui.layer);
    var n = st.placements.length;
    $('#tStep').max = n;
    $('#tStep').value = ui.step == null ? n : ui.step;
    $('#tStepLbl').textContent = (ui.step == null ? n : ui.step) + ' / ' + n;
    $('#tPlay').innerHTML = I(playTimer ? 'pause' : 'play');
    $('#skuChips').innerHTML = st.cargo.map(function (c) {
      return '<button class="chip' + (ui.hiddenSku[c.id] ? ' off' : '') + '" data-sku="' + esc(c.id) + '"><span class="sw" style="background:' + esc(c.color) + '"></span>' + esc(c.sku) + '</button>';
    }).join('');
    $('#optSupport').value = String(st.settings.minSupport);
    $('#optTime').value = String(st.settings.timeLimit);
    $('#optHeavy').checked = !!st.settings.heavyBottom;
    $('#optAxle').checked = st.settings.axleAware !== false;
    if (document.activeElement !== $('#optSeg')) $('#optSeg').value = st.settings.segDistance != null ? st.settings.segDistance : 150;
    $('#optLocked').checked = !!st.settings.keepLocked;
    $('#mGrid').value = String(ui.snapGrid);
    $('#mWalls').checked = ui.snapWalls; $('#mItems').checked = ui.snapItems; $('#mGravity').checked = ui.gravity;
    $('#btnUndo').disabled = !S.canUndo();
    $('#btnRedo').disabled = !S.canRedo();
    $('#btnLang').textContent = LP.i18n.lang === 'th' ? 'EN' : 'ไทย';
    if (document.activeElement !== $('#projName')) $('#projName').value = st.project.name;
    var sel = selectedPlacement();
    $('#btnLock').innerHTML = I(sel && sel.locked ? 'unlock' : 'lock');
    $('#btnLock').title = sel && sel.locked ? t('unlock') : t('lock');
    var theme = document.documentElement.getAttribute('data-theme') || 'auto';
    $('#btnTheme').innerHTML = I(theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'auto');
    renderEmpty();
  }

  // x / y / z inputs; with the axes option on they are colour-coded and say where each is measured from
  function selPosHtml(p) {
    var ax = S.ui.axes && S.ui.axes.origin, truck = LP.vehicleType(S.state.container) !== 'container';
    var hint = { x: t(truck ? 'fromLeftSide' : 'fromLeftWall'), y: t('fromFront'), z: t(truck ? 'fromBed' : 'fromFloor') };
    return '<div class="sel-pos' + (ax ? ' axes' : '') + '">' + ['x', 'y', 'z'].map(function (k) {
      var lbl = ax ? '<span><span class="k">' + k.toUpperCase() + '</span><small>' + esc(hint[k]) + '</small></span>' : k;
      return '<label>' + lbl + '<input type="number" step="1" data-pos="' + k + '" value="' + U.round(p[k], 1) + '"' + (p.locked ? ' disabled' : '') + '></label>';
    }).join('') + '<span class="muted small" style="align-self:center">cm</span></div>';
  }

  function renderSelInfo(d) {
    var p = selectedPlacement(), el = $('#selCard');
    if (!p) {
      el.innerHTML = S.ui.mode === 'manual' && S.state.placements.length ? '<div class="sel-card sel-hint">' + esc(t('noSelection')) + '</div>' : '';
      return;
    }
    d = d || derived();
    var s = d.specs[p.sku] || {}, flags = d.val.flags[p.uid] || [];
    el.innerHTML = '<div class="sel-card"><div class="sel-h"><span class="sw" style="background:' + esc(s.color) + '"></span><b>' + esc(s.sku) + '</b><span class="muted">' + esc(s.name || '') + '</span>' +
      (p.locked ? '<span class="pill">' + I('lock') + t('locked') + '</span>' : '') +
      '<button class="ib" data-sel-close title="' + esc(t('close')) + '">' + I('x') + '</button></div>' +
      selPosHtml(p) +
      '<div class="sel-meta"><span>' + U.fmt(p.w, 1) + '×' + U.fmt(p.l, 1) + '×' + U.fmt(p.h, 1) + ' cm</span><span>' + U.fmt(p.weight, 1) + ' kg</span>' +
      '<span>' + t('tier') + ' ' + (d.val.tiers[p.uid] || '–') + '</span><span>' + t('loadOnTop') + ' ' + U.fmt(d.val.loads[p.uid] || 0, 1) + ' kg</span><span>' + t('seq') + ' #' + (p.seq || '–') + '</span></div>' +
      (flags.length ? '<div class="sel-flags">' + flags.map(function (f) {
        var bad = f !== 'heavyOnLight' && f !== 'deliveryBlocked';
        return '<span class="pill ' + (bad ? 'bad' : 'warn') + '">' + esc(LP.t('w_' + f, { n: '' }).replace(/^\s*/, '')) + '</span>';
      }).join('') + '</div>' : '') + '</div>';
    el.querySelectorAll('[data-pos]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var k = inp.getAttribute('data-pos'), v = parseFloat(inp.value);
        if (!isNaN(v)) mutateSelected(function (q) { q[k] = v; });
      });
    });
  }

  function renderAll() {
    var d = derived(), st = S.state;
    var sig = cargoSignature(!(S.ui.multi && S.ui.multi.fleet));   // a fleet plan spans several vehicle types
    if (S.ui.multiSig && S.ui.multiSig !== sig) { S.ui.multi = null; S.ui.multiActive = null; S.ui.multiSig = null; }
    LP.i18n.apply();
    containerUI.render();
    cargoUI.render(d.stats.bySku);
    if (v3d) {
      v3d.setContainer(st.container, vehicleOpts());
      v3d.setData({ placements: st.placements, specs: d.specs, flags: d.val.flags, selected: S.ui.selected, cog: d.stats.cog, filter: filterCtx(d) });
      v3d.setOpacity(S.ui.opacity);
      v3d.setManual(S.ui.mode === 'manual');
    }
    render2D(d);
    renderInsights(d);
    renderPrecheck();
    renderTools(d);
    renderSelInfo(d);
  }

  S.on(function (what) {
    if (what.ui) {
      var d = derived();
      if (v3d) { v3d.setFilter(filterCtx(d)); v3d.setSelected(S.ui.selected); v3d.setManual(S.ui.mode === 'manual'); v3d.setOpacity(S.ui.opacity); }
      render2D(d);
      renderTools(d);
      renderSelInfo(d);
      if (what.summary || S.ui.tab !== 'summary') renderInsights(d);
      return;
    }
    if (what.all || what.doc) renderAll();
  });

  // ------------------------------------------------------------------ selection & manual editing
  function selectedPlacement() {
    var id = S.ui.selected;
    if (!id) return null;
    return S.state.placements.filter(function (p) { return p.uid === id; })[0] || null;
  }
  function select(uid) { S.uiChange({ selected: uid || null }); }

  function payloadLeft(extra) {
    var C = S.state.container;
    if (!(C.maxPayload > 0)) return true;
    var w = S.state.placements.reduce(function (s, p) { return s + (+p.weight || 0); }, 0);
    return w + extra <= C.maxPayload + 1e-6;
  }
  function warnPayload(extra) {
    var w = derived().stats.weight, max = S.state.container.maxPayload;
    LP.toast(t('w_overweight', { weight: U.fmt(w + (extra || 0), 0), max: U.fmt(max, 0), over: U.fmt(w + (extra || 0) - max, 0) }), 'bad');
  }
  function nextSeq() { return S.state.placements.reduce(function (m, p) { return Math.max(m, p.seq || 0); }, 0) + 1; }

  function addOne(skuId) {
    var spec = S.specMap()[skuId];
    if (!spec) return;
    if (!payloadLeft(+spec.weight || 0)) { warnPayload(+spec.weight || 0); return; }
    var spot = E.findSpot(S.state.container, S.state.placements, spec, { minSupport: S.state.settings.minSupport, specs: S.specMap() });
    if (!spot) { LP.toast(t('noSpot'), 'bad'); return; }
    var p = { uid: S.uid(), sku: skuId, x: spot.x, y: spot.y, z: spot.z, w: spot.w, l: spot.l, h: spot.h, weight: +spec.weight || 0, seq: nextSeq() };
    if (spot.ax) p.ax = spot.ax;
    S.change(function (s) { s.placements.push(p); });
    S.uiChange({ selected: p.uid });
  }

  function mutateSelected(fn) {
    var p = selectedPlacement();
    if (!p) return;
    if (p.locked) { LP.toast(t('locked') + ' — ' + t('unlock') + ' (L)', ''); return; }
    S.change(function (s) {
      var q = s.placements.filter(function (x) { return x.uid === p.uid; })[0];
      if (q) fn(q);
    });
  }

  function snapPosition(p, x, y) {
    var ui = S.ui, C = S.state.container, others = S.state.placements;
    var g = +ui.snapGrid || 0;
    if (g > 0) { x = Math.round(x / g) * g; y = Math.round(y / g) * g; }
    var th = Math.max(2, Math.min(12, Math.max(C.W, C.L) * 0.01));
    function snapAxis(v, size, edges) {
      var best = v, bd = th;
      edges.forEach(function (e) {
        var d1 = Math.abs(v - e), d2 = Math.abs(v + size - e);
        if (d1 < bd) { bd = d1; best = e; }
        if (d2 < bd) { bd = d2; best = e - size; }
      });
      return best;
    }
    var ex = [], ey = [];
    if (ui.snapWalls) { ex.push(0, C.W); ey.push(0, C.L); }
    if (ui.snapItems) others.forEach(function (q) {
      if (q.uid === p.uid || q.z > p.z + p.h + 50 || q.z + q.h < p.z - 50) return;
      ex.push(q.x, q.x + q.w); ey.push(q.y, q.y + q.l);
    });
    x = Math.max(0, Math.min(C.W - p.w, snapAxis(x, p.w, ex)));
    y = Math.max(0, Math.min(C.L - p.l, snapAxis(y, p.l, ey)));
    var z = ui.gravity ? E.dropZ({ uid: p.uid, x: x, y: y, w: p.w, l: p.l }, others, Infinity) : p.z;
    return { x: x, y: y, z: z };
  }

  var dragState = null, liveTimer = null;
  function onDrag(uid, x, y) {
    var p = S.state.placements.filter(function (q) { return q.uid === uid; })[0];
    if (!p || p.locked) return null;
    if (!dragState || dragState.uid !== uid) dragState = { uid: uid, snap: S.snapshot(), orig: { x: p.x, y: p.y, z: p.z } };
    var pos = snapPosition(p, x, y);
    p.x = pos.x; p.y = pos.y; p.z = pos.z;   // live edit (committed to history on drop)
    var box = { uid: uid, x: pos.x, y: pos.y, z: pos.z, w: p.w, l: p.l, h: p.h };
    pos.bad = !!E.quickCheck(S.state.container, box, S.state.placements);
    if (!liveTimer) liveTimer = setTimeout(function () {   // throttled live refresh of numbers while dragging
      liveTimer = null;
      cache = compute();
      renderInsights(cache);
      renderSelInfo(cache);
    }, 120);
    return pos;
  }
  function onDragEnd(uid) {
    var ds = dragState;
    dragState = null;
    if (!ds) return;
    if (uid == null) {
      var p0 = S.state.placements.filter(function (q) { return q.uid === ds.uid; })[0];
      if (p0) { p0.x = ds.orig.x; p0.y = ds.orig.y; p0.z = ds.orig.z; }
      S.change(function () {}, { history: false });
      return;
    }
    S.pushHistory(ds.snap);
    S.change(function () {}, { history: false });
  }

  var tipEl = $('#tip');
  function onHover(uid, cx, cy) {
    if (!uid) { tipEl.classList.add('hidden'); return; }
    var p = S.state.placements.filter(function (q) { return q.uid === uid; })[0];
    if (!p) return;
    var s = S.specMap()[p.sku] || {};
    tipEl.innerHTML = '<b>' + esc(s.sku) + '</b> · #' + (p.seq || '') + '<br>' + U.fmt(p.w, 1) + '×' + U.fmt(p.l, 1) + '×' + U.fmt(p.h, 1) + ' cm · ' + U.fmt(p.weight, 1) + ' kg';
    var r = $('#viewer').getBoundingClientRect();
    tipEl.style.left = Math.min(cx - r.left + 14, r.width - 180) + 'px';
    tipEl.style.top = (cy - r.top + 14) + 'px';
    tipEl.classList.remove('hidden');
  }

  function orientationsOf(p) { var s = S.specMap()[p.sku]; return s ? E.orientations(s) : []; }
  function sameDims(o, p) { return Math.abs(o.w - p.w) < 1e-6 && Math.abs(o.l - p.l) < 1e-6 && Math.abs(o.h - p.h) < 1e-6; }
  function clampInside(q) {
    var C = S.state.container;
    q.x = Math.max(0, Math.min(C.W - q.w, q.x));
    q.y = Math.max(0, Math.min(C.L - q.l, q.y));
  }
  function needSel() { var p = selectedPlacement(); if (!p) LP.toast(t('noSelection'), ''); return p; }

  var manualActions = {
    rotate: function () {
      var p = needSel(); if (!p) return;
      var o = orientationsOf(p).filter(function (o) { return Math.abs(o.h - p.h) < 1e-6 && !sameDims(o, p); })[0];
      if (!o) { LP.toast(t('rotFixed'), ''); return; }
      mutateSelected(function (q) { q.w = o.w; q.l = o.l; q.h = o.h; if (o.ax) q.ax = o.ax; clampInside(q); });
    },
    tip: function () {
      var p = needSel(); if (!p) return;
      var ors = orientationsOf(p), i = ors.findIndex(function (o) { return sameDims(o, p); });
      var cand = ors.slice(i + 1).concat(ors.slice(0, i + 1)).filter(function (o) { return Math.abs(o.h - p.h) > 1e-6; })[0];
      if (!cand) { LP.toast(t('rotUpright'), ''); return; }
      mutateSelected(function (q) { q.w = cand.w; q.l = cand.l; q.h = cand.h; if (cand.ax) q.ax = cand.ax; clampInside(q); if (S.ui.gravity) q.z = E.dropZ(q, S.state.placements, Infinity); });
    },
    raise: function () { levelMove(1); },
    lower: function () { levelMove(-1); },
    copy: function () {
      var p = needSel(); if (!p) return;
      if (!payloadLeft(p.weight)) { warnPayload(p.weight); return; }
      var C = S.state.container, all = S.state.placements;
      var tries = [{ x: p.x + p.w, y: p.y, z: p.z }, { x: p.x, y: p.y + p.l, z: p.z }, { x: p.x, y: p.y, z: p.z + p.h }, { x: p.x - p.w, y: p.y, z: p.z }, { x: p.x, y: p.y - p.l, z: p.z }];
      var spot = null;
      for (var i = 0; i < tries.length && !spot; i++) {
        var b = { uid: '_', x: tries[i].x, y: tries[i].y, z: tries[i].z, w: p.w, l: p.l, h: p.h };
        if (!E.quickCheck(C, b, all)) spot = b;
      }
      if (!spot) {
        spot = E.findSpot(C, all, { w: p.w, l: p.l, h: p.h, rotation: 'fixed', pkg: (S.specMap()[p.sku] || {}).pkg }, { specs: S.specMap() });
        if (!spot) { LP.toast(t('noSpot'), 'bad'); return; }
      }
      var q = { uid: S.uid(), sku: p.sku, x: spot.x, y: spot.y, z: spot.z, w: p.w, l: p.l, h: p.h, weight: p.weight, seq: nextSeq() };
      if (p.ax) q.ax = p.ax;
      S.change(function (s) { s.placements.push(q); });
      S.uiChange({ selected: q.uid });
    },
    array: function () {
      var p = needSel(); if (!p) return;
      LP.modal({
        title: t('arrayTitle'), help: 'manual',
        body: '<div class="grid3">' +
          '<label class="fld"><span>' + t('arrayX') + '</span><input type="number" id="aX" min="1" value="2"></label>' +
          '<label class="fld"><span>' + t('arrayY') + '</span><input type="number" id="aY" min="1" value="3"></label>' +
          '<label class="fld"><span>' + t('arrayZ') + '</span><input type="number" id="aZ" min="1" value="1"></label>' +
          '<label class="fld"><span>' + t('gap') + '</span><input type="number" id="aG" min="0" value="0"></label></div>',
        onOk: function (m) {
          var nx = Math.max(1, parseInt(m.querySelector('#aX').value, 10) || 1), ny = Math.max(1, parseInt(m.querySelector('#aY').value, 10) || 1);
          var nz = Math.max(1, parseInt(m.querySelector('#aZ').value, 10) || 1), gap = Math.max(0, parseFloat(m.querySelector('#aG').value) || 0);
          var add = [], seq = nextSeq();
          for (var k = 0; k < nz; k++) for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
            if (!i && !j && !k) continue;
            var q = { uid: S.uid(), sku: p.sku, x: p.x + i * (p.w + gap), y: p.y + j * (p.l + gap), z: p.z + k * p.h, w: p.w, l: p.l, h: p.h, weight: p.weight, seq: seq++ };
            if (p.ax) q.ax = p.ax;
            add.push(q);
          }
          if (!payloadLeft(add.length * p.weight)) { warnPayload(add.length * p.weight); return false; }
          S.change(function (s) { s.placements = s.placements.concat(add); });
        }
      });
    },
    lock: function () {
      var p = needSel(); if (!p) return;
      S.change(function (s) { s.placements.forEach(function (q) { if (q.uid === p.uid) q.locked = !q.locked; }); });
    },
    delete: function () {
      var p = needSel(); if (!p) return;
      S.change(function (s) { s.placements = s.placements.filter(function (q) { return q.uid !== p.uid; }); });
      S.uiChange({ selected: null });
    }
  };
  function levelMove(dir) {
    var p = needSel(); if (!p) return;
    var levels = [0];
    S.state.placements.forEach(function (q) { if (q.uid !== p.uid && E.footprintOverlap(q, p) > 0) levels.push(q.z + q.h); });
    levels.sort(function (a, b) { return a - b; });
    var z = dir > 0 ? levels.filter(function (v) { return v > p.z + 0.05; })[0] : levels.filter(function (v) { return v < p.z - 0.05; }).pop();
    if (z == null) z = dir > 0 ? p.z + p.h : 0;
    mutateSelected(function (q) { q.z = z; });
  }
  function nudge(dx, dy) {
    var p = selectedPlacement(); if (!p || p.locked) return;
    mutateSelected(function (q) { q.x += dx; q.y += dy; clampInside(q); if (S.ui.gravity) q.z = E.dropZ(q, S.state.placements, Infinity); });
  }

  // ------------------------------------------------------------------ auto pack
  function containerForEngine(C) { return { W: +C.W, L: +C.L, H: +C.H, maxPayload: +C.maxPayload || 0, doorW: +C.doorW || 0, doorH: +C.doorH || 0, floorLoad: +C.floorLoad || 0 }; }
  function engineOpts(extra) {
    var st = S.state.settings, C = S.state.container;
    var o = {
      objective: st.objective, timeLimit: +st.timeLimit, minSupport: +st.minSupport, heavyBottom: !!st.heavyBottom, seed: 7,
      floorLoad: +C.floorLoad || 0, segDistance: st.segDistance != null ? +st.segDistance : 150,
      axle: st.axleAware !== false ? LP.axleConfig(C) : null
    };
    for (var k in (extra || {})) o[k] = extra[k];
    return o;
  }

  function autoPack() {
    if (S.ui.packing) { cancelPack(); return; }
    var st = S.state;
    if (!st.cargo.length) { LP.toast(t('noCargo'), 'bad'); return; }
    var opts = engineOpts({ fixed: st.settings.keepLocked ? st.placements.filter(function (p) { return p.locked; }) : [] });
    setPacking(true);
    var C = containerForEngine(st.container);
    client.call('pack', [C, st.cargo, opts], function (pr) {
      var pct = Math.min(100, pr.elapsed / opts.timeLimit * 100) + '%';
      $('#btnPack .prog span').style.width = pct;
      $('#busyOv .prog span').style.width = pct;
      $('#busyTxt').textContent = pr.placed + ' ' + t('pcs') + ' · ' + pr.iter + ' ' + t('runs');
    }).then(function (res) {
      setPacking(false);
      S.change(function (s) {
        s.placements = res.placements;
        s.lastRun = { timeMs: res.timeMs, iterations: res.iterations, objective: res.objective, worker: client.usingWorker(), warnings: res.warnings, unplaced: res.unplaced };
      });
      S.ui.step = null;
      S.ui.multiActive = null;
      S.uiChange({ selected: null, suggestion: null }, { ui: true, summary: true });
      LP.toast(t('packDone', { n: res.placements.length, ms: res.timeMs }) + (res.payloadHit ? ' — ' + LP.issueText(res.warnings[0]) : ''), res.payloadHit ? 'bad' : 'ok');
      if (res.unplaced.length) suggest(C);
    }).catch(function (err) {
      setPacking(false);
      if (err.message !== 'cancelled') LP.toast(t('packFail', { msg: err.message }), 'bad');
    });
  }
  function cancelPack() { client.cancel(); setPacking(false); }
  function setPacking(on) {
    S.ui.packing = on;
    $('#btnPack').classList.toggle('busy', on);
    $('#btnPack .lbl').textContent = on ? t('cancelPack') : t('autoPack');
    $('#busyOv').classList.toggle('hidden', !on);
    $('#btnPack .prog span').style.width = '0%';
    $('#busyOv .prog span').style.width = '0%';
    $('#busyTxt').textContent = '';
    renderEmpty();
  }

  function runMulti(C, then) {
    var st = S.state;
    S.ui.multiBusy = true;
    S.uiChange({}, { ui: true, summary: true });
    client.call('packMulti', [C, st.cargo, engineOpts({ objective: st.settings.objective === 'delivery' ? 'delivery' : 'volume', multiTimeLimit: 450 }), 30]).then(function (m) {
      S.ui.multiBusy = false;
      S.ui.multi = m;
      S.ui.multiSig = cargoSignature();
      S.uiChange({}, { ui: true, summary: true });
      if (then) then(m);
    }).catch(function () { S.ui.multiBusy = false; S.uiChange({}, { ui: true, summary: true }); });
  }

  function suggest(C) {
    var st = S.state, cur = st.container;
    S.uiChange({ suggestion: '<span class="muted">' + t('checking') + '</span>' }, { ui: true, summary: true });
    var presets = LP.allPresets().map(function (p) { return { id: p.id, name: LP.presetName(p), W: p.W, L: p.L, H: p.H, maxPayload: p.maxPayload, doorW: p.doorW, doorH: p.doorH }; });
    runMulti(C, function (m) {
      client.call('suggestContainers', [presets, st.cargo, engineOpts({ objective: 'volume', axle: null, floorLoad: 0 })]).then(function (fits) {
        var h = '<p>' + esc(t('needContainers', { n: m.containers + (m.complete ? '' : '+'), name: LP.containerLabel(cur) })) +
          ' <button class="chip" data-goto-multi>' + I('stack') + t('multiTab') + '</button></p>';
        h += fits.length ? '<p>' + esc(t('fitsIn', { list: '' })) + fits.slice(0, 4).map(function (f) {
          return ' <button class="chip" data-preset="' + esc(f.id) + '">' + esc(f.name) + ' (' + U.fmt(f.volUtil, 0) + '%)</button>';
        }).join('') + '</p>' : '<p class="muted">' + esc(t('noneFits')) + '</p>';
        S.uiChange({ suggestion: h }, { ui: true, summary: true });
      });
    });
  }

  function openMultiLoad(i) {
    var m = S.ui.multi;
    if (!m || !m.loads[i]) return;
    var pl = JSON.parse(JSON.stringify(m.loads[i].placements));
    var sig = S.ui.multiSig, pr = m.loads[i].preset;
    var full = pr && LP.allPresets().filter(function (x) { return x.id === pr.id; })[0];
    S.change(function (s) {
      if (pr) s.container = S.presetToContainer(full || pr);
      s.placements = pl; s.lastRun = null;
    });
    S.ui.multiSig = sig;
    S.ui.multiActive = i;
    S.uiChange({ selected: null, step: null }, { ui: true, summary: true });
  }

  // ------------------------------------------------------------------ animation
  var playTimer = null;
  function togglePlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; S.uiChange({}); return; }
    var n = S.state.placements.length;
    if (!n) return;
    var step = S.ui.step == null || S.ui.step >= n ? 0 : S.ui.step;
    var inc = Math.max(1, Math.ceil(n / 160));
    playTimer = setInterval(function () {
      step = Math.min(n, step + inc);
      S.uiChange({ step: step });
      if (step >= n) { clearInterval(playTimer); playTimer = null; S.uiChange({ step: null }); }
    }, 70);
    S.uiChange({});
  }

  // ------------------------------------------------------------------ samples / project / misc
  function loadSample(id, run) {
    var s = LP.SAMPLES.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var p = LP.PRESETS.filter(function (x) { return x.id === s.container; })[0];
    S.change(function (st) {
      st.container = S.presetToContainer(p);
      st.cargo = [];
      s.cargo.forEach(function (c) { st.cargo.push(LP.normalizeItem(JSON.parse(JSON.stringify(c)), st.cargo)); });
      st.placements = [];
      st.settings.objective = s.objective;
      st.project.name = LP.i18n.lang === 'th' ? s.name : s.nameEn;
      st.lastRun = null;
    });
    S.uiChange({ selected: null, hiddenSku: {}, layer: 0, step: null, suggestion: null, multi: null, multiActive: null });
    if (run) autoPack();
  }

  function renderSampleMenu() {
    $('#menuSamples').innerHTML = LP.SAMPLES.map(function (s) {
      var p = LP.PRESETS.filter(function (x) { return x.id === s.container; })[0];
      var n = s.cargo.reduce(function (a, c) { return a + (c.maxMode ? 0 : c.qty); }, 0);
      return '<button data-sample="' + s.id + '">' + I(p.group === 'truck' ? 'truck' : 'container') + '<span class="smp"><span>' + esc(LP.i18n.lang === 'th' ? s.name : s.nameEn) + '</span><small>' +
        esc(LP.presetName(p)) + ' · ' + s.cargo.length + ' SKU' + (n ? ' · ' + n + ' ' + t('pcs') : '') + '</small></span></button>';
    }).join('');
  }

  function exportAs(kind) {
    var d = derived(), st = S.state;
    if (kind === 'pdf') {
      LP.openReport({
        C: st.container, placements: st.placements, specs: d.specs, flags: d.val.flags, tiers: d.val.tiers, stats: d.stats,
        issues: d.val.issues.concat(d.axle ? d.axle.warnings : []).concat(d.vgm ? d.vgm.warnings : []), axle: d.axle, axleCfg: d.axleCfg, vgm: d.vgm, ship: d.ship, runWarnings: st.lastRun ? (st.lastRun.warnings || []).filter(function (w) { return w.code !== 'unplaced'; }) : [],
        image3d: v3d ? v3d.snapshot() : null
      });
    } else if (kind === 'dn') {
      LP.openDeliveryNote();
    } else if (kind === 'steps') {
      if (!st.placements.length || !v3d) { LP.toast(t('noSteps'), 'bad'); return; }
      var steps = LP.buildSteps(st.placements, st.container.L);
      var images = steps.map(function (g) { return v3d.snapshotStep(g.from, g.to); });
      LP.openStepSheets({ C: st.container, placements: st.placements, specs: d.specs, steps: steps, images: images, project: st.project.name });
    } else if (kind === 'xlsx') { if (!LP.io.exportXLSX(st, d.stats)) LP.toast('SheetJS offline → CSV', ''); }
    else if (kind === 'csv') LP.io.exportPlacementsCSV(st);
    else if (kind === 'cargo') LP.io.exportCargoCSV(st);
  }

  function openHelp() {
    // full user manual (manual.html, built from docs/manual.md) — precached by the service worker, so it works offline
    var w = window.open('manual.html', '_blank');
    if (!w) location.href = 'manual.html';
  }

  function cycleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') || 'auto';
    var next = cur === 'auto' ? 'dark' : cur === 'dark' ? 'light' : 'auto';
    if (next === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('lp.theme', next); } catch (e) { /* ignore */ }
    if (v3d) v3d.applyTheme();
    renderAll();
  }

  // ------------------------------------------------------------------ event bindings
  $('#btnPack').addEventListener('click', autoPack);
  $('#btnCancelPack').addEventListener('click', cancelPack);
  $('#btnClearLayout').addEventListener('click', function () {
    S.change(function (s) { s.placements = s.settings.keepLocked ? s.placements.filter(function (p) { return p.locked; }) : []; s.lastRun = null; });
    S.uiChange({ selected: null, suggestion: null, step: null, multiActive: null }, { ui: true, summary: true });
  });
  $('#objGrid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-obj]');
    if (b) S.change(function (s) { s.settings.objective = b.getAttribute('data-obj'); }, { history: false });
  });
  $('#optSupport').addEventListener('change', function (e) { S.change(function (s) { s.settings.minSupport = +e.target.value; }, { history: false }); });
  $('#optTime').addEventListener('change', function (e) { S.change(function (s) { s.settings.timeLimit = +e.target.value; }, { history: false }); });
  $('#optHeavy').addEventListener('change', function (e) { S.change(function (s) { s.settings.heavyBottom = e.target.checked; }, { history: false }); });
  $('#optAxle').addEventListener('change', function (e) { S.change(function (s) { s.settings.axleAware = e.target.checked; }, { history: false }); });
  $('#optSeg').addEventListener('change', function (e) { var v = Math.max(0, parseFloat(e.target.value) || 0); S.change(function (s) { s.settings.segDistance = v; }, { history: false }); });
  $('#optLocked').addEventListener('change', function (e) { S.change(function (s) { s.settings.keepLocked = e.target.checked; }, { history: false }); });

  $('#viewSeg').addEventListener('click', function (e) { var b = e.target.closest('[data-view]'); if (b) S.uiChange({ view: b.getAttribute('data-view') }); });
  $('#modeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mode]');
    if (!b) return;
    var mode = b.getAttribute('data-mode');
    S.uiChange({ mode: mode, view: mode === 'manual' ? '3d' : S.ui.view });
  });
  $('#camBar').addEventListener('click', function (e) { var b = e.target.closest('[data-cam]'); if (b && v3d) v3d.setCamera(b.getAttribute('data-cam')); });
  $('#tOpacity').addEventListener('input', function (e) { S.uiChange({ opacity: +e.target.value }); });
  $('#tCab').addEventListener('change', function (e) {
    S.ui.cabColor = e.target.value;
    try { localStorage.setItem('lp.cabColor', e.target.value); } catch (err) { /* ignore */ }
    refreshVehicle();
  });
  $('#tLogo').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      // downscale to ≤ 512 px so it fits comfortably in localStorage
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, 512 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        S.ui.logo = c.toDataURL('image/png');
        try { localStorage.setItem('lp.logo', S.ui.logo); } catch (err) { LP.toast(t('logoTooBig'), 'bad'); }
        refreshVehicle();
        S.uiChange({});
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
    e.target.value = '';
  });
  $('#tLogoDel').addEventListener('click', function () {
    S.ui.logo = null;
    try { localStorage.removeItem('lp.logo'); } catch (err) { /* ignore */ }
    refreshVehicle();
    S.uiChange({});
  });
  $('#tVehicle').addEventListener('change', function (e) {
    S.ui.showVehicle = e.target.checked;
    try { localStorage.setItem('lp.vehicle', e.target.checked ? '1' : '0'); } catch (err) { /* ignore */ }
    if (v3d) v3d.setContainer(S.state.container, vehicleOpts());
  });
  $('#axGizmo').addEventListener('change', function (e) { setAxes({ gizmo: e.target.checked }); });
  $('#axOrigin').addEventListener('change', function (e) { setAxes({ origin: e.target.checked }); });
  $('#axRuler').addEventListener('change', function (e) { setAxes({ ruler: e.target.checked }); });
  $('#axCube').addEventListener('change', function (e) { setAxes({ cube: e.target.checked }); });
  $('#axRulerStep').addEventListener('change', function (e) { setAxes({ rulerStep: +e.target.value }); });
  $('#axRulerMode').addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (b) setAxes({ rulerMode: b.getAttribute('data-rm') }); });
  $('#axOff').addEventListener('click', function () { setAxes({ gizmo: false, origin: false, ruler: false, cube: false }); });
  $('#tCut').addEventListener('input', function (e) { S.uiChange({ cut: +e.target.value }); });
  $('#tLayer').addEventListener('change', function (e) { S.uiChange({ layer: +e.target.value }); });
  $('#tStep').addEventListener('input', function (e) { var v = +e.target.value; S.uiChange({ step: v >= S.state.placements.length ? null : v }); });
  $('#tPlay').addEventListener('click', togglePlay);
  $('#skuChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sku]');
    if (!b) return;
    var h = Object.assign({}, S.ui.hiddenSku), id = b.getAttribute('data-sku');
    if (h[id]) delete h[id]; else h[id] = true;
    S.uiChange({ hiddenSku: h });
  });
  $('#mGrid').addEventListener('change', function (e) { S.ui.snapGrid = +e.target.value; });
  $('#mWalls').addEventListener('change', function (e) { S.ui.snapWalls = e.target.checked; });
  $('#mItems').addEventListener('change', function (e) { S.ui.snapItems = e.target.checked; });
  $('#mGravity').addEventListener('change', function (e) { S.ui.gravity = e.target.checked; });
  $('#manualTools').addEventListener('click', function (e) {
    var b = e.target.closest('[data-m]');
    if (b && manualActions[b.getAttribute('data-m')]) manualActions[b.getAttribute('data-m')]();
  });
  $('#btnUndo').addEventListener('click', function () { S.undo(); });
  $('#btnRedo').addEventListener('click', function () { S.redo(); });
  $('#btnFull').addEventListener('click', function () {
    var st = $('#stage');
    if (document.fullscreenElement) document.exitFullscreen(); else if (st.requestFullscreen) st.requestFullscreen();
  });
  // popovers (display / snap)
  $$('.pop > .ib').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var pop = b.parentElement, open = pop.classList.contains('open');
      $$('.pop.open').forEach(function (p) { p.classList.remove('open'); });
      if (!open) pop.classList.add('open');
    });
  });
  $$('.pop-panel').forEach(function (p) { p.addEventListener('click', function (e) { e.stopPropagation(); }); });
  $('#selCard').addEventListener('click', function (e) { if (e.target.closest('[data-sel-close]')) select(null); });
  $('#emptyOv').addEventListener('click', function (e) {
    var b = e.target.closest('[data-empty]');
    if (!b) return;
    var a = b.getAttribute('data-empty');
    if (a === 'pack') autoPack();
    if (a === 'add') cargoUI.openForm(null);
    if (a === 'sample') { $('#btnSamples').click(); }
  });

  // insights
  $('#insHelp').addEventListener('click', function () {
    this.href = 'manual.html#' + ({ summary: 'results', steps: 'loading', multi: 'multi' }[S.ui.tab] || 'results');
  });
  $('#insTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) { S.ui.tab = b.getAttribute('data-tab'); renderInsights(derived()); } });
  $('.ins-body').addEventListener('click', function (e) {
    var li = e.target.closest('[data-uids]');
    if (li) { S.uiChange({ selected: li.getAttribute('data-uids').split(',')[0] }); return; }
    var pb = e.target.closest('[data-preset]');
    if (pb) {
      var p = LP.allPresets().filter(function (x) { return x.id === pb.getAttribute('data-preset'); })[0];
      if (p) { S.change(function (s) { s.container = S.presetToContainer(p); s.placements = s.placements.filter(function (q) { return q.locked; }); }); S.ui.suggestion = null; autoPack(); }
      return;
    }
    if (e.target.closest('[data-goto-multi]')) { S.ui.tab = 'multi'; renderInsights(derived()); return; }
    if (e.target.closest('[data-ship-edit]')) { LP.openShipment(); return; }
    if (e.target.closest('[data-dn]')) { LP.openDeliveryNote(); return; }
    if (e.target.closest('[data-checklist]')) { LP.openChecklist(); return; }
    if (e.target.closest('[data-stepsheet]')) { exportAs('steps'); return; }
    var stp = e.target.closest('[data-to]');
    if (stp) { S.uiChange({ step: +stp.getAttribute('data-to') }); return; }
    if (e.target.closest('[data-steps-play]')) { togglePlay(); return; }
    if (e.target.closest('[data-steps-all]')) { S.uiChange({ step: null }); return; }
    if (e.target.closest('[data-multi-run]')) { runMulti(containerForEngine(S.state.container)); return; }
    var mo = e.target.closest('[data-multi-open]');
    if (mo) openMultiLoad(+mo.getAttribute('data-multi-open'));
  });

  // step cards collapse
  var collapsed = {};
  try { collapsed = JSON.parse(localStorage.getItem('lp.collapsed') || '{}'); } catch (e) { collapsed = {}; }
  $$('.step').forEach(function (sec) {
    if (collapsed[sec.id]) sec.classList.add('collapsed');
    sec.querySelector('[data-toggle]').addEventListener('click', function (e) {
      if (e.target.closest('.hl')) return;   // "?" opens the manual, it doesn't fold the card
      sec.classList.toggle('collapsed');
      collapsed[sec.id] = sec.classList.contains('collapsed');
      try { localStorage.setItem('lp.collapsed', JSON.stringify(collapsed)); } catch (e) { /* ignore */ }
    });
  });

  $('#projName').addEventListener('change', function (e) { S.change(function (s) { s.project.name = e.target.value || 'Load plan'; }, { history: false }); });
  $('#btnTour').addEventListener('click', function () { $$('.dd-menu').forEach(function (m) { m.classList.remove('open'); }); LP.startTour(); });
  $('#btnNew').addEventListener('click', function () { if (confirm(t('confirmNew'))) { S.reset(); S.ui.multi = null; } });
  $('#btnSave').addEventListener('click', function () { LP.io.saveProject(S.state); LP.toast(t('saved'), 'ok'); });
  $('#openFile').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (!f) return;
    LP.io.loadProject(f).then(function (d) { S.load(d); LP.toast(t('loaded'), 'ok'); }).catch(function (err) { LP.toast(t('importFail', { msg: err.message }), 'bad'); });
    e.target.value = '';
  });
  $('#btnCompare').addEventListener('click', function () {
    if (!S.state.cargo.length) { LP.toast(t('noCargo'), 'bad'); return; }
    // same engine options as Auto Pack (axle limits depend on the vehicle, so they are left out), and the plan
    // on screen as a baseline for the current container when it has no errors
    var d = derived(), st = S.state;
    var current = st.placements.length && !d.val.issues.some(function (i) { return i.severity === 'error'; }) ? st.placements : null;
    var cmpCtx = { opts: engineOpts({ axle: null, fixed: [] }), current: current };
    LP.openCompare(client, function (p) {
      S.change(function (s) { s.container = S.presetToContainer(p); s.placements = s.placements.filter(function (q) { return q.locked; }); });
      autoPack();
    }, function (r) {
      S.ui.multi = {
        containers: r.units.length, complete: r.complete, leftover: r.leftover, fleet: true, total: r.total, costProxy: r.costProxy,
        loads: r.units.map(function (u) { return { count: u.count, weight: u.weight, volUtil: u.volUtil, placements: u.placements, preset: u.preset, name: u.name }; })
      };
      S.ui.multiSig = cargoSignature(false);
      S.ui.tab = 'multi';
      openMultiLoad(0);
    }, cmpCtx);
  });
  $('#btnHelp').addEventListener('click', openHelp);
  $('#btnTheme').addEventListener('click', cycleTheme);
  $('#btnLang').addEventListener('click', function () {
    LP.i18n.lang = LP.i18n.lang === 'th' ? 'en' : 'th';
    try { localStorage.setItem('lp.lang', LP.i18n.lang); } catch (e) { /* ignore */ }
    renderSampleMenu();
    if (v3d) v3d.relabel();
    renderAll();
  });
  $$('.topbar .dd > button').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = b.nextElementSibling, open = menu.classList.contains('open');
      $$('.dd-menu').forEach(function (m) { m.classList.remove('open'); });
      if (!open) menu.classList.add('open');
    });
  });
  document.addEventListener('click', function () {
    $$('.dd-menu').forEach(function (m) { m.classList.remove('open'); });
    $$('.pop.open').forEach(function (p) { p.classList.remove('open'); });
  });
  $('#menuSamples').addEventListener('click', function (e) { var b = e.target.closest('[data-sample]'); if (b) loadSample(b.getAttribute('data-sample'), true); });
  $('#menuExport').addEventListener('click', function (e) { var b = e.target.closest('[data-exp]'); if (b) exportAs(b.getAttribute('data-exp')); });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || document.querySelector('.modal-bg')) return;
    var k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) S.redo(); else S.undo(); return; }
    if (ctrl && (k === 'y' || k === 'Y')) { e.preventDefault(); S.redo(); return; }
    if (ctrl && (k === 's' || k === 'S')) { e.preventDefault(); LP.io.saveProject(S.state); LP.toast(t('saved'), 'ok'); return; }
    if (k === '?') { openHelp(); return; }
    if (!selectedPlacement()) return;
    var g = e.shiftKey ? 1 : (S.ui.snapGrid || 5);
    if (ctrl && (k === 'd' || k === 'D' || k === 'c' || k === 'C')) { e.preventDefault(); manualActions.copy(); return; }
    if (ctrl) return;
    if (k === 'r' || k === 'R') manualActions.rotate();
    else if (k === 't' || k === 'T') manualActions.tip();
    else if (k === 'l' || k === 'L') manualActions.lock();
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); manualActions.delete(); }
    else if (k === 'PageUp') { e.preventDefault(); manualActions.raise(); }
    else if (k === 'PageDown') { e.preventDefault(); manualActions.lower(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); nudge(0, -g); }
    else if (k === 'ArrowRight') { e.preventDefault(); nudge(0, g); }
    else if (k === 'ArrowUp') { e.preventDefault(); nudge(g, 0); }
    else if (k === 'ArrowDown') { e.preventDefault(); nudge(-g, 0); }
    else if (k === 'Escape') select(null);
  });

  // ------------------------------------------------------------------ offline (PWA)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !root.__e2e) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
  }
  root.addEventListener('offline', function () { LP.toast(t('offlineMode'), ''); });
  root.addEventListener('online', function () { LP.toast(t('onlineAgain'), 'ok'); });

  // ------------------------------------------------------------------ boot
  renderSampleMenu();
  if (!S.restoreAutosave()) loadSample('mixed', true);
  else renderAll();
  // guided tour: first visit, or index.html?tour=1 (linked from the manual); never during automated UI tests
  if (!root.__e2e && (/[?&]tour=1/.test(location.search) || !LP.tourSeen())) setTimeout(LP.startTour, 900);
  root.LPApp = { autoPack: autoPack, loadSample: loadSample, derived: derived, manual: manualActions, viewer3d: v3d, runMulti: runMulti, openMultiLoad: openMultiLoad };
})(this);
