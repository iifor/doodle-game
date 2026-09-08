import * as THREE from 'three';
import { makeInkMaterial, INK } from '../render.js';
import { rand, TAU } from '../util.js';
// ---------------- doodle model kit ----------------
// Everything below is drawn as pen strokes: limbs are slightly bowed tubes, bodies are
// flattened ovals and none of it is hatched, so enemies read as ink drawings on the page
// rather than as shaded 3D primitives.
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function bx(w, h, d, x, y, z, mat, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function sph(r, x, y, z, mat, parent, seg = 8) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
// a flattened oval "drawn" body part
function blob(rx, ry, rz, x, y, z, mat, parent) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
  m.scale.set(rx, ry, rz);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
// a limb: one slightly bowed stroke hanging from its pivot, with a marker at its middle for hit tests
function noodle(len, r, mat, parent, x, y, z, bow = 0.05) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const c = new THREE.QuadraticBezierCurve3(
    V3(0, 0, 0),
    V3(rand(-bow, bow), -len * 0.5, rand(-bow, bow) + bow * 0.6),
    V3(0, -len, 0),
  );
  g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 5, r, 6, false), mat));
  const mid = new THREE.Object3D();
  mid.position.y = -len * 0.55;
  g.add(mid);
  g.userData.mid = mid;
  g.userData.len = len;
  return g;
}
function mitten(r, mat, parent, y) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), mat);
  m.position.y = y;
  m.scale.set(1, 1.15, 0.8);
  parent.add(m);
  return m;
}
function shoe(mat, parent, y, s = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.1 * s, 7, 5), mat);
  m.position.set(0, y, 0.06 * s);
  m.scale.set(1, 0.62, 1.9);
  parent.add(m);
  return m;
}
// dot eyes, angry brows and a curved mouth, all solid ink so they read at a glance
function doodleFace(headG, solid, opts = {}) {
  const eyes = new THREE.Group();
  headG.add(eyes);
  const ex = opts.ex ?? 0.1,
    ey = opts.ey ?? 0.03,
    ez = opts.ez ?? 0.25,
    er = opts.er ?? 0.045;
  for (const sx of [-1, 1]) {
    const e = sph(er, sx * ex, ey, ez, solid, eyes, 6);
    e.scale.set(0.85, 1.15, 0.7);
    const b = bx(0.115, 0.026, 0.026, sx * ex, ey + 0.11, ez - 0.01, solid, eyes);
    b.rotation.z = sx * -0.5;
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.018, 4, 9, Math.PI * 0.9), solid);
  mouth.position.set(0, ey - 0.16, ez - 0.02);
  mouth.rotation.z = opts.smile ? Math.PI : 0;
  eyes.add(mouth);
  const xeyes = new THREE.Group();
  headG.add(xeyes);
  xeyes.visible = false;
  for (const sx of [-1, 1])
    for (const a of [0.8, -0.8]) {
      const c = bx(0.13, 0.024, 0.024, sx * ex, ey, ez, solid, xeyes);
      c.rotation.z = a;
    }
  const o = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 4, 9), solid);
  o.position.set(0, ey - 0.17, ez - 0.02);
  xeyes.add(o);
  return { eyes, xeyes };
}
function buildHat(headG, mat, solid, T) {
  const h = T.hat;
  if (h === 'cap') {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.29, 10, 5, 0, TAU, 0, Math.PI * 0.5), mat);
    c.position.y = 0.05;
    c.scale.y = 0.62;
    headG.add(c);
    const brim = bx(0.34, 0.035, 0.24, 0, 0.05, 0.24, mat, headG);
    brim.rotation.x = -0.18;
  } else if (h === 'band') {
    const b = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.028, 5, 14), solid);
    b.rotation.x = Math.PI / 2;
    b.position.y = 0.11;
    headG.add(b);
    for (const [dx, dz, a] of [
      [0.24, -0.22, 0.5],
      [0.2, -0.3, -0.3],
    ]) {
      const t = bx(0.04, 0.03, 0.4, dx, 0.08 - dz * 0.2, -0.26, solid, headG);
      t.rotation.y = a;
    }
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.2, 4), mat);
      sp.position.set(-0.12 + i * 0.08, 0.28, 0.02);
      sp.rotation.z = (i - 1.5) * 0.35;
      headG.add(sp);
    }
  } else if (h === 'helmet') {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 6, 0, TAU, 0, Math.PI * 0.55), mat);
    c.position.y = 0.0;
    c.scale.y = 0.85;
    headG.add(c);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.315, 0.03, 4, 14), mat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.02;
    headG.add(rim);
  } else if (h === 'hood') {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 7, 0, TAU, 0, Math.PI * 0.62), mat);
    c.position.y = -0.02;
    c.scale.set(1.03, 1.15, 0.95);
    headG.add(c);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 5), mat);
    tail.position.set(0, 0.16, -0.3);
    tail.rotation.x = 1.5;
    headG.add(tail);
  } else if (h === 'crown') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 4), mat);
      sp.position.set(Math.cos(a) * 0.22, 0.34, Math.sin(a) * 0.22);
      headG.add(sp);
    }
    const b = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 4, 14), mat);
    b.rotation.x = Math.PI / 2;
    b.position.y = 0.24;
    headG.add(b);
  }
}
export function buildWeaponProp(gun, mat, solid, T) {
  if (T.weapon === 'blade') {
    bx(0.02, 0.05, 0.95, 0, 0.04, 0.42, mat, gun);
    bx(0.11, 0.11, 0.03, 0, 0.04, -0.06, solid, gun);
    bx(0.035, 0.045, 0.24, 0, 0.04, -0.19, solid, gun);
  } else if (T.weapon === 'shotgun') {
    bx(0.1, 0.13, 0.66, 0, 0.02, 0.2, mat, gun);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), solid);
    b.rotation.x = Math.PI / 2;
    b.position.set(0, 0.08, 0.5);
    gun.add(b);
  } else if (T.weapon === 'sniper') {
    bx(0.075, 0.11, 0.6, 0, 0.02, 0.15, mat, gun);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.95, 6), solid);
    b.rotation.x = Math.PI / 2;
    b.position.set(0, 0.05, 0.72);
    gun.add(b);
    bx(0.06, 0.07, 0.22, 0, 0.13, 0.06, solid, gun);
  } else if (T.weapon === 'pistol') {
    bx(0.055, 0.09, 0.3, 0, 0.03, 0.13, mat, gun);
    bx(0.045, 0.11, 0.055, 0, -0.05, 0, solid, gun);
  } else if (T.weapon === 'boss') {
    const pen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 2.4, 7),
      makeInkMaterial({ ink: INK.ORANGE, shadeScale: 0, shadeBias: 1 }),
    );
    pen.position.y = 0.7;
    gun.add(pen);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.38, 6), solid);
    tip.position.y = 2.08;
    gun.add(tip);
    const er = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.26, 8),
      makeInkMaterial({ ink: INK.PINK, shadeScale: 0, shadeBias: 1 }),
    );
    er.position.y = -0.62;
    gun.add(er);
  } else {
    bx(0.085, 0.12, 0.5, 0, 0.02, 0.16, mat, gun);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 6), solid);
    b.rotation.x = Math.PI / 2;
    b.position.set(0, 0.05, 0.52);
    gun.add(b);
    bx(0.05, 0.16, 0.09, 0, -0.09, 0.08, mat, gun);
  }
}

