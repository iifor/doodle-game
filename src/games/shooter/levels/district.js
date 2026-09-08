import * as THREE from 'three';
import { INK } from '../render.js';
export function buildDistrict(B, arena = false) {
  const {
    L,
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
    planes,
    addGeo,
    collider,
  } = B;
  // ---------------- ground + perimeter ----------------
  // solo keeps the tight old block; a match gets a far wider arena, a dome and a hanging playground
  const P = arena ? 68 : 55,
    T = 6,
    PH = arena ? 30 : 18,
    E = P - 3.8,
    D = P - 3;
  L.bounds.minX = -P;
  L.bounds.maxX = P;
  L.bounds.minZ = -P;
  L.bounds.maxZ = P;
  box(0, -1, 0, 2 * P + T, 1, 2 * P + T);
  box(0, 0, -P, 2 * P + T, PH, T);
  box(0, 0, P, 2 * P + T, PH, T);
  box(-P, 0, 0, T, PH, 2 * P + T);
  box(P, 0, 0, T, PH, 2 * P + T);
  if (!arena) {
    // solo: the walls carry on upward unseen and unhookable, so their tops are not a place to camp, and a lid closes the sky
    const NG = { noNav: true, noGrapple: true };
    collider(0, PH, -P, 2 * P + T, 40, T, NG);
    collider(0, PH, P, 2 * P + T, 40, T, NG);
    collider(-P, PH, 0, T, 40, 2 * P + T, NG);
    collider(P, PH, 0, T, 40, 2 * P + T, NG);
    collider(0, 56, 0, 2 * P + 40, 8, 2 * P + 40, NG);
    const R = 96,
      C = -22;
    for (let k = 0; k < 6; k++) {
      const g = new THREE.TorusGeometry(R, 0.5, 5, 80, Math.PI);
      g.rotateY((k * Math.PI) / 6);
      g.translate(0, C, 0);
      addGeo(g, INK.BLUE);
    }
    for (const h of [30, 46, 60, 70]) {
      const r = Math.sqrt(R * R - (h - C) * (h - C));
      const g = new THREE.TorusGeometry(r, 0.4, 5, 96);
      g.rotateX(Math.PI / 2);
      g.translate(0, h, 0);
      addGeo(g, INK.BLUE);
    }
  }
  // ledges / balconies on the perimeter (grapple + stand)
  const ledges = [
    [-30, -E, 8, 1.6],
    [30, -E, 8, 1.6],
    [-E, 40, 1.6, 8],
    [E, -10, 1.6, 8],
    [-E, -30, 1.6, 6],
    [E, 35, 1.6, 6],
    [10, E, 8, 1.6],
    [-40, E, 6, 1.6],
  ];
  for (const [x, z, w, d] of ledges) {
    box(x, 9, z, w, 0.4, d);
    box(x, 5.5, z, w, 0.4, d);
    if (arena) {
      box(x, 16, z, w, 0.4, d);
      ring(x, 20, z, 'y');
    }
  }
  // spawn doorways in the perimeter (visual frames)
  const doorFrame = (x, z, alongX) => {
    if (alongX) {
      box(x - 1.2, 0, z, 0.3, 3.2, 0.5, { noCollide: true, ink: INK.BLACK });
      box(x + 1.2, 0, z, 0.3, 3.2, 0.5, { noCollide: true, ink: INK.BLACK });
      box(x, 3.0, z, 2.7, 0.3, 0.5, { noCollide: true, ink: INK.BLACK });
    } else {
      box(x, 0, z - 1.2, 0.5, 3.2, 0.3, { noCollide: true, ink: INK.BLACK });
      box(x, 0, z + 1.2, 0.5, 3.2, 0.3, { noCollide: true, ink: INK.BLACK });
      box(x, 3.0, z, 0.5, 0.3, 2.7, { noCollide: true, ink: INK.BLACK });
    }
  };
  for (const [x, z] of [
    [-D, 0],
    [D, 0],
    [-D, 30],
    [D, -30],
    [-D, -30],
    [D, 30],
  ]) {
    doorFrame(x, z, false);
    spawn(x + (x < 0 ? 1.2 : -1.2), 0, z);
  }
  for (const [x, z] of [
    [0, -D],
    [0, D],
    [-30, D],
    [30, D],
  ]) {
    doorFrame(x, z, true);
    spawn(x, 0, z + (z < 0 ? 1.2 : -1.2));
  }
  if (arena) {
    // where a match drops people in: rooftops, the highway, the field edges and the outer ring
    for (const [x, y, z] of [
      [-34, 12.2, 12],
      [34, 12.2, 12],
      [-30, 7.2, -45],
      [16, 7.2, -45],
      [0, 7.4, -30],
      [-44, 0, -10],
      [44, 0, -10],
      [-40, 0, 40],
      [40, 0, 40],
      [0, 0, 55],
      [-58, 0, 0],
      [58, 0, 0],
      [0, 0, -58],
      [-54, 0, 54],
      [54, 0, -54],
    ])
      L.arenaSpawns.push(new THREE.Vector3(x, y, z));
    // a few low things on the field, nothing to hide a whole person
    box(-8, 0, 20, 3, 1, 1.2);
    box(10, 0, 26, 1.4, 1.2, 1.4);
    box(-12, 0, -8, 2.4, 0.8, 2.4);
    box(14, 0, -4, 2.4, 0.8, 2.4);
    for (const [x, z] of [
      [-56, 30],
      [56, -30],
      [30, -56],
      [-30, 56],
    ]) {
      box(x, 0, z, 0.3, 7, 0.3, { noNav: true });
      box(x, 7, z, 1.4, 0.3, 0.3, { noCollide: true });
      addGeo(new THREE.SphereGeometry(0.45, 8, 6).translate(x + 0.7, 6.8, z), INK.ORANGE);
    }
    // the dome: ribs to look at, plus an invisible shell of bands that stops you and shrugs off the hook
    const R = 120,
      C = -30;
    const domeY = (x, z) => Math.sqrt(Math.max(1, R * R - x * x - z * z)) + C;
    for (let k = 0; k < 8; k++) {
      const g = new THREE.TorusGeometry(R, 0.6, 5, 96, Math.PI);
      g.rotateY((k * Math.PI) / 8);
      g.translate(0, C, 0);
      addGeo(g, INK.BLUE);
    }
    for (const h of [38, 54, 68, 80, 88]) {
      const r = Math.sqrt(R * R - (h - C) * (h - C));
      const g = new THREE.TorusGeometry(r, 0.5, 5, 128);
      g.rotateX(Math.PI / 2);
      g.translate(0, h, 0);
      addGeo(g, INK.BLUE);
    }
    addGeo(new THREE.SphereGeometry(2.4, 10, 8).translate(0, R + C, 0), INK.RED);
    const NG = { noNav: true, noGrapple: true };
    collider(0, 88, 0, 300, 10, 300, NG);
    for (let y0 = PH; y0 < 88; y0 += 4) {
      const inner = Math.sqrt(Math.max(0, R * R - (y0 + 4 - C) ** 2));
      if (inner > P + T) continue;
      const o = inner + 80;
      collider(0, y0, -o, 320, 4, 160, NG);
      collider(0, y0, o, 320, 4, 160, NG);
      collider(-o, y0, 0, 160, 4, 320, NG);
      collider(o, y0, 0, 160, 4, 320, NG);
    }
    // a few pads hung from the dome, spread over the map so a swing has somewhere to land
    const cable = (x, y, z) =>
      box(x, y, z, 0.12, Math.max(1, domeY(x, z) - y), 0.12, { noCollide: true, ink: INK.BLACK });
    const pad = (x, y, z, w, d) => {
      box(x, y, z, w, 0.5, d, { noNav: true });
      cable(x, y + 0.5, z);
      ring(x, y - 1.3, z, 'y');
    };
    for (const [x, y, z, w, d] of [
      [0, 24, 0, 8, 8],
      [-42, 18, -24, 6, 6],
      [44, 21, 30, 6, 6],
      [28, 27, -46, 5, 5],
      [-30, 30, 44, 5, 5],
    ])
      pad(x, y, z, w, d);
    // paper planes big enough to hook: they loop around the map at different heights
    planes(4, 30, 26, { scale: 1.7, rStep: 9, hStep: 6, speed: 0.11, ink: INK.BLUE });
  }

  // ---------------- central tower (solo only: a match wants the field open) ----------------
  if (!arena) {
    const W = 14,
      H = 4,
      hw = W / 2;
    for (let f = 1; f <= 4; f++) slab(-hw, -hw, hw, hw, f * H, 0.4);
    for (const [px, pz] of [
      [-6.6, -6.6],
      [6.6, -6.6],
      [-6.6, 6.6],
      [6.6, 6.6],
      [0, -6.6],
      [0, 6.6],
      [-6.6, 0],
      [6.6, 0],
    ])
      box(px, 0, pz, 0.8, 16, 0.8);
    for (let f = 1; f <= 3; f++) {
      const y = f * H;
      rail(-hw, hw, -1.5, hw, y);
      rail(1.5, hw, hw, hw, y); // south edge with a gap
      rail(-hw, -hw, hw, -hw, y); // west
      rail(hw, -hw, hw, hw, y); // east
      rail(-hw, -hw, -6.5, -hw, y);
      rail(3.5, -hw, hw, -hw, y); // north edge with landing gaps
    }
    // roof parapet with gaps, crane
    rail(-5, -hw, hw, -hw, 16);
    rail(-hw, hw, -1.5, hw, 16);
    rail(1.5, hw, hw, hw, 16);
    rail(-hw, -hw, -hw, hw, 16);
    rail(hw, -hw, hw, 3, 16);
    box(5.5, 16, 5.5, 1, 10, 1);
    box(5.5, 25.2, 5.5, 1.6, 1.4, 1.6, { noCollide: true });
    box(11.5, 25, 5.5, 16, 0.8, 0.8);
    box(1, 25, 5.5, 5, 0.8, 0.8);
    box(-0.5, 23.6, 5.5, 2, 1.6, 1.6);
    box(19, 20.5, 5.5, 0.08, 4.6, 0.08, { noCollide: true, ink: INK.BLACK });
    ring(19, 19.8, 5.5, 'x');
    ring(19.5, 24.6, 5.5, 'z'); // only the crane keeps its rings
    // exterior switchback stairs on the north face (x runs -5..1.3, landings each side)
    // two-lane switchback: flights alternate between lanes so no flight sits directly under the next one
    let y = 0;
    for (let f = 0; f < 4; f++) {
      const dir = f % 2 === 0 ? '+x' : '-x';
      const sx = dir === '+x' ? -5 : 1.3;
      const lane = f % 2 === 0 ? -8.3 : -10.3;
      stairs(sx, y, lane, dir, 14, 1.8);
      y += 4;
      const lx = dir === '+x' ? 2.4 : -6.1;
      slab(lx - 1.1, -11.4, lx + 1.1, -7, y, 0.4);
      rail(lx - 1.1, -11.4, lx + 1.1, -11.4, y);
    }
    spawn(0, 8, 0);
    spawn(0, 4, 3);
    sniper(0, 16, -3);
    pickup(0, 12, 0);
    pickup(-4, 8, 4);
    pickup(0, 16, 0);
  }

  // ---------------- building A (west): 3 floors, fire escape, ruler bridge to the tower ----------------
  {
    const x1 = -43,
      x2 = -25,
      z1 = 4,
      z2 = 20,
      H = 4;
    for (let f = 1; f <= 3; f++) slab(x1, z1, x2, z2, f * H, 0.4);
    // exterior walls with doors/windows
    wallZ(z1, z2, x2, 0, 12, 0.4, [
      [10, 13, 0, 3.2],
      [6, 9, 5, 7],
      [14, 17, 5, 7],
      [6, 9, 9, 11],
      [14, 17, 9, 11],
    ]); // east face
    wallZ(z1, z2, x1, 0, 12, 0.4, [
      [8, 11, 0, 3.2],
      [8, 11, 4.5, 7.5],
      [8, 11, 8.5, 11.5],
    ]); // west face
    wallX(x1, x2, z1, 0, 12, 0.4, [
      [-36, -33, 0, 3.2],
      [-40, -37, 5, 7],
      [-31, -28, 5, 7],
      [-36, -32, 8.5, 11.5],
    ]); // north face
    wallX(x1, x2, z2, 0, 12, 0.4, [
      [-36, -32, 0, 3.2],
      [-31, -27, 0, 3.2],
      [-42, -39, 0, 3.2],
      [-37.2, -33.5, 4.05, 7.2],
      [-36, -32, 8.4, 11.4],
      [-41, -27, 4.6, 7.6],
      [-29, -25.5, 8.05, 11.2],
    ]); // south face
    // interior partitions
    wallX(x1, x2, 12, 0, 4, 0.3, [
      [-40, -37.5],
      [-30, -27.5],
    ]);
    wallX(x1, x2, 12, 4, 4, 0.3, [[-36, -32]]);
    wallZ(z1, z2, -34, 8, 4, 0.3, [
      [8, 11],
      [14, 17],
    ]);
    // roof parapet with gaps
    rail(x1, z1, -37, z1, 12);
    rail(-31, z1, x2, z1, 12);
    rail(x1, z2, -37.4, z2, 12);
    rail(-34.4, z2, x2, z2, 12);
    rail(x1, z1, x1, z2, 12);
    rail(x2, z1, x2, 9, 12);
    rail(x2, 15, x2, z2, 12);
    // fire escape: switchback on the south face (z 21..23)
    let y = 0;
    for (let f = 0; f < 3; f++) {
      const dir = f % 2 === 0 ? '-x' : '+x';
      const sx = dir === '-x' ? -28.5 : -34.8;
      const lane = f % 2 === 0 ? 21.2 : 23.2;
      stairs(sx, y, lane, dir, 14, 1.8);
      y += 4;
      const lx = dir === '-x' ? -35.9 : -27.4;
      slab(lx - 1.1, 20.2, lx + 1.1, 24.4, y, 0.4);
      rail(lx - 1.1, 24.4, lx + 1.1, 24.4, y);
    }
    // ruler bridge from the A roof: to the tower's third floor in solo, right across to building B in a match (y=12)
    {
      const bx2 = arena ? 24.2 : -7;
      const len = bx2 + 25.2;
      box((bx2 - 25.2) / 2, 11.6, 6, len, 0.4, 2.4, { ink: INK.ORANGE });
      for (let i = 0; i <= Math.floor(len); i++)
        box(-25 + i, 12, 5, 0.06, 0.02, i % 5 === 0 ? 0.6 : 0.35, { noCollide: true, ink: INK.BLACK });
      rail(-25, 7.2, bx2, 7.2, 12, { ink: INK.ORANGE });
      if (arena) rail(-25, 4.8, bx2, 4.8, 12, { ink: INK.ORANGE });
    }

    spawn(-34, 12, 12);
    spawn(-40, 0, 18);
    sniper(-27, 12, 6);
    pickup(-34, 4, 12);
    pickup(-30, 12, 16);
    pickup(-40, 8, 8);
  }

  // ---------------- building B (east): warehouse with catwalk + skylight ----------------
  {
    const x1 = 24,
      x2 = 44,
      z1 = 4,
      z2 = 20;
    // roof with a 6x6 skylight hole in the middle
    slab(x1, z1, x2, 9, 12, 0.4);
    slab(x1, 15, x2, z2, 12, 0.4);
    slab(x1, 9, 31, 15, 12, 0.4);
    slab(37, 9, x2, 15, 12, 0.4);
    wallZ(z1, z2, x1, 0, 12, 0.4, [
      [10, 14, 0, 3.6],
      [6, 9, 7, 10],
      [15, 18, 7, 10],
    ]); // west face
    wallZ(z1, z2, x2, 0, 12, 0.4, [
      [7, 10, 0, 3.2],
      [14, 17, 0, 3.2],
      [8, 16, 7, 10],
    ]); // east face
    wallX(x1, x2, z1, 0, 12, 0.4, [
      [32, 36, 0, 3.6],
      [27, 30, 7, 10],
      [38, 41, 7, 10],
    ]); // north face
    wallX(x1, x2, z2, 0, 12, 0.4, [
      [26, 29, 0, 3.2],
      [39, 42, 0, 3.2],
      [33.5, 36.5, 4.05, 7.2],
      [25.5, 28.5, 8.05, 11.2],
      [32, 36, 8, 11],
    ]); // south face
    // catwalk at y=6 around the inside walls (1.6 wide), interior stairs along the west wall
    slab(x1 + 0.4, z1 + 0.4, x1 + 2, z2 - 0.4, 6, 0.3);
    slab(x2 - 2, z1 + 0.4, x2 - 0.4, z2 - 0.4, 6, 0.3);
    slab(x1 + 2, z1 + 0.4, x2 - 2, z1 + 2, 6, 0.3);
    slab(x1 + 2, z2 - 2, x2 - 2, z2 - 0.4, 6, 0.3);
    rail(x1 + 2, z1 + 2, x1 + 2, 9, 6);
    rail(x1 + 2, 15, x1 + 2, 17, 6);
    rail(x2 - 2, z1 + 2, x2 - 2, z2 - 2, 6);
    rail(x1 + 2, z1 + 2, 31, z1 + 2, 6);
    rail(37, z1 + 2, x2 - 2, z1 + 2, 6);
    rail(x1 + 2, z2 - 2, x2 - 2, z2 - 2, 6);
    stairs(26.2, 0, 8.6, '+z', 21, 1.6, { rise: 6 / 21, run: 0.45 }); // arrives at z=18.05, y=6 onto the catwalk
    // crates inside
    box(34, 0, 12, 2.4, 2.4, 2.4);
    box(36.4, 0, 12, 2.4, 1.2, 2.4);
    box(30, 0, 16, 1.6, 1.6, 1.6, { ink: INK.GREEN });
    // exterior switchback on the south face to the roof (z 21..23)
    let y = 0;
    for (let f = 0; f < 3; f++) {
      const dir = f % 2 === 0 ? '+x' : '-x';
      const sx = dir === '+x' ? 27.5 : 33.8;
      const lane = f % 2 === 0 ? 21.2 : 23.2;
      stairs(sx, y, lane, dir, 14, 1.8);
      y += 4;
      const lx = dir === '+x' ? 34.9 : 26.4;
      slab(lx - 1.1, 20.2, lx + 1.1, 24.4, y, 0.4);
      rail(lx - 1.1, 24.4, lx + 1.1, 24.4, y);
    }
    rail(x1, z1, 31, z1, 12);
    rail(37, z1, x2, z1, 12);
    rail(x1, z2, 33.4, z2, 12);
    rail(36.4, z2, x2, z2, 12);
    rail(x2, z1, x2, z2, 12);
    rail(x1, z1, x1, 9, 12);
    rail(x1, 15, x1, z2, 12);
    // plank bridge tower floor 3 -> B roof
    box(15.5, 11.6, 6, 17.4, 0.4, 2.2);
    rail(7, 4.9, 24, 4.9, 12);

    spawn(34, 12, 18);
    spawn(40, 0, 8);
    sniper(26, 12, 18);
    pickup(34, 0, 12);
    pickup(34, 6, 19);
    pickup(42, 12, 6);
  }

  // ---------------- highway ----------------
  {
    const z = -30,
      y = 7;
    slab(-52, z - 4.5, 52, z + 4.5, y, 0.6);
    wallX(-52, 52, z - 4.3, y, 0.9, 0.4, [
      [-33, -29],
      [27, 31],
      [-2, 2],
    ]); // north barrier gaps: bridges to houses
    wallX(-52, 52, z + 4.3, y, 0.9, 0.4, [
      [-36.5, -33],
      [33, 36.5],
    ]); // south barrier gaps: stairs
    for (let x = -48; x <= 48; x += 12) box(x, 0, z, 1.4, 6.4, 1.4);
    stairs(-46.5, 0, z + 5.5, '+x', 25, 2, { rise: 0.28, run: 0.45 });
    stairs(46.5, 0, z + 5.5, '-x', 25, 2, { rise: 0.28, run: 0.45 });

    // road markings
    for (let x = -50; x < 50; x += 4) box(x + 1, y, z, 2, 0.02, 0.2, { noCollide: true, ink: INK.BLACK });
    spawn(-48, y, z);
    spawn(48, y, z);
    sniper(0, y, z);
    pickup(-10, y, z);
    pickup(24, y, z);
  }

  // ---------------- row houses (north) ----------------
  {
    const z = -45;
    box(-30, 0, z, 14, 7, 10);
    box(-8, 0, z, 14, 11, 10);
    box(16, 0, z, 14, 7, 10);
    // bridges from the highway to house 1 and house 3 (y=7)
    box(-31, 6.7, -37.25, 2.6, 0.3, 5.5);
    box(29, 6.7, -37.25, 2.6, 0.3, 5.5);
    box(0, 6.7, -37.25, 2.6, 0.3, 5.5);
    rail(-32.3, -40, -32.3, -34.5, 7);
    rail(-29.7, -40, -29.7, -34.5, 7);
    rail(27.7, -40, 27.7, -34.5, 7);
    rail(30.3, -40, 30.3, -34.5, 7);
    // stairs house1 roof -> house2 roof (over the gap)
    stairs(-23, 7, z, '+x', 14, 2.2);
    slab(-16.9, z - 1.1, -15, z + 1.1, 11, 0.4);
    // stairs house3 roof -> house2 roof
    stairs(9, 7, z, '-x', 14, 2.2);
    slab(-1, z - 1.1, 2.9, z + 1.1, 11, 0.4);
    // chimneys, water tank, doodle antenna
    box(-33, 7, z - 3, 1.2, 1.6, 1.2);
    box(19, 7, z + 3, 1.2, 1.4, 1.2);
    cyl(-10, 11, z - 2.5, 1.4, 2.6, { seg: 14 });
    box(-5, 11, z + 3, 0.1, 4, 0.1, { noCollide: true, ink: INK.BLACK });

    spawn(-8, 11, z);
    spawn(-30, 7, z - 3);
    spawn(16, 7, z);
    sniper(-8, 11, z - 3);
    sniper(16, 7, z + 2);
    pickup(-8, 11, z + 2);
    pickup(-30, 7, z);
  }

  // ---------------- south plaza: containers, crates, bus, doodle props (solo only) ----------------
  if (!arena) {
    box(-14, 0, 34, 2.5, 2.6, 6.2, { ink: INK.GREEN });
    box(-14, 2.6, 34, 2.5, 2.6, 6.2, { ink: INK.ORANGE });
    box(14, 0, 36, 6.2, 2.6, 2.5);
    box(17, 2.6, 36, 3, 2.6, 2.5, { ink: INK.GREEN });
    box(-6, 0, 28, 1.4, 1.4, 1.4);
    box(-4.5, 0, 28.5, 1.2, 1.2, 1.2);
    box(-5.3, 1.4, 28.2, 1.0, 1.0, 1.0);
    box(8, 0, 26, 1.6, 1.6, 1.6);
    box(9.6, 0, 26.4, 1.2, 1.2, 1.2);
    // bus
    box(24, 0.6, 40, 11, 3.2, 2.8);
    box(24, 0, 40, 10, 0.6, 2.6, { noCollide: true });
    for (const x of [20, 28]) {
      cyl(x, 0, 41.5, 0.55, 0.4, { noCollide: true, seg: 10, ink: INK.BLACK });
      cyl(x, 0, 38.5, 0.55, 0.4, { noCollide: true, seg: 10, ink: INK.BLACK });
    }
    // giant pencil lying on the ground (orange body, black tip, pink eraser)
    {
      const g = new THREE.CylinderGeometry(0.8, 0.8, 16, 6);
      g.rotateZ(Math.PI / 2);
      g.translate(-30, 0.8, 44);
      addGeo(g, INK.ORANGE);
      collider(-30, 0, 44, 16, 1.6, 1.6);
      const tip = new THREE.ConeGeometry(0.8, 2.4, 6);
      tip.rotateZ(-Math.PI / 2);
      tip.translate(-20.8, 0.8, 44);
      addGeo(tip, INK.BLACK);
      collider(-20.8, 0, 44, 2.4, 1.6, 1.6);
      const er = new THREE.CylinderGeometry(0.82, 0.82, 1.6, 8);
      er.rotateZ(Math.PI / 2);
      er.translate(-38.8, 0.8, 44);
      addGeo(er, INK.PINK);
      collider(-38.8, 0, 44, 1.6, 1.64, 1.64);
    }
    // giant eraser block (pink) + coffee mug (blue) props to climb
    box(38, 0, 40, 6, 2.2, 3.2, { ink: INK.PINK });
    box(38, 2.2, 40, 6, 0.8, 3.2, { ink: INK.BLUE });
    cyl(-40, 0, 32, 2.6, 3.4, { seg: 16 });
    {
      const h = new THREE.TorusGeometry(1.4, 0.35, 8, 16);
      h.translate(-36.6, 1.8, 32);
      addGeo(h, INK.BLUE);
    }
    // lamp posts + benches
    for (const [x, z] of [
      [-10, 46],
      [10, 46],
      [-22, 24],
      [22, 24],
    ]) {
      box(x, 0, z, 0.25, 6, 0.25);
      box(x, 6, z, 1.4, 0.3, 0.5, { noCollide: true });
    }
    for (const [x, z] of [
      [-4, 46],
      [4, 46],
    ]) {
      box(x, 0.4, z, 3, 0.15, 0.6);
      box(x, 0, z, 2.6, 0.4, 0.2, { noCollide: true });
    }
    pickup(-6, 0, 36);
    pickup(6, 0, 36);
    pickup(-30, 1.6, 44);
    pickup(38, 3, 40);
    pickup(0, 0, 10);
    // scattered cover in the open middle areas
    box(-16, 0, -8, 2.2, 1.2, 2.2);
    box(18, 0, -10, 2.2, 1.6, 2.2);
    box(-20, 0, 8, 1.6, 1.0, 3);
    box(20, 0, -2, 3, 1.0, 1.6);
    box(-8, 0, -18, 4, 1.1, 1.2);
    box(8, 0, -18, 4, 1.1, 1.2);
    box(0, 0, 22, 5, 0.5, 1.4);
    box(-24, 0, -18, 2.4, 2.6, 2.4, { ink: INK.ORANGE });
    box(26, 0, -18, 2.4, 2.6, 2.4, { ink: INK.GREEN });
  }

  // ---------------- sky doodles ----------------
  {
    sphere(-90, 110, -160, 12, { seg: 12 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const g = new THREE.BoxGeometry(6, 0.7, 0.7);
      g.rotateZ(a);
      g.translate(-90 + Math.cos(a) * 19, 110 + Math.sin(a) * 19, -160);
      addGeo(g, INK.BLUE);
    }
    for (const [cx, cy, cz, s] of [
      [60, 70, -170, 1],
      [-20, 75, -190, 1.3],
      [140, 60, -80, 0.9],
      [-150, 65, 40, 1.1],
      [30, 80, 180, 1.2],
      [-90, 60, 170, 0.8],
    ]) {
      for (let i = 0; i < 6; i++)
        sphere(cx + (i - 2.5) * 5 * s, cy + Math.sin(i * 1.7) * 2.5 * s, cz, (4 + (i % 3)) * s, { seg: 10 });
    }
  }

  L.teamSpawns = [
    [-40, 0, 18],
    [-34, 12, 12],
    [-48, 7, -30],
    [-52, 0, 30],
    [-30, 7, -48],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  L.teamSpawns = [
    L.teamSpawns,
    [
      [40, 0, 8],
      [34, 12, 18],
      [48, 7, -30],
      [52, 0, 30],
      [16, 7, -45],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  ];
  if (!arena) planes(3, 30, 30, { rStep: 8, hStep: 6, scale: 1.4 });
  return B.finish();
}
