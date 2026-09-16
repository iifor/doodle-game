import { power } from '../character.js';
import { weaponPower, bladeRecovering, GUARD_RECOVERY, GUARD_DAMAGE } from '../abilities.js';
import * as THREE from 'three';
import { SEE_THROUGH } from '../physics.js';
import { WEAPONS } from './protocol.js';

export const eyeOf = (p) => new THREE.Vector3(p.snap[0], p.snap[1] + (p.snap[6] & 1 ? 0.88 : 1.6), p.snap[2]);
export const centerOf = (p) => new THREE.Vector3(p.snap[0], p.snap[1] + (p.snap[6] & 1 ? 0.6 : 1), p.snap[2]);
export const forwardOf = (p) =>
  new THREE.Vector3(
    -Math.sin(p.snap[3]) * Math.cos(p.snap[4]),
    Math.sin(p.snap[4]),
    -Math.cos(p.snap[3]) * Math.cos(p.snap[4]),
  );

export const allied = (a, b) => !!a?.team && a.team === b?.team;

export function rayPlayer(players, origin, dir, max, attacker) {
  const actor = typeof attacker === 'string' ? players.find((p) => p.id === attacker) : attacker;
  const id = actor?.id ?? attacker;
  let result = null;
  for (const p of players) {
    if (p.id === id || allied(actor, p) || !p.active || p.hp <= 0) continue;
    const crouch = !!(p.snap[6] & 1);
    const spheres = [
      ['head', crouch ? 0.9 : 1.65, 0.3],
      ['torso', crouch ? 0.6 : 1.15, 0.36],
      ['hips', crouch ? 0.35 : 0.65, 0.32],
    ];
    for (const [part, height, radius] of spheres) {
      const offset = new THREE.Vector3(p.snap[0], p.snap[1] + height, p.snap[2]).sub(origin);
      const projection = offset.dot(dir),
        lateral = offset.lengthSq() - projection ** 2;
      if (lateral > radius ** 2) continue;
      const distance = projection - Math.sqrt(Math.max(0, radius ** 2 - lateral));
      if (distance < 0 || distance >= max || (result && result.distance <= distance)) continue;
      result = { target: p, part, distance, point: origin.clone().addScaledVector(dir, distance) };
    }
  }
  return result;
}
export function shoot(match, attacker, action) {
  const spec = WEAPONS[action.kind],
    origin = new THREE.Vector3().fromArray(action.origin);
  const ends = [];
  for (const values of action.dirs) {
    const dir = new THREE.Vector3().fromArray(values);
    const wall = match.world.raycast(origin, dir, 300, SEE_THROUGH);
    const hit = rayPlayer(match.targets, origin, dir, wall ? wall.dist : 300, attacker.id);
    ends.push((hit ? hit.point : wall ? wall.point : origin.clone().addScaledVector(dir, 300)).toArray());
    if (!hit) continue;
    let damage = spec.damage * weaponPower(attacker, match.time) * (hit.part === 'head' ? spec.head : 1);
    if (action.kind === 'shotgun') damage *= Math.max(0.15, Math.min(1, 1 - (hit.distance - 9) / 17));
    const guarding = hit.target.snap[5] === 3 && !!(hit.target.snap[6] & 4);
    const facing = centerOf(attacker).sub(centerOf(hit.target)).normalize().dot(forwardOf(hit.target));
    if (guarding && facing > 0.6 && match.time - (hit.target.guardAt ?? -100) >= GUARD_RECOVERY) {
      hit.target.guardAt = match.time;
      if (hit.target.snap[6] & 256) {
        hit.target.counter = true;
        match.damage(attacker, damage * 0.6, hit.target.id);
      } else match.damage(hit.target, damage * GUARD_DAMAGE, attacker.id);
      match.emit({ type: 'parry', id: hit.target.id });
    } else {
      match.damage(hit.target, damage, attacker.id);
      if (hit.part === 'head' && attacker.profile?.role === 'gunner')
        match.emit({ type: 'precision', id: attacker.id });
    }
  }
  match.emit({ type: 'shot', id: attacker.id, kind: action.kind, origin: action.origin, ends });
}
export function slash(match, attacker) {
  if (bladeRecovering(attacker, match.time)) return false;
  const eye = eyeOf(attacker),
    forward = forwardOf(attacker);
  for (const target of match.targets) {
    if (target.id === attacker.id || allied(attacker, target) || !target.active || target.hp <= 0) continue;
    const center = centerOf(target),
      delta = center.clone().sub(eye),
      distance = delta.length();
    if (
      distance > 3.3 ||
      (distance > 0.3 && delta.normalize().dot(forward) < Math.cos(0.95)) ||
      !match.world.hasLineOfSight(eye, center)
    )
      continue;
    if (
      target.snap[5] === 3 &&
      target.snap[6] & 256 &&
      centerOf(attacker).sub(center).normalize().dot(forwardOf(target)) > 0.6
    ) {
      target.counter = true;
      match.emit({ type: 'parry', id: target.id });
    } else match.damage(target, 75 * power(attacker.profile) * (attacker.counter ? 1.5 : 1), attacker.id);
  }
  attacker.counter = false;
}
export function advanceGrenade(match, grenade, dt) {
  if (grenade.shellId && grenade.bornAt !== undefined)
    dt = Math.min(dt, Math.max(0, match.time - grenade.bornAt));
  // Never integrate past detonation, including a host frame longer than the remaining fuse.
  dt = Math.min(dt, Math.max(0, grenade.fuse));
  const steps = Math.ceil(dt / 0.02),
    step = dt / steps;
  for (let i = 0; i < steps; i++) {
    if (grenade.rest) break;
    grenade.vel.y -= (grenade.shellId ? 4 : 22) * step;
    const length = grenade.vel.length() * step;
    if (length > 0) {
      const dir = grenade.vel.clone().normalize(),
        hit = match.world.raycast(grenade.pos, dir, length + 0.16);
      const bodyHit = grenade.shellId
        ? rayPlayer(
            match.targets,
            grenade.pos,
            dir,
            Math.min(length + 0.16, hit?.dist ?? Infinity),
            grenade.owner,
          )
        : null;
      if (bodyHit || (hit && grenade.shellId)) {
        grenade.pos.copy(bodyHit ? bodyHit.point : hit.point.clone().addScaledVector(hit.normal, 0.16));
        grenade.fuse = 0;
        break;
      }
      if (hit) {
        grenade.pos.copy(hit.point).addScaledVector(hit.normal, 0.16);
        const normalSpeed = grenade.vel.dot(hit.normal);
        if (normalSpeed < 0)
          grenade.vel.addScaledVector(hit.normal, -1.45 * normalSpeed).multiplyScalar(0.55);
        if (grenade.vel.length() < 1.2 && hit.normal.y > 0.5) {
          grenade.rest = true;
          grenade.vel.set(0, 0, 0);
        }
      } else grenade.pos.addScaledVector(grenade.vel, step);
    }
  }
  grenade.fuse -= dt;
  if (grenade.fuse > 1e-9) return false;
  for (const target of match.targets) {
    const center = centerOf(target),
      distance = center.distanceTo(grenade.pos);
    if (distance >= 6.4 || !match.world.hasLineOfSight(grenade.pos, center)) continue;
    const self = target.id === grenade.owner;
    if (
      !self &&
      allied(
        match.targets.find((p) => p.id === grenade.owner),
        target,
      )
    )
      continue;
    const base = self
      ? 44 * (target.profile?.role === 'cannon' ? 0.4 : 1)
      : (grenade.damage ?? 120 * power(grenade.profile));
    match.damage(target, base * (1 - distance / 6.4), grenade.owner);
  }
  if (grenade.shellId)
    match.emit({
      type: 'shell-burst',
      id: grenade.owner,
      shellId: grenade.shellId,
      pos: grenade.pos.toArray(),
    });
  return true;
}
