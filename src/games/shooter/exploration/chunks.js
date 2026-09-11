import * as THREE from 'three';
import { createBuilder } from '../levels/builder.js';
import { World } from '../physics.js';
import { NavGrid } from '../nav.js';
import { INK, makeInkMaterial } from '../render.js';
import { disposeTree } from '../../../shared/resources.js';
import { sceneOf } from './region.js';
import { enterableBuildings, blockKey } from './interiors.js';
import { buildHouse } from './interior-geometry.js';
import { buildRoadside } from './roadside.js';
import { SIZE, keyOf, address, localPosition } from './schema.js';

function sign(root, text, x, y, z, width, ink, north = false, yaw = 0) {
  if (typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.font = 'bold 64px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 512, 64, 990);
  const texture = new THREE.CanvasTexture(canvas);
  const material = makeInkMaterial({ ink, fill: true, side: THREE.DoubleSide });
  material.uniforms.uSign = { value: texture };
  material.vertexShader =
    'varying vec2 vSign;\n' +
    material.vertexShader.replace('vec3 transformed = position;', 'vSign = uv; vec3 transformed = position;');
  material.fragmentShader =
    'varying vec2 vSign; uniform sampler2D uSign;\n' +
    material.fragmentShader.replace(
      'void main() {',
      'void main() { if(texture2D(uSign, vSign).a < 0.5) discard;',
    );
  material.addEventListener('dispose', () => texture.dispose());
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 8), material);
  mesh.rotation.y = (north ? Math.PI : 0) + yaw;
  mesh.position.set(x, y, z);
  root.add(mesh);
}
function templateExterior(b, a, root) {
  const ink = INK[a.variation.palette.toUpperCase()];
  const front = a.z - a.d / 2;
  b.box(a.x, 0, a.z, a.w, a.h, a.d, { ink });
  b.box(a.x, a.h, a.z, a.w + 0.5, 0.3, a.d + 0.5, { ink: INK.BLACK });
  b.box(a.x, 0, front - 0.04, 2.5, 2.9, 0.06, { noCollide: true, ink: INK.ORANGE });
  for (const offset of [-a.w / 3, a.w / 3]) {
    b.box(a.x + offset, 1.1, front - 0.05, 3.2, 1.8, 0.06, { noCollide: true, ink: INK.BLACK });
    b.box(a.x + offset, 1.2, front - 0.1, 0.1, 1.6, 0.06, { noCollide: true, ink });
  }
  if (a.templateId === 'corner')
    b.box(a.x + a.w / 2 + 0.04, 1.1, a.z, 0.06, 1.8, a.d * 0.6, { noCollide: true, ink: INK.BLACK });
  if (a.variation.decoration === 'awning') b.box(a.x, 3.2, front - 1, a.w - 1, 0.2, 2, { ink });
  if (a.variation.decoration === 'stripes')
    for (let i = -a.w / 2 + 1; i < a.w / 2; i += 2)
      b.box(a.x + i, 3.1, front - 0.1, 0.5, 0.5, 0.1, { ink: INK.ORANGE, noCollide: true });
  sign(root, a.variation.name + ' · ' + a.variation.sign, a.x, 4.1, front - 0.15, a.w - 1, ink, true);
  b.ring(a.door.x, 0.3, a.door.z, 'y');
}
function templateInterior(b, l, root) {
  const ink = INK[l.variation.palette.toUpperCase()];
  for (const a of l.solids) b.box(a.x, 0, a.z, a.w, a.h, a.d, { ink });
  b.slab(64 - l.w / 2, 64 - l.d / 2, 64 + l.w / 2, 64 + l.d / 2, l.h + 0.3, 0.3);
  for (const a of l.furnishings) {
    if (a.kind === 'shelf') {
      b.box(a.x - 0.9, 0, a.z, 0.15, a.h, a.d, { ink });
      b.box(a.x + 0.9, 0, a.z, 0.15, a.h, a.d, { ink });
      for (const y of [0.1, 1, 2]) b.box(a.x, y, a.z, a.w, 0.15, a.d, { ink });
      b.collider(a.x, 0, a.z, a.w, a.h, a.d);
    } else if (a.kind === 'table') {
      b.box(a.x, 0.75, a.z, a.w, 0.15, a.d, { ink });
      for (const x of [-0.7, 0.7])
        for (const z of [-0.7, 0.7]) b.box(a.x + x, 0, a.z + z, 0.15, 0.75, 0.15, { ink });
      b.collider(a.x, 0, a.z, a.w, a.h, a.d);
    } else b.box(a.x, 0, a.z, a.w, a.h, a.d, { ink: INK.ORANGE });
  }
  b.box(64, 0, 64 - l.d / 2 + 0.25, 2.5, 2.8, 0.06, { ink: INK.GREEN, noCollide: true });
  sign(root, 'E 返回街道', 64, 3.5, 64 - l.d / 2 + 0.3, 6, INK.GREEN);
  b.ring(l.entrance[0], 0.25, l.entrance[1], 'y');
}

