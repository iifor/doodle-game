import { requireWorld, validateLayout } from './schema.js';

// Archived template version 1: keep these dimensions and expansion rules immutable; add a new version for future geometry changes.
export const TEMPLATE_VERSION = 1;
export const TEMPLATES = {
  shop: { title: '小商店', w: 16, d: 16, h: 5 },
  corner: { title: '转角商店', w: 20, d: 16, h: 5 },
  home: { title: '住宅', w: 20, d: 20, h: 5 },
  warehouse: { title: '仓库', w: 24, d: 24, h: 7 },
};
export const PLOTS = [
  ['shop', 0, 0, 28, 28],
  ['shop', 1, 0, 28, 28],
  ['corner', 1, 0, 100, 100],
  ['home', 1, 0, 28, 100],
  ['corner', 0, 1, 28, 28],
  ['home', 0, 1, 100, 100],
  ['warehouse', 1, 1, 100, 100],
].map(([templateId, cx, cz, x, z], i) => ({
  id: `building-${i + 1}`,
  templateId,
  cx,
  cz,
  x,
  z,
  // ponytail: seven separated scene slots reuse chunk collision/nav; use per-scene contexts if regions grow beyond this fixed prototype.
  sceneX: 8 + i * 3,
  sceneZ: 0,
  ...TEMPLATES[templateId],
}));
export const outdoors = (x, z) =>
  Number.isInteger(x) && Number.isInteger(z) && x >= 0 && x < 2 && z >= 0 && z < 2;
