import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import * as THREE from 'three';
import { WorldStore, deepSeekGenerator } from '../server/world-store.js';
import {
  campLayout,
  exits,
  validateLayout,
  address,
  localPosition,
  checksum,
  validateGeneratedLayout,
} from '../src/games/shooter/exploration/schema.js';
import { Chunks, buildChunk } from '../src/games/shooter/exploration/chunks.js';
import { roadsidePlan } from '../src/games/shooter/exploration/roadside.js';
import { enterableBuildings } from '../src/games/shooter/exploration/interiors.js';
import { NavGrid } from '../src/games/shooter/nav.js';
import { World, makeBody } from '../src/games/shooter/physics.js';
import { Packets } from '../src/games/shooter/exploration/network.js';
import { Exploration } from '../src/games/shooter/exploration/session.js';
import { Player } from '../src/games/shooter/player.js';
import { EnemyManager } from '../src/games/shooter/enemies/manager.js';
import { Effects } from '../src/games/shooter/effects.js';
import { disposeTree } from '../src/shared/resources.js';
import { randomizeEncounter } from '../src/games/shooter/exploration/encounters.js';
import { ENCOUNTER_TYPES, validateProgress } from '../src/games/shooter/exploration/schema.js';
import { TYPES } from '../src/games/shooter/enemies/types.js';

function layout(seed, x, z) {
  const roads = exits(seed, x, z).flatMap(([a, b]) =>
    a === 64 || b === 64
      ? [[a, b, 64, 64]]
      : [
          [a, b, 64, b],
          [64, b, 64, 64],
        ],
  );
  return validateLayout(
    {
      name: '测试街区',
      roads,
      buildings: [20, 108].flatMap((x) => [20, 108].map((z) => ({ x, z, w: 8, d: 8, h: 8 }))),
      cover: [],
      landmark: [64, 64],
      supply: [68, 68],
      outpost:
        x === 0 && z === 0
          ? null
          : {
              center: [64, 64],
              spawns: [
                [52, 52],
                [76, 52],
                [52, 76],
                [76, 76],
              ],
            },
    },
    seed,
    x,
    z,
  );
}

test('roadside scenery is stable and keeps actual paths to exits, encounters and house doors', () => {
  for (let i = 0; i < 12; i++) {
    const seed = `road-${i}`,
      block = { x: 1, z: 0, layout: layout(seed, 1, 0) },
      original = JSON.stringify(block);
    const plan = roadsidePlan(block);
    assert.ok(plan.length >= 30 && plan.length <= 64);
    assert.deepEqual(
      new Set(plan.map((a) => a.kind)),
      new Set(['puddle', 'barrier', 'sign', 'mound', 'rock', 'grass']),
    );
    assert.deepEqual(roadsidePlan(JSON.parse(original)), plan);
    assert.equal(JSON.stringify(block), original);
    const built = buildChunk(block);
    try {
      const nav = new NavGrid(built.world, built.level.bounds, 2).build();
      const first = exits(seed, 1, 0)[0],
        start = new THREE.Vector3(first[0], 0, first[1]);
      const goals = [
        ...exits(seed, 1, 0),
        block.layout.supply,
        block.layout.landmark,
        ...block.layout.outpost.spawns,
        ...enterableBuildings(block).map((b) => [b.door.x, b.door.z]),
      ];
      for (const [x, z] of goals)
        assert.ok(nav.findPath(start, new THREE.Vector3(x, 0, z)), `${seed} path to ${x},${z}`);
      assert.ok(built.root.children.length <= 16, 'geometry must be batched by material');
    } finally {
      disposeTree(built.root);
    }
  }
  assert.deepEqual(roadsidePlan({ layout: { interior: true } }), []);
  assert.deepEqual(roadsidePlan({ layout: { schemaVersion: 2 } }), []);
});

test('mounds can be climbed, barriers stop walking and bullets, and shallow puddles stay walkable', () => {
  const block = { x: 1, z: 0, layout: layout('physical-props', 1, 0) },
    built = buildChunk(block);
  const walk = (a) => {
    const body = makeBody(new THREE.Vector3(a.x - a.w / 2 - 0.8, 0, a.z), 0.35, 1.75);
    body.onGround = true;
    let highest = 0;
    for (let i = 0; i < 180; i++) {
      body.vel.set(3, -1, 0);
      built.world.moveBody(body, 1 / 60);
      highest = Math.max(highest, body.pos.y);
      if (body.pos.x > a.x + a.w / 2 + 0.5) break;
    }
    return { body, highest };
  };
  try {
    const mound = built.level.roadside.find((a) => a.kind === 'mound');
    const crossed = walk(mound);
    assert.ok(crossed.highest >= mound.h - 0.01);
    assert.ok(crossed.body.pos.x > mound.x + mound.w / 2);
    const barrier = built.level.roadside.find((a) => a.kind === 'barrier');
    const stopped = walk(barrier);
    assert.ok(stopped.body.pos.x < barrier.x);
    const hit = built.world.raycast(
      new THREE.Vector3(barrier.x - barrier.w / 2 - 0.5, 0.65, barrier.z),
      new THREE.Vector3(1, 0, 0),
      barrier.w + 1,
    );
    assert.equal(hit?.box.data.tag, 'roadside-barrier');
    const puddle = built.level.roadside.find((a) => a.kind === 'puddle');
    const wet = walk(puddle);
    assert.ok(wet.body.pos.x > puddle.x + puddle.w / 2);
    assert.ok(wet.highest < 0.1);
  } finally {
    disposeTree(built.root);
  }
});

