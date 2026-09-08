import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { WorldStore, deepSeekGenerator } from '../server/world-store.js';
import {
  PLOTS,
  themeExample,
  variationExample,
  validateTheme,
  validateVariation,
  validateStreetDesign,
  expandStreet,
  expandInterior,
  validateRegionLayout,
  doorPosition,
  entryPosition,
  sceneOf,
} from '../src/games/shooter/exploration/region.js';
import { buildChunk, Chunks } from '../src/games/shooter/exploration/chunks.js';
import { BuildingScenes } from '../src/games/shooter/exploration/scenes.js';
import { Exploration } from '../src/games/shooter/exploration/session.js';
import { NavGrid } from '../src/games/shooter/nav.js';
import { World, makeBody } from '../src/games/shooter/physics.js';
import { checksum, localPosition } from '../src/games/shooter/exploration/schema.js';
import { validateActor } from '../src/games/shooter/exploration/network.js';
import { disposeTree } from '../src/shared/resources.js';

async function setup(t, generate = async ({ design }) => structuredClone(design.example)) {
  const directory = await mkdtemp('/private/tmp/doodle-region-test-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new WorldStore(directory, generate);
  const info = await store.create('小区域测试', 2);
  store.claim(info.id, 'host');
  return { store, info, directory };
}
function street(x, z) {
  const design = {
    name: '模板街坊',
    buildings: PLOTS.filter((b) => b.cx === x && b.cz === z).map((b) => ({ id: b.id, ...variationExample })),
  };
  return expandStreet(validateStreetDesign(design, x, z), x, z);
}

test('all seven template doors and every furniture choice preserve physical paths and enemy space', () => {
  const count = {};
  for (const plot of PLOTS) {
    count[plot.templateId] = (count[plot.templateId] ?? 0) + 1;
    const layout = street(plot.cx, plot.cz);
    validateRegionLayout(layout, plot.cx, plot.cz);
    const exterior = layout.buildings.find((b) => b.id === plot.id);
    const built = buildChunk({ x: plot.cx, z: plot.cz, layout });
    const nav = new NavGrid(built.world, built.level.bounds, 2).build();
    const door = doorPosition(plot);
    assert.ok(
      nav.findPath(new THREE.Vector3(64, 0, 64), new THREE.Vector3(door.x, 0, door.z)),
      `${plot.id} exterior door`,
    );
    disposeTree(built.root);
    for (const item of ['empty', 'crate', 'table', 'shelf']) {
      const inside = expandInterior(exterior, { ...variationExample, slots: Array(4).fill(item) });
      validateRegionLayout(inside, plot.sceneX, plot.sceneZ);
      const room = buildChunk({ x: plot.sceneX, z: plot.sceneZ, layout: inside });
      const grid = new NavGrid(room.world, room.level.bounds, 1).build();
      const from = new THREE.Vector3(...[inside.entrance[0], 0, inside.entrance[1]]);
      assert.equal(room.world.overlapsBody(makeBody(from, 0.36, 1.75)), false);
      for (const target of [...(inside.outpost?.spawns ?? []), [64, 64], [64, 64 + inside.d / 2 - 2]]) {
        const to = new THREE.Vector3(target[0], 0, target[1]);
        assert.equal(room.world.overlapsBody(makeBody(to, 0.36, 1.85)), false);
        assert.ok(grid.findPath(from, to), `${plot.id} ${item} -> ${target}`);
      }
      const corrupted = structuredClone(inside);
      corrupted.solids[0].z = 64;
      assert.throws(() => validateRegionLayout(corrupted, plot.sceneX, 0));
      disposeTree(room.root);
    }
  }
  assert.deepEqual(count, { shop: 2, corner: 2, home: 2, warehouse: 1 });
});

test('V2 persists themes, deduplicates all generation layers, bounds the region and resets only the shared run', async (t) => {
  let calls = 0,
    active = 0,
    peak = 0;
  const generate = async ({ design }) => {
    calls++;
    peak = Math.max(peak, ++active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return structuredClone(design.example);
  };
  const { store, info, directory } = await setup(t, generate);
  assert.deepEqual(info.region, themeExample);
  assert.equal(calls, 2);
  await Promise.all(
    [
      [1, 0],
      [1, 0],
      [0, 1],
    ].map(([x, z]) => store.ensure(info.id, x, z, 'host')),
  );
  await store.ensure(info.id, 1, 1, 'host');
  const results = await Promise.all([...PLOTS, PLOTS[6]].map((b) => store.interior(info.id, b.id, 'host')));
  assert.equal(calls, 12);
  assert.equal(peak, 2);
  assert.deepEqual(results[6], results[7]);
  const before = calls;
  await assert.rejects(store.ensure(info.id, -1, 0, 'host'), /边界/);
  assert.equal(calls, before);
  let progress = await store.update(info.id, 'host', {
    revision: 0,
    run: { buildingId: 'building-7', runId: 1, defeated: [0, 1, 2, 3], rewarded: true },
  });
  const immutable = await readFile(store.path(info.id, 'chunks', '26,0.json'), 'utf8');
  progress = await store.update(info.id, 'host', {
    revision: progress.revision,
    run: { buildingId: 'building-7', runId: 1, reset: true },
  });
  assert.equal(progress.runs['building-7'].runId, 2);
  assert.deepEqual(progress.runs['building-7'].defeated, []);
  await assert.rejects(
    store.update(info.id, 'host', {
      revision: progress.revision,
      run: { buildingId: 'building-7', runId: 1, reset: true },
    }),
    /轮次/,
  );
  assert.equal(await readFile(store.path(info.id, 'chunks', '26,0.json'), 'utf8'), immutable);
  const restarted = new WorldStore(directory, () => {
    throw Error('must not regenerate');
  });
  restarted.claim(info.id, 'again');
  assert.deepEqual(await restarted.info(info.id), info);
  for (const b of PLOTS)
    assert.deepEqual(await restarted.interior(info.id, b.id, 'again'), results[PLOTS.indexOf(b)]);
  assert.deepEqual(await restarted.progress(info.id), progress);
  assert.equal(calls, before);
});

test('V2 invalid output, disk failure and truncated responses leave existing maps and progress intact', async (t) => {
  const { store, info } = await setup(t);
  const old = await readFile(store.path(info.id, 'progress.json'), 'utf8');
  const camp = await store.chunk(info.id, 0, 0);
  store.generate = async () => ({});
  await assert.rejects(store.ensure(info.id, 1, 0, 'host'));
  assert.equal(await store.chunk(info.id, 1, 0), null);
  assert.deepEqual(await store.chunk(info.id, 0, 0), camp);
  store.generate = async ({ design }) => structuredClone(design.example);
  await mkdir(store.path(info.id, 'chunks', '1,0.json'));
  await assert.rejects(store.ensure(info.id, 1, 0, 'host'));
  assert.equal(await readFile(store.path(info.id, 'progress.json'), 'utf8'), old);
  await writeFile(
    store.path(info.id, 'chunks', '0,0.json'),
    JSON.stringify({ ...camp, checksum: 'damaged' }),
  );
  await assert.rejects(store.chunk(info.id, 0, 0), /校验/);
  let requests = 0;
  const generator = deepSeekGenerator({
    key: 'test',
    log() {},
    fetchImpl: async () => {
      requests++;
      return {
        ok: true,
        json: async () => ({
          choices: [{ finish_reason: 'length', message: { content: JSON.stringify(themeExample) } }],
        }),
      };
    },
  });
  await assert.rejects(
    generator({ design: { kind: 'theme', context: {}, example: themeExample }, validate: validateTheme }),
    /截断/,
  );
  assert.equal(requests, 2);
});

test('bounded template prompts never send oversized context or accept invalid variation enums', async () => {
  let requests = 0;
  const generator = deepSeekGenerator({
    key: 'test',
    log() {},
    fetchImpl: async (_url, options) => {
      requests++;
      assert.ok(Buffer.byteLength(JSON.stringify(JSON.parse(options.body).messages)) <= 65536);
      return {
        ok: true,
        json: async () => ({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(variationExample) } }],
        }),
      };
    },
  });
  assert.deepEqual(
    await generator({
      design: { kind: 'interior', context: {}, example: variationExample },
      validate: validateVariation,
    }),
    variationExample,
  );
  await assert.rejects(
    generator({
      design: { kind: 'interior', context: { enormous: '城'.repeat(1000000) } },
      validate: validateVariation,
    }),
    /64 KiB/,
  );
  assert.equal(requests, 1);
  assert.throws(() => validateVariation({ ...variationExample, palette: 'javascript' }));
  assert.throws(() => validateVariation({ ...variationExample, slots: ['door'] }));
});

