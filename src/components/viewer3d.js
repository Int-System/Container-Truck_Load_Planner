/* Container & Truck Load Planner — components/viewer3d.js
 * Three.js viewer + manual drag & drop.
 * Engine (x width, y length, z up)  →  three.js (X = length, door at +X; Y = up; Z = width, x=0 at +Z)
 * so that, looking from the door, engine x=0 is on the viewer's left (same as the 2D views).
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function textSprite(text, color, worldWidth) {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    var g = c.getContext('2d');
    g.font = 'bold 64px system-ui, "Segoe UI", "Noto Sans Thai", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.strokeText(text, 256, 64);
    g.fillStyle = color;
    g.fillText(text, 256, 64);
    var tex = new THREE.CanvasTexture(c);
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(worldWidth, worldWidth / 4, 1);
    s.renderOrder = 10;
    return s;
  }

  LP.Viewer3D = function (el, cb) {
    if (!root.THREE) {
      el.innerHTML = '<div class="no3d">3D library (three.js) could not be loaded — check the internet connection. 2D views still work.</div>';
      return null;
    }
    var renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    var canvas = renderer.domElement;
    canvas.style.touchAction = 'none';

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(42, 1, 1, 200000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 0.85));
    var sun = new THREE.DirectionalLight(0xffffff, 0.55);
    var SUN_DIR = new THREE.Vector3(0.6, 1, 0.8).normalize();
    sun.position.copy(SUN_DIR);
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 1.5;
    scene.add(sun, sun.target);

    // soft "studio" environment: only MeshStandard/Physical materials (vehicle paint, chrome, glass) use it;
    // the cargo boxes use Lambert materials and keep their flat colours.
    (function buildEnvironment() {
      try {
        var envScene = new THREE.Scene();
        var sky = new THREE.SphereGeometry(100, 32, 16), cols = [], pos = sky.attributes.position;
        var top = new THREE.Color(0xffffff), mid = new THREE.Color(0xc9d3e0), bot = new THREE.Color(0x4a525e);
        for (var i = 0; i < pos.count; i++) {
          var y = pos.getY(i) / 100, c = y > 0 ? mid.clone().lerp(top, y) : mid.clone().lerp(bot, -y);
          cols.push(c.r, c.g, c.b);
        }
        sky.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        envScene.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
        [[0, 80, 0, 90], [70, 40, 50, 40], [-70, 30, -40, 40]].forEach(function (p) {   // soft-box highlights
          var panel = new THREE.Mesh(new THREE.PlaneGeometry(p[3], p[3] * 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
          panel.position.set(p[0], p[1], p[2]);
          panel.lookAt(0, 0, 0);
          envScene.add(panel);
        });
        var pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(envScene, 0.04).texture;
        pmrem.dispose();
      } catch (e) { /* environment is optional */ }
    })();

    var containerG = new THREE.Group(), cargoG = new THREE.Group(), overlayG = new THREE.Group();
    scene.add(containerG, cargoG, overlayG);

    var unitBox = new THREE.BoxGeometry(1, 1, 1);
    var unitEdges = new THREE.EdgesGeometry(unitBox);
    var unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 28);
    var edgeMat = new THREE.LineBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.55 });
    var palletMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
    var selBox = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: 0xfacc15, depthTest: false, transparent: true }));
    selBox.renderOrder = 20;
    selBox.visible = false;
    overlayG.add(selBox);
    var cogMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false, transparent: true, opacity: 0.85 }));
    cogMarker.renderOrder = 15;
    overlayG.add(cogMarker);

    // ---- cargo: instanced rendering ----
    // All boxes are ONE InstancedMesh (+ one for drums, one for pallet bases) with per-instance colour,
    // and all edges are ONE merged LineSegments. A few draw calls instead of two per box, so jobs with
    // thousands of items stay smooth. Hidden items get a zero-scale matrix.
    var cargoMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    var lockMat = new THREE.LineBasicMaterial({ color: 0x0f172a });
    var ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    var dummy = new THREE.Object3D(), tmpColor = new THREE.Color();
    var BAD = new THREE.Color(0xef4444), DONE = new THREE.Color(0xd3d9e1);
    function freshInst() { return { box: null, cyl: null, pal: null, uids: { box: [], cyl: [] }, index: {}, edges: null, locks: null }; }
    var inst = freshInst(), stepMode = null, dragUid = null;

    var C = { W: 235, L: 590, H: 239 }, wallMats = [], data = null, manual = false, dirty = true;
    var vehicleG = new THREE.Group(), vehicle = { type: null, show: true }, vehicleExt = null, builtKey = null;
    scene.add(vehicleG);
    var opacity = 0.18;

    // ---- pointer handling (registered before OrbitControls so we can veto orbiting) ----
    var ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    var drag = null, down = null;
    function setNdc(e) {
      var r = canvas.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    }
    function pick(e) {
      setNdc(e);
      var list = [inst.box, inst.cyl].filter(Boolean);
      var hits = ray.intersectObjects(list, false);
      for (var k = 0; k < hits.length; k++) {
        var hit = hits[k];
        if (hit.instanceId == null) continue;
        var uid = (hit.object === inst.box ? inst.uids.box : inst.uids.cyl)[hit.instanceId];
        if (uid && inst.index[uid] && inst.index[uid].visible) return { uid: uid, point: hit.point };
      }
      return null;
    }
    function centerOf(p) { return new THREE.Vector3(p.y + p.l / 2 - C.L / 2, p.z + p.h / 2, C.W / 2 - p.x - p.w / 2); }
    canvas.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY };
      if (!manual || e.button !== 0) return;
      var h = pick(e);
      if (!h) return;
      var p = data && data.byUid[h.uid];
      if (!p) return;
      cb.onSelect(h.uid);
      if (p.locked) return;
      var c0 = centerOf(p);
      drag = { uid: h.uid, plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -h.point.y), off: new THREE.Vector3(h.point.x - c0.x, 0, h.point.z - c0.z), moved: false, last: null };
      dragUid = h.uid;
      rebuildLines();                       // the dragged box's edges are shown by the selection box instead
      controls.enabled = false;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events (automated tests) */ }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) {
        if (cb.onHover && !e.buttons) { var h = pick(e); cb.onHover(h ? h.uid : null, e.clientX, e.clientY); }
        return;
      }
      setNdc(e);
      var pt = new THREE.Vector3();
      if (!ray.ray.intersectPlane(drag.plane, pt)) return;
      var p = data.byUid[drag.uid];
      var cx = pt.x - drag.off.x, cz = pt.z - drag.off.z;
      var y = cx + C.L / 2 - p.l / 2, x = C.W / 2 - cz - p.w / 2;
      var res = cb.onDrag(drag.uid, x, y);
      if (!res) return;
      drag.moved = true;
      drag.last = res;
      var e0 = inst.index[drag.uid];
      if (e0) { writeInstance(e0, { x: res.x, y: res.y, z: res.z, w: p.w, l: p.l, h: p.h, ax: p.ax }, true, res.bad ? BAD : null); flushInstances(); }
      updateSel(drag.uid, res);
      dirty = true;
    });
    function endDrag(e) {
      if (drag) {
        controls.enabled = true;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        var d = drag;
        drag = null;
        dragUid = null;
        if (d.moved && d.last) cb.onDragEnd(d.uid, d.last);
        else { rebuildLines(); dirty = true; }
        return;
      }
      if (down && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 5 && e.button === 0) {
        var h = pick(e);
        cb.onSelect(h ? h.uid : null);
      }
      down = null;
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', function () { if (drag) { drag = null; dragUid = null; controls.enabled = true; cb.onDragEnd(null); } });
    canvas.addEventListener('pointerleave', function () { if (cb.onHover) cb.onHover(null); });

    var controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', function () { dirty = true; });

    function placeMesh(m, p, spec) {
      m.position.set(p.y + p.l / 2 - C.L / 2, p.z + p.h / 2, C.W / 2 - p.x - p.w / 2);
      m.rotation.set(0, 0, 0);
      if (spec && spec.pkg === 'cylinder') {
        if (p.ax === 'x') { m.rotation.x = Math.PI / 2; m.scale.set(p.l, p.w, p.h); }
        else if (p.ax === 'y') { m.rotation.z = Math.PI / 2; m.scale.set(p.h, p.l, p.w); }
        else m.scale.set(p.l, p.h, p.w);
      } else m.scale.set(p.l, p.h, p.w);
    }

    function updateSel(uid, pos) {
      var p = uid && data && data.byUid[uid];
      if (!p) { selBox.visible = false; return; }
      var q = pos ? { x: pos.x, y: pos.y, z: pos.z, w: p.w, l: p.l, h: p.h } : p;
      selBox.visible = true;
      selBox.position.set(q.y + q.l / 2 - C.L / 2, q.z + q.h / 2, C.W / 2 - q.x - q.w / 2);
      selBox.scale.set(q.l + 1.5, q.h + 1.5, q.w + 1.5);
    }

    function disposeGroup(g) {
      g.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
          if (m.map && !(m.map.userData && m.map.userData.shared)) m.map.dispose();
          m.dispose();
        });
      });
      g.clear();
    }

    function buildVehicle() {
      disposeGroup(vehicleG);
      vehicleExt = null;
      if (!vehicle.show || !vehicle.type || !LP.buildVehicle) return;
      var v = LP.buildVehicle(THREE, C, vehicle.type, {
        cabColor: vehicle.cabColor, logo: vehicle.logo,
        onAsset: function () { sun.shadow.needsUpdate = true; dirty = true; }
      });
      vehicleG.add(v.group);
      vehicleExt = v.ext;
      configureShadows();
    }

    /** Fit the sun's shadow camera around the vehicle; shadows only when the vehicle (and its ground) is shown. */
    function configureShadows() {
      sun.castShadow = !!vehicleExt;
      if (!vehicleExt) { sun.position.copy(SUN_DIR); sun.target.position.set(0, 0, 0); return; }
      var e = vehicleExt, cx = (e.xMin + e.xMax) / 2, cy = (e.yMin + e.yMax) / 2;
      var size = Math.max(e.xMax - e.xMin, e.yMax - e.yMin, e.zMax * 2) * 1.15;
      sun.target.position.set(cx, cy, 0);
      sun.position.copy(SUN_DIR).multiplyScalar(size * 3).add(sun.target.position);
      var sc = sun.shadow.camera;
      sc.left = -size; sc.right = size; sc.top = size; sc.bottom = -size;
      sc.near = size * 0.5; sc.far = size * 6;
      sc.updateProjectionMatrix();
      sun.shadow.needsUpdate = true;
    }

    function buildContainer() {
      disposeGroup(containerG);
      wallMats = [];
      var L = C.L, W = C.W, H = C.H;
      var floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshLambertMaterial({ color: 0x9aa4b2 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.3;
      containerG.add(floor);
      var gridPts = [], step = Math.max(L, W) > 900 ? 100 : 50;
      for (var gx = -L / 2 + step; gx < L / 2; gx += step) gridPts.push(gx, 0.1, -W / 2, gx, 0.1, W / 2);
      for (var gz = -W / 2 + step; gz < W / 2; gz += step) gridPts.push(-L / 2, 0.1, gz, L / 2, 0.1, gz);
      var gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
      containerG.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x6b7280, transparent: true, opacity: 0.35 })));

      function wall(w, h, pos, rot) {
        var m = new THREE.MeshLambertMaterial({ color: 0xc7d2fe, transparent: true, opacity: opacity, side: THREE.DoubleSide, depthWrite: false });
        wallMats.push(m);
        var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
        mesh.position.copy(pos);
        if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
        mesh.renderOrder = 5;
        containerG.add(mesh);
      }
      wall(W, H, new THREE.Vector3(-L / 2, H / 2, 0), [0, Math.PI / 2, 0]);        // front wall
      wall(L, H, new THREE.Vector3(0, H / 2, W / 2));                               // left wall (x=0)
      wall(L, H, new THREE.Vector3(0, H / 2, -W / 2));                              // right wall
      wall(L, W, new THREE.Vector3(0, H, 0), [-Math.PI / 2, 0, 0]);                // roof
      var box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W)), new THREE.LineBasicMaterial({ color: 0x334155 }));
      box.position.y = H / 2;
      containerG.add(box);
      // door frame and opened door leaves
      var doorMat = new THREE.MeshLambertMaterial({ color: 0xea580c, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
      var t = Math.max(2, W * 0.012);
      var DW = Math.min(C.doorW || W, W), DH = Math.min(C.doorH || H, H);
      [DW / 2, -DW / 2].forEach(function (zEdge, i) {
        var leaf = new THREE.Mesh(new THREE.BoxGeometry(DW / 2, DH, t), doorMat);
        var hinge = new THREE.Group();
        hinge.position.set(L / 2, DH / 2, zEdge);
        leaf.position.set(0, 0, (i === 0 ? -1 : 1) * DW / 4);
        hinge.add(leaf);
        hinge.rotation.y = (i === 0 ? -1 : 1) * Math.PI * 0.62;
        containerG.add(hinge);
      });
      // clear door opening + the header / jambs that make it smaller than the inside
      var frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(DW, DH)), new THREE.LineBasicMaterial({ color: 0xea580c }));
      frame.rotation.y = Math.PI / 2;
      frame.position.set(L / 2 + 0.5, DH / 2, 0);
      containerG.add(frame);
      var lipMat = new THREE.MeshLambertMaterial({ color: 0x64748b, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      function lip(w, h, y, z) {
        var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lipMat);
        m.rotation.y = Math.PI / 2;
        m.position.set(L / 2 + 0.3, y, z);
        containerG.add(m);
      }
      if (H - DH > 0.5) lip(W, H - DH, DH + (H - DH) / 2, 0);
      if (W - DW > 0.5) [-1, 1].forEach(function (s) { lip((W - DW) / 2, DH, DH / 2, s * (DW / 2 + (W - DW) / 4)); });
      var sz = Math.max(W * 0.9, 120);
      var dl = textSprite(LP.t('doorHere'), '#ea580c', sz);
      dl.position.set(L / 2 + sz * 0.15, H + sz * 0.22, 0);
      containerG.add(dl);
      var fl = textSprite(LP.t('frontHere'), '#334155', sz);
      fl.position.set(-L / 2, H + sz * 0.22, 0);
      containerG.add(fl);
      var ll = textSprite(LP.t('left'), '#475569', sz * 0.6);
      ll.position.set(0, 4, W / 2 + sz * 0.25);
      containerG.add(ll);
      cogMarker.scale.setScalar(Math.max(W, L) * 0.008);
      buildVehicle();
      dirty = true;
    }

    /** Bounding box of what should be framed: the cargo box, plus the vehicle when shown. */
    function frameBounds() {
      var b = { x0: -C.L / 2, x1: C.L / 2 + C.W * 0.4, y0: 0, y1: C.H * 1.08, z: C.W / 2 };   // + open door leaves / labels
      if (vehicleExt) { b.x0 = Math.min(b.x0, vehicleExt.xMin); b.x1 = Math.max(b.x1, vehicleExt.xMax); b.y0 = vehicleExt.yMin; b.y1 = Math.max(b.y1, vehicleExt.yMax); b.z = Math.max(b.z, vehicleExt.zMax); }
      return b;
    }

    function resetCamera() {
      var b = frameBounds();
      var ly = b.y1 - b.y0;
      var cx = (b.x0 + b.x1) / 2, cy = b.y0 + ly * 0.45;
      var dir = new THREE.Vector3(0.62, 0.55, 0.85).normalize();
      // tight fit: smallest distance at which all 8 bounding-box corners are inside the frustum
      var f = dir.clone().negate(), rgt = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
      var up = new THREE.Vector3().crossVectors(rgt, f);
      var tanV = Math.tan(camera.fov * Math.PI / 360), tanH = tanV * camera.aspect, dist = 0;
      [b.x0, b.x1].forEach(function (x) { [b.y0, b.y1].forEach(function (y) { [-b.z, b.z].forEach(function (z) {
        var p = new THREE.Vector3(x - cx, y - cy, z), zc = p.dot(dir);
        dist = Math.max(dist, zc + Math.abs(p.dot(rgt)) / tanH, zc + Math.abs(p.dot(up)) / tanV);
      }); }); });
      dist *= 1.08;
      camera.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(cx, cy, 0));
      controls.target.set(cx, cy, 0);
      camera.near = Math.max(1, dist / 500);
      camera.far = dist * 20;
      camera.updateProjectionMatrix();
      controls.update();
      dirty = true;
    }

    var anim = null;
    function setCamera(view) {
      var b = frameBounds(), lx = b.x1 - b.x0, ly = b.y1 - b.y0;
      var R = Math.sqrt(lx * lx + ly * ly + 4 * b.z * b.z) / 2;
      var dist = R / Math.sin(camera.fov * Math.PI / 360) * (camera.aspect < 1 ? 1.5 / camera.aspect : 1.02);
      var cx = (b.x0 + b.x1) / 2, cy = b.y0 + ly * 0.45;
      var to, tgt = new THREE.Vector3(0, C.H * 0.4, 0);
      if (view === 'door') {
        var dd = Math.max(C.W, C.H - b.y0) / Math.tan(camera.fov * Math.PI / 360) * 0.75 + C.L / 2;
        to = new THREE.Vector3(dd, C.H * 0.75, 0);
        tgt.set(0, (C.H + b.y0) * 0.45, 0);
      } else if (view === 'cab') {
        // front three-quarter view of the cab (falls back to the front of the cargo box)
        var fx = vehicleExt ? vehicleExt.xMin : -C.L / 2, gy = vehicleExt ? vehicleExt.yMin : 0;
        var hh = Math.max(C.H - gy, 200);
        tgt.set(fx + hh * 0.45, gy + hh * 0.45, 0);
        to = new THREE.Vector3(fx - hh * 1.35, gy + hh * 0.85, hh * 1.15);
      } else if (view === 'side') { to = new THREE.Vector3(cx, cy, dist * 0.95); tgt.set(cx, cy, 0); }
      else if (view === 'top') { to = new THREE.Vector3(cx + 0.001, dist * 0.95, 0.001); tgt.set(cx, 0, 0); }
      else { resetCamera(); return; }
      var from = camera.position.clone(), fromT = controls.target.clone(), t0 = performance.now();
      camera.far = Math.max(camera.far, dist * 20);
      camera.updateProjectionMatrix();
      if (anim) cancelAnimationFrame(anim);
      (function step() {
        var k = Math.min(1, (performance.now() - t0) / 380), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        camera.position.lerpVectors(from, to, e);
        controls.target.lerpVectors(fromT, tgt, e);
        controls.update();
        dirty = true;
        if (k < 1) anim = requestAnimationFrame(step); else anim = null;
      })();
    }

    function visibleFor(p, f) {
      if (f.hiddenSku && f.hiddenSku[p.sku]) return false;
      if (f.cut != null && f.cut < 1 && p.y >= C.L * f.cut) return false;
      if (f.step != null && (p.seq || 0) > f.step) return false;
      if (f.layer && f.tiers && f.tiers[p.uid] !== f.layer) return false;
      return true;
    }

    function isBad(p) {
      return !!(data.flags && data.flags[p.uid] && data.flags[p.uid].some(function (c) { return c !== 'heavyOnLight' && c !== 'deliveryBlocked'; }));
    }
    function colorOf(p) {
      if (stepMode && (p.seq || 0) < stepMode.from) return DONE;
      if (isBad(p)) return BAD;
      return tmpColor.set((data.specs[p.sku] || {}).color || '#888888');
    }
    function makeIM(geo, n, mat) {
      if (!n) return null;
      var im = new THREE.InstancedMesh(geo, mat, n);
      im.frustumCulled = false;          // instances are spread out; the base geometry sits at the origin
      im.castShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      cargoG.add(im);
      return im;
    }
    /** Write one item's matrix/colour (q = position/size to draw, may differ from p while dragging). */
    function writeInstance(e, q, vis, colorOverride) {
      var spec = data.specs[e.p.sku] || {};
      if (vis) { placeMesh(dummy, q, spec); dummy.updateMatrix(); e.im.setMatrixAt(e.i, dummy.matrix); }
      else e.im.setMatrixAt(e.i, ZERO);
      e.im.setColorAt(e.i, colorOverride || colorOf(e.p));
      if (e.pal != null) {
        if (vis) {
          var bh = Math.min(15, q.h * 0.2);
          dummy.position.set(q.y + q.l / 2 - C.L / 2, q.z + bh / 2, C.W / 2 - q.x - q.w / 2);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(q.l * 1.004, bh, q.w * 1.004);
          dummy.updateMatrix();
          inst.pal.setMatrixAt(e.pal, dummy.matrix);
        } else inst.pal.setMatrixAt(e.pal, ZERO);
      }
    }
    function flushInstances() {
      [inst.box, inst.cyl, inst.pal].forEach(function (im) {
        if (!im) return;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      });
      dirty = true;
    }
    function pushBox(arr, p, g) {
      var x0 = p.y - C.L / 2 - g, x1 = p.y + p.l - C.L / 2 + g, y0 = p.z - g, y1 = p.z + p.h + g;
      var z0 = C.W / 2 - p.x - p.w - g, z1 = C.W / 2 - p.x + g;
      arr.push(x0, y0, z0, x1, y0, z0, x1, y0, z0, x1, y0, z1, x1, y0, z1, x0, y0, z1, x0, y0, z1, x0, y0, z0,
        x0, y1, z0, x1, y1, z0, x1, y1, z0, x1, y1, z1, x1, y1, z1, x0, y1, z1, x0, y1, z1, x0, y1, z0,
        x0, y0, z0, x0, y1, z0, x1, y0, z0, x1, y1, z0, x1, y0, z1, x1, y1, z1, x0, y0, z1, x0, y1, z1);
    }
    function pushDrum(arr, p) {
      var c = centerOf(p), r = Math.min(p.w, p.l) / 2, n = 20;
      [p.z, p.z + p.h].forEach(function (y) {
        for (var k = 0; k < n; k++) {
          var a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
          arr.push(c.x + Math.cos(a0) * r, y, c.z + Math.sin(a0) * r, c.x + Math.cos(a1) * r, y, c.z + Math.sin(a1) * r);
        }
      });
    }
    function setLines(old, arr, mat) {
      if (old) { cargoG.remove(old); old.geometry.dispose(); }
      if (!arr.length) return null;
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      var ls = new THREE.LineSegments(g, mat);
      cargoG.add(ls);
      return ls;
    }
    /** All visible edges merged into one geometry (plus a darker outline for locked items). */
    function rebuildLines() {
      if (!data) return;
      var pos = [], lock = [];
      data.placements.forEach(function (p) {
        var e = inst.index[p.uid];
        if (!e || !e.visible || p.uid === dragUid) return;
        var spec = data.specs[p.sku] || {};
        if (spec.pkg === 'cylinder' && (p.ax || 'z') === 'z') pushDrum(pos, p); else pushBox(pos, p, 0);
        if (p.locked) pushBox(lock, p, 0.8);
      });
      inst.edges = setLines(inst.edges, pos, edgeMat);
      inst.locks = setLines(inst.locks, lock, lockMat);
      dirty = true;
    }
    /** Apply filters / step preview to every instance. */
    function applyState() {
      if (!data) return;
      var f = data.filter || {};
      data.placements.forEach(function (p) {
        var e = inst.index[p.uid];
        if (!e) return;
        e.visible = visibleFor(p, f) && (!stepMode || (p.seq || 0) <= stepMode.to);
        writeInstance(e, p, e.visible);
      });
      flushInstances();
      rebuildLines();
    }
    function disposeCargo() {
      [inst.box, inst.cyl, inst.pal].forEach(function (im) { if (im) { cargoG.remove(im); if (im.dispose) im.dispose(); } });
      [inst.edges, inst.locks].forEach(function (l) { if (l) { cargoG.remove(l); l.geometry.dispose(); } });
      inst = freshInst();
    }

    function rebuildCargo() {
      disposeCargo();
      if (!data) return;
      var boxes = [], drums = [], pallets = [];
      data.placements.forEach(function (p) {
        var spec = data.specs[p.sku] || {};
        (spec.pkg === 'cylinder' ? drums : boxes).push(p);
        if (spec.pkg === 'pallet') pallets.push(p);
      });
      inst.box = makeIM(unitBox, boxes.length, cargoMat);
      inst.cyl = makeIM(unitCyl, drums.length, cargoMat);
      inst.pal = makeIM(unitBox, pallets.length, palletMat);
      boxes.forEach(function (p, i) { inst.uids.box[i] = p.uid; inst.index[p.uid] = { im: inst.box, i: i, p: p }; });
      drums.forEach(function (p, i) { inst.uids.cyl[i] = p.uid; inst.index[p.uid] = { im: inst.cyl, i: i, p: p }; });
      pallets.forEach(function (p, i) { inst.index[p.uid].pal = i; });
      applyState();
      updateSel(data.selected);
      if (data.cog && data.placements.length) {
        cogMarker.visible = true;
        cogMarker.position.set(data.cog.y - C.L / 2, data.cog.z, C.W / 2 - data.cog.x);
      } else cogMarker.visible = false;
      dirty = true;
    }

    function resize() {
      var w = el.clientWidth || 300, h = el.clientHeight || 300;
      renderer.setSize(w, h, false);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dirty = true;
    }
    if (root.ResizeObserver) new ResizeObserver(resize).observe(el);
    else root.addEventListener('resize', resize);

    function applyTheme() { scene.background = new THREE.Color(cssVar('--viewer-bg', '#eef2f7')); dirty = true; }
    applyTheme();
    if (root.matchMedia) root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

    (function loop() {
      requestAnimationFrame(loop);
      if (!dirty) return;
      dirty = false;
      renderer.render(scene, camera);
    })();

    resize();
    buildContainer();
    resetCamera();

    return {
      /** Rebuilds the container (and vehicle) only when size, vehicle or language changed. */
      setContainer: function (c, veh) {
        if (veh) { vehicle.type = veh.type; vehicle.show = veh.show; vehicle.cabColor = veh.cabColor || null; vehicle.logo = veh.logo || null; }
        var key = [c.W, c.L, c.H, vehicle.type, vehicle.show, LP.i18n.lang, c.doorW, c.doorH, vehicle.cabColor, vehicle.logo ? vehicle.logo.length + vehicle.logo.slice(-24) : ''].join('|');
        if (key === builtKey) return;
        var sizeChanged = !(c.W === C.W && c.L === C.L && c.H === C.H) || !builtKey;
        var vehChanged = builtKey && builtKey.split('|').slice(3, 5).join('|') !== [vehicle.type, vehicle.show].join('|');
        builtKey = key;
        C = { W: c.W, L: c.L, H: c.H, doorW: c.doorW, doorH: c.doorH };
        buildContainer();
        if (sizeChanged || vehChanged) resetCamera();
      },
      relabel: function () { builtKey = null; buildContainer(); },
      setData: function (d) {
        data = d;
        data.byUid = {};
        d.placements.forEach(function (p) { data.byUid[p.uid] = p; });
        rebuildCargo();
      },
      setFilter: function (f) {
        if (!data) return;
        data.filter = f;
        applyState();
      },
      setSelected: function (uid) { if (data) { data.selected = uid; updateSel(uid); dirty = true; } },
      setOpacity: function (v) {
        opacity = v;
        wallMats.forEach(function (m) { m.opacity = v; m.visible = v > 0.01; });
        dirty = true;
      },
      setManual: function (on) { manual = on; canvas.style.cursor = on ? 'grab' : ''; },
      isDragging: function () { return !!drag; },
      resetCamera: resetCamera,
      setCamera: setCamera,
      /** Place the camera explicitly (three.js coordinates). */
      lookFrom: function (px, py, pz, tx, ty, tz) {
        camera.position.set(px, py, pz);
        controls.target.set(tx, ty, tz);
        controls.update();
        dirty = true;
      },
      applyTheme: applyTheme,
      /** Client (screen) coordinates of an item's top-face centre — lets e2e.html drive real pointer drags. */
      projectToScreen: function (uid) {
        var p = data && data.byUid[uid];
        if (!p) return null;
        var c = centerOf(p);
        c.y = p.z + p.h;
        c.project(camera);
        var r = canvas.getBoundingClientRect();
        return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height };
      },
      /** Render-cost probe: average ms per frame over n renders + draw calls (used by e2e.html). */
      perf: function (n) {
        n = n || 20;
        var t0 = performance.now();
        for (var i = 0; i < n; i++) renderer.render(scene, camera);
        renderer.getContext().finish();
        return { msPerFrame: (performance.now() - t0) / n, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      },
      /**
       * Image of one loading step: items of earlier steps greyed out, the current step in colour,
       * later items hidden. Returns a JPEG data URL (16:9, white background).
       */
      snapshotStep: function (from, to) {
        if (!data) return null;
        var savedFilter = data.filter;
        data.filter = {};                      // a step sheet always shows the whole load up to the step
        stepMode = { from: from, to: to };
        applyState();
        var url = this.snapshot('image/jpeg');
        stepMode = null;
        data.filter = savedFilter;
        applyState();
        return url;
      },
      /** Print-friendly image: fixed 16:9 frame, white background, isometric camera; view state restored after. */
      snapshot: function (mime) {
        var size = new THREE.Vector2();
        renderer.getSize(size);
        var pos = camera.position.clone(), tgt = controls.target.clone(), aspect = camera.aspect, bg = scene.background;
        var selVis = selBox.visible;
        renderer.setSize(1600, 900, false);
        camera.aspect = 1600 / 900;
        resetCamera();
        scene.background = new THREE.Color('#ffffff');
        selBox.visible = false;
        renderer.render(scene, camera);
        var url = canvas.toDataURL(mime || 'image/png', 0.88);
        scene.background = bg;
        selBox.visible = selVis;
        renderer.setSize(size.x, size.y, false);
        camera.aspect = aspect;
        camera.position.copy(pos);
        controls.target.copy(tgt);
        camera.updateProjectionMatrix();
        controls.update();
        dirty = true;
        return url;
      }
    };
  };
})(this);
