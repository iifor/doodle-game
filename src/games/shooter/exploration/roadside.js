import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { INK, makeInkMaterial } from '../render.js';
import { hash } from './schema.js';
import { enterableBuildings } from './interiors.js';

const overlaps = (a, b, gap = 0) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + gap;
const roadRect = ([a, b, c, d]) => ({
  x: (a + c) / 2,
  z: (b + d) / 2,
  w: Math.abs(c - a) + 8,
  d: Math.abs(d - b) + 8,
});
const cell = (x, z) =>
  Math.max(0, Math.min(63, Math.floor(z / 2))) * 64 + Math.max(0, Math.min(63, Math.floor(x / 2)));

// Reserve actual paths through the original street, including doors away from roads.
// These paths cannot be occupied by newly added solid scenery.
function accessPaths(layout, goals) {
  const obstacles = [...layout.buildings, ...layout.cover],
    previous = new Int32Array(4096).fill(-1);
  const start = cell(layout.roads[0][0], layout.roads[0][1]),
    queue = [start];
  previous[start] = start;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i],
      x = current % 64,
      z = Math.floor(current / 64);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        nz = z + dz,
        next = nz * 64 + nx;
      if (nx < 0 || nz < 0 || nx >= 64 || nz >= 64 || previous[next] !== -1) continue;
      if (obstacles.some((o) => overlaps({ x: nx * 2 + 1, z: nz * 2 + 1, w: 0, d: 0 }, o, 0.7))) continue;
      previous[next] = current;
      queue.push(next);
    }
  }
  const reserved = new Set();
  for (const [x, z] of goals) {
    let current = cell(x, z);
    // A doorway can sit between grid cells; use its closest reachable neighbour.
    if (previous[current] === -1) {
      let distance = Infinity;
      for (const c of queue) {
        const d = Math.hypot((c % 64) * 2 + 1 - x, Math.floor(c / 64) * 2 + 1 - z);
        if (d < distance) {
          distance = d;
          current = c;
        }
      }
    }
    while (!reserved.has(current)) {
      reserved.add(current);
      if (current === start) break;
      current = previous[current];
    }
  }
  return [...reserved].map((c) => [(c % 64) * 2 + 1, Math.floor(c / 64) * 2 + 1]);
}

export function roadsidePlan(block) {
  const l = block.layout;
  if (l.interior || l.interiorVersion || l.schemaVersion === 2) return [];
  let state = hash(
    `roadside-v1:${block.x},${block.z}:${JSON.stringify([l.name, l.roads, l.buildings, l.cover])}`,
  );
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const goals = [
    l.landmark,
    l.supply,
    ...(l.outpost ? [l.outpost.center, ...l.outpost.spawns] : [[64, 64]]),
    ...enterableBuildings(block).map((b) => [b.door.x, b.door.z]),
  ];
  const paths = accessPaths(l, goals),
    roads = l.roads.map(roadRect),
    obstacles = [...l.buildings, ...l.cover],
    items = [];
  const kinds = ['puddle', 'barrier', 'sign', 'mound', 'rock', 'grass'];
  const count = 44 + Math.floor(random() * 21);
  for (let attempt = 0; attempt < 900 && items.length < count; attempt++) {
    const kind = kinds[items.length % kinds.length],
      road = l.roads[Math.floor(random() * l.roads.length)];
    const horizontal = road[1] === road[3];
    let x = 10 + random() * 108,
      z = 10 + random() * 108;
    if (random() < 0.7) {
      const t = 0.08 + random() * 0.84,
        offset = (random() < 0.5 ? -1 : 1) * (kind === 'puddle' ? 2 + random() * 3 : 7 + random() * 7);
      x = road[0] + (road[2] - road[0]) * t + (horizontal ? 0 : offset);
      z = road[1] + (road[3] - road[1]) * t + (horizontal ? offset : 0);
    }
    x = Math.round(x * 2) / 2;
    z = Math.round(z * 2) / 2;
    const size = 0.8 + random() * 0.5;
    const dims = {
      puddle: [4.5, 3],
      barrier: horizontal ? [3.2, 1] : [1, 3.2],
      sign: [3.4, 1],
      mound: [5.5, 4.5],
      rock: [1.8, 1.6],
      grass: [2, 2],
    }[kind];
    const item = {
      kind,
      x,
      z,
      w: dims[0] * size,
      d: dims[1] * size,
      h: kind === 'mound' ? 0.8 + Math.floor(random() * 3) * 0.2 : 1,
      horizontal,
      variant: Math.floor(random() * 4),
    };
    if (x - item.w / 2 < 6 || x + item.w / 2 > 122 || z - item.d / 2 < 6 || z + item.d / 2 > 122) continue;
    if (obstacles.some((o) => overlaps(item, o, 1.4)) || items.some((o) => overlaps(item, o, 1.5))) continue;
    if (goals.some(([a, b]) => overlaps(item, { x: a, z: b, w: 0, d: 0 }, 4))) continue;
    if (
      kind !== 'puddle' &&
      kind !== 'grass' &&
      (roads.some((o) => overlaps(item, o, 0.8)) ||
        paths.some(([a, b]) => overlaps(item, { x: a, z: b, w: 0, d: 0 }, 1.5)))
    )
      continue;
    items.push(item);
  }
  return items;
}

