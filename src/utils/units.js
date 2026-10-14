/* Container & Truck Load Planner — utils/units.js
 * Unit conversion. Internal units: centimetres and kilograms.
 */
(function (root) {
  'use strict';
  var LEN = { mm: 0.1, cm: 1, m: 100, in: 2.54, ft: 30.48 };
  var WT = { kg: 1, lb: 0.45359237, t: 1000 };
  var U = {
    lengthUnits: ['cm', 'mm', 'm', 'in'],
    weightUnits: ['kg', 'lb'],
    toCm: function (v, unit) { return (+v || 0) * (LEN[unit] || 1); },
    fromCm: function (v, unit) { return (+v || 0) / (LEN[unit] || 1); },
    toKg: function (v, unit) { return (+v || 0) * (WT[unit] || 1); },
    fromKg: function (v, unit) { return (+v || 0) / (WT[unit] || 1); },
    /** Round for display (strip float noise). */
    round: function (v, d) { var f = Math.pow(10, d == null ? 2 : d); return Math.round((+v || 0) * f) / f; },
    fmt: function (v, d) {
      if (v == null || isNaN(v)) return '–';
      if (v === Infinity) return '∞';
      return (+v).toLocaleString('en-US', { maximumFractionDigits: d == null ? 1 : d, minimumFractionDigits: 0 });
    },
    normalizeUnit: function (u) {
      u = String(u || '').trim().toLowerCase();
      if (u === 'inch' || u === 'inches' || u === '"' || u === 'นิ้ว') return 'in';
      if (u === 'มม' || u === 'มม.' || u === 'millimeter') return 'mm';
      if (u === 'ซม' || u === 'ซม.' || u === 'centimeter') return 'cm';
      if (u === 'ม' || u === 'ม.' || u === 'meter' || u === 'เมตร') return 'm';
      if (u === 'lbs' || u === 'pound' || u === 'ปอนด์') return 'lb';
      if (u === 'กก' || u === 'กก.' || u === 'kilogram') return 'kg';
      return u;
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = U;
  else { root.LP = root.LP || {}; root.LP.units = U; }
})(this);
