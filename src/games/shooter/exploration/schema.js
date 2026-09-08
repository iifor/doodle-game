export const SIZE = 128;
export const SCHEMA = 1;
export const GENERATOR = 1;
export const ENEMY_TYPES = ['grunt', 'grunt', 'rusher', 'sniper'];
export const ENCOUNTER_TYPES = ['grunt', 'rusher', 'heavy', 'sniper', 'shield'];
export const MAX_ENCOUNTER_ENEMIES = 8;
export const outpostComplete = (state) => !!state && state.defeated.length === (state.total ?? 4);
export function requireWorld(ok, message) {
  if (!ok) throw new Error(message);
}
export const keyOf = (x, z) => `${x},${z}`;
export function coordinates(x, z) {
  requireWorld(
    [x, z].every((v) => Number.isSafeInteger(v) && Math.abs(v) <= 1000000),
    '区块坐标无效',
  );
  return keyOf(x, z);
}
export function address(x, y, z, origin = [0, 0]) {
  const cx = Math.floor(x / SIZE),
    cz = Math.floor(z / SIZE);
  coordinates(cx + origin[0], cz + origin[1]);
  requireWorld(Number.isFinite(y) && y >= -20 && y <= 1280, '高度无效');
  return { cx: cx + origin[0], cz: cz + origin[1], x: x - cx * SIZE, y, z: z - cz * SIZE };
}
export function validAddress(p) {
  requireWorld(p && typeof p === 'object', '位置无效');
  coordinates(p.cx, p.cz);
  requireWorld(
    [p.x, p.y, p.z].every(Number.isFinite) &&
      p.x >= 0 &&
      p.x < SIZE &&
      p.z >= 0 &&
      p.z < SIZE &&
      p.y >= -20 &&
      p.y <= 1280,
    '区块内位置无效',
  );
  return p;
}
export const localPosition = (p, origin) => [
  (p.cx - origin[0]) * SIZE + p.x,
  p.y,
  (p.cz - origin[1]) * SIZE + p.z,
];
export function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function exits(seed, x, z) {
  const at = (axis, a, b) => 32 + (hash(`${seed}:${axis}:${a}:${b}`) % 3) * 32;
  return [
    [at('z', x, z), 4],
    [124, at('x', x + 1, z)],
    [at('z', x, z + 1), 124],
    [4, at('x', x, z)],
  ];
}
const number = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const point = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => number(n, 4, 124));
const text = (v) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= 40 && !/[\p{Cc}\p{Cf}]/u.test(v);
export function validateLayout(raw, seed, x, z) {
  coordinates(x, z);
  requireWorld(raw && text(raw.name), '区域名称无效');
  requireWorld(Array.isArray(raw.buildings) && raw.buildings.length <= 32, '建筑数量无效');
  requireWorld(Array.isArray(raw.cover) && raw.cover.length <= 32, '掩体数量无效');
  requireWorld(Array.isArray(raw.roads) && raw.roads.length >= 1 && raw.roads.length <= 24, '道路数量无效');
  const rectangles = [];
  for (const [items, minH, maxH] of [
    [raw.buildings, 3, 18],
    [raw.cover, 0.7, 2],
  ]) {
    for (const b of items) {
      requireWorld(
        b &&
          number(b.x, 10, 118) &&
          number(b.z, 10, 118) &&
          number(b.w, 1, 24) &&
          number(b.d, 1, 24) &&
          number(b.h, minH, maxH),
        '建筑或掩体尺寸无效',
      );
      requireWorld(
        b.x - b.w / 2 >= 8 && b.x + b.w / 2 <= 120 && b.z - b.d / 2 >= 8 && b.z + b.d / 2 <= 120,
        `组件占用区块接缝：中心(${b.x},${b.z})、宽深(${b.w},${b.d})；边缘必须在[8,120]`,
      );
      requireWorld(
        !rectangles.some(
          (a) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 1 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + 1,
        ),
        `建筑或掩体相互重叠：中心(${b.x},${b.z})、宽深(${b.w},${b.d})`,
      );
      rectangles.push(b);
    }
  }
  const blocked = (x, z, r = 0.6) =>
    rectangles.some((b) => Math.abs(b.x - x) < b.w / 2 + r && Math.abs(b.z - z) < b.d / 2 + r);
  for (const road of raw.roads) {
    requireWorld(
      Array.isArray(road) &&
        road.length === 4 &&
        point(road.slice(0, 2)) &&
        point(road.slice(2)) &&
        (road[0] === road[2] || road[1] === road[3]),
      '道路必须为区块内的直线',
    );
    const length = Math.hypot(road[2] - road[0], road[3] - road[1]);
    requireWorld(length > 0, '道路长度无效');
    for (let i = 0; i <= Math.ceil(length); i++) {
      const t = i / Math.ceil(length);
      requireWorld(
        !blocked(road[0] + (road[2] - road[0]) * t, road[1] + (road[3] - road[1]) * t, 4),
        `建筑挡住道路：道路[${road.join(',')}]，中线两侧各4米需留空`,
      );
    }
  }
  requireWorld(point(raw.landmark) && point(raw.supply), '地标或补给点无效');
  const camp = x === 0 && z === 0;
  requireWorld(
    camp
      ? raw.outpost === null
      : raw.outpost &&
          point(raw.outpost.center) &&
          Array.isArray(raw.outpost.spawns) &&
          (raw.outpost.encounterVersion === 1
            ? raw.outpost.spawns.length >= 1 && raw.outpost.spawns.length <= MAX_ENCOUNTER_ENEMIES
            : raw.outpost.spawns.length === 4) &&
          raw.outpost.spawns.every(point),
    '据点出生点无效',
  );
  if (!camp && raw.outpost.encounterVersion !== undefined) {
    requireWorld(
      raw.outpost.encounterVersion === 1 &&
        Array.isArray(raw.outpost.types) &&
        raw.outpost.types.length === raw.outpost.spawns.length &&
        raw.outpost.types.every((t) => ENCOUNTER_TYPES.includes(t)),
      '敌人配置无效',
    );
  }
  const ends = exits(seed, x, z);
  if (!camp)
    for (let i = 0; i < raw.outpost.spawns.length; i++)
      for (let j = i + 1; j < raw.outpost.spawns.length; j++) {
        const a = raw.outpost.spawns[i],
          b = raw.outpost.spawns[j];
        requireWorld(Math.hypot(a[0] - b[0], a[1] - b[1]) >= 2.5, '敌人出生点过近');
      }
  for (const [a, b] of ends)
    requireWorld(
      raw.roads.some((r) => (r[0] === a && r[1] === b) || (r[2] === a && r[3] === b)),
      '道路未连接指定出口',
    );
  const roadBounds = raw.roads.map(([a, b, c, d]) => [
    Math.min(a, c) - 4,
    Math.min(b, d) - 4,
    Math.max(a, c) + 4,
    Math.max(b, d) + 4,
  ]);
  const connected = new Set([0]),
    roadsToVisit = [0];
  for (let i = 0; i < roadsToVisit.length; i++) {
    const a = roadBounds[roadsToVisit[i]];
    roadBounds.forEach((b, index) => {
      if (!connected.has(index) && a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]) {
        connected.add(index);
        roadsToVisit.push(index);
      }
    });
  }
  requireWorld(connected.size === raw.roads.length, '道路网络不连通');
  const goals = [
    ...ends,
    raw.landmark,
    raw.supply,
    ...(camp ? [[64, 64]] : [raw.outpost.center, ...raw.outpost.spawns]),
  ];
  for (const p of goals) requireWorld(!blocked(...p, 1.2), '出生点、地标或补给与障碍物重叠');
  // A two-metre walkability grid checks the whole block, not just a straight-line guess.
  const seen = new Set(),
    queue = [[Math.floor(goals[0][0] / 2), Math.floor(goals[0][1] / 2)]];
  seen.add(keyOf(...queue[0]));
  for (let i = 0; i < queue.length; i++) {
    const [a, b] = queue[i];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = a + dx,
        nz = b + dz,
        key = keyOf(nx, nz);
      if (nx < 0 || nx >= 64 || nz < 0 || nz >= 64 || seen.has(key) || blocked(nx * 2 + 1, nz * 2 + 1))
        continue;
      seen.add(key);
      queue.push([nx, nz]);
    }
  }
  for (const [a, b] of goals)
    requireWorld(seen.has(keyOf(Math.floor(a / 2), Math.floor(b / 2))), '区域出口或据点不可达');
  return {
    name: raw.name.trim(),
    roads: raw.roads.map((r) => [...r]),
    buildings: raw.buildings.map(({ x, z, w, d, h }) => ({ x, z, w, d, h })),
    cover: raw.cover.map(({ x, z, w, d, h }) => ({ x, z, w, d, h })),
    landmark: [...raw.landmark],
    supply: [...raw.supply],
    outpost: camp
      ? null
      : {
          center: [...raw.outpost.center],
          spawns: raw.outpost.spawns.map((p) => [...p]),
          ...(raw.outpost.encounterVersion === 1
            ? { encounterVersion: 1, types: [...raw.outpost.types] }
            : {}),
        },
  };
}
export function connectingRoads(seed, x, z) {
  return exits(seed, x, z).flatMap(([a, b]) =>
    a === 64 || b === 64
      ? [[a, b, 64, 64]]
      : [
          [a, b, 64, b],
          [64, b, 64, 64],
        ],
  );
}
// Generation has a content minimum; archived layouts keep their original validation contract.
export function validateGeneratedLayout(raw, seed, x, z) {
  const layout = validateLayout(raw, seed, x, z);
  requireWorld(layout.buildings.length >= 4, '新区域至少需要四栋建筑，不能生成空地图');
  return layout;
}
export function campLayout(seed) {
  return validateLayout(
    {
      name: '纸页营地',
      roads: connectingRoads(seed, 0, 0),
      buildings: [],
      cover: [],
      landmark: [64, 64],
      supply: [68, 68],
      outpost: null,
    },
    seed,
    0,
    0,
  );
}
export function validateProgress(p, total = p?.total ?? 4) {
  requireWorld(
    Number.isInteger(total) &&
      total >= 1 &&
      total <= MAX_ENCOUNTER_ENEMIES &&
      (p?.total === undefined || p.total === total),
    '据点敌人总数无效',
  );
  requireWorld(
    p &&
      Array.isArray(p.defeated) &&
      p.defeated.length <= total &&
      p.defeated.every((n) => Number.isInteger(n) && n >= 0 && n < total) &&
      new Set(p.defeated).size === p.defeated.length,
    '敌人进度无效',
  );
  requireWorld(
    typeof p.rewarded === 'boolean' && (!p.rewarded || p.defeated.length === total),
    '奖励进度无效',
  );
  return {
    defeated: [...p.defeated].sort((a, b) => a - b),
    rewarded: p.rewarded,
    ...(p.total !== undefined || total !== 4 ? { total } : {}),
  };
}
export async function checksum(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