export function buildHumanoid(mat, solid, T) {
  const root = new THREE.Group();
  const parts = {},
    J = {};
  const build = T.build || {};
  const bodyW = build.bodyW ?? 1,
    headS = build.headS ?? 1,
    limbR = build.limbR ?? 0.032;
  const jit = rand(0.95, 1.06); // every figure is drawn slightly differently
  const hips = new THREE.Group();
  hips.position.y = 0.86;
  root.add(hips);
  parts.hips = new THREE.Object3D();
  hips.add(parts.hips);
  const torso = new THREE.Group();
  torso.position.y = 0.04;
  hips.add(torso);
  blob(0.3 * bodyW, 0.3, 0.19 * bodyW, 0, 0.26, 0, mat, torso);
  parts.torso = new THREE.Object3D();
  parts.torso.position.y = 0.26;
  torso.add(parts.torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 6), mat);
  neck.position.y = 0.56;
  torso.add(neck);
  const headG = new THREE.Group();
  headG.position.y = 0.62;
  torso.add(headG);
  blob(0.275 * headS * jit, 0.3 * headS, 0.25 * headS, 0, 0.26, 0, mat, headG);
  parts.head = new THREE.Object3D();
  parts.head.position.y = 0.26;
  headG.add(parts.head);
  const faceG = new THREE.Group();
  faceG.position.y = 0.26;
  faceG.scale.setScalar(headS);
  headG.add(faceG);
  const fc = doodleFace(faceG, solid, { ez: 0.2 * headS + 0.06, smile: T.weapon === 'blade' });
  const hatG = new THREE.Group();
  hatG.position.y = 0.26;
  hatG.scale.setScalar(headS);
  headG.add(hatG);
  buildHat(hatG, mat, solid, T);
  const shY = 0.46,
    shX = 0.26 * bodyW;
  const armL = noodle(0.3, limbR, mat, torso, -shX, shY, 0),
    armR = noodle(0.3, limbR, mat, torso, shX, shY, 0);
  const foreL = noodle(0.28, limbR * 0.92, mat, armL, 0, -0.3, 0),
    foreR = noodle(0.28, limbR * 0.92, mat, armR, 0, -0.3, 0);
  mitten(limbR * 2.3, mat, foreL, -0.3);
  mitten(limbR * 2.3, mat, foreR, -0.3);
  const legL = noodle(0.42, limbR * 1.15, mat, hips, -0.13 * bodyW, -0.02, 0),
    legR = noodle(0.42, limbR * 1.15, mat, hips, 0.13 * bodyW, -0.02, 0);
  const shinL = noodle(0.42, limbR * 1.05, mat, legL, 0, -0.42, 0),
    shinR = noodle(0.42, limbR * 1.05, mat, legR, 0, -0.42, 0);
  shoe(mat, shinL, -0.42, bodyW);
  shoe(mat, shinR, -0.42, bodyW);
  for (const [k, g] of [
    ['armL', armL],
    ['armR', armR],
    ['foreL', foreL],
    ['foreR', foreR],
    ['legL', legL],
    ['legR', legR],
    ['shinL', shinL],
    ['shinR', shinR],
  ])
    parts[k] = g.userData.mid;
  const gun = new THREE.Group();
  gun.position.set(0, -0.29, 0.07);
  foreR.add(gun);
  buildWeaponProp(gun, mat, solid, T);
  const tip = new THREE.Object3D();
  tip.position.set(0, 0.05, T.weapon === 'blade' ? 0.92 : T.weapon === 'boss' ? 0.4 : 0.78);
  gun.add(tip);
  let shieldG = null;
  if (T.shield) {
    shieldG = new THREE.Group();
    shieldG.position.set(-0.17, 0.34, 0.46);
    torso.add(shieldG);
    bx(0.92, 1.3, 0.07, 0, 0, 0, mat, shieldG);
    bx(0.62, 0.06, 0.09, 0, 0.26, 0.04, solid, shieldG);
    bx(0.06, 0.62, 0.09, 0, 0.26, 0.04, solid, shieldG);
    parts.shield = new THREE.Object3D();
    shieldG.add(parts.shield);
  }
  Object.assign(J, { hips, torso, headG, armL, armR, foreL, foreR, legL, legR, shinL, shinR, gun, shieldG });
  const hit = [
    ['head', 0.3],
    ['torso', 0.33],
    ['hips', 0.2],
    ['armL', 0.11],
    ['armR', 0.11],
    ['foreL', 0.1],
    ['foreR', 0.1],
    ['legL', 0.13],
    ['legR', 0.13],
    ['shinL', 0.11],
    ['shinR', 0.11],
  ];
  if (T.shield) hit.unshift(['shield', 0.66]);
  root.scale.setScalar(T.scale);
  return { root, parts, J, tip, face: fc, hit };
}
export function buildBomber(mat, solid, T, boss = false) {
  const root = new THREE.Group();
  const parts = {},
    J = {};
  const hips = new THREE.Group();
  hips.position.y = 0.5;
  root.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);
  blob(0.44, 0.44, 0.44, 0, 0.32, 0, mat, torso);
  parts.torso = new THREE.Object3D();
  parts.torso.position.y = 0.32;
  torso.add(parts.torso);
  parts.head = parts.torso;
  const headG = new THREE.Group();
  headG.position.y = 0.32;
  torso.add(headG);
  const fc = doodleFace(headG, solid, { ex: 0.13, ey: 0.1, ez: 0.38, er: 0.06 });
  let spark = null;
  if (!boss) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.14, 7), mat);
    cap.position.y = 0.76;
    torso.add(cap);
    const fuse = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.QuadraticBezierCurve3(V3(0, 0.8, 0), V3(0.16, 1.0, 0), V3(0.24, 1.14, 0)),
        5,
        0.02,
        5,
        false,
      ),
      solid,
    );
    torso.add(fuse);
    spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 6, 5),
      makeInkMaterial({ ink: INK.ORANGE, fill: true }),
    );
    spark.position.set(0.24, 1.14, 0);
    torso.add(spark);
  } else if (T.bossKind === 'inkblot') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 5), mat);
      sp.position.set(Math.cos(a) * 0.42, 0.32 + Math.sin(a * 2.3) * 0.25, Math.sin(a) * 0.42);
      sp.lookAt(Math.cos(a) * 3, 0.32, Math.sin(a) * 3);
      sp.rotateX(Math.PI / 2);
      torso.add(sp);
    }
  } else {
    // a chunky rubber block on top: the eraser wears its own head
    bx(0.7, 0.32, 0.5, 0, 0.86, 0, mat, torso);
    bx(0.74, 0.05, 0.54, 0, 0.7, 0, solid, torso);
  }
  const armL = noodle(0.26, 0.03, mat, torso, -0.42, 0.42, 0),
    armR = noodle(0.26, 0.03, mat, torso, 0.42, 0.42, 0);
  mitten(0.07, mat, armL, -0.26);
  mitten(0.07, mat, armR, -0.26);
  const legL = noodle(0.26, 0.035, mat, hips, -0.16, -0.06, 0),
    legR = noodle(0.26, 0.035, mat, hips, 0.16, -0.06, 0);
  const shinL = noodle(0.24, 0.032, mat, legL, 0, -0.26, 0),
    shinR = noodle(0.24, 0.032, mat, legR, 0, -0.26, 0);
  shoe(mat, shinL, -0.24, 0.9);
  shoe(mat, shinR, -0.24, 0.9);
  Object.assign(J, {
    hips,
    torso,
    headG,
    armL,
    armR,
    foreL: armL,
    foreR: armR,
    legL,
    legR,
    shinL,
    shinR,
    gun: new THREE.Group(),
    spark,
  });
  root.scale.setScalar(T.scale);
  const tip =
    spark ||
    (() => {
      const o = new THREE.Object3D();
      o.position.set(0, 0.5, 0.5);
      torso.add(o);
      return o;
    })();
  return { root, parts, J, tip, face: fc, hit: [['torso', 0.5]] };
}
export function buildFlyer(mat, solid, T) {
  const root = new THREE.Group();
  const parts = {},
    J = {};
  const body = new THREE.Group();
  body.position.y = 0.6;
  root.add(body);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.25, 3), mat);
  cone.rotation.x = Math.PI / 2;
  cone.position.z = 0.08;
  body.add(cone);
  parts.torso = new THREE.Object3D();
  body.add(parts.torso);
  parts.head = parts.torso;
  const wl = bx(0.86, 0.025, 0.5, -0.48, 0.04, -0.14, mat, body),
    wr = bx(0.86, 0.025, 0.5, 0.48, 0.04, -0.14, mat, body);
  const headG = new THREE.Group();
  headG.position.set(0, -0.06, 0.3);
  headG.scale.setScalar(0.72);
  body.add(headG);
  const fc = doodleFace(headG, solid, { ex: 0.11, ey: 0.02, ez: 0.16, er: 0.05 });
  bx(0.04, 0.28, 0.3, 0, 0.14, -0.62, mat, body);
  Object.assign(J, { body, wl, wr, headG, torso: body, gun: new THREE.Group() });
  root.scale.setScalar(T.scale);
  return { root, parts, J, tip: headG, face: fc, hit: [['torso', 0.48]] };
}