test('encounters vary in count, positions and weapons while keeping a stable traversable layout', () => {
  const counts = new Set(),
    types = new Set();
  for (let i = 0; i < 160; i++) {
    const seed = `encounter-${i}`,
      original = layout(seed, 1, 0);
    const result = randomizeEncounter(original, seed, 1, 0);
    assert.deepEqual(randomizeEncounter(original, seed, 1, 0), result);
    assert.deepEqual(randomizeEncounter(result, seed, 1, 0), result);
    assert.deepEqual(result.buildings, original.buildings);
    counts.add(result.outpost.spawns.length);
    result.outpost.types.forEach((type) => types.add(type));
    for (const [index, p] of result.outpost.spawns.entries())
      for (const q of result.outpost.spawns.slice(index + 1))
        assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) >= 12);
  }
  assert.deepEqual([...counts].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...types].sort(), [...ENCOUNTER_TYPES].sort());
});

test('old encounter upgrade backs up untouched fights and preserves partial and completed progress', async (t) => {
  const { store, info, directory } = await storeFor(t);
  const finished = await store.ensure(info.id, 1, 0, 'host');
  const partial = await store.ensure(info.id, 0, 1, 'host');
  const untouched = await store.ensure(info.id, 1, 1, 'host');
  await store.update(info.id, 'host', {
    revision: 0,
    chunk: [1, 0],
    state: { defeated: [0, 1, 2, 3], rewarded: true },
  });
  await store.update(info.id, 'host', {
    revision: 1,
    chunk: [0, 1],
    state: { defeated: [1], rewarded: false },
  });
  store.generate = () => {
    throw Error('upgrade must not call AI');
  };
  assert.equal((await store.prepareEncounters(info.id, 'host')).encounterVersion, 1);
  assert.deepEqual(await store.chunk(info.id, 1, 0), finished);
  assert.deepEqual(await store.chunk(info.id, 0, 1), partial);
  const upgraded = await store.chunk(info.id, 1, 1);
  assert.equal(upgraded.layout.outpost.encounterVersion, 1);
  assert.deepEqual(upgraded.layout.roads, untouched.layout.roads);
  assert.deepEqual(upgraded.layout.buildings, untouched.layout.buildings);
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, info.id, 'encounter-backups', '1,1.json'), 'utf8')),
    untouched,
  );
  const restored = new WorldStore(directory, ({ seed, x, z }) => layout(seed, x, z));
  restored.claim(info.id, 'host');
  await restored.prepareEncounters(info.id, 'host');
  assert.deepEqual(await restored.chunk(info.id, 1, 1), upgraded);
  assert.equal((await restored.ensure(info.id, 2, 1, 'host')).layout.outpost.encounterVersion, 1);
  assert.deepEqual((await restored.progress(info.id)).chunks['0,1'].defeated, [1]);
});

