import * as THREE from 'three';
import { makeBody, SEE_THROUGH } from './physics.js';
import { power } from './character.js';
import { eyeOf, centerOf, forwardOf, rayPlayer, allied } from './online/combat.js';

export const GUARD_WINDOW = 0.26,
  GUARD_RECOVERY = 0.19,
  GUARD_DAMAGE = 0.4,
  BLADE_RECOVERY = 0.45,
  CANNON_CHARGE = 0.8;
export const SKILL_COOLDOWNS = { blade: [6, 8], gunner: [10, 6], cannon: [9, 10], mage: [10, 7] };
export function resetAbilities(p) {
  Object.assign(p, {
    skillAt: [-100, -100],
    energy: 100,
    focusUntil: 0,
    counter: false,
    slowUntil: 0,
    returnAt: -10,
    chargedAt: null,
    guardAt: -100,
    barrier: 0,
    barrierUntil: 0,
  });
}
export function bladeRecovering(p, time) {
  return (
    p.profile?.role === 'blade' &&
    time < Math.max(...(p.skillAt ?? p.skillTimes ?? [-100, -100])) + BLADE_RECOVERY
  );
}
// Barrier is measured before armor so defensive stats cannot multiply its value.
export function absorbBarrier(p, amount, time) {
  if ((p.barrierUntil ?? 0) <= time) p.barrier = 0;
  const absorbed = Math.min(p.barrier ?? 0, amount);
  p.barrier = (p.barrier ?? 0) - absorbed;
  return amount - absorbed;
}
export function weaponPower(p, time) {
  const focused = p.profile?.role === 'gunner' && (p.focusUntil ?? 0) > time;
  return (
    power(p.profile) + (focused ? power(p.profile, true) * (p.profile.weapon === 'sniper' ? 0.05 : 0.25) : 0)
  );
}
export function skillHit(p, time) {
  if (p.profile?.role === 'mage' && time - (p.returnAt ?? -10) >= 2) {
    p.energy = Math.min(100, (p.energy ?? 100) + 10);
    p.returnAt = time;
  }
}
function area(arena, p, pos, radius, damage, slow = 0) {
  let hit = false;
  for (const target of arena.targets) {
    if (target.id === p.id || allied(p, target) || target.shield > 0 || !target.active || target.hp <= 0)
      continue;
    const center = centerOf(target),
      distance = center.distanceTo(pos);
    if (distance > radius || !arena.world.hasLineOfSight(pos, center, SEE_THROUGH)) continue;
    arena.damage(target, damage * (1 - (distance / radius) * 0.5), p.id);
    if (slow) target.slowUntil = Math.max(target.slowUntil ?? 0, arena.time + slow);
    hit = true;
  }
  if (hit) skillHit(p, arena.time);
}
// Swept body movement, shared by training, exploration host and PVP host.
export function skillMove(world, p, direction, distance) {
  const body = makeBody(new THREE.Vector3().fromArray(p.snap), 0.35, p.snap[6] & 1 ? 1.05 : 1.75, 0.55);
  body.vel.copy(direction).multiplyScalar(distance / 0.2);
  body.noSnap = true;
  for (let i = 0; i < 20; i++) world.moveBody(body, 0.01);
  p.snap.splice(0, 3, ...body.pos.toArray());
  return body.pos.toArray();
}
export function castAbility(arena, p, index) {
  if (!p.profile || ![0, 1].includes(index) || p.hp <= 0 || !p.active) return false;
  if (!p.skillAt) resetAbilities(p);
  // Melee damage is reported ~0.09s into its 0.33s animation.
  if (
    bladeRecovering(p, arena.time) ||
    (p.profile.role === 'blade' && arena.time - (p.meleeAt ?? -100) < 0.24)
  )
    return false;
  const role = p.profile.role,
    empowered = index === 0 && p.profile.empowered;
  const cooldown = SKILL_COOLDOWNS[role][index] + (empowered ? 2 : 0);
  if (arena.time - p.skillAt[index] < cooldown || (role === 'mage' && p.energy < 30)) return false;
  p.skillAt[index] = arena.time;
  if (role === 'mage') p.energy -= 30;
  p.shield = 0;
  const origin = eyeOf(p),
    dir = forwardOf(p);
  const wall = arena.world.raycast(origin, dir, 18, SEE_THROUGH);
  let end = wall
    ? wall.point.clone().addScaledVector(wall.normal, 0.2)
    : origin.clone().addScaledVector(dir, 18);
  if ((role === 'cannon' && index === 1) || (role === 'mage' && index === 0)) {
    const hit = rayPlayer(arena.targets, origin, dir, wall ? wall.dist : 18, p);
    if (hit) end = hit.point;
  }
  const damage = power(p.profile, true) * (empowered ? 1.2 : 1);
  let move = null;
  if (role === 'blade') {
    if (index === 0) {
      move = skillMove(arena.world, p, dir, 5);
      area(arena, p, centerOf(p), 3.5, 65 * damage);
    } else {
      for (const target of arena.targets) {
        const delta = centerOf(target).sub(origin),
          along = delta.dot(dir);
        if (
          target.id !== p.id &&
          !allied(p, target) &&
          arena.world.hasLineOfSight(origin, centerOf(target), SEE_THROUGH) &&
          target.active &&
          target.hp > 0 &&
          along > 0 &&
          along <= origin.distanceTo(end) &&
          delta.addScaledVector(dir, -along).length() < 1.3
        )
          arena.damage(target, 60 * damage, p.id);
      }
    }
  } else if (role === 'gunner') {
    if (index === 0) p.focusUntil = arena.time + (empowered ? 6 : 4);
    else {
      move = skillMove(arena.world, p, dir.clone().negate(), 4);
      p.barrier = 40 * power(p.profile, true);
      p.barrierUntil = arena.time + 4;
    }
  } else if (role === 'cannon') {
    if (index === 0) p.chargedAt = arena.time + CANNON_CHARGE;
    else {
      area(arena, p, end, 6, 35 * damage, 2);
    }
  } else if (index === 0) {
    arena.fields ??= [];
    arena.fields.push({
      owner: p.id,
      pos: end.clone(),
      until: arena.time + 4,
      tickAt: arena.time,
      damage: 18 * damage,
    });
  } else move = skillMove(arena.world, p, dir, 6);
  arena.emit({ type: 'ability', id: p.id, role, index, origin: origin.toArray(), end: end.toArray(), move });
  return true;
}
export function tickAbilities(arena, dt) {
  for (const p of arena.targets) {
    if (!p.profile) continue;
    if ((p.barrierUntil ?? 0) <= arena.time) p.barrier = 0;
    p.energy = Math.min(100, (p.energy ?? 100) + 4 * dt);
    if (p.chargedAt !== null && p.chargedAt !== undefined && p.chargedAt <= arena.time) {
      p.chargedAt = null;
      if (p.hp > 0 && p.active)
        launchShell(arena, p, 150 * power(p.profile, true) * (p.profile.empowered ? 1.2 : 1));
    }
  }
  for (const field of arena.fields ?? []) {
    const p = arena.targets.find((p) => p.id === field.owner && p.active && p.hp > 0);
    while (field.tickAt <= arena.time && field.tickAt < field.until) {
      if (p) area(arena, p, field.pos, 5, field.damage, 0.8);
      field.tickAt += 0.5;
    }
  }
  arena.fields = (arena.fields ?? []).filter((f) => f.until > arena.time);
}
export function launchShell(arena, p, damage = 85 * power(p.profile)) {
  const pos = eyeOf(p),
    vel = forwardOf(p).multiplyScalar(25);
  vel.y += 1;
  const shellId = crypto.randomUUID();
  arena.grenades.push({
    owner: p.id,
    bornAt: arena.time,
    shellId,
    pos: pos.clone(),
    vel,
    fuse: 1.2,
    damage,
    profile: p.profile,
  });
  arena.emit({ type: 'grenade', id: p.id, shellId, pos: pos.toArray(), vel: vel.toArray() });
}
