import { keyOf } from './schema.js';

export function progressionEvents(info, block, state, position) {
  if (!block || position.y < -10 || position.y > 15) return [];
  const key = keyOf(block.x, block.z),
    prefix = `${info.id}:${key}:${state.runId ?? 0}`;
  if (key === '0,0') return [];
  const result = [];
  if (block.layout.interior)
    return state.rewarded && block.layout.outpost ? [{ id: `${prefix}:elite`, type: 'elite' }] : [];
  const landmark = block.layout.landmark;
  if (landmark && Math.hypot(position.x - landmark[0], position.z - landmark[1]) <= 8)
    result.push({ id: `${info.id}:${key}:landmark`, type: 'landmark' });
  if (state.rewarded) result.push({ id: `${prefix}:elite`, type: 'elite' });
  if (state.powered) result.push({ id: `${prefix}:power`, type: 'quest' });
  return result;
}
export function canRestorePower(block, state, position) {
  const station = block?.layout.outpost?.center;
  return (
    !!station &&
    !block.layout.interior &&
    !state.powered &&
    state.rewarded &&
    position.cx === block.x &&
    position.cz === block.z &&
    Math.hypot(position.x - station[0], position.z - station[1], position.y) <= 5
  );
}
