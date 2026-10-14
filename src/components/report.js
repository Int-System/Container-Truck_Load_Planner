/* Container & Truck Load Planner — components/report.js
 * PDF report (print-to-PDF window: keeps Thai text perfect without embedding fonts) and the
 * multi-option comparison dialog.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};

  /** Export shipment details + VGM declaration (SOLAS) for the PDF report. */
  function vgmBlock(d) {
    var t = LP.t, U = LP.units, esc = LP.esc, sh = d.ship || {}, v = d.vgm, C = d.C;
    function row(k, val) { return '<tr><th style="width:32%">' + esc(t(k)) + '</th><td>' + esc(val || '–') + '</td></tr>'; }
    return '<h2>' + t('shipTitle') + '</h2><table>' +
      row('shipContainerNo', sh.containerNo) + row('shipSealNo', sh.sealNo) + row('shipBooking', sh.bookingNo) + row('shipVessel', sh.vessel) +
      row('shipPol', sh.pol) + row('shipPod', sh.pod) + row('shipShipper', sh.shipper) + row('shipConsignee', sh.consignee) +
      row('container', C.name + ' · ' + U.fmt(C.W, 0) + '×' + U.fmt(C.L, 0) + '×' + U.fmt(C.H, 0) + ' cm') + '</table>' +
      '<h2>' + t('vgmTitle') + '</h2><table>' +
      '<tr><th>' + t('containerTare') + '</th><td class="n">' + U.fmt(v.tare, 0) + ' kg</td></tr>' +
      '<tr><th>' + t('cargoWt') + '</th><td class="n">' + U.fmt(v.cargo, 0) + ' kg</td></tr>' +
      '<tr><th>' + t('shipDunnage') + '</th><td class="n">' + U.fmt(v.dunnage, 0) + ' kg</td></tr>' +
      '<tr><th><b>VGM</b></th><td class="n' + (v.pct > 100 ? ' err' : '') + '"><b>' + U.fmt(v.vgm, 0) + ' kg</b></td></tr>' +
      (v.maxGross ? '<tr><th>' + t('maxGross') + '</th><td class="n">' + U.fmt(v.maxGross, 0) + ' kg (' + U.fmt(v.pct, 1) + '%)</td></tr>' : '') +
      '<tr><th>' + t('shipMethod') + '</th><td>' + esc(t(sh.method === '1' ? 'vgmMethod1' : 'vgmMethod2')) + '</td></tr></table>' +
      '<p>' + esc(t('vgmDeclare')) + '</p>' +
      '<table><tr><th style="width:32%">' + t('shipSignatory') + '</th><td style="height:46px">' + esc(sh.signatory || '') + '</td></tr><tr><th>' + t('shipDate') + '</th><td>' + esc(sh.vgmDate || '') + '</td></tr></table>';
  }

  LP.openReport = function (d) {
    var t = LP.t, U = LP.units, esc = LP.esc, st = d.stats, C = d.C, S = LP.store.state;
    var w = root.open('', '_blank');
    if (!w) { LP.toast('Popup blocked — allow popups to print the report', 'bad'); return; }
    var svgCtx = { C: C, placements: d.placements, specs: d.specs, flags: d.flags, tiers: d.tiers, cog: st.cog };
    var issues = (d.issues || []).concat(st.warnings.filter(function (x) { return x.code !== 'overweight'; })).concat(d.runWarnings || []);
    var seqRows = d.placements.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
    var html = '<!doctype html><html lang="' + LP.i18n.lang + '"><head><meta charset="utf-8"><title>' + esc(t('reportTitle')) + ' — ' + esc(S.project.name) + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">' +
      '<style>body{font-family:Sarabun,system-ui,"Segoe UI",sans-serif;color:#111;margin:18px;font-size:12px}h1{font-size:20px;margin:0}h2{font-size:15px;margin:18px 0 6px;border-bottom:2px solid #1f2937;padding-bottom:3px}' +
      '.meta{color:#555;margin:4px 0 10px}.kp{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.kp div{border:1px solid #ccc;border-radius:6px;padding:6px 8px}.kp b{display:block;font-size:17px}' +
      'table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:3px 6px;text-align:left}th{background:#f1f5f9}td.n,th.n{text-align:right}.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:middle}' +
      '.views{display:grid;grid-template-columns:1fr 1fr;gap:10px}.views figure{margin:0;border:1px solid #ddd;border-radius:6px;padding:6px;break-inside:avoid}.views figcaption{font-weight:600;margin-bottom:4px}.views img,.views svg{width:100%;height:auto;display:block}' +
      '.full{grid-column:1/3}.err{color:#b91c1c}.warning{color:#b45309}.info{color:#1d4ed8}@media print{.noprint{display:none}h2{break-after:avoid}}.btnp{padding:6px 14px;font-size:14px;margin-bottom:10px}</style></head><body>' +
      '<button class="noprint btnp" onclick="print()">🖨 Print / Save as PDF</button>' +
      '<h1>' + esc(t('reportTitle')) + ' — ' + esc(S.project.name) + '</h1>' +
      '<div class="meta">' + t('date') + ': ' + new Date().toLocaleString() + ' · ' + t('container') + ': <b>' + esc(C.name) + '</b> ' +
      U.fmt(C.W, 0) + ' × ' + U.fmt(C.L, 0) + ' × ' + U.fmt(C.H, 0) + ' cm · ' + t('payload') + ' ' + U.fmt(C.maxPayload, 0) + ' kg</div>' +
      '<div class="kp"><div>' + t('itemsPlaced') + '<b>' + U.fmt(st.count, 0) + (st.unplacedTotal ? ' <span class="err">(-' + st.unplacedTotal + ')</span>' : '') + '</b></div>' +
      '<div>' + t('weightTotal') + '<b>' + U.fmt(st.weight, 0) + ' kg</b>' + U.fmt(st.payloadPct, 1) + '% ' + t('ofPayload') + '</div>' +
      '<div>' + t('volUtil') + '<b>' + U.fmt(st.volUtil, 1) + '%</b>' + U.fmt(st.volume / 1e6, 2) + ' m³</div>' +
      '<div>' + t('floorUtil') + '<b>' + U.fmt(st.floorUtil, 1) + '%</b>' + t('usedLength') + ' ' + U.fmt(st.usedLength, 0) + ' cm</div></div>' +
      '<h2>' + t('cog') + '</h2><div>x ' + U.fmt(st.cog.x, 0) + ' cm · y ' + U.fmt(st.cog.y, 0) + ' cm · z ' + U.fmt(st.cog.z, 0) + ' cm — ' +
      t('leftRight') + ' ' + U.fmt(st.leftPct, 0) + '% / ' + U.fmt(st.rightPct, 0) + '% · ' + t('frontRear') + ' ' + U.fmt(st.frontPct, 0) + '% / ' + U.fmt(st.rearPct, 0) + '%</div>' +
      (d.vgm ? vgmBlock(d) : '') +
      (d.axle ? '<h2>' + t('axleLoads') + ' — ' + esc(t('veh_' + d.axleCfg.type)) + '</h2><table><tr><th>' + t('axleGroup') + '</th><th class="n">' + t('axlePos') + '</th><th class="n">kg</th><th class="n">' + t('axleLimit') + '</th><th class="n">%</th></tr>' +
        d.axle.groups.map(function (g) {
          return '<tr><td>' + esc(t('ax_' + g.key)) + (g.n > 1 ? ' ×' + g.n : '') + '</td><td class="n">' + U.fmt(g.y, 0) + '</td><td class="n">' + U.fmt(g.load, 0) + '</td><td class="n">' + U.fmt(g.limit, 0) + '</td><td class="n' + (g.pct > 100 ? ' err' : '') + '">' + U.fmt(g.pct, 0) + '%</td></tr>';
        }).join('') + '<tr><td><b>GVW</b></td><td></td><td class="n"><b>' + U.fmt(d.axle.gross, 0) + '</b></td><td class="n">' + U.fmt(d.axle.gvwLimit, 0) + '</td><td class="n' + (d.axle.gvwPct > 100 ? ' err' : '') + '">' + U.fmt(d.axle.gvwPct, 0) + '%</td></tr></table>' +
        '<p style="color:#666">' + t('axleNote') + '</p>' : '') +
      '<h2>' + t('warnings') + '</h2>' + (issues.length ? '<ul>' + issues.map(function (x) { return '<li class="' + (x.severity === 'error' ? 'err' : x.severity) + '">' + esc(LP.issueText(x)) + '</li>'; }).join('') + '</ul>' : '<div>' + t('noWarnings') + '</div>') +
      '<h2>' + t('perSku') + '</h2><table><tr><th>' + t('sku') + '</th><th>' + t('name') + '</th><th>' + t('dims') + ' (cm)</th><th class="n">' + t('weight') + ' (kg)</th><th class="n">' + t('requested') + '</th><th class="n">' + t('placed') + '</th><th class="n">' + t('unplaced') + '</th><th class="n">' + t('weightTotal') + '</th></tr>' +
      (st.perSku || []).map(function (r) {
        var c = d.specs[r.id] || {};
        return '<tr><td><span class="sw" style="background:' + esc(r.color) + '"></span>' + esc(r.sku) + '</td><td>' + esc(r.name) + '</td><td>' + U.fmt(c.w, 1) + '×' + U.fmt(c.l, 1) + '×' + U.fmt(c.h, 1) + '</td><td class="n">' + U.fmt(c.weight, 2) + '</td><td class="n">' + (r.requested == null ? 'MAX' : r.requested) + '</td><td class="n">' + r.placed + '</td><td class="n">' + r.unplaced + '</td><td class="n">' + U.fmt(r.weight, 0) + '</td></tr>';
      }).join('') + '</table>' +
      '<h2>' + t('view3d') + ' / 2D</h2><div class="views">' +
      (d.image3d ? '<figure class="full"><figcaption>3D</figcaption><img src="' + d.image3d + '"></figure>' : '') +
      '<figure class="full"><figcaption>' + t('viewTop') + '</figcaption>' + LP.svg2D('top', svgCtx) + '</figure>' +
      '<figure><figcaption>' + t('viewSide') + '</figcaption>' + LP.svg2D('side', svgCtx) + '</figure>' +
      '<figure><figcaption>' + t('viewDoor') + '</figcaption>' + LP.svg2D('door', svgCtx) + '</figure></div>' +
      '<h2>' + t('loadingSeq') + ' (' + seqRows.length + ')</h2><table><tr><th class="n">#</th><th>' + t('sku') + '</th><th class="n">x</th><th class="n">y</th><th class="n">z</th><th>w×l×h</th><th class="n">kg</th></tr>' +
      seqRows.slice(0, 1500).map(function (p, i) {
        var c = d.specs[p.sku] || {};
        return '<tr><td class="n">' + (p.seq || i + 1) + '</td><td>' + esc(c.sku || p.sku) + (p.locked ? ' 🔒' : '') + '</td><td class="n">' + U.fmt(p.x, 1) + '</td><td class="n">' + U.fmt(p.y, 1) + '</td><td class="n">' + U.fmt(p.z, 1) + '</td><td>' + U.fmt(p.w, 1) + '×' + U.fmt(p.l, 1) + '×' + U.fmt(p.h, 1) + '</td><td class="n">' + U.fmt(p.weight, 2) + '</td></tr>';
      }).join('') + '</table>' +
      '<p style="color:#666">x = ' + t('width') + ' (0 = ' + t('left') + '), y = ' + t('length') + ' (0 = ' + t('frontHere') + '), z = ' + t('height') + '</p>' +
      '<script>setTimeout(function(){print()},900)<\/script></body></html>';
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  /**
   * Printable loading instructions: one page per step with a 3D image (earlier steps greyed out),
   * a top view up to the step, the SKU counts, where to put them and a sign-off box.
   * d: { C, placements, specs, steps, images[], project }
   */
  LP.openStepSheets = function (d) {
    var t = LP.t, U = LP.units, esc = LP.esc;
    var w = root.open('', '_blank');
    if (!w) { LP.toast('Popup blocked — allow popups to print', 'bad'); return; }
    var N = d.steps.length;
    var pages = d.steps.map(function (g, i) {
      var top = LP.svg2D('top', { C: d.C, placements: d.placements, specs: d.specs, step: g.to, highlightFrom: g.from, showLabels: true });
      var rows = g.order.map(function (id) {
        var s = d.specs[id] || {};
        return '<tr><td><span class="sw" style="background:' + esc(s.color) + '"></span>' + esc(s.sku || id) + '</td><td>' + esc(s.name || '') + '</td><td>' +
          U.fmt(s.w, 1) + '×' + U.fmt(s.l, 1) + '×' + U.fmt(s.h, 1) + '</td><td class="n"><b>' + g.skus[id] + '</b></td><td class="chk"></td></tr>';
      }).join('');
      return '<section class="page"><div class="ph"><div><div class="pt">' + esc(t('stepN', { n: i + 1 })) + ' / ' + N + '</div><div class="ps">' + esc(d.project) + ' · ' + esc(d.C.name) + '</div></div>' +
        '<div class="pbig">' + g.n + ' ' + t('pcs') + '<small>#' + g.from + '–' + g.to + ' · ' + U.fmt(g.weight, 0) + ' kg</small></div></div>' +
        '<div class="where">' + esc(t('atLength', { a: U.fmt(g.y0, 0), b: U.fmt(g.y1, 0) })) + ' · ' + esc(t('heightTo', { h: U.fmt(g.z1, 0) })) + '</div>' +
        '<div class="imgs">' + (d.images[i] ? '<img src="' + d.images[i] + '">' : '') + '<div class="top">' + top + '</div></div>' +
        '<table><tr><th>' + t('sku') + '</th><th>' + t('name') + '</th><th>' + t('dims') + ' (cm)</th><th class="n">' + t('qty') + '</th><th>✓</th></tr>' + rows + '</table>' +
        '<div class="sign"><span>' + t('signLoader') + ' ____________________</span><span>' + t('signTime') + ' ________</span></div></section>';
    }).join('');
    var html = '<!doctype html><html lang="' + LP.i18n.lang + '"><head><meta charset="utf-8"><title>' + esc(t('stepSheetTitle')) + ' — ' + esc(d.project) + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">' +
      '<style>@page{size:A4 landscape;margin:10mm}body{font-family:Sarabun,system-ui,sans-serif;margin:0;color:#111}.page{page-break-after:always;padding:14px 18px;box-sizing:border-box}' +
      '.ph{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1d4ed8;padding-bottom:6px}.pt{font-size:26px;font-weight:700;color:#1d4ed8}.ps{color:#555}' +
      '.pbig{font-size:26px;font-weight:700;text-align:right}.pbig small{display:block;font-size:13px;font-weight:400;color:#555}.where{margin:8px 0;font-size:15px;font-weight:600}' +
      '.imgs{display:grid;grid-template-columns:1.25fr 1fr;gap:10px;align-items:center}.imgs img{width:100%;border:1px solid #ddd;border-radius:6px}.top svg{width:100%;height:auto}' +
      'table{border-collapse:collapse;width:100%;margin-top:8px;font-size:13px}th,td{border:1px solid #bbb;padding:4px 7px;text-align:left}th{background:#eef2ff}td.n,th.n{text-align:right}td.chk{width:40px}' +
      '.sw{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:5px;vertical-align:middle}.sign{display:flex;gap:40px;margin-top:14px;font-size:14px}' +
      '.noprint{position:fixed;top:8px;right:8px;padding:8px 14px;font-size:14px}@media print{.noprint{display:none}}</style></head><body>' +
      '<button class="noprint" onclick="print()">🖨 Print / Save as PDF</button>' + pages +
      '<script>setTimeout(function(){print()},1200)<\/script></body></html>';
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  LP.openCompare = function (client, onUse, onFleet, ctx) {
    ctx = ctx || {};
    var t = LP.t, U = LP.units, esc = LP.esc, S = LP.store;
    var cur = S.state.container;
    var presets = LP.allPresets();
    var defaults = { c20: 1, c40: 1, t6: 1, t10: 1 };
    defaults[cur.presetId] = 1;
    var list = presets.map(function (p) {
      return '<label class="chk"><input type="checkbox" value="' + esc(p.id) + '"' + (defaults[p.id] ? ' checked' : '') + '> ' + esc(LP.presetName(p)) +
        ' <span class="muted small">' + (p.cost ? U.fmt(p.cost, 0) + ' ฿' : '') + '</span></label>';
    }).join('');
    if (cur.presetId === 'custom') list = '<label class="chk"><input type="checkbox" value="__current" checked> ' + esc(cur.name) + ' (' + t('custom') + ')</label>' + list;
    LP.modal({
      title: t('compareTitle'), help: 'multi', wide: true, cancelText: t('close'),
      body: '<div class="cmp-opts">' + list + '</div><div class="muted small">' + t('compareHint') + '</div>' +
        '<div class="row gap wrap"><button class="btn primary" id="cmpRun">' + t('compareRun') + '</button>' +
        '<button class="btn" id="fleetRun">' + LP.icon('stack') + t('fleetRun') + '</button><span id="cmpStatus" class="muted"></span></div><div id="cmpOut"></div><div id="fleetOut"></div>',
      onOpen: function (m, close) {
        function baseOpts(extra) {
          var st = S.state.settings;
          var o = ctx.opts ? JSON.parse(JSON.stringify(ctx.opts)) :
            { objective: st.objective, minSupport: st.minSupport, heavyBottom: st.heavyBottom, segDistance: st.segDistance, seed: 7 };
          for (var k in extra) o[k] = extra[k];
          return o;
        }
        function chosenList() {
          var ids = Array.prototype.map.call(m.querySelectorAll('.cmp-opts input:checked'), function (i) { return i.value; });
          return ids.map(function (id) {
            if (id === '__current') return { id: '__current', name: cur.name, W: cur.W, L: cur.L, H: cur.H, maxPayload: cur.maxPayload, cost: cur.cost, doorW: cur.doorW, doorH: cur.doorH, floorLoad: cur.floorLoad };
            var p = presets.filter(function (x) { return x.id === id; })[0];
            var q = { id: p.id, name: LP.presetName(p), W: p.W, L: p.L, H: p.H, maxPayload: p.maxPayload, cost: p.cost, doorW: p.doorW, doorH: p.doorH, floorLoad: p.floorLoad };
            if (p.id === cur.presetId && cur.cost) q.cost = cur.cost;
            return q;
          });
        }
        m.querySelector('#fleetRun').onclick = function () {
          var chosen = chosenList();
          if (!chosen.length) return;
          var btn = m.querySelector('#fleetRun'), outF = m.querySelector('#fleetOut');
          btn.disabled = true;
          m.querySelector('#cmpStatus').textContent = t('packing');
          var opts = baseOpts({ fleetTimeLimit: 250, multiTimeLimit: 250 });
          client.call('fleetPlan', [chosen, S.state.cargo, opts, 25]).then(function (r) {
            btn.disabled = false;
            m.querySelector('#cmpStatus').textContent = '';
            var cost = function (v) { return r.costProxy ? U.fmt(v, 1) + ' m³' : U.fmt(v, 0) + ' ฿'; };
            var h = '<div class="sugg fleet"><b>' + t('fleetBest') + ':</b> ' + r.summary.map(function (s) { return s.n + ' × ' + esc(s.name); }).join(' + ') +
              ' = <b>' + cost(r.total) + '</b>' + (r.complete ? '' : ' <span class="neg">(' + t('fleetIncomplete') + ')</span>') +
              (r.bestSingle && !r.single && r.bestSingle.total > r.total ? '<div class="pos">' + t('fleetSaving', { a: cost(r.bestSingle.total - r.total), b: r.bestSingle.units + ' × ' + esc(r.bestSingle.name) }) + '</div>' : '') +
              (r.costProxy ? '<div class="muted small">' + t('fleetProxy') + '</div>' : '') +
              '<div class="units">' + r.units.map(function (u, i) { return '<span class="unit">#' + (i + 1) + ' ' + esc(u.name) + ' · ' + u.count + ' ' + t('pcs') + ' · ' + U.fmt(u.volUtil, 0) + '%</span>'; }).join('') + '</div>' +
              '<button class="btn sm primary" id="fleetOpen">' + LP.icon('stack') + t('fleetOpen') + '</button></div>';
            outF.innerHTML = h;
            outF.querySelector('#fleetOpen').onclick = function () { if (onFleet) onFleet(r); close(); };
          }).catch(function (e) { btn.disabled = false; m.querySelector('#cmpStatus').textContent = e.message; });
        };
        m.querySelector('#cmpRun').onclick = function () {
          var chosen = chosenList();
          if (!chosen.length) return;
          m.querySelector('#cmpStatus').textContent = t('packing');
          m.querySelector('#cmpRun').disabled = true;
          var opts = baseOpts({ compareTimeLimit: 1200, multiTimeLimit: 350 });
          if (ctx.current) {   // the plan on screen counts as the result for the current container
            var curId = cur.presetId === 'custom' ? '__current' : cur.presetId;
            opts.baseline = {}; opts.baseline[curId] = ctx.current;
          }
          client.call('compare', [chosen, S.state.cargo, opts]).then(function (r) {
            m.querySelector('#cmpRun').disabled = false;
            m.querySelector('#cmpStatus').textContent = '';
            var h = '<div class="tbl-wrap"><table class="tbl cmp"><thead><tr><th>' + t('option') + '</th><th class="n">' + t('placed') + '</th><th class="n">' + t('volUtil') + '</th><th class="n">' + t('weightTotal') + ' %</th><th class="n">' + t('vehicles') + '</th><th class="n">' + t('totalCost') + '</th><th class="n">' + t('costPerItem') + '</th><th></th></tr></thead><tbody>';
            r.rows.forEach(function (row) {
              var best = row.id === r.bestId;
              h += '<tr class="' + (best ? 'best' : '') + '"><td>' + esc(row.name) + (best ? ' <span class="badge ok">' + t('best') + '</span>' : '') + '<div class="muted small">' + U.fmt(row.W / 100, 2) + '×' + U.fmt(row.L / 100, 2) + '×' + U.fmt(row.H / 100, 2) + ' m · ' + U.fmt(row.maxPayload, 0) + ' kg</div></td>' +
                '<td class="n">' + row.placed + (row.unplaced ? ' <span class="neg">(-' + row.unplaced + ')</span>' : '') + '</td><td class="n">' + U.fmt(row.volUtil, 1) + '%</td><td class="n">' + U.fmt(row.payloadPct, 1) + '%</td>' +
                '<td class="n"><b>' + row.containersNeeded + '</b>' + (row.complete ? '' : '+') + '</td><td class="n">' + (row.totalCost != null ? U.fmt(row.totalCost, 0) + ' ฿' : '–') + '</td><td class="n">' + (row.costPerItem != null ? U.fmt(row.costPerItem, 2) : '–') + '</td>' +
                '<td><button class="btn sm" data-use="' + esc(row.id) + '">' + t('useThis') + '</button></td></tr>';
            });
            h += '</tbody></table></div><div class="muted small">' + t('total') + ': ' + U.fmt(r.totals.count, 0) + ' ' + t('pcs') + ' · ' + U.fmt(r.totals.weight, 0) + ' kg · ' + U.fmt(r.totals.volume / 1e6, 2) + ' m³</div>';
            var out = m.querySelector('#cmpOut');
            out.innerHTML = h;
            out.querySelectorAll('[data-use]').forEach(function (b) {
              b.onclick = function () {
                var id = b.getAttribute('data-use');
                var p = id === '__current' ? null : presets.filter(function (x) { return x.id === id; })[0];
                if (p) onUse(p);
                close();
              };
            });
          }).catch(function (e) {
            m.querySelector('#cmpRun').disabled = false;
            m.querySelector('#cmpStatus').textContent = e.message;
          });
        };
      }
    });
  };
})(this);
