/* Container & Truck Load Planner — engine/geometry.js
 * Pure geometry helpers. Units: cm / kg.
 * Coordinate system (shared by every module):
 *   x = across the width  (0 .. W)   — x=0 is the LEFT side when standing at the door looking in
 *   y = along the length  (0 .. L)   — y=0 is the FRONT wall (bulkhead / cab), y=L is the DOOR
 *   z = height            (0 .. H)   — z=0 is the floor
 * A box/placement is {x,y,z,w,l,h}: w along x, l along y, h along z.
 */
var LPEngineParts = (typeof LPEngineParts !== 'undefined') ? LPEngineParts : [];
LPEngineParts.push(function geometry(E) {
  'use strict';
  var EPS = 1e-4;     // numeric tolerance (cm)
  var TOPTOL = 0.05;  // "resting on" tolerance (cm)
  E.EPS = EPS;
  E.TOPTOL = TOPTOL;

  function ov(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0); }
  E.overlapLen = ov;

  E.intersects = function (a, b) {
    if (!(ov(a.x, a.x + a.w, b.x, b.x + b.w) > EPS &&
      ov(a.y, a.y + a.l, b.y, b.y + b.l) > EPS &&
      ov(a.z, a.z + a.h, b.z, b.z + b.h) > EPS)) return false;
    // two upright drums: their bounding boxes may overlap in a nested (hexagonal) pattern — test circles
    if (a.ax === 'z' && b.ax === 'z') {
      var dx = (a.x + a.w / 2) - (b.x + b.w / 2), dy = (a.y + a.l / 2) - (b.y + b.l / 2);
      var rs = (Math.min(a.w, a.l) + Math.min(b.w, b.l)) / 2 - EPS * 10;
      return dx * dx + dy * dy < rs * rs;
    }
    return true;
  };

  /** Real solid volume / footprint (cylinders are not their bounding box). */
  E.solidVolume = function (p) {
    if (!p.ax) return p.w * p.l * p.h;
    var d = p.ax === 'z' ? Math.min(p.w, p.l) : p.ax === 'x' ? Math.min(p.l, p.h) : Math.min(p.w, p.h);
    var len = p.ax === 'z' ? p.h : p.ax === 'x' ? p.w : p.l;
    return Math.PI * d * d / 4 * len;
  };
  E.footprintArea = function (p) {
    return p.ax === 'z' ? Math.PI * Math.pow(Math.min(p.w, p.l), 2) / 4 : p.w * p.l;
  };

  /** Gap between two boxes (0 when they touch or overlap). */
  E.boxGap = function (a, b) {
    var dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
    var dy = Math.max(0, a.y - (b.y + b.l), b.y - (a.y + a.l));
    var dz = Math.max(0, a.z - (b.z + b.h), b.z - (a.z + a.h));
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  E.ZONE_RANK = { frozen: 0, chilled: 1, ambient: 2 };
  E.zoneRank = function (spec) { return spec && E.ZONE_RANK[spec.tempZone] != null ? E.ZONE_RANK[spec.tempZone] : 2; };

  E.insideContainer = function (b, C) {
    return b.x >= -EPS && b.y >= -EPS && b.z >= -EPS &&
      b.x + b.w <= C.W + EPS && b.y + b.l <= C.L + EPS && b.z + b.h <= C.H + EPS;
  };

  /** Overlap area of two boxes projected on the floor (xy plane). */
  E.footprintOverlap = function (a, b) {
    var dx = ov(a.x, a.x + a.w, b.x, b.x + b.w);
    if (dx <= EPS) return 0;
    var dy = ov(a.y, a.y + a.l, b.y, b.y + b.l);
    return dy <= EPS ? 0 : dx * dy;
  };

  /**
   * Allowed orientations for a cargo spec → [{w,l,h,ax}]
   * rotation: 'fixed' (exactly as entered) | 'upright' (turn around vertical axis only) | 'all' (6 ways)
   * ax: cylinder axis ('z' upright drum, 'x'/'y' lying drum).
   */
  E.orientations = function (spec) {
    var w = +spec.w, l = +spec.l, h = +spec.h, list;
    if (spec.pkg === 'cylinder') {
      list = [[w, w, h, 'z']];
      if (spec.rotation === 'all') list.push([h, w, w, 'x'], [w, h, w, 'y']);
    } else if (spec.rotation === 'fixed') {
      list = [[w, l, h]];
    } else if (spec.rotation === 'all') {
      list = [[w, l, h], [l, w, h], [w, h, l], [h, w, l], [l, h, w], [h, l, w]];
    } else {
      list = [[w, l, h], [l, w, h]];
    }
    // pallets: the fork-entry face must face the door (forklift loads from the door end)
    if (spec.forkFace === 'width') list = list.filter(function (d) { return d[0] === w && d[2] === h; });
    else if (spec.forkFace === 'length') list = list.filter(function (d) { return d[0] === l && d[2] === h; });
    var seen = {}, out = [];
    list.forEach(function (d) {
      var k = d[0] + 'x' + d[1] + 'x' + d[2];
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ w: d[0], l: d[1], h: d[2], ax: d[3] || null });
    });
    return out;
  };

  /** Can a box with this cross-section (w across, h up) pass through the door opening of C? */
  E.fitsDoor = function (w, h, C) {
    if (!(C && C.doorW > 0 && C.doorH > 0)) return true;
    return w <= C.doorW + EPS && h <= C.doorH + EPS;
  };

  /** Orientations that are allowed AND can be carried in through the door (load as placed). */
  E.doorOrientations = function (spec, C) {
    return E.orientations(spec).filter(function (o) { return E.fitsDoor(o.w, o.h, C); });
  };

  function contains(a, b) { // space a contains space b
    return a.x0 <= b.x0 + EPS && a.y0 <= b.y0 + EPS && a.z0 <= b.z0 + EPS &&
      a.x1 >= b.x1 - EPS && a.y1 >= b.y1 - EPS && a.z1 >= b.z1 - EPS;
  }
  E.spaceContains = contains;

  function tooSmall(s, minDim) {
    return s.x1 - s.x0 < minDim - EPS || s.y1 - s.y0 < minDim - EPS || s.z1 - s.z0 < minDim - EPS;
  }

  /**
   * Maximal-space (EMS) update: remove box b from the list of empty maximal spaces.
   * Every space that intersects b is replaced by up to 6 maximal sub-spaces; non-maximal
   * and too-small spaces are discarded.
   */
  E.splitSpaces = function (spaces, b, minDim) {
    minDim = minDim || 0;
    var out = [], fresh = [];
    var bx1 = b.x + b.w, by1 = b.y + b.l, bz1 = b.z + b.h;
    for (var i = 0; i < spaces.length; i++) {
      var s = spaces[i];
      if (b.x >= s.x1 - EPS || bx1 <= s.x0 + EPS || b.y >= s.y1 - EPS || by1 <= s.y0 + EPS ||
        b.z >= s.z1 - EPS || bz1 <= s.z0 + EPS) { out.push(s); continue; }
      if (b.x > s.x0 + EPS) fresh.push({ x0: s.x0, y0: s.y0, z0: s.z0, x1: b.x, y1: s.y1, z1: s.z1 });
      if (bx1 < s.x1 - EPS) fresh.push({ x0: bx1, y0: s.y0, z0: s.z0, x1: s.x1, y1: s.y1, z1: s.z1 });
      if (b.y > s.y0 + EPS) fresh.push({ x0: s.x0, y0: s.y0, z0: s.z0, x1: s.x1, y1: b.y, z1: s.z1 });
      if (by1 < s.y1 - EPS) fresh.push({ x0: s.x0, y0: by1, z0: s.z0, x1: s.x1, y1: s.y1, z1: s.z1 });
      if (b.z > s.z0 + EPS) fresh.push({ x0: s.x0, y0: s.y0, z0: s.z0, x1: s.x1, y1: s.y1, z1: b.z });
      if (bz1 < s.z1 - EPS) fresh.push({ x0: s.x0, y0: s.y0, z0: bz1, x1: s.x1, y1: s.y1, z1: s.z1 });
    }
    for (i = 0; i < fresh.length; i++) {
      var f = fresh[i];
      if (tooSmall(f, minDim)) continue;
      var dominated = false, j;
      for (j = 0; j < out.length && !dominated; j++) if (contains(out[j], f)) dominated = true;
      for (j = 0; j < fresh.length && !dominated; j++) {
        if (j === i) continue;
        // identical spaces: keep the first one only
        if (contains(fresh[j], f) && (!contains(f, fresh[j]) || j < i)) dominated = true;
      }
      if (!dominated) out.push(f);
    }
    return out;
  };

  E.pruneSpaces = function (spaces, minDim) {
    return spaces.filter(function (s) { return !tooSmall(s, minDim); });
  };
});
if (typeof module !== 'undefined' && module.exports) module.exports = LPEngineParts;
