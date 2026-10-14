/* Container & Truck Load Planner — components/shipment.js
 * Export shipment details + SOLAS VGM (Verified Gross Mass) for shipping containers.
 * Container numbers are validated with the ISO 6346 check digit.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};

  var LETTER = (function () {      // ISO 6346 letter values (multiples of 11 are skipped)
    var m = {}, v = 10;
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (ch) { if (v % 11 === 0) v++; m[ch] = v++; });
    return m;
  })();

  /** Returns { ok, normalized, expected } for a container number like "MSKU1234565". */
  LP.iso6346 = function (no) {
    var s = String(no || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(s)) return { ok: false, normalized: s, format: false };
    var sum = 0;
    for (var i = 0; i < 10; i++) {
      var ch = s[i], val = /[A-Z]/.test(ch) ? LETTER[ch] : +ch;
      sum += val * Math.pow(2, i);
    }
    var check = sum % 11 % 10;
    return { ok: check === +s[10], normalized: s, format: true, expected: check };
  };

  var FIELDS = [
    ['containerNo', 'shipContainerNo', 'text'], ['sealNo', 'shipSealNo', 'text'], ['bookingNo', 'shipBooking', 'text'],
    ['vessel', 'shipVessel', 'text'], ['pol', 'shipPol', 'text'], ['pod', 'shipPod', 'text'],
    ['shipper', 'shipShipper', 'text'], ['consignee', 'shipConsignee', 'text'],
    ['dunnage', 'shipDunnage', 'number'], ['method', 'shipMethod', 'select'],
    ['signatory', 'shipSignatory', 'text'], ['vgmDate', 'shipDate', 'date']
  ];

  LP.openShipment = function () {
    var S = LP.store, t = LP.t, esc = LP.esc;
    var sh = Object.assign({ method: '2', vgmDate: new Date().toISOString().slice(0, 10) }, S.state.project.shipment || {});
    var body = '<div class="grid2">' + FIELDS.map(function (f) {
      var v = sh[f[0]] != null ? sh[f[0]] : '';
      var input = f[2] === 'select'
        ? '<select id="sh_' + f[0] + '"><option value="2"' + (v !== '1' ? ' selected' : '') + '>' + esc(t('vgmMethod2')) + '</option><option value="1"' + (v === '1' ? ' selected' : '') + '>' + esc(t('vgmMethod1')) + '</option></select>'
        : '<input id="sh_' + f[0] + '" type="' + f[2] + '"' + (f[2] === 'number' ? ' min="0" step="1"' : '') + ' value="' + esc(v) + '">';
      return '<label class="fld' + (f[0] === 'shipper' || f[0] === 'consignee' ? ' span2' : '') + '"><span>' + esc(t(f[1])) + (f[0] === 'dunnage' ? ' (kg)' : '') + '</span>' + input +
        (f[0] === 'containerNo' ? '<small class="cn-check" id="cnCheck"></small>' : '') + '</label>';
    }).join('') + '</div><div class="muted small">' + esc(t('vgmNote')) + '</div>';
    LP.modal({
      title: t('shipTitle'), help: 'documents', wide: true, okText: t('apply'), body: body,
      onOpen: function (m) {
        var inp = m.querySelector('#sh_containerNo'), out = m.querySelector('#cnCheck');
        function check() {
          var v = inp.value.trim();
          if (!v) { out.textContent = ''; return; }
          var r = LP.iso6346(v);
          out.className = 'cn-check ' + (r.ok ? 'pos' : 'neg');
          out.textContent = r.ok ? '✓ ' + t('cnValid') : (r.format ? t('cnBadCheck', { d: r.expected }) : t('cnBadFormat'));
        }
        inp.addEventListener('input', check);
        check();
      },
      onOk: function (m) {
        var out = {};
        FIELDS.forEach(function (f) { var el = m.querySelector('#sh_' + f[0]); out[f[0]] = f[2] === 'number' ? Math.max(0, +el.value || 0) : el.value.trim(); });
        if (out.containerNo) out.containerNo = LP.iso6346(out.containerNo).normalized;
        S.change(function (s) { s.project.shipment = out; });
        LP.toast(t('saved'), 'ok');
      }
    });
  };

  /**
   * Delivery note / packing list of what is actually loaded (from the placements), one note per
   * drop group when the job has several drops. Asks for the document details first.
   */
  LP.openDeliveryNote = function () {
    var S = LP.store, t = LP.t, esc = LP.esc, st = S.state;
    if (!st.placements.length) { LP.toast(t('noSteps'), 'bad'); return; }
    var specs = S.specMap(), sh = st.project.shipment || {}, dn = sh.dn || {};
    var now = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var autoNo = 'DN-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes());
    // loaded quantities per drop group
    var groups = {};
    st.placements.forEach(function (p) {
      var s = specs[p.sku] || {}, g = +s.dropOrder || 1;
      (groups[g] = groups[g] || {})[p.sku] = (groups[g][p.sku] || 0) + 1;
    });
    var drops = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; });
    function inp(id, label, val, cls) { return '<label class="fld' + (cls ? ' ' + cls : '') + '"><span>' + esc(label) + '</span><input id="' + id + '" value="' + esc(val || '') + '"></label>'; }
    var body = '<div class="grid3">' +
      inp('dnNo', t('dnNo'), dn.no || autoNo) + '<label class="fld"><span>' + esc(t('date')) + '</span><input id="dnDate" type="date" value="' + esc(dn.date || now.toISOString().slice(0, 10)) + '"></label>' +
      '<label class="fld"><span>' + esc(t('dnCopies')) + '</span><select id="dnCopies"><option value="1">' + esc(t('dnCopy1')) + '</option><option value="2"' + (dn.copies === '2' ? ' selected' : '') + '>' + esc(t('dnCopy2')) + '</option></select></label>' +
      inp('dnFrom', t('dnFrom'), dn.from || sh.shipper, 'span3') +
      inp('dnPlate', t('dnPlate'), dn.plate) + inp('dnDriver', t('dnDriver'), dn.driver) + inp('dnRef', t('dnRef'), dn.ref || sh.bookingNo) +
      '</div><div class="form-sec">' + t('dnTo') + '</div><div class="grid2">' +
      drops.map(function (g) {
        var key = 'dnTo' + g, prev = (dn.to && dn.to[g]) || (drops.length === 1 ? sh.consignee : '');
        return inp(key, drops.length > 1 ? t('dnDropN', { n: g }) : t('dnTo'), prev, 'span2');
      }).join('') + '</div>' +
      '<label class="fld"><span>' + esc(t('dnRemark')) + '</span><input id="dnRemark" value="' + esc(dn.remark || '') + '"></label>';
    LP.modal({
      title: t('dnTitle'), help: 'documents', wide: true, okText: t('dnPrint'), body: body,
      onOk: function (m) {
        function v(id) { var el = m.querySelector('#' + id); return el ? el.value.trim() : ''; }
        var info = { no: v('dnNo'), date: v('dnDate'), copies: v('dnCopies'), from: v('dnFrom'), plate: v('dnPlate'), driver: v('dnDriver'), ref: v('dnRef'), remark: v('dnRemark'), to: {} };
        drops.forEach(function (g) { info.to[g] = v('dnTo' + g); });
        S.change(function (s) { s.project.shipment = Object.assign({}, s.project.shipment || {}, { dn: info }); }, { history: false });
        printNotes(info, groups, drops, specs);
      }
    });
  };

  function printNotes(info, groups, drops, specs) {
    var t = LP.t, U = LP.units, esc = LP.esc, S = LP.store, st = S.state, C = st.container, sh = st.project.shipment || {};
    var w = root.open('', '_blank');
    if (!w) { LP.toast('Popup blocked — allow popups to print', 'bad'); return; }
    var logo = S.ui.logo, copies = info.copies === '2' ? [t('dnOriginal'), t('dnCopyLbl')] : [''];
    var unplaced = (st.lastRun && st.lastRun.unplaced) || [];
    function note(g, gi, copyLbl) {
      var items = Object.keys(groups[g]).map(function (id) { return { s: specs[id] || { sku: id }, n: groups[g][id] }; })
        .sort(function (a, b) { return String(a.s.sku).localeCompare(String(b.s.sku)); });
      var tq = 0, tw = 0, tv = 0;
      var rows = items.map(function (it, i) {
        var s = it.s, wt = it.n * (+s.weight || 0), vol = it.n * (s.w * s.l * s.h) / 1e6;
        tq += it.n; tw += wt; tv += vol;
        return '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(s.sku) + '</td><td>' + esc(s.name || '') + '<div class="sub">' + U.fmt(s.w, 1) + '×' + U.fmt(s.l, 1) + '×' + U.fmt(s.h, 1) + ' cm' +
          (s.segGroup ? ' · ' + esc(s.segGroup) : '') + (s.fragile ? ' · ' + esc(t('fragile').split(' ')[0]) : '') + '</div></td>' +
          '<td class="n"><b>' + U.fmt(it.n, 0) + '</b></td><td class="c">' + esc(t('pcs')) + '</td><td class="n">' + U.fmt(s.weight, 2) + '</td><td class="n">' + U.fmt(wt, 1) + '</td><td class="n">' + U.fmt(vol, 3) + '</td></tr>';
      }).join('');
      var no = drops.length > 1 ? info.no + '-' + (gi + 1) : info.no;
      var back = unplaced.filter(function (u) { return (+(specs[u.id] || {}).dropOrder || 1) === g; });
      return '<section class="page">' +
        '<header><div class="co">' + (logo ? '<img src="' + logo + '">' : '') + '<div><div class="cn">' + esc(info.from || '') + '</div></div></div>' +
        '<div class="ti"><h1>' + esc(t('dnTitleDoc')) + '</h1><div class="sub">DELIVERY NOTE / PACKING LIST</div>' +
        (copyLbl ? '<div class="copy">' + esc(copyLbl) + '</div>' : '') + '</div></header>' +
        '<table class="meta"><tr><th>' + esc(t('dnNo')) + '</th><td><b>' + esc(no) + '</b></td><th>' + esc(t('date')) + '</th><td>' + esc(info.date) + '</td></tr>' +
        '<tr><th>' + esc(t('dnTo')) + (drops.length > 1 ? ' (' + esc(t('dnDropN', { n: g })) + ')' : '') + '</th><td colspan="3">' + esc(info.to[g] || '') + '</td></tr>' +
        '<tr><th>' + esc(t('container')) + '</th><td>' + esc(LP.containerLabel(C)) + '</td><th>' + esc(t('dnPlate')) + '</th><td>' + esc(info.plate || '') + '</td></tr>' +
        '<tr><th>' + esc(t('shipContainerNo')) + '</th><td>' + esc(sh.containerNo || '–') + '</td><th>' + esc(t('shipSealNo')) + '</th><td>' + esc(sh.sealNo || '–') + '</td></tr>' +
        '<tr><th>' + esc(t('dnDriver')) + '</th><td>' + esc(info.driver || '') + '</td><th>' + esc(t('dnRef')) + '</th><td>' + esc(info.ref || '') + '</td></tr></table>' +
        '<table class="items"><thead><tr><th class="c">#</th><th>' + esc(t('sku')) + '</th><th>' + esc(t('name')) + '</th><th class="n">' + esc(t('qty')) + '</th><th class="c">' + esc(t('dnUnit')) + '</th>' +
        '<th class="n">' + esc(t('dnUnitWt')) + '</th><th class="n">' + esc(t('dnTotalWt')) + '</th><th class="n">m³</th></tr></thead><tbody>' + rows + '</tbody>' +
        '<tfoot><tr><td colspan="3">' + esc(t('total')) + ' ' + items.length + ' ' + esc(t('items')) + '</td><td class="n">' + U.fmt(tq, 0) + '</td><td class="c">' + esc(t('pcs')) + '</td><td></td><td class="n">' + U.fmt(tw, 1) + '</td><td class="n">' + U.fmt(tv, 3) + '</td></tr></tfoot></table>' +
        (back.length ? '<div class="back"><b>' + esc(t('dnBackorder')) + ':</b> ' + back.map(function (u) { return esc((specs[u.id] || {}).sku || u.id) + ' × ' + u.qty; }).join(', ') + '</div>' : '') +
        (info.remark ? '<div class="remark"><b>' + esc(t('dnRemark')) + ':</b> ' + esc(info.remark) + '</div>' : '') +
        '<div class="signs">' + ['dnSignShipper', 'dnSignDriver', 'dnSignReceiver'].map(function (k) {
          return '<div><div class="line"></div><div>' + esc(t(k)) + '</div><div class="d">' + esc(t('date')) + ' ____/____/______</div></div>';
        }).join('') + '</div><div class="foot">' + esc(t('dnFootNote')) + '</div></section>';
    }
    var pages = [];
    drops.forEach(function (g, gi) { copies.forEach(function (c) { pages.push(note(g, gi, c)); }); });
    var html = '<!doctype html><html lang="' + LP.i18n.lang + '"><head><meta charset="utf-8"><title>' + esc(t('dnTitleDoc')) + ' ' + esc(info.no) + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">' +
      '<style>@page{size:A4;margin:12mm}body{font-family:Sarabun,system-ui,sans-serif;color:#111;margin:0;font-size:13px}.page{page-break-after:always;position:relative;padding:4px 2px}' +
      'header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}.co{display:flex;gap:10px;align-items:center}.co img{max-height:56px;max-width:140px}' +
      '.cn{font-size:16px;font-weight:700}.ti{text-align:right}.ti h1{margin:0;font-size:22px}.sub{color:#555;font-size:11.5px}' +
      'table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:5px 7px;text-align:left;vertical-align:top}.meta th{background:#f1f5f9;width:16%;font-weight:600}' +
      '.items{margin-top:10px}.items thead th{background:#1f2937;color:#fff}.items tfoot td{font-weight:700;background:#f1f5f9}td.n,th.n{text-align:right}td.c,th.c{text-align:center}' +
      '.back,.remark{margin-top:8px;padding:6px 8px;border:1px dashed #999}.signs{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:40px;text-align:center}' +
      '.line{border-bottom:1px solid #111;height:46px;margin-bottom:4px}.d{color:#555;font-size:11.5px;margin-top:4px}.foot{margin-top:16px;color:#777;font-size:11px}' +
      '.copy{display:inline-block;margin-top:4px;border:2px solid #b91c1c;color:#b91c1c;font-weight:700;padding:1px 10px;border-radius:4px}' +
      '.noprint{position:fixed;top:8px;right:8px;padding:8px 14px;font-size:14px}@media print{.noprint{display:none}}</style></head><body>' +
      '<button class="noprint" onclick="print()">🖨 Print</button>' + pages.join('') +
      '<script>setTimeout(function(){print()},900)<\/script></body></html>';
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  /** Summary-panel section for VGM. */
  LP.vgmSection = function (v, ship) {
    var t = LP.t, U = LP.units, esc = LP.esc, I = LP.icon;
    var tone = v.pct > 100 ? 'bad' : v.pct > 95 ? 'warn' : 'ok';
    var cn = ship.containerNo ? LP.iso6346(ship.containerNo) : null;
    return '<div class="balance vgm">' +
      '<div class="vgm-big"><span>' + t('vgm') + '</span><b class="' + (v.pct > 100 ? 'neg' : '') + '">' + U.fmt(v.vgm, 0) + ' kg</b></div>' +
      (v.maxGross ? '<div class="bar-t"><span class="' + tone + '" style="width:' + Math.min(100, v.pct).toFixed(1) + '%"></span></div><div class="muted small">' + U.fmt(v.pct, 1) + '% ' + t('ofMaxGross') + ' ' + U.fmt(v.maxGross, 0) + ' kg</div>' : '') +
      '<div class="axrow"><span>' + t('containerTare') + '</span><span></span><span class="n">' + U.fmt(v.tare, 0) + '</span></div>' +
      '<div class="axrow"><span>' + t('cargoWt') + '</span><span></span><span class="n">' + U.fmt(v.cargo, 0) + '</span></div>' +
      '<div class="axrow"><span>' + t('shipDunnage') + '</span><span></span><span class="n">' + U.fmt(v.dunnage, 0) + '</span></div>' +
      '<div class="ship-meta">' +
      (ship.containerNo ? '<span>' + I('container') + esc(ship.containerNo) + (cn && !cn.ok ? ' <span class="neg">⚠</span>' : '') + '</span>' : '') +
      (ship.sealNo ? '<span>🔒 ' + esc(ship.sealNo) + '</span>' : '') +
      (ship.bookingNo ? '<span>BKG ' + esc(ship.bookingNo) + '</span>' : '') + '</div>' +
      '<button class="btn sm" data-ship-edit>' + I('edit') + t('shipEdit') + '</button></div>';
  };
})(this);
