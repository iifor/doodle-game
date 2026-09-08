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

export function rayPlayer(players, origin, dir, max, attacker) {
  let result = null;
  for (const p of players) {
    if (p.id === attacker || !p.active || p.hp <= 0) continue;
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
    const hit = rayPlayer(match.players.values(), origin, dir, wall ? wall.dist : 300, attacker.id);
    ends.push((hit ? hit.point : wall ? wall.point : origin.clone().addScaledVector(dir, 300)).toArray());
    if (!hit) continue;
    let damage = spec.damage * (hit.part === 'head' ? spec.head : 1);
    if (action.kind === 'shotgun') damage *= Math.max(0.15, Math.min(1, 1 - (hit.distance - 9) / 17));
    const guarding = hit.target.snap[5] === 3 && !!(hit.target.snap[6] & 4);
    const facing = centerOf(attacker).sub(centerOf(hit.target)).normalize().dot(forwardOf(hit.target));
    if (guarding && facing > 0.6) {
      if (Math.random() < 0.4) match.damage(attacker, damage * 0.6, hit.target.id);
      match.emit({ type: 'parry', id: hit.target.id });
    } else match.damage(hit.target, damage, attacker.id);
  }
  match.emit({ type: 'shot', id: attacker.id, kind: action.kind, origin: action.origin, ends });
}
export function slash(match, attacker) {
  const eye = eyeOf(attacker),
    forward = forwardOf(attacker);
  for (const target of match.players.values()) {
    if (target.id === attacker.id || !target.active || target.hp <= 0) continue;
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
    )
      match.emit({ type: 'parry', id: target.id });
    else match.damage(target, 55, attacker.id);
  }
}
export function advanceGrenade(match, grenade, dt) {
  const steps = Math.ceil(dt / 0.02),
    step = dt / steps;
  for (let i = 0; i < steps; i++) {
    if (grenade.rest) break;
    grenade.vel.y -= 22 * step;
    const length = grenade.vel.length() * step;
    if (length > 0) {
      const dir = grenade.vel.clone().normalize(),
        hit = match.world.raycast(grenade.pos, dir, length + 0.16);
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
  if (grenade.fuse > 0) return false;
  for (const target of match.players.values()) {
    const center = centerOf(target),
      distance = center.distanceTo(grenade.pos);
    if (distance >= 6.4 || !match.world.hasLineOfSight(grenade.pos, center)) continue;
    match.damage(target, (target.id === grenade.owner ? 44 : 120) * (1 - distance / 6.4), grenade.owner);
  }
  return true;
}
