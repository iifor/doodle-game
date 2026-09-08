import * as THREE from 'three';
import { INK } from '../render.js';
import { rand, TAU } from '../util.js';
import { makeInkMaterial } from '../render.js';
import { buildHumanoid } from '../enemies/models.js';
export function buildMexico(B, arena = false) {
  const {
    L,
    box,
    slab,
    stairs,
    rail,
    cyl,
    sphere,
    ring,
    spawn,
    sniper,
    pickup,
    planes,
    addGeo,
    collider,
    scene,
  } = B;
  const OR = INK.ORANGE,
    GR = INK.GREEN,
    PK = INK.PINK,
    BK = INK.BLACK,
    BL = INK.BLUE;
  L.key = 'mexico';
  L.playerStart.set(0, 0, 16);
  const P = 62;
  L.bounds = { minX: -P, maxX: P, minZ: -P, maxZ: P };
  const mat = (ink, fill = false) =>
    makeInkMaterial({ ink, fill, side: fill ? THREE.DoubleSide : THREE.FrontSide });
  const mesh = (geo, ink, fill = false) => new THREE.Mesh(geo, mat(ink, fill));
  // a prop that can be broken: its own meshes (so they can fly off) and a tagged collider
  const breakable = (kind, x, y, z, w, h, d, build, o = {}) => {
    const g = new THREE.Group();
    build(g);
    g.position.set(x, y, z);
    scene.add(g);
    L.meshes.push(g);
    const br = {
      id: L.breakables.length,
      kind,
      group: g,
      hp: o.hp ?? 1,
      pos: new THREE.Vector3(x, y + h / 2, z),
      alive: true,
      ink: o.ink ?? OR,
      box: null,
    };
    br.box = collider(x, y, z, w, h, d, { noNav: true });
    br.box.data.breakable = br;
    L.breakables.push(br);
    return br;
  };
  const pot = (x, z, big = false) =>
    breakable(
      'pot',
      x,
      0,
      z,
      big ? 1.2 : 0.9,
      big ? 1.3 : 0.9,
      big ? 1.2 : 0.9,
      (g) => {
        const r = big ? 0.55 : 0.4,
          h = big ? 1.2 : 0.85;
        g.add(mesh(new THREE.CylinderGeometry(r * 0.75, r, h, 9).translate(0, h / 2, 0), OR));
        g.add(
          mesh(new THREE.TorusGeometry(r * 0.72, 0.05, 5, 12).rotateX(Math.PI / 2).translate(0, h, 0), BK),
        );
        g.add(
          mesh(
            new THREE.TorusGeometry(r * 0.98, 0.04, 4, 12).rotateX(Math.PI / 2).translate(0, h * 0.45, 0),
            PK,
          ),
        );
      },
      { hp: 1, ink: OR },
    );
  const crate = (x, z) =>
    breakable(
      'crate',
      x,
      0,
      z,
      1.1,
      1.1,
      1.1,
      (g) => {
        g.add(mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1).translate(0, 0.55, 0), BL));
        for (const k of [-1, 1])
          g.add(mesh(new THREE.BoxGeometry(1.14, 0.12, 0.12).translate(0, 0.55 + k * 0.35, 0.56), BK));
      },
      { hp: 30, ink: BL },
    );
  const barrel = (x, z) =>
    breakable(
      'barrel',
      x,
      0,
      z,
      1.1,
      1.2,
      1.1,
      (g) => {
        g.add(mesh(new THREE.CylinderGeometry(0.5, 0.45, 1.2, 10).translate(0, 0.6, 0), OR));
        for (const y of [0.25, 0.95])
          g.add(mesh(new THREE.TorusGeometry(0.5, 0.04, 4, 14).rotateX(Math.PI / 2).translate(0, y, 0), BK));
      },
      { hp: 30, ink: OR },
    );
  const cactus = (x, z, h = 2.6) =>
    breakable(
      'cactus',
      x,
      0,
      z,
      0.9,
      h,
      0.9,
      (g) => {
        g.add(mesh(new THREE.CylinderGeometry(0.28, 0.34, h, 8).translate(0, h / 2, 0), GR));
        g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.9, 7).translate(0.6, h * 0.55, 0), GR));
        g.add(
          mesh(
            new THREE.CylinderGeometry(0.17, 0.17, 0.7, 7).rotateZ(Math.PI / 2).translate(0.35, h * 0.38, 0),
            GR,
          ),
        );
        g.add(mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.7, 7).translate(-0.55, h * 0.7, 0), GR));
        g.add(
          mesh(
            new THREE.CylinderGeometry(0.15, 0.15, 0.6, 7).rotateZ(Math.PI / 2).translate(-0.3, h * 0.55, 0),
            GR,
          ),
        );
        g.add(mesh(new THREE.SphereGeometry(0.16, 6, 5).translate(0, h + 0.05, 0), PK));
      },
      { hp: 40, ink: GR },
    );
  // a piñata: a striped donkey hung on a string, bursting with candy
  const pinata = (x, y, z) =>
    breakable(
      'pinata',
      x,
      y,
      z,
      1.1,
      0.9,
      0.6,
      (g) => {
        g.add(mesh(new THREE.BoxGeometry(0.9, 0.5, 0.45).translate(0, 0.55, 0), PK));
        for (const k of [-0.3, 0, 0.3])
          g.add(mesh(new THREE.BoxGeometry(0.1, 0.52, 0.47).translate(k, 0.55, 0), k ? GR : OR));
        g.add(mesh(new THREE.BoxGeometry(0.34, 0.3, 0.3).translate(0.6, 0.72, 0), PK));
        g.add(mesh(new THREE.BoxGeometry(0.1, 0.22, 0.08).translate(0.62, 0.95, 0.1), OR));
        g.add(mesh(new THREE.BoxGeometry(0.1, 0.22, 0.08).translate(0.62, 0.95, -0.1), OR));
        for (const [lx, lz] of [
          [-0.3, 0.15],
          [-0.3, -0.15],
          [0.3, 0.15],
          [0.3, -0.15],
        ])
          g.add(mesh(new THREE.BoxGeometry(0.12, 0.34, 0.12).translate(lx, 0.15, lz), PK));
        g.add(mesh(new THREE.BoxGeometry(0.03, 2.2, 0.03).translate(0, 1.85, 0), BK));
      },
      { hp: 1, ink: PK },
    );

  // ---------------- ground and the mesas around the edge ----------------
  box(0, -1, 0, 2 * P + 10, 1, 2 * P + 10);
  const mesa = (x, z, w, d) => {
    box(x, 0, z, w, 11, d);
    box(x + rand(-1.2, 1.2), 11, z + rand(-1.2, 1.2), w * 0.78, 7, d * 0.78);
    box(x + rand(-1, 1), 18, z + rand(-1, 1), w * 0.5, 5, d * 0.5);
  };
  for (let i = -2; i <= 2; i++) {
    mesa(i * 24, -P, 19, 8);
    mesa(i * 24, P, 19, 8);
    mesa(-P, i * 24, 8, 19);
    mesa(P, i * 24, 8, 19);
  }
  // trails between the mesas are where the doodles come from
  for (let i = -2; i < 2; i++) {
    spawn(i * 24 + 12, 0, -P + 5);
    spawn(i * 24 + 12, 0, P - 5);
    spawn(-P + 5, 0, i * 24 + 12);
    spawn(P - 5, 0, i * 24 + 12);
  }
  // an invisible lid so nobody leaves through the sky; the hook will not bite it
  collider(0, 62, 0, 2 * P + 40, 6, 2 * P + 40, { noNav: true, noGrapple: true });

  // ---------------- the plaza: paving, a fountain, and a sombrero floating above it ----------------
  slab(-24, -24, 24, 24, 0.15, 0.15);
  cyl(0, 0, 0, 5.5, 1.1);
  cyl(0, 1.1, 0, 1.2, 2.6);
  cyl(0, 3.7, 0, 2.4, 0.5);
  sphere(0, 5.4, 0, 0.7, { ink: BL });
  ring(0, 7.2, 0, 'y');
  addGeo(new THREE.CylinderGeometry(5.1, 5.1, 0.08, 20).translate(0, 1.1, 0), BL);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    addGeo(
      new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5)
        .rotateZ(0.35)
        .rotateY(a)
        .translate(Math.cos(a) * 1.7, 5.0, Math.sin(a) * 1.7),
      BL,
    );
  }
  cyl(0, 13, 0, 8, 0.45, { ink: OR });
  cyl(0, 13.45, 0, 3.2, 3, { ink: OR });
  addGeo(new THREE.CylinderGeometry(3.3, 3.3, 0.5, 16).translate(0, 13.9, 0), PK);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    ring(Math.cos(a) * 7.2, 12.2, Math.sin(a) * 7.2, 'y');
  }
  ring(0, 17.5, 0, 'y');

  // ---------------- the bandstand, with a mariachi band that never stops ----------------
  cyl(0, 0, -26, 6.5, 1.2);
  stairs(0, 0, -19.5, '-z', 4, 4.5, { rise: 0.3, run: 0.5 });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + Math.PI / 8;
    cyl(Math.cos(a) * 5.6, 1.2, -26 + Math.sin(a) * 5.6, 0.22, 4.2, { noCollide: true, ink: OR });
  }
  addGeo(new THREE.ConeGeometry(7.6, 3.2, 8).translate(0, 7.0, -26), OR);
  collider(0, 5.4, -26, 9, 0.5, 9, { noNav: true });
  addGeo(new THREE.CylinderGeometry(7.6, 7.6, 0.3, 8).translate(0, 5.55, -26), BL);
  ring(0, 9.4, -26, 'y');
  const mariachi = (x, z, yaw, guitar) => {
    const m = buildHumanoid(
      makeInkMaterial({ ink: BK, shadeScale: 0, shadeBias: 1 }),
      makeInkMaterial({ ink: BK, fill: true, side: THREE.DoubleSide }),
      { weapon: 'rifle', scale: 1, hat: 'none', build: { bodyW: 1.05, headS: 1, limbR: 0.034 } },
    );
    const J = m.J;
    while (J.gun.children.length) J.gun.remove(J.gun.children[0]);
    // sombrero: a wide brim and a tall crown; a guitar or a trumpet in the hands
    const hat = new THREE.Group();
    hat.add(
      mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 14), OR),
      mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.28, 10).translate(0, 0.16, 0), OR),
      mesh(new THREE.TorusGeometry(0.24, 0.03, 4, 12).rotateX(Math.PI / 2).translate(0, 0.06, 0), PK),
    );
    hat.position.y = 0.5;
    J.headG.add(hat);
    if (guitar) {
      J.gun.add(
        mesh(new THREE.BoxGeometry(0.34, 0.12, 0.5).translate(0, 0.02, 0.05), OR),
        mesh(new THREE.BoxGeometry(0.06, 0.05, 0.7).translate(0, 0.06, 0.55), BK),
      );
      J.armR.rotation.x = -0.9;
      J.armL.rotation.x = -1.0;
      J.armL.rotation.y = 0.5;
      J.foreL.rotation.x = -0.9;
    } else {
      J.gun.add(
        mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 0.55, 7).rotateX(Math.PI / 2).translate(0, 0.02, 0.25),
          OR,
        ),
        mesh(
          new THREE.CylinderGeometry(0.14, 0.05, 0.16, 8).rotateX(Math.PI / 2).translate(0, 0.02, 0.55),
          OR,
        ),
      );
      J.armR.rotation.x = -1.6;
      J.armL.rotation.x = -1.5;
      J.armL.rotation.y = 0.4;
      J.foreL.rotation.x = -0.4;
      J.headG.rotation.x = -0.25;
    }
    m.root.position.set(x, 1.2, z);
    m.root.rotation.y = yaw;
    scene.add(m.root);
    L.meshes.push(m.root);
    L.animated.push({
      mesh: m.root,
      update: (t) => {
        const s = Math.sin(t * 6 + x);
        m.root.position.y = 1.2 + Math.max(0, s) * 0.08;
        J.hips.parent.rotation.z = s * 0.04;
        if (guitar) J.foreR.rotation.x = -0.5 + Math.sin(t * 9 + x) * 0.25;
        else J.headG.rotation.z = Math.sin(t * 4 + x) * 0.08;
      },
    });
  };
  mariachi(-2.6, -27.5, 0.4, true);
  mariachi(0, -28.5, 0, false);
  mariachi(2.6, -27.5, -0.4, true);

  // ---------------- the church: a nave, a bell tower you can climb, a domed second tower ----------------
  box(0, 0, 44, 24, 11, 16);
  box(0, 11, 44, 24, 1.6, 4.5);
  box(0, 12.6, 44, 3, 1.2, 3);
  box(0, 13.8, 44, 0.3, 2.2, 0.3);
  box(0, 15.2, 44, 1.4, 0.3, 0.3);
  slab(-7, 33.5, 7, 36.5, 0.8, 0.8);
  box(-3.2, 0, 35.8, 0.5, 5.4, 0.5, { noCollide: true, ink: BK });
  box(3.2, 0, 35.8, 0.5, 5.4, 0.5, { noCollide: true, ink: BK });
  addGeo(new THREE.TorusGeometry(3.2, 0.25, 6, 16, Math.PI).translate(0, 5.4, 35.8), BK);
  for (const x of [-8, 8])
    for (const y of [3, 7]) box(x, y, 35.9, 1.6, 2.2, 0.3, { noCollide: true, ink: BK });
  box(-10, 0, 46, 6, 26, 6);
  for (const [dx, dz] of [
    [-2.5, -2.5],
    [2.5, -2.5],
    [-2.5, 2.5],
    [2.5, 2.5],
  ])
    box(-10 + dx, 26, 46 + dz, 0.6, 4, 0.6);
  box(-10, 30, 46, 7.2, 0.6, 7.2);
  box(-10, 30.6, 46, 0.3, 3, 0.3);
  box(-10, 32.4, 46, 1.6, 0.3, 0.3);
  sphere(-10, 28.2, 46, 0.95, { ink: OR });
  ring(-10, 27.4, 42.2, 'y');
  ring(-10, 33.8, 46, 'y');
  for (const y of [8, 15, 21]) {
    box(-10, y, 42.4, 6, 0.4, 1.3, { ink: OR });
    box(-13.6, y + 3, 46, 1.3, 0.4, 6, { ink: OR });
  }
  box(10, 0, 46, 6, 15, 6);
  sphere(10, 17.4, 46, 3.6, { ink: OR });
  collider(10, 15, 46, 6, 5, 6, { noNav: true });
  box(10, 20.8, 46, 0.3, 2, 0.3);
  ring(10, 21.6, 46, 'y');
  for (const y of [6, 11]) box(13.6, y, 46, 1.3, 0.4, 6, { ink: OR });

  // ---------------- adobe houses east and west, flat roofs with stairs, colored doors ----------------
  const house = (x, z, w, d, h, door, side) => {
    box(x, 0, z, w, h, d);
    box(x, h, z, w + 0.6, 0.35, d + 0.6, { ink: OR });
    rail(x - w / 2, z - d / 2, x + w / 2, z - d / 2, h + 0.35, { ink: OR });
    const dx = side * (w / 2 + 0.01);
    box(x + dx, 0, z, 0.15, 2.6, 1.4, { noCollide: true, ink: door });
    box(x + dx, 2.6, z, 0.15, 0.3, 1.8, { noCollide: true, ink: BK });
    for (const wz of [z - d * 0.32, z + d * 0.32])
      box(x + dx, 1.6, wz, 0.12, 1.1, 1.1, { noCollide: true, ink: BK });
    const n = Math.round(h / 0.3);
    stairs(x - side * (w / 2 + 0.3), 0, z + d / 2 + 0.9, side > 0 ? '+x' : '-x', n, 1.6, {
      rise: h / n,
      run: 0.42,
    });
    box(x, h + 0.35, z + d / 2 - 1.2, 2.2, 0.9, 1.4, { ink: OR });
    ring(x, h + 3.2, z, 'y');
  };
  house(-40, -20, 11, 9, 6, GR, 1);
  house(-40, -4, 9, 8, 5, PK, 1);
  house(-40, 14, 12, 10, 7.5, OR, 1);
  house(40, -18, 12, 9, 7, PK, -1);
  house(40, 0, 9, 8, 5.5, GR, -1);
  house(40, 16, 11, 10, 6.5, OR, -1);
  // strings of papel picado across the plaza, with rings hung along them
  const banner = (x1, y1, z1, x2, y2, z2, n) => {
    for (let i = 0; i <= n; i++) {
      const t = i / n,
        x = x1 + (x2 - x1) * t,
        y = y1 + (y2 - y1) * t - Math.sin(t * Math.PI) * 1.2,
        z = z1 + (z2 - z1) * t;
      if (i < n) {
        const dx = (x2 - x1) / n,
          dz = (z2 - z1) / n;
        addGeo(
          new THREE.BoxGeometry(Math.hypot(dx, dz) + 0.05, 0.05, 0.05)
            .rotateY(-Math.atan2(dz, dx))
            .translate(x + dx / 2, y, z + dz / 2),
          BK,
        );
      }
      if (i % 2 === 1)
        addGeo(
          new THREE.BoxGeometry(0.7, 0.55, 0.02)
            .rotateY(-Math.atan2(z2 - z1, x2 - x1))
            .translate(x, y - 0.32, z),
          [PK, GR, OR][i % 3],
        );
      if (i === Math.floor(n / 2)) ring(x, y - 1.2, z, 'y');
    }
  };
  banner(-34.5, 6.4, -20, -8, 30.6, 42, 22);
  banner(34.5, 7.4, -18, 8, 21.2, 42, 22);
  banner(-34.5, 5.4, -4, 34.5, 5.9, 0, 26);
  banner(-34.5, 7.9, 14, 34.5, 6.9, 16, 26);

  // ---------------- the market: stalls under striped canopies, piñatas hanging, pots and crates about ----------------
  const stall = (x, z, w, d, yaw) => {
    box(x, 0, z, w, 0.9, d);
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      box(x + sx * (w / 2 - 0.15), 0, z + sz * (d / 2 - 0.15), 0.14, 2.9, 0.14, { noCollide: true, ink: BK });
    for (let i = 0; i < 5; i++)
      addGeo(
        new THREE.BoxGeometry(w + 0.6, 0.06, (d + 0.6) / 5).translate(
          x,
          2.95,
          z - (d + 0.6) / 2 + ((i + 0.5) * (d + 0.6)) / 5,
        ),
        i % 2 ? PK : OR,
      );
    collider(x, 2.9, z, w + 0.6, 0.12, d + 0.6, { noNav: true });
  };
  stall(-20, 22, 4.5, 2.4);
  stall(-13, 22, 4.5, 2.4);
  stall(20, 22, 4.5, 2.4);
  stall(13, 22, 4.5, 2.4);
  stall(-24, -12, 2.4, 4.5);
  stall(26, -8, 2.4, 4.5);
  pinata(-20, 1.3, 22);
  pinata(13, 1.3, 22);
  pinata(-24, 1.3, -12);
  pinata(26, 1.3, -8);
  pinata(0, 6.4, 8);
  pinata(-9, 9.5, 12);
  pinata(9, 9.5, 12);
  for (const [x, z] of [
    [-17.5, 24.5],
    [-9.5, 24.5],
    [16.5, 24.5],
    [23.5, 24.5],
    [-27.5, -9],
    [-27.5, -15],
    [29, -5],
    [29, -11],
  ])
    crate(x, z);
  for (const [x, z] of [
    [-33, -14],
    [-33, -12.6],
    [-33, -6],
    [-33, 10],
    [-33, 20],
    [33, -12],
    [33, -3],
    [33, 6],
    [33, 22],
    [-6, 30],
    [6, 30],
    [-18, 31],
    [18, 31],
    [-3, -33],
    [3, -33],
  ])
    pot(x, z, Math.random() < 0.3);
  for (const [x, z] of [
    [-18, -30],
    [18, -30],
    [-30, 30],
    [30, 30],
  ])
    barrel(x, z);

  // ---------------- the taco cart: the best tacos on the page, and where the healing comes from ----------------
  box(24, 0, 4, 3.2, 1.3, 1.6, { ink: OR });
  box(24, 1.3, 4, 3.4, 0.9, 1.8, { ink: BL });
  box(22.5, 0, 4, 0.14, 3.6, 0.14, { noCollide: true, ink: BK });
  box(25.5, 0, 4, 0.14, 3.6, 0.14, { noCollide: true, ink: BK });
  for (let i = 0; i < 4; i++)
    addGeo(new THREE.BoxGeometry(3.6, 0.06, 0.55).translate(24, 3.62, 3 + i * 0.55), i % 2 ? GR : OR);
  addGeo(
    new THREE.CylinderGeometry(0.34, 0.34, 0.14, 12).rotateZ(Math.PI / 2).translate(23.1, 0.34, 3.1),
    BK,
  );
  addGeo(
    new THREE.CylinderGeometry(0.34, 0.34, 0.14, 12).rotateZ(Math.PI / 2).translate(24.9, 0.34, 3.1),
    BK,
  );
  {
    const g = new THREE.CylinderGeometry(0.7, 0.7, 0.35, 12, 1, false, 0, Math.PI);
    g.rotateZ(Math.PI / 2);
    g.rotateX(-Math.PI / 2);
    g.translate(24, 4.6, 4);
    addGeo(g, OR);
    addGeo(new THREE.BoxGeometry(1.3, 0.14, 0.3).translate(24, 4.62, 4), GR);
    addGeo(new THREE.BoxGeometry(1.1, 0.1, 0.2).translate(24, 4.76, 4), BK);
  }
  for (const [x, z] of [
    [22, 6.5],
    [26, 6.5],
    [24, 1.5],
  ])
    pickup(x, 0, z);

  // ---------------- cacti and rocks in the dust outside the plaza ----------------
  for (const [x, z, h] of [
    [-46, -40, 2.8],
    [-50, -28, 2.2],
    [-48, 30, 3.0],
    [-44, 44, 2.4],
    [46, -44, 2.6],
    [50, -30, 2.2],
    [48, 34, 3.2],
    [44, 46, 2.5],
    [-30, -48, 2.8],
    [30, -48, 2.4],
    [-28, 48, 2.6],
    [28, 50, 2.9],
    [12, -44, 2.2],
    [-12, -44, 2.6],
  ])
    cactus(x, z, h);
  for (const [x, z, r] of [
    [-52, -46, 2.2],
    [52, 48, 2.6],
    [-52, 48, 1.8],
    [52, -48, 2.0],
    [0, -52, 1.6],
    [0, 52, 1.6],
  ]) {
    sphere(x, r * 0.55, z, r, { ink: BL });
    collider(x, 0, z, r * 1.5, r * 1.2, r * 1.5);
  }
  // a few low walls and a well for cover between the plaza and the market
  box(-12, 0, -12, 8, 1.1, 0.5, { ink: OR });
  box(12, 0, -12, 8, 1.1, 0.5, { ink: OR });
  box(-30, 0, 34, 0.5, 1.1, 8, { ink: OR });
  box(30, 0, 34, 0.5, 1.1, 8, { ink: OR });
  cyl(-14, 0, 8, 1.3, 1.0);
  box(-14, 1, 8, 0.15, 2.0, 0.15, { noCollide: true, ink: BK });
  box(-14, 3, 8, 2.2, 0.3, 0.3, { noCollide: true, ink: BK });

  // ---------------- where things are: perches, pickups, match spawns ----------------
  for (const [x, y, z] of [
    [-10, 30.6, 46],
    [10, 15, 46],
    [-40, 7.5, 14],
    [40, 7, -18],
    [0, 5.9, -26],
    [0, 13.45, 0],
  ])
    sniper(x, y, z);
  for (const [x, y, z] of [
    [0, 1.25, 8],
    [-20, 0, 0],
    [20, 0, -14],
    [0, 0, -36],
    [-40, 6, -20],
    [40, 5.5, 0],
    [0, 11, 44],
    [0, 13.5, 0],
    [-24, 0, 24],
    [24, 0, 24],
  ])
    pickup(x, y, z);
  for (const [x, y, z] of [
    [-40, 6.2, -20],
    [40, 7.2, -18],
    [-40, 7.7, 14],
    [40, 6.7, 16],
    [0, 11.2, 44],
    [0, 5.6, -26],
    [-46, 0, 0],
    [46, 0, 0],
    [0, 0, -50],
    [-30, 0, 46],
    [30, 0, 46],
    [0, 13.6, 0],
    [-10, 30.8, 46],
  ])
    L.arenaSpawns.push(new THREE.Vector3(x, y, z));

  // ---------------- sky: a fat sun, far mesas, paper planes ----------------
  addGeo(new THREE.SphereGeometry(14, 14, 10).translate(70, 95, -150), OR);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const g = new THREE.BoxGeometry(7, 0.9, 0.9);
    g.rotateZ(a);
    g.translate(70 + Math.cos(a) * 21, 95 + Math.sin(a) * 21, -150);
    addGeo(g, OR);
  }
  for (const [x, z, w, h] of [
    [-120, -160, 60, 30],
    [40, -190, 90, 36],
    [150, -120, 70, 26],
    [-170, 60, 50, 24],
    [160, 90, 80, 30],
    [-60, 190, 100, 34],
  ]) {
    addGeo(new THREE.BoxGeometry(w, h, 30).translate(x, h / 2, z), BL);
    addGeo(new THREE.BoxGeometry(w * 0.6, h * 0.5, 22).translate(x, h + h * 0.25, z), BL);
  }
  planes(3, 30, 26, { rStep: 8, hStep: 6, scale: 1.4 });
  B.finish();
  return L;
}
