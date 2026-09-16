import * as THREE from 'three';
import { makeBody } from '../physics.js';
import { centerOf, eyeOf, forwardOf } from './combat.js';
import { TYPES } from '../enemies/types.js';

import { MAX_NPCS } from './protocol.js';
export const npcDelay = () => 8 + Math.random() * 8;

// The host simulates a small group of melee enemies using the arena's navigation and physics.
export function tickNpcs(match, dt) {
  const players = [...match.players.values()].filter((p) => p.active && p.hp > 0);
  if (!match.npcsEnabled || !players.length) return;
  match.npcs = match.npcs.filter((n) => n.hp > 0 && n.body.pos.y > -20);
  match.npcTime -= dt;
  if (match.npcTime <= 0) {
    match.npcTime = npcDelay();
    const spots = match.spawns.filter((s) =>
      players.every((p) => s.distanceTo(new THREE.Vector3().fromArray(p.snap)) > 8),
    );
    if (match.npcs.length < MAX_NPCS && spots.length) {
      const pos = spots[Math.floor(Math.random() * spots.length)];
      const body = makeBody(pos, 0.33, 1.85, 0.6);
      body.alwaysStep = true;
      match.npcs.push({
        id: `npc:${match.nextNpc++}`,
        name: 'NPC 突袭者',
        hp: TYPES.rusher.hp,
        active: true,
        shield: 0,
        body,
        cool: 1,
        pathTime: 0,
        path: [],
        snap: [...pos.toArray(), 0, 0, 3, 80, TYPES.rusher.hp, 0, 0, 0],
      });
    }
  }
  for (const n of match.npcs) {
    const target = players.reduce((a, b) =>
      centerOf(a).distanceToSquared(n.body.pos) < centerOf(b).distanceToSquared(n.body.pos) ? a : b,
    );
    const goal = new THREE.Vector3().fromArray(target.snap);
    n.pathTime -= dt;
    n.cool -= dt;
    if (n.pathTime <= 0) {
      n.pathTime = 1;
      n.path = match.nav?.findPath(n.body.pos, goal) ?? [goal];
    }
    while (n.path.length && n.body.pos.distanceTo(n.path[0]) < 0.7) n.path.shift();
    const delta = (n.path[0] ?? goal).clone().sub(n.body.pos);
    delta.y = 0;
    const distance = centerOf(n).distanceTo(centerOf(target));
    const speed = distance > 1.7 ? Math.min(TYPES.rusher.speed, delta.length() / Math.max(dt, 0.001)) : 0;
    delta.normalize().multiplyScalar(speed * (n.slowUntil > match.time ? 0.55 : 1));
    n.body.vel.x = delta.x;
    n.body.vel.z = delta.z;
    const steps = Math.ceil(dt / 0.05);
    for (let i = 0; i < steps; i++) {
      n.body.vel.y = Math.max(-50, n.body.vel.y - 22 * (dt / steps));
      match.world.moveBody(n.body, dt / steps);
    }
    const facing = goal.clone().sub(n.body.pos);
    n.snap = [
      ...n.body.pos.toArray(),
      Math.atan2(-facing.x, -facing.z),
      0,
      3,
      64 | (n.body.onGround ? 16 : 0) | (n.cool > 0.9 ? 32 : 0),
      n.hp,
      ...n.body.vel.toArray(),
    ];
    if (distance < 2.4 && n.cool <= 0 && match.world.hasLineOfSight(eyeOf(n), centerOf(target))) {
      n.cool = 1.2;
      const guarding =
        target.snap[5] === 3 &&
        target.snap[6] & 256 &&
        centerOf(n).sub(centerOf(target)).normalize().dot(forwardOf(target)) > 0.6;
      if (guarding) {
        if (target.snap[6] & 256) target.counter = true;
        match.emit({ type: 'parry', id: target.id });
      } else match.damage(target, TYPES.rusher.dmg, null);
    }
  }
}