export function buildChunk(block) {
  const root = new THREE.Group(),
    world = new World();
  const b = createBuilder(root, world),
    l = block.layout;
  if (l.interiorVersion) buildHouse(b, l, root, sign);
  else if (l.interior) b.box(64, -1, 64, SIZE, 1, SIZE);
  else b.collider(64, -1, 64, SIZE, 1, SIZE);
  for (const [x1, z1, x2, z2] of l.interior || l.schemaVersion === 2 ? l.roads : []) {
    b.box((x1 + x2) / 2, 0.002, (z1 + z2) / 2, Math.abs(x2 - x1) + 8, 0.012, Math.abs(z2 - z1) + 8, {
      noCollide: true,
      ink: INK.BLACK,
    });
  }
  if (l.interior && !l.interiorVersion) templateInterior(b, l, root);
  for (const a of l.buildings) {
    if (a.templateId) {
      templateExterior(b, a, root);
      continue;
    }
    b.box(a.x, 0, a.z, a.w, a.h, a.d);
    b.box(a.x, a.h, a.z, a.w, 0.2, a.d, { noCollide: true, ink: INK.ORANGE });
    for (let y = 1.5; y + 1 < a.h; y += 3) {
      b.box(a.x, y, a.z - a.d / 2 - 0.02, Math.min(2, a.w * 0.5), 1.1, 0.05, {
        noCollide: true,
        ink: INK.BLACK,
      });
    }
    b.ring(a.x, a.h + 2, a.z, 'y');
  }
  for (const a of l.cover) b.box(a.x, 0, a.z, a.w, a.h, a.d, { ink: INK.ORANGE });
  for (const a of enterableBuildings(block)) {
    const front = a.z - a.d / 2;
    b.box(a.x, 0, front - 0.07, 2, 2.8, 0.08, { noCollide: true, ink: INK.ORANGE });
    b.box(a.x + 0.65, 1.3, front - 0.15, 0.12, 0.12, 0.12, { noCollide: true, ink: INK.BLACK });
    sign(root, 'E 进入住宅', a.x, 3.15, front - 0.17, 5, INK.ORANGE, true);
  }
  if (!l.interiorVersion) {
    b.ring(l.landmark[0], 4, l.landmark[1], 'y');
    b.ring(l.supply[0], 0.6, l.supply[1], 'y');
  }
  if (l.schemaVersion === 2 && block.x === 0 && block.z === 0) {
    b.box(64, 4, 76, 12, 0.25, 8, { ink: INK.GREEN });
    for (const x of [59, 69]) for (const z of [73, 79]) b.box(x, 0, z, 0.25, 4, 0.25);
    sign(root, '安全营地 · 沿道路探索 · E 进入建筑', 64, 3, 72, 12, INK.GREEN, true);
  }
  b.L.bounds = l.interior
    ? { minX: 64 - l.w / 2 + 1, maxX: 64 + l.w / 2 - 1, minZ: 64 - l.d / 2 + 1, maxZ: 64 + l.d / 2 - 1 }
    : { minX: 0, maxX: SIZE, minZ: 0, maxZ: SIZE };
  buildRoadside(b, block, sign);
  b.finish();
  return { root, world, level: b.L, nav: null };
}

