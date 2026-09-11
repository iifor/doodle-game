import { coordinates, keyOf, requireWorld, hash, checksum } from './schema.js';

// Interior instances use isolated vertical bands. They never consume outdoor
// chunk coordinates, so exploring further cannot collide with an indoor scene.
export const INTERIOR_VERSION = 1;
export const interiorBase = (index) => 256 + index * 32;
export const interiorId = (x, z, index) => `house_${x}_${z}_${index}`;
export function parseInteriorId(id) {
  const m = typeof id === 'string' && /^house_(-?\d+)_(-?\d+)_(\d+)$/.exec(id);
  requireWorld(m, '建筑编号无效');
  const [x, z, index] = m.slice(1).map(Number);
  coordinates(x, z);
  requireWorld(index >= 0 && index < 32 && interiorId(x, z, index) === id, '建筑编号无效');
  return { x, z, index };
}
export function dynamicScene(p) {
  if (p.y < 240) return 'outdoor';
  const index = Math.floor((p.y - 240) / 32);
  return interiorId(p.cx, p.cz, index);
}
export function enterableBuildings(block) {
  if (!block || block.layout.interior || block.layout.schemaVersion === 2) return [];
  return block.layout.buildings.flatMap((b, index) => {
    // An archetype is walked into directly, so it never also offers a doorway portal.
    if (b.archetype || b.w < 6 || b.d < 6 || (index > 0 && hash(`${block.x},${block.z}:${index}`) % 3 === 0))
      return [];
    // Put the portal immediately against the facade and reject obstructed doors.
    const door = { cx: block.x, cz: block.z, x: b.x, y: 0, z: b.z - b.d / 2 - 1.4 };
    if (
      [...block.layout.buildings, ...block.layout.cover].some(
        (a, i) =>
          i !== index && Math.abs(a.x - door.x) < a.w / 2 + 0.7 && Math.abs(a.z - door.z) < a.d / 2 + 0.7,
      )
    )
      return [];
    return [
      {
        ...b,
        id: interiorId(block.x, block.z, index),
        index,
        cx: block.x,
        cz: block.z,
        title: `街区住宅 ${index + 1}`,
        door,
        baseY: interiorBase(index),
      },
    ];
  });
}
export const ROOM_TYPES = ['living', 'kitchen', 'bedroom', 'bathroom', 'study', 'storage', 'dining'];
export const ROOM_NAMES = {
  living: '客厅',
  kitchen: '厨房',
  bedroom: '卧室',
  bathroom: '浴室',
  study: '书房',
  storage: '储藏室',
  dining: '餐厅',
};
export const interiorExample = {
  name: '纸间小屋',
  palette: 'blue',
  width: 24,
  depth: 28,
  floors: [
    {
      left: [
        { type: 'living', window: true, connecting: true },
        { type: 'kitchen', window: true, connecting: false },
      ],
      right: [
        { type: 'dining', window: true, connecting: false },
        { type: 'bathroom', window: false, connecting: false },
      ],
    },
    {
      left: [{ type: 'bedroom', window: true, connecting: false }],
      right: [
        { type: 'study', window: true, connecting: false },
        { type: 'storage', window: false, connecting: false },
      ],
    },
  ],
};
// A centre corridor splits the plan in two; a side corridor hugs one outside wall and
// gives the other side rooms twice as deep. Older saved plans have no `corridor` key,
// so it is only written back when the plan supplied one and their bytes stay the same.
export const CORRIDORS = ['centre', 'left', 'right'];
export function validateInteriorPlan(raw) {
  requireWorld(
    raw &&
      typeof raw.name === 'string' &&
      raw.name.trim() &&
      raw.name.length <= 30 &&
      !/[\p{Cc}\p{Cf}]/u.test(raw.name),
    '室内名称无效',
  );
  requireWorld(['blue', 'green', 'orange'].includes(raw.palette), '室内配色无效');
  requireWorld([20, 24, 28].includes(raw.width) && [24, 28, 32].includes(raw.depth), '室内尺寸无效');
  requireWorld(
    raw.corridor === undefined || CORRIDORS.includes(raw.corridor),
    '走廊形式只能是 centre、left 或 right',
  );
  const corridor = raw.corridor ?? 'centre';
  requireWorld(
    Array.isArray(raw.floors) && raw.floors.length >= 1 && raw.floors.length <= 3,
    '建筑须有一至三层',
  );
  const floors = raw.floors.map((floor) =>
    Object.fromEntries(
      ['left', 'right'].map((side) => {
        const rooms = floor?.[side];
        // The side a wall-hugging corridor runs down carries no rooms at all.
        if (corridor === side) {
          requireWorld(
            Array.isArray(rooms) && rooms.length === 0,
            `走廊贴着 ${side} 侧外墙时，该侧必须是空数组`,
          );
          return [side, []];
        }
        requireWorld(
          Array.isArray(rooms) && rooms.length >= 1 && rooms.length <= 3,
          corridor === 'centre' ? '每层走廊两侧各须有一至三个房间' : '走廊另一侧须有一至三个房间',
        );
        return [
          side,
          rooms.map((r) => {
            requireWorld(
              r &&
                ROOM_TYPES.includes(r.type) &&
                typeof r.window === 'boolean' &&
                typeof r.connecting === 'boolean',
              '房间用途、窗户或连通门无效',
            );
            return { type: r.type, window: r.window, connecting: r.connecting };
          }),
        ];
      }),
    ),
  );
  const ground = [...floors[0].left, ...floors[0].right];
  requireWorld(
    ground.some((r) => r.type === 'living') && ground.some((r) => r.type === 'kitchen'),
    '一层必须有客厅和厨房',
  );
  return {
    name: raw.name.trim(),
    palette: raw.palette,
    width: raw.width,
    depth: raw.depth,
    ...(raw.corridor === undefined ? {} : { corridor }),
    floors,
  };
}
// Where the corridor sits, in local metres. `walk` is the through lane and `stair` is
// the flight beside it, so climbing never closes the route to the rooms further back.
export function corridorBounds(plan) {
  const x0 = 64 - plan.width / 2,
    x1 = 64 + plan.width / 2;
  // A centre corridor keeps the original lanes so existing plans expand unchanged.
  const b =
    (plan.corridor ?? 'centre') === 'centre'
      ? { lo: 61, hi: 69, walk: 62.5, stair: 65.5, stairW: 2.6 }
      : plan.corridor === 'left'
        ? { lo: x0, hi: x0 + 3.2, walk: x0 + 2.3, stair: x0 + 0.8, stairW: 1.4 }
        : { lo: x1 - 3.2, hi: x1, walk: x1 - 2.3, stair: x1 - 0.8, stairW: 1.4 };
  return { x0, x1, ...b, hole: [b.stair - b.stairW / 2 - 0.1, b.stair + b.stairW / 2 + 0.1] };
}
export function expandHouse(plan, building) {
  plan = validateInteriorPlan(plan);
  const id = building.id;
  parseInteriorId(id);
  const walk = corridorBounds(plan).walk;
  return {
    interiorVersion: INTERIOR_VERSION,
    sceneId: id,
    buildingId: id,
    interior: true,
    name: plan.name,
    plan,
    baseY: building.baseY,
    w: plan.width,
    d: plan.depth,
    h: plan.floors.length * 4,
    entrance: [walk, 64 - plan.depth / 2 + 2.5],
    exteriorDoor: building.door,
    roads: [],
    buildings: [],
    cover: [],
    landmark: [walk, 64],
    supply: [walk, 64 - plan.depth / 2 + 2.5],
    outpost: null,
  };
}
export function validateHouseLayout(raw, x, z) {
  requireWorld(raw?.interiorVersion === INTERIOR_VERSION, '室内存档版本不兼容，原文件已保留');
  const parsed = parseInteriorId(raw.buildingId);
  requireWorld(parsed.x === x && parsed.z === z, '室内区块不匹配');
  const door = raw.exteriorDoor;
  requireWorld(
    door &&
      door.cx === x &&
      door.cz === z &&
      door.y === 0 &&
      [door.x, door.z].every((v) => Number.isFinite(v) && v >= 4 && v <= 124),
    '室内出口无效',
  );
  const expected = expandHouse(raw.plan, { id: raw.buildingId, baseY: interiorBase(parsed.index), door });
  requireWorld(JSON.stringify(raw) === JSON.stringify(expected), '室内结构校验失败，原文件已保留');
  return expected;
}
export async function validateHouseBlock(block) {
  const l = validateHouseLayout(block.layout, block.x, block.z);
  requireWorld((await checksum(l)) === block.checksum, '室内地图校验失败');
  return block;
}
export const houseEntry = (layout, x, z) => ({
  cx: x,
  cz: z,
  x: layout.entrance[0],
  y: layout.baseY,
  z: layout.entrance[1],
});
export const blockKey = (block) =>
  block.layout.interiorVersion ? block.layout.sceneId : keyOf(block.x, block.z);
