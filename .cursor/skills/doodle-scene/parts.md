# Parts reference

`createParts(B)` takes the object returned by `createBuilder(scene, world)` and returns
the parts below. Every part takes one plain description object; lengths are metres.

## building

```js
building({ x, z, w, d, h, archetype, ink = INK.BLUE, seed = 'level' }) → { roof: { x, z, y, w, d } }
```

`x`/`z` are the footprint centre, `h` is the height above `y=0`. With no `archetype`
you get a solid volume with a coloured roof cap, window bays on all four elevations and
a parapet above 10 m. Named archetypes and their minimum footprints:

| archetype   | minimum | what it is                                                                                                   |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `tower`     | 8×8×12  | floor plates every `h/floors` with pillars and no outside walls; climb it level by level                     |
| `warehouse` | 12×12×8 | shell walls with a door and clerestory windows, a catwalk ring reached by one flight, a skylight in the roof |
| `courtyard` | 16×16×4 | a 3 m-thick wall ring with a gate, an open yard, and a walkable loop along the wall tops                     |

The returned `roof` is the anchor to hand to `skybridge` or to place anything on top.
`seed` only drives the crate scatter inside `warehouse` and `courtyard`, so revisiting
a scene looks the same.

## switchback

```js
switchback({ x, z, w, d, h, face, flights, width = 1.8 }) → { top: { x, y, z } }
```

`x`/`z`/`w`/`d`/`h` describe the **host building**, not the stair; `face` is one of
`north` / `south` / `west` / `east`. Flights alternate between two lanes 1.2 m and
3.2 m out from the facade, so no flight sits under the next one, and the last landing
arrives level with the roof. The facade must be at least `STAIR_SPAN` (10.7 m) long and
the stair needs `STAIR_DEPTH` (4.4 m) of clear ground outside it.

Spreading a validated structure works directly: `switchback({ ...host, face, flights })`.

## skybridge

```js
skybridge({ deck, y, spanX, rise = 0, highEnd = 0 })
```

`deck` is a rectangle (`x`, `z`, `w`, `d`), `y` is the deck surface height and `spanX`
says whether it runs along x. An orange ruler deck with tick marks and a rail down each
long side. With a `rise`, `highEnd` (`-1` or `1`) picks which end carries a step flight
up to the taller roof, so both ends land somewhere you can stand.

## parapet

```js
parapet({ x, z, w, d, y, gap = 0, ink })
```

Railing around a rectangle. A `gap` leaves that many metres open in the middle of each
side — both where a flight of stairs arrives and what stops a roof reading as a box.
Sides shorter than `gap + 2` are drawn solid.

## windows

```js
windows({ x, z, w, d, h, y0 = 1.5, ink = INK.BLACK })
```

Window bays on all four elevations of a solid volume, one or two bays per face
depending on its length, repeating every 3.5 m of height from `y0`.

## crates

```js
crates({ x, z, w, d, seed, ink = INK.BLUE })
```

Three to five boxes, sometimes stacked, scattered deterministically inside the given
rectangle. Use it to break up a floor or a yard and give something to crouch behind.

## Primitives worth knowing

From `builder.js`, all taking an options object `{ ink, noCollide, noNav, noShoot, noGrapple, tag }`:

- `box(x, y, z, w, h, d, o)` — `y` is the **bottom**, `x`/`z` the centre.
- `slab(x1, z1, x2, z2, y, t, o)` — opposite corners, `y` is the **top surface**.
- `wallX(x1, x2, z, y, h, t, gaps, o)` / `wallZ(z1, z2, x, y, h, t, gaps, o)` — a wall
  with rectangular holes. Each gap is `[a1, a2, yBottom = 0, yTop = h]` in absolute
  coordinates along the wall; gaps may overlap and runs are merged.
- `stairs(x, y, z, dir, steps, width, { rise, run })` → the arrival point. `dir` is
  `'+x'` / `'-x'` / `'+z'` / `'-z'`; defaults are `rise = 4/14`, `run = 0.45`.
- `rail(x1, z1, x2, z2, y, o)` — posts and a bar, one `noNav` `noShoot` collider.
- `ring(x, y, z, axis)` — a grapple anchor, also pushed to `L.rings`.
- `spawn` / `sniper` / `pickup(x, y, z)` — enemy, sniper perch and pickup positions.

`INK` ids come from `src/games/shooter/colors.js`: `BLUE`, `RED`, `BLACK`, `ORANGE`,
`GREEN`, `PINK`, `PURPLE`, `TEAL`, `BROWN`, `CYAN`, `GOLD`. Geometry is merged per ink
in `finish()`, so using few inks keeps the draw count low.