function sessionFixture() {
  const s = Object.create(Exploration.prototype);
  Object.assign(s, {
    info: { schemaVersion: 2 },
    isHost: true,
    selfId: 'host',
    players: new Map(),
    manifest: new Set(),
    pendingKills: new Map(),
    saving: 0,
    unsaved: [],
    requests: new Map(),
    failed: new Map(),
    grenades: [],
    progress: { chunks: {}, runs: {} },
    ctx: { player: { nades: [] }, enemies: { enemies: [], projectiles: { list: [] } }, hud: { tip() {} } },
    report(message) {
      this.error = message;
    },
    render() {},
  });
  s.chunks = {
    loaded: new Map(),
    position: (p) => new THREE.Vector3(...localPosition(p, [0, 0])),
    address: (v) => ({
      cx: Math.floor(v.x / 128),
      cz: Math.floor(v.z / 128),
      x: v.x % 128,
      y: v.y,
      z: v.z % 128,
    }),
    async add(block) {
      this.loaded.set(keyOf(block.x, block.z), { block });
    },
  };
  s.scenes = new BuildingScenes(s);
  return s;
}
function keyOf(x, z) {
  return `${x},${z}`;
}

test('host scene transfer requires matching load ack; walking away cancels; replay and cross-scene movement are rejected', async () => {
  const s = sessionFixture(),
    b = PLOTS[0];
  const p = s.newActor('guest', '访客', doorPosition(b));
  p.active = true;
  s.players.set(p.id, p);
  const layout = expandInterior(street(0, 0).buildings[0], variationExample);
  const block = { x: b.sceneX, z: 0, layout, checksum: await checksum(layout) };
  s.api = { call: async () => block };
  const sent = [];
  s.packets = { post: (...args) => sent.push(args) };
  await s.scenes.interact(p, { epoch: 0, seq: 1 });
  assert.equal(p.sceneId, 'outdoor');
  assert.equal(sent[0][1], 'scene-prepare');
  const pending = p.transition;
  await s.scenes.receive('scene-loaded', { id: pending.id + 1, epoch: 1, checksum: block.checksum }, p.id);
  assert.equal(p.sceneId, 'outdoor');
  await s.scenes.receive('scene-loaded', { id: pending.id, epoch: 1, checksum: block.checksum }, p.id);
  assert.equal(p.sceneId, b.id);
  assert.equal(p.epoch, 1);
  assert.deepEqual(p.pos, entryPosition(b));
  await s.scenes.receive('scene-loaded', { id: pending.id, epoch: 1, checksum: block.checksum }, p.id);
  assert.equal(p.epoch, 1);
  assert.throws(() => validateActor({ ...p, pos: doorPosition(b) }), /场景/);
  assert.throws(() => s.acceptState(p, { ...p, pos: doorPosition(b), sceneId: 'outdoor' }), /跨场景/);
  s.acceptState(p, { ...p, pos: doorPosition(b), sceneId: 'outdoor', epoch: 0 });
  assert.equal(p.sceneId, b.id);
  Object.assign(p, { pos: doorPosition(b), sceneId: 'outdoor', epoch: 2 });
  let resolve;
  s.scenes.known.clear();
  s.api.call = () =>
    new Promise((r) => {
      resolve = r;
    });
  const entering = s.scenes.interact(p, { epoch: 2, seq: 2 });
  p.pos = { ...p.pos, x: p.pos.x + 12 };
  resolve(block);
  await entering;
  assert.equal(p.transition, null);
  assert.equal(p.sceneId, 'outdoor');
});

