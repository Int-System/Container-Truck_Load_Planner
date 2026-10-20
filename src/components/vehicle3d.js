/* Container & Truck Load Planner — components/vehicle3d.js
 * Procedural vehicle model drawn around the cargo box (decorative only — not pickable, no effect on
 * the calculation). Types: pickup · truck4 · truck6 · truck10 · trailer (tractor unit + container chassis)
 * · container (shipping container standing on the ground, no vehicle — default for container presets).
 * Geometry/axle positions come from data/vehicles.js so the model matches the axle-load figures.
 * three.js frame (same as viewer3d): X = length (cargo front wall at -L/2, door at +L/2),
 * Y = up (cargo floor at 0, ground at -deck), Z = width. Units: cm.
 * Paint / chrome / glass use MeshStandard/Physical materials and pick up scene.environment
 * (a soft studio environment created by viewer3d) for reflections.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};

  // ---------------------------------------------------------------- textures (cached per page)
  var texCache = {};
  function canvasTex(THREE, key, w, h, draw, repeatX) {
    if (texCache[key]) return texCache[key];
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    if (repeatX) t.repeat.set(repeatX, 1);
    t.userData = { shared: true };
    texCache[key] = t;
    return t;
  }
  function treadTexture(THREE) {
    // Lathe UVs: u = around the tyre, v = along the profile (inner sidewall → tread → outer sidewall)
    return canvasTex(THREE, 'tread', 128, 128, function (g, w, h) {
      g.fillStyle = '#262626'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#141414';
      for (var x = 0; x < w; x += 16) {                       // tread blocks in the middle band
        g.fillRect(x + 2, h * 0.38, 5, h * 0.24);
        g.fillRect(x + 10, h * 0.30, 3, h * 0.12);
        g.fillRect(x + 10, h * 0.58, 3, h * 0.12);
      }
      g.fillStyle = '#303030';                                  // sidewall rings
      g.fillRect(0, h * 0.12, w, 2); g.fillRect(0, h * 0.86, w, 2);
    }, 14);
  }
  function shadowTexture(THREE) {
    return canvasTex(THREE, 'blob', 256, 64, function (g) {
      var grd = g.createRadialGradient(128, 32, 4, 128, 32, 128);
      grd.addColorStop(0, 'rgba(0,0,0,0.22)');
      grd.addColorStop(0.6, 'rgba(0,0,0,0.08)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 256, 64);
    });
  }

  function offsetSeg(p, q, dist) {           // move segment p→q along its left normal
    var dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len * dist, ny = dx / len * dist;
    return [[p[0] + nx, p[1] + ny], [q[0] + nx, q[1] + ny]];
  }
  function lerp2(p, q, t) { return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; }

  /** ISO container structure around the cargo box: corner posts, rails, corner castings, door locking bars. */
  function containerFrame(box, cyl, M, L, W, H, doorsOpen) {
    var front = -L / 2, door = L / 2, cm = M.container, pw = 14;
    [-1, 1].forEach(function (sg) {
      [front + pw / 2, door - pw / 2].forEach(function (xp) { box(pw, H, 10, cm, xp, H / 2, sg * (W / 2 + 3)); });
      box(L, 10, 7, cm, 0, H + 1, sg * (W / 2 + 3));          // top side rail
      box(L, 16, 7, cm, 0, -8, sg * (W / 2 + 3));             // bottom side rail
    });
    box(10, 12, W + 8, cm, front + 5, H + 1, 0); box(10, 16, W + 8, cm, front + 5, -8, 0);
    box(12, 14, W + 8, cm, door - 6, H + 1, 0); box(12, 18, W + 8, cm, door - 6, -9, 0);
    [front + 9, door - 9].forEach(function (xp) {             // corner castings
      [-1, 1].forEach(function (sg) {
        [H + 3, -12].forEach(function (yp) {
          box(18, 12, 16, M.casting, xp, yp, sg * (W / 2 + 3));
          box(1, 5, 8, M.grille, xp + (xp > 0 ? 9.2 : -9.2), yp, sg * (W / 2 + 3));
        });
      });
    });
    if (!doorsOpen) [-0.35, -0.12, 0.12, 0.35].forEach(function (k) { cyl(1.6, 1.6, H - 10, M.alu, door + 3, H / 2, k * W, null, 8); });
  }

  /** Ground shadow: invisible plane that receives the real shadow + a soft contact blob. */
  function groundShadow(THREE, G, xMin, xMax, W, groundY) {
    var gsz = Math.max(xMax - xMin, W) * 6;
    var gnd = new THREE.Mesh(new THREE.PlaneGeometry(gsz, gsz), new THREE.ShadowMaterial({ opacity: 0.22 }));
    gnd.rotation.x = -Math.PI / 2;
    gnd.position.set((xMin + xMax) / 2, groundY + 0.2, 0);
    gnd.receiveShadow = true;
    G.add(gnd);
    var blob = new THREE.Mesh(new THREE.PlaneGeometry(xMax - xMin + 60, W + 90),
      new THREE.MeshBasicMaterial({ map: shadowTexture(THREE), transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.set((xMin + xMax) / 2, groundY + 0.4, 0);
    blob.renderOrder = -1;
    G.add(blob);
  }

  // ---------------------------------------------------------------- realistic container shell (Display → view style)
  /** Corrugated steel panel: x along `len` (centred), y up 0..h, corrugations bulging towards +z. */
  function corrugatedGeo(THREE, len, h) {
    var p = 27.8, a = 7.2, b = 7.0, d = 3.6, t = 0.4, s = (p - a - b) / 2, pts = [];
    for (var x0 = -len / 2; x0 < len / 2 - 0.01; x0 += p) {
      pts.push([x0, 0], [Math.min(x0 + b, len / 2), 0]);
      if (x0 + b + s + a <= len / 2) pts.push([x0 + b + s, d], [x0 + b + s + a, d]);
    }
    pts.push([len / 2, 0]);
    var sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    pts.forEach(function (q) { sh.lineTo(q[0], q[1]); });
    for (var i = pts.length - 1; i >= 0; i--) sh.lineTo(pts[i][0], pts[i][1] - t);
    var g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(Math.PI / 2);          // extrusion → height (downwards), profile depth → +z
    g.translate(0, h, 0);
    return g;
  }
  function woodTexture(THREE) {
    var t = canvasTex(THREE, 'wood', 512, 512, function (g, w, h) {
      var n = 8, rnd = function (k) { var x = Math.sin(k * 127.1) * 43758.5453; return x - Math.floor(x); };
      for (var i = 0; i < n; i++) {
        var s = 92 + rnd(i) * 28 | 0;
        g.fillStyle = 'rgb(' + s + ',' + (s * 0.68 | 0) + ',' + (s * 0.42 | 0) + ')';
        g.fillRect(0, i * h / n, w, h / n);
        for (var k = 0; k < 46; k++) {           // grain
          g.fillStyle = 'rgba(70,38,15,' + (rnd(i * 97 + k) * 0.14).toFixed(3) + ')';
          g.fillRect(rnd(i * 31 + k) * w, i * h / n + rnd(i * 53 + k) * h / n, 30 + rnd(k + i) * 140, 1.4);
        }
        g.fillStyle = 'rgba(30,15,5,0.45)'; g.fillRect(0, i * h / n, w, 2);        // plank gap
        g.fillRect(rnd(i + 7) * w, i * h / n, 2, h / n);                            // butt joint
      }
    });
    t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function plateTexture(THREE, text) {
    var c = document.createElement('canvas');
    c.width = 1024; c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.font = 'bold 44px Arial, sans-serif';
    var fit = Math.min(44, 44 * 980 / Math.max(1, g.measureText(text).width));   // shrink long lines to fit
    g.font = 'bold ' + fit.toFixed(1) + 'px Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 512, 34);
    var t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }
  /** Corrugated walls, roof, wooden floor and open doors with locking rods (+ container number plate). */
  function realShell(THREE, G, add, box, cyl, M, C) {
    var L = C.L, W = C.W, H = C.H, walls = {};
    var steel = new THREE.MeshStandardMaterial({ color: 0x9a3a26, metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide });
    var wood = woodTexture(THREE);
    wood.repeat.set(L / 240, W / 240);
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.15;
    floor.receiveShadow = true;
    G.add(floor);
    var left = add(new THREE.Mesh(corrugatedGeo(THREE, L - 2, H), steel));
    left.position.z = W / 2 + 0.6;
    var right = add(new THREE.Mesh(corrugatedGeo(THREE, L - 2, H), steel));
    right.position.z = -W / 2 - 0.6; right.scale.z = -1;
    var front = add(new THREE.Mesh(corrugatedGeo(THREE, W, H), steel));
    front.rotation.y = -Math.PI / 2; front.position.x = -L / 2 - 0.6;
    var roof = box(L, 1.4, W + 6, steel, 0, H + 0.9, 0);
    walls = { left: left, right: right, front: front, roof: roof };
    // doors swung open ~260°, folded back against the side walls; leaf direction (0,0,-s) rotated about the hinge post
    var lw = W / 2 + 3;
    // container number + weights in white on the rear header (stays in view; the folded doors face away)
    if (C.containerNo || C.maxGross) {
      var f = function (v) { return LP.units ? LP.units.fmt(v, 0) : String(Math.round(v)); };
      var parts = [];
      if (C.containerNo) parts.push(String(C.containerNo).toUpperCase().replace(/^([A-Z]{4})(\d{6})(\d)$/, '$1 $2 $3'));
      if (C.maxGross) parts.push('MAX GROSS ' + f(C.maxGross) + ' KG');
      if (C.tare) parts.push('TARE ' + f(C.tare) + ' KG');
      var pl = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.92, W * 0.92 / 16), new THREE.MeshBasicMaterial({ map: plateTexture(THREE, parts.join('   ')), transparent: true, depthWrite: false }));
      pl.rotation.y = Math.PI / 2;
      pl.position.set(L / 2 + 0.6, H + 1.5, 0);
      G.add(pl);
    }
    [-1, 1].forEach(function (s) {
      var hinge = new THREE.Group();
      hinge.position.set(L / 2 + 6, 0, s * (W / 2 + 3));
      var leaf = new THREE.Mesh(new THREE.BoxGeometry(4, H + 10, lw), steel);
      leaf.position.set(2, H / 2, -s * lw / 2);
      hinge.add(leaf);
      [0.18, 0.5, 0.82].forEach(function (k) {
        var rib = new THREE.Mesh(new THREE.BoxGeometry(2, 7, lw - 6), steel);
        rib.position.set(4.6, H * k, -s * lw / 2); hinge.add(rib);
      });
      [0.32, 0.74].forEach(function (k) {
        var rod = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, H + 4, 10), M.alu);
        rod.position.set(6.4, H / 2, -s * lw * k); hinge.add(rod);
        var handle = new THREE.Mesh(new THREE.BoxGeometry(3, 30, 5), M.casting);
        handle.position.set(8.2, 112, -s * lw * k); hinge.add(handle);
        [4, H - 4].forEach(function (y) { var kp = new THREE.Mesh(new THREE.BoxGeometry(5, 8, 7), M.casting); kp.position.set(6.4, y, -s * lw * k); hinge.add(kp); });
      });
      hinge.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      hinge.rotation.y = -s * 4.53;
      hinge.position.z += s * 5;          // clear of the corrugations when folded back
      G.add(hinge);
      walls[s > 0 ? 'doorLeft' : 'doorRight'] = hinge;
    });
    return walls;
  }

  /** Shipping container standing on the ground — no vehicle. With opts.real: full steel shell. */
  function buildContainerOnly(THREE, C, opts) {
    opts = opts || {};
    var G = new THREE.Group(), L = C.L, W = C.W, H = C.H, groundY = -18;
    var M = {
      container: new THREE.MeshStandardMaterial({ color: 0xb4432c, metalness: 0.25, roughness: 0.55 }),
      casting: new THREE.MeshStandardMaterial({ color: 0x3b3f45, metalness: 0.5, roughness: 0.5 }),
      alu: new THREE.MeshStandardMaterial({ color: 0xcfd5dc, metalness: 0.75, roughness: 0.35 }),
      grille: new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.3, roughness: 0.5 }),
      floor: new THREE.MeshStandardMaterial({ color: 0x5b6573, metalness: 0.2, roughness: 0.7 })
    };
    function add(m) { m.castShadow = true; m.receiveShadow = true; G.add(m); return m; }
    function box(w, h, d, mat, x, y, z) { var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return add(m); }
    function cyl(rt, rb, len, mat, x, y, z, axis, seg) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg || 16), mat);
      if (axis === 'x') m.rotation.z = Math.PI / 2;
      if (axis === 'z') m.rotation.x = Math.PI / 2;
      m.position.set(x, y, z);
      return add(m);
    }
    box(L - 4, 8, W, M.floor, 0, -4.2, 0);                                    // floor structure
    for (var cx = -L / 2 + 40; cx < L / 2 - 20; cx += 60) box(6, 10, W, M.casting, cx, -13, 0);   // cross members
    containerFrame(box, cyl, M, L, W, H, !!opts.real);
    var walls = opts.real ? realShell(THREE, G, add, box, cyl, M, C) : null;
    groundShadow(THREE, G, -L / 2 - 10, L / 2 + 10, W, groundY);
    var xMax = L / 2 + (opts.real ? 24 : 12);
    return { group: G, walls: walls, ext: { xMin: -L / 2 - 12, xMax: xMax, yMin: groundY, yMax: H + 10, zMax: W / 2 + (opts.real ? 22 : 12) } };
  }

  LP.buildVehicle = function (THREE, C, type, opts) {
    opts = opts || {};
    if (type === 'container') return buildContainerOnly(THREE, C, opts);
    var sp = LP.VEHICLE_DIMS[type];
    var G = new THREE.Group();
    if (!sp) return { group: G, ext: null };
    var lay = LP.vehicleLayout(C, type);
    var L = C.L, W = C.W, H = C.H;
    var deck = sp.deck, r = sp.r, tw = sp.tw, ground = -deck;
    var front = -L / 2, door = L / 2;
    var x0 = lay.cabFront - L / 2, x1 = lay.cabRear - L / 2, cabL = x1 - x0;
    var isTrailer = type === 'trailer', isPickup = sp.style === 'pickup';
    var cabW = isPickup ? Math.max(W, 175) : Math.min(Math.max(W * 0.97, 205), 250);
    var yb = ground + r, yt = ground + sp.cabTop;
    var railH = 22, railTop = -8.5;                         // chassis rails just under the body floor

    // ---------------------------------------------------------------- materials
    var paintColor = opts.cabColor ? new THREE.Color(opts.cabColor) : (isTrailer ? 0xf2f4f7 : 0xf5f6f8);
    var M = {
      paint: new THREE.MeshPhysicalMaterial({ color: paintColor, metalness: 0.15, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
      accent: new THREE.MeshPhysicalMaterial({ color: 0x1d4ed8, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1420, metalness: 0.4, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xe9edf2, metalness: 1, roughness: 0.18 }),
      alu: new THREE.MeshStandardMaterial({ color: 0xcfd5dc, metalness: 0.75, roughness: 0.35 }),
      plastic: new THREE.MeshStandardMaterial({ color: 0x23272e, metalness: 0.1, roughness: 0.65 }),
      grille: new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.3, roughness: 0.5 }),
      chassis: new THREE.MeshStandardMaterial({ color: 0x1f2329, metalness: 0.35, roughness: 0.6 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0xffffff, map: treadTexture(THREE), metalness: 0, roughness: 0.92, side: THREE.DoubleSide }),
      rim: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.65, roughness: 0.3 }),
      rimDark: new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.5, roughness: 0.45 }),
      head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d1, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.1 }),
      amber: new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff8a00, emissiveIntensity: 0.45, roughness: 0.3 }),
      red: new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xd01010, emissiveIntensity: 0.55, roughness: 0.3 }),
      white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
      box: new THREE.MeshStandardMaterial({ color: 0x5b6573, metalness: 0.2, roughness: 0.7 }),
      container: new THREE.MeshStandardMaterial({ color: 0xb4432c, metalness: 0.25, roughness: 0.55 }),
      casting: new THREE.MeshStandardMaterial({ color: 0x3b3f45, metalness: 0.5, roughness: 0.5 })
    };

    function add(mesh) { mesh.castShadow = true; mesh.receiveShadow = true; G.add(mesh); return mesh; }
    function box(w, h, d, mat, x, y, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      return add(m);
    }
    function cyl(rTop, rBot, len, mat, x, y, z, axis, seg) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, seg || 24), mat);
      if (axis === 'x') m.rotation.z = Math.PI / 2;
      if (axis === 'z') m.rotation.x = Math.PI / 2;
      m.position.set(x, y, z);
      return add(m);
    }
    /** Extrude an XY profile across the width (depth along Z, centred), with rounded edges. */
    function extrude(shape, width, mat, bevel, segs) {
      bevel = bevel || 0;
      var g = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(1, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
        bevelSegments: segs || 4, curveSegments: 20
      });
      g.translate(0, 0, -Math.max(1, width - bevel * 2) / 2);
      return add(new THREE.Mesh(g, mat));
    }
    function poly(pts) {
      var s = new THREE.Shape();
      s.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
      return s;
    }
    function roundRect(xa, ya, xb, yb2, rad) {
      var s = new THREE.Shape();
      s.moveTo(xa + rad, ya);
      s.lineTo(xb - rad, ya); s.quadraticCurveTo(xb, ya, xb, ya + rad);
      s.lineTo(xb, yb2 - rad); s.quadraticCurveTo(xb, yb2, xb - rad, yb2);
      s.lineTo(xa + rad, yb2); s.quadraticCurveTo(xa, yb2, xa, yb2 - rad);
      s.lineTo(xa, ya + rad); s.quadraticCurveTo(xa, ya, xa + rad, ya);
      return s;
    }

    // ---------------------------------------------------------------- wheels
    var rr = r * 0.6, cr = Math.min(tw * 0.3, (r - rr) * 0.45), tp = [];
    tp.push(new THREE.Vector2(rr, -tw / 2));
    for (var a = 0; a <= 6; a++) { var t1 = -Math.PI / 2 + a / 6 * Math.PI / 2; tp.push(new THREE.Vector2(r - cr + Math.cos(t1) * cr, -tw / 2 + cr + Math.sin(t1) * cr)); }
    for (a = 0; a <= 6; a++) { var t2 = a / 6 * Math.PI / 2; tp.push(new THREE.Vector2(r - cr + Math.cos(t2) * cr, tw / 2 - cr + Math.sin(t2) * cr)); }
    tp.push(new THREE.Vector2(rr, tw / 2));
    var tyreGeo = new THREE.LatheGeometry(tp, 40);
    var rimGeo = new THREE.CylinderGeometry(rr, rr, tw * 0.9, 32);
    var faceGeo = new THREE.CylinderGeometry(rr * 0.97, rr * 0.97, 1.4, 32);
    var hubGeo = new THREE.CylinderGeometry(rr * 0.3, rr * 0.36, 6, 20);
    var capGeo = new THREE.CylinderGeometry(rr * 0.12, rr * 0.12, 7.6, 12);
    var lugGeo = new THREE.CylinderGeometry(1.5, 1.5, 3.4, 6);
    var holeGeo = new THREE.CylinderGeometry(rr * 0.13, rr * 0.13, 1.8, 14);
    function wheel(x, z, outer, detail) {
      var g = new THREE.Group();
      [new THREE.Mesh(tyreGeo, M.rubber), new THREE.Mesh(rimGeo, M.rimDark)].forEach(function (m) { m.castShadow = true; g.add(m); });
      if (detail) {
        var fy = tw * 0.45, face = new THREE.Mesh(faceGeo, M.rim);
        face.position.y = fy; g.add(face);
        var hub = new THREE.Mesh(hubGeo, M.chrome); hub.position.y = fy + 3; g.add(hub);
        var cap = new THREE.Mesh(capGeo, M.plastic); cap.position.y = fy + 3; g.add(cap);
        for (var i = 0; i < 8; i++) {
          var an = i / 8 * Math.PI * 2;
          var lug = new THREE.Mesh(lugGeo, M.chrome);
          lug.position.set(Math.cos(an) * rr * 0.22, fy + 5.2, Math.sin(an) * rr * 0.22); g.add(lug);
        }
        for (i = 0; i < 6; i++) {
          var ah = (i + 0.5) / 6 * Math.PI * 2;
          var hole = new THREE.Mesh(holeGeo, M.grille);
          hole.position.set(Math.cos(ah) * rr * 0.64, fy + 0.4, Math.sin(ah) * rr * 0.64); g.add(hole);
        }
      }
      g.rotation.x = outer > 0 ? Math.PI / 2 : -Math.PI / 2;    // local +Y (outer face) → ±Z
      g.position.set(x, ground + r, z);
      G.add(g);
    }
    function axle(x, zOuter, dual, front) {
      [-1, 1].forEach(function (s) {
        wheel(x, s * (zOuter - tw / 2), s, true);
        if (dual) wheel(x, s * (zOuter - tw * 1.5 - 3), s, false);
      });
      cyl(5, 5, zOuter * 2 - tw, M.chassis, x, ground + r, 0, 'z', 12);
      if (!front) box(16, 14, zOuter * 1.2, M.chassis, x, ground + r + 4, 0);   // differential housing
    }
    /** Curved mudguard over a wheel set. */
    function fender(x, zOuter, width, rad, mat) {
      [-1, 1].forEach(function (s) {
        var g = new THREE.CylinderGeometry(rad, rad, width, 28, 1, true, Math.PI / 2, Math.PI);
        var m = new THREE.Mesh(g, mat || M.plastic);
        m.material.side = THREE.DoubleSide;
        m.rotation.x = Math.PI / 2;
        m.position.set(x, ground + r, s * (zOuter - width / 2 + 1));
        add(m);
      });
    }
    function mudflap(x, zOuter, width) {
      [-1, 1].forEach(function (s) { box(2, r * 1.15, width, M.plastic, x, ground + r * 0.6 + 4, s * (zOuter - width / 2)); });
    }

    // ---------------------------------------------------------------- cab
    var bev = isPickup ? 5 : 7;
    var axF = lay.axles[0].y - L / 2, archR = r * 1.16;
    var winShape, wsP, wsQ, yWin, sideWin;
    var s = new THREE.Shape();
    if (isPickup) {
      var hoodL = 82, yHood = yb + (yt - yb) * 0.47, X0 = x0 + bev, X1 = x1 - bev, YT = yt - bev, YB = yb;
      s.moveTo(X1, YB + 6);
      s.lineTo(axF + archR + bev, YB);
      s.absarc(axF, YB, archR + bev, 0, Math.PI, false);
      s.lineTo(X0 + 16, YB);
      s.quadraticCurveTo(X0, YB, X0, YB + 16);
      s.lineTo(X0, yHood - 10);
      s.quadraticCurveTo(X0 + 1, yHood, X0 + 16, yHood + 1);
      s.lineTo(X0 + hoodL, yHood + 7);
      s.quadraticCurveTo(X0 + hoodL + 8, yHood + 8, X0 + hoodL + 11, yHood + 13);
      s.lineTo(X0 + hoodL + 40, YT - 6);
      s.quadraticCurveTo(X0 + hoodL + 46, YT, X0 + hoodL + 60, YT);
      s.lineTo(X1 - 16, YT);
      s.quadraticCurveTo(X1 - 3, YT, X1 - 1, YT - 14);
      s.lineTo(X1, YB + 6);
      wsP = [X0 + hoodL + 11, yHood + 13]; wsQ = [X0 + hoodL + 40, YT - 6];
      yWin = yHood + 12;
      sideWin = [[X0 + hoodL + 22, yWin + 2], [X0 + hoodL + 42, YT - 9], [X1 - 18, YT - 9], [X1 - 14, YT - 14], [X1 - 14, yWin + 2]];
    } else {
      var X0c = x0 + bev, X1c = x1 - bev, YTc = yt - bev;
      yWin = yt - (yt - yb) * 0.45;
      s.moveTo(X1c, yb);
      s.lineTo(axF + archR + bev, yb);
      s.absarc(axF, yb, archR + bev, 0, Math.PI, false);
      s.lineTo(X0c + 14, yb);
      s.quadraticCurveTo(X0c, yb, X0c, yb + 14);
      s.lineTo(X0c, yWin - 12);
      s.quadraticCurveTo(X0c, yWin, X0c + 3, yWin + 5);
      s.lineTo(X0c + 13, YTc - 20);
      s.quadraticCurveTo(X0c + 17, YTc, X0c + 42, YTc);
      s.lineTo(X1c - 10, YTc);
      s.quadraticCurveTo(X1c, YTc, X1c, YTc - 10);
      s.lineTo(X1c, yb);
      wsP = [X0c + 3, yWin + 5]; wsQ = [X0c + 13, YTc - 20];
      var dwx0 = X0c + 30, dwx1 = X0c + cabL * 0.6;
      sideWin = [[dwx0, yWin + 8], [dwx0 + 4, YTc - 16], [dwx1 - 6, YTc - 16], [dwx1, YTc - 22], [dwx1, yWin + 8]];
    }
    extrude(s, cabW, M.paint, bev, 4);
    // windscreen: a band just outside the (bevel-expanded) front slope, narrower than the cab → A-pillars
    var a0 = lerp2(wsP, wsQ, 0.04), a1 = lerp2(wsP, wsQ, 0.96);
    var outA = offsetSeg(a0, a1, bev + 1.4), inA = offsetSeg(a0, a1, bev - 4);
    extrude(poly([outA[0], outA[1], inA[1], inA[0]]), cabW - 2 * bev - 14, M.glass, 0);
    // side windows (poke out of both side faces)
    extrude(poly(sideWin), cabW + 1.2, M.glass, 0);
    // door seam + handle + window trim
    var doorX = isPickup ? sideWin[4][0] + 6 : sideWin[4][0] + 4;
    // company logo on both doors (decal, aspect kept, fitted into the door panel below the window)
    if (opts.logo) {
      var lx0 = isPickup ? sideWin[0][0] + 4 : x0 + bev + 16, lx1 = doorX - 8;
      var ly0 = isPickup ? yb + 14 : yb + 30, ly1 = yWin - 8;
      var img = new Image();
      img.onload = function () {
        var tex = new THREE.Texture(img);
        tex.needsUpdate = true;
        var bw = lx1 - lx0, bh = ly1 - ly0, ar = img.width / img.height;
        var pw = Math.min(bw, bh * ar), ph = pw / ar;
        var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
        [-1, 1].forEach(function (sg) {
          var m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
          m.position.set((lx0 + lx1) / 2, (ly0 + ly1) / 2, sg * (cabW / 2 + 0.7));
          if (sg < 0) m.rotation.y = Math.PI;
          G.add(m);
        });
        if (opts.onAsset) opts.onAsset();
      };
      img.src = opts.logo;
    }
    [-1, 1].forEach(function (sg) {
      box(1.2, (yt - yb) * 0.66, 0.6, M.grille, doorX, yb + (yt - yb) * 0.4, sg * (cabW / 2 + 0.2));
      box(9, 2.4, 1.6, M.chrome, doorX - 16, yWin - 8, sg * (cabW / 2 + 0.8));
    });

    if (isPickup) {
      // grille, headlights, bumper
      var gy0 = yb + 24, gy1 = yHood - 8;
      box(3, gy1 - gy0 + 6, cabW * 0.6 + 6, M.chrome, x0 - 0.5, (gy0 + gy1) / 2, 0);
      box(3.4, gy1 - gy0, cabW * 0.6, M.grille, x0 - 0.8, (gy0 + gy1) / 2, 0);
      for (var gb = 1; gb <= 3; gb++) box(3.8, 1.6, cabW * 0.6, M.chrome, x0 - 1, gy0 + (gy1 - gy0) * gb / 4, 0);
      [-1, 1].forEach(function (sg) {
        box(3.6, 16, 40, M.grille, x0 - 0.2, yHood - 10, sg * (cabW / 2 - 22));     // headlight housing
        box(4, 10, 24, M.head, x0 - 0.6, yHood - 10, sg * (cabW / 2 - 26));
        box(4, 10, 9, M.amber, x0 - 0.6, yHood - 10, sg * (cabW / 2 - 8));
        cyl(3.8, 3.8, 2, M.chrome, x0 - 1.5, yHood - 10, sg * (cabW / 2 - 26), 'x', 16);
        // wheel-arch flare
        var fl = new THREE.Mesh(new THREE.CylinderGeometry(archR + bev + 3, archR + bev + 3, 6, 28, 1, true, Math.PI / 2, Math.PI), M.plastic);
        fl.material.side = THREE.DoubleSide;
        fl.rotation.x = Math.PI / 2;
        fl.position.set(axF, yb, sg * (cabW / 2 - 1));
        add(fl);
        // mirror
        box(3, 4, 14, M.plastic, sideWin[0][0] + 4, yWin + 4, sg * (cabW / 2 + 7));
        box(7, 12, 5, M.plastic, sideWin[0][0] + 4, yWin + 10, sg * (cabW / 2 + 15));
      });
      var bump = roundRect(x0 - 5, yb + 2, x0 + 16, yb + 20, 5);
      extrude(bump, cabW + 6, M.chrome, 2, 2);
    } else {
      // grille band, logo, headlights, bumper with fog lights, step, sun visor, wipers, mirrors
      var gy0c = yb + 34, gy1c = yWin - 14;
      var grl = roundRect(x0 - 2, gy0c, x0 + 6, gy1c, 3);
      extrude(grl, cabW * 0.66, M.grille, 1.5, 2);
      for (var gl = 1; gl <= 4; gl++) box(2.4, 2, cabW * 0.62, M.chrome, x0 - 2.6, gy0c + (gy1c - gy0c) * gl / 5, 0);
      box(2, 8, 30, M.chrome, x0 - 3.2, gy1c + 7, 0);                         // logo plate
      box(1.5, 4, cabW - 2 * bev - 6, M.accent, x0 - 0.2, gy1c + 0.5, 0);        // accent line
      [-1, 1].forEach(function (sg) {
        // headlight cluster: dark housing, main lens, indicator
        var hl = roundRect(x0 - 3, yb + 19, x0 + 4, yb + 41, 4);
        var hm = extrude(hl, 44, M.grille, 1.2, 2);
        hm.position.z = sg * (cabW / 2 - 28);
        box(2, 15, 26, M.head, x0 - 3.6, yb + 30, sg * (cabW / 2 - 34));
        box(2, 15, 10, M.amber, x0 - 3.6, yb + 30, sg * (cabW / 2 - 14));
        cyl(4.5, 4.5, 2.2, M.chrome, x0 - 4.4, yb + 30, sg * (cabW / 2 - 34), 'x', 16);   // projector
        // mirror arm + housing + glass
        cyl(1.4, 1.4, 22, M.plastic, x0 + 18, yWin + 18, sg * (cabW / 2 + 10), 'z', 8);
        var mh = roundRect(x0 + 12, yWin - 6, x0 + 26, yWin + 34, 4);
        var mm = extrude(mh, 8, M.plastic, 1.5, 2);
        mm.position.z = sg * (cabW / 2 + 22);
        box(1, 34, 6, M.glass, x0 + 27.6, yWin + 14, sg * (cabW / 2 + 22));       // mirror glass faces the driver
        // entry steps under the door
        var stepX = (x0 + doorX) / 2 + 6;
        box(34, 3, 16, M.alu, stepX, yb - 2, sg * (cabW / 2 - 4));
        box(34, 3, 12, M.alu, stepX, yb + 16, sg * (cabW / 2 - 2));
        // wipers
        box(1.2, 1.2, cabW * 0.32, M.plastic, x0 - 1.5, yWin + 9, sg * cabW * 0.17);
      });
      var bmp = roundRect(x0 - 8, yb - 6, x0 + 18, yb + 16, 6);
      extrude(bmp, cabW + 8, M.plastic, 3, 3);
      [-1, 1].forEach(function (sg) { cyl(5, 5, 3, M.head, x0 - 9.2, yb + 4, sg * (cabW / 2 - 30), 'x', 16); });
      box(20, 3, cabW - 30, M.plastic, x0 + 2, yt - 6, 0);                        // sun visor over the windscreen
      // roof deflector when the box is higher than the cab
      var hd = Math.min(95, H - yt - 4);
      if (hd > 18) {
        var df = new THREE.Shape();
        df.moveTo(x0 + 40, yt - 2);
        df.quadraticCurveTo(x0 + cabL * 0.45, yt + hd * 0.95, x1 - 30, yt + hd);
        df.lineTo(x1 - 6, yt + hd);
        df.lineTo(x1 - 6, yt - 2);
        df.lineTo(x0 + 40, yt - 2);
        extrude(df, cabW * 0.86, M.paint, 3, 3);
      }
      // exhaust stack in the gap behind the tractor cab
      if (isTrailer) {
        cyl(6, 6, yt - yb + 30, M.chrome, x1 + 10, yb + (yt - yb + 30) / 2, -(cabW / 2 - 16), null, 20);
        cyl(9, 9, (yt - yb) * 0.5, M.alu, x1 + 10, yb + (yt - yb) * 0.55, -(cabW / 2 - 16), null, 20);
      }
      // fuel tank: behind the front wheel under the cab if there is room, otherwise under the box
      var tStart = axF + r + 14, tEnd = x1 - 4;
      if (tEnd - tStart < 55) { tStart = x1 + 20; tEnd = Math.min(tStart + 100, lay.axles[1].y - L / 2 - r - 20); }
      if (tEnd - tStart > 30) {
        var tankL = tEnd - tStart, tz = Math.min(cabW, W) / 2 - 26, ty = Math.min(yb - 14, railTop - railH - 24);
        cyl(22, 22, tankL, M.alu, (tStart + tEnd) / 2, ty, tz, 'x', 28);
        [0.2, 0.8].forEach(function (k) { cyl(23.2, 23.2, 4, M.chassis, tStart + k * tankL, ty, tz, 'x', 28); });
        box(Math.min(44, tankL), 26, 30, M.chassis, (tStart + tEnd) / 2, ty, -tz);   // battery box opposite side
      }
    }

    // ---------------------------------------------------------------- chassis
    box(L, 8, W, M.box, 0, -4.2, 0);                                             // body sub-floor
    var railFrom = isTrailer ? front + 4 : x0 + 20;
    [-1, 1].forEach(function (sg) {
      box(door - railFrom, railH, 9, M.chassis, (door + railFrom) / 2, railTop - railH / 2, sg * W * 0.28);
    });
    for (var cx = front + 50; cx < door - 30; cx += 100) box(7, railH * 0.7, W * 0.56, M.chassis, cx, railTop - railH * 0.4, 0);
    if (isTrailer) {
      // tractor frame from the cab to past the drive axles
      [-1, 1].forEach(function (sg) { box(front + 120 - (x0 + 20), railH, 9, M.chassis, (x0 + 20 + front + 120) / 2, yb + 4, sg * 48); });
      var kp = lay.kingpin - L / 2;
      cyl(48, 48, 7, M.casting, kp, railTop - railH - 5, 0, null, 32);             // fifth wheel
      if (L > 500) {
        var lx = front + Math.min(260, L * 0.3), legH = deck - railH - 14;
        [-1, 1].forEach(function (sg) {
          box(9, legH, 9, M.alu, lx, ground + legH / 2 + 6, sg * W * 0.3);
          box(28, 4, 24, M.chassis, lx, ground + 2, sg * W * 0.3);
        });
        box(4, 4, W * 0.6, M.alu, lx, ground + legH * 0.7, 0);
      }
    }
    // rear bumper / underride bar + tail lights
    box(8, 12, W * 0.92, M.chassis, door + 4, railTop - railH - 10, 0);
    [-1, 1].forEach(function (sg) {
      box(3, 9, 22, M.red, door + 8.6, railTop - railH - 10, sg * W * 0.36);
      box(3, 9, 8, M.amber, door + 8.6, railTop - railH - 10, sg * W * 0.24);
    });

    // ---------------------------------------------------------------- body frame around the cargo box
    if (isTrailer) {
      containerFrame(box, cyl, M, L, W, H);
    } else {
      var pst = 7, fm = M.alu;
      [-1, 1].forEach(function (sg) {
        [front + pst / 2, door - 5].forEach(function (xp, i) { box(i ? 10 : pst, H + 4, i ? 9 : pst, fm, xp, H / 2, sg * (W / 2 + 1)); });
        box(L, 6, 6, fm, 0, H + 1, sg * (W / 2 + 1));                       // top rail
        box(L, 14, 4, fm, 0, -7, sg * (W / 2 + 3));                         // rub rail
        for (var tx = front + 30; tx < door - 20; tx += 50) {               // conspicuity tape
          box(24, 4, 0.6, (Math.round((tx - front) / 50) % 2) ? M.red : M.white, tx, -7, sg * (W / 2 + 5.2));
        }
        for (var mx = front + 60; mx < door - 40; mx += Math.max(120, L / 4)) box(5, 4, 1, M.amber, mx, -1, sg * (W / 2 + 5.4));
      });
      box(pst, 6, W + 2, fm, front + pst / 2, H + 1, 0);
      box(10, 10, W + 2, fm, door - 5, H + 3, 0);                            // door header
      box(10, 6, W + 2, fm, door - 5, -2, 0);                                // door sill
      // side underride guard between the axles (6/10-wheel)
      if (type === 'truck6' || type === 'truck10') {
        var g0 = x1 + 60, g1 = lay.axles[1].y - L / 2 - r - 16;
        if (g1 - g0 > 60) [-1, 1].forEach(function (sg) {
          [ground + 42, ground + 66].forEach(function (yy) { box(g1 - g0, 8, 3, M.alu, (g0 + g1) / 2, yy, sg * (W / 2 - 2)); });
          [g0 + 8, (g0 + g1) / 2, g1 - 8].forEach(function (bx) { box(5, railTop - railH - (ground + 40), 4, M.chassis, bx, (railTop - railH + ground + 40) / 2, sg * (W / 2 - 6)); });
        });
      }
    }

    // ---------------------------------------------------------------- axles, fenders, mudflaps
    var zR = W / 2 + 2, zF = cabW / 2 + 3, rearMost = -Infinity;
    lay.axles.forEach(function (ax, i) {
      var x = ax.y - L / 2;
      axle(x, i === 0 ? zF : zR, ax.dual, i === 0);
      if (i > 0) rearMost = Math.max(rearMost, x);
    });
    // rear fenders: one per axle group
    lay.groups.slice(1).forEach(function (g) {
      if (isPickup) return;                                  // pickup gets a body-coloured fender below
      var gx = g.y - L / 2, wdt = g.dual ? tw * 2 + 8 : tw + 8;
      if (g.n === 1) fender(gx, zR + 3, wdt, r * 1.14);
      else {
        var span = (g.n - 1) * (r * 2 + 20);
        [-1, 1].forEach(function (sg) { box(span + r * 1.4, 2.5, wdt, M.plastic, gx, ground + r * 2.2, sg * (zR + 3 - wdt / 2)); });
      }
    });
    if (isPickup) fender(lay.axles[1].y - L / 2, zR + 4, tw + 10, r * 1.15, M.paint);
    mudflap(rearMost + r + 12, zR + 2, lay.axles[lay.axles.length - 1].dual ? tw * 2 + 6 : tw + 6);
    if (isTrailer) {
      var lastDrive = Math.max.apply(null, lay.axles.filter(function (a) { return a.group === 'drive'; }).map(function (a) { return a.y; }));
      mudflap(lastDrive - L / 2 + r + 12, zR + 2, tw * 2 + 6);
    }

    // ---------------------------------------------------------------- ground (real shadow + soft contact blob)
    var xMin = x0 - 12, xMax = door + 16;
    groundShadow(THREE, G, xMin, xMax, W, ground);

    return {
      group: G,
      ext: { xMin: xMin, xMax: xMax, yMin: ground, yMax: Math.max(H + 6, yt + 20), zMax: Math.max(W / 2 + 8, cabW / 2 + 30) }
    };
  };
})(this);
