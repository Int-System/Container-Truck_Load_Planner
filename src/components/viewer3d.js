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
    function freshInst() { return { box: null, cyl: null, pal: null, ld: null, lbl: null, uids: { box: [], cyl: [], ld: [] }, index: {}, edges: null, locks: null }; }
    var inst = freshInst(), stepMode = null, dragUid = null;

    var C = { W: 235, L: 590, H: 239 }, wallMats = [], data = null, manual = false, dirty = true;
    var vehicleG = new THREE.Group(), vehicle = { type: null, show: true }, vehicleExt = null, builtKey = null;
    scene.add(vehicleG);
    var opacity = 0.18;
    var style = 'flat', vehicleWalls = null, showPerson = true;   // 'real' = steel container shell (shipping containers only)
    function realShell() { return style === 'real' && vehicle.type === 'container'; }

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
      var list = [inst.box, inst.cyl, inst.ld].filter(Boolean);
      var hits = ray.intersectObjects(list, false);
      for (var k = 0; k < hits.length; k++) {
        var hit = hits[k];
        if (hit.instanceId == null) continue;
        var uid = (hit.object === inst.box ? inst.uids.box : hit.object === inst.ld ? inst.uids.ld : inst.uids.cyl)[hit.instanceId];
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
      if (!p) { selBox.visible = false; updateSelGuides(null); refreshAxes(); return; }
      var q = pos ? { x: pos.x, y: pos.y, z: pos.z, w: p.w, l: p.l, h: p.h } : p;
      updateSelGuides(q);
      if (axes.origin && !vis.origin) refreshAxes(); else if (axes.origin) updateHud();
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
      vehicleExt = null; vehicleWalls = null;
      if (!(vehicle.show || realShell()) || !vehicle.type || !LP.buildVehicle) return;
      var v = LP.buildVehicle(THREE, C, vehicle.type, {
        cabColor: vehicle.cabColor, logo: vehicle.logo, real: realShell(),
        onAsset: function () { sun.shadow.needsUpdate = true; dirty = true; }
      });
      vehicleG.add(v.group);
      vehicleExt = v.ext;
      vehicleWalls = v.walls || null;
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
      var L = C.L, W = C.W, H = C.H, real = realShell();
      var flatG = new THREE.Group();          // the plain box (floor, grid, walls, doors); replaced by the steel shell
      flatG.visible = !real;
      containerG.add(flatG);
      var containerG0 = containerG;
      containerG = flatG;
      var floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshLambertMaterial({ color: C.bed && +C.bed.wallH > 0 ? 0x4a5160 : 0x9aa4b2 }));
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
      var bed = C.bed && +C.bed.wallH > 0 ? C.bed : null;
      if (bed) {
        // open pickup bed: low side walls + closed tailgate, no roof; dashed box = max load height
        var WH = Math.min(+bed.wallH, H);
        wall(W, WH, new THREE.Vector3(-L / 2, WH / 2, 0), [0, Math.PI / 2, 0]);
        wall(L, WH, new THREE.Vector3(0, WH / 2, W / 2));
        wall(L, WH, new THREE.Vector3(0, WH / 2, -W / 2));
        wall(W, WH, new THREE.Vector3(L / 2, WH / 2, 0), [0, Math.PI / 2, 0]);
        var low = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L, WH, W)), new THREE.LineBasicMaterial({ color: 0x334155 }));
        low.position.y = WH / 2;
        containerG.add(low);
        var limBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W)), new THREE.LineDashedMaterial({ color: 0xe24b4a, dashSize: 10, gapSize: 6 }));
        limBox.position.y = H / 2;
        limBox.computeLineDistances();
        containerG.add(limBox);
        var limTop = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshBasicMaterial({ color: 0xe24b4a, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }));
        limTop.rotation.x = -Math.PI / 2;
        limTop.position.y = H;
        containerG.add(limTop);
      } else {
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
      }
      // keep-out zones (wheel arches of an open pickup bed)
      var archMat = new THREE.MeshLambertMaterial({ color: 0x6b7280 });
      ((root.LPEngine && root.LPEngine.obstaclesOf) ? root.LPEngine.obstaclesOf(C) : []).forEach(function (o) {
        var am = new THREE.Mesh(new THREE.BoxGeometry(o.l, o.h, o.w), archMat);
        am.position.set(o.y + o.l / 2 - L / 2, (o.z || 0) + o.h / 2, W / 2 - o.x - o.w / 2);
        am.castShadow = true; am.receiveShadow = true;
        containerG.add(am);
        var ae = new THREE.LineSegments(new THREE.EdgesGeometry(am.geometry), new THREE.LineBasicMaterial({ color: 0xe24b4a }));
        ae.position.copy(am.position);
        containerG.add(ae);
      });
      containerG = containerG0;
      var sz = Math.max(W * 0.9, 120);
      var dl = textSprite(LP.t(bed ? 'tailgateHere' : 'doorHere'), '#ea580c', sz);
      dl.position.set(L / 2 + sz * 0.15, H + sz * 0.22, 0);
      containerG.add(dl);
      var fl = textSprite(LP.t(bed ? 'frontBed' : 'frontHere'), '#334155', sz);
      fl.position.set(-L / 2, H + sz * 0.22, 0);
      containerG.add(fl);
      if (bed) {
        var mh = textSprite(LP.t('bedMaxH', { h: LP.units.fmt(H, 0) }), '#e24b4a', sz * 0.9);
        mh.position.set(0, H + sz * 0.1, -W / 2);
        containerG.add(mh);
      }
      var ll = textSprite(LP.t('left'), '#475569', sz * 0.6);
      ll.position.set(0, 4, W / 2 + sz * 0.25);
      containerG.add(ll);
      cogMarker.scale.setScalar(Math.max(W, L) * 0.008);
      buildVehicle();
      if (style === 'real' && showPerson && LP.buildPerson) {
        var tag = textSprite('1.70 ม.', '#334155', 130);
        var person = LP.buildPerson(THREE, tag);
        person.position.set(L / 2 + Math.max(90, W * 0.45), vehicleExt ? vehicleExt.yMin : 0, -(W / 2 + 55));
        person.rotation.y = -0.9;
        containerG.add(person);
      }
      buildOrigin();
      buildRulers();
      refreshAxes();
      if (data) updateSel(data.selected);
      dirty = true;
    }

    /** Bounding box of what should be framed: the cargo box, plus the vehicle when shown. */
    function frameBounds() {
      var b = { x0: -C.L / 2, x1: C.L / 2 + C.W * 0.4, y0: 0, y1: C.H * 1.08, z: C.W / 2 };   // + open door leaves / labels
      if (vehicleExt) { b.x0 = Math.min(b.x0, vehicleExt.xMin); b.x1 = Math.max(b.x1, vehicleExt.xMax); b.y0 = vehicleExt.yMin; b.y1 = Math.max(b.y1, vehicleExt.yMax); b.z = Math.max(b.z, vehicleExt.zMax); }
      if (style === 'real' && showPerson) { b.x1 = Math.max(b.x1, C.L / 2 + Math.max(90, C.W * 0.45) + 45); b.z = Math.max(b.z, C.W / 2 + 85); b.y1 = Math.max(b.y1, (vehicleExt ? vehicleExt.yMin : 0) + 200); }
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
      else if (view === 'right') { to = new THREE.Vector3(cx, cy, -dist * 0.95); tgt.set(cx, cy, 0); }
      else if (view === 'top') { to = new THREE.Vector3(cx + 0.001, dist * 0.95, 0.001); tgt.set(cx, 0, 0); }
      else if (view === 'front') {   // from the front wall end, looking towards the door
        var fd = Math.max(C.W, C.H - b.y0) / Math.tan(camera.fov * Math.PI / 360) * 0.75 + C.L / 2;
        to = new THREE.Vector3(Math.min(-fd, b.x0 - C.W * 0.6), C.H * 0.75, 0);
        tgt.set(0, (C.H + b.y0) * 0.45, 0);
      }
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

    // ---- axes, origin, rulers, view cube (Display menu → "Axes and distances"; all optional) ----
    // Everything here is an HTML/SVG layer over the canvas: 3D points are projected each frame, so lines
    // are crisp and thicker than WebGL's 1px lines, and none of it ends up in printed snapshots.
    var AX_COL = { x: '#e24b4a', y: '#4d8f1c', z: '#2f7fd8' };
    var axes = { gizmo: false, origin: false, ruler: false, rulerMode: 'manual', rulerStep: 50, cube: false };
    var hud = document.createElement('div');
    hud.className = 'v3d-hud';
    hud.innerHTML = '<svg class="v3d-guides"></svg><div class="v3d-labels"></div><svg class="v3d-nav" viewBox="-60 -60 120 120"></svg>';
    el.appendChild(hud);
    var guideSvg = hud.children[0], hudLabels = hud.children[1], nav = hud.children[2];
    var labels = [], segs = [], originPt = null;   // labels: { el, pos, group }; segs: { a, b, k, dash, w, group }
    function E(x, y, z) { return new THREE.Vector3(y - C.L / 2, z, C.W / 2 - x); }   // engine → three
    function addLabel(group, pos, text, cls) {
      var d = document.createElement('span');
      d.className = 'v3d-lbl ' + (cls || '');
      d.textContent = text;
      hudLabels.appendChild(d);
      var l = { el: d, pos: pos, group: group };
      labels.push(l);
      return l;
    }
    function clearGroup(group) {
      labels = labels.filter(function (l) { if (l.group !== group) return true; l.el.remove(); return false; });
      segs = segs.filter(function (g) { return g.group !== group; });
    }
    function buildOrigin() {
      clearGroup('origin');
      originPt = E(0, 0, 0);
      addLabel('origin', originPt, '0, 0, 0', 'org');
    }
    var selSegs = null, selLbl = null;
    function updateSelGuides(q) {
      if (!selSegs) {
        selSegs = ['x', 'y', 'z'].map(function (k) { var g = { a: new THREE.Vector3(), b: new THREE.Vector3(), k: k, dash: true, w: 2.2, group: 'sel' }; segs.push(g); return g; });
        selLbl = { x: addLabel('sel', new THREE.Vector3(), '', 'ax-x'), y: addLabel('sel', new THREE.Vector3(), '', 'ax-y'), z: addLabel('sel', new THREE.Vector3(), '', 'ax-z') };
      }
      var on = axes.origin && !!q;
      selSegs.forEach(function (g) { g.hidden = !on; });
      ['x', 'y', 'z'].forEach(function (k) { selLbl[k].hidden = !on; });
      dirty = true;
      if (!on) return;
      var a = E(0, 0, 0), b = E(q.x, 0, 0), c = E(q.x, q.y, 0), d = E(q.x, q.y, q.z);
      selSegs[0].a.copy(a); selSegs[0].b.copy(b);
      selSegs[1].a.copy(b); selSegs[1].b.copy(c);
      selSegs[2].a.copy(c); selSegs[2].b.copy(d);
      selSegs[0].hidden = q.x < 0.5; selSegs[1].hidden = q.y < 0.5; selSegs[2].hidden = q.z <= 0.5;
      var r1 = function (v) { return LP.units.fmt(v, 1).replace(/\.0$/, ''); };
      selLbl.x.el.textContent = 'x ' + r1(q.x); selLbl.x.pos.copy(a).lerp(b, 0.5);
      selLbl.y.el.textContent = 'y ' + r1(q.y); selLbl.y.pos.copy(b).lerp(c, 0.5);
      selLbl.z.el.textContent = 'z ' + r1(q.z); selLbl.z.pos.copy(c).lerp(d, 0.5);
      selLbl.x.hidden = q.x < 0.5; selLbl.y.hidden = q.y < 0.5; selLbl.z.hidden = q.z <= 0.5;
    }
    function buildRulers() {
      clearGroup('ruler');
      var step = Math.max(1, axes.rulerStep || 50), t = Math.max(C.W, C.L) * 0.018;
      var labelEvery = step * Math.max(1, Math.ceil(Math.max(C.L, C.W, C.H) / step / 14));
      function axis(key, len, at, tickEnd, lblAt) {
        segs.push({ a: at(0), b: at(len), k: key, w: 1.6, group: 'ruler' });
        for (var v = step; v <= len + 1e-6; v += step) {
          var major = Math.abs(v / labelEvery - Math.round(v / labelEvery)) < 1e-6;
          segs.push({ a: at(v), b: tickEnd(v, major ? 1 : 0.55), k: key, w: major ? 1.6 : 1.1, group: 'ruler' });
          if (major && len - v > labelEvery * 0.35) addLabel('ruler', lblAt(v), String(Math.round(v)), 'ax-' + key + ' rl');
        }
        segs.push({ a: at(len), b: tickEnd(len, 1), k: key, w: 1.6, group: 'ruler' });
        addLabel('ruler', lblAt(len), LP.units.fmt(len, 0), 'ax-' + key + ' rl end');
      }
      axis('x', C.W, function (v) { return E(v, -t * 0.25, 0); }, function (v, k) { return E(v, -t * (0.25 + k), 0); }, function (v) { return E(v, -t * 2.1, 0); });
      axis('y', C.L, function (v) { return E(-t * 0.25, v, 0); }, function (v, k) { return E(-t * (0.25 + k), v, 0); }, function (v) { return E(-t * 2.1, v, 0); });
      axis('z', C.H, function (v) { return E(-t * 0.25, -t * 0.25, v); }, function (v, k) { return E(-t * (0.25 + k * 0.8), -t * (0.25 + k * 0.8), v); }, function (v) { return E(-t * 1.9, -t * 1.9, v); });
      dirty = true;
    }
    var vis = { ruler: false, origin: false, sel: false };
    function refreshAxes() {
      vis.ruler = axes.ruler && (axes.rulerMode === 'always' || manual);
      vis.origin = axes.origin && (manual || !!(data && data.selected && data.byUid[data.selected]));
      vis.sel = axes.origin;
      nav.style.display = axes.gizmo || axes.cube ? '' : 'none';
      hud.classList.toggle('cube', !!axes.cube);
      dirty = true;
      if (camera.aspect) { updateHud(); updateNav(); }   // right away, not only on the next frame
    }
    var vProj = new THREE.Vector3();
    function scr(p, w, h) {
      vProj.copy(p).project(camera);
      if (vProj.z >= 1) return null;
      return [(vProj.x + 1) / 2 * w, (1 - vProj.y) / 2 * h];
    }
    function updateHud() {
      var w = el.clientWidth, h = el.clientHeight;
      labels.forEach(function (l) {
        var p = vis[l.group] && !l.hidden ? scr(l.pos, w, h) : null;
        if (p && (p[0] < -40 || p[1] < -40 || p[0] > w + 40 || p[1] > h + 40)) p = null;
        l.el.style.display = p ? '' : 'none';
        if (p) l.el.style.transform = 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px) translate(-50%,-50%)';
      });
      var paths = {}, out = [];
      segs.forEach(function (g) {
        if (!vis[g.group] || g.hidden) return;
        var a = scr(g.a, w, h), b = a && scr(g.b, w, h);
        if (!b) return;
        var key = g.k + '|' + (g.dash ? 1 : 0) + '|' + g.w;
        (paths[key] = paths[key] || []).push('M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + 'L' + b[0].toFixed(1) + ' ' + b[1].toFixed(1));
      });
      Object.keys(paths).forEach(function (key) {
        var k = key.split('|');
        out.push('<path d="' + paths[key].join('') + '" stroke="' + AX_COL[k[0]] + '" stroke-width="' + k[2] + '"' + (k[1] === '1' ? ' stroke-dasharray="6 4"' : '') + ' fill="none" stroke-linecap="round"/>');
      });
      if (vis.origin && originPt) {
        var o = scr(originPt, w, h);
        if (o) out.push('<circle cx="' + o[0].toFixed(1) + '" cy="' + o[1].toFixed(1) + '" r="6" class="org-ring"/><circle cx="' + o[0].toFixed(1) + '" cy="' + o[1].toFixed(1) + '" r="2.2" class="org-dot"/>');
      }
      guideSvg.innerHTML = out.join('');
    }
    // corner widget: engine axes (x → -Z, y → +X, z → +Y in three.js) drawn in camera space
    var NAV_AX = [{ k: 'x', d: new THREE.Vector3(0, 0, -1) }, { k: 'y', d: new THREE.Vector3(1, 0, 0) }, { k: 'z', d: new THREE.Vector3(0, 1, 0) }];
    var CUBE_FACES = [
      { n: [1, 0, 0], view: 'door', key: 'cubeDoor' }, { n: [-1, 0, 0], view: 'front', key: 'frontHere' },
      { n: [0, 1, 0], view: 'top', key: 'cubeTop' }, { n: [0, 0, 1], view: 'side', key: 'left' }, { n: [0, 0, -1], view: 'right', key: 'right' },
      { n: [0, -1, 0], view: null, key: null }
    ];
    var invQ = new THREE.Quaternion();
    function navPt(v) { return [v.x, -v.y]; }
    function updateNav() {
      if (!axes.gizmo && !axes.cube) return;
      invQ.copy(camera.quaternion).invert();
      var h = [], S = axes.cube ? 25 : 0;
      var f2 = function (n) { return n.toFixed(1); };
      if (axes.cube) {
        var faces = CUBE_FACES.map(function (f) {
          var n = new THREE.Vector3().fromArray(f.n), vn = n.clone().applyQuaternion(invQ);
          var u = new THREE.Vector3(Math.abs(f.n[1]) ? 1 : 0, 0, 0), vv;
          if (!u.lengthSq()) u.set(0, 1, 0);
          vv = new THREE.Vector3().crossVectors(n, u);
          var cs = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(function (s) {
            return n.clone().add(u.clone().multiplyScalar(s[0])).add(vv.clone().multiplyScalar(s[1])).multiplyScalar(S).applyQuaternion(invQ);
          });
          return { f: f, vn: vn, cs: cs, c: n.clone().multiplyScalar(S).applyQuaternion(invQ) };
        }).filter(function (x) { return x.vn.z > 0.02; }).sort(function (a, b) { return a.vn.z - b.vn.z; });
        faces.forEach(function (x) {
          var d = 'M' + x.cs.map(function (p) { var q = navPt(p); return f2(q[0]) + ' ' + f2(q[1]); }).join('L') + 'Z';
          h.push('<path class="nav-face' + (x.f.view ? '' : ' off') + '" data-cam="' + (x.f.view || '') + '" d="' + d + '"><title>' + (x.f.key ? LP.esc(LP.t(x.f.key)) : '') + '</title></path>');
          if (x.f.key && x.vn.z > 0.35) {
            var c = navPt(x.c);
            h.push('<text class="nav-ft" x="' + f2(c[0]) + '" y="' + f2(c[1] + 3.5) + '" font-size="' + (9 + x.vn.z * 2).toFixed(1) + '">' + LP.esc(LP.t(x.f.key)) + '</text>');
          }
        });
      } else h.push('<circle class="nav-bg" r="54"/>');
      // axis arrows: from the cube's origin corner (front-left-bottom), or from the centre
      var o = axes.cube ? new THREE.Vector3(-S, -S, S).applyQuaternion(invQ) : new THREE.Vector3();
      var len = axes.cube ? S * 2.6 : 40;
      NAV_AX.map(function (a) {
        var start = axes.cube ? new THREE.Vector3(-S, -S, S) : new THREE.Vector3();
        var tip = start.clone().add(a.d.clone().multiplyScalar(len)).applyQuaternion(invQ);
        return { a: a, tip: tip };
      }).sort(function (p, q) { return p.tip.z - q.tip.z; }).forEach(function (r) {
        var s = navPt(o), e = navPt(r.tip), col = AX_COL[r.a.k];
        var dx = e[0] - s[0], dy = e[1] - s[1], L = Math.sqrt(dx * dx + dy * dy) || 1;
        var ux = dx / L, uy = dy / L, ex = e[0] + ux * 10, ey = e[1] + uy * 10;
        h.push('<line x1="' + f2(s[0]) + '" y1="' + f2(s[1]) + '" x2="' + f2(e[0]) + '" y2="' + f2(e[1]) + '" stroke="' + col + '" stroke-width="3" stroke-linecap="round"/>');
        h.push('<path d="M' + f2(e[0] + ux * 4) + ' ' + f2(e[1] + uy * 4) + 'L' + f2(e[0] - ux * 3 - uy * 3.5) + ' ' + f2(e[1] - uy * 3 + ux * 3.5) + 'L' + f2(e[0] - ux * 3 + uy * 3.5) + ' ' + f2(e[1] - uy * 3 - ux * 3.5) + 'Z" fill="' + col + '"/>');
        if (L > 6) h.push('<text class="nav-ax" x="' + f2(ex) + '" y="' + f2(ey + 4) + '" fill="' + col + '">' + r.a.k.toUpperCase() + '</text>');
      });
      if (axes.cube) h.push('<g class="nav-home" data-cam="home" transform="translate(-58 -58)"><rect width="18" height="16" rx="4"/><path d="M4 9l5-4.5 5 4.5M5.5 8v5h7V8" fill="none"/><title>' + LP.esc(LP.t('cubeHome')) + '</title></g>');
      nav.innerHTML = '<title>' + LP.esc(LP.t('axTip')) + '</title>' + h.join('');
    }
    nav.addEventListener('click', function (e) {
      var t = e.target.closest('[data-cam]');
      if (!t || !t.getAttribute('data-cam')) return;
      var v = t.getAttribute('data-cam');
      if (v === 'home') resetCamera(); else setCamera(v);
    });
    nav.addEventListener('pointerdown', function (e) { e.stopPropagation(); });

    /** Steel shell: hide the walls (and roof) between the camera and the cargo. */
    function updateCutaway() {
      if (!vehicleWalls) return;
      var c = camera.position, m = 2;
      vehicleWalls.left.visible = c.z < C.W / 2 + m;
      vehicleWalls.right.visible = c.z > -C.W / 2 - m;
      vehicleWalls.front.visible = c.x > -C.L / 2 - m;
      vehicleWalls.roof.visible = c.y < C.H;
      if (vehicleWalls.doorLeft) vehicleWalls.doorLeft.visible = vehicleWalls.left.visible;
      if (vehicleWalls.doorRight) vehicleWalls.doorRight.visible = vehicleWalls.right.visible;
    }

    // ---- securing material (airbags / timber) suggested by E.dunnagePlan — Display → "Show securing material"
    var dunG = new THREE.Group(), dunPlan = null, dunShow = false, dunKey = '', dunHL = null;
    scene.add(dunG);
    var dunMats = null;
    function dunMaterials() {
      if (dunMats) return dunMats;
      dunMats = {
        bag: new THREE.MeshStandardMaterial({ color: 0xdfe7ef, roughness: 0.35, metalness: 0.05 }),
        valve: new THREE.MeshStandardMaterial({ color: 0xd85a30, roughness: 0.5 }),
        timber: new THREE.MeshStandardMaterial({ color: 0xc8a06a, roughness: 0.9 }),
        strap: new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.6 }),
        gapFill: new THREE.MeshBasicMaterial({ color: 0xe24b4a, transparent: true, opacity: 0.06, depthWrite: false }),
        gapLine: new THREE.LineDashedMaterial({ color: 0xe24b4a, dashSize: 8, gapSize: 5 })
      };
      return dunMats;
    }
    // airbag: a unit box pulled part-way towards a sphere → rounded pillow (fits −0.5…0.5)
    var unitSphere = (function () {
      var g = new THREE.BoxGeometry(1, 1, 1, 10, 10, 10), pos = g.attributes.position, v = new THREE.Vector3(), sph = new THREE.Vector3();
      for (var i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        sph.copy(v).normalize().multiplyScalar(0.5);
        v.lerp(sph, 0.55);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeBoundingBox();
      var bb = g.boundingBox, sx = 1 / (bb.max.x - bb.min.x);
      g.scale(sx, sx, sx);
      g.computeVertexNormals();
      return g;
    })();
    function buildDunnage() {
      dunG.children.slice().forEach(function (o) { dunG.remove(o); if (o.geometry && o.geometry !== unitBox && o.geometry !== unitSphere) o.geometry.dispose(); if (o.userData.clone) o.material.dispose(); });
      dunG.visible = dunShow;
      if (!dunShow || !dunPlan || !dunPlan.gaps.length) { dirty = true; return; }
      var M = dunMaterials();
      dunPlan.gaps.forEach(function (g) {
        var gh = Math.max(10, g.h);
        var fill = new THREE.Mesh(unitBox, M.gapFill);
        fill.position.set((g.y0 + g.y1) / 2 - C.L / 2, gh / 2, C.W / 2 - (g.x0 + g.x1) / 2);
        fill.scale.set(Math.max(1, g.y1 - g.y0), gh, Math.max(1, g.x1 - g.x0));
        fill.userData.gap = g.id; fill.renderOrder = 2;
        if (g.type !== 'top') dunG.add(fill);          // straps / tarp: no void box
        var edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(1, g.y1 - g.y0), gh, Math.max(1, g.x1 - g.x0))), M.gapLine);
        edges.position.copy(fill.position);
        edges.computeLineDistances();
        if (g.type !== 'top') dunG.add(edges);
        (g.shapes || []).forEach(function (sh) {
          if (sh.kind === 'strap' || sh.kind === 'strapL') {     // ratchet strap over the load: up · across · down
            var up = Math.max(1, sh.top - sh.wall), th = 1.6, segs = [];
            if (sh.kind === 'strap') {
              var sx = sh.y - C.L / 2;
              segs.push([sx, sh.wall + up / 2, C.W / 2 + th, th, up, th], [sx, sh.top + th / 2, 0, 5, th, C.W + th * 2], [sx, sh.wall + up / 2, -C.W / 2 - th, th, up, th]);
            } else {
              var sz = C.W / 2 - sh.x;
              segs.push([-C.L / 2 - th, sh.wall + up / 2, sz, th, up, th], [0, sh.top + th / 2 + 1, sz, C.L + th * 2, th, 5], [C.L / 2 + th, sh.wall + up / 2, sz, th, up, th]);
            }
            segs.forEach(function (q) {
              var sm = new THREE.Mesh(unitBox, M.strap.clone());
              sm.position.set(q[0], q[1], q[2]); sm.scale.set(q[3], q[4], q[5]);
              sm.userData.gap = g.id; sm.userData.clone = true;
              dunG.add(sm);
            });
            return;
          }
          var cx = sh.y + sh.l / 2 - C.L / 2, cy = sh.z + sh.h / 2, cz = C.W / 2 - sh.x - sh.w / 2, m;
          if (sh.kind === 'bag') {
            m = new THREE.Mesh(unitSphere, M.bag.clone());
            m.scale.set(sh.l, sh.h, sh.w);
            var v = new THREE.Mesh(unitBox, M.valve);
            v.position.set(cx, sh.z + sh.h + 1.5, cz); v.scale.set(4, 3, 4);
            dunG.add(v);
          } else {
            m = new THREE.Mesh(unitBox, M.timber.clone());
            m.scale.set(sh.l, sh.h, sh.w);
          }
          m.position.set(cx, cy, cz);
          m.castShadow = true;
          m.userData.gap = g.id; m.userData.clone = true;
          dunG.add(m);
        });
      });
      dirty = true;
    }
    function stepDunnageHighlight(now) {
      if (!dunHL) return;
      var k = (now - dunHL.t0) / 2600, on = k < 1, pulse = on ? (Math.sin((now - dunHL.t0) / 150) + 1) / 2 : 0;
      dunG.children.forEach(function (o) {
        if (!o.material || !o.material.emissive || !o.userData.gap) return;
        var hit = on && dunHL.ids.indexOf(o.userData.gap) >= 0;
        o.material.emissive.setHex(hit ? 0xfacc15 : 0x000000);
        o.material.emissiveIntensity = hit ? pulse * 0.9 : 0;
      });
      if (!on) dunHL = null;
      dirty = true;
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
    var WHITE = new THREE.Color(0xffffff), tmpLabel = new THREE.Color();
    function modeColor(p, out) {
      var f = (data && data.filter) || {};
      return out.set(LP.cargoColor ? LP.cargoColor(p, data.specs[p.sku], f.colorBy, data.maxW, data.minW) : ((data.specs[p.sku] || {}).color || '#888888'));
    }
    /** Body colour. Realistic cartons / pallet loads keep their printed look (white tint) unless a colour mode is on. */
    function colorOf(p, kind) {
      if (stepMode && (p.seq || 0) < stepMode.from) return DONE;
      if (isBad(p)) return BAD;
      var f = (data && data.filter) || {};
      if (style === 'real' && kind !== 'cyl' && (!f.colorBy || f.colorBy === 'sku')) return WHITE;
      return modeColor(p, tmpColor);
    }
    function labelColorOf(p) {
      if (stepMode && (p.seq || 0) < stepMode.from) return DONE;
      if (isBad(p)) return BAD;
      return modeColor(p, tmpLabel);
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
    var lblQ = new THREE.Quaternion(), lblY = new THREE.Vector3(0, 1, 0), lblS = new THREE.Vector3(), lblP = new THREE.Vector3(), lblM = new THREE.Matrix4();
    /** Write one item's matrix/colour (q = position/size to draw, may differ from p while dragging or animating). */
    function writeInstance(e, q, vis, colorOverride) {
      var spec = data.specs[e.p.sku] || {};
      var bh = e.pal != null ? Math.min(15, q.h * 0.2) : 0;
      var body = q;
      if (e.pal != null && style === 'real') body = { x: q.x, y: q.y, z: q.z + bh, w: q.w, l: q.l, h: q.h - bh, ax: q.ax };   // load sits on the pallet
      if (vis) { placeMesh(dummy, body, spec); dummy.updateMatrix(); e.im.setMatrixAt(e.i, dummy.matrix); }
      else e.im.setMatrixAt(e.i, ZERO);
      e.im.setColorAt(e.i, colorOverride || colorOf(e.p, e.kind));
      if (e.pal != null) {
        if (vis) {
          dummy.position.set(q.y + q.l / 2 - C.L / 2, q.z + bh / 2, C.W / 2 - q.x - q.w / 2);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(q.l * 1.004, bh, q.w * 1.004);
          dummy.updateMatrix();
          inst.pal.setMatrixAt(e.pal, dummy.matrix);
        } else inst.pal.setMatrixAt(e.pal, ZERO);
      }
      if (e.lbl) {                         // SKU stickers on the door side and both long sides
        var lc = colorOverride || labelColorOf(e.p);
        var cx = q.y + q.l / 2 - C.L / 2, cy = q.z + q.h * 0.56, cz = C.W / 2 - q.x - q.w / 2;
        var faces = [[q.l / 2 + 0.35, 0, Math.PI / 2, q.w], [0, q.w / 2 + 0.35, 0, q.l], [0, -q.w / 2 - 0.35, Math.PI, q.l]];
        faces.forEach(function (fc, k) {
          if (!vis) { inst.lbl.setMatrixAt(e.lbl + k, ZERO); return; }
          var lh = Math.min(q.h * 0.36, fc[3] * 0.45 / 1.42, 26), lw = lh * 1.42;
          lblP.set(cx + fc[0], cy, cz + fc[1]);
          lblQ.setFromAxisAngle(lblY, fc[2]);
          lblS.set(lw, lh, 1);
          inst.lbl.setMatrixAt(e.lbl + k, lblM.compose(lblP, lblQ, lblS));
          inst.lbl.setColorAt(e.lbl + k, lc);
        });
      }
    }
    function flushInstances() {
      [inst.box, inst.cyl, inst.pal, inst.ld, inst.lbl].forEach(function (im) {
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
      edgeMat.opacity = style === 'real' ? 0.2 : 0.55;
      data.placements.forEach(function (p) {
        var e = inst.index[p.uid];
        if (!e || !e.visible || p.uid === dragUid || animIn[p.uid]) return;
        var spec = data.specs[p.sku] || {};
        if (spec.pkg === 'cylinder' && (p.ax || 'z') === 'z') pushDrum(pos, p); else pushBox(pos, p, 0);
        if (p.locked) pushBox(lock, p, 0.8);
      });
      inst.edges = setLines(inst.edges, pos, edgeMat);
      inst.locks = setLines(inst.locks, lock, lockMat);
      dirty = true;
    }

    // ---- loading animation: newly shown items slide in through the door, then settle (player ▶) ----
    var animIn = {}, animCount = 0;
    function animPos(p, a, now) {
      var t = Math.min(1, (now - a.t0) / a.dur);
      var DH = Math.min(C.doorH || C.H, C.H), carry = Math.max(0, Math.min(p.z + 8, DH - p.h - 2));
      var sy = C.L + C.W * 0.55, sx = (C.W - p.w) / 2;
      var q = { x: p.x, y: p.y, z: p.z, w: p.w, l: p.l, h: p.h, ax: p.ax };
      if (t < 0.72) {
        var k = t / 0.72, e2 = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        q.y = sy + (p.y - sy) * e2; q.x = sx + (p.x - sx) * e2; q.z = carry;
      } else {
        var k2 = (t - 0.72) / 0.28;
        q.z = carry + (p.z - carry) * (1 - (1 - k2) * (1 - k2));
      }
      return { q: q, done: t >= 1 };
    }
    function stepAnimations() {
      if (!animCount || !data) return;
      var now = performance.now(), finished = false;
      Object.keys(animIn).forEach(function (uid) {
        var e = inst.index[uid], a = animIn[uid];
        if (!e || !e.visible) { delete animIn[uid]; animCount--; finished = true; return; }
        var r = animPos(e.p, a, now);
        writeInstance(e, r.q, true);
        if (r.done) { writeInstance(e, e.p, true); delete animIn[uid]; animCount--; finished = true; }
      });
      flushInstances();
      if (finished) rebuildLines();
    }

    /** Apply filters / step preview to every instance. */
    function applyState() {
      if (!data) return;
      var f = data.filter || {}, now = performance.now();
      data.placements.forEach(function (p) {
        var e = inst.index[p.uid];
        if (!e) return;
        e.visible = visibleFor(p, f) && (!stepMode || (p.seq || 0) <= stepMode.to);
        if (animIn[p.uid] && e.visible) writeInstance(e, animPos(p, animIn[p.uid], now).q, true);
        else writeInstance(e, p, e.visible);
      });
      flushInstances();
      rebuildLines();
    }
    function disposeCargo() {
      [inst.box, inst.cyl, inst.pal, inst.ld, inst.lbl].forEach(function (im) { if (im) { cargoG.remove(im); if (im.dispose) im.dispose(); } });
      [inst.edges, inst.locks].forEach(function (l) { if (l) { cargoG.remove(l); l.geometry.dispose(); } });
      inst = freshInst();
    }

    function rebuildCargo() {
      disposeCargo();
      animIn = {}; animCount = 0;
      if (!data) return;
      var real = style === 'real' && !!LP.cargoAssets, A = real ? LP.cargoAssets(THREE) : null;
      var f0 = data.filter || {}, solid = real && f0.colorBy && f0.colorBy !== 'sku';   // colour modes: plain painted boxes
      data.solid = solid;
      var boxes = [], drums = [], pallets = [], loads = [];
      data.placements.forEach(function (p) {
        var spec = data.specs[p.sku] || {};
        if (spec.pkg === 'cylinder') drums.push(p);
        else if (real && spec.pkg === 'pallet') loads.push(p);
        else boxes.push(p);
        if (spec.pkg === 'pallet') pallets.push(p);
      });
      data.maxW = LP.maxWeight ? LP.maxWeight(data.placements) : 0;
      data.minW = LP.minWeight ? LP.minWeight(data.placements) : 0;
      var big = data.placements.length > 1500;          // keep large jobs fast: no stickers / cargo shadows
      inst.box = makeIM(real ? A.box : unitBox, boxes.length, real && !solid ? A.cartonMat : cargoMat);
      inst.cyl = makeIM(real ? A.drum : unitCyl, drums.length, real ? A.drumMat : cargoMat);
      inst.pal = makeIM(real ? A.pallet : unitBox, pallets.length, real ? A.palletMat : palletMat);
      inst.ld = makeIM(A ? A.box : unitBox, loads.length, A && !solid ? A.loadMat : cargoMat);
      var stickers = real && !big && !solid ? boxes.filter(function (p) { var s = data.specs[p.sku] || {}; return s.pkg !== 'pallet'; }) : [];
      inst.lbl = makeIM(A ? A.label : unitBox, stickers.length * 3, A ? A.labelMat : cargoMat);
      if (inst.lbl) inst.lbl.castShadow = false;
      [inst.box, inst.cyl, inst.pal, inst.ld].forEach(function (im) { if (im) { im.receiveShadow = real || realShell(); im.castShadow = !big; } });
      boxes.forEach(function (p, i) { inst.uids.box[i] = p.uid; inst.index[p.uid] = { im: inst.box, i: i, p: p, kind: 'box' }; });
      drums.forEach(function (p, i) { inst.uids.cyl[i] = p.uid; inst.index[p.uid] = { im: inst.cyl, i: i, p: p, kind: 'cyl' }; });
      loads.forEach(function (p, i) { inst.uids.ld[i] = p.uid; inst.index[p.uid] = { im: inst.ld, i: i, p: p, kind: 'ld' }; });
      pallets.forEach(function (p, i) { inst.index[p.uid].pal = i; });
      stickers.forEach(function (p, i) { inst.index[p.uid].lbl = i * 3; });
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
      if (animCount) stepAnimations();
      if (dunHL) stepDunnageHighlight(performance.now());
      if (!dirty) return;
      dirty = false;
      updateCutaway();
      renderer.render(scene, camera);
      updateHud();
      updateNav();
    })();

    resize();
    buildContainer();
    resetCamera();

    return {
      /** Rebuilds the container (and vehicle) only when size, vehicle or language changed. */
      setContainer: function (c, veh) {
        if (veh) { vehicle.type = veh.type; vehicle.show = veh.show; vehicle.cabColor = veh.cabColor || null; vehicle.logo = veh.logo || null; vehicle.containerNo = veh.containerNo || ''; }
        var key = [c.W, c.L, c.H, vehicle.type, vehicle.show, LP.i18n.lang, c.doorW, c.doorH, vehicle.cabColor, vehicle.logo ? vehicle.logo.length + vehicle.logo.slice(-24) : '',
          style, vehicle.containerNo, c.tare, c.maxGross, c.bed ? JSON.stringify(c.bed) : ''].join('|');
        if (key === builtKey) return;
        var sizeChanged = !(c.W === C.W && c.L === C.L && c.H === C.H) || !builtKey;
        var vehChanged = builtKey && builtKey.split('|').slice(3, 5).join('|') !== [vehicle.type, vehicle.show].join('|');
        builtKey = key;
        C = { W: c.W, L: c.L, H: c.H, doorW: c.doorW, doorH: c.doorH, tare: c.tare, maxGross: c.maxGross, containerNo: vehicle.containerNo, bed: c.bed || null };
        buildContainer();
        if (sizeChanged || vehChanged) resetCamera();
      },
      relabel: function () { builtKey = null; buildContainer(); },
      /** 'flat' (default) or 'real' (steel container shell, shadows; shipping containers only). */
      setStyle: function (v, opts) {
        v = v === 'real' ? 'real' : 'flat';
        var person = !opts || opts.person !== false;
        if (v === style && person === showPerson) return;
        style = v; showPerson = person; builtKey = null; buildContainer(); configureShadows();
        rebuildCargo();
      },
      /** Securing-material plan (E.dunnagePlan) and whether to draw it. */
      setDunnage: function (plan, show) {
        var key = plan ? JSON.stringify(plan.gaps.map(function (g) { return [g.id, g.type, g.x0, g.x1, g.y0, g.y1, g.h, g.qty]; })) + C.W + C.L : '';
        if (key === dunKey && !!show === dunShow) return;
        dunKey = key; dunPlan = plan; dunShow = !!show;
        buildDunnage();
      },
      /** Briefly pulse the dunnage of the given gaps (summary list → "show me"). */
      highlightDunnage: function (ids) { dunHL = { ids: ids || [], t0: performance.now() }; dirty = true; },
      /** Slide the given items in through the door (loading animation); dur in ms. */
      animateIn: function (uids, dur) {
        var now = performance.now();
        (uids || []).forEach(function (uid, k) {
          if (!inst.index[uid]) return;
          if (!animIn[uid]) animCount++;
          animIn[uid] = { t0: now + k * 25, dur: dur || 500 };
        });
        if (animCount) { applyState(); dirty = true; }
      },
      setData: function (d) {
        data = d;
        data.byUid = {};
        d.placements.forEach(function (p) { data.byUid[p.uid] = p; });
        rebuildCargo();
      },
      setFilter: function (f) {
        if (!data) return;
        var wasSolid = !!data.solid;
        data.filter = f;
        if (style === 'real' && wasSolid !== !!(f && f.colorBy && f.colorBy !== 'sku')) { rebuildCargo(); return; }
        applyState();
      },
      setSelected: function (uid) { if (data) { data.selected = uid; updateSel(uid); dirty = true; } },
      setOpacity: function (v) {
        opacity = v;
        wallMats.forEach(function (m) { m.opacity = v; m.visible = v > 0.01; });
        dirty = true;
      },
      setManual: function (on) { if (manual !== on) { manual = on; refreshAxes(); } canvas.style.cursor = on ? 'grab' : ''; },
      /** Axes / origin / rulers / view cube options: { gizmo, origin, ruler, rulerMode: 'manual'|'always', rulerStep, cube }. */
      setAxes: function (o) {
        var step = axes.rulerStep;
        for (var k in o) if (k in axes) axes[k] = o[k];
        if (axes.rulerStep !== step) buildRulers();
        refreshAxes();
        updateSel(data && data.selected);
      },
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
        updateCutaway();
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
        updateCutaway();
        dirty = true;
        return url;
      }
    };
  };
})(this);
