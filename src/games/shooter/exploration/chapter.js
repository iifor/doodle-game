import { requireWorld } from './schema.js';

export const WORLD_STORY =
  '失控的涂鸦切断了纸上城镇的能源。你是守护城镇的涂鸦旅人，选择一种固定战斗流派，与伙伴清理据点、重燃街区。安全据点会将被擦除的旅人重新绘出；训练是演练，PVP 是保留真实实力的切磋。';

// Saved layouts keep their original encounters; this chapter is assigned only to new worlds.
export const CHAPTER_STEPS = [
  { key: '1,0', name: '东侧街区', enemies: ['grunt', 'grunt'] },
  { key: '0,-1', name: '北侧街区', enemies: ['grunt', 'grunt', 'rusher'] },
  { key: '1,-1', name: '东北街区', enemies: ['grunt', 'rusher', 'grunt', 'sniper'] },
  { key: '2,-1', name: '核心供电站', enemies: ['heavy', 'shield', 'grunt', 'grunt', 'rusher', 'sniper'] },
];

export function chapterPower(info, progress) {
  return info?.chapterVersion === 1
    ? CHAPTER_STEPS.map((step) => progress?.chunks?.[step.key]?.powered === true)
    : null;
}

export function validateChapterPower(info, power) {
  requireWorld(
    info?.chapterVersion === 1
      ? Array.isArray(power) &&
          power.length === 4 &&
          power.every((v) => typeof v === 'boolean') &&
          (!power[3] || power.slice(0, 3).every(Boolean))
      : power == null,
    '章节进度无效',
  );
  return power;
}

export function chapterSummary(power) {
  if (!power) return null;
  const next = power.findIndex((v) => !v),
    restored = power.filter(Boolean).length;
  return {
    power,
    restored,
    complete: next === -1,
    next: CHAPTER_STEPS[next] ?? null,
    text:
      next === -1
        ? '第一章完成：重燃街区 · 4 处供电已恢复，补给站与住宅已开放。可保存退出、调整搭配，或继续自由探索。'
        : `第一章：重燃街区 · 已修复 ${restored}/4 · 下一目标：${CHAPTER_STEPS[next].name}（${CHAPTER_STEPS[next].key}）`,
  };
}

export function canPowerChapter(info, key, power) {
  return info?.chapterVersion !== 1 || key !== CHAPTER_STEPS[3].key || power?.slice(0, 3).every(Boolean);
}
