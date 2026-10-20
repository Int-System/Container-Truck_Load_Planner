/* Container & Truck Load Planner — components/cargo3d.js
 * Assets for the "realistic" view style (Display → View style): textured cartons with tape and an SKU
 * label, stretch-wrapped pallet loads on a wooden pallet, ribbed steel drums, and a 1.70 m person for
 * scale. Everything is procedural (canvas textures + simple geometry) and built once per page.
 * Shapes are unit-sized (−0.5…0.5) so the instanced cargo in viewer3d.js can scale them per item.
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};
  var cache = null;

  function canvas(w, h, draw) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
  }
  function rnd(k) { var x = Math.sin(k * 127.1 + 11.7) * 43758.5453; return x - Math.floor(x); }
  function kraft(g, x0, y0, w, h, seed) {
    g.fillStyle = '#b8895a'; g.fillRect(x0, y0, w, h);
    for (var i = 0; i < 160; i++) {                    // paper fibres
      g.fillStyle = 'rgba(' + (rnd(seed + i) > 0.5 ? '255,235,200' : '90,55,25') + ',' + (0.03 + rnd(seed + i * 3) * 0.05).toFixed(3) + ')';
      g.fillRect(x0 + rnd(seed + i * 7) * w, y0 + rnd(seed + i * 11) * h, 8 + rnd(i) * 40, 1);
    }
  }
  /** UV-remap a unit box so the 4 sides use the left half of an atlas and top/bottom the right half. */
  function atlasBox(THREE) {
    var g = new THREE.BoxGeometry(1, 1, 1), uv = g.attributes.uv;
    for (var f = 0; f < 6; f++) {
      for (var k = 0; k < 4; k++) {
        var i = f * 4 + k, u = uv.getX(i);
        uv.setX(i, f === 2 || f === 3 ? 0.5 + u * 0.5 : u * 0.5);
      }
    }
    uv.needsUpdate = true;
    return g;
  }
  function tex(THREE, c, aniso) {
    var t = new THREE.CanvasTexture(c);
    t.anisotropy = aniso || 4;
    t.userData = { shared: true };
    return t;
  }
  /** Merge simple geometries (non-indexed) into one. */
  function merge(THREE, geos) {
    var pos = [], nor = [];
    geos.forEach(function (g) {
      var n = g.index ? g.toNonIndexed() : g;
      pos.push.apply(pos, n.attributes.position.array);
      nor.push.apply(nor, n.attributes.normal.array);
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return out;
  }
  function boxAt(THREE, w, h, d, x, y, z) { var g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }

  LP.cargoAssets = function (THREE) {
    if (cache) return cache;
    // cartons: sides (flap seams, "this way up" arrows) | top (tape across the flaps)
    var cartonC = canvas(1024, 512, function (g) {
      kraft(g, 0, 0, 512, 512, 1);
      g.fillStyle = 'rgba(70,40,15,0.35)'; g.fillRect(0, 30, 512, 3); g.fillRect(0, 479, 512, 3);
      g.fillStyle = 'rgba(255,240,215,0.10)'; g.fillRect(0, 0, 512, 30); g.fillRect(0, 482, 512, 30);
      g.strokeStyle = 'rgba(60,35,15,0.55)'; g.lineWidth = 6;
      [[40, 0], [84, 0]].forEach(function (a) {          // ↑↑ this way up
        g.beginPath(); g.moveTo(a[0], 120); g.lineTo(a[0], 70); g.moveTo(a[0] - 14, 86); g.lineTo(a[0], 70); g.lineTo(a[0] + 14, 86); g.stroke();
      });
      kraft(g, 512, 0, 512, 512, 7);
      g.fillStyle = 'rgba(40,20,5,0.4)'; g.fillRect(512, 254, 512, 3);   // flap gap
      g.fillStyle = 'rgba(214,186,140,0.96)'; g.fillRect(512, 196, 512, 120);
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(512, 196, 512, 10);
      g.fillStyle = 'rgba(120,85,45,0.18)'; g.fillRect(512, 306, 512, 10);
    });
    // stretch-wrapped pallet load: a block of cartons behind shiny film
    var loadC = canvas(1024, 512, function (g) {
      function grid(x0, cols, rows, tape) {
        var cw = 512 / cols, rh = 512 / rows;
        for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
          kraft(g, x0 + c * cw + 2, r * rh + 2, cw - 4, rh - 4, r * 13 + c * 7 + x0);
          if (tape) { g.fillStyle = 'rgba(214,186,140,0.9)'; g.fillRect(x0 + c * cw + 2, r * rh + rh / 2 - rh * 0.11, cw - 4, rh * 0.22); }
        }
        g.fillStyle = 'rgba(60,35,15,0.55)';
        for (var c2 = 0; c2 <= cols; c2++) g.fillRect(x0 + c2 * cw - 2, 0, 4, 512);
        for (var r2 = 0; r2 <= rows; r2++) g.fillRect(x0, r2 * rh - 2, 512, 4);
        for (var k = 0; k < 26; k++) {                  // film sheen
          g.strokeStyle = 'rgba(255,255,255,' + (0.08 + rnd(k + x0) * 0.22).toFixed(2) + ')';
          g.lineWidth = 1 + rnd(k * 3) * 3;
          g.beginPath(); var y = rnd(k * 5 + x0) * 512; g.moveTo(x0, y); g.lineTo(x0 + 512, y + (rnd(k) - 0.5) * 120); g.stroke();
        }
      }
      grid(0, 3, 3, false);
      grid(512, 3, 2, true);
    });
    // SKU label: drawn white so the per-instance colour tints it; barcode and text lines stay dark
    var labelC = canvas(256, 180, function (g) {
      g.fillStyle = '#ffffff';
      g.beginPath(); g.moveTo(10, 0); g.lineTo(246, 0); g.quadraticCurveTo(256, 0, 256, 10); g.lineTo(256, 170); g.quadraticCurveTo(256, 180, 246, 180);
      g.lineTo(10, 180); g.quadraticCurveTo(0, 180, 0, 170); g.lineTo(0, 10); g.quadraticCurveTo(0, 0, 10, 0); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(14, 62, 228, 104);
      g.fillStyle = 'rgba(15,20,30,0.85)';
      g.fillRect(18, 18, 150, 16); g.fillRect(18, 40, 96, 10);
      for (var i = 0; i < 46; i++) if (rnd(i * 3) > 0.35) g.fillRect(22 + i * 4.6, 80, rnd(i) > 0.6 ? 3.2 : 1.6, 56);
      g.fillRect(22, 144, 120, 8);
    });
    var drumProfile = [[0, -0.5], [0.45, -0.5], [0.49, -0.49], [0.5, -0.47], [0.5, -0.2], [0.515, -0.185], [0.5, -0.17],
      [0.5, 0.17], [0.515, 0.185], [0.5, 0.2], [0.5, 0.47], [0.49, 0.49], [0.45, 0.5], [0.44, 0.485], [0, 0.485]]
      .map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    var drum = new THREE.LatheGeometry(drumProfile, 36);
    // wooden pallet (unit box): 5 top deck boards, 9 blocks, 3 bottom runners
    var parts = [];
    for (var b = 0; b < 5; b++) parts.push(boxAt(THREE, 1, 0.16, 0.14, 0, 0.42, -0.43 + b * 0.215));
    [-0.44, 0, 0.44].forEach(function (x) { [-0.43, 0, 0.43].forEach(function (z) { parts.push(boxAt(THREE, 0.12, 0.5, 0.14, x, 0.09, z)); }); });
    [-0.43, 0, 0.43].forEach(function (z) { parts.push(boxAt(THREE, 1, 0.18, 0.14, 0, -0.41, z)); });
    var pallet = merge(THREE, parts);

    cache = {
      box: atlasBox(THREE),
      drum: drum,
      pallet: pallet,
      label: new THREE.PlaneGeometry(1, 1),
      cartonMat: new THREE.MeshLambertMaterial({ map: tex(THREE, cartonC, 8) }),
      loadMat: new THREE.MeshStandardMaterial({ map: tex(THREE, loadC, 8), roughness: 0.35, metalness: 0 }),
      labelMat: new THREE.MeshLambertMaterial({ map: tex(THREE, labelC), transparent: true, alphaTest: 0.3 }),
      drumMat: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.38 }),
      palletMat: new THREE.MeshStandardMaterial({ color: 0xb08356, roughness: 0.95, metalness: 0 })
    };
    return cache;
  };

  /** A simple 1.70 m worker in a hi-vis vest and hard hat (cm units, feet at y = 0). */
  LP.buildPerson = function (THREE, labelSprite) {
    var G = new THREE.Group();
    var skin = new THREE.MeshStandardMaterial({ color: 0xc69c7b, roughness: 0.8 });
    var trousers = new THREE.MeshStandardMaterial({ color: 0x2f3b4f, roughness: 0.85 });
    var vest = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.6 });
    var stripe = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.3, metalness: 0.4 });
    var hat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45 });
    var boots = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.7 });
    function add(geo, mat, x, y, z) { var m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; G.add(m); return m; }
    [-9, 9].forEach(function (x) {
      add(new THREE.CylinderGeometry(6.5, 5.5, 80, 12), trousers, x, 46, 0);
      add(new THREE.BoxGeometry(12, 7, 24), boots, x, 3.5, 4);
    });
    add(new THREE.CylinderGeometry(17, 15, 58, 16), vest, 0, 115, 0);
    [100, 116].forEach(function (y) { add(new THREE.CylinderGeometry(17.3, 16.6, 3, 16), stripe, 0, y, 0); });
    [-22, 22].forEach(function (x) {
      var arm = add(new THREE.CylinderGeometry(4.6, 4.2, 58, 10), skin, x, 114, 0);
      arm.rotation.z = x > 0 ? 0.08 : -0.08;
    });
    add(new THREE.CylinderGeometry(5, 5.5, 8, 10), skin, 0, 147, 0);
    add(new THREE.SphereGeometry(11, 20, 16), skin, 0, 158, 0);
    var h = add(new THREE.SphereGeometry(12, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), hat, 0, 160, 0);
    h.scale.set(1, 0.85, 1.08);
    add(new THREE.CylinderGeometry(14, 14, 1.5, 20), hat, 0, 160.5, 2);
    if (labelSprite) { labelSprite.position.set(0, 190, 0); G.add(labelSprite); }
    return G;
  };
})(this);
