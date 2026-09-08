import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { WorldStore, atomicWrite, deepSeekGenerator } from '../server/world-store.js';
import { campLayout, checksum, address } from '../src/games/shooter/exploration/schema.js';
import {
  enterableBuildings,
  interiorExample,
  validateInteriorPlan,
  expandHouse,
  validateHouseBlock,
  dynamicScene,
  houseEntry,
  blockKey,
} from '../src/games/shooter/exploration/interiors.js';
import { buildChunk, Chunks } from '../src/games/shooter/exploration/chunks.js';
import { World, makeBody } from '../src/games/shooter/physics.js';
import { disposeTree } from '../src/shared/resources.js';
import { Exploration } from '../src/games/shooter/exploration/session.js';
import { BuildingScenes } from '../src/games/shooter/exploration/scenes.js';
import { sceneOf } from '../src/games/shooter/exploration/region.js';
import { validateActor } from '../src/games/shooter/exploration/network.js';

function street(seed = 'fixture', x = 0, z = 0) {
  return {
    x,
    z,
    layout: {
      ...campLayout(seed),
      buildings: [20, 108].flatMap((x) => [20, 108].map((z) => ({ x, z, w: 8, d: 8, h: 12 }))),
    },
  };
}
async function setup(t, generate) {
  const dir = await mkdtemp(join(tmpdir(), 'doodle-house-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new WorldStore(dir, generate);
  const info = await store.create('住宅测试');
  const exterior = street(info.seed);
  exterior.checksum = await checksum(exterior.layout);
  await atomicWrite(store.path(info.id, 'chunks', '0,0.json'), exterior);
  store.claim(info.id, 'host');
  return { dir, store, info, exterior, buildings: enterableBuildings(exterior) };
}

test('house plans choose one to three floors, room counts, connecting doors and windows with strict bounds', () => {
  for (const count of [1, 2, 3]) {
    const p = structuredClone(interiorExample);
    p.floors = Array.from({ length: count }, () => p.floors[0]);
    assert.equal(validateInteriorPlan(p).floors.length, count);
  }
  for (const patch of [
    { floors: [] },
    { width: 300 },
    { floors: Array(4).fill(interiorExample.floors[0]) },
    { name: '\n' },
    { palette: 'red' },
  ])
    assert.throws(() => validateInteriorPlan({ ...interiorExample, ...patch }));
  const invalid = structuredClone(interiorExample);
  invalid.floors[0].left[1].type = 'script';
  assert.throws(() => validateInteriorPlan(invalid));
  assert.equal(sceneOf({ cx: 8, cz: 0, y: 0 }, { schemaVersion: 1 }), 'outdoor');
  for (const x of [-999999, 0, 999999]) {
    const b = enterableBuildings(street('fixture', x, 2))[0];
    const l = expandHouse(interiorExample, b);
    assert.equal(dynamicScene(houseEntry(l, x, 2)), b.id);
    assert.equal(dynamicScene({ ...houseEntry(l, x, 2), y: l.baseY + 10 }), b.id);
  }
});

test('house cache deduplicates first entry, persists across restart and pause, and never regenerates corrupt data', async (t) => {
  let calls = 0;
  const generate = async ({ design, validate }) => {
    calls++;
    assert.equal(design.kind, 'house');
    await new Promise((r) => setTimeout(r, 5));
    return validate(structuredClone(interiorExample));
  };
  const { dir, store, info, buildings } = await setup(t, generate);
  const before = await readFile(store.path(info.id, 'chunks', '0,0.json'), 'utf8');
  const results = await Promise.all(
    Array.from({ length: 4 }, () => store.interior(info.id, buildings[0].id, 'host', true)),
  );
  assert.equal(calls, 1);
  assert.ok(results.every((b) => b.checksum === results[0].checksum));
  assert.deepEqual(await store.manifest(info.id), ['0,0']);
  assert.equal(before, await readFile(store.path(info.id, 'chunks', '0,0.json'), 'utf8'));
  const restarted = new WorldStore(dir, generate);
  restarted.claim(info.id, 'host');
  await restarted.update(info.id, 'host', { revision: 0, generationPaused: true });
  assert.equal((await restarted.interior(info.id, buildings[0].id, 'host')).checksum, results[0].checksum);
  assert.equal(calls, 1);
  await assert.rejects(restarted.interior(info.id, buildings[1].id, 'host'), /暂停/);
  await writeFile(store.path(info.id, 'interiors', `${buildings[0].id}.json`), '{broken');
  await assert.rejects(restarted.interior(info.id, buildings[0].id, 'host'));
  assert.equal(calls, 1);
  await assert.rejects(store.interior(info.id, '../../outside', 'host'), /编号/);
});

test('invalid AI output and expired write authority leave no interior cache', async (t) => {
  const { store, info, buildings } = await setup(t, async () => ({ ...interiorExample, floors: [] }));
  await assert.rejects(store.interior(info.id, buildings[0].id, 'host'), /一至三层/);
  await assert.rejects(readFile(store.path(info.id, 'interiors', `${buildings[0].id}.json`)), {
    code: 'ENOENT',
  });
  store.generate = async () => {
    store.leases.clear();
    return interiorExample;
  };
  await assert.rejects(store.interior(info.id, buildings[0].id, 'host'), /会话/);
  await assert.rejects(readFile(store.path(info.id, 'interiors', `${buildings[0].id}.json`)), {
    code: 'ENOENT',
  });
});

function walk(world, body, x, z, maxSteps = 2000) {
  for (let i = 0; i < maxSteps; i++) {
    const dx = x - body.pos.x,
      dz = z - body.pos.z,
      d = Math.hypot(dx, dz);
    if (d < 0.025) return;
    const speed = Math.min(3, d * 60);
    body.vel.set((dx / d) * speed, -3, (dz / d) * speed);
    world.moveBody(body, 1 / 60);
  }
  assert.fail(`blocked walking to ${x},${z} from ${body.pos.toArray()}`);
}
test('actual collision permits every room, stairs up and down, and keeps windows enclosed on all three floors', () => {
  for (const rooms of [1, 2, 3]) {
    for (const width of [20, 24, 28])
      for (const depth of [24, 28, 32]) {
        const p = structuredClone(interiorExample);
        p.width = width;
        p.depth = depth;
        p.floors = Array.from({ length: 3 }, () => ({
          left: [
            { type: 'living', window: true, connecting: true },
            { type: 'kitchen', window: false, connecting: true },
            { type: 'bedroom', window: true, connecting: false },
          ],
          right: [
            { type: 'bathroom', window: true, connecting: true },
            { type: 'study', window: false, connecting: true },
            { type: 'storage', window: true, connecting: false },
          ],
        }));
        for (const f of p.floors) {
          f.left = f.left.slice(0, rooms);
          f.right = f.right.slice(0, rooms);
          if (rooms === 1) f.right[0].type = 'kitchen';
        }
        const l = expandHouse(p, enterableBuildings(street())[0]);
        const built = buildChunk({ x: 0, z: 0, layout: l });
        const z0 = 64 - depth / 2,
          end = z0 + 11.3;
        const body = makeBody(new THREE.Vector3(l.entrance[0], 0, l.entrance[1]), 0.36, 1.85);
        assert.equal(built.world.overlapsBody(body), false);
        for (let f = 0; f < 3; f++) {
          walk(built.world, body, 62.5, z0 + 2.5);
          assert.ok(Math.abs(body.pos.y - f * 4) < 0.01);
          for (let i = 0; i < rooms; i++) {
            const z = z0 + (depth * (i + 0.5)) / rooms;
            walk(built.world, body, 62.5, z);
            walk(built.world, body, 59, z);
            walk(built.world, body, 62.5, z);
          }
          // Right rooms are reached around the top stair landing.
          walk(built.world, body, 62.5, end + 2);
          walk(built.world, body, 68, end + 2);
          for (let i = 0; i < rooms; i++) {
            const z = z0 + (depth * (i + 0.5)) / rooms;
            walk(built.world, body, 68, z);
            walk(built.world, body, 70.5, z);
            walk(built.world, body, 68, z);
          }
          walk(built.world, body, 68, end + 2);
          // Return along corridor; stairwell walls deliberately keep through traffic left.
          walk(built.world, body, 62.5, end + 2);
          if (f < 2) {
            walk(built.world, body, 62.5, z0 + 3);
            walk(built.world, body, 65.5, z0 + 3);
            walk(built.world, body, 65.5, end + 1);
            assert.ok(Math.abs(body.pos.y - (f + 1) * 4) < 0.01, 'stairs arrive at next floor');
            walk(built.world, body, 62.5, end + 1);
          }
        }
        for (let f = 2; f > 0; f--) {
          walk(built.world, body, 62.5, end + 1);
          walk(built.world, body, 65.5, end + 1);
          walk(built.world, body, 65.5, z0 + 3);
          assert.ok(Math.abs(body.pos.y - (f - 1) * 4) < 0.01, 'stairs descend');
          walk(built.world, body, 62.5, z0 + 3);
        }
        walk(built.world, body, l.entrance[0], l.entrance[1]);
        const windowBody = makeBody(
          new THREE.Vector3(64 - width / 2 + 0.6, 1.4, z0 + depth / (rooms * 2)),
          0.36,
          1.3,
        );
        windowBody.vel.set(-5, 0, 0);
        for (let i = 0; i < 60; i++) built.world.moveBody(windowBody, 1 / 60);
        assert.ok(windowBody.pos.x > 64 - width / 2, 'window prevents escape');
        disposeTree(built.root);
      }
  }
});

test('indoor instances share no outdoor coordinates or rendering and unload on leaving', async () => {
  const info = { schemaVersion: 1 },
    ctx = { scene: new THREE.Scene(), world: new World(), level: { rings: [] }, exploration: { info } };
  const chunks = new Chunks(ctx),
    exterior = street();
  const b = enterableBuildings(exterior)[0],
    layout = expandHouse(interiorExample, b);
  const block = { x: 0, z: 0, layout, checksum: await checksum(layout) };
  await validateHouseBlock(block);
  await chunks.add(exterior);
  await chunks.add(block);
  assert.equal(chunks.loaded.size, 2);
  chunks.visible(chunks.position(houseEntry(layout, 0, 0)));
  assert.equal(chunks.loaded.get('0,0').root.visible, false);
  assert.equal(chunks.loaded.get(b.id).root.visible, true);
  assert.equal(
    ctx.world.overlapsBody(makeBody(chunks.position(houseEntry(layout, 0, 0)), 0.36, 1.85)),
    false,
  );
  chunks.visible(new THREE.Vector3(64, 0, 64));
  assert.equal(chunks.loaded.get(b.id).root.visible, false);
  const s = Object.create(Exploration.prototype);
  Object.assign(s, {
    info,
    chunks,
    isHost: true,
    players: new Map([['host', { id: 'host', pos: { cx: 0, cz: 0, x: 64, y: 0, z: 64 }, active: false }]]),
    selfId: 'host',
    manifest: new Set(['0,0']),
    requests: new Map(),
    failed: new Map(),
    grenades: [],
    ctx: { enemies: { enemies: [], projectiles: { list: [] } }, player: { nades: [] } },
    pendingKills: new Map(),
    saving: 0,
    unsaved: [],
  });
  s.maintain();
  assert.equal(chunks.loaded.has(b.id), false);
  chunks.dispose();
  assert.equal(ctx.scene.children.length, 0);
});

test('dynamic multiplayer waits for matching interior checksum, isolates snapshots and rejects cross-scene movement', async () => {
  const exterior = street(),
    b = enterableBuildings(exterior)[0],
    layout = expandHouse(interiorExample, b);
  const block = { x: 0, z: 0, layout, checksum: await checksum(layout) };
  exterior.checksum = await checksum(exterior.layout);
  const s = Object.create(Exploration.prototype);
  Object.assign(s, {
    info: { schemaVersion: 1 },
    isHost: true,
    selfId: 'host',
    players: new Map(),
    manifest: new Set(['0,0']),
    requests: new Map(),
    saving: 0,
    unsaved: [],
    progress: { chunks: {} },
    ctx: { player: { nades: [] }, enemies: { enemies: [], projectiles: { list: [] } } },
    report() {},
  });
  s.chunks = {
    loaded: new Map([['0,0', { block: exterior, x: 0, z: 0, key: '0,0' }]]),
    position: (p) => new THREE.Vector3(p.cx * 128 + p.x, p.y, p.cz * 128 + p.z),
    address: (v) => address(v.x, v.y, v.z),
    async add(b) {
      this.loaded.set(blockKey(b), { block: b, x: b.x, z: b.z, key: blockKey(b) });
    },
  };
  s.scenes = new BuildingScenes(s);
  const p = s.newActor('guest', '访客', b.door);
  p.active = true;
  s.players.set(p.id, p);
  const sent = [];
  s.packets = { post: (...args) => sent.push(args) };
  s.api = { call: async () => block };
  await s.scenes.interact(p, { epoch: 0, seq: 1 });
  assert.equal(p.sceneId, 'outdoor');
  const pending = p.transition;
  await assert.rejects(
    s.scenes.receive('scene-loaded', { id: pending.id, epoch: 1, checksum: 'wrong' }, p.id),
    /校验/,
  );
  await s.scenes.receive('scene-loaded', { id: pending.id, epoch: 1, checksum: block.checksum }, p.id);
  assert.equal(p.sceneId, b.id);
  assert.equal(p.epoch, 1);
  validateActor(p, s.info);
  s.error = '';
  s.snapshotRevision = 0;
  s.ctx.enemies.enemies = [{ alive: true, body: { pos: new THREE.Vector3(64, 0, 64) } }];
  s.ctx.enemies.projectiles.list = [{ pos: new THREE.Vector3(64, 1, 64) }];
  const snapshot = s.snapshot(p.id);
  assert.equal(snapshot.enemies.length, 0);
  assert.equal(snapshot.bullets.length, 0);
  assert.deepEqual(
    snapshot.chunks.map((c) => c.key),
    ['0,0'],
  );
  assert.throws(() => s.acceptState(p, { ...p, pos: b.door, sceneId: 'outdoor' }), /跨场景/);
  s.api.call = async () => exterior;
  await s.scenes.interact(p, { epoch: 1, seq: 2 });
  await s.scenes.receive(
    'scene-loaded',
    { id: p.transition.id, epoch: 2, checksum: exterior.checksum },
    p.id,
  );
  assert.equal(p.sceneId, 'outdoor');
  assert.deepEqual(p.pos, b.door);
  let finish;
  s.api.call = () =>
    new Promise((r) => {
      finish = r;
    });
  const loading = s.scenes.interact(p, { epoch: 2, seq: 3 });
  await s.scenes.receive('scene-cancel', { epoch: 2 }, p.id);
  finish(block);
  await loading;
  assert.equal(p.sceneId, 'outdoor');
  assert.equal(p.transition, null);
});

test('guest loading UI rejects a canceled request response and completes the matching prepare/commit', async () => {
  const exterior = street(),
    building = enterableBuildings(exterior)[0];
  const layout = expandHouse(interiorExample, building),
    block = { x: 0, z: 0, layout, checksum: await checksum(layout) };
  const s = {
    info: { schemaVersion: 1 },
    isHost: false,
    selfId: 'guest',
    started: true,
    players: new Map(),
    progress: { chunks: {} },
    loading: { hidden: true },
    loadingText: {},
    ctx: { game: { state: 'play' }, input: { pressed: () => false } },
    report(message) {
      this.error = message;
    },
    setState() {},
  };
  const p = { id: 'guest', pos: building.door, sceneId: 'outdoor', epoch: 0, active: true, hp: 100 };
  s.players.set(p.id, p);
  const acknowledgements = [];
  s.packets = { post: (...args) => acknowledgements.push(args) };
  s.chunks = {
    loaded: new Map([['0,0', { block: exterior }]]),
    async add(b) {
      this.loaded.set(blockKey(b), { block: b });
    },
  };
  const scenes = new BuildingScenes(s);
  scenes.waitingSeq = 2;
  scenes.waitingUntil = Date.now() + 10000;
  scenes.tick();
  assert.equal(s.loading.hidden, false);
  await scenes.receive('scene-error', { epoch: 0, seq: 1, message: 'old error' }, 'host');
  assert.equal(s.error, undefined);
  const prepare = {
    id: 3,
    epoch: 1,
    seq: 1,
    block,
    target: houseEntry(layout, 0, 0),
    state: { defeated: [], rewarded: false },
  };
  await scenes.receive('scene-prepare', prepare, 'host');
  assert.equal(acknowledgements.length, 0);
  await scenes.receive('scene-prepare', { ...prepare, seq: 2 }, 'host');
  assert.equal(acknowledgements[0][1], 'scene-loaded');
  let placed = false;
  scenes.place = () => {
    placed = true;
    scenes.waitingUntil = 0;
  };
  await scenes.receive('scene-commit', { id: 3, epoch: 1, target: prepare.target }, 'host');
  assert.equal(p.sceneId, building.id);
  assert.equal(placed, true);
  scenes.tick();
  assert.equal(s.loading.hidden, true);
});

test('house generator sends the floorplan contract and retries invalid plans once', async () => {
  let calls = 0;
  const gen = deepSeekGenerator({
    key: 'test-key',
    log() {},
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.match(body.messages[0].content, /floors/);
      assert.match(body.messages[0].content, /一至三层/);
      calls++;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify(calls === 1 ? { ...interiorExample, floors: [] } : interiorExample),
              },
            },
          ],
        }),
      };
    },
  });
  const result = await gen({
    design: { kind: 'house', context: {}, example: interiorExample },
    validate: validateInteriorPlan,
  });
  assert.equal(calls, 2);
  assert.equal(result.floors.length, 2);
});
