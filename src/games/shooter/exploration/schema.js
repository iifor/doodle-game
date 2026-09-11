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

// Roof access and rooftop routes are named archetypes, not stored geometry: the model
// picks a type and an anchor, and both the validator and the builder expand the same
// fixed dimensions. A layout without `structures` expands to nothing and keeps its
// original bytes, so saved worlds still match their checksum.
export const STRUCTURE_TYPES = ['stair', 'bridge'];
export const MAX_STRUCTURES = 8;
export const STAIR_TREADS = 14;
export const STAIR_RUN = 0.45;
export const STAIR_FLIGHT = STAIR_TREADS * STAIR_RUN;
export const STAIR_LANDING = 2.2;
export const STAIR_SPAN = STAIR_FLIGHT + 2 * STAIR_LANDING; // a flight plus a landing at each end
export const STAIR_DEPTH = 4.4; // two alternating lanes and the landing depth
export const BRIDGE_WIDTH = 2.4;
export const BRIDGE_RISE = 4; // the tallest step flight a deck can carry to the higher roof
export const FACES = {
  north: [0, -1],
  south: [0, 1],
  west: [-1, 0],
  east: [1, 0],
};
export function expandStructures(raw, buildings) {
  if (raw.structures === undefined) return [];
  requireWorld(
    Array.isArray(raw.structures) && raw.structures.length <= MAX_STRUCTURES,
    `附属结构数量无效，最多 ${MAX_STRUCTURES} 个`,
  );
  return raw.structures.map((s) => {
    requireWorld(s && STRUCTURE_TYPES.includes(s.type), '附属结构类型无效，只能是 stair 或 bridge');
    if (s.type === 'stair') {
      requireWorld(
        Number.isInteger(s.building) && s.building >= 0 && s.building < buildings.length,
        '楼梯的 building 必须是 buildings 的下标',
      );
      requireWorld(s.face in FACES, '楼梯的 face 只能是 north/south/east/west');
      const host = buildings[s.building],
        [nx, nz] = FACES[s.face];
      const along = nx ? host.d : host.w;
      requireWorld(
        along >= STAIR_SPAN,
        `楼梯所在立面长 ${along} 米，不足 ${STAIR_SPAN} 米；请换一面或加长建筑`,
      );
      const reach = (nx ? host.w : host.d) / 2 + STAIR_DEPTH / 2;
      return {
        type: 'stair',
        building: s.building,
        face: s.face,
        host,
        flights: Math.max(1, Math.ceil(host.h / 4)),
        rect: {
          x: host.x + nx * reach,
          z: host.z + nz * reach,
          w: nx ? STAIR_DEPTH : STAIR_SPAN,
          d: nx ? STAIR_SPAN : STAIR_DEPTH,
        },
      };
    }
    requireWorld(
      [s.from, s.to].every((i) => Number.isInteger(i) && i >= 0 && i < buildings.length) && s.from !== s.to,
      '天桥的 from 和 to 必须是两栋不同建筑的下标',
    );
    const a = buildings[s.from],
      c = buildings[s.to];
    const spanX = Math.abs(a.x - c.x) > Math.abs(a.z - c.z);
    const gap = spanX ? Math.abs(a.x - c.x) - (a.w + c.w) / 2 : Math.abs(a.z - c.z) - (a.d + c.d) / 2;
    requireWorld(number(gap, 4, 30), `天桥跨度 ${gap.toFixed(1)} 米超出 4–30 米`);
    const lo = spanX ? Math.max(a.z - a.d / 2, c.z - c.d / 2) : Math.max(a.x - a.w / 2, c.x - c.w / 2);
    const hi = spanX ? Math.min(a.z + a.d / 2, c.z + c.d / 2) : Math.min(a.x + a.w / 2, c.x + c.w / 2);
    requireWorld(hi - lo >= BRIDGE_WIDTH + 1, '天桥两端建筑在横向没有足够重合，无法搭出通路');
    // The deck is laid flush with the lower roof and the engine steps up to the higher
    // one, so a bridge always lands somewhere you can stand.
    const rise = Math.abs(a.h - c.h);
    requireWorld(rise <= BRIDGE_RISE, `天桥两端屋顶相差 ${rise} 米，超过 ${BRIDGE_RISE} 米无法接上`);
    requireWorld(
      rise <= 0.4 || gap >= STAIR_FLIGHT + 2.7,
      `天桥两端有 ${rise} 米落差，跨度需要至少 ${STAIR_FLIGHT + 2.7} 米才放得下接续台阶`,
    );
    // The deck runs between the two facing facades and is centred on their overlap.
    const [first, second] = spanX ? (a.x < c.x ? [a, c] : [c, a]) : a.z < c.z ? [a, c] : [c, a];
    const start = spanX ? first.x + first.w / 2 : first.z + first.d / 2;
    const end = spanX ? second.x - second.w / 2 : second.z - second.d / 2;
    const centre = (lo + hi) / 2;
    // A deck is elevated, so it never blocks the ground; it only has to miss other roofs.
    return {
      type: 'bridge',
      from: s.from,
      to: s.to,
      y: Math.min(a.h, c.h),
      rise,
      // Which end of the deck the step flight climbs towards.
      highEnd: rise <= 0.4 ? 0 : first.h > second.h ? -1 : 1,
      spanX,
      deck: {
        x: spanX ? (start + end) / 2 : centre,
        z: spanX ? centre : (start + end) / 2,
        w: spanX ? end - start : BRIDGE_WIDTH,
        d: spanX ? BRIDGE_WIDTH : end - start,
      },
      rect: null,
    };
  });
}
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
  const structures = expandStructures(raw, raw.buildings);
  for (const s of structures) {
    if (s.type === 'bridge') {
      // A deck must not drive through a third roof that stands above it.
      requireWorld(
        !raw.buildings.some(
          (b, i) =>
            i !== s.from &&
            i !== s.to &&
            b.h > s.y &&
            Math.abs(b.x - s.deck.x) < (b.w + s.deck.w) / 2 &&
            Math.abs(b.z - s.deck.z) < (b.d + s.deck.d) / 2,
        ),
        '天桥穿过了第三栋更高的建筑',
      );
      continue;
    }
    requireWorld(
      s.rect.x - s.rect.w / 2 >= 8 &&
        s.rect.x + s.rect.w / 2 <= 120 &&
        s.rect.z - s.rect.d / 2 >= 8 &&
        s.rect.z + s.rect.d / 2 <= 120,
      `楼梯占用区块接缝：中心(${s.rect.x},${s.rect.z})；边缘必须在[8,120]`,
    );
    requireWorld(
      !rectangles.some(
        (a, i) =>
          i !== s.building &&
          Math.abs(a.x - s.rect.x) < (a.w + s.rect.w) / 2 + 1 &&
          Math.abs(a.z - s.rect.z) < (a.d + s.rect.d) / 2 + 1,
      ),
      `楼梯与其它建筑或掩体重叠：中心(${s.rect.x},${s.rect.z})；请换一面墙`,
    );
    rectangles.push(s.rect);
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
    // Omitted entirely when absent, so a saved layout without structures keeps its checksum.
    ...(raw.structures === undefined
      ? {}
      : {
          structures: structures.map((s) =>
            s.type === 'stair'
              ? { type: 'stair', building: s.building, face: s.face }
              : { type: 'bridge', from: s.from, to: s.to },
          ),
        }),
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
// The prompt hands the model a worked example; a copied name means it skipped the brief.
export const EXAMPLE_NAME = '示例街区（请自拟）';
const COPIED_NAMES = [EXAMPLE_NAME, '街区名称', '区域名', '区域名称', '街区名', '区域'];
// Generation has a content minimum; archived layouts keep their original validation contract.
export function validateGeneratedLayout(raw, seed, x, z) {
  const layout = validateLayout(raw, seed, x, z);
  requireWorld(layout.buildings.length >= 4, '新区域至少需要四栋建筑，不能生成空地图');
  requireWorld(
    !COPIED_NAMES.includes(layout.name),
    `区域名称"${layout.name}"照抄了示例占位符，请自拟一个有特色的中文街区名`,
  );
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
