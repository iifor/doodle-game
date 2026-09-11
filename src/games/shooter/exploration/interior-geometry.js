import { INK } from '../render.js';
import { ROOM_NAMES, corridorBounds } from './interiors.js';
import { hash } from './schema.js';

// Every room opens onto a clear, continuous corridor. Furniture stays clear of the
// doorway; the stair opening and its landings are kept free on all floors.
export function buildHouse(b, l, root, sign) {
  const p = l.plan,
    ink = INK[p.palette.toUpperCase()];
  const c = corridorBounds(p);
  const { x0, x1 } = c;
  const z0 = 64 - p.depth / 2,
    z1 = 64 + p.depth / 2;
  const start = z0 + 5,
    end = start + 6.3;
  const [hx0, hx1] = c.hole;
  // Arrangements are drawn from the scene id, so revisiting a house looks the same.
  const variant = (f, side, i) => hash(`${l.sceneId}:${f}:${side}:${i}`);
  for (let f = 0; f < p.floors.length; f++) {
    const y = f * 4;
    if (f === 0) b.slab(x0, z0, x1, z1, y, 0.3);
    else {
      if (hx0 - x0 > 0.05) b.slab(x0, z0, hx0, z1, y, 0.3);
      if (x1 - hx1 > 0.05) b.slab(hx1, z0, x1, z1, y, 0.3);
      b.slab(hx0, z0, hx1, start, y, 0.3);
      b.slab(hx0, end, hx1, z1, y, 0.3);
      b.rail(hx0, start, hx0, end, y);
      b.rail(hx1, start, hx1, end, y);
    }
    b.wallX(x0, x1, z0, y, 4, 0.25, [], { ink });
    b.wallX(x0, x1, z1, y, 4, 0.25, [], { ink });
    for (const side of ['left', 'right']) {
      const rooms = p.floors[f][side];
      const outerX = side === 'left' ? x0 : x1;
      const innerX = side === 'left' ? c.lo : c.hi;
      const window = (mid, gaps) => {
        gaps.push([mid - 1.5, mid + 1.5, 1.2, 2.9]);
        // A window opening with mullions and an invisible pane collision.
        b.box(outerX, y + 1.2, mid, 0.3, 1.7, 0.07, { ink });
        b.box(outerX, y + 2, mid, 0.3, 0.07, 3, { ink });
        b.collider(outerX, y + 1.2, mid, 0.25, 1.7, 3, { noGrapple: true });
      };
      if (!rooms.length) {
        // The corridor runs against this wall, so it carries daylight and no partitions.
        const windowGaps = [];
        for (let i = 0; i < 3; i++) window(z0 + (p.depth * (i + 0.5)) / 3, windowGaps);
        b.wallZ(z0, z1, outerX, y, 4, 0.25, windowGaps, { ink });
        continue;
      }
      const a = Math.min(innerX, outerX),
        e = Math.max(innerX, outerX);
      const inward = Math.sign(outerX - innerX);
      const doorGaps = [],
        windowGaps = [];
      for (let i = 0; i < rooms.length; i++) {
        const room = rooms[i];
        const back = z0 + (p.depth * i) / rooms.length;
        const front = z0 + (p.depth * (i + 1)) / rooms.length;
        const mid = (back + front) / 2;
        doorGaps.push([mid - 1, mid + 1, 0, 2.9]);
        if (room.window) window(mid, windowGaps);
        if (i < rooms.length - 1)
          b.wallX(
            a,
            e,
            front,
            y,
            4,
            0.2,
            room.connecting ? [[(a + e) / 2 - 1, (a + e) / 2 + 1, 0, 2.9]] : [],
            {
              ink,
            },
          );
        // Fixtures are narrower than the smallest room and clear both door routes.
        furniture(b, room.type, outerX - inward * 1.5, y, mid, ink, variant(f, side, i));
        // A single-loaded corridor leaves rooms deep enough to want a second group,
        // set back along the wall so it never stands in the doorway.
        if (e - a > 11 && front - back >= 11)
          furniture(
            b,
            room.type,
            innerX + inward * 2.2,
            y,
            mid + (front - back) / 2 - 2.2,
            ink,
            variant(f, side, i) >> 8,
          );
        sign(
          root,
          `${f + 1}F ${ROOM_NAMES[room.type]}`,
          (a + e) / 2,
          y + 3.25,
          back + 0.2,
          Math.min(e - a - 0.5, 5),
          ink,
        );
      }
      b.wallZ(z0, z1, innerX, y, 4, 0.2, doorGaps, { ink });
      b.wallZ(z0, z1, outerX, y, 4, 0.25, windowGaps, { ink });
    }
    if (f < p.floors.length - 1) {
      // Thin treads preserve headroom beneath the next flight in a three-storey house.
      for (let step = 0; step < 14; step++)
        b.box(c.stair, y + ((step + 1) * 4) / 14 - 0.25, start + (step + 0.5) * 0.45, c.stairW, 0.25, 0.454, {
          ink,
        });
      // Separate the stair flight from the through corridor without blocking landings.
      b.rail(hx0, start, hx0, end, y);
      sign(root, `楼梯 → ${f + 2}F`, c.walk, y + 2.4, start - 0.3, 2.6, INK.ORANGE, true);
    }
    sign(root, `${f + 1}F`, c.walk, y + 2.6, z1 - 0.2, 2.5, ink, true);
  }
  b.slab(x0, z0, x1, z1, p.floors.length * 4, 0.25);
  b.box(l.entrance[0], 0, z0 + 0.15, 2.2, 2.8, 0.08, { ink: INK.GREEN, noCollide: true });
  sign(root, 'E 返回街道', l.entrance[0], 3.3, z0 + 0.2, 4, INK.GREEN);
  b.ring(l.entrance[0], 0.15, l.entrance[1], 'y');
}

