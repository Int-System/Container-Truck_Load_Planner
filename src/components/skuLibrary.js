/* Container & Truck Load Planner — components/skuLibrary.js
 * SKU master library (stored in this browser): search, pick several items with quantities and add
 * them to the job; import / export the library as CSV.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};

  /** Add library items to the job: same SKU code → quantity is added, otherwise a new cargo line. */
  LP.addFromLibrary = function (picks) {
    var S = LP.store, added = 0;
    S.change(function (s) {
      picks.forEach(function (pk) {
        var ex = s.cargo.filter(function (c) { return String(c.sku).toLowerCase() === String(pk.item.sku).toLowerCase(); })[0];
        if (ex) { if (!ex.maxMode) ex.qty = (ex.qty || 0) + pk.qty; }
        else {
          var it = JSON.parse(JSON.stringify(pk.item));
          it.id = null;
          it.qty = pk.qty;
          if (s.cargo.some(function (c) { return c.color === it.color; })) it.color = null;
          s.cargo.push(LP.normalizeItem(it, s.cargo));
        }
        added++;
      });
    });
    return added;
  };

  LP.openLibrary = function () {
    var S = LP.store, t = LP.t, U = LP.units, esc = LP.esc, I = LP.icon;
    var sel = {}, qty = {}, query = '';

    function dims(c) {
      var u = c.unit || 'cm';
      return c.pkg === 'cylinder' ? '⌀' + U.fmt(U.fromCm(c.w, u), 1) + ' × ' + U.fmt(U.fromCm(c.h, u), 1) + ' ' + u
        : U.fmt(U.fromCm(c.w, u), 1) + '×' + U.fmt(U.fromCm(c.l, u), 1) + '×' + U.fmt(U.fromCm(c.h, u), 1) + ' ' + u;
    }
    function rows() {
      var lib = S.library(), q = query.trim().toLowerCase();
      var list = lib.map(function (c, i) { return { c: c, i: i }; }).filter(function (r) {
        return !q || (r.c.sku + ' ' + (r.c.name || '')).toLowerCase().indexOf(q) >= 0;
      });
      if (!list.length) return '<div class="empty">' + I('box') + t(lib.length ? 'libNoMatch' : 'libEmpty') + '</div>';
      return '<div class="lib-list">' + list.map(function (r) {
        var c = r.c, k = c.sku;
        return '<label class="lib-row' + (sel[k] ? ' on' : '') + '"><input type="checkbox" data-k="' + esc(k) + '"' + (sel[k] ? ' checked' : '') + '>' +
          '<span class="sw" style="background:' + esc(c.color || '#888') + '"></span>' +
          '<span class="lib-main"><b>' + esc(c.sku) + '</b> <span class="muted">' + esc(c.name || '') + '</span><br><span class="muted small">' + dims(c) + ' · ' +
          U.fmt(U.fromKg(c.weight, c.wunit || 'kg'), 2) + ' ' + (c.wunit || 'kg') + (c.fragile ? ' · ' + esc(t('fragile').split(' ')[0]) : '') + (c.pkg !== 'box' ? ' · ' + esc(t(c.pkg === 'pallet' ? 'pkgPallet' : 'pkgCylinder')) : '') + '</span></span>' +
          '<input type="number" min="1" step="1" class="lib-q" data-q="' + esc(k) + '" value="' + (qty[k] || c.qty || 1) + '">' +
          '<button class="ib danger" data-del="' + r.i + '" title="' + esc(t('delete')) + '">' + I('trash') + '</button></label>';
      }).join('') + '</div>';
    }
    function countSel() { return Object.keys(sel).filter(function (k) { return sel[k]; }).length; }

    var m = LP.modal({
      title: t('library'), help: 'cargo', wide: true, okText: t('libAdd'),
      body: '<div class="lib-top"><div class="lib-search">' + I('search') + '<input type="text" id="libQ" placeholder="' + esc(t('libSearch')) + '"></div>' +
        '<label class="btn sm">' + I('upload') + t('import') + '<input type="file" id="libImp" accept=".csv,.xlsx,.xls,.txt" hidden></label>' +
        '<button class="btn sm ghost" id="libExp">' + I('download') + t('libExport') + '</button></div>' +
        '<div class="muted small" style="margin:6px 0 8px">' + t('libHint') + '</div><div id="libRows"></div>',
      extraFooter: '<span class="muted small" id="libCount"></span>',
      onOpen: function (el) {
        function refresh() {
          el.querySelector('#libRows').innerHTML = rows();
          var n = countSel();
          el.querySelector('#libCount').textContent = n ? t('libSelected', { n: n }) : '';
          var ok = el.querySelector('[data-ok]');
          if (ok) ok.disabled = !n;
        }
        refresh();
        el.querySelector('#libQ').addEventListener('input', function (e) { query = e.target.value; refresh(); });
        el.querySelector('#libRows').addEventListener('change', function (e) {
          var k = e.target.getAttribute('data-k'), q = e.target.getAttribute('data-q');
          if (k != null) { sel[k] = e.target.checked; refresh(); }
          if (q != null) { qty[q] = Math.max(1, parseInt(e.target.value, 10) || 1); sel[q] = true; refresh(); }
        });
        el.querySelector('#libRows').addEventListener('click', function (e) {
          if (e.target.closest('.lib-q')) { e.preventDefault(); e.target.closest('.lib-q').focus(); return; }
          var d = e.target.closest('[data-del]');
          if (!d) return;
          e.preventDefault();
          var lib = S.library().slice();
          var gone = lib.splice(+d.getAttribute('data-del'), 1)[0];
          if (gone) delete sel[gone.sku];
          S.saveLibrary(lib);
          refresh();
        });
        el.querySelector('#libImp').addEventListener('change', function (e) {
          var f = e.target.files[0];
          if (!f) return;
          LP.io.importCargo(f).then(function (items) {
            var r = S.upsertLibrary(items.map(function (it) { return LP.normalizeItem(it, S.library()); }));
            LP.toast(t('libImported', { a: r.added, u: r.updated }), 'ok');
            refresh();
          }).catch(function (err) { LP.toast(t('importFail', { msg: err.message }), 'bad'); });
          e.target.value = '';
        });
        el.querySelector('#libExp').addEventListener('click', function () { LP.io.exportCargoCSV({ cargo: S.library(), project: { name: 'sku-library' } }); });
        setTimeout(function () { el.querySelector('#libQ').focus(); }, 40);
      },
      onOk: function () {
        var lib = S.library(), picks = [];
        lib.forEach(function (c) { if (sel[c.sku]) picks.push({ item: c, qty: qty[c.sku] || c.qty || 1 }); });
        if (!picks.length) return false;
        var n = LP.addFromLibrary(picks);
        LP.toast(t('libAdded', { n: n }), 'ok');
      }
    });
    return m;
  };
})(this);