test('occupied or active warehouse cannot reset; successful reset and stale kills cannot duplicate reward', async () => {
  const s = sessionFixture(),
    b = PLOTS[6],
    p = s.newActor('host', '房主', doorPosition(b));
  p.active = true;
  s.players.set(p.id, p);
  const guest = s.newActor('guest', '访客', entryPosition(b));
  guest.sceneId = b.id;
  s.players.set(guest.id, guest);
  await assert.rejects(s.scenes.interact(p, { epoch: 0, reset: true, seq: 1 }), /仍有人/);
  s.players.delete(guest.id);
  s.grenades.push({ pos: s.chunks.position(entryPosition(b)) });
  await assert.rejects(s.scenes.interact(p, { epoch: 0, reset: true, seq: 2 }), /投射物/);
  s.grenades = [];
  s.manifest.add('26,0');
  let resets = 0;
  s.save = async (patch, after) => {
    assert.equal(patch().run.runId, 1);
    resets++;
    s.progress.runs[b.id] = { runId: 2, defeated: [], rewarded: false };
    after();
  };
  await s.scenes.interact(p, { epoch: 0, reset: true, seq: 3 });
  s.killed({ chunk: '26,0', spawnIndex: 0, runId: 1 });
  assert.equal(resets, 1);
  assert.equal(s.pendingKills.size, 0);
});