export class Chunks {
  constructor(ctx) {
    this.ctx = ctx;
    this.origin = [0, 0];
    this.loaded = new Map();
    this.barriers = [];
    // A continuous paper ground avoids drawing the streamed chunk rectangle as a world edge.
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(8192, 8192),
      makeInkMaterial({ ink: INK.BLUE, shadeScale: 0, shadeBias: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.01;
    ctx.scene.add(this.ground);
    this.ctx.nav = {
      findPath: (from, to) => {
        const pos = this.address(from),
          item = this.loaded.get(keyOf(pos.cx, pos.cz));
        if (!item) return null;
        if (!item.nav) item.nav = new NavGrid(item.world, item.level.bounds, 2).build();
        const offset = item.root.position;
        const target = to.clone().sub(offset);
        target.x = Math.max(1, Math.min(127, target.x));
        target.z = Math.max(1, Math.min(127, target.z));
        const path = item.nav.findPath(from.clone().sub(offset), target);
        if (path) for (const point of path) point.add(offset);
        return path;
      },
    };
  }
  address(v) {
    return address(v.x, v.y, v.z, this.origin);
  }
  position(p) {
    return new THREE.Vector3(...localPosition(p, this.origin));
  }
  async add(block) {
    const key = blockKey(block);
    if (this.loaded.has(key)) return;
    const item = buildChunk(block);
    Object.assign(item, { block, x: block.x, z: block.z, key });
    this.loaded.set(key, item);
    this.ctx.scene.add(item.root);
    this.rebuild();
  }
  remove(key) {
    const item = this.loaded.get(key);
    if (!item) return;
    disposeTree(item.root);
    this.loaded.delete(key);
  }
  rebuild(allowed = null) {
    const { ctx } = this;
    for (const barrier of this.barriers) disposeTree(barrier);
    this.barriers = [];
    ctx.world.clear();
    const rings = [];
    for (const item of this.loaded.values()) {
      const dx = (item.x - this.origin[0]) * SIZE,
        dz = (item.z - this.origin[1]) * SIZE;
      const dy = item.block.layout.baseY ?? 0;
      item.root.position.set(dx, dy, dz);
      for (const box of item.world.boxes)
        ctx.world.addBox(
          { x: box.min.x + dx, y: box.min.y + dy, z: box.min.z + dz },
          { x: box.max.x + dx, y: box.max.y + dy, z: box.max.z + dz },
          box.data,
        );
      for (const ring of item.level.rings) rings.push(ring.clone().add(item.root.position));
      if (item.block.layout.interiorVersion) continue;
      for (const [ox, oz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const neighbor = keyOf(item.x + ox, item.z + oz);
        if (this.loaded.has(neighbor) && (!allowed || allowed.has(neighbor))) continue;
        const x = dx + 64 + ox * 64,
          z = dz + 64 + oz * 64;
        const w = ox ? 0.4 : 128,
          d = oz ? 0.4 : 128;
        ctx.world.addBox(
          { x: x - w / 2, y: -2, z: z - d / 2 },
          { x: x + w / 2, y: 100, z: z + d / 2 },
          { noGrapple: true, frontier: true },
        );
        // Keep a temporary collision guard until the adjoining saved chunk arrives.
        // No visible blue wall: this is loading state, not the edge of the world.
      }
    }
    ctx.world.finalize();
    ctx.level.rings = rings;
  }
  visible(position) {
    const p = this.address(position);
    this.ground.position.x = position.x;
    this.ground.position.z = position.z;
    const info = this.ctx.exploration?.info;
    const currentScene = sceneOf(p, info);
    this.ground.visible =
      currentScene === 'outdoor' && !this.loaded.get(keyOf(p.cx, p.cz))?.block.layout.interior;
    for (const item of this.loaded.values())
      item.root.visible =
        Math.abs(item.x - p.cx) <= 1 &&
        Math.abs(item.z - p.cz) <= 1 &&
        (!info || currentScene === (item.block.layout.sceneId ?? 'outdoor'));
    for (const b of this.barriers) b.visible = this.loaded.get(b.userData.chunk)?.root.visible ?? false;
  }
  rebase(position, actors) {
    const next = this.address(position);
    if (next.cx === this.origin[0] && next.cz === this.origin[1]) return;
    const shift = new THREE.Vector3((next.cx - this.origin[0]) * SIZE, 0, (next.cz - this.origin[1]) * SIZE);
    this.origin = [next.cx, next.cz];
    const shifted = new Set();
    const move = (v) => {
      if (v?.isVector3 && !shifted.has(v)) {
        v.sub(shift);
        shifted.add(v);
      }
    };
    for (const p of actors) {
      for (const v of [
        p.body.pos,
        p.eye,
        p.center,
        p.root?.position,
        p.camera?.position,
        p.gPoint,
        p.snapA?.p,
        p.snapB?.p,
        p.rope?.position,
        p.hook?.position,
        p.hookMesh?.position,
      ])
        move(v);
      if (p.grapple) for (const key of ['anchor', 'hook', 'from']) move(p.grapple[key]);
      for (const n of p.nades ?? []) {
        move(n.pos);
        move(n.mesh.position);
      }
    }
    for (const e of this.ctx.enemies.enemies) {
      move(e.body.pos);
      move(e.root.position);
      move(e.center);
      move(e.pathGoal);
      for (const v of e.hitSpheres) move(v);
      e.path = null;
    }
    for (const p of this.ctx.enemies.projectiles.list)
      for (const key of ['pos', 'prev', 'origin']) move(p[key]);
    move(this.ctx.level.playerStart);
    this.ctx.effects.clear();
    this.rebuild();
  }
  dispose() {
    disposeTree(this.ground);
    for (const key of [...this.loaded.keys()]) this.remove(key);
    for (const mesh of this.barriers) disposeTree(mesh);
    this.barriers = [];
  }
}