export function buildRoadside(b, block, sign) {
  const l = block.layout;
  if (l.interior || l.interiorVersion || l.schemaVersion === 2) return;
  const surfaces = new Map();
  const surface = (geo, ink) => {
    if (!surfaces.has(ink)) surfaces.set(ink, []);
    surfaces.get(ink).push(geo);
  };
  const paint = (x, z, w, d, y, ink) => {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(x, y, z);
    surface(g, ink);
  };
  const patch = (a, scale, y, ink) => {
    const shape = new THREE.Shape();
    for (let i = 0; i <= 16; i++) {
      const angle = (i / 16) * Math.PI * 2,
        rough = 0.9 + 0.1 * Math.sin(angle * 3 + a.variant);
      const x = ((Math.cos(angle) * a.w) / 2) * scale * rough,
        z = ((Math.sin(angle) * a.d) / 2) * scale * rough;
      if (i === 0) shape.moveTo(x, z);
      else shape.lineTo(x, z);
    }
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(a.x, y, a.z);
    surface(g, ink);
  };
  for (const [index, road] of l.roads.entries()) {
    const r = roadRect(road),
      horizontal = road[1] === road[3];
    paint(r.x, r.z, r.w, r.d, 0.025, INK.BLACK);
    const lo = Math.min(horizontal ? road[0] : road[1], horizontal ? road[2] : road[3]);
    const hi = Math.max(horizontal ? road[0] : road[1], horizontal ? road[2] : road[3]);
    for (let along = Math.ceil((lo - 4) / 8) * 8 + 2; along < hi + 4; along += 8) {
      const x = horizontal ? along : r.x,
        z = horizontal ? r.z : along;
      if (
        l.roads.some(
          (other, i) =>
            i !== index &&
            (other[1] === other[3]) !== horizontal &&
            overlaps({ x, z, w: 1, d: 1 }, roadRect(other)),
        )
      )
        continue;
      paint(x, z, horizontal ? 3 : 0.16, horizontal ? 0.16 : 3, 0.04, INK.GOLD);
    }
    // Set back from both endpoints so pedestrian crossings do not fill junctions.
    if (hi - lo >= 28) {
      const along = lo + 12;
      for (let offset = -2.8; offset <= 2.8; offset += 1.1)
        paint(
          horizontal ? along : r.x + offset,
          horizontal ? r.z + offset : along,
          horizontal ? 2.2 : 0.5,
          horizontal ? 0.5 : 2.2,
          0.042,
          INK.ORANGE,
        );
    }
  }
  const items = roadsidePlan(block);
  b.L.roadside = items;
  for (const a of items) {
    const { x, z, w, d } = a;
    if (a.kind === 'puddle') {
      patch(a, 1.08, 0.052, INK.TEAL);
      patch(a, 1, 0.058, INK.CYAN);
      for (let i = 0; i < 3; i++)
        paint(
          x - w * 0.15 + i * 0.3,
          z - d * 0.22 + i * d * 0.18,
          w * (0.35 - i * 0.07),
          0.045,
          0.065,
          INK.BLUE,
        );
    } else if (a.kind === 'mound') {
      patch(a, 1.12, 0.023, INK.BROWN);
      for (let layer = 0; layer < Math.round(a.h / 0.2); layer++) {
        const scale = 1 - layer * 0.12;
        const soil = new THREE.BoxGeometry(w * scale, 0.2, d * scale);
        soil.translate(x, layer * 0.2 + 0.1, z);
        surface(soil, INK.BROWN);
        b.collider(x, layer * 0.2, z, w * scale, 0.2, d * scale, { tag: 'roadside-mound' });
      }
    } else if (a.kind === 'barrier') {
      b.box(x, 0, z, w, 0.28, d, { ink: INK.BLACK, tag: 'roadside-barrier' });
      b.box(x, 0.28, z, w * 0.9, 0.7, d * 0.8, { ink: INK.ORANGE, tag: 'roadside-barrier' });
      for (let i = -1; i <= 1; i++)
        b.box(
          x + (a.horizontal ? (i * w) / 3 : 0),
          0.52,
          z + (a.horizontal ? 0 : (i * d) / 3),
          a.horizontal ? 0.3 : w * 0.84,
          0.23,
          a.horizontal ? d * 0.84 : 0.3,
          { ink: INK.BLACK, noCollide: true },
        );
    } else if (a.kind === 'sign') {
      b.box(x, 0, z, 0.16, 2.6, 0.16, { ink: INK.BLACK, noCollide: true });
      b.box(x, 1.9, z, w, 0.75, 0.16, { ink: INK.GREEN, noCollide: true });
      b.collider(x, 0, z, 0.2, 2.6, 0.2, { tag: 'roadside-sign' });
      sign(
        b.scene,
        ['前方路口', '住宅区', '施工慢行', '沿路探索'][a.variant],
        x,
        2.27,
        z - 0.09,
        w * 0.9,
        INK.GREEN,
        true,
      );
      sign(
        b.scene,
        ['前方路口', '住宅区', '施工慢行', '沿路探索'][a.variant],
        x,
        2.27,
        z + 0.09,
        w * 0.9,
        INK.GREEN,
      );
    } else if (a.kind === 'rock') {
      b.box(x, 0, z, w, 0.35, d, { ink: INK.BROWN, tag: 'roadside-rock' });
      b.box(x + w * 0.1, 0.35, z, w * 0.55, 0.28, d * 0.6, { ink: INK.BLACK, tag: 'roadside-rock' });
    } else {
      for (let i = -1; i <= 1; i++) {
        b.box(x + (i * w) / 3, 0, z + (i * d) / 5, 0.045, 0.25 + (i + 1) * 0.13, 0.06, {
          ink: INK.GREEN,
          noCollide: true,
        });
        b.box(x + (i * w) / 3 + 0.13, 0, z + (i * d) / 5, 0.045, 0.18, 0.06, {
          ink: INK.TEAL,
          noCollide: true,
        });
      }
    }
  }
  // Batch painted surfaces by ink; streaming another region does not add one draw per prop.
  for (const [ink, geos] of surfaces) {
    const geometry = mergeGeometries(geos, false);
    for (const geo of geos) geo.dispose();
    const mesh = new THREE.Mesh(geometry, makeInkMaterial({ ink, fill: true }));
    mesh.matrixAutoUpdate = false;
    b.scene.add(mesh);
    b.L.meshes.push(mesh);
  }
}
