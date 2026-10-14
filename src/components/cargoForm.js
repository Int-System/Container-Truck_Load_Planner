/* Container & Truck Load Planner — components/cargoForm.js
 * Cargo list (mixed cargo) with inline quantity editing + add/edit form + CSV/Excel import.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};

  LP.nextColor = function (cargo) {
    var used = {};
    cargo.forEach(function (c) { used[c.color] = 1; });
    for (var i = 0; i < LP.PALETTE.length; i++) if (!used[LP.PALETTE[i]]) return LP.PALETTE[i];
    return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  };

  /** Normalise an item (assign id/colour, coerce numbers). Dimensions are cm, weight kg. */
  LP.normalizeItem = function (it, cargo) {
    it.id = it.id || LP.store.uid('c');
    it.color = it.color || LP.nextColor(cargo || []);
    ['w', 'l', 'h', 'weight', 'qty', 'maxStack', 'maxLoad', 'dropOrder'].forEach(function (k) { it[k] = +it[k] || 0; });
    it.qty = Math.max(0, Math.floor(it.qty));
    it.dropOrder = Math.max(1, Math.floor(it.dropOrder || 1));
    if (it.pkg === 'cylinder') { it.l = it.w; if (it.rotation === 'fixed') it.rotation = 'upright'; }
    it.sku = String(it.sku || '').trim() || ('ITEM-' + ((cargo || []).length + 1));
    return it;
  };

  LP.CargoForm = function (el, actions) {
    var S = LP.store, t = LP.t, U = LP.units, esc = LP.esc, I = LP.icon;

    function dimsText(c) {
      var u = c.unit || 'cm';
      if (c.pkg === 'cylinder') return '⌀' + U.fmt(U.fromCm(c.w, u), 2) + ' × ' + U.fmt(U.fromCm(c.h, u), 2) + ' ' + u;
      return U.fmt(U.fromCm(c.w, u), 2) + '×' + U.fmt(U.fromCm(c.l, u), 2) + '×' + U.fmt(U.fromCm(c.h, u), 2) + ' ' + u;
    }
    function flags(c) {
      var f = [];
      if (c.pkg === 'pallet') f.push('<span class="tag" title="' + esc(t('pkgPallet')) + '">PLT</span>');
      if (c.pkg === 'cylinder') f.push('<span class="tag" title="' + esc(t('pkgCylinder')) + '">⌀</span>');
      if (c.fragile) f.push('<span class="tag bad" title="' + esc(t('fragile')) + '">' + esc(t('fragile').split(' ')[0]) + '</span>');
      if (!c.stackable) f.push('<span class="tag" title="' + esc(t('stackable')) + ' ✗">⊘</span>');
      if (c.maxStack) f.push('<span class="tag" title="' + esc(t('maxStack')) + '">≤' + c.maxStack + '</span>');
      if (c.rotation === 'fixed') f.push('<span class="tag" title="' + esc(t('rotFixed')) + '">⇧</span>');
      if (c.rotation === 'all') f.push('<span class="tag" title="' + esc(t('rotAll')) + '">⟳</span>');
      if (c.dropOrder > 1 || S.state.cargo.some(function (x) { return x.dropOrder > 1; })) f.push('<span class="tag drop" title="' + esc(t('dropOrder')) + '">D' + c.dropOrder + '</span>');
      if (c.segGroup) f.push('<span class="tag seg" title="' + esc(t('segGroup')) + '">⚠ ' + esc(c.segGroup) + '</span>');
      if (c.tempZone) f.push('<span class="tag zone-' + c.tempZone + '" title="' + esc(t('tempZone')) + '">' + esc(t('zone' + c.tempZone.charAt(0).toUpperCase() + c.tempZone.slice(1))) + '</span>');
      if (c.pkg === 'pallet' && c.forkFace && c.forkFace !== 'any') f.push('<span class="tag" title="' + esc(t('forkFace')) + '">⇥' + (c.forkFace === 'width' ? 'W' : 'L') + '</span>');
      if (root.LPEngine && !root.LPEngine.doorOrientations(c, S.state.container).length) {
        f.push('<span class="tag bad" title="' + esc(t('doorTooBigHint')) + '">' + LP.icon('door') + esc(t('doorTooBig')) + '</span>');
      }
      return f.join('');
    }

    function render(placedBySku) {
      var cargo = S.state.cargo;
      var h = ['<div class="ctools">',
        '<button class="btn primary sm" id="addItem">' + I('plus') + t('addItem') + '</button>',
        '<button class="btn sm" id="libBtn" title="' + esc(t('libraryHint')) + '">' + I('folder') + t('library') + '</button>',
        '<span class="sp"></span>',
        '<div class="dd"><button class="btn sm ghost" id="cargoMore" title="…">' + I('more') + '</button><div class="dd-menu">',
        '<label class="as-btn">' + I('upload') + t('import') + '<input type="file" id="impFile" accept=".csv,.xlsx,.xls,.txt" hidden></label>',
        '<button id="tplBtn">' + I('download') + t('template') + '</button>',
        cargo.length ? '<button id="saveAllLib">' + I('save') + t('libSaveAll') + '</button>' : '',
        '<button id="expCargo">' + I('list') + t('exportCargoCsv') + '</button>',
        cargo.length ? '<button id="clrCargo">' + I('trash') + t('clearCargo') + '</button>' : '',
        '</div></div></div>'];
      if (!cargo.length) h.push('<div class="empty">' + I('box') + t('noCargo') + '</div>');
      else {
        h.push('<div class="cargo-list">');
        cargo.forEach(function (c, ci) {
          var placed = placedBySku[c.id] || 0;
          var status = c.maxMode ? '<span class="pill">' + placed + ' ' + t('pcs') + '</span>'
            : '<span class="pill ' + (placed >= c.qty ? 'ok' : placed ? 'warn' : '') + '">' + placed + '/' + c.qty + '</span>';
          h.push('<div class="ci" data-id="' + esc(c.id) + '">' +
            '<span class="ci-sw" style="background:' + esc(c.color) + '" data-act="edit" title="' + esc(t('edit')) + '">' + (ci + 1) + '</span>' +
            '<div class="ci-main"><div class="ci-t"><b>' + esc(c.sku) + '</b><span class="muted">' + esc(c.name || '') + '</span></div>' +
            '<div class="ci-d">' + dimsText(c) + ' · ' + U.fmt(U.fromKg(c.weight, c.wunit || 'kg'), 2) + ' ' + (c.wunit || 'kg') + ' ' + flags(c) + '</div>' +
            '<div class="ci-acts"><button data-act="add" title="' + esc(t('addToContainer')) + '">' + I('plus') + '</button>' +
            '<button data-act="edit" title="' + esc(t('edit')) + '">' + I('edit') + '</button>' +
            '<button data-act="dup" title="' + esc(t('copy')) + '">' + I('copy') + '</button>' +
            '<button data-act="lib" title="' + esc(t('libSave')) + '">' + I('save') + '</button>' +
            '<button data-act="del" class="del" title="' + esc(t('delete')) + '">' + I('trash') + '</button></div></div>' +
            '<div class="ci-side"><div class="qty' + (c.maxMode ? ' is-max' : '') + '">' +
            '<button data-act="dec" aria-label="-">' + I('minus') + '</button>' +
            '<input type="number" min="0" step="1" value="' + (c.maxMode ? '' : c.qty) + '" placeholder="∞" data-act="qty"' + (c.maxMode ? ' disabled' : '') + '>' +
            '<button data-act="inc" aria-label="+">' + I('plus') + '</button>' +
            '<button class="max" data-act="max" title="' + esc(t('maxMode')) + '">MAX</button></div>' + status + '</div></div>');
        });
        h.push('</div>');
        var tot = totals(cargo);
        h.push('<div class="ctotal"><span>' + cargo.length + ' ' + t('items') + '</span><span><b>' + U.fmt(tot.count, 0) + '</b> ' + t('pcs') + (tot.anyMax ? ' + MAX' : '') + '</span>' +
          '<span><b>' + U.fmt(tot.weight, 0) + '</b> ' + t('kg') + '</span><span><b>' + U.fmt(tot.volume / 1e6, 2) + '</b> m³</span></div>');
      }
      el.innerHTML = h.join('');
      var chip = document.getElementById('chipCargo');
      if (chip) chip.textContent = cargo.length ? cargo.length + ' ' + t('items') : '';
      bind();
    }

    function totals(cargo) {
      var r = { count: 0, weight: 0, volume: 0, anyMax: false };
      cargo.forEach(function (c) {
        if (c.maxMode) { r.anyMax = true; return; }
        r.count += c.qty; r.weight += c.qty * c.weight; r.volume += c.qty * c.w * c.l * c.h;
      });
      return r;
    }
    LP.cargoTotals = totals;

    function setItem(id, fn) {
      S.change(function (s) { s.cargo.forEach(function (c) { if (c.id === id) fn(c); }); });
    }

    function bind() {
      el.querySelector('#addItem').onclick = function () { openForm(null); };
      el.querySelector('#libBtn').onclick = function () { LP.openLibrary(); };
      var sal = el.querySelector('#saveAllLib');
      if (sal) sal.onclick = function () {
        var r = S.upsertLibrary(S.state.cargo);
        LP.toast(t('libImported', { a: r.added, u: r.updated }), 'ok');
      };
      el.querySelector('#tplBtn').onclick = function () { LP.io.download('cargo-template.csv', LP.io.templateCSV(), 'text/csv'); };
      el.querySelector('#expCargo').onclick = function () { LP.io.exportCargoCSV(S.state); };
      var more = el.querySelector('#cargoMore');
      more.onclick = function (e) {
        e.stopPropagation();
        var m = more.nextElementSibling, open = m.classList.contains('open');
        document.querySelectorAll('.dd-menu.open').forEach(function (x) { x.classList.remove('open'); });
        if (!open) m.classList.add('open');
      };
      var clr = el.querySelector('#clrCargo');
      if (clr) clr.onclick = function () {
        if (!confirm(t('confirmClear'))) return;
        S.change(function (s) { s.cargo = []; s.placements = []; });
      };
      el.querySelector('#impFile').onchange = function (e) {
        var f = e.target.files[0];
        if (!f) return;
        LP.io.importCargo(f).then(function (items) {
          S.change(function (s) { items.forEach(function (it) { s.cargo.push(LP.normalizeItem(it, s.cargo)); }); });
          LP.toast(t('importDone', { n: items.length }), 'ok');
        }).catch(function (err) { LP.toast(t('importFail', { msg: err.message }), 'bad'); });
        e.target.value = '';
      };
      el.querySelectorAll('.ci').forEach(function (row) {
        var id = row.getAttribute('data-id');
        function item() { return S.state.cargo.filter(function (c) { return c.id === id; })[0]; }
        row.addEventListener('click', function (e) {
          var b = e.target.closest('[data-act]');
          if (!b || b.tagName === 'INPUT') return;
          var act = b.getAttribute('data-act');
          if (act === 'edit') openForm(item());
          if (act === 'del') S.change(function (s) {
            s.cargo = s.cargo.filter(function (c) { return c.id !== id; });
            s.placements = s.placements.filter(function (p) { return p.sku !== id; });
          });
          if (act === 'dup') S.change(function (s) {
            var c = JSON.parse(JSON.stringify(item()));
            c.id = null; c.color = null; c.sku = c.sku + '-2';
            s.cargo.push(LP.normalizeItem(c, s.cargo));
          });
          if (act === 'add') actions.addOne(id);
          if (act === 'lib') { var r = S.upsertLibrary([item()]); LP.toast(t(r.added ? 'libSavedNew' : 'libSavedUpd', { sku: item().sku }), 'ok'); }
          if (act === 'inc') setItem(id, function (c) { if (c.maxMode) c.maxMode = false; c.qty = (c.qty || 0) + 1; });
          if (act === 'dec') setItem(id, function (c) { if (c.maxMode) c.maxMode = false; c.qty = Math.max(0, (c.qty || 0) - 1); });
          if (act === 'max') setItem(id, function (c) { c.maxMode = !c.maxMode; if (!c.maxMode && !c.qty) c.qty = 1; });
        });
        var q = row.querySelector('[data-act="qty"]');
        q.addEventListener('change', function () {
          var v = Math.max(0, parseInt(q.value, 10) || 0);
          setItem(id, function (c) { c.qty = v; c.maxMode = false; });
        });
        q.addEventListener('keydown', function (e) { if (e.key === 'Enter') q.blur(); });
      });
    }

    function openForm(item) {
      var isNew = !item;
      var c = item ? JSON.parse(JSON.stringify(item)) : LP.newItem({ color: LP.nextColor(S.state.cargo), qty: 10 });
      var u = c.unit || 'cm', wu = c.wunit || 'kg';
      function num(id, label, val, step, wrapId) {
        return '<label class="fld"' + (wrapId ? ' id="' + wrapId + '"' : '') + '><span>' + esc(label) + '</span><input type="number" id="' + id + '" min="0" step="' + (step || 'any') + '" value="' + esc(val) + '"></label>';
      }
      function sel(id, label, val, options) {
        return '<label class="fld"><span>' + esc(label) + '</span><select id="' + id + '">' + options.map(function (o) {
          return '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select></label>';
      }
      function sw(id, label, val) { return '<label class="switch"><input type="checkbox" id="' + id + '"' + (val ? ' checked' : '') + '><span class="sl"></span><span>' + esc(label) + '</span></label>'; }
      function pkgOpt(v, ic, label) {
        return '<label><input type="radio" name="fPkg" value="' + v + '"' + (c.pkg === v ? ' checked' : '') + '>' + I(ic) + esc(label) + '</label>';
      }
      var body =
        '<div class="form-sec">' + t('basic') + '</div>' +
        '<div class="grid3">' +
        '<label class="fld"><span>' + t('sku') + '</span><input id="fSku" list="libSkus" autocomplete="off" value="' + esc(c.sku) + '"><datalist id="libSkus">' +
        S.library().map(function (x) { return '<option value="' + esc(x.sku) + '">' + esc(x.name || '') + '</option>'; }).join('') + '</datalist></label>' +
        '<label class="fld"><span>' + t('name') + '</span><input id="fName" value="' + esc(c.name) + '"></label>' +
        '<label class="fld"><span>' + t('color') + '</span><input type="color" id="fColor" value="' + esc(c.color) + '"></label>' +
        '</div>' +
        '<div class="fld"><span>' + t('packageType') + '</span><div class="seg-pick">' + pkgOpt('box', 'box', t('pkgBox')) + pkgOpt('pallet', 'grid', t('pkgPallet')) + pkgOpt('cylinder', 'target', t('pkgCylinder')) + '</div></div>' +
        '<div class="form-sec">' + t('sizeWeight') + '</div>' +
        '<div class="grid3">' +
        num('fW', t('width'), U.round(U.fromCm(c.w, u), 3)) +
        num('fL', t('length'), U.round(U.fromCm(c.l, u), 3), 'any', 'fLwrap') +
        num('fH', t('height'), U.round(U.fromCm(c.h, u), 3)) +
        sel('fUnit', t('unit'), u, [['cm', 'cm'], ['mm', 'mm'], ['m', 'm'], ['in', 'inch']]) +
        num('fWt', t('weight'), U.round(U.fromKg(c.weight, wu), 3)) +
        sel('fWu', t('unit'), wu, [['kg', 'kg'], ['lb', 'lb']]) +
        num('fQty', t('qty'), c.qty, 1) +
        '<div class="fld span2" style="justify-content:flex-end">' + sw('fMax', t('maxMode'), c.maxMode) + '</div>' +
        '</div>' +
        '<div class="form-sec">' + t('handling') + '</div>' +
        '<div class="grid2">' +
        sel('fRot', t('rotation'), c.rotation, [['upright', t('rotUpright')], ['all', t('rotAll')], ['fixed', t('rotFixed')]]) +
        num('fDrop', t('dropOrder'), c.dropOrder || 1, 1) +
        num('fStack', t('maxStack'), c.maxStack || 0, 1) +
        num('fLoad', t('maxLoad'), U.round(U.fromKg(c.maxLoad || 0, wu), 3)) +
        '</div>' +
        '<div class="row gap wrap" style="gap:4px 22px">' + sw('fStk', t('stackable'), c.stackable !== false) + sw('fFrag', t('fragile'), c.fragile) + '</div>' +
        '<div class="form-sec">' + t('specialRules') + '</div>' +
        '<div class="grid3">' +
        '<label class="fld"><span>' + t('segGroup') + '</span><input id="fSeg" list="segList" value="' + esc(c.segGroup || '') + '" placeholder="' + esc(t('segGroupPh')) + '"><datalist id="segList">' +
        ['DG 1', 'DG 2', 'DG 3', 'DG 4', 'DG 5', 'DG 6', 'DG 8', 'DG 9', 'FOOD', 'CHEM'].map(function (g) { return '<option value="' + g + '">'; }).join('') + '</datalist></label>' +
        sel('fZone', t('tempZone'), c.tempZone || '', [['', t('zoneNone')], ['frozen', t('zoneFrozen')], ['chilled', t('zoneChilled')], ['ambient', t('zoneAmbient')]]) +
        '<div id="fForkWrap">' + sel('fFork', t('forkFace'), c.forkFace || 'any', [['any', t('forkAny')], ['width', t('forkWidth')], ['length', t('forkLength')]]) + '</div>' +
        '</div>' +
        '<div class="lib-opt">' + sw('fLib', t('libSaveToo'), isNew || S.library().some(function (x) { return String(x.sku).toLowerCase() === String(c.sku).toLowerCase(); })) + '</div>';
      LP.modal({
        title: isNew ? t('newItem') : t('editItem'), help: 'cargo', body: body, okText: t('apply'),
        onOpen: function (m) {
          function sync() {
            var pk = m.querySelector('input[name="fPkg"]:checked').value, cyl = pk === 'cylinder';
            m.querySelector('#fLwrap').style.display = cyl ? 'none' : '';
            m.querySelector('#fForkWrap').style.visibility = pk === 'pallet' ? '' : 'hidden';
            m.querySelector('#fW').previousElementSibling.textContent = cyl ? t('diameter') : t('width');
            m.querySelector('#fQty').disabled = m.querySelector('#fMax').checked;
          }
          m.querySelectorAll('input[name="fPkg"]').forEach(function (r) { r.addEventListener('change', sync); });
          m.querySelector('#fMax').addEventListener('change', sync);
          sync();
          // typing / picking a SKU that exists in the library fills in the rest of the form
          m.querySelector('#fSku').addEventListener('change', function (e) {
            var v = String(e.target.value).trim().toLowerCase();
            var x = S.library().filter(function (l) { return String(l.sku).toLowerCase() === v; })[0];
            if (!x || !isNew) return;
            var xu = x.unit || 'cm', xw = x.wunit || 'kg';
            function set(id, val) { var f = m.querySelector('#' + id); if (f) f.value = val; }
            set('fName', x.name || ''); set('fColor', x.color || c.color); set('fUnit', xu); set('fWu', xw);
            set('fW', U.round(U.fromCm(x.w, xu), 3)); set('fL', U.round(U.fromCm(x.l, xu), 3)); set('fH', U.round(U.fromCm(x.h, xu), 3));
            set('fWt', U.round(U.fromKg(x.weight, xw), 3)); set('fRot', x.rotation || 'upright'); set('fStack', x.maxStack || 0);
            set('fLoad', U.round(U.fromKg(x.maxLoad || 0, xw), 3)); set('fDrop', x.dropOrder || 1);
            set('fSeg', x.segGroup || ''); set('fZone', x.tempZone || ''); set('fFork', x.forkFace || 'any');
            m.querySelector('#fStk').checked = x.stackable !== false;
            m.querySelector('#fFrag').checked = !!x.fragile;
            var pr = m.querySelector('input[name="fPkg"][value="' + (x.pkg || 'box') + '"]');
            if (pr) pr.checked = true;
            sync();
            LP.toast(t('libFilled', { sku: x.sku }), 'ok');
          });
        },
        onOk: function (m) {
          function v(id) { return m.querySelector('#' + id).value; }
          function b(id) { return m.querySelector('#' + id).checked; }
          var unit = v('fUnit'), wunit = v('fWu');
          var it = {
            id: c.id, sku: v('fSku'), name: v('fName'), pkg: m.querySelector('input[name="fPkg"]:checked').value, color: v('fColor'), unit: unit, wunit: wunit,
            w: U.toCm(v('fW'), unit), l: U.toCm(v('fL'), unit), h: U.toCm(v('fH'), unit), weight: U.toKg(v('fWt'), wunit),
            qty: v('fQty'), maxMode: b('fMax'), rotation: v('fRot'), maxStack: v('fStack'), maxLoad: U.toKg(v('fLoad'), wunit),
            dropOrder: v('fDrop'), stackable: b('fStk'), fragile: b('fFrag'),
            segGroup: String(v('fSeg') || '').trim(), tempZone: v('fZone') || '',
            forkFace: m.querySelector('input[name="fPkg"]:checked').value === 'pallet' ? v('fFork') : 'any'
          };
          if (it.pkg === 'cylinder') it.l = it.w;
          if (!(it.w > 0 && it.l > 0 && it.h > 0)) { LP.toast(t('dims') + ' > 0', 'bad'); return false; }
          var toLib = b('fLib');
          S.change(function (s) {
            LP.normalizeItem(it, s.cargo);
            if (toLib) S.upsertLibrary([it]);
            if (isNew) s.cargo.push(it);
            else {
              s.cargo = s.cargo.map(function (x) { return x.id === it.id ? it : x; });
              var o = item;  // size changed → existing placements of this SKU no longer match
              if (o.w !== it.w || o.l !== it.l || o.h !== it.h || o.pkg !== it.pkg) s.placements = s.placements.filter(function (p) { return p.sku !== it.id; });
              else if (o.weight !== it.weight) s.placements.forEach(function (p) { if (p.sku === it.id) p.weight = it.weight; });
            }
          });
        }
      });
    }
    return { render: render, openForm: openForm };
  };
})(this);
