// Explicit opt-in: this check makes real, billable DeepSeek requests for three regions.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import * as THREE from 'three';
import { WorldStore, deepSeekGenerator } from '../server/world-store.js';
import { createWorldServer } from '../server/world-server.js';
import { checksum, exits } from '../src/games/shooter/exploration/schema.js';
import { Chunks } from '../src/games/shooter/exploration/chunks.js';
import { World, makeBody } from '../src/games/shooter/physics.js';

assert.ok(process.env.DEEPSEEK_API_KEY?.trim(), 'Configure DEEPSEEK_API_KEY before this explicit live check');
await mkdir(resolve('world-data'), { recursive: true });
const directory = await mkdtemp(resolve('world-data/live-check-'));
const outputs = [],
  records = [],
  calls = new Map();
const generate = deepSeekGenerator({
  fetchImpl: async (url, options) => {
    const response = await fetch(url, options);
    if (response.ok) {
      const body = await response.clone().json();
      outputs.push(body.choices?.[0]?.message?.content ?? '');
    }
    return response;
  },
  log: (line) => {
    records.push(JSON.parse(line));
    console.log(line);
  },
});
let peak = 0,
  active = 0,
  server,
  heartbeat;
async function start(store) {
  server = createWorldServer({ store });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/worlds`;
  const { token } = await (
    await fetch(`${base}/session`, { method: 'POST', headers: { 'X-World-Request': '1' } })
  ).json();
  return async (path = '', method = 'GET', body) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-World-Session': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert.ok(response.ok, `${path}: ${data.error}`);
    return data;
  };
}
async function stop() {
  clearInterval(heartbeat);
  if (server?.listening)
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
const report = {
  date: new Date().toISOString(),
  directory,
  model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
};
try {
  const store = new WorldStore(directory, async (context) => {
    const key = `${context.x},${context.z}`;
    calls.set(key, (calls.get(key) ?? 0) + 1);
    peak = Math.max(peak, ++active);
    try {
      return await generate(context);
    } finally {
      active--;
    }
  });
  let api = await start(store);
  const info = await api('', 'POST', { name: 'DeepSeek 实测城镇' });
  report.worldId = info.id;
  await api(`/${info.id}/lease`, 'POST');
  heartbeat = setInterval(() => {
    void api(`/${info.id}/lease`, 'POST', { renew: true }).catch((error) => console.error(error.message));
  }, 10000);
  console.log(JSON.stringify({ event: 'live-start', directory, worldId: info.id }));
  const results = await Promise.allSettled(
    [
      [1, 0],
      [1, 0],
      [-1, 0],
    ].map(([x, z]) => api(`/${info.id}/chunk/${x},${z}`, 'POST')),
  );
  for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.message);
  const [east, duplicate, west] = results.map((r) => r.value);
  assert.deepEqual(east, duplicate);
  assert.equal(calls.get('1,0'), 1);
  assert.equal(peak, 2);
  const southeast = await api(`/${info.id}/chunk/1,1`, 'POST');
  const camp = await api(`/${info.id}/chunk/0,0`),
    blocks = [camp, east, west, southeast];
  assert.equal(exits(info.seed, 0, 0)[1][1], exits(info.seed, 1, 0)[3][1]);
  assert.equal(exits(info.seed, 1, 0)[2][0], exits(info.seed, 1, 1)[0][0]);
  const ctx = {
    scene: new THREE.Scene(),
    world: new World(),
    level: { rings: [] },
    effects: { clear() {} },
    enemies: { enemies: [], projectiles: { list: [] } },
  };
  const chunks = new Chunks(ctx),
    edgeZ = exits(info.seed, 0, 0)[1][1];
  await chunks.add(camp);
  const body = makeBody(new THREE.Vector3(126, 0, edgeZ), 0.35, 1.75);
  for (let i = 0; i < 8; i++) {
    body.vel.set(48, 0, 0);
    ctx.world.moveBody(body, 0.05);
  }
  assert.ok(body.pos.x < 128, 'Unknown region must remain blocked');
  await chunks.add(east);
  for (let i = 0; i < 8; i++) {
    body.vel.set(48, 0, 0);
    ctx.world.moveBody(body, 0.05);
  }
  assert.ok(body.pos.x > 128, 'The AI road seam must be traversable after saving');
  chunks.dispose();
  for (const block of blocks) assert.equal(await checksum(block.layout), block.checksum);
  const before = records.length;
  await stop();
  api = await start(
    new WorldStore(directory, () => {
      throw Error('Reload must never call DeepSeek');
    }),
  );
  await api(`/${info.id}/lease`, 'POST');
  for (const block of blocks)
    assert.deepEqual(await api(`/${info.id}/chunk/${block.x},${block.z}`, 'POST'), block);
  assert.equal(records.length, before);
  report.passed = true;
  report.peakGeneration = peak;
  report.regions = blocks.map((b) => ({
    x: b.x,
    z: b.z,
    name: b.layout.name,
    buildings: b.layout.buildings.length,
    cover: b.layout.cover.length,
    checksum: b.checksum,
  }));
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await stop();
  await writeFile(join(directory, 'model-outputs.json'), JSON.stringify(outputs, null, 2));
  report.records = records;
  report.calls = Object.fromEntries(calls);
  report.usage = records.filter((r) => r.usage).reduce((sum, r) => sum + (r.usage.total_tokens ?? 0), 0);
  await writeFile(join(directory, 'live-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
