import { INK } from '../render.js';
import { ROOM_NAMES } from './interiors.js';

// Every room opens onto a clear, continuous corridor. Furniture stays against
// the outside wall; the stair opening and its landings are kept free on all floors.
export function buildHouse(b, l, root, sign) {
  const p = l.plan,
    ink = INK[p.palette.toUpperCase()];
  const x0 = 64 - p.width / 2,
    x1 = 64 + p.width / 2;
  const z0 = 64 - p.depth / 2,
    z1 = 64 + p.depth / 2;
  const start = z0 + 5,
    end = start + 6.3;
  for (let f = 0; f < p.floors.length; f++) {
    const y = f * 4;
    if (f === 0) b.slab(x0, z0, x1, z1, y, 0.3);
    else {
      b.slab(x0, z0, 64.1, z1, y, 0.3);
      b.slab(66.9, z0, x1, z1, y, 0.3);
      b.slab(64.1, z0, 66.9, start, y, 0.3);
      b.slab(64.1, end, 66.9, z1, y, 0.3);
      b.rail(64.1, start, 64.1, end, y);
      b.rail(66.9, start, 66.9, end, y);
    }
    b.wallX(x0, x1, z0, y, 4, 0.25, [], { ink });
    b.wallX(x0, x1, z1, y, 4, 0.25, [], { ink });
    for (const side of ['left', 'right']) {
      const rooms = p.floors[f][side];
      const innerX = side === 'left' ? 61 : 69;
      const outerX = side === 'left' ? x0 : x1;
      const a = Math.min(innerX, outerX),
        c = Math.max(innerX, outerX);
      const doorGaps = [],
        windowGaps = [];
      for (let i = 0; i < rooms.length; i++) {
        const room = rooms[i];
        const back = z0 + (p.depth * i) / rooms.length;
        const front = z0 + (p.depth * (i + 1)) / rooms.length;
        const mid = (back + front) / 2;
        doorGaps.push([mid - 1, mid + 1, 0, 2.9]);
        if (room.window) {
          windowGaps.push([mid - 1.5, mid + 1.5, 1.2, 2.9]);
          // A window opening with mullions and an invisible pane collision.
          b.box(outerX, y + 1.2, mid, 0.3, 1.7, 0.07, { ink });
          b.box(outerX, y + 2, mid, 0.3, 0.07, 3, { ink });
          b.collider(outerX, y + 1.2, mid, 0.25, 1.7, 3, { noGrapple: true });
        }
        if (i < rooms.length - 1)
          b.wallX(
            a,
            c,
            front,
            y,
            4,
            0.2,
            room.connecting ? [[(a + c) / 2 - 1, (a + c) / 2 + 1, 0, 2.9]] : [],
            { ink },
          );
        const fx = outerX + (side === 'left' ? 1.5 : -1.5);
        // Fixtures are narrower than the smallest room and clear both door routes.
        furniture(b, room.type, fx, y, mid, ink);
        sign(
          root,
          `${f + 1}F ${ROOM_NAMES[room.type]}`,
          (a + c) / 2,
          y + 3.25,
          back + 0.2,
          Math.min(c - a - 0.5, 5),
          ink,
        );
      }
      b.wallZ(z0, z1, innerX, y, 4, 0.2, doorGaps, { ink });
      b.wallZ(z0, z1, outerX, y, 4, 0.25, windowGaps, { ink });
    }
    if (f < p.floors.length - 1) {
      // Thin treads preserve headroom beneath the next flight in a three-storey house.
      for (let step = 0; step < 14; step++)
        b.box(65.5, y + ((step + 1) * 4) / 14 - 0.25, start + (step + 0.5) * 0.45, 2.6, 0.25, 0.454, { ink });
      // Separate the stair flight from the through corridor without blocking landings.
      b.rail(64.1, start, 64.1, end, y);
      sign(root, `楼梯 → ${f + 2}F`, 62.5, y + 2.4, start - 0.3, 2.6, INK.ORANGE, true);
    }
    sign(root, `${f + 1}F`, 62.5, y + 2.6, z1 - 0.2, 2.5, ink, true);
  }
  b.slab(x0, z0, x1, z1, p.floors.length * 4, 0.25);
  b.box(l.entrance[0], 0, z0 + 0.15, 2.2, 2.8, 0.08, { ink: INK.GREEN, noCollide: true });
  sign(root, 'E 返回街道', l.entrance[0], 3.3, z0 + 0.2, 4, INK.GREEN);
  b.ring(l.entrance[0], 0.15, l.entrance[1], 'y');
}

function furniture(b, type, x, y, z, ink) {
  const box = (dx, dy, dz, w, h, d, color = ink) => b.box(x + dx, y + dy, z + dz, w, h, d, { ink: color });
  switch (type) {
    case 'living':
      box(0, 0, 0, 1.8, 0.5, 2.8);
      box(0, 0.5, -1.1, 1.8, 0.6, 0.4);
      box(0, 0.55, 0.2, 1.5, 0.15, 1.7, INK.ORANGE);
      break;
    case 'kitchen':
      box(0, 0, -0.6, 1.5, 1, 2);
      box(0, 1, -0.6, 1.6, 0.08, 2.1, INK.BLACK);
      box(0, 0, 1.2, 1.4, 2.3, 1.2);
      for (const dz of [-1, -0.3]) b.cyl(x, y + 1.08, z + dz, 0.23, 0.04, { ink: INK.ORANGE });
      break;
    case 'bedroom':
      box(0, 0, 0, 2.2, 0.4, 3.2);
      box(0, 0.4, 0, 2.1, 0.22, 3, INK.ORANGE);
      box(0, 0.62, -1, 1.7, 0.15, 0.7, INK.BLACK);
      break;
    case 'bathroom':
      box(0, 0, -0.8, 1.6, 0.65, 1.2);
      box(0, 0.65, -0.8, 1.7, 0.1, 1.3, INK.BLACK);
      b.cyl(x, y, z + 1, 0.5, 0.55, { ink });
      break;
    case 'study':
    case 'dining':
      box(0, 0, 0, 0.25, 0.9, 0.25);
      box(0, 0.9, 0, 1.8, 0.12, 2.2);
      box(0, 0, 1.6, 0.7, 0.55, 0.7, INK.ORANGE);
      if (type === 'study') box(0, 1.02, -0.6, 0.85, 0.55, 0.15, INK.BLACK);
      break;
    default:
      for (const height of [0, 0.85, 1.7]) box(0, height, 0, 1.4, 0.12, 2.6);
      box(0, 0, -1.2, 1.4, 2.1, 0.12);
      box(0, 0, 1.2, 1.4, 2.1, 0.12);
  }
}
