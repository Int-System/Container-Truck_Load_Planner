/* Container & Truck Load Planner — store.js
 * Single source of truth. Every view (3D, 2D, summary, tables) renders from `state`.
 * Document state (container, cargo, placements, settings) is undoable; `ui` state is not.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};
  var MAX_HISTORY = 150, AUTOSAVE_KEY = 'lp.autosave.v1', PRESET_KEY = 'lp.customPresets.v1';

  function presetToContainer(p) {
    return { presetId: p.id, name: p.name, nameTh: p.nameTh, W: p.W, L: p.L, H: p.H, maxPayload: p.maxPayload, cost: p.cost || 0, doorW: p.doorW || p.W, doorH: p.doorH || p.H, vehicle: p.vehicle || null, tare: p.tare || 0, maxGross: p.maxGross || 0, floorLoad: p.floorLoad || 0, axle: p.axle ? JSON.parse(JSON.stringify(p.axle)) : null };
  }

  function defaultState() {
    return {
      project: { name: 'Load plan', version: 1, shipment: {} },
      container: presetToContainer(LP.PRESETS[0]),
      cargo: [],
      placements: [],
      settings: { objective: 'volume', keepLocked: true, minSupport: 0.75, heavyBottom: true, timeLimit: 2500, segDistance: 150, axleAware: true },
      lastRun: null
    };
  }

  var state = defaultState();
  var ui = {
    view: '3d', mode: 'view', selected: null, hiddenSku: {}, layer: 0, cut: 1, opacity: 0.18, step: null,
    snapGrid: 5, snapWalls: true, snapItems: true, gravity: true, packing: false, suggestion: null
  };
  var listeners = [], past = [], future = [], version = 0, saveTimer = null;
  var customPresets = [];
  try { customPresets = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); } catch (e) { customPresets = []; }
  var LIB_KEY = 'lp.skuLibrary.v1', library = null;
  function loadLibrary() {
    if (library) return library;
    try {
      var raw = localStorage.getItem(LIB_KEY);
      library = raw ? JSON.parse(raw) : null;
    } catch (e) { library = null; }
    if (!library) {   // first run: seed with the sample items so the feature is discoverable
      library = [];
      var seen = {};
      LP.SAMPLES.forEach(function (s) {
        s.cargo.forEach(function (c) {
          if (seen[c.sku]) return;
          seen[c.sku] = 1;
          var it = JSON.parse(JSON.stringify(c));
          it.color = it.color || LP.PALETTE[library.length % LP.PALETTE.length];
          if (it.maxMode) { it.maxMode = false; it.qty = 1; }
          library.push(it);
        });
      });
      try { localStorage.setItem(LIB_KEY, JSON.stringify(library)); } catch (e) { /* ignore */ }
    }
    return library;
  }
  /** Fill fields added in later versions (door opening) for older saved projects. */
  function migrateContainer(c) {
    if (!c) return c;
    if (!(c.doorW > 0) || !(c.doorH > 0)) {
      var p = LP.PRESETS.filter(function (x) { return x.id === c.presetId; })[0];
      c.doorW = c.doorW > 0 ? c.doorW : (p && p.doorW) || c.W;
      c.doorH = c.doorH > 0 ? c.doorH : (p && p.doorH) || c.H;
    }
    var pp = LP.PRESETS.filter(function (x) { return x.id === c.presetId; })[0];
    if (pp) ['tare', 'maxGross', 'floorLoad'].forEach(function (k) { if (c[k] == null) c[k] = pp[k] || 0; });
    return c;
  }

  function snapshot() {
    return JSON.stringify({ container: state.container, cargo: state.cargo, placements: state.placements, settings: state.settings, lastRun: state.lastRun });
  }
  function restore(json) {
    var s = JSON.parse(json);
    state.container = s.container; state.cargo = s.cargo; state.placements = s.placements; state.settings = s.settings; state.lastRun = s.lastRun;
  }
  function emit(what) {
    version++;
    listeners.forEach(function (fn) { fn(what || {}); });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
    }, 600);
  }

  var S = {
    get state() { return state; },
    ui: ui,
    get version() { return version; },
    presetToContainer: presetToContainer,
    on: function (fn) { listeners.push(fn); },
    /** Mutate document state. opts.history (default true) records an undo step. */
    change: function (mutator, opts) {
      opts = opts || {};
      if (opts.history !== false) {
        past.push(snapshot());
        if (past.length > MAX_HISTORY) past.shift();
        future = [];
      }
      mutator(state);
      emit(opts.what || { all: true });
    },
    /** Push an undo step for a change that was already applied live (e.g. after a drag). */
    pushHistory: function (prevSnapshot) {
      past.push(prevSnapshot);
      if (past.length > MAX_HISTORY) past.shift();
      future = [];
    },
    snapshot: snapshot,
    uiChange: function (patch, what) {
      for (var k in patch) ui[k] = patch[k];
      listeners.forEach(function (fn) { fn(what || { ui: true }); });
    },
    canUndo: function () { return past.length > 0; },
    canRedo: function () { return future.length > 0; },
    undo: function () {
      if (!past.length) return;
      future.push(snapshot());
      restore(past.pop());
      emit({ all: true });
    },
    redo: function () {
      if (!future.length) return;
      past.push(snapshot());
      restore(future.pop());
      emit({ all: true });
    },
    load: function (data) {
      var d = defaultState();
      state = {
        project: data.project || d.project,
        container: migrateContainer(data.container || d.container),
        cargo: data.cargo || [],
        placements: data.placements || [],
        settings: Object.assign(d.settings, data.settings || {}),
        lastRun: data.lastRun || null
      };
      past = []; future = [];
      ui.selected = null; ui.step = null; ui.hiddenSku = {}; ui.layer = 0;
      emit({ all: true });
    },
    reset: function () { S.load(defaultState()); },
    restoreAutosave: function () {
      try {
        var raw = localStorage.getItem(AUTOSAVE_KEY);
        if (raw) { S.load(JSON.parse(raw)); return true; }
      } catch (e) { /* ignore */ }
      return false;
    },
    library: function () { return loadLibrary(); },
    saveLibrary: function (list) {
      library = list;
      try { localStorage.setItem(LIB_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    },
    /** Add or update library entries by SKU code. Returns {added, updated}. */
    upsertLibrary: function (items) {
      var lib = loadLibrary().slice(), r = { added: 0, updated: 0 };
      items.forEach(function (c) {
        var it = JSON.parse(JSON.stringify(c));
        delete it.id;
        if (it.maxMode) { it.maxMode = false; it.qty = it.qty || 1; }
        var i = lib.findIndex(function (x) { return String(x.sku).toLowerCase() === String(it.sku).toLowerCase(); });
        if (i >= 0) { lib[i] = it; r.updated++; } else { lib.push(it); r.added++; }
      });
      S.saveLibrary(lib);
      return r;
    },
    customPresets: function () { return customPresets; },
    saveCustomPresets: function (list) {
      customPresets = list;
      try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    },
    specMap: function () {
      var m = {};
      state.cargo.forEach(function (c) { m[c.id] = c; });
      return m;
    },
    uid: function (prefix) { return (prefix || 'm') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  };
  LP.store = S;
})(this);