test('variable encounter totals reject early rewards and save one reward after the last enemy', async (t) => {
  for (const total of [1, 3, 8]) {
    const { store, info } = await storeFor(t, ({ seed, x, z }) => {
      const base = layout(seed, x, z);
      return {
        ...base,
        outpost: {
          center: [64, 64],
          encounterVersion: 1,
          types: Array(total).fill('heavy'),
          spawns: [
            [40, 40],
            [52, 40],
            [64, 40],
            [76, 40],
            [88, 40],
            [40, 52],
            [52, 52],
            [64, 52],
          ].slice(0, total),
        },
      };
    });
    const block = await store.ensure(info.id, 1, 0, 'host');
    assert.throws(() => validateProgress({ total, defeated: [total], rewarded: false }));
    await assert.rejects(
      store.update(info.id, 'host', {
        revision: 0,
        chunk: [1, 0],
        state: { total, defeated: [], rewarded: true },
      }),
    );
    if (total > 1)
      await assert.rejects(
        store.update(info.id, 'host', {
          revision: 0,
          chunk: [1, 0],
          state: { total: 1, defeated: [0], rewarded: true },
        }),
      );
    const session = Object.create(Exploration.prototype);
    Object.assign(session, {
      isHost: true,
      info,
      progress: await store.progress(info.id),
      saves: Promise.resolve(),
      saving: 0,
      unsaved: [],
      pendingKills: new Map(),
      players: new Map(),
      ctx: { hud: { tip() {} } },
      render() {},
      report() {},
      failed: new Map(),
      chunks: { loaded: new Map([['1,0', { block }]]) },
    });
    const p = session.newActor('host', '房主', { cx: 1, cz: 0, x: 64, y: 0, z: 64 });
    session.players.set(p.id, p);
    session.api = {
      call: async (_path, method, patch) =>
        method === 'POST' ? store.update(info.id, 'host', patch) : store.progress(info.id),
    };
    for (let index = 0; index < total; index++) {
      session.killed({ chunk: '1,0', spawnIndex: index });
      await session.saves;
      assert.equal(p.reward, index === total - 1 ? 1 : 0);
    }
    session.killed({ chunk: '1,0', spawnIndex: total - 1 });
    await session.saves;
    assert.equal(p.reward, 1);
    assert.equal(session.unsaved.length, 0);
    assert.equal((await store.progress(info.id)).chunks['1,0'].safePosition.cx, 1);
  }
});

test('enemy arrivals are staggered by proximity and do not respawn defeated enemies', () => {
  const session = Object.create(Exploration.prototype),
    born = [],
    byId = new Map();
  const item = {
    key: '1,0',
    x: 1,
    z: 0,
    block: {
      layout: {
        outpost: {
          encounterVersion: 1,
          center: [64, 64],
          spawns: [
            [20, 20],
            [50, 20],
            [100, 100],
          ],
          types: ['heavy', 'shield', 'sniper'],
        },
      },
    },
  };
  const player = { active: true, hp: 110, pos: { cx: 1, cz: 0, x: 20, y: 0, z: 4 } };
  Object.assign(session, {
    info: { seed: 'arrivals', schemaVersion: 1 },
    progress: { chunks: {} },
    pendingKills: new Map(),
    players: new Map([['host', player]]),
    chunks: {
      loaded: new Map([['1,0', item]]),
      position: (p) => new THREE.Vector3(...localPosition(p, [0, 0])),
    },
    ctx: {
      game: { time: 0 },
      enemies: {
        byId,
        spawn(type, pos, id) {
          const e = { type, pos, id };
          byId.set(id, e);
          born.push({ ...e, time: session.ctx.game.time });
          return e;
        },
      },
    },
  });
  const tick = (start, end) => {
    for (let i = start; i <= end; i++) {
      session.ctx.game.time = i / 10;
      session.spawnOutposts();
    }
  };
  tick(0, 100);
  assert.equal(born.length, 2);
  assert.ok(born[1].time - born[0].time >= 0.8);
  assert.deepEqual(born.map((e) => e.type).sort(), ['heavy', 'shield']);
  player.pos.x = 100;
  player.pos.z = 100;
  tick(101, 150);
  assert.equal(born.length, 2);
  player.pos.z = 80;
  tick(151, 250);
  assert.equal(born.length, 3);
  assert.equal(born[2].type, 'sniper');
  session.progress.chunks['1,0'] = { total: 3, defeated: [0, 1, 2], rewarded: true };
  byId.clear();
  tick(251, 350);
  assert.equal(born.length, 3);
});

test('guest snapshots render every encounter weapon and accept heavy enemy health', () => {
  const session = Object.create(Exploration.prototype);
  const ctx = { scene: new THREE.Scene(), effects: { strokeBurst() {} } };
  ctx.enemies = new EnemyManager(ctx);
  const pos = { cx: 1, cz: 0, x: 64, y: 0, z: 64 };
  Object.assign(session, {
    info: { schemaVersion: 1 },
    selfId: 'guest',
    players: new Map(),
    acceptedRevision: 0,
    progress: { chunks: {} },
    remotes: new Map(),
    ctx,
    render() {},
    applyHealth() {},
    chunks: {
      loaded: new Map([['1,0', {}]]),
      position: (p) => new THREE.Vector3(...localPosition(p, [0, 0])),
    },
  });
  const p = session.newActor('guest', '队友', pos);
  session.players.set(p.id, p);
  const enemies = ENCOUNTER_TYPES.map((type, index) => ({
    id: `enemy-${index}`,
    type,
    hp: TYPES[type].hp,
    pos,
    chunk: '1,0',
    yaw: 0,
  }));
  try {
    session.applySnapshot({ revision: 1, players: [p], enemies, bullets: [], chunks: [], error: '' });
    assert.deepEqual(
      ctx.enemies.enemies.map((e) => e.T.weapon),
      ['rifle', 'blade', 'shotgun', 'sniper', 'pistol'],
    );
    assert.equal(ctx.enemies.byId.get('enemy-2').hp, 320);
    assert.equal(ctx.enemies.byId.get('enemy-4').hp, 150);
    assert.throws(
      () =>
        session.applySnapshot({
          revision: 2,
          players: [p],
          enemies: [{ ...enemies[0], hp: 320 }],
          bullets: [],
          chunks: [],
          error: '',
        }),
      /敌人状态无效/,
    );
  } finally {
    ctx.enemies.clear();
    disposeTree(ctx.scene);
  }
});

