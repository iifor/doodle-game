import { hash, validateLayout, requireWorld } from './schema.js';

// Persist the rolled roster. Reopening a world never rerolls its enemies.
export function randomizeEncounter(layout, seed, x, z) {
  if (!layout.outpost || layout.outpost.encounterVersion === 1) return layout;
  let state = hash(`${seed}:${x},${z}:encounter-v1`);
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const total = 1 + Math.floor(random() * 8);
  const obstacles = [...layout.buildings, ...layout.cover];
  const candidates = [];
  for (const [a, b, c, d] of layout.roads) {
    const length = Math.hypot(c - a, d - b),
      steps = Math.max(1, Math.ceil(length / 5));
    for (let i = 0; i <= steps; i++) {
      const px = Math.round((a + ((c - a) * i) / steps) / 2) * 2 + 1;
      const pz = Math.round((b + ((d - b) * i) / steps) / 2) * 2 + 1;
      if (px < 12 || px > 116 || pz < 12 || pz > 116) continue;
      if (obstacles.some((o) => Math.abs(o.x - px) < o.w / 2 + 1.5 && Math.abs(o.z - pz) < o.d / 2 + 1.5))
        continue;
      candidates.push([px, pz]);
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const spawns = [];
  for (const point of candidates) {
    if (spawns.every((p) => Math.hypot(p[0] - point[0], p[1] - point[1]) >= 12)) spawns.push(point);
    if (spawns.length === total) break;
  }
  requireWorld(spawns.length === total, '找不到足够的可通行敌人位置');
  const weapons = ['grunt', 'grunt', 'grunt', 'rusher', 'heavy', 'sniper', 'shield'];
  const types = spawns.map(() => weapons[Math.floor(random() * weapons.length)]);
  return validateLayout(
    { ...layout, outpost: { center: [...layout.outpost.center], spawns, encounterVersion: 1, types } },
    seed,
    x,
    z,
  );
}
