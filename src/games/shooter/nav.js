// Navigation grid auto-generated from the collision world (multi-level: one node per walkable surface per cell).
import * as THREE from 'three';

const _min = new THREE.Vector3(),
  _max = new THREE.Vector3(),
  _q = [];
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

class Heap {
  constructor() {
    this.a = [];
  }
  push(f, n) {
    const a = this.a;
    a.push([f, n]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

export class NavGrid {
  constructor(world, bounds, cell = 1.0) {
    this.world = world;
    this.cell = cell;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.nx = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    this.nodes = [];
    this.cells = new Array(this.nx * this.nz).fill(null);
    this._gen = null;
    this._searchId = 0;
  }
  build() {
    this.nodes.length = 0;
    this.cells.fill(null);
    this._searchId = 0;
    const w = this.world,
      c = this.cell;
    for (let iz = 0; iz < this.nz; iz++)
      for (let ix = 0; ix < this.nx; ix++) {
        const x = this.minX + (ix + 0.5) * c,
          z = this.minZ + (iz + 0.5) * c;
        _min.set(x - 0.05, -30, z - 0.05);
        _max.set(x + 0.05, 90, z + 0.05);
        w.query(_min, _max, _q);
        if (_q.length === 0) continue;
        const tops = new Set();
        for (const b of _q) if (!b.data.noNav) tops.add(b.max.y);
        for (const y of [...tops].sort((a, b) => a - b)) {
          if (y < -5 || y > 70) continue;
          _min.set(x - 0.3, y + 0.5, z - 0.3);
          _max.set(x + 0.3, y + 1.85, z + 0.3);
          if (w.overlapsAABB(_min, _max)) continue;
          const id = this.nodes.length;
          this.nodes.push({ x, y, z, ix, iz, links: [] });
          const ci = iz * this.nx + ix;
          (this.cells[ci] || (this.cells[ci] = [])).push(id);
        }
      }
    for (const A of this.nodes) {
      for (const [dx, dz] of DIRS) {
        const nix = A.ix + dx,
          niz = A.iz + dz;
        if (nix < 0 || niz < 0 || nix >= this.nx || niz >= this.nz) continue;
        const cand = this.cells[niz * this.nx + nix];
        if (!cand) continue;
        for (const id of cand) {
          const B = this.nodes[id];
          const dy = B.y - A.y;
          if (dy > 1.35 || dy < -8) continue;
          if (
            dx !== 0 &&
            dz !== 0 &&
            (!this._hasNodeNear(A.ix + dx, A.iz, A.y, B.y) || !this._hasNodeNear(A.ix, A.iz + dz, A.y, B.y))
          )
            continue;
          if (!this._linkClear(A, B)) continue;
          if (dy < -0.6 && !this._dropClear(A, B)) continue;
          const horiz = Math.hypot(dx, dz) * c;
          let cost = Math.hypot(horiz, dy);
          if (dy > 0.6) cost *= 1 + dy * 1.1;
          else if (dy < -0.6) cost += -dy * 0.35;
          A.links.push({ to: id, cost, dy });
        }
      }
    }
    this._gen = new Int32Array(this.nodes.length);
    this._g = new Float32Array(this.nodes.length);
    this._from = new Int32Array(this.nodes.length);
    return this;
  }
  _hasNodeNear(ix, iz, y1, y2) {
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return false;
    const cand = this.cells[iz * this.nx + ix];
    if (!cand) return false;
    for (const id of cand) {
      const y = this.nodes[id].y;
      if (Math.abs(y - y1) < 0.75 || Math.abs(y - y2) < 0.75) return true;
    }
    return false;
  }
  _linkClear(A, B) {
    // Start above knee height so the next stair tread does not read as a wall; railings are
    // a metre tall and still block, which is what keeps enemies off balconies they cannot reach.
    const yBase = Math.max(A.y, B.y);
    _min.set(Math.min(A.x, B.x) - 0.25, yBase + 0.5, Math.min(A.z, B.z) - 0.25);
    _max.set(Math.max(A.x, B.x) + 0.25, yBase + 1.7, Math.max(A.z, B.z) + 0.25);
    return !this.world.overlapsAABB(_min, _max);
  }
  _dropClear(A, B) {
    _min.set(B.x - 0.2, B.y + 0.05, B.z - 0.2);
    _max.set(B.x + 0.2, A.y + 0.05, B.z + 0.2);
    return !this.world.overlapsAABB(_min, _max);
  }
  nearestNode(pos, r = 3, maxDy = 4) {
    const c = this.cell;
    const cx = Math.floor((pos.x - this.minX) / c),
      cz = Math.floor((pos.z - this.minZ) / c);
    let best = -1,
      bestS = Infinity,
      bestAny = -1,
      bestAnyS = Infinity;
    for (let iz = cz - r; iz <= cz + r; iz++)
      for (let ix = cx - r; ix <= cx + r; ix++) {
        if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) continue;
        const cand = this.cells[iz * this.nx + ix];
        if (!cand) continue;
        for (const id of cand) {
          const n = this.nodes[id];
          const dy = n.y - pos.y;
          const h = Math.hypot(n.x - pos.x, n.z - pos.z);
          const sAny = h + Math.abs(dy) * 2.0;
          if (sAny < bestAnyS) {
            bestAnyS = sAny;
            bestAny = id;
          }
          if (dy < -maxDy || dy > 2.2) continue;
          const s = h + Math.abs(dy) * 1.5;
          if (s < bestS) {
            bestS = s;
            best = id;
          }
        }
      }
    return best >= 0 ? best : bestAny;
  }
  // A* between two world positions; returns array of Vector3 or null
  findPath(from, to, maxExpand = 40000) {
    const start = this.nearestNode(from, 3, 3),
      goal = this.nearestNode(to, 4, 8);
    if (start < 0 || goal < 0) return null;
    const nodes = this.nodes,
      gen = this._gen,
      g = this._g,
      fromArr = this._from;
    const sid = ++this._searchId;
    const G = nodes[goal];
    const h = (n) => Math.hypot(n.x - G.x, n.y - G.y, n.z - G.z) * 1.15;
    const heap = new Heap();
    gen[start] = sid;
    g[start] = 0;
    fromArr[start] = -1;
    heap.push(h(nodes[start]), start);
    let bestN = start,
      bestH = h(nodes[start]);
    let expanded = 0;
    let found = false;
    const closed = new Set();
    while (heap.size) {
      const [, cur] = heap.pop();
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (cur === goal) {
        found = true;
        bestN = cur;
        break;
      }
      if (++expanded > maxExpand) break;
      const N = nodes[cur];
      const hc = h(N);
      if (hc < bestH) {
        bestH = hc;
        bestN = cur;
      }
      for (const l of N.links) {
        const ng = g[cur] + l.cost;
        if (gen[l.to] !== sid || ng < g[l.to]) {
          gen[l.to] = sid;
          g[l.to] = ng;
          fromArr[l.to] = cur;
          heap.push(ng + h(nodes[l.to]), l.to);
        }
      }
    }
    const path = [];
    let n = bestN;
    while (n >= 0) {
      const nd = nodes[n];
      path.push(new THREE.Vector3(nd.x, nd.y, nd.z));
      n = fromArr[n];
    }
    path.reverse();
    path.complete = found;
    return path;
  }
  randomNode() {
    return this.nodes[Math.floor(Math.random() * this.nodes.length)];
  }
}