test('AI world creation requires populated land and never saves an empty fallback on failure', async (t) => {
  const { store, directory } = await storeFor(t);
  const info = await store.create('持续探索', 1, true);
  assert.equal(info.schemaVersion, 1);
  assert.equal(info.aiGenerated, true);
  const camp = await store.chunk(info.id, 0, 0);
  assert.ok(camp.layout.buildings.length >= 4);
  assert.equal(camp.layout.outpost, null);
  assert.throws(() => validateGeneratedLayout(campLayout('s'), 's', 0, 0), /四栋建筑/);
  const before = await store.list();
  const unavailable = new WorldStore(directory, () => {
    throw new Error('未配置 DEEPSEEK_API_KEY');
  });
  await assert.rejects(unavailable.create('不能创建空地图', 1, true), /DEEPSEEK_API_KEY/);
  assert.deepEqual(await store.list(), before);
});

test('stationary explorers prefetch adjacent regions beyond the old 2x2 map in either direction', () => {
  for (const [cx, cz] of [
    [0, 0],
    [2, -3],
    [-20, 16],
  ]) {
    const requested = [];
    const s = Object.create(Exploration.prototype);
    Object.assign(s, {
      selfId: 'host',
      progress: { generationPaused: false },
      failed: new Map(),
      requests: new Map(),
      manifest: new Set([`${cx},${cz}`]),
      chunks: { loaded: new Map() },
      load(x, z, generate) {
        requested.push([x, z, generate]);
        return Promise.resolve();
      },
    });
    const p = { id: 'host', active: true, pos: { cx, cz, x: 64, z: 64 }, velocity: [0, 0, 0] };
    s.frontier(p);
    assert.equal(requested.length, 4);
    assert.ok(requested.some(([x, z, gen]) => x === cx - 1 && z === cz && gen));
    assert.ok(requested.some(([x, z, gen]) => x === cx && z === cz + 1 && gen));
    requested.length = 0;
    s.progress.generationPaused = true;
    s.frontier(p);
    assert.equal(requested.length, 0);
    s.progress.generationPaused = false;
    s.failed.set(`${cx - 1},${cz}`, '模型失败');
    s.frontier(p);
    assert.equal(requested.length, 3);
  }
});