test('interior and outdoor rendering, collision and unloading stay bounded across repeated visits', async () => {
  const ctx = {
    scene: new THREE.Scene(),
    world: new World(),
    level: { rings: [] },
    exploration: { info: { schemaVersion: 2 } },
  };
  const chunks = new Chunks(ctx);
  const b = PLOTS[0],
    exterior = street(0, 0),
    interior = expandInterior(exterior.buildings[0], variationExample);
  for (let i = 0; i < 12; i++) {
    await chunks.add({ x: 0, z: 0, layout: exterior });
    await chunks.add({ x: b.sceneX, z: 0, layout: interior });
    chunks.visible(new THREE.Vector3(64, 0, 64));
    assert.equal(chunks.loaded.get('8,0').root.visible, false);
    chunks.visible(chunks.position(entryPosition(b)));
    assert.equal(chunks.loaded.get('0,0').root.visible, false);
    assert.equal(sceneOf(entryPosition(b)), b.id);
    chunks.remove('8,0');
    chunks.remove('0,0');
    chunks.rebuild();
    assert.equal(ctx.scene.children.length, 0);
    assert.equal(ctx.world.boxes.length, 0);
  }
  chunks.dispose();
});

test('real player keeps weapon state across doors; separated outdoor and warehouse enemies target only their own players', async () => {
  const { Player } = await import('../src/games/shooter/player.js');
  const { EnemyManager } = await import('../src/games/shooter/enemies/manager.js');
  const { Effects } = await import('../src/games/shooter/effects.js');
  const hud = Object.fromEntries(
    [
      'setAds',
      'setScope',
      'setWeapon',
      'setCrosshairMode',
      'grappleTarget',
      'message',
      'tip',
      'damageFrom',
      'hitmarker',
      'kill',
    ].map((k) => [k, () => {}]),
  );
  const ctx = {
    scene: new THREE.Scene(),
    world: new World(),
    camera: new THREE.PerspectiveCamera(),
    level: {
      playerStart: new THREE.Vector3(64, 0, 64),
      rings: [],
      animated: [],
      grappleMovers: [],
      breakables: [],
    },
    input: {
      move: { x: 0, y: 0 },
      look: { x: 0, y: 0 },
      wheel: 0,
      down: () => false,
      pressed: () => false,
      rumble() {},
    },
    hud,
    game: { time: 0, hitstop() {}, addScore() {}, onPlayerDeath() {} },
    pvp: { enabled: true },
  };
  ctx.effects = new Effects(ctx.scene, ctx.world);
  ctx.enemies = new EnemyManager(ctx);
  ctx.player = new Player(ctx);
  const s = sessionFixture();
  s.ctx = ctx;
  s.remotes = new Map();
  ctx.exploration = s;
  s.chunks = new Chunks(ctx);
  const b = PLOTS[6],
    outside = street(1, 1),
    interior = expandInterior(outside.buildings[0], variationExample);
  await s.chunks.add({ x: 1, z: 1, layout: outside });
  await s.chunks.add({ x: b.sceneX, z: 0, layout: interior });
  const host = s.newActor('host', '房主', { cx: 1, cz: 1, x: 64, y: 0, z: 64 });
  host.active = true;
  const guest = s.newActor('guest', '队友', entryPosition(b));
  guest.active = true;
  guest.sceneId = b.id;
  s.players.set(host.id, host);
  s.players.set(guest.id, guest);
  s.remote(guest, 0.05);
  ctx.player.reset(s.chunks.position(host.pos));
  ctx.player.update(0.01);
  s.spawnOutposts();
  assert.equal(ctx.enemies.enemies.length, 8);
  for (let i = 0; i < 40; i++) {
    ctx.game.time += 1 / 60;
    ctx.enemies.update(1 / 60);
  }
  for (const e of ctx.enemies.enemies)
    assert.equal(s.pickTarget(e), e.sceneId === b.id ? s.remotes.get('guest') : ctx.player);
  assert.deepEqual(s.targets(s.chunks.position(guest.pos)), [s.remotes.get('guest')]);
  ctx.player.weapons[0].mag = 9;
  ctx.player.weapons[0].reserve = 48;
  ctx.player.hp = 63;
  ctx.player.grenades = 1;
  const ammo = ctx.player.weapons.filter((w) => w.isGun).map((w) => [w.mag, w.reserve]);
  host.pos = entryPosition(b);
  host.sceneId = b.id;
  host.epoch++;
  s.scenes.place(host);
  assert.equal(ctx.player.hp, 63);
  assert.equal(ctx.player.grenades, 1);
  assert.deepEqual(
    ctx.player.weapons.filter((w) => w.isGun).map((w) => [w.mag, w.reserve]),
    ammo,
  );
  const logical = s.chunks.address(ctx.player.body.pos);
  s.chunks.rebase(ctx.player.body.pos, [ctx.player, ...s.remotes.values()]);
  assert.deepEqual(s.chunks.address(ctx.player.body.pos), logical);
  host.pos = doorPosition(b);
  host.sceneId = 'outdoor';
  host.epoch++;
  s.scenes.place(host);
  assert.deepEqual(s.chunks.address(ctx.player.body.pos), doorPosition(b));
  assert.equal(ctx.player.hp, 63);
  assert.equal(ctx.player.weapons[0].mag, 9);
  ctx.enemies.clear();
  ctx.effects.clear();
  s.removeRemote('guest');
  s.chunks.dispose();
  disposeTree(ctx.scene);
});

