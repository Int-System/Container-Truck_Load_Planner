/* Container & Truck Load Planner — utils/io.js
 * Import / export: CSV, Excel (SheetJS, optional), project JSON.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};
  var U = LP.units;

  function download(filename, data, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function readFile(file, binary) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      if (binary) r.readAsArrayBuffer(file); else r.readAsText(file, 'utf-8');
    });
  }

  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var delim = [',', ';', '\t'].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  function toCSV(rows) {
    return '﻿' + rows.map(function (r) {
      return r.map(function (v) {
        var s = v == null ? '' : String(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  var ALIASES = {
    sku: ['sku', 'code', 'item', 'รหัส', 'รหัสสินค้า'],
    name: ['name', 'description', 'desc', 'ชื่อ', 'ชื่อสินค้า'],
    width: ['width', 'w', 'กว้าง', 'ความกว้าง'],
    length: ['length', 'l', 'depth', 'ยาว', 'ความยาว'],
    height: ['height', 'h', 'สูง', 'ความสูง'],
    unit: ['unit', 'dim_unit', 'size_unit', 'หน่วย', 'หน่วยขนาด'],
    weight: ['weight', 'wt', 'gross_weight', 'น้ำหนัก'],
    weight_unit: ['weight_unit', 'wunit', 'wt_unit', 'หน่วยน้ำหนัก'],
    qty: ['qty', 'quantity', 'pcs', 'count', 'จำนวน'],
    rotation: ['rotation', 'rotate', 'orientation', 'หมุน', 'การหมุน'],
    stackable: ['stackable', 'stack', 'ซ้อนได้', 'วางซ้อน'],
    max_stack: ['max_stack', 'maxstack', 'stack_limit', 'ซ้อนสูงสุด', 'ชั้นสูงสุด'],
    max_load: ['max_load', 'maxload', 'load_limit', 'รับน้ำหนักทับ', 'รับน้ำหนัก'],
    fragile: ['fragile', 'เปราะบาง'],
    package: ['package', 'pkg', 'type', 'packaging', 'บรรจุภัณฑ์', 'ประเภท'],
    drop_order: ['drop_order', 'drop', 'delivery', 'stop', 'ลำดับ', 'ลำดับลงของ'],
    color: ['color', 'colour', 'สี'],
    seg_group: ['seg_group', 'segregation', 'dg', 'dg_class', 'กลุ่มแยก', 'กลุ่มแยกห่าง'],
    temp_zone: ['temp_zone', 'temperature', 'zone', 'โซนอุณหภูมิ', 'อุณหภูมิ'],
    fork_face: ['fork_face', 'fork', 'ด้านสอดงา']
  };
  function zone(v) {
    var s = String(v || '').trim().toLowerCase();
    if (/frozen|freez|แช่แข็ง/.test(s)) return 'frozen';
    if (/chill|cool|เย็น/.test(s)) return 'chilled';
    if (/ambient|dry|ปกติ/.test(s)) return 'ambient';
    return '';
  }
  function fork(v) {
    var s = String(v || '').trim().toLowerCase();
    if (/^(w|width|กว้าง)/.test(s)) return 'width';
    if (/^(l|length|ยาว)/.test(s)) return 'length';
    return 'any';
  }
  var HEAD = Object.keys(ALIASES);

  function bool(v, dflt) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (s === '') return dflt;
    if (['y', 'yes', 'true', '1', 'ใช่', 'ได้', 'x', '✓'].indexOf(s) >= 0) return true;
    if (['n', 'no', 'false', '0', 'ไม่', 'ไม่ได้', '-'].indexOf(s) >= 0) return false;
    return dflt;
  }
  function rotation(v) {
    var s = String(v || '').trim().toLowerCase();
    if (/^(fixed|none|no|ห้าม)/.test(s)) return 'fixed';
    if (/^(all|any|ทุก|free)/.test(s)) return 'all';
    return 'upright';
  }
  function pkg(v) {
    var s = String(v || '').trim().toLowerCase();
    if (/pallet|พาเลท/.test(s)) return 'pallet';
    if (/drum|cyl|barrel|ถัง|กระบอก/.test(s)) return 'cylinder';
    return 'box';
  }

  /** rows (array of arrays incl. header) → cargo items (cm / kg internally) */
  function rowsToCargo(rows) {
    if (!rows.length) throw new Error('empty file');
    var header = rows[0].map(function (h) { return String(h).trim().toLowerCase().replace(/\s+/g, '_'); });
    var col = {};
    HEAD.forEach(function (k) {
      var idx = header.findIndex(function (h) { return ALIASES[k].indexOf(h) >= 0; });
      if (idx >= 0) col[k] = idx;
    });
    if (col.width == null || col.length == null || col.height == null) throw new Error('need width / length / height columns');
    var out = [];
    rows.slice(1).forEach(function (r, i) {
      function g(k) { return col[k] != null ? r[col[k]] : undefined; }
      var unit = U.normalizeUnit(g('unit') || 'cm') || 'cm';
      var wunit = U.normalizeUnit(g('weight_unit') || 'kg') || 'kg';
      var qtyRaw = String(g('qty') == null ? '1' : g('qty')).trim().toLowerCase();
      var it = LP.newItem({
        sku: String(g('sku') || ('ITEM-' + (i + 1))).trim(),
        name: String(g('name') || '').trim(),
        w: U.toCm(parseFloat(g('width')), unit), l: U.toCm(parseFloat(g('length')), unit), h: U.toCm(parseFloat(g('height')), unit),
        unit: unit, wunit: wunit,
        weight: U.toKg(parseFloat(g('weight')) || 0, wunit),
        maxMode: qtyRaw === 'max' || qtyRaw === '*' || qtyRaw === 'มากที่สุด',
        qty: parseInt(qtyRaw, 10) || 0,
        rotation: rotation(g('rotation')),
        stackable: bool(g('stackable'), true),
        maxStack: parseInt(g('max_stack'), 10) || 0,
        maxLoad: U.toKg(parseFloat(g('max_load')) || 0, wunit),
        fragile: bool(g('fragile'), false),
        pkg: pkg(g('package')),
        dropOrder: parseInt(g('drop_order'), 10) || 1,
        segGroup: String(g('seg_group') || '').trim(),
        tempZone: zone(g('temp_zone')),
        forkFace: fork(g('fork_face')),
        color: g('color') && /^#?[0-9a-f]{6}$/i.test(String(g('color')).trim()) ? '#' + String(g('color')).trim().replace('#', '') : null
      });
      if (it.pkg === 'cylinder') it.l = it.w;
      if (it.w > 0 && it.l > 0 && it.h > 0) out.push(it);
    });
    return out;
  }

  function importCargo(file) {
    var isX = /\.(xlsx|xls|ods)$/i.test(file.name);
    if (isX) {
      if (!root.XLSX) return Promise.reject(new Error('Excel library not loaded (offline?) — save as CSV instead'));
      return readFile(file, true).then(function (buf) {
        var wb = root.XLSX.read(buf, { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        return rowsToCargo(root.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }));
      });
    }
    return readFile(file).then(function (txt) { return rowsToCargo(parseCSV(txt)); });
  }

  var TEMPLATE = [
    ['sku', 'name', 'width', 'length', 'height', 'unit', 'weight', 'weight_unit', 'qty', 'rotation', 'stackable', 'max_stack', 'max_load', 'fragile', 'package', 'drop_order', 'color', 'seg_group', 'temp_zone', 'fork_face'],
    ['CTN-4030', 'Carton 40x30x30', 40, 30, 30, 'cm', 10, 'kg', 'max', 'all', 'yes', 0, 0, 'no', 'box', 1, '#4e79a7', '', '', ''],
    ['PLT-EUR', 'Euro pallet', 800, 1200, 1200, 'mm', 450, 'kg', 4, 'upright', 'no', 1, 0, 'no', 'pallet', 1, '#f28e2b', '', '', 'width'],
    ['DRM-200', 'Drum 200L', 58, 58, 88, 'cm', 180, 'kg', 6, 'upright', 'yes', 2, 400, 'no', 'drum', 2, '#59a14f', 'DG 3', '', ''],
    ['GLS-01', 'Glassware', 18, 14, 12, 'in', 13, 'lb', 20, 'upright', 'yes', 0, 0, 'yes', 'box', 2, '', '', '', '']
  ];

  function cargoRows(cargo) {
    var rows = [TEMPLATE[0]];
    cargo.forEach(function (c) {
      var u = c.unit || 'cm', wu = c.wunit || 'kg';
      rows.push([c.sku, c.name, U.round(U.fromCm(c.w, u), 3), U.round(U.fromCm(c.l, u), 3), U.round(U.fromCm(c.h, u), 3), u,
        U.round(U.fromKg(c.weight, wu), 3), wu, c.maxMode ? 'max' : c.qty, c.rotation, c.stackable ? 'yes' : 'no', c.maxStack || 0,
        U.round(U.fromKg(c.maxLoad || 0, wu), 3), c.fragile ? 'yes' : 'no', c.pkg === 'cylinder' ? 'drum' : c.pkg, c.dropOrder || 1, c.color || '',
        c.segGroup || '', c.tempZone || '', c.forkFace && c.forkFace !== 'any' ? c.forkFace : '']);
    });
    return rows;
  }

  function placementRows(state) {
    var specs = {};
    state.cargo.forEach(function (c) { specs[c.id] = c; });
    var rows = [['seq', 'sku', 'name', 'x_cm', 'y_cm', 'z_cm', 'w_cm', 'l_cm', 'h_cm', 'weight_kg', 'locked']];
    state.placements.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }).forEach(function (p, i) {
      var s = specs[p.sku] || {};
      rows.push([p.seq || i + 1, s.sku || p.sku, s.name || '', U.round(p.x, 1), U.round(p.y, 1), U.round(p.z, 1), U.round(p.w, 1), U.round(p.l, 1), U.round(p.h, 1), U.round(p.weight, 2), p.locked ? 'yes' : '']);
    });
    return rows;
  }

  function summaryRows(state, stats) {
    var C = state.container, t = LP.t;
    var rows = [
      [t('projectName'), state.project.name],
      [t('container'), C.name, C.W + ' × ' + C.L + ' × ' + C.H + ' cm', C.maxPayload + ' kg'],
      [t('itemsPlaced'), stats.count],
      [t('weightTotal') + ' (kg)', U.round(stats.weight, 1), U.round(stats.payloadPct, 1) + '%'],
      [t('volUtil') + ' %', U.round(stats.volUtil, 1)],
      [t('floorUtil') + ' %', U.round(stats.floorUtil, 1)],
      ['CoG x/y/z (cm)', U.round(stats.cog.x, 1), U.round(stats.cog.y, 1), U.round(stats.cog.z, 1)],
      [t('leftRight') + ' %', U.round(stats.leftPct, 1), U.round(stats.rightPct, 1)],
      [t('frontRear') + ' %', U.round(stats.frontPct, 1), U.round(stats.rearPct, 1)],
      [],
      [t('sku'), t('name'), t('requested'), t('placed'), t('unplaced'), t('weight') + ' (kg)']
    ];
    (stats.perSku || []).forEach(function (r) { rows.push([r.sku, r.name, r.requested == null ? 'MAX' : r.requested, r.placed, r.unplaced, U.round(r.weight, 1)]); });
    return rows;
  }

  LP.io = {
    download: download,
    readFile: readFile,
    parseCSV: parseCSV,
    toCSV: toCSV,
    rowsToCargo: rowsToCargo,
    importCargo: importCargo,
    templateCSV: function () { return toCSV(TEMPLATE); },
    exportCargoCSV: function (state) { download(slug(state) + '-cargo.csv', toCSV(cargoRows(state.cargo)), 'text/csv'); },
    exportPlacementsCSV: function (state) { download(slug(state) + '-placements.csv', toCSV(placementRows(state)), 'text/csv'); },
    exportXLSX: function (state, stats) {
      if (!root.XLSX) { download(slug(state) + '-placements.csv', toCSV(placementRows(state)), 'text/csv'); return false; }
      var X = root.XLSX, wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(summaryRows(state, stats)), 'Summary');
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(cargoRows(state.cargo)), 'Cargo');
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(placementRows(state)), 'Placements');
      X.writeFile(wb, slug(state) + '.xlsx');
      return true;
    },
    saveProject: function (state) {
      var data = { app: 'container-load-planner', version: 1, savedAt: new Date().toISOString(), project: state.project, container: state.container, cargo: state.cargo, placements: state.placements, settings: state.settings, lastRun: state.lastRun };
      download(slug(state) + '.loadplan.json', JSON.stringify(data, null, 1), 'application/json');
    },
    loadProject: function (file) {
      return readFile(file).then(function (txt) {
        var d = JSON.parse(txt);
        if (!d.container || !Array.isArray(d.cargo)) throw new Error('not a load plan file');
        return d;
      });
    }
  };
  function slug(state) { return String(state.project.name || 'loadplan').replace(/[^\w฀-๿-]+/g, '_').slice(0, 60) || 'loadplan'; }
})(this);