test('world UI creation does not fall back to a blank legacy save when AI is unavailable', async () => {
  const calls = [];
  const s = Object.create(Exploration.prototype);
  Object.assign(s, {
    generation: 0,
    render() {},
    report(message) {
      this.error = message;
    },
    api: {
      async call(path, method, body) {
        calls.push(body);
        throw new Error('未配置 DEEPSEEK_API_KEY');
      },
    },
  });
  await s.host(null, '新世界', '玩家');
  assert.deepEqual(calls, [{ name: '新世界', schemaVersion: 1, aiGenerated: true }]);
  assert.match(s.error, /DEEPSEEK_API_KEY/);
  assert.equal(s.busy, false);
});
async function storeFor(t, generator = ({ seed, x, z }) => layout(seed, x, z)) {
  const directory = await mkdtemp(join(tmpdir(), 'doodle-world-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new WorldStore(directory, generator),
    info = await store.create('测试世界');
  store.claim(info.id, 'host');
  return { store, info, directory };
}

test('region exits agree in both directions; malformed and blocked layouts fail closed', () => {
  for (let n = 0; n < 30; n++) {
    const seed = String(n),
      a = exits(seed, -3, 7),
      east = exits(seed, -2, 7),
      south = exits(seed, -3, 8);
    assert.equal(a[1][1], east[3][1]);
    assert.equal(a[2][0], south[0][0]);
    campLayout(seed);
  }
  const good = layout('seed', 1, 0);
  for (const bad of [
    null,
    {},
    { ...good, roads: [] },
    { ...good, outpost: null },
    { ...good, buildings: [{ x: 64, z: 64, w: 12, d: 12, h: 8 }] },
    { ...good, cover: [{ x: NaN, z: 12, w: 1, d: 1, h: 1 }] },
  ])
    assert.throws(() => validateLayout(bad, 'seed', 1, 0));
});

test('generation is deduplicated, limited to two calls, persisted and never regenerated on revisit', async (t) => {
  let calls = 0,
    running = 0,
    peak = 0;
  const { store, info, directory } = await storeFor(t, async ({ seed, x, z }) => {
    calls++;
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return layout(seed, x, z);
  });
  const blocks = await Promise.all(
    [
      [1, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].map(([x, z]) => store.ensure(info.id, x, z, 'host')),
  );
  assert.equal(calls, 4);
  assert.equal(peak, 2);
  assert.deepEqual(blocks[0], blocks[1]);
  const restarted = new WorldStore(directory, () => {
    throw Error('must not generate');
  });
  restarted.claim(info.id, 'new-host');
  assert.deepEqual(await restarted.ensure(info.id, 1, 0, 'new-host'), blocks[0]);
  await assert.rejects(store.ensure(info.id, 5, 5, 'host'), /相邻/);
});

test('leases, revisions, irreversible outpost progress and interrupted writes preserve old data', async (t) => {
  const { store, info } = await storeFor(t);
  assert.throws(() => store.claim(info.id, 'other'), /活跃房主/);
  await store.ensure(info.id, 1, 0, 'host');
  const patch = { revision: 0, chunk: [1, 0], state: { defeated: [0, 1, 2, 3], rewarded: true } };
  const results = await Promise.allSettled([
    store.update(info.id, 'host', patch),
    store.update(info.id, 'host', patch),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await assert.rejects(
    store.update(info.id, 'host', { ...patch, revision: 1, state: { defeated: [0], rewarded: false } }),
    /回退/,
  );
  const saved = await readFile(store.path(info.id, 'progress.json'), 'utf8');
  await writeFile(store.path(info.id, 'progress.json.interrupted.tmp'), '{');
  assert.equal((await store.progress(info.id)).chunks['1,0'].rewarded, true);
  store.leases.get(info.id).until = 0;
  await assert.rejects(store.update(info.id, 'host', { revision: 1, generationPaused: true }), /失效/);
  assert.equal(await readFile(store.path(info.id, 'progress.json'), 'utf8'), saved);
  store.claim(info.id, 'host');
  const target = store.path(info.id, 'chunks', '0,1.json');
  await mkdir(target);
  await assert.rejects(store.ensure(info.id, 0, 1, 'host'));
  assert.equal(await readFile(store.path(info.id, 'progress.json'), 'utf8'), saved);
});

test('damaged cached maps never silently regenerate', async (t) => {
  let generated = 0;
  const { store, info } = await storeFor(t, ({ seed, x, z }) => {
    generated++;
    return layout(seed, x, z);
  });
  const block = await store.ensure(info.id, 1, 0, 'host');
  block.layout.name = '被修改';
  await writeFile(store.path(info.id, 'chunks', '1,0.json'), JSON.stringify(block));
  await assert.rejects(store.ensure(info.id, 1, 0, 'host'), /校验/);
  assert.equal(generated, 1);
});

test('DeepSeek output errors retry once; auth errors and cached-only mode never loop', async () => {
  const context = { seed: 's', x: 1, z: 0, neighbors: [] };
  for (const content of ['', '{', JSON.stringify({}), JSON.stringify(layout('s', 1, 0))]) {
    let count = 0;
    const generate = deepSeekGenerator({
      key: 'test-only',
      log() {},
      fetchImpl: async (_url, opts) => {
        const request = JSON.parse(opts.body);
        assert.equal(request.response_format.type, 'json_object');
        count++;
        const prompt = JSON.parse(request.messages[1].content);
        validateLayout(prompt.reference, context.seed, context.x, context.z);
        if (count === 2) {
          assert.equal(prompt.correction.previousOutput, content);
          assert.ok(prompt.correction.error.length > 0);
        }
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                finish_reason:
                  count === 1 && content === JSON.stringify(layout('s', 1, 0)) ? 'length' : 'stop',
                message: { content: count === 1 ? content : JSON.stringify(layout('s', 1, 0)) },
              },
            ],
          }),
        };
      },
    });
    assert.equal((await generate(context)).name, '测试街区');
    assert.equal(count, 2);
  }
  for (const status of [401, 402]) {
    let count = 0;
    await assert.rejects(
      deepSeekGenerator({
        key: 'test-only',
        log() {},
        fetchImpl: async () => {
          count++;
          return { ok: false, status };
        },
      })(context),
      /HTTP/,
    );
    assert.equal(count, 1);
  }
  await assert.rejects(deepSeekGenerator({ key: '', log() {} })(context), /DEEPSEEK_API_KEY/);
});