// Two or three arrangements per room type: the plan chooses what a room is for, and
// the arrangement keeps two houses with the same room list from looking identical.
const ARRANGEMENTS = {
  living: 3,
  kitchen: 3,
  bedroom: 3,
  bathroom: 2,
  study: 2,
  dining: 2,
  storage: 2,
};
function furniture(b, type, x, y, z, ink, seed) {
  const box = (dx, dy, dz, w, h, d, color = ink) => b.box(x + dx, y + dy, z + dz, w, h, d, { ink: color });
  const cyl = (dx, dy, dz, r, h, color = ink) => b.cyl(x + dx, y + dy, z + dz, r, h, { ink: color });
  const v = seed % (ARRANGEMENTS[type] ?? 2);
  switch (type) {
    case 'living':
      if (v === 0) {
        box(0, 0, 0, 1.8, 0.5, 2.8);
        box(0, 0.5, -1.1, 1.8, 0.6, 0.4);
        box(0, 0.55, 0.2, 1.5, 0.15, 1.7, INK.ORANGE);
      } else if (v === 1) {
        for (const dz of [-1, 1]) {
          box(0, 0, dz, 1.5, 0.45, 1.2);
          box(0, 0.45, dz, 1.5, 0.5, 0.35);
        }
        box(0, 0, 0, 1.4, 0.04, 1.2, INK.ORANGE);
      } else {
        box(0, 0, -0.6, 1.8, 0.5, 2.2);
        box(0, 0.5, -1.5, 1.8, 0.6, 0.4);
        box(0, 0, 1.5, 0.9, 0.45, 0.9, INK.ORANGE);
        box(0, 0, 2.3, 0.14, 1.9, 0.14, INK.BLACK);
      }
      break;
    case 'kitchen':
      if (v === 0) {
        box(0, 0, -0.6, 1.5, 1, 2);
        box(0, 1, -0.6, 1.6, 0.08, 2.1, INK.BLACK);
        box(0, 0, 1.2, 1.4, 2.3, 1.2);
        for (const dz of [-1, -0.3]) cyl(0, 1.08, dz, 0.23, 0.04, INK.ORANGE);
      } else if (v === 1) {
        box(0, 0, 0, 1.4, 1, 3);
        box(0, 1, 0, 1.5, 0.08, 3.1, INK.BLACK);
        box(0, 1.7, -1, 0.7, 0.9, 2.4);
        cyl(0, 1.08, 0.8, 0.26, 0.04, INK.ORANGE);
      } else {
        box(0, 0, -1.2, 1.5, 1, 1.6);
        box(0, 1, -1.2, 1.6, 0.08, 1.7, INK.BLACK);
        box(0, 0, 0.9, 1.2, 0.9, 2, INK.ORANGE);
        box(0, 0.9, 0.9, 1.3, 0.1, 2.1, INK.BLACK);
      }
      break;
    case 'bedroom':
      if (v === 0) {
        box(0, 0, 0, 2.2, 0.4, 3.2);
        box(0, 0.4, 0, 2.1, 0.22, 3, INK.ORANGE);
        box(0, 0.62, -1, 1.7, 0.15, 0.7, INK.BLACK);
      } else if (v === 1) {
        for (const dz of [-1.1, 1.1]) {
          box(0, 0, dz, 1.9, 0.4, 1.9);
          box(0, 0.4, dz, 1.8, 0.2, 1.8, INK.ORANGE);
        }
        box(0, 0, 0, 0.9, 0.55, 0.6, INK.BLACK);
      } else {
        box(0, 0, 0.6, 2.2, 0.4, 2.8);
        box(0, 0.4, 0.6, 2.1, 0.22, 2.6, INK.ORANGE);
        box(0, 0, -1.4, 1.1, 2.2, 1.4);
        box(0, 0, -2.3, 0.5, 0.6, 0.5, INK.BLACK);
      }
      break;
    case 'bathroom':
      if (v === 0) {
        box(0, 0, -0.8, 1.6, 0.65, 1.2);
        box(0, 0.65, -0.8, 1.7, 0.1, 1.3, INK.BLACK);
        cyl(0, 0, 1, 0.5, 0.55);
      } else {
        box(0, 0, -1, 1.3, 2.2, 1.3, INK.BLACK);
        box(0, 0, -1, 1.2, 0.12, 1.2);
        box(0, 0.7, 0.9, 1.2, 0.12, 1.1);
        for (const dx of [-0.4, 0.4]) box(dx, 0, 0.9, 0.12, 0.7, 0.12);
        cyl(0, 0, 2, 0.45, 0.5, INK.ORANGE);
      }
      break;
    case 'study':
    case 'dining':
      if (v === 0) {
        box(0, 0, 0, 0.25, 0.9, 0.25);
        box(0, 0.9, 0, 1.8, 0.12, 2.2);
        box(0, 0, 1.6, 0.7, 0.55, 0.7, INK.ORANGE);
        if (type === 'study') box(0, 1.02, -0.6, 0.85, 0.55, 0.15, INK.BLACK);
      } else if (type === 'study') {
        for (const h of [0, 0.9, 1.8]) box(0, h, -0.6, 1.1, 0.1, 2.6);
        box(0, 0, -0.6, 0.12, 2.4, 2.6);
        box(0, 0, 1.5, 1.1, 0.45, 1.1, INK.ORANGE);
        box(0, 0.45, 1.5, 1.1, 0.55, 0.3);
      } else {
        box(0, 0.72, 0, 1.6, 0.12, 3.4);
        for (const dz of [-1.4, 1.4]) for (const dx of [-0.6, 0.6]) box(dx, 0, dz, 0.14, 0.72, 0.14);
        for (const dz of [-1, 0, 1]) box(0, 0, dz, 0.5, 0.45, 0.5, INK.ORANGE);
      }
      break;
    default:
      if (v === 0) {
        for (const height of [0, 0.85, 1.7]) box(0, height, 0, 1.4, 0.12, 2.6);
        box(0, 0, -1.2, 1.4, 2.1, 0.12);
        box(0, 0, 1.2, 1.4, 2.1, 0.12);
      } else {
        box(0, 0, -1, 1.3, 1.3, 1.3, INK.ORANGE);
        box(0, 1.3, -1, 1.1, 1, 1.1);
        box(0, 0, 0.6, 1.2, 0.9, 1.2);
        cyl(0, 0, 1.9, 0.45, 1.1, INK.BLACK);
      }
  }
}
