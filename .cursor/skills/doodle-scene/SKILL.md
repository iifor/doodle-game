---
name: doodle-scene
description: Builds and edits scenes in the doodle-world shooter — hand-authored maps under src/games/shooter/levels/ and AI-generated open-world chunks under src/games/shooter/exploration/. Use when adding or changing a level, a building, a rooftop route, street furniture, a building archetype, or the prompt that drives chunk generation.
disable-model-invocation: true
---

# Doodle scene building

Geometry in this project is built in three layers. Work at the highest one that fits;
dropping to a lower layer means hand-writing coordinates that a part already derives.

| Layer      | File                                                              | What it gives you                                                                                                                                 |
| ---------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives | `src/games/shooter/levels/builder.js`                             | `box`, `slab`, `wallX`, `wallZ`, `stairs`, `rail`, `cyl`, `sphere`, `ring`, `spawn`, `sniper`, `pickup`, `planes`, `collider`, `addGeo`, `finish` |
| Parts      | `src/games/shooter/levels/parts.js`                               | `building`, `switchback`, `skybridge`, `parapet`, `windows`, `crates`                                                                             |
| Scenes     | `levels/district.js`, `levels/mexico.js`, `exploration/chunks.js` | composition                                                                                                                                       |

Both hand-built maps and generated chunks call the same parts, so a fix to a part
reaches every scene. See [parts.md](parts.md) for every signature and its anchors.

## Which layer

- **Adding a whole piece of a scene** (a building, a fire escape between two roofs, a
  walled compound) → use a part. If none fits, add one to `parts.js` rather than
  inlining geometry into a scene file.
- **Adding a new kind of part** → it must be consumed by a scene in the same change.
  An unused part is dead code; scope the change so it has a caller.
- **One-off decoration** (a giant pencil, a taco cart) → primitives in the scene file
  are correct. Do not generalise a prop that appears once.

## Two coordinate gotchas

`box(x, y, z, w, h, d)` takes `y` as the **bottom** of the volume and `x`/`z` as its
**centre**. `slab(x1, z1, x2, z2, y, t)` takes opposite corners and `y` as the
**top surface** — the thickness hangs below. Mixing them up is the most common error.

## Hard rules

- **Saved-layout compatibility.** `checksum(validateLayout(raw, ...))` must equal the
  stored checksum, so any new field in a normalized layout is emitted only when the
  input supplied it: `...(raw.foo === undefined ? {} : { foo })`. The same applies to
  `validateHouseLayout`, which round-trips with `JSON.stringify`. Never add a field
  unconditionally; every saved world breaks.
- **The model never supplies geometry.** For generated content the model picks an
  archetype and an anchor; the engine derives fixed, validated dimensions. Any
  coordinate or size the model could emit is a coordinate you have to validate.
- **One dimension table.** Constants the validator and the builder both need live in
  `exploration/schema.js` (`BUILDING_ARCHETYPES`, `STAIR_*`, `BRIDGE_*`). `parts.js`
  imports them, so a layout that validates is a layout that can be assembled.
- **`parts.js` must not import `three`.** `schema.js` imports its constants and runs on
  the server; pulling in `three` (or `render.js`) there bloats the server process.
  Build parts from the `B` primitives only.

## Chunk constraints

A generated chunk is 128 m square with the ground at `y=0`.

- Solids must sit inside `[8, 120]` on both axes and keep 4 m of clearance from every
  road centre line. Roads only ever run along `x=64` or `z ∈ {4, 32, 64, 96, 124}`.
- Footprints go into `rectangles` in `validateLayout` before the road, goal and
  breadth-first walkability checks, or a structure can wall off an exit.
- An elevated deck does not block the street: `NavGrid` is multi-level, with one node
  per walkable collider top per cell.

## Gameplay invariants

- **Stair rise ≤ 0.3 m per tread**, run 0.45 m. Steeper and the player cannot walk up.
  `switchback` derives this; a hand-rolled `stairs` call must check it.
- **A ledge narrower than the nav cell may be player-only.** Chunks build `NavGrid` at
  cell 2 m (`chunks.js`), hand-built levels at 1 m (`index.js`), and nodes only appear
  where a cell centre lands on the surface. Whether a 1.6 m catwalk gets nodes depends
  on where it sits, so assert it in a test instead of assuming either way.
- **Rails are `noNav` and `noShoot`**: they stop you falling without stopping bullets
  or blocking the surface. Invisible ceilings and wall tops add `noGrapple` so they
  are not somewhere to camp.
- Every roof worth reaching gets a `ring` (a grapple anchor) and, in hand-built maps,
  `spawn` / `sniper` / `pickup` positions.

## Verifying a scene change

Run `npm run check` (lint, tests, format, build). Then assert what the geometry is
_for_, not that it exists — the tests in `tests/world.test.js` show the pattern:

- Build with `buildChunk`, then `new NavGrid(built.world, built.level.bounds, 2).build()`.
- `nav.findPath(...)` from a block exit to every goal proves nothing got walled off.
- `nav.nodes` filtered by height and footprint proves a floor, catwalk or roof is
  somewhere you can actually stand.
- Collider tops sorted by height prove a stair has no gap taller than 0.35 m.
- Always `disposeTree(built.root)` in a `finally`.

**When refactoring geometry that saved worlds render**, prove the output is unchanged
rather than assuming it: write a script that prints a signature of the built chunk
(every collider's bounds and flags, sorted, plus each merged mesh's vertex count), run
it on the working tree, then run it again in a scratch worktree at `HEAD`
(`git worktree add --detach /tmp/base HEAD`, symlink `node_modules`) and diff the two.

## Adding a building archetype

1. Add its minimum footprint to `BUILDING_ARCHETYPES` in `exploration/schema.js`.
   `validateLayout` already rejects anything smaller with an actionable message.
2. Add the shape function to the `shapes` map in `parts.js`, built from primitives and
   the existing `parapet` / `windows` / `crates` helpers.
3. If it is walked into directly, confirm `enterableBuildings` in `interiors.js`
   excludes it — a walk-in building must not also offer an "E 进入住宅" portal.
4. Teach the model: the archetype paragraph in the legacy system prompt in
   `server/world-store.js`, and add it to `reference` there if it needs demonstrating.
   Re-validate the reference across many seeds before committing.
5. Document it under `### 楼体形制` in `docs/open-world.md`.

## Adding a hand-built map

`levels/district.js` is the model to follow: it takes the destructured `B` builder and
an `arena` flag, and the solo and match variants share one file because most of the
geometry is common. Register the key in `LEVELS` and `buildLevel` in `level.js`.
