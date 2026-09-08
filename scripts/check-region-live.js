// Explicit opt-in: generates one complete small region and seven interiors with DeepSeek.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import * as THREE from 'three';
import { WorldStore, deepSeekGenerator } from '../server/world-store.js';
import { createWorldServer } from '../server/world-server.js';
import { PLOTS, validateWorldLayout } from '../src/games/shooter/exploration/region.js';
import { checksum } from '../src/games/shooter/exploration/schema.js';
import { buildChunk } from '../src/games/shooter/exploration/chunks.js';
import { NavGrid } from '../src/games/shooter/nav.js';
import { disposeTree } from '../src/shared/resources.js';

assert.ok(process.env.DEEPSEEK_API_KEY?.trim(), 'Configure DEEPSEEK_API_KEY first');
await mkdir(resolve('world-data'), { recursive: true });
const directory = await mkdtemp(resolve('world-data/region-live-'));
const outputs = [],
  records = [],
  report = { directory, date: new Date().toISOString() };
let heartbeat,
  server,
  calls = 0,
  active = 0,
  peak = 0;
const generator = deepSeekGenerator({
  fetchImpl: async (url, options) => {
    const response = await fetch(url, options);
    if (response.ok) {
      const body = await response.clone().json();
      outputs.push(body.choices?.[0]?.message?.content ?? '');
    }
    return response;
  },
  log(line) {
    records.push(JSON.parse(line));
    console.log(line);
  },
});
const store = new WorldStore(directory, async (context) => {
  calls++;
  peak = Math.max(peak, ++active);
  try {
    return await generator(context);
  } finally {
    active--;
  }
});
try {
  server = createWorldServer({ store });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/worlds`;
  const { token } = await (
    await fetch(`${base}/session`, { method: 'POST', headers: { 'X-World-Request': '1' } })
  ).json();
  async function api(path = '', method = 'GET', body) {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-World-Session': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert.ok(response.ok, `${path}: ${data.error}`);
    return data;
  }
  const info = await api('', 'POST', { name: 'DeepSeek 模板小镇', schemaVersion: 2 });
  report.worldId = info.id;
  report.theme = info.region;
  await api(`/${info.id}/lease`, 'POST');
  heartbeat = setInterval(() => {
    void api(`/${info.id}/lease`, 'POST', { renew: true }).catch((e) => console.error(e.message));
  }, 10000);
  const [east, duplicate, west] = await Promise.all(
    [
      [1, 0],
      [1, 0],
      [0, 1],
    ].map(([x, z]) => api(`/${info.id}/chunk/${x},${z}`, 'POST')),
  );
  assert.deepEqual(east, duplicate);
  const southeast = await api(`/${info.id}/chunk/1,1`, 'POST');
  const camp = await api(`/${info.id}/chunk/0,0`);
  const interiors = await Promise.all(
    [...PLOTS, PLOTS[6]].map((b) => api(`/${info.id}/building/${b.id}`, 'POST', { priority: true })),
  );
  assert.deepEqual(interiors[6], interiors[7]);
  assert.equal(calls, 12);
  assert.equal(peak, 2);
  const blocks = [camp, east, west, southeast, ...interiors.slice(0, 7)];
  for (const block of blocks) {
    validateWorldLayout(block.layout, info, block.x, block.z);
    assert.equal(await checksum(block.layout), block.checksum);
    const built = buildChunk(block),
      nav = new NavGrid(built.world, built.level.bounds, 1).build();
    const entry = block.layout.interior ? block.layout.entrance : [64, 64];
    const goals = block.layout.interior
      ? [...(block.layout.outpost?.spawns ?? []), [64, 64]]
      : block.layout.buildings.map((b) => [b.door.x, b.door.z]);
    for (const [x, z] of goals)
      assert.ok(nav.findPath(new THREE.Vector3(entry[0], 0, entry[1]), new THREE.Vector3(x, 0, z)));
    disposeTree(built.root);
  }
  let progress = await api(`/${info.id}/progress`, 'POST', {
    revision: 0,
    run: { buildingId: 'building-7', runId: 1, defeated: [0, 1, 2, 3], rewarded: true },
  });
  progress = await api(`/${info.id}/progress`, 'POST', {
    revision: progress.revision,
    run: { buildingId: 'building-7', runId: 1, reset: true },
  });
  clearInterval(heartbeat);
  await new Promise((r) => server.close(r));
  const restarted = new WorldStore(directory, () => {
    throw Error('Saved scenes must not regenerate');
  });
  restarted.claim(info.id, 'restarted');
  for (const b of blocks) assert.deepEqual(await restarted.chunk(info.id, b.x, b.z), b);
  assert.deepEqual(await restarted.progress(info.id), progress);
  report.status = 'passed';
  report.calls = calls;
  report.peak = peak;
  report.tokens = records
    .filter((r) => r.event === 'generation')
    .reduce((sum, r) => sum + (r.usage?.total_tokens ?? 0), 0);
  report.scenes = blocks.map((b) => ({ x: b.x, z: b.z, name: b.layout.name, checksum: b.checksum }));
  console.log(JSON.stringify(report));
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  clearInterval(heartbeat);
  if (server?.listening) await new Promise((r) => server.close(r));
  await writeFile(join(directory, 'report.json'), JSON.stringify({ ...report, records, outputs }, null, 2));
}