test('world packets reassemble bounded payloads and reject duplicates and oversized fragments', () => {
  const frames = [],
    delivered = [];
  const sender = new Packets(
    (_id, frame) => frames.push(frame),
    () => {},
  );
  const receiver = new Packets(
    () => {},
    (type, data, from) => delivered.push({ type, data, from }),
  );
  sender.post('guest', 'chunk', { name: '街'.repeat(8000) });
  for (const frame of [...frames].reverse()) receiver.accept(frame, 'host');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].data.name.length, 8000);
  receiver.accept(frames[0], 'host');
  assert.throws(() => receiver.accept(frames[0], 'host'), /重复/);
  assert.throws(() => receiver.accept({ ...frames[0], total: 33 }, 'host'));
  assert.throws(() => sender.post('guest', 'chunk', { text: 'x'.repeat(66000) }));
});

test('chunk seams block unloaded land, open after loading, and rebase without a coordinate jump', async () => {
  const ctx = {
    scene: new THREE.Scene(),
    world: new World(),
    level: { rings: [] },
    effects: { clear() {} },
    enemies: { enemies: [], projectiles: { list: [] } },
  };
  const chunks = new Chunks(ctx),
    seed = 's';
  const a = { x: 0, z: 0, layout: campLayout(seed) },
    b = { x: 1, z: 0, layout: layout(seed, 1, 0) };
  a.checksum = await checksum(a.layout);
  b.checksum = await checksum(b.layout);
  await chunks.add(a);
  const body = makeBody(new THREE.Vector3(126, 0, 64), 0.35, 1.75);
  body.vel.set(40, 0, 0);
  for (let i = 0; i < 4; i++) {
    body.vel.x = 40;
    ctx.world.moveBody(body, 0.05);
  }
  assert.ok(body.pos.x < 128);
  await chunks.add(b);
  body.vel.set(40, 0, 0);
  for (let i = 0; i < 4; i++) {
    body.vel.x = 40;
    ctx.world.moveBody(body, 0.05);
  }
  assert.ok(body.pos.x > 128);
  const before = chunks.address(body.pos);
  chunks.rebase(body.pos, [{ body }]);
  assert.deepEqual(chunks.address(body.pos), before);
  assert.deepEqual(
    localPosition(address(-0.5, 1, 128.5, [500000, -500000]), [500000, -500000]),
    [-0.5, 1, 128.5],
  );
  chunks.dispose();
  assert.equal(chunks.loaded.size, 0);
  assert.equal(ctx.scene.children.length, 0);
});

test('host combat owns damage and ignores repeated or stale actions; grenades do not damage teammates', () => {
  const hit = { enemy: { alive: true }, point: new THREE.Vector3(64, 1, 60), part: 'torso' };
  let hits = 0;
  const session = Object.create(Exploration.prototype);
  session.chunks = { position: (p) => new THREE.Vector3(...localPosition(p, [0, 0])) };
  session.ctx = {
    game: { time: 5 },
    world: { raycast: () => null },
    enemies: { raycast: () => hit, damage: () => hits++ },
  };
  const p = {
    active: true,
    hp: 110,
    life: 1,
    seq: 0,
    shotAt: 0,
    pos: { cx: 0, cz: 0, x: 64, y: 0, z: 64 },
    flags: 64,
    yaw: 0,
    pitch: 0,
    weapon: 0,
  };
  session.players = new Map([['guest', p]]);
  const shot = {
    seq: 1,
    life: 1,
    action: 'shot',
    kind: 'rifle',
    origin: { ...p.pos, y: 1.6 },
    dirs: [[0, 0, -1]],
  };
  session.action('guest', shot);
  session.action('guest', shot);
  session.action('guest', { ...shot, seq: 2, life: 0 });
  assert.equal(hits, 1);
  assert.throws(() => session.action('guest', { ...shot, seq: 3, origin: { ...p.pos, cx: 50 } }), /起点/);
  session.grenades = [{ pos: new THREE.Vector3(64, 1, 64), vel: new THREE.Vector3(), fuse: 0.01 }];
  session.ctx.enemies.enemies = [];
  session.updateGrenades(0.02);
  assert.equal(p.hp, 110);
  assert.equal(session.grenades.length, 0);
});

