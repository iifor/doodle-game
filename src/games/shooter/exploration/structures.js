import { INK } from '../render.js';
import {
  expandStructures,
  FACES,
  STAIR_TREADS,
  STAIR_RUN,
  STAIR_FLIGHT,
  STAIR_LANDING,
  BRIDGE_WIDTH,
} from './schema.js';

// Switchback flights hug the facade and alternate between two lanes, so no flight sits
// directly under the next one and the last landing arrives level with the roof.
function buildStair(b, s) {
  const { host, face, flights, rect } = s;
  const alongX = FACES[face][0] === 0;
  // Distances are measured along the facade and outward from it, then mapped back to x/z.
  const outward = Math.sign(alongX ? rect.z - host.z : rect.x - host.x);
  const centre = alongX ? host.x : host.z;
  const facade = (alongX ? host.z : host.x) + outward * ((alongX ? host.d : host.w) / 2);
  const at = (along, out) => (alongX ? [along, facade + outward * out] : [facade + outward * out, along]);
  const rise = host.h / flights;
  let y = 0;
  for (let f = 0; f < flights; f++) {
    const forward = f % 2 === 0;
    const [sx, sz] = at(centre + (forward ? -1 : 1) * (STAIR_FLIGHT / 2), f % 2 ? 3.2 : 1.2);
    b.stairs(sx, y, sz, `${forward ? '+' : '-'}${alongX ? 'x' : 'z'}`, STAIR_TREADS, 1.8, {
      rise: rise / STAIR_TREADS,
      run: STAIR_RUN,
    });
    y += rise;
    const land = centre + ((forward ? 1 : -1) * (STAIR_FLIGHT + STAIR_LANDING)) / 2;
    const [nearX, nearZ] = at(land - STAIR_LANDING / 2, 0.2);
    const [farX, farZ] = at(land + STAIR_LANDING / 2, 4.3);
    b.slab(
      Math.min(nearX, farX),
      Math.min(nearZ, farZ),
      Math.max(nearX, farX),
      Math.max(nearZ, farZ),
      y,
      0.4,
    );
    const [railX, railZ] = at(land - STAIR_LANDING / 2, 4.3);
    b.rail(railX, railZ, farX, farZ, y);
  }
  b.ring(rect.x, host.h + 1.2, rect.z, 'y');
}

// A ruler laid between two roofs: orange deck, tick marks and a rail down each side.
function buildBridge(b, s) {
  const { deck, y, spanX } = s;
  const x1 = deck.x - deck.w / 2,
    x2 = deck.x + deck.w / 2;
  const z1 = deck.z - deck.d / 2,
    z2 = deck.z + deck.d / 2;
  b.slab(x1, z1, x2, z2, y, 0.4, { ink: INK.ORANGE });
  for (let i = 0; i <= Math.floor(spanX ? deck.w : deck.d); i++) {
    const tick = i % 5 === 0 ? 0.6 : 0.35;
    b.box(
      spanX ? x1 + i : x1 + 0.2,
      y,
      spanX ? z1 + 0.2 : z1 + i,
      spanX ? 0.06 : tick,
      0.02,
      spanX ? tick : 0.06,
      { noCollide: true, ink: INK.BLACK },
    );
  }
  if (spanX) {
    b.rail(x1, z1, x2, z1, y, { ink: INK.ORANGE });
    b.rail(x1, z2, x2, z2, y, { ink: INK.ORANGE });
  } else {
    b.rail(x1, z1, x1, z2, y, { ink: INK.ORANGE });
    b.rail(x2, z1, x2, z2, y, { ink: INK.ORANGE });
  }
  // The deck lies on the lower roof; these steps carry it up to the higher one.
  if (s.highEnd) {
    const up = s.highEnd > 0;
    const from = spanX
      ? up
        ? x2 - STAIR_FLIGHT
        : x1 + STAIR_FLIGHT
      : up
        ? z2 - STAIR_FLIGHT
        : z1 + STAIR_FLIGHT;
    b.stairs(
      spanX ? from : deck.x,
      y,
      spanX ? deck.z : from,
      `${up ? '+' : '-'}${spanX ? 'x' : 'z'}`,
      STAIR_TREADS,
      BRIDGE_WIDTH,
      { rise: s.rise / STAIR_TREADS, run: STAIR_RUN, ink: INK.ORANGE },
    );
  }
  b.ring(deck.x, y + 2, deck.z, 'y');
}

export function buildStructures(b, layout) {
  for (const s of expandStructures(layout, layout.buildings))
    if (s.type === 'stair') buildStair(b, s);
    else buildBridge(b, s);
}