export const buildingAt = (x, z) => PLOTS.find((b) => b.sceneX === x && b.sceneZ === z);
export const buildingById = (id) => PLOTS.find((b) => b.id === id);
export const sceneOf = (p) => buildingAt(p.cx, p.cz)?.id ?? 'outdoor';
export const doorPosition = (b) => ({ cx: b.cx, cz: b.cz, x: b.x, y: 0, z: b.z - b.d / 2 - 5 });
export const entryPosition = (b) => ({ cx: b.sceneX, cz: b.sceneZ, x: 64, y: 0, z: 64 - b.d / 2 + 3 });
const cleanText = (value, max = 60) => {
  requireWorld(
    typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= max &&
      !/[\p{Cc}\p{Cf}<>]/u.test(value),
    '名称或设定无效',
  );
  return value.trim();
};
export function validateTheme(raw) {
  requireWorld(raw && Array.isArray(raw.districts) && raw.districts.length === 2, '需要两个街坊主题');
  return {
    background: cleanText(raw.background, 500),
    name: cleanText(raw.name, 30),
    style: cleanText(raw.style, 300),
    districts: raw.districts.map((d) => ({ name: cleanText(d.name, 30), style: cleanText(d.style, 300) })),
  };
}
export function validateVariation(raw) {
  requireWorld(raw && ['blue', 'green', 'orange'].includes(raw.palette), '模板配色无效');
  requireWorld(['awning', 'stripes', 'plain'].includes(raw.decoration), '模板装饰无效');
  requireWorld(
    Array.isArray(raw.slots) &&
      raw.slots.length === 4 &&
      raw.slots.every((s) => ['empty', 'shelf', 'crate', 'table'].includes(s)),
    '家具槽位无效',
  );
  return {
    name: cleanText(raw.name, 30),
    sign: cleanText(raw.sign, 24),
    palette: raw.palette,
    decoration: raw.decoration,
    slots: [...raw.slots],
  };
}
export const themeExample = {
  background: '纸上的旧港小镇',
  name: '折页港',
  style: '蓝墨线条与暖色店招',
  districts: [
    { name: '晨光街', style: '整齐的小店和条纹雨棚' },
    { name: '旧货巷', style: '木箱与绿色窗框' },
  ],
};
export const variationExample = {
  name: '晨光杂货',
  sign: '今日营业',
  palette: 'blue',
  decoration: 'awning',
  slots: ['shelf', 'table', 'empty', 'crate'],
};
export function plotsIn(x, z) {
  return PLOTS.filter((b) => b.cx === x && b.cz === z);
}
export function validateStreetDesign(raw, x, z) {
  const plots = plotsIn(x, z);
  requireWorld(
    raw && Array.isArray(raw.buildings) && raw.buildings.length === plots.length,
    '建筑数量不匹配',
  );
  return {
    name: cleanText(raw.name, 30),
    buildings: plots.map((b) => {
      const matches = raw.buildings.filter((v) => v.id === b.id);
      requireWorld(matches.length === 1, '建筑身份不匹配');
      return { id: b.id, ...validateVariation(matches[0]) };
    }),
  };
}
export function expandStreet(design, x, z) {
  requireWorld(outdoors(x, z), '已经到达小区域边界');
  const roads = [
    [64, 4, 64, 124],
    [4, 64, 124, 64],
  ];
  const buildings = plotsIn(x, z).map((b, i) => {
    const door = doorPosition(b);
    roads.push([64, door.z, b.x, door.z], [64, door.z, 64, 64]);
    return { ...b, templateVersion: TEMPLATE_VERSION, variation: design.buildings[i], door };
  });
  return {
    schemaVersion: 2,
    sceneId: 'outdoor',
    name: design.name,
    roads,
    buildings,
    cover: [],
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
}
export function expandInterior(building, variation) {
  const { w, d, h } = building;
  const solids = [
    { x: 64, z: 64 - d / 2, w, d: 0.4, h },
    { x: 64, z: 64 + d / 2, w, d: 0.4, h },
    { x: 64 - w / 2, z: 64, w: 0.4, d, h },
    { x: 64 + w / 2, z: 64, w: 0.4, d, h },
  ];
  const furnishings = variation.slots.flatMap((kind, i) =>
    kind === 'empty'
      ? []
      : [
          {
            kind,
            x: 64 + (i % 2 ? 1 : -1) * (w / 2 - 2.5),
            z: 64 + (i < 2 ? -1 : 1) * (d / 2 - 4),
            w: 2,
            d: 2,
            h: kind === 'shelf' ? 2.3 : kind === 'table' ? 0.9 : 1.3,
          },
        ],
  );
  return {
    schemaVersion: 2,
    sceneId: building.id,
    name: building.variation.name,
    interior: true,
    buildingId: building.id,
    templateId: building.templateId,
    templateVersion: building.templateVersion,
    variation,
    w,
    d,
    h,
    entrance: [64, 64 - d / 2 + 3],
    solids,
    furnishings,
    roads: [],
    buildings: [],
    cover: [],
    landmark: [64, 64],
    supply: [64, 64 - d / 2 + 3],
    outpost:
      building.templateId === 'warehouse'
        ? {
            center: [64, 64],
            spawns: [
              [58, 61],
              [70, 61],
              [58, 67],
              [70, 67],
            ],
          }
        : null,
  };
}
// Frozen V2 template geometry is checked independently of future template expansion.
export function validateRegionLayout(raw, x, z) {
  requireWorld(raw?.schemaVersion === 2, '区域版本无效');
  if (!raw.interior) {
    requireWorld(outdoors(x, z) && raw.sceneId === 'outdoor', '区域坐标无效');
    const design = validateStreetDesign(
      { name: raw.name, buildings: raw.buildings?.map((b) => ({ ...b.variation, id: b.id })) },
      x,
      z,
    );
    const expected = expandStreet(design, x, z);
    requireWorld(JSON.stringify(raw) === JSON.stringify(expected), '户外布局违反固定道路或建筑模板');
    return raw;
  }
  const b = buildingAt(x, z);
  requireWorld(
    b &&
      raw.sceneId === b.id &&
      raw.buildingId === b.id &&
      raw.templateId === b.templateId &&
      raw.templateVersion === 1,
    '室内身份无效',
  );
  cleanText(raw.name, 30);
  validateVariation(raw.variation);
  requireWorld(raw.w === b.w && raw.d === b.d && raw.h === b.h, '室内尺寸与建筑不一致');
  const expected = expandInterior({ ...b, templateVersion: 1, variation: { name: raw.name } }, raw.variation);
  requireWorld(JSON.stringify(raw) === JSON.stringify(expected), '室内布局违反模板通道或安全空间');
  return raw;
}
export function validateWorldLayout(raw, info, x, z) {
  return info.schemaVersion === 2 ? validateRegionLayout(raw, x, z) : validateLayout(raw, info.seed, x, z);
}