test('PC movement crosses the old 95m limit, keeps grapple anchors through rebasing and simulates separated outposts', async () => {
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
    ].map((key) => [key, () => {}]),
  );
  const ctx = {
    scene: new THREE.Scene(),
    world: new World(),
    camera: new THREE.PerspectiveCamera(),
    level: {
      playerStart: new THREE.Vector3(94, 0, 64),
      rings: [],
      animated: [],
      grappleMovers: [],
      breakables: [],
    },
    input: {
      move: { x: 1, y: 0 },
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
  const session = Object.create(Exploration.prototype);
  Object.assign(session, {
    ctx,
    isHost: true,
    selfId: 'host',
    progress: { chunks: {} },
    pendingKills: new Map(),
    players: new Map(),
    remotes: new Map(),
  });
  ctx.exploration = session;
  session.chunks = new Chunks(ctx);
  for (const [x, z] of [
    [0, 0],
    [1, 0],
    [10, 0],
  ])
    await session.chunks.add({ x, z, layout: layout('s', x, z) });
  ctx.player.reset(new THREE.Vector3(94, 0, 64));
  for (let i = 0; i < 90; i++) {
    ctx.game.time += 1 / 60;
    ctx.player.update(1 / 60);
  }
  assert.ok(ctx.player.body.pos.x > 100, `PC player unexpectedly reset at ${ctx.player.body.pos.x}`);
  ctx.player.grapple.anchor.set(150, 8, 60);
  ctx.player.body.pos.x = 130;
  const anchor = session.chunks.address(ctx.player.grapple.anchor);
  session.chunks.rebase(ctx.player.body.pos, [ctx.player]);
  assert.deepEqual(session.chunks.address(ctx.player.grapple.anchor), anchor);
  const host = session.newActor('host', '房主', { cx: 1, cz: 0, x: 64, y: 0, z: 64 });
  host.active = true;
  const guest = session.newActor('guest', '队友', { cx: 10, cz: 0, x: 64, y: 0, z: 64 });
  guest.active = true;
  session.players.set('host', host);
  session.players.set('guest', guest);
  session.remote(guest, 0.05);
  ctx.player.reset(session.chunks.position(host.pos));
  ctx.player.update(1 / 60);
  session.spawnOutposts();
  assert.equal(ctx.enemies.enemies.length, 8);
  for (let i = 0; i < 50; i++) {
    ctx.game.time += 1 / 60;
    ctx.enemies.update(1 / 60);
  }
  for (const e of ctx.enemies.enemies)
    assert.equal(session.pickTarget(e), e.chunk === '1,0' ? ctx.player : session.remotes.get('guest'));
  ctx.enemies.clear();
  ctx.effects.clear();
  session.removeRemote('guest');
  session.chunks.dispose();
  disposeTree(ctx.scene);
});

test('loaded acknowledgements survive host eviction and visitors can reacquire an unloaded chunk', async () => {
  const session = Object.create(Exploration.prototype),
    messages = [];
  const block = { x: 0, z: 0, layout: campLayout('s') };
  block.checksum = await checksum(block.layout);
  Object.assign(session, {
    isHost: true,
    info: { id: 'world' },
    progress: { chunks: {} },
    chunks: { loaded: new Map() },
    players: new Map(),
    net: { connections: new Map([['guest', {}]]) },
    api: { call: async () => block },
    packets: { post: (_id, type, data) => messages.push({ type, data }) },
  });
  const p = session.newActor('guest', '队友', { cx: 0, cz: 0, x: 64, y: 0, z: 64 });
  session.players.set(p.id, p);
  await Promise.all([session.sendChunk(p.id, 0, 0), session.sendChunk(p.id, 0, 0)]);
  assert.equal(messages.length, 1);
  await session.receive('loaded', { x: 0, z: 0, checksum: block.checksum }, p.id);
  assert.ok(p.loaded.has('0,0'));
  await session.receive('unloaded', { x: 0, z: 0 }, p.id);
  await session.sendChunk(p.id, 0, 0);
  assert.equal(messages.length, 2);
  await assert.rejects(session.receive('loaded', { x: 0, z: 0, checksum: 'wrong' }, p.id), /确认/);
  session.api.call = async () => {
    throw Error('disk unavailable');
  };
  await assert.rejects(session.sendChunk(p.id, 1, 0));
  assert.equal(p.sent.has('1,0'), false);
});

