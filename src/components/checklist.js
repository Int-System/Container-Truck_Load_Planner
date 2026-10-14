/* Container & Truck Load Planner — components/checklist.js
 * Mobile loading checklist: full-screen, big touch targets. Walks the loading steps, counts pieces per
 * SKU (buttons or barcode scan via the BarcodeDetector API), records who loaded what and when, keeps
 * progress in this browser and exports a CSV log.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};

  function keyOf(st) {
    var sig = st.placements.length + '|' + st.placements.slice(0, 50).map(function (p) { return p.uid; }).join(',');
    var h = 0;
    for (var i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0;
    return 'lp.checklist.' + h;
  }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function hhmm(ts) { if (!ts) return ''; var d = new Date(ts); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  LP.openChecklist = function () {
    var S = LP.store, t = LP.t, U = LP.units, esc = LP.esc, I = LP.icon, st = S.state;
    if (!st.placements.length) { LP.toast(t('noSteps'), 'bad'); return; }
    var specs = S.specMap(), steps = LP.buildSteps(st.placements, st.container.L), K = keyOf(st);
    var log = load(K) || { operator: '', cur: 0, steps: {} };
    var scanStream = null, scanTimer = null;

    var el = document.createElement('div');
    el.className = 'ck';
    document.body.appendChild(el);
    document.body.classList.add('ck-open');

    function stepLog(i) { return log.steps[i] || (log.steps[i] = { counts: {}, start: null, done: null }); }
    function stepDone(i) {
      var g = steps[i], sl = stepLog(i);
      return g.order.every(function (id) { return (sl.counts[id] || 0) >= g.skus[id]; });
    }
    function totals() {
      var loaded = 0;
      steps.forEach(function (g, i) { var sl = log.steps[i]; if (sl) g.order.forEach(function (id) { loaded += Math.min(g.skus[id], sl.counts[id] || 0); }); });
      return loaded;
    }
    function persist() { save(K, log); }

    function render() {
      var i = log.cur, g = steps[i], sl = stepLog(i);
      if (!sl.start) { sl.start = Date.now(); persist(); }
      S.uiChange({ step: g.to });                                   // desktop views follow the checklist
      var loaded = totals(), all = st.placements.length;
      var top = LP.svg2D('top', { C: st.container, placements: st.placements, specs: specs, step: g.to, highlightFrom: g.from, showLabels: false });
      el.innerHTML =
        '<div class="ck-h"><div><b>' + esc(st.project.name) + '</b><span>' + esc(LP.containerLabel(st.container)) + '</span></div>' +
        '<button class="ib" data-ck="close" title="' + esc(t('close')) + '">' + I('x') + '</button></div>' +
        '<div class="ck-prog"><div class="bar-t"><span class="ok" style="width:' + (loaded / all * 100).toFixed(1) + '%"></span></div>' +
        '<span>' + t('stepN', { n: i + 1 }) + ' / ' + steps.length + ' · ' + loaded + ' / ' + all + ' ' + t('pcs') + '</span></div>' +
        '<label class="ck-op">' + I('hand') + '<input id="ckOp" placeholder="' + esc(t('ckOperator')) + '" value="' + esc(log.operator || '') + '"></label>' +
        '<div class="ck-step' + (stepDone(i) ? ' done' : '') + '"><div class="ck-no">' + (i + 1) + '</div><div class="ck-where"><b>' +
        esc(t('atLength', { a: U.fmt(g.y0, 0), b: U.fmt(g.y1, 0) })) + '</b><span>' + esc(t('heightTo', { h: U.fmt(g.z1, 0) })) + ' · ' + U.fmt(g.weight, 0) + ' kg</span>' +
        (sl.done ? '<span class="pos">✓ ' + t('ckDoneAt') + ' ' + hhmm(sl.done) + '</span>' : '') + '</div></div>' +
        '<div class="ck-top">' + top + '</div>' +
        '<div class="ck-list">' + g.order.map(function (id) {
          var s = specs[id] || {}, need = g.skus[id], have = sl.counts[id] || 0, ok = have >= need;
          return '<div class="ck-row' + (ok ? ' ok' : '') + '"><span class="sw" style="background:' + esc(s.color) + '"></span>' +
            '<div class="ck-sku"><b>' + esc(s.sku || id) + '</b><span>' + esc(s.name || '') + '</span></div>' +
            '<button class="ck-btn" data-ck="dec" data-id="' + esc(id) + '">−</button>' +
            '<div class="ck-cnt"><b>' + have + '</b>/' + need + '</div>' +
            '<button class="ck-btn" data-ck="inc" data-id="' + esc(id) + '">+</button>' +
            '<button class="ck-btn all' + (ok ? ' on' : '') + '" data-ck="all" data-id="' + esc(id) + '">' + I('check') + '</button></div>';
        }).join('') + '</div>' +
        '<div class="ck-scan hidden" id="ckScan"><video id="ckVideo" playsinline muted></video><span id="ckScanMsg">' + esc(t('ckScanning')) + '</span></div>' +
        '<div class="ck-foot">' +
        '<button class="btn big" data-ck="prev"' + (i === 0 ? ' disabled' : '') + '>◀</button>' +
        ('BarcodeDetector' in root && navigator.mediaDevices ? '<button class="btn big" data-ck="scan">' + I('target') + t('ckScan') + '</button>' : '') +
        '<button class="btn big primary grow" data-ck="next">' + (i === steps.length - 1 ? t('ckFinish') : t('ckNext') + ' ▶') + '</button></div>' +
        '<div class="ck-extra"><button class="btn sm ghost" data-ck="csv">' + I('download') + t('ckExport') + '</button>' +
        '<button class="btn sm ghost" data-ck="reset">' + I('reset') + t('ckReset') + '</button></div>';
      el.querySelector('#ckOp').addEventListener('change', function (e) { log.operator = e.target.value.trim(); persist(); });
    }

    function bump(id, delta, toMax) {
      var g = steps[log.cur], sl = stepLog(log.cur), need = g.skus[id];
      var v = toMax ? ((sl.counts[id] || 0) >= need ? 0 : need) : Math.max(0, Math.min(need, (sl.counts[id] || 0) + delta));
      sl.counts[id] = v;
      if (stepDone(log.cur) && !sl.done) sl.done = Date.now();
      if (!stepDone(log.cur)) sl.done = null;
      persist();
      render();
    }

    function stopScan() {
      clearInterval(scanTimer); scanTimer = null;
      if (scanStream) scanStream.getTracks().forEach(function (tr) { tr.stop(); });
      scanStream = null;
      var box = el.querySelector('#ckScan');
      if (box) box.classList.add('hidden');
    }
    function startScan() {
      if (scanStream) { stopScan(); return; }
      var box = el.querySelector('#ckScan'), video = el.querySelector('#ckVideo'), msg = el.querySelector('#ckScanMsg');
      var det = new root.BarcodeDetector();
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
        scanStream = stream;
        video.srcObject = stream;
        video.play();
        box.classList.remove('hidden');
        var lastCode = '', lastAt = 0;
        scanTimer = setInterval(function () {
          det.detect(video).then(function (codes) {
            if (!codes.length) return;
            var code = String(codes[0].rawValue || '').trim(), now = Date.now();
            if (code === lastCode && now - lastAt < 1500) return;
            lastCode = code; lastAt = now;
            var g = steps[log.cur], id = g.order.filter(function (x) {
              var s = specs[x] || {};
              return String(s.sku).toLowerCase() === code.toLowerCase() || String(s.barcode || '').toLowerCase() === code.toLowerCase();
            })[0];
            if (!id) { msg.textContent = t('ckScanUnknown', { code: code }); if (navigator.vibrate) navigator.vibrate([60, 40, 60]); return; }
            if (navigator.vibrate) navigator.vibrate(40);
            var keepScanning = scanStream;
            bump(id, 1);
            // re-render rebuilt the DOM: re-attach the running stream
            if (keepScanning) {
              var v2 = el.querySelector('#ckVideo'), b2 = el.querySelector('#ckScan');
              v2.srcObject = keepScanning; v2.play(); b2.classList.remove('hidden');
              video = v2; msg = el.querySelector('#ckScanMsg');
              msg.textContent = '✓ ' + ((specs[id] || {}).sku || id);
            }
          }).catch(function () { /* frame not ready */ });
        }, 350);
      }).catch(function (e) { LP.toast(t('ckCamFail', { msg: e.message }), 'bad'); });
    }

    function exportCsv() {
      var rows = [['step', 'from_seq', 'to_seq', 'sku', 'name', 'required', 'loaded', 'started', 'completed', 'operator']];
      steps.forEach(function (g, i) {
        var sl = log.steps[i] || { counts: {} };
        g.order.forEach(function (id) {
          var s = specs[id] || {};
          rows.push([i + 1, g.from, g.to, s.sku || id, s.name || '', g.skus[id], sl.counts[id] || 0,
            sl.start ? new Date(sl.start).toISOString() : '', sl.done ? new Date(sl.done).toISOString() : '', log.operator || '']);
        });
      });
      LP.io.download(String(st.project.name || 'load').replace(/[^\w฀-๿-]+/g, '_') + '-loading-log.csv', LP.io.toCSV(rows), 'text/csv');
    }

    function close() {
      stopScan();
      el.remove();
      document.body.classList.remove('ck-open');
      document.removeEventListener('keydown', onKey, true);
      S.uiChange({ step: null });
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey, true);

    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ck]');
      if (!b) return;
      var a = b.getAttribute('data-ck'), id = b.getAttribute('data-id');
      if (a === 'close') close();
      else if (a === 'inc') bump(id, 1);
      else if (a === 'dec') bump(id, -1);
      else if (a === 'all') bump(id, 0, true);
      else if (a === 'prev') { stopScan(); log.cur = Math.max(0, log.cur - 1); persist(); render(); }
      else if (a === 'next') {
        stopScan();
        var sl = stepLog(log.cur);
        if (!stepDone(log.cur) && !confirm(t('ckNotComplete'))) return;
        if (!sl.done) sl.done = Date.now();
        if (log.cur < steps.length - 1) { log.cur++; persist(); render(); }
        else { persist(); LP.toast(t('ckAllDone', { n: totals() }), 'ok'); close(); }
      }
      else if (a === 'scan') startScan();
      else if (a === 'csv') exportCsv();
      else if (a === 'reset') { if (confirm(t('ckResetConfirm'))) { log = { operator: log.operator, cur: 0, steps: {} }; persist(); render(); } }
    });
    render();
  };
})(this);
