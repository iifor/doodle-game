import {
  enterableBuildings,
  parseInteriorId,
  validateInteriorPlan,
  interiorExample,
  expandHouse,
  validateHouseBlock,
} from '../src/games/shooter/exploration/interiors.js';
import {
  validateWorldLayout,
  validateTheme,
  validateVariation,
  validateStreetDesign,
  themeExample,
  variationExample,
  expandStreet,
  expandInterior,
  outdoors,
  buildingAt,
  buildingById,
  plotsIn,
} from '../src/games/shooter/exploration/region.js';
import { mkdir, readFile, readdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { randomizeEncounter } from '../src/games/shooter/exploration/encounters.js';
import {
  SCHEMA,
  GENERATOR,
  coordinates,
  campLayout,
  validateLayout,
  validateGeneratedLayout,
  validateProgress,
  outpostComplete,
  validAddress,
  checksum,
  requireWorld,
  exits,
  connectingRoads,
  EXAMPLE_NAME,
  hash,
} from '../src/games/shooter/exploration/schema.js';
import { defaultQuests, validateQuests } from '../src/games/shooter/exploration/quests.js';

export async function atomicWrite(file, data) {
  await mkdir(join(file, '..'), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(data));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
    // POSIX directory sync makes the rename durable across a sudden power loss.
    if (process.platform !== 'win32') {
      const directory = await open(join(file, '..'), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } catch (error) {
    await unlink(temp).catch((cleanup) => {
      if (cleanup.code !== 'ENOENT') throw cleanup;
    });
    throw error;
  }
}
const readJSON = async (file) => JSON.parse(await readFile(file, 'utf8'));
export class WorldStore {
  constructor(directory, generate) {
    this.directory = directory;
    this.generate = generate;
    this.jobs = new Map();
    this.leases = new Map();
    this.writes = new Map();
    this.active = 0;
    this.queue = [];
  }
  path(id, ...parts) {
    requireWorld(typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id), '世界编号无效');
    return join(this.directory, id, ...parts);
  }
  async list() {
    await mkdir(this.directory, { recursive: true });
    const dirs = await readdir(this.directory, { withFileTypes: true });
    const worlds = await Promise.all(
      dirs
        .filter((d) => d.isDirectory() && /^[0-9a-f-]{36}$/.test(d.name))
        .map(async (d) => {
          try {
            return await this.info(d.name);
          } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
          }
        }),
    );
    return worlds.filter(Boolean);
  }
  async info(id) {
    const info = await readJSON(this.path(id, 'world.json'));
    requireWorld(
      info.id === id && [SCHEMA, 2].includes(info.schemaVersion) && info.generatorVersion === GENERATOR,
      '世界存档版本不兼容，原文件已保留',
    );
    if (info.schemaVersion === 2) validateTheme(info.region);
    return info;
  }
  async create(name, version = 1, aiGenerated = false) {
    requireWorld([1, 2].includes(version), '世界版本无效');
    requireWorld(typeof aiGenerated === 'boolean' && (!aiGenerated || version === 1), '生成模式无效');
    requireWorld(
      typeof name === 'string' &&
        name.trim().length > 0 &&
        name.length <= 40 &&
        !/[\p{Cc}\p{Cf}]/u.test(name),
      '世界名称须为 1–40 个可见字符',
    );
    const id = randomUUID(),
      seed = randomUUID();
    const info = {
      id,
      name: name.trim(),
      seed,
      schemaVersion: version,
      generatorVersion: GENERATOR,
      createdAt: new Date().toISOString(),
      ...(aiGenerated ? { aiGenerated: true } : {}),
      ...(aiGenerated ? { encounterVersion: 1 } : {}),
    };
    let layout;
    if (version === 2) {
      const theme = await this.slot(() =>
        this.generate({
          design: { kind: 'theme', context: {}, example: themeExample },
          validate: validateTheme,
        }),
      );
      info.region = validateTheme(theme);
      const design = await this.streetDesign(info, 0, 0);
      layout = expandStreet(design, 0, 0);
    } else if (aiGenerated) {
      layout = await this.slot(() => this.generate({ seed, x: 0, z: 0, neighbors: [] }));
      layout = validateGeneratedLayout(layout, seed, 0, 0);
    } else layout = campLayout(seed);
    await atomicWrite(this.path(id, 'chunks', '0,0.json'), {
      x: 0,
      z: 0,
      layout,
      checksum: await checksum(layout),
    });
    await atomicWrite(this.path(id, 'progress.json'), {
      revision: 0,
      chunks: {},
      ...(version === 2 ? { runs: {} } : {}),
      safePosition: { cx: 0, cz: 0, x: 64, y: 0, z: 64 },
      generationPaused: false,
      quests: defaultQuests(),
    });
    await atomicWrite(this.path(id, 'world.json'), info);
    return info;
  }
  claim(id, owner) {
    const existing = this.leases.get(id);
    requireWorld(
      !existing || existing.owner === owner || existing.until < Date.now(),
      '这个世界已有活跃房主',
    );
    this.leases.set(id, { owner, until: Date.now() + 30000 });
  }
  requireLease(id, owner) {
    const lease = this.leases.get(id);
    requireWorld(
      lease && lease.owner === owner && lease.until >= Date.now(),
      '房主写入会话已失效，请重新打开世界',
    );
    this.claim(id, owner);
  }
  release(id, owner) {
    this.requireLease(id, owner);
    this.leases.delete(id);
  }
  async progress(id) {
    await this.info(id);
    const p = await readJSON(this.path(id, 'progress.json'));
    requireWorld(
      Number.isSafeInteger(p.revision) &&
        p.revision >= 0 &&
        p.chunks &&
        typeof p.chunks === 'object' &&
        !Array.isArray(p.chunks) &&
        typeof p.generationPaused === 'boolean',
      '探索存档损坏，原文件已保留',
    );
    if (p.runs)
      for (const [id, state] of Object.entries(p.runs)) {
        requireWorld(
          buildingById(id)?.templateId === 'warehouse' &&
            Number.isSafeInteger(state.runId) &&
            state.runId > 0,
          '挑战存档无效',
        );
        validateProgress(state, 4);
      }
    validAddress(p.safePosition);
    for (const [key, state] of Object.entries(p.chunks)) {
      const pair = key.split(',').map(Number);
      requireWorld(pair.length === 2 && coordinates(...pair) === key, '进度区块编号无效');
      validateProgress(state);
      if (state.safePosition) {
        validAddress(state.safePosition);
        requireWorld(
          outpostComplete(state) && coordinates(state.safePosition.cx, state.safePosition.cz) === key,
          '安全据点存档无效',
        );
      }
    }
    if (p.quests !== undefined) p.quests = validateQuests(p.quests);
    else p.quests = defaultQuests();
    return p;
  }
  async manifest(id) {
    await this.info(id);
    const files = await readdir(this.path(id, 'chunks'));
    return files.filter((f) => /^-?\d+,-?\d+\.json$/.test(f)).map((f) => f.slice(0, -5));
  }
  async chunk(id, x, z) {
    const key = coordinates(x, z),
      info = await this.info(id);
    try {
      const block = await readJSON(this.path(id, 'chunks', `${key}.json`));
      requireWorld(block.x === x && block.z === z, '区块坐标与存档不一致');
      const layout = validateWorldLayout(block.layout, info, x, z);
      requireWorld((await checksum(layout)) === block.checksum, '地图校验失败，原文件已保留');
      return block;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async ensure(id, x, z, owner) {
    this.requireLease(id, owner);
    const info = await this.info(id);
    if (info.schemaVersion === 2) return this.ensureRegion(id, x, z, owner);
    const key = `${id}:${coordinates(x, z)}`;
    if (this.jobs.has(key)) return this.jobs.get(key);
    const work = async () => {
      const existing = await this.chunk(id, x, z);
      if (existing) return existing;
      requireWorld(!(await this.progress(id)).generationPaused, '新区域生成已暂停');
      const info = await this.info(id);
      const neighbors = [];
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const block = await this.chunk(id, x + dx, z + dz);
        if (block) neighbors.push({ x: block.x, z: block.z, name: block.layout.name });
      }
      requireWorld(neighbors.length > 0, '只能从已存在的相邻区域继续探索');
      if (this.active >= 2) await new Promise((resolve) => this.queue.push(resolve));
      else this.active++;
      try {
        this.requireLease(id, owner);
        requireWorld(!(await this.progress(id)).generationPaused, '新区域生成已暂停');
        let layout = validateLayout(
          await this.generate({ seed: info.seed, x, z, neighbors }),
          info.seed,
          x,
          z,
        );
        if (info.encounterVersion === 1) layout = randomizeEncounter(layout, info.seed, x, z);
        this.requireLease(id, owner);
        const block = { x, z, layout, checksum: await checksum(layout) };
        await atomicWrite(this.path(id, 'chunks', `${coordinates(x, z)}.json`), block);
        return block;
      } finally {
        const next = this.queue.shift();
        if (next) next();
        else this.active--;
      }
    };
    const promise = work().finally(() => this.jobs.delete(key));
    this.jobs.set(key, promise);
    return promise;
  }
  async prepareEncounters(id, owner) {
    this.requireLease(id, owner);
    const info = await this.info(id);
    if (info.schemaVersion !== 1 || info.encounterVersion === 1) return info;
    const jobKey = `${id}:encounter-upgrade`;
    if (this.jobs.has(jobKey)) return this.jobs.get(jobKey);
    const work = async () => {
      const progress = await this.progress(id);
      for (const key of await this.manifest(id)) {
        if (progress.chunks[key]) continue; // Never change an in-progress or completed fight.
        const [x, z] = key.split(',').map(Number),
          block = await this.chunk(id, x, z);
        if (!block.layout.outpost || block.layout.outpost.encounterVersion === 1) continue;
        const layout = randomizeEncounter(block.layout, info.seed, x, z);
        this.requireLease(id, owner);
        // Keep the exact original for an interrupted upgrade or a manual rollback.
        await atomicWrite(this.path(id, 'encounter-backups', `${key}.json`), block);
        await atomicWrite(this.path(id, 'chunks', `${key}.json`), {
          x,
          z,
          layout,
          checksum: await checksum(layout),
        });
      }
      this.requireLease(id, owner);
      const updated = { ...info, encounterVersion: 1 };
      await atomicWrite(this.path(id, 'world.json'), updated);
      return updated;
    };
    const promise = work().finally(() => this.jobs.delete(jobKey));
    this.jobs.set(jobKey, promise);
    return promise;
  }
  async slot(work, priority = false, jobKey) {
    if (this.active >= 2)
      await new Promise((resolve) => {
        resolve.jobKey = jobKey;
        priority ? this.queue.unshift(resolve) : this.queue.push(resolve);
      });
    else this.active++;
    try {
      return await work();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
  async streetDesign(info, x, z, guard = () => {}) {
    const example = {
      name: '街坊名称',
      buildings: plotsIn(x, z).map((b) => ({ id: b.id, ...variationExample })),
    };
    const validate = (raw) => validateStreetDesign(raw, x, z);
    return this.slot(async () => {
      await guard();
      return validate(
        await this.generate({
          design: {
            kind: 'street',
            context: {
              theme: info.region,
              district: info.region.districts[z],
              chunk: [x, z],
              plots: plotsIn(x, z),
            },
            example,
          },
          validate,
        }),
      );
    });
  }
  async ensureRegion(id, x, z, owner, priority = false) {
    requireWorld(outdoors(x, z) || buildingAt(x, z), '已经到达小区域边界');
    const key = `${id}:${coordinates(x, z)}`;
    if (this.jobs.has(key)) {
      if (priority) {
        const index = this.queue.findIndex((resolve) => resolve.jobKey === key);
        if (index >= 0) this.queue.unshift(...this.queue.splice(index, 1));
      }
      return this.jobs.get(key);
    }
    const work = async () => {
      const existing = await this.chunk(id, x, z);
      if (existing) return existing;
      this.requireLease(id, owner);
      requireWorld(!(await this.progress(id)).generationPaused, '新区域生成已暂停');
      const info = await this.info(id);
      let layout;
      const building = buildingAt(x, z);
      if (building) {
        const street = await this.chunk(id, building.cx, building.cz);
        requireWorld(street, '建筑所在街区尚未生成');
        const exterior = street.layout.buildings.find((b) => b.id === building.id);
        const variation = await this.slot(
          async () => {
            this.requireLease(id, owner);
            requireWorld(!(await this.progress(id)).generationPaused, '新区域生成已暂停');
            return validateVariation(
              await this.generate({
                design: {
                  kind: 'interior',
                  context: {
                    theme: info.region,
                    district: info.region.districts[building.cz],
                    building: exterior,
                  },
                  example: variationExample,
                },
                validate: validateVariation,
              }),
            );
          },
          priority,
          key,
        );
        layout = expandInterior(exterior, variation);
      } else {
        const neighbors = await Promise.all(
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].map(([dx, dz]) => this.chunk(id, x + dx, z + dz)),
        );
        requireWorld(neighbors.some(Boolean), '只能从已存在的相邻区域继续探索');
        layout = expandStreet(
          await this.streetDesign(info, x, z, async () => {
            this.requireLease(id, owner);
            requireWorld(!(await this.progress(id)).generationPaused, '新区域生成已暂停');
          }),
          x,
          z,
        );
      }
      this.requireLease(id, owner);
      validateWorldLayout(layout, info, x, z);
      const block = { x, z, layout, checksum: await checksum(layout) };
      await atomicWrite(this.path(id, 'chunks', `${coordinates(x, z)}.json`), block);
      return block;
    };
    const promise = work().finally(() => this.jobs.delete(key));
    this.jobs.set(key, promise);
    return promise;
  }
  async interior(id, buildingId, owner, priority = false) {
    this.requireLease(id, owner);
    if ((await this.info(id)).schemaVersion === 1) return this.ensureHouse(id, buildingId, owner, priority);
    const b = buildingById(buildingId);
    requireWorld(b && (await this.info(id)).schemaVersion === 2, '建筑编号无效');
    return this.ensureRegion(id, b.sceneX, b.sceneZ, owner, priority);
  }
  async ensureHouse(id, buildingId, owner, priority = false) {
    const { x, z } = parseInteriorId(buildingId);
    const key = `${id}:${buildingId}`;
    if (this.jobs.has(key)) return this.jobs.get(key);
    const work = async () => {
      const exterior = await this.chunk(id, x, z);
      const building = enterableBuildings(exterior).find((b) => b.id === buildingId);
      requireWorld(building, '这栋建筑没有可进入的门');
      const file = this.path(id, 'interiors', `${buildingId}.json`);
      try {
        const cached = await validateHouseBlock(await readJSON(file));
        requireWorld(
          cached.layout.buildingId === buildingId &&
            JSON.stringify(cached.layout.exteriorDoor) === JSON.stringify(building.door),
          '建筑外观与室内缓存不匹配',
        );
        return cached;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return this.slot(
        async () => {
          this.requireLease(id, owner);
          requireWorld(!(await this.progress(id)).generationPaused, '新区域生成已暂停；已缓存的室内仍可进入');
          const plan = validateInteriorPlan(
            await this.generate({
              design: {
                kind: 'house',
                context: { district: exterior.layout.name, building },
                example: interiorExample,
              },
              validate: validateInteriorPlan,
            }),
          );
          this.requireLease(id, owner);
          const layout = expandHouse(plan, building);
          const block = { x, z, layout, checksum: await checksum(layout) };
          await validateHouseBlock(block);
          await atomicWrite(file, block);
          return block;
        },
        priority,
        key,
      );
    };
    const promise = work().finally(() => this.jobs.delete(key));
    this.jobs.set(key, promise);
    return promise;
  }
  update(id, owner, patch) {
    const previous = this.writes.get(id) ?? Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(async () => {
        this.requireLease(id, owner);
        const p = await this.progress(id);
        requireWorld(patch && patch.revision === p.revision, '存档版本冲突，请重新读取');
        if (patch.chunk !== undefined) {
          requireWorld(Array.isArray(patch.chunk) && patch.chunk.length === 2, '区块编号无效');
          const [x, z] = patch.chunk,
            key = coordinates(x, z);
          requireWorld(x !== 0 || z !== 0, '营地没有战斗进度');
          requireWorld(
            !buildingAt(x, z) || (await this.info(id)).schemaVersion !== 2,
            '室内挑战需要独立轮次',
          );
          const block = await this.chunk(id, x, z);
          requireWorld(block, '不能保存未生成区块的进度');
          const state = validateProgress(patch.state, block.layout.outpost?.spawns.length ?? 4),
            old = p.chunks[key];
          requireWorld(
            !old ||
              (old.defeated.every((n) => state.defeated.includes(n)) && (!old.rewarded || state.rewarded)),
            '不能回退已经保存的进度',
          );
          p.chunks[key] = outpostComplete(state)
            ? {
                ...state,
                safePosition: {
                  cx: x,
                  cz: z,
                  x: block.layout.outpost.center[0],
                  y: 0,
                  z: block.layout.outpost.center[1],
                },
              }
            : state;
        }
        if (patch.run !== undefined) {
          const b = buildingById(patch.run.buildingId);
          requireWorld(p.runs && b?.templateId === 'warehouse', '挑战建筑无效');
          requireWorld(await this.chunk(id, b.sceneX, b.sceneZ), '室内尚未生成');
          const old = p.runs[b.id] ?? { runId: 1, defeated: [], rewarded: false };
          requireWorld(patch.run.runId === old.runId, '挑战轮次已过期');
          if (patch.run.reset === true)
            p.runs[b.id] = { runId: old.runId + 1, defeated: [], rewarded: false };
          else {
            const state = validateProgress(patch.run, 4);
            requireWorld(
              old.defeated.every((n) => state.defeated.includes(n)) && (!old.rewarded || state.rewarded),
              '不能回退挑战进度',
            );
            p.runs[b.id] = { ...state, runId: old.runId };
          }
        }
        if (patch.safePosition !== undefined) {
          const pos = validAddress(patch.safePosition),
            key = coordinates(pos.cx, pos.cz);
          requireWorld(key === '0,0' || outpostComplete(p.chunks[key]), '安全位置必须位于营地或已清理据点');
          const block = await this.chunk(id, pos.cx, pos.cz);
          const center = block.layout.outpost?.center ?? [64, 64];
          p.safePosition = { cx: pos.cx, cz: pos.cz, x: center[0], y: 0, z: center[1] };
        }
        if (patch.generationPaused !== undefined) {
          requireWorld(typeof patch.generationPaused === 'boolean', '生成开关无效');
          p.generationPaused = patch.generationPaused;
        }
        if (patch.quests !== undefined) p.quests = validateQuests(patch.quests);
        p.revision++;
        await atomicWrite(this.path(id, 'progress.json'), p);
        return p;
      });
    this.writes.set(id, operation);
    return operation.finally(() => {
      if (this.writes.get(id) === operation) this.writes.delete(id);
    });
  }
}

// How many rounds of map correction a single region may use before it is given up on.
export const MAX_CORRECTIONS = 3;
export function deepSeekGenerator({
  fetchImpl = fetch,
  key = process.env.DEEPSEEK_API_KEY,
  model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
  log = console.log,
} = {}) {
  return async ({ seed, x, z, neighbors, design, validate }) => {
    requireWorld(key, '未配置 DEEPSEEK_API_KEY；已保存区域仍可游玩');
    const reference = {
      name: EXAMPLE_NAME,
      roads: connectingRoads(seed, x, z),
      buildings: [
        { x: 46, z: 52, w: 14, d: 9, h: 13, archetype: 'tower' },
        { x: 80, z: 52, w: 12, d: 8, h: 9 },
        { x: 20, z: 20, w: 12, d: 12, h: 6 },
        { x: 108, z: 108, w: 12, d: 12, h: 16, archetype: 'warehouse' },
      ],
      cover: [{ x: 44, z: 20, w: 2, d: 2, h: 1 }],
      structures: [
        { type: 'stair', building: 0, face: 'north' },
        { type: 'bridge', from: 0, to: 1 },
      ],
      landmark: [64, 64],
      supply: [68, 68],
      outpost:
        x === 0 && z === 0
          ? null
          : {
              center: [64, 64],
              spawns: [
                [56, 56],
                [72, 56],
                [56, 72],
                [72, 72],
              ],
            },
    };
    const offset = (a, b) => (hash(`${seed}:plot:${x}:${z}:${a}:${b}`) % 9) - 4;
    let correction = '';
    const reported = [];
    for (let attempt = 0; ; attempt++) {
      const start = Date.now();
      let output = '';
      try {
        const messages = design
          ? [
              {
                role: 'system',
                content:
                  '你是涂鸦游戏场景设计师，只返回完整 JSON。输出必须使用example的对象结构和英文键名，不要添加theme、result、data、example等包装层。example表示输出结构，context是只读背景。名称使用有特色的中文，不要照抄例子。name最多30字符，sign最多24字符，background最多500字符，style最多300字符。修正correction中指出的错误后仍输出完整对象；correction.previousErrors是前几轮已报过的错误，不要重新引入。' +
                  (design.kind === 'house'
                    ? '本次设计可探索的住宅室内。顶层只有name、palette、width、depth、corridor、floors。palette为blue/green/orange；width只能20/24/28，depth只能24/28/32。corridor决定走廊形式：centre为居中走廊、两侧都有房间；left或right表示走廊贴着该侧外墙，那一侧必须是空数组，另一侧房间进深加倍。请在两种形式之间自由选择，不要每栋都用centre。自主决定一至三层，floors每项有left和right数组；有房间的一侧一至三个房间。房间只有type、window布尔值、connecting布尔值。type只能living/kitchen/bedroom/bathroom/study/storage/dining。一层必须有客厅living和厨房kitchen。window决定该房间是否有外窗，connecting决定是否有通往同侧下一个房间的门。逐层改变用途、房间数量与窗户，不要照抄示例，也不要每层完全相同。引擎负责走廊、门洞、楼板、连续楼梯和家具摆放，禁止输出坐标或可执行代码。'
                    : design.kind === 'theme'
                      ? '本次只生成世界主题，顶层必须包含background字符串、name字符串、style字符串、districts数组。districts恰好两个对象，每个只有name和style字符串。'
                      : '本次生成建筑模板变化：palette只能blue/green/orange；decoration只能awning/stripes/plain；slots恰好四项，每项只能empty/shelf/crate/table。不得输出坐标或改变结构。street顶层只有name和buildings，buildings逐一保留example中的id；interior顶层只有name、sign、palette、decoration、slots，风格与context中的外观一致。'),
              },
              { role: 'user', content: JSON.stringify({ ...design, correction }) },
            ]
          : [
              {
                role: 'system',
                // Sectioned rather than one paragraph: 36 rules run together made the
                // model drop whichever one it had read earliest.
                content: [
                  '你是涂鸦城镇关卡设计师。只输出 JSON，不要输出解释或代码块。区域128米见方，平地y=0。',
                  '',
                  '【输出结构】',
                  '{"name":"区域名","roads":[[x1,z1,x2,z2]],"buildings":[{"x":20,"z":20,"w":12,"d":12,"h":8},{"x":44,"z":44,"w":16,"d":16,"h":10,"archetype":"courtyard"}],"cover":[{"x":40,"z":20,"w":2,"d":2,"h":1}],"structures":[{"type":"stair","building":0,"face":"north"},{"type":"bridge","from":0,"to":1}],"landmark":[64,64],"supply":[68,68],"outpost":{"center":[64,64],"spawns":[[52,52],[76,52],[52,76],[76,76]]}}',
                  '',
                  '【必须满足，缺一项整份作废】',
                  '1. buildings 放4–8栋，cover 放2–4个，都不能是空数组。',
                  '2. outpost：本次区块坐标是[0,0]时必须为null；不是[0,0]时必须给出center和恰好4个spawns，四个出生点相互至少相距2.5米。reference里已经按本区块给好了可用的outpost，照它填即可。',
                  '3. name 自拟一个有特色的中文街区名，不得输出reference或示例里的name。',
                  '4. roads 必须连接给定的四个exits且整网互通。建议直接沿用reference的roads。',
                  '',
                  '【坐标与尺寸】',
                  '- buildings 和 cover 的 x,z 是矩形中心、不是左下角；w,d 是完整宽深，h 是高度。',
                  '- 中心 x,z 都必须在 10–118；w,d 在 1–24；建筑 h 在 3–18，掩体 h 在 0.7–2。',
                  '- 四条边缘必须落在区块内：x-w/2>=8、x+w/2<=120、z-d/2>=8、z+d/2<=120。',
                  '- landmark、supply、outpost 的所有点坐标都在 4–124 内。',
                  '',
                  '【留空规则】',
                  '- 任意两个组件外缘至少间隔1米。',
                  '- 道路宽8米、轴对齐。建筑和掩体都不能压到路面：任何一个的外缘与每条道路中线至少相隔4米，只有2米见方的掩体也不例外，请放到路边空地。',
                  '- landmark、supply 和每个出生点周围留出1.2米。landmark 是地面标志，不能被建筑遮挡。',
                  '- reference 里的 cover 位置只是示例，换了建筑布局后必须重新为掩体选位，不要照抄。',
                  '',
                  '【archetype：楼体形制，可选】',
                  '- 省略就是普通实心方楼。这三种本身就是可进入的战斗空间，引擎不会再给它们加“E进入住宅”的门。',
                  '- tower 开放框架楼：每层只有楼板和柱子、没有外墙，可以从地面一层层往上打。至少8×8米且高12米。',
                  '- warehouse 厂房：外墙带门洞和高窗，内部一圈马道由一段楼梯连上去，屋顶中央开天窗。至少12×12米且高8米。',
                  '- courtyard 院落：厚围墙围出中庭，正面留一个门洞，墙顶是一圈可以走的回廊。至少12×12米且高4米。',
                  '- 每个区块用1–2栋形制建筑当视觉锚点，其余保持普通方楼；形制建筑一样可以挂 stair 和 bridge。',
                  '',
                  '【structures：屋顶通路，可选，最多8个】',
                  '- 只有 stair 和 bridge 两种，引擎按固定尺寸搭建，禁止输出坐标或高度。每区块建议1–2段楼梯和1–2座天桥，让屋顶成为第二层战场。',
                  '- stair 在建筑某一面外侧搭折返楼梯直达屋顶：building 是 buildings 下标，face 取 north/south/east/west。该立面长度至少11米（north/south 看 w，east/west 看 d），楼梯向外占4.4米，不能压到道路、其它建筑或掩体。优先选朝向空地、立面较长的高建筑。',
                  '- bridge 只有 from 和 to 两个字段，是两栋不同建筑的下标。只在彼此相邻的两栋之间架桥：先按坐标找出中心相距不超过35米的一对，再按顺序核对三条：两栋 h 相差不超过4米；若两栋 x 之差大于 z 之差则桥沿 x 架设、要比较两栋 z 区间的重合长度，否则沿 z 架设、比较 x 区间的重合长度，重合至少3.4米；两栋相对立面之间的净距在4–30米。任意一条不满足就换一对建筑或改放 stair。',
                  '',
                  '【风格】',
                  '- 不要把建筑排成整齐网格：在 suggestedPlots 附近自由偏移，从 suggestedSizes 里挑不同的宽深组合，混用狭长和方正的体块。',
                  '- 至少两栋高度不低于12米，与低矮建筑拉开屋顶落差，形成广场、街巷和可攀爬的轮廓。',
                  '',
                  '【纠错】',
                  '- 收到 correction 时，按其中 error 修改 previousOutput 并仍输出完整 JSON，不要重复无效布局。',
                  '- correction.previousErrors 是前几轮已报过的错误，修正当前 error 时不要把它们重新引入。',
                  '- 校验器每次只报告遇到的第一个错误，所以改完之后请把上面每一节再核对一遍，一次性交出干净的布局。',
                ].join('\n'),
              },
              {
                role: 'user',
                content: JSON.stringify({
                  chunk: [x, z],
                  exits: exits(seed, x, z),
                  neighbors,
                  reference,
                  // Jittered plots: a fixed lattice made every generated block look alike.
                  suggestedPlots: [20, 44, 84, 108].flatMap((a) =>
                    [18, 48, 80, 110].map((b) => [a + offset(a, b), b + offset(b, a)]),
                  ),
                  suggestedSizes: [
                    [14, 9],
                    [9, 14],
                    [12, 12],
                    [16, 10],
                    [10, 16],
                    [8, 8],
                    [18, 9],
                    [16, 16],
                  ],
                  correction,
                }),
              },
            ];
        requireWorld(
          new TextEncoder().encode(JSON.stringify(messages)).byteLength <= 65536,
          '生成上下文超过64 KiB，未调用模型',
        );
        const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          signal: AbortSignal.timeout(60000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            thinking: { type: 'disabled' },
            stream: false,
            max_tokens: 6000,
            response_format: { type: 'json_object' },
            messages,
          }),
        });
        if (!response.ok) {
          const error = new Error(`DeepSeek 请求失败（HTTP ${response.status}）`);
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }
        const body = await response.json();
        output =
          typeof body.choices?.[0]?.message?.content === 'string' ? body.choices[0].message.content : '';
        log(
          JSON.stringify({
            event: 'generation',
            kind: design?.kind ?? 'legacy',
            x,
            z,
            attempt,
            elapsedMs: Date.now() - start,
            usage: body.usage ?? null,
          }),
        );
        requireWorld(
          body.choices?.[0]?.finish_reason === 'stop' && body.choices[0].message?.content?.trim(),
          '模型输出为空或已截断',
        );
        const parsed = JSON.parse(body.choices[0].message.content);
        try {
          return design ? validate(parsed) : validateGeneratedLayout(parsed, seed, x, z);
        } catch (error) {
          // A well-formed answer that breaks a map rule: the kind of mistake the model
          // can be told about and fix, unlike a truncated or unparseable one.
          error.layout = true;
          throw error;
        }
      } catch (error) {
        log(
          JSON.stringify({
            event: 'generation-error',
            x,
            z,
            attempt,
            elapsedMs: Date.now() - start,
            error: error.message,
          }),
        );
        if (error.retryable === false) throw error;
        // An invalid map gets several rounds: the validator reports only the first
        // problem it finds, so a layout with more than one needs more than one round to
        // converge. Anything else — a transport failure, an empty or truncated answer —
        // gets a single retry, because repeating it is unlikely to converge on anything.
        if (reported.length >= (error.layout ? MAX_CORRECTIONS : 1)) throw error;
        correction = {
          error: error.message,
          ...(reported.length ? { previousErrors: [...reported] } : {}),
          previousOutput: output.slice(0, 32000),
        };
        reported.push(error.message);
      }
    }
  };
}
