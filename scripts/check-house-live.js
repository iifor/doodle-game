// Explicit opt-in integration check: one house design, at most one model retry.
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { WorldStore, deepSeekGenerator, atomicWrite } from '../server/world-store.js';
import { campLayout, checksum } from '../src/games/shooter/exploration/schema.js';
import { enterableBuildings, validateHouseBlock } from '../src/games/shooter/exploration/interiors.js';

loadEnvFile('.env.local');
const directory = resolve('world-data', `house-live-${Date.now()}`);
let calls = 0;
const events = [];
const generate = deepSeekGenerator({
  log: (line) => {
    const event = JSON.parse(line);
    events.push(event);
    console.log(line);
  },
});
const store = new WorldStore(directory, async (request) => {
  calls++;
  return generate(request);
});
const info = await store.create('住宅实测（独立验收存档）');
const layout = { ...campLayout(info.seed), buildings: [{ x: 20, z: 20, w: 8, d: 8, h: 12 }] };
const exterior = { x: 0, z: 0, layout, checksum: await checksum(layout) };
await atomicWrite(store.path(info.id, 'chunks', '0,0.json'), exterior);
store.claim(info.id, 'check');
const heartbeat = setInterval(() => store.claim(info.id, 'check'), 10000);
try {
  const b = enterableBuildings(exterior)[0],
    started = Date.now();
  const [first, duplicate] = await Promise.all([
    store.interior(info.id, b.id, 'check', true),
    store.interior(info.id, b.id, 'check', true),
  ]);
  await validateHouseBlock(first);
  if (calls !== 1 || first.checksum !== duplicate.checksum) throw new Error('重复请求未合并');
  const restarted = new WorldStore(directory, () => {
    throw new Error('缓存读取不应调用 AI');
  });
  restarted.claim(info.id, 'check');
  await restarted.update(info.id, 'check', { revision: 0, generationPaused: true });
  const cached = await restarted.interior(info.id, b.id, 'check');
  if (cached.checksum !== first.checksum) throw new Error('重启后缓存不一致');
  const report = {
    passed: true,
    directory,
    worldId: info.id,
    buildingId: b.id,
    elapsedMs: Date.now() - started,
    name: first.layout.name,
    floors: first.layout.plan.floors.length,
    rooms: first.layout.plan.floors.map((f) => f.left.length + f.right.length),
    cacheAfterRestart: true,
    generationJobs: calls,
    events,
  };
  await atomicWrite(resolve(directory, 'report.json'), report);
  // Local browser QA consumes this exact saved AI result, never a replacement layout.
  await atomicWrite(resolve('world-data', 'house-preview.json'), first);
  console.log(JSON.stringify(report));
} finally {
  clearInterval(heartbeat);
}
