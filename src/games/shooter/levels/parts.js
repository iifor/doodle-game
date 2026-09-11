import { INK } from '../render.js';
import {
  BUILDING_ARCHETYPES,
  FACES,
  STAIR_TREADS,
  STAIR_RUN,
  STAIR_FLIGHT,
  STAIR_LANDING,
  BRIDGE_WIDTH,
  hash,
} from '../exploration/schema.js';

// A part is a whole piece of a scene — a building, a fire escape, a rooftop bridge —
// assembled from the primitives in builder.js. Parts take a plain description and
// return the anchors needed to attach the next part, so composing a street never means
// working out coordinates by hand. The archetype dimensions come from the same table
// the layout validator reads, so anything that validates can be built.
export function createParts(b) {
  // Railing around a rectangle. A gap leaves the middle of each side open, which is
  // both where a flight of stairs arrives and what stops a roof feeling like a box.
  const parapet = ({ x, z, w, d, y, gap = 0, ink }) => {
    const x1 = x - w / 2,
      x2 = x + w / 2,
      z1 = z - d / 2,
      z2 = z + d / 2;
    const side = (alongX, a1, a2, fixed) => {
      const draw = (s, e) =>
        alongX ? b.rail(s, fixed, e, fixed, y, { ink }) : b.rail(fixed, s, fixed, e, y, { ink });
      if (gap <= 0 || a2 - a1 <= gap + 2) return draw(a1, a2);
      const mid = (a1 + a2) / 2;
      draw(a1, mid - gap / 2);
      draw(mid + gap / 2, a2);
    };
    side(true, x1, x2, z1);
    side(true, x1, x2, z2);
    side(false, z1, z2, x1);
    side(false, z1, z2, x2);
  };

  // Window bays on all four elevations of a solid volume.
  const windows = ({ x, z, w, d, h, y0 = 1.5, ink = INK.BLACK }) => {
    for (const [nx, nz] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const along = nx ? d : w;
      const bay = Math.min(2.4, along / 3);
      const bays = Math.max(1, Math.min(2, Math.floor(along / (bay + 2))));
      for (let i = 0; i < bays; i++) {
        const offset = ((i + 0.5) / bays - 0.5) * along;
        for (let y = y0; y + 1 < h; y += 3.5)
          b.box(
            x + nx * (w / 2 + 0.02) + (nx ? 0 : offset),
            y,
            z + nz * (d / 2 + 0.02) + (nz ? 0 : offset),
            nx ? 0.05 : bay,
            1.1,
            nx ? bay : 0.05,
            { noCollide: true, ink },
          );
      }
    }
  };

  // Stacked boxes to break up a floor and give something to crouch behind. Sizes and
  // positions come from the seed, so the same yard looks the same on every visit.
  const crates = ({ x, z, w, d, seed, ink = INK.BLUE }) => {
    const count = 3 + (hash(`${seed}:crates`) % 3);
    for (let i = 0; i < count; i++) {
      const r = hash(`${seed}:crate:${i}`);
      const size = 1.2 + ((r >> 3) % 3) * 0.5;
      const cx = x + ((r % 128) / 127 - 0.5) * Math.max(0, w - size - 1);
      const cz = z + (((r >> 8) % 128) / 127 - 0.5) * Math.max(0, d - size - 1);
      b.box(cx, 0, cz, size, size, size, { ink: (r >> 16) % 3 ? ink : INK.GREEN });
      if ((r >> 18) % 3 === 0) b.box(cx, size, cz, size * 0.8, size * 0.8, size * 0.8, { ink });
    }
  };

  // Switchback flights hug one facade and alternate between two lanes, so no flight
  // sits directly under the next one and the last landing arrives level with the roof.
  const switchback = ({ x, z, w, d, h, face, flights, width = 1.8 }) => {
    const [nx, nz] = FACES[face];
    const alongX = nx === 0;
    // Distances are measured along the facade and outward from it, then mapped to x/z.
    const outward = nx || nz;
    const centre = alongX ? x : z;
    const facade = (alongX ? z : x) + outward * ((alongX ? d : w) / 2);
    const at = (along, out) => (alongX ? [along, facade + outward * out] : [facade + outward * out, along]);
    const rise = h / flights;
    let y = 0;
    let top = { x, y: 0, z };
    for (let f = 0; f < flights; f++) {
      const forward = f % 2 === 0;
      const [sx, sz] = at(centre + (forward ? -1 : 1) * (STAIR_FLIGHT / 2), f % 2 ? 3.2 : 1.2);
      b.stairs(sx, y, sz, `${forward ? '+' : '-'}${alongX ? 'x' : 'z'}`, STAIR_TREADS, width, {
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
      top = { x: (nearX + farX) / 2, y, z: (nearZ + farZ) / 2 };
    }
    return { top };
  };

  // A ruler laid between two roofs: orange deck, tick marks and a rail down each side.
  // The deck lies level with the lower roof and steps up to the higher one, so a bridge
  // always lands somewhere you can stand.
  const skybridge = ({ deck, y, spanX, rise = 0, highEnd = 0 }) => {
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
    if (highEnd) {
      const up = highEnd > 0;
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
        { rise: rise / STAIR_TREADS, run: STAIR_RUN, ink: INK.ORANGE },
      );
    }
    b.ring(deck.x, y + 2, deck.z, 'y');
  };

  // An open frame: floor plates you can see between, pillars at the corners and mid
  // spans, and a railing with a landing gap on every level.
  const tower = ({ x, z, w, d, h, ink }) => {
    const floors = Math.max(2, Math.floor(h / 4));
    const step = h / floors;
    for (let f = 1; f <= floors; f++) {
      b.slab(x - w / 2, z - d / 2, x + w / 2, z + d / 2, f * step, 0.4, { ink });
      parapet({ x, z, w, d, y: f * step, gap: 3, ink });
    }
    for (const dx of [-1, 0, 1])
      for (const dz of [-1, 0, 1])
        if (dx || dz) b.box(x + dx * (w / 2 - 0.6), 0, z + dz * (d / 2 - 0.6), 0.8, h, 0.8, { ink });
    b.box(x, h, z, 0.3, 3.2, 0.3, { noCollide: true, ink: INK.BLACK });
    b.ring(x, h + 3.4, z, 'y');
  };

  // A shed to fight inside: shell walls with doors and clerestory windows, a catwalk
  // ring reached by one flight, and a skylight cut out of the roof.
  const warehouse = ({ x, z, w, d, h, ink, seed }) => {
    const x1 = x - w / 2,
      x2 = x + w / 2,
      z1 = z - d / 2,
      z2 = z + d / 2;
    const hw = Math.min(3, w / 6),
      hd = Math.min(3, d / 6);
    // Roof in four pieces so the middle stays open to the sky.
    b.slab(x1, z1, x2, z - hd, h, 0.4, { ink });
    b.slab(x1, z + hd, x2, z2, h, 0.4, { ink });
    b.slab(x1, z - hd, x - hw, z + hd, h, 0.4, { ink });
    b.slab(x + hw, z - hd, x2, z + hd, h, 0.4, { ink });
    const sill = Math.max(3.8, h * 0.6);
    const strip = (a, b2) => [a, b2, sill, Math.min(h - 0.6, sill + 2.2)];
    b.wallX(x1, x2, z1, 0, h, 0.4, [[x - 2, x + 2, 0, 3.6], strip(x1 + 2, x1 + 5), strip(x2 - 5, x2 - 2)], {
      ink,
    });
    b.wallX(x1, x2, z2, 0, h, 0.4, [[x - 2, x + 2, 0, 3.6], strip(x - 4, x + 4)], { ink });
    for (const wx of [x1, x2])
      b.wallZ(z1, z2, wx, 0, h, 0.4, [strip(z1 + 2, z1 + 5), strip(z2 - 5, z2 - 2)], { ink });
    // Catwalk ring, shallow enough that one flight reaches it within the depth.
    const treads = Math.ceil((d - 4.2) / STAIR_RUN);
    const cy = Math.min(6, treads * 0.3, h - 3);
    b.slab(x1 + 0.4, z1 + 0.4, x1 + 2, z2 - 0.4, cy, 0.3, { ink });
    b.slab(x2 - 2, z1 + 0.4, x2 - 0.4, z2 - 0.4, cy, 0.3, { ink });
    b.slab(x1 + 2, z1 + 0.4, x2 - 2, z1 + 2, cy, 0.3, { ink });
    b.slab(x1 + 2, z2 - 2, x2 - 2, z2 - 0.4, cy, 0.3, { ink });
    b.rail(x1 + 2, z1 + 2, x1 + 2, z2 - 2, cy);
    b.rail(x2 - 2, z1 + 2, x2 - 2, z2 - 2, cy);
    b.rail(x1 + 2, z1 + 2, x2 - 2, z1 + 2, cy);
    b.rail(x1 + 2, z2 - 2, x2 - 2, z2 - 2, cy);
    b.stairs(x1 + 2, 0, z1 + 2.2, '+z', treads, 1.6, { rise: cy / treads, run: STAIR_RUN });
    crates({ x, z, w: w - 6, d: d - 6, seed: `${seed}:${x},${z}`, ink });
    parapet({ x, z, w, d, y: h, gap: 3, ink });
    b.ring(x, h + 2, z, 'y');
  };

  // A walled compound: a thick ring you can walk along the top of, one gate through
  // the front, and an open yard with cover in it.
  const courtyard = ({ x, z, w, d, h, ink, seed }) => {
    // Thinner walls on a small compound, so the yard inside stays worth entering.
    const t = Math.min(w, d) >= 16 ? 3 : 2;
    const x1 = x - w / 2,
      x2 = x + w / 2,
      z1 = z - d / 2,
      z2 = z + d / 2;
    // The gate is a hole in the front wall, so the wall above it stays a gatehouse.
    b.wallX(x1, x2, z1 + t / 2, 0, h, t, [[x - 2, x + 2, 0, Math.min(3.2, h)]], { ink });
    b.box(x, 0, z2 - t / 2, w, h, t, { ink });
    for (const wx of [x1 + t / 2, x2 - t / 2]) b.box(wx, 0, z, t, h, d - 2 * t, { ink });
    windows({ x, z, w, d, h, y0: 2.2, ink: INK.BLACK });
    parapet({ x, z, w, d, y: h, ink });
    parapet({ x, z, w: w - 2 * t, d: d - 2 * t, y: h, ink });
    crates({ x, z, w: w - 2 * t - 2, d: d - 2 * t - 2, seed: `${seed}:${x},${z}`, ink });
    b.ring(x, h + 2, z, 'y');
  };

  // A plain volume with a coloured roof cap. The default when no archetype is named.
  const block = ({ x, z, w, d, h, ink }) => {
    b.box(x, 0, z, w, h, d, { ink });
    b.box(x, h, z, w, 0.2, d, { noCollide: true, ink: INK.ORANGE });
    windows({ x, z, w, d, h });
    if (h >= 10) parapet({ x, z, w, d, y: h, ink });
    b.ring(x, h + 2, z, 'y');
  };

  const shapes = { tower, warehouse, courtyard };
  const building = ({ x, z, w, d, h, archetype, ink = INK.BLUE, seed = 'level' }) => {
    (shapes[archetype] ?? block)({ x, z, w, d, h, ink, seed });
    return { roof: { x, z, y: h, w, d } };
  };

  return { building, parapet, windows, crates, switchback, skybridge, archetypes: BUILDING_ARCHETYPES };
}
