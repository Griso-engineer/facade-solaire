/* Maquette 3D (three.js r147, script classique) : bâtiment étudié extrudé, façades
   colorées et numérotées, voisins en gris, course du soleil et ombres portées.
   Repère three : X = est, Y = haut, Z = −nord. */
(function (FS) {
  'use strict';
  let renderer, scene, camera, controls, sun, hemi, root, sunMesh, pathLine, groundMesh;
  let host, labelBox, readout, facadeMeshes = [], labels = [], needs = true, raf = 0;
  let colors = null; // { id: '#rrggbb' } coloration des façades (résultats)
  let selected = null, onPick = null, extent = 150;
  const ray = new (window.THREE ? THREE.Raycaster : Object)();

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const v3 = (x, y, z) => new THREE.Vector3(x, z, -y); // (est, nord, haut) → three

  function available() { return !!window.THREE; }

  function init(el, opts) {
    host = el; onPick = opts && opts.onPick;
    if (!available()) { el.append(FS.el('p', { class: 'note err' }, 'three.js n\'a pas pu être chargé (connexion ?).')); return; }
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.append(renderer.domElement);
    labelBox = FS.el('div', { class: 'labels3d' });
    readout = FS.el('div', { class: 'sun-readout' });
    el.append(labelBox, readout);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    camera.position.set(120, 110, 160);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.addEventListener('change', () => { needs = true; });

    hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a84, 0.5);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    scene.add(sun, sun.target);

    root = new THREE.Group();
    scene.add(root);

    renderer.domElement.addEventListener('pointermove', onHover);
    renderer.domElement.addEventListener('pointerleave', () => FS.hideTip());
    renderer.domElement.addEventListener('click', onClick);
    new ResizeObserver(resize).observe(el);
    resize();
    loop();
  }

  function resize() {
    if (!renderer) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    needs = true;
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!host.offsetParent) return; // onglet masqué
    controls.update();
    if (!needs) return;
    needs = false;
    renderer.render(scene, camera);
    placeLabels();
  }

  function disposeGroup(g) {
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    while (g.children.length) g.remove(g.children[0]);
  }

  // ---------- Construction ----------
  function build() {
    if (!renderer) return;
    disposeGroup(root);
    facadeMeshes = []; labels = []; labelBox.textContent = '';
    const P = FS.project.get(), D = FS.project.derived();
    scene.background = new THREE.Color(css('--scene-bg'));
    extent = P.radius + 40;
    const ink = new THREE.Color(css('--ink'));
    const edgeMat = new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.55 });
    const edgeNb = new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.18 });

    // sol
    const gGeo = new THREE.CircleGeometry(extent + 60, 96);
    gGeo.rotateX(-Math.PI / 2);
    groundMesh = new THREE.Mesh(gGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(css('--scene-ground')) }));
    groundMesh.receiveShadow = true;
    root.add(groundMesh);

    // nord
    addLabel(v3(0, extent + 25, 0), 'N', 'card');
    const arrow = new THREE.BufferGeometry().setFromPoints([v3(0, extent - 10, 0.2), v3(0, extent + 15, 0.2)]);
    root.add(new THREE.Line(arrow, new THREE.LineBasicMaterial({ color: new THREE.Color(css('--accent')) })));

    if (!D.ok) { needs = true; return; }

    // voisins
    const nbMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(css('--scene-nb')) });
    const nbHyp = new THREE.MeshLambertMaterial({ color: new THREE.Color(css('--scene-nb')).lerp(new THREE.Color('#ff6600'), 0.08) });
    for (const nb of D.nbs) {
      if (nb.height <= 0) continue;
      const shape = new THREE.Shape(nb.xy.map((p) => new THREE.Vector2(p[0], p[1])));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: nb.height, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, nb.src === 'default' ? nbHyp : nbMat);
      m.castShadow = true; m.receiveShadow = true;
      root.add(m);
      root.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeNb));
    }

    // bâtiment étudié : toiture
    const H = D.H;
    const tShape = new THREE.Shape(D.xy.map((p) => new THREE.Vector2(p[0], p[1])));
    const roofGeo = new THREE.ShapeGeometry(tShape);
    roofGeo.rotateX(-Math.PI / 2); roofGeo.translate(0, H, 0);
    const roof = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(css('--scene-target')), side: THREE.DoubleSide }));
    roof.castShadow = true; roof.receiveShadow = true;
    root.add(roof);
    const outline = D.xy.map((p) => v3(p[0], p[1], H + 0.05)); outline.push(outline[0]);
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), edgeMat));

    // façades
    for (const f of D.model.facades) {
      const pos = [];
      for (const s of f.segs) {
        const a0 = v3(s.p0[0], s.p0[1], s.zMin), b0 = v3(s.p1[0], s.p1[1], s.zMin);
        const a1 = v3(s.p0[0], s.p0[1], H), b1 = v3(s.p1[0], s.p1[1], H);
        pos.push(a0, b0, b1, a0, b1, a1);
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pos);
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ color: facadeColor(f), side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.facade = f;
      root.add(mesh);
      facadeMeshes.push(mesh);
      // arêtes verticales et pied
      const ln = [];
      for (const s of f.segs) {
        ln.push(v3(s.p0[0], s.p0[1], s.zMin), v3(s.p1[0], s.p1[1], s.zMin));
      }
      const s0 = f.segs[0], s1 = f.segs[f.segs.length - 1];
      ln.push(v3(s0.p0[0], s0.p0[1], s0.zMin), v3(s0.p0[0], s0.p0[1], H), v3(s1.p1[0], s1.p1[1], s1.zMin), v3(s1.p1[0], s1.p1[1], H));
      root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ln), edgeMat));
      addLabel(v3(f.mid[0] + f.n[0] * 1.5, f.mid[1] + f.n[1] * 1.5, (f.zMin + H) / 2),
        f.id + ' · ' + f.label, f.pignon ? 'mito' : '', new THREE.Vector3(f.n[0], 0, -f.n[1]));
    }

    // soleil
    sunMesh = new THREE.Mesh(new THREE.SphereGeometry(4, 20, 14), new THREE.MeshBasicMaterial({ color: 0xff9f1c }));
    root.add(sunMesh);
    pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff9f1c, transparent: true, opacity: 0.8 }));
    root.add(pathLine);
    const sc = sun.shadow.camera;
    sc.left = -extent; sc.right = extent; sc.top = extent; sc.bottom = -extent; sc.near = 1; sc.far = extent * 4;
    sc.updateProjectionMatrix();
    updateSun();
  }

  function facadeColor(f) {
    if (colors && colors[f.id]) return new THREE.Color(colors[f.id]);
    const base = new THREE.Color(f.pignon ? css('--scene-nb') : css('--accent'));
    if (!f.pignon) base.lerp(new THREE.Color(css('--scene-target')), 0.45);
    return base;
  }

  function setColors(c) { colors = c; refreshColors(); }
  function refreshColors() {
    for (const m of facadeMeshes) {
      const c = facadeColor(m.userData.facade);
      if (selected === m.userData.facade.id) c.lerp(new THREE.Color(css('--ink')), 0.25);
      m.material.color.copy(c);
    }
    needs = true;
  }
  function select(id) { selected = id; refreshColors(); }

  function addLabel(pos, text, cls, normal) {
    const d = FS.el('div', { class: cls || '' }, text);
    labelBox.append(d);
    labels.push({ pos, el: d, normal });
  }
  function placeLabels() {
    const w = host.clientWidth, h = host.clientHeight;
    const v = new THREE.Vector3(), toCam = new THREE.Vector3();
    for (const l of labels) {
      // étiquette d'une façade vue de dos : masquée
      const back = l.normal && toCam.copy(camera.position).sub(l.pos).dot(l.normal) < 0;
      v.copy(l.pos).project(camera);
      const vis = !back && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      l.el.style.display = vis ? '' : 'none';
      if (vis) { l.el.style.left = ((v.x + 1) / 2 * w) + 'px'; l.el.style.top = ((1 - v.y) / 2 * h) + 'px'; }
    }
  }

  // ---------- Soleil ----------
  function updateSun() {
    if (!renderer) return;
    const P = FS.project.get(), D = FS.project.derived();
    const lat = D.ok ? D.lat : 48.8566, lon = D.ok ? D.lon : 2.3522;
    const year = 2026;
    const t = FS.solar.localToUTC(year, P.view.doy, P.view.hour, P.tz);
    const p = FS.solar.position(t, lat, lon);
    const R = extent * 1.15;
    const dir = FS.solar.vector(p);
    const up = p.altitude > 0;
    if (sunMesh) {
      sunMesh.visible = up;
      sunMesh.position.copy(v3(dir[0] * R, dir[1] * R, dir[2] * R));
    }
    sun.position.copy(v3(dir[0] * extent * 2, dir[1] * extent * 2, Math.max(dir[2], 0.01) * extent * 2));
    sun.target.position.set(0, 0, 0);
    sun.intensity = up ? 0.35 + 0.6 * Math.min(1, Math.sin(p.altitude * FS.RAD) * 2) : 0;
    hemi.intensity = up ? 0.55 : 0.4;
    // course du jour
    if (pathLine) {
      const pts = [];
      for (let m = 0; m <= 1440; m += 10) {
        const q = FS.solar.position(FS.solar.localToUTC(year, P.view.doy, m / 60, P.tz), lat, lon);
        if (q.altitude < -0.5) continue;
        const d = FS.solar.vector(q);
        pts.push(v3(d[0] * R, d[1] * R, Math.max(0, d[2]) * R));
      }
      pathLine.geometry.dispose();
      pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
    const st = FS.solar.sunTimes(year, P.view.doy, lat, lon, P.tz);
    const date = FS.solar.dateOfDoy(year, P.view.doy).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    readout.innerHTML = '<b>' + date + ', ' + FS.solar.fmtHour(P.view.hour) + '</b><br>' +
      (up ? 'Hauteur ' + FS.fmtFixed(p.altitude, 1) + '° · azimut ' + FS.fmtFixed(p.azimuth, 1) + '°' : 'Soleil sous l\'horizon') +
      '<br><span class="muted">Lever ' + FS.solar.fmtHour(st.rise) + ' · coucher ' + FS.solar.fmtHour(st.set) + '</span>';
    needs = true;
  }

  // ---------- Interaction ----------
  function pickAt(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(m, camera);
    const hit = ray.intersectObjects(facadeMeshes, false)[0];
    return hit ? hit.object.userData.facade : null;
  }
  function onHover(ev) {
    const f = pickAt(ev);
    if (!f) { FS.hideTip(); renderer.domElement.style.cursor = ''; return; }
    renderer.domElement.style.cursor = 'pointer';
    FS.showTip('Façade ' + f.id + ' · ' + FS.orientName[f.label] + ' (' + Math.round(f.az) + '°)\n' +
      FS.fmt(f.length, 1) + ' m × ' + FS.fmt(FS.project.derived().H - f.zMin, 1) + ' m = ' + FS.fmt(f.area, 0) + ' m²' +
      (f.pignon ? '\nHéberge au-dessus d\'un mitoyen' : '') +
      (colors && f.tip ? '\n' + f.tip : ''), ev.clientX, ev.clientY);
  }
  function onClick(ev) { const f = pickAt(ev); if (f && onPick) onPick(f.id); }

  function frame() {
    const D = FS.project.derived();
    if (!renderer || !D.ok) return;
    let r = 0;
    for (const p of D.xy) r = Math.max(r, Math.hypot(p[0], p[1]));
    const d = Math.max(90, r * 4.2 + D.H * 2.5);
    camera.position.copy(v3(d * 0.55, -d * 0.75, d * 0.55));
    controls.target.set(0, D.H * 0.35, 0);
    controls.update(); needs = true;
  }

  function snapshot() { if (!renderer) return null; renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); }
  function redraw() { needs = true; }

  FS.scene3d = { init, build, updateSun, setColors, select, frame, snapshot, redraw, available, _debug: () => ({ renderer, scene, camera, sun, root }) };
})(window.FS);
