/* Container & Truck Load Planner — components/containerSelect.js
 * Preset tiles (containers / trucks / custom) + editable inner dimensions, payload, cost.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};
  function esc(s) { return LP.esc(s); }

  function presetName(p) { return LP.i18n.lang === 'th' && p.nameTh ? p.nameTh : p.name; }
  LP.presetName = presetName;
  LP.allPresets = function () { return LP.PRESETS.concat(LP.store.customPresets()); };

  LP.ContainerSelect = function (el) {
    var S = LP.store, t = LP.t, U = LP.units;
    var tab = null, lastId = null;

    function groupOf(id) {
      var p = LP.PRESETS.filter(function (x) { return x.id === id; })[0];
      return p ? p.group : 'custom';
    }

    function tileHtml(p, on) {
      return '<button class="tile' + (on ? ' on' : '') + '" data-preset="' + esc(p.id) + '"><b>' + esc(presetName(p)) + '</b><span>' +
        U.fmt(p.W / 100, 2) + ' × ' + U.fmt(p.L / 100, 2) + ' × ' + U.fmt(p.H / 100, 2) + ' m · ' + U.fmt(p.maxPayload / 1000, 1) + ' t</span></button>';
    }

    function dimField(id, label, val, unit, step) {
      return '<label class="fld"><span>' + esc(label) + '</span><div class="unit-in"><input type="number" id="' + id + '" min="0" step="' + step + '" value="' + esc(val) + '"><em>' + unit + '</em></div></label>';
    }

    function render() {
      var C = S.state.container, custom = S.customPresets();
      if (!tab || C.presetId !== lastId) tab = groupOf(C.presetId);  // follow external changes (sample, compare, undo)
      lastId = C.presetId;
      var list = tab === 'custom' ? custom : LP.PRESETS.filter(function (p) { return p.group === tab; });
      var tiles = list.map(function (p) { return tileHtml(p, p.id === C.presetId); }).join('');
      if (tab === 'custom') {
        var isCur = !LP.allPresets().some(function (p) { return p.id === C.presetId; });
        tiles = '<button class="tile' + (isCur ? ' on' : '') + '" data-preset="__custom"><b>' + esc(isCur ? C.name : t('custom')) + '</b><span>' +
          (isCur ? U.fmt(C.W / 100, 2) + ' × ' + U.fmt(C.L / 100, 2) + ' × ' + U.fmt(C.H / 100, 2) + ' m' : t('edit') + '…') + '</span></button>' + tiles;
      }
      var vol = C.W * C.L * C.H / 1e6;
      el.innerHTML =
        '<div class="ctabs">' +
        ['container', 'truck', 'custom'].map(function (g) {
          var ic = g === 'container' ? 'container' : g === 'truck' ? 'truck' : 'custom';
          var lbl = g === 'container' ? t('tabContainer') : g === 'truck' ? t('tabTruck') : t('custom');
          return '<button data-tab="' + g + '"' + (tab === g ? ' class="on"' : '') + '>' + LP.icon(ic) + esc(lbl) + '</button>';
        }).join('') + '</div>' +
        '<div class="tiles">' + tiles + '</div>' +
        '<div class="dims">' +
        dimField('cW', t('width'), U.round(C.W / 100, 3), 'm', 0.01) +
        dimField('cL', t('length'), U.round(C.L / 100, 3), 'm', 0.01) +
        dimField('cH', t('height'), U.round(C.H / 100, 3), 'm', 0.01) +
        '<div class="span3">' + dimField('cP', t('payload'), C.maxPayload, 'kg', 10) + '</div>' +
        '</div>' +
        '<div class="door-row"><span class="door-l">' + LP.icon('door') + t('doorOpening') + '</span>' +
        dimField('cDW', t('width'), U.round((C.doorW || C.W) / 100, 3), 'm', 0.01) +
        dimField('cDH', t('height'), U.round((C.doorH || C.H) / 100, 3), 'm', 0.01) + '</div>' +
        '<div class="cmeta"><span>' + t('volume') + ' <b>' + U.fmt(vol, 2) + ' m³</b></span><span>' + t('floorArea') + ' <b>' + U.fmt(C.W * C.L / 1e4, 2) + ' m²</b></span></div>' +
        '<details class="adv"><summary>' + LP.icon('sliders') + '<span>' + t('advanced') + '</span></summary>' +
        '<div class="grid2">' + dimField('cFL', t('floorLoad'), C.floorLoad || 0, 'kg/m²', 100) +
        (isBoxContainer(C) ? dimField('cTare', t('containerTare'), C.tare || 0, 'kg', 10) + dimField('cMG', t('maxGross'), C.maxGross || 0, 'kg', 10) : '') +
        '</div><div class="grid2">' + dimField('cCost', t('costTrip'), C.cost || 0, '฿', 100) +
        '<label class="fld"><span>' + t('vehicleType') + '</span><select id="cVeh">' +
        [['', t('vehAuto') + ' (' + t('veh_' + LP.vehicleType(Object.assign({}, C, { vehicle: null }))) + ')'], ['pickup', t('veh_pickup')], ['truck4', t('veh_truck4')], ['truck6', t('veh_truck6')], ['truck10', t('veh_truck10')], ['trailer', t('veh_trailer')], ['container', t('veh_container')]].map(function (o) {
          return '<option value="' + o[0] + '"' + ((C.vehicle || '') === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select></label></div>' +
        axleEditor(C) +
        '<div class="row gap"><button class="btn sm" id="cSave">' + LP.icon('save') + t('saveAsPreset') + '</button>' +
        (custom.some(function (p) { return p.id === C.presetId; }) ? '<button class="btn sm ghost danger" id="cDel">' + LP.icon('trash') + t('deletePreset') + '</button>' : '') + '</div></details>';
      bind();
      var chip = document.getElementById('chipContainer');
      if (chip) chip.textContent = (C.nameTh && LP.i18n.lang === 'th' ? C.nameTh : C.name) || '';
    }

    /** Shipping container (own tare / max gross / VGM) rather than a truck body. */
    function isBoxContainer(C) {
      var vt = LP.vehicleType(C);
      return vt === 'container' || vt === 'trailer' || C.tare > 0;
    }
    LP.isBoxContainer = isBoxContainer;

    function axleEditor(C) {
      var cfg = LP.axleConfig(C);
      if (!cfg) return '';
      function inp(k, i, v) { return '<input type="number" min="0" step="50" data-axle="' + k + '" data-i="' + i + '" value="' + Math.round(v) + '">'; }
      return '<div class="axle-ed"><div class="pop-h sm">' + LP.icon('scale') + t('axleLoads') + ' <span class="muted">(' + t('axleDefaultsNote') + ')</span></div>' +
        '<table class="tbl"><thead><tr><th>' + t('axleGroup') + '</th><th class="n">' + t('axlePos') + '</th><th class="n">' + t('axleTare') + '</th><th class="n">' + t('axleLimit') + '</th></tr></thead><tbody>' +
        cfg.groups.map(function (g, i) {
          return '<tr><td>' + esc(t('ax_' + g.key)) + (g.n > 1 ? ' ×' + g.n : '') + '</td><td class="n">' + U.fmt(g.y, 0) + '</td><td class="n">' + inp('tare', i, g.tare) + '</td><td class="n">' + inp('limit', i, g.limit) + '</td></tr>';
        }).join('') +
        '<tr><td>' + t('bodyTare') + '</td><td class="n">' + U.fmt(cfg.bodyY, 0) + '</td><td class="n">' + inp('body', 0, cfg.bodyTare) + '</td><td></td></tr>' +
        '<tr><td><b>GVW</b></td><td></td><td></td><td class="n">' + inp('gvw', 0, cfg.gvwLimit) + '</td></tr>' +
        '</tbody></table><div class="row gap"><button class="btn sm ghost" id="axReset">' + LP.icon('reset') + t('resetDefaults') + '</button></div></div>';
    }

    function bind() {
      var veh = el.querySelector('#cVeh');
      if (veh) veh.addEventListener('change', function () {
        S.change(function (s) { s.container = Object.assign({}, s.container, { vehicle: veh.value || null, axle: null }); });
      });
      el.querySelectorAll('[data-axle]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          var v = parseFloat(inp.value);
          if (!(v >= 0)) return;
          var k = inp.getAttribute('data-axle'), i = +inp.getAttribute('data-i');
          S.change(function (s) {
            var c = Object.assign({}, s.container), cfg = LP.axleConfig(c);
            var ax = { gvw: cfg.gvwLimit, bodyTare: cfg.bodyTare, groups: cfg.groups.map(function (g) { return { tare: g.tare, limit: g.limit }; }) };
            if (k === 'gvw') ax.gvw = v; else if (k === 'body') ax.bodyTare = v; else ax.groups[i][k] = v;
            c.axle = ax;
            s.container = c;
          });
        });
      });
      var axr = el.querySelector('#axReset');
      if (axr) axr.addEventListener('click', function () { S.change(function (s) { s.container = Object.assign({}, s.container, { axle: null }); }); });
      el.querySelectorAll('[data-tab]').forEach(function (b) {
        b.addEventListener('click', function () { tab = b.getAttribute('data-tab'); render(); });
      });
      el.querySelectorAll('[data-preset]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-preset');
          if (id === '__custom') {
            S.change(function (s) { s.container = Object.assign({}, s.container, { presetId: 'custom', name: s.container.name && s.container.presetId === 'custom' ? s.container.name : t('custom'), nameTh: null }); });
            setTimeout(function () { var w = el.querySelector('#cW'); if (w) w.focus(); }, 30);
            return;
          }
          var p = LP.allPresets().filter(function (x) { return x.id === id; })[0];
          if (p) S.change(function (s) { s.container = S.presetToContainer(p); });
        });
      });
      ['cFL', 'cTare', 'cMG'].forEach(function (id) {
        var inp = el.querySelector('#' + id);
        if (inp) inp.addEventListener('change', function (e) {
          var v = parseFloat(e.target.value);
          if (!(v >= 0)) return;
          var key = id === 'cFL' ? 'floorLoad' : id === 'cTare' ? 'tare' : 'maxGross';
          S.change(function (s) { var c = Object.assign({}, s.container); c[key] = v; s.container = c; });
        });
      });
      ['cW', 'cL', 'cH', 'cP', 'cCost', 'cDW', 'cDH'].forEach(function (id) {
        el.querySelector('#' + id).addEventListener('change', function (e) {
          var v = parseFloat(e.target.value);
          if (!(v >= 0)) return;
          S.change(function (s) {
            var c = Object.assign({}, s.container);
            var oldW = c.W, oldH = c.H;
            if (id === 'cW') c.W = v * 100; if (id === 'cL') c.L = v * 100; if (id === 'cH') c.H = v * 100;
            if (id === 'cP') c.maxPayload = v; if (id === 'cCost') c.cost = v;
            if (id === 'cDW') c.doorW = Math.min(v * 100, c.W);
            if (id === 'cDH') c.doorH = Math.min(v * 100, c.H);
            // keep the door opening inside the box; a door equal to the old size follows the new size
            if (id === 'cW') c.doorW = (!c.doorW || c.doorW >= oldW - 0.5) ? c.W : Math.min(c.doorW, c.W);
            if (id === 'cH') c.doorH = (!c.doorH || c.doorH >= oldH - 0.5) ? c.H : Math.min(c.doorH, c.H);
            if (id !== 'cCost') {
              var base = LP.allPresets().filter(function (p) { return p.id === c.presetId; })[0];
              if (base && (base.W !== c.W || base.L !== c.L || base.H !== c.H || base.maxPayload !== c.maxPayload || (base.doorW || base.W) !== c.doorW || (base.doorH || base.H) !== c.doorH)) {
                c.presetId = 'custom'; c.name = presetName(base) + ' (' + t('custom') + ')'; c.nameTh = null;
              }
            }
            s.container = c;
          });
        });
      });
      el.querySelector('#cSave').addEventListener('click', function () {
        var C = S.state.container;
        var name = prompt(t('saveAsPreset'), C.name || t('custom'));
        if (!name) return;
        var id = 'u' + Date.now().toString(36);
        S.saveCustomPresets(S.customPresets().concat([{ id: id, group: 'custom', name: name, W: C.W, L: C.L, H: C.H, maxPayload: C.maxPayload, cost: C.cost || 0, doorW: C.doorW, doorH: C.doorH, vehicle: C.vehicle || LP.vehicleType(C), axle: C.axle || null, tare: C.tare || 0, maxGross: C.maxGross || 0, floorLoad: C.floorLoad || 0 }]));
        tab = 'custom';
        S.change(function (s) { s.container = Object.assign({}, s.container, { presetId: id, name: name, nameTh: null }); });
      });
      var del = el.querySelector('#cDel');
      if (del) del.addEventListener('click', function () {
        var id = S.state.container.presetId;
        S.saveCustomPresets(S.customPresets().filter(function (p) { return p.id !== id; }));
        S.change(function (s) { s.container = Object.assign({}, s.container, { presetId: 'custom' }); });
      });
    }
    return { render: render };
  };
})(this);