test('stale scene attacks cannot damage or spend grenades, and duplicate reset interactions are ignored', async () => {
  const s = sessionFixture(),
    b = PLOTS[6],
    p = s.newActor('host', '房主', doorPosition(b));
  p.active = true;
  s.players.set(p.id, p);
  s.ctx.game = { time: 5 };
  s.action(p.id, { action: 'grenade', epoch: -1, sceneId: 'outdoor', seq: 1, life: p.life });
  assert.equal(p.grenades, 3);
  assert.equal(s.grenades.length, 0);
  s.manifest.add('26,0');
  let resets = 0;
  s.save = async () => {
    resets++;
  };
  await s.scenes.interact(p, { epoch: 0, seq: 1, reset: true });
  await s.scenes.interact(p, { epoch: 0, seq: 1, reset: true });
  assert.equal(resets, 1);
});

test('legacy actors may explore coordinates reserved for V2 interiors without changing old world rules', () => {
  const s = Object.create(Exploration.prototype);
  s.info = { schemaVersion: 1 };
  const p = s.newActor('host', '旧世界', { cx: 8, cz: 0, x: 64, y: 0, z: 64 });
  assert.equal(validateActor(p), p);
  assert.equal(p.sceneId, undefined);
});

test('camp supplies are host-controlled, require proximity, and ignore repeated requests', async () => {
  const s = sessionFixture();
  const p = s.newActor('host', '房主', { cx: 0, cz: 0, x: 68, y: 0, z: 68 });
  p.active = true;
  s.players.set(p.id, p);
  await s.scenes.interact(p, { epoch: 0, seq: 1 });
  await s.scenes.interact(p, { epoch: 0, seq: 1 });
  await s.scenes.interact(p, { epoch: 0, seq: 2 });
  assert.equal(p.reward, 1);
  assert.equal(p.grenades, 4);
  p.supplyAt = 0;
  p.pos.x = 100;
  await s.scenes.interact(p, { epoch: 0, seq: 3 });
  assert.equal(p.reward, 1);
});