test('progress retry recovers a lost write response and grants outpost reward once', async (t) => {
  const { store, info } = await storeFor(t);
  await store.ensure(info.id, 1, 0, 'host');
  const session = Object.create(Exploration.prototype);
  Object.assign(session, {
    isHost: true,
    info,
    progress: await store.progress(info.id),
    saves: Promise.resolve(),
    saving: 0,
    unsaved: [],
    pendingKills: new Map(),
    players: new Map(),
    ctx: { hud: { tip() {} } },
    render() {},
    report() {},
    failed: new Map(),
  });
  const p = session.newActor('host', '房主', { cx: 1, cz: 0, x: 64, y: 0, z: 64 });
  session.players.set(p.id, p);
  let lost = true;
  session.api = {
    call: async (_path, method, patch) => {
      if (method !== 'POST') return store.progress(info.id);
      const saved = await store.update(info.id, 'host', patch);
      if (lost) {
        lost = false;
        throw Error('response lost');
      }
      return saved;
    },
  };
  for (let i = 0; i < 4; i++) session.killed({ chunk: '1,0', spawnIndex: i });
  await session.saves;
  assert.equal(p.reward, 1);
  assert.equal(session.unsaved.length, 1);
  session.retry();
  await session.saves;
  assert.equal(p.reward, 1);
  assert.equal(session.unsaved.length, 0);
  const before = p.life;
  session.chunks = { position: (p) => new THREE.Vector3(...localPosition(p, [0, 0])) };
  assert.equal(session.nearestSafe({ ...p.pos, cx: 2 }).cx, 1);
  session.load = async () => undefined;
  session.respawn(p);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(p.life, before);
  assert.equal(p.respawning, false);
});

test('HTTP routes enforce same-origin sessions, a single writer, and preserve split UTF-8 names', async (t) => {
  const { createWorldServer } = await import('../server/world-server.js');
  const { Readable } = await import('node:stream');
  const { store } = await storeFor(t),
    server = createWorldServer({ store });
  const call = (url, method = 'GET', headers = {}, body = []) =>
    new Promise((resolve) => {
      const req = Readable.from(body);
      Object.assign(req, { url, method, headers: { host: '127.0.0.1:8787', ...headers } });
      let status;
      server.emit('request', req, {
        socket: { localPort: 8787 },
        writeHead(code) {
          status = code;
        },
        end(value) {
          resolve({ status, data: JSON.parse(value) });
        },
      });
    });
  assert.equal((await call('/api/worlds')).status, 400);
  assert.equal(
    (
      await call('/api/worlds/session', 'POST', {
        'x-world-request': '1',
        origin: 'https://attacker.invalid',
      })
    ).status,
    400,
  );
  const a = await call('/api/worlds/session', 'POST', { 'x-world-request': '1' }),
    b = await call('/api/worlds/session', 'POST', { 'x-world-request': '1' });
  const headers = { 'x-world-session': a.data.token },
    bytes = Buffer.from(JSON.stringify({ name: '街区存档' }));
  const created = await call('/api/worlds', 'POST', headers, [bytes.subarray(0, 11), bytes.subarray(11)]);
  assert.equal(created.status, 201);
  assert.equal(created.data.name, '街区存档');
  assert.equal((await call(`/api/worlds/${created.data.id}/lease`, 'POST', headers)).status, 200);
  assert.equal(
    (await call(`/api/worlds/${created.data.id}/lease`, 'POST', { 'x-world-session': b.data.token })).status,
    400,
  );
  const chunk = await call(`/api/worlds/${created.data.id}/chunk/0,0`, 'GET', headers);
  assert.equal(chunk.status, 200);
  assert.equal(chunk.data.layout.outpost, null);
});

test('repeated long-distance travel unloads geometry while retaining explored metadata', async () => {
  const ctx = {
    scene: new THREE.Scene(),
    world: new World(),
    level: { rings: [] },
    effects: { clear() {} },
    enemies: { enemies: [], projectiles: { list: [] } },
    player: { nades: [] },
  };
  const session = Object.create(Exploration.prototype);
  Object.assign(session, {
    ctx,
    isHost: true,
    selfId: 'host',
    progress: { chunks: {} },
    manifest: new Set(),
    requests: new Map(),
    failed: new Map(),
    grenades: [],
  });
  session.chunks = new Chunks(ctx);
  const p = session.newActor('host', '房主', { cx: 0, cz: 0, x: 64, y: 0, z: 64 });
  session.players = new Map([[p.id, p]]);
  for (const x of [...Array.from({ length: 12 }, (_, i) => i * 10000), 0]) {
    p.pos.cx = x;
    await session.chunks.add({ x, z: 0, layout: layout('s', x, 0) });
    session.manifest.add(`${x},0`);
    const body = makeBody(session.chunks.position(p.pos), 0.35, 1.75);
    session.chunks.rebase(body.pos, [{ body }]);
    session.maintain();
    assert.equal(session.chunks.loaded.size, 1);
    assert.deepEqual(session.chunks.address(body.pos), p.pos);
    assert.ok(ctx.world.boxes.length <= 160); // One detailed street; old distant colliders must unload.
    assert.equal(ctx.scene.children.length, 2); // Loaded geometry plus continuous ground, no blue walls.
    assert.equal(session.chunks.barriers.length, 0);
  }
  assert.equal(session.manifest.size, 12);
  session.chunks.dispose();
});
