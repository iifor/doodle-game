import { createBuilder } from './levels/builder.js';
import { buildDistrict } from './levels/district.js';
import { buildMexico } from './levels/mexico.js';

// Doodle Mexico is built and kept, but off the menu until it is ready; flip this to offer it again
export const MEXICO_READY = false;
export const LEVELS = [
  { key: 'district', name: '涂鸦街区', blurb: '街道、屋顶与消防梯' },
  ...(MEXICO_READY
    ? [{ key: 'mexico', name: '涂鸦墨西哥', blurb: '阳光下的广场 · 彩罐、塔可与墨西哥乐队' }]
    : []),
];

export function buildLevel(scene, world, key = 'district', opts = {}) {
  if (key !== 'district' && key !== 'mexico') throw new Error(`Unknown map: ${key}`);
  const B = createBuilder(scene, world);
  return key === 'mexico' ? buildMexico(B, !!opts.arena) : buildDistrict(B, !!opts.arena);
}
