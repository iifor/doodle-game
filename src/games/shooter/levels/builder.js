import * as THREE from 'three';
import { INK } from '../render.js';
import { makeInkMaterial } from '../render.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export function createBuilder(scene, world) {
  const geos = {};
  const L = {
    rings: [],
    spawns: [],
    snipers: [],
    pickups: [],
    animated: [],
    meshes: [],
    playerStart: new THREE.Vector3(0, 0, 42),
    bounds: { minX: -55, maxX: 55, minZ: -55, maxZ: 55 },
    arenaSpawns: [],
    grappleMovers: [],
    breakables: [],
    key: 'district',
  };
  const addGeo = (g, ink) => (geos[ink] || (geos[ink] = [])).push(g);
  const collider = (x, y, z, w, h, d, o = {}) =>
    world.addBox(
      { x: x - w / 2, y, z: z - d / 2 },
      { x: x + w / 2, y: y + h, z: z + d / 2 },
      { noNav: !!o.noNav, noShoot: !!o.noShoot, noGrapple: !!o.noGrapple, tag: o.tag },
    );
  function box(x, y, z, w, h, d, o = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z);
    addGeo(g, o.ink ?? INK.BLUE);
    if (!o.noCollide) collider(x, y, z, w, h, d, o);
  }
  const slab = (x1, z1, x2, z2, y, t, o = {}) =>
    box((x1 + x2) / 2, y - t, (z1 + z2) / 2, x2 - x1, t, z2 - z1, o); // top surface at y
  // Wall pieces along an axis with rectangular gaps [a1, a2, yBottom = 0, yTop = h]; gaps may overlap.
  function wallPieces(a1, a2, h, gaps) {
    const xs = new Set([a1, a2]);
    for (const g of gaps) {
      xs.add(Math.min(Math.max(g[0], a1), a2));
      xs.add(Math.min(Math.max(g[1], a1), a2));
    }
    const sorted = [...xs].sort((a, b) => a - b);
    const runs = new Map();
    const out = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const s1 = sorted[i],
        s2 = sorted[i + 1];
      if (s2 - s1 < 0.005) continue;
      const mid = (s1 + s2) / 2;
      const cuts = gaps
        .filter((g) => g[0] <= mid && g[1] >= mid)
        .map((g) => [g[2] ?? 0, g[3] ?? h])
        .sort((a, b) => a[0] - b[0]);
      const pieces = [];
      let y = 0;
      for (const [gb, gt] of cuts) {
        if (gb > y + 0.005) pieces.push([y, gb]);
        y = Math.max(y, gt);
      }
      if (y < h - 0.005) pieces.push([y, h]);
      const keys = new Set();
      for (const [yb, yt] of pieces) {
        const k = yb.toFixed(3) + ',' + yt.toFixed(3);
        keys.add(k);
        const r = runs.get(k);
        if (r && Math.abs(r[1] - s1) < 0.005) r[1] = s2;
        else runs.set(k, [s1, s2, yb, yt]);
      }
      for (const [k, r] of [...runs])
        if (!keys.has(k)) {
          out.push(r);
          runs.delete(k);
        }
    }
    for (const r of runs.values()) out.push(r);
    return out;
  }
  function wallX(x1, x2, z, y, h, t, gaps = [], o = {}) {
    for (const [a, b, yb, yt] of wallPieces(x1, x2, h, gaps))
      box((a + b) / 2, y + yb, z, b - a, yt - yb, t, o);
  }
  function wallZ(z1, z2, x, y, h, t, gaps = [], o = {}) {
    for (const [a, b, yb, yt] of wallPieces(z1, z2, h, gaps))
      box(x, y + yb, (a + b) / 2, t, yt - yb, b - a, o);
  }
  function stairs(x, y, z, dir, steps, width, o = {}) {
    const rise = o.rise ?? 4 / 14,
      run = o.run ?? 0.45;
    const dx = dir === '+x' ? 1 : dir === '-x' ? -1 : 0,
      dz = dir === '+z' ? 1 : dir === '-z' ? -1 : 0;
    for (let i = 0; i < steps; i++) {
      const c = (i + 0.5) * run,
        h = (i + 1) * rise;
      const cx = x + dx * c,
        cz = z + dz * c;
      box(cx, y, cz, dx ? run + 0.004 : width, h, dz ? run + 0.004 : width, o);
    }
    return { x: x + dx * steps * run, z: z + dz * steps * run, y: y + steps * rise };
  }
  // railing along an axis-aligned segment: visual posts + bar, one collider
  function rail(x1, z1, x2, z2, y, o = {}) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const ax = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const cx = (x1 + x2) / 2,
      cz = (z1 + z2) / 2;
    box(cx, y + 0.9, cz, ax ? len : 0.12, 0.12, ax ? 0.12 : len, { noCollide: true, ink: o.ink });
    const n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      box(x1 + (x2 - x1) * t, y, z1 + (z2 - z1) * t, 0.1, 0.9, 0.1, { noCollide: true, ink: o.ink });
    }
    collider(cx, y, cz, ax ? len : 0.12, 1.0, ax ? 0.12 : len, { noNav: true, noShoot: true });
  }
  function cyl(x, y, z, r, h, o = {}) {
    const g = new THREE.CylinderGeometry(r, r, h, o.seg ?? 12);
    g.translate(x, y + h / 2, z);
    addGeo(g, o.ink ?? INK.BLUE);
    if (!o.noCollide) collider(x, y, z, r * 1.6, h, r * 1.6, o);
  }
  function sphere(x, y, z, r, o = {}) {
    const g = new THREE.SphereGeometry(r, o.seg ?? 10, o.seg ?? 8);
    g.translate(x, y, z);
    addGeo(g, o.ink ?? INK.BLUE);
  }
  function ring(x, y, z, axis = 'z') {
    const g = new THREE.TorusGeometry(0.6, 0.1, 8, 20);
    if (axis === 'x') g.rotateY(Math.PI / 2);
    else if (axis === 'y') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    addGeo(g, INK.ORANGE);
    L.rings.push(new THREE.Vector3(x, y, z));
  }
  const spawn = (x, y, z) => L.spawns.push(new THREE.Vector3(x, y, z));
  const sniper = (x, y, z) => L.snipers.push(new THREE.Vector3(x, y, z));
  const pickup = (x, y, z) => L.pickups.push(new THREE.Vector3(x, y, z));
  // ---------------- shared finish ----------------
  function finish() {
    for (const ink in geos) {
      const merged = mergeGeometries(geos[ink], false);
      if (!merged) throw new Error(`Cannot merge level geometry for ink ${ink}`);
      for (const geometry of geos[ink]) geometry.dispose();
      const mesh = new THREE.Mesh(merged, makeInkMaterial({ ink: Number(ink) }));
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      L.meshes.push(mesh);
    }
    world.finalize();
    return L;
  }
  // a paper plane that loops overhead, purely decorative
  function planes(n, baseR, baseH, o = {}) {
    const sc = o.scale || 1;
    for (let i = 0; i < n; i++) {
      const g = new THREE.ConeGeometry(1.2 * sc, 4 * sc, 3);
      g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, makeInkMaterial({ ink: o.ink ?? INK.BLUE }));
      scene.add(m);
      L.meshes.push(m);
      L.grappleMovers.push({ mesh: m, radius: 2.2 * sc });
      const r = baseR + i * (o.rStep ?? 12),
        h = baseH + i * (o.hStep ?? 6),
        ph = i * 2.1,
        sp = (o.speed ?? 0.11) + i * 0.01;
      L.animated.push({
        mesh: m,
        update: (t) => {
          const a = t * sp + ph;
          m.position.set(Math.cos(a) * r, h + Math.sin(a * 2.3) * 3, Math.sin(a) * r * 0.7);
          m.lookAt(Math.cos(a + 0.05) * r, h + Math.sin((a + 0.05) * 2.3) * 3, Math.sin(a + 0.05) * r * 0.7);
          m.rotateZ(Math.sin(a * 3) * 0.6);
        },
      });
    }
  }
  return {
    L,
    addGeo,
    collider,
    box,
    slab,
    wallX,
    wallZ,
    stairs,
    rail,
    cyl,
    sphere,
    ring,
    spawn,
    sniper,
    pickup,
    finish,
    planes,
    scene,
    world,
  };
}
