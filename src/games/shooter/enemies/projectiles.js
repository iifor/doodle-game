import * as THREE from 'three';
import { makeInkMaterial, INK } from '../render.js';
import { SEE_THROUGH } from '../physics.js';
import { clamp } from '../util.js';
import { audio } from '../audio.js';
const _v = new THREE.Vector3(),
  _v2 = new THREE.Vector3(),
  _v3 = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _m = new THREE.Matrix4(),
  _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
export class Projectiles {
  constructor(mgr) {
    this.mgr = mgr;
    this.list = [];
    this.max = 240;
    this.onFire = null;
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      makeInkMaterial({ ink: INK.RED, fill: true }),
      this.max,
    );
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    mgr.ctx.scene.add(this.mesh);
  }
  fire(pos, dir, speed, dmg, owner, ink = INK.RED, thick = 0.045, blast = 0, id = null) {
    if (this.list.length >= this.max) this.list.shift();
    const p = {
      id: id ?? this.mgr.nextId++,
      pos: pos.clone(),
      prev: pos.clone(),
      vel: dir.clone().multiplyScalar(speed),
      dmg,
      owner,
      life: 4,
      deflected: false,
      ink,
      thick,
      origin: pos.clone(),
      blast,
    };
    this.list.push(p);
    if (this.onFire && id === null) this.onFire(p);
    return p;
  }
  clear() {
    this.list.length = 0;
    this.mesh.count = 0;
  }
  deflectArc(origin, forward, range, cosHalf, player) {
    let n = 0;
    for (const p of this.list) {
      if (p.deflected) continue;
      _v.subVectors(p.pos, origin);
      const d = _v.length();
      if (d > range) continue;
      if (d > 0.01 && _v.divideScalar(d).dot(forward) < cosHalf) continue;
      this._deflect(p, player, false);
      n++;
    }
    return n;
  }
  _deflect(p, player, perfect) {
    const mgr = this.mgr;
    p.deflected = true;
    p.ink = INK.BLUE;
    p.dmg *= perfect ? 3.5 : 2.2;
    p.life = 3;
    let target = null;
    if (perfect && p.owner && p.owner.alive) target = p.owner;
    else
      target =
        mgr.nearestVisible(player.eye, player.forward, Math.cos(0.7), 70) ||
        (p.owner && p.owner.alive ? p.owner : null);
    const speed = p.vel.length() * 1.6;
    if (target) _d.subVectors(target.center, p.pos).normalize();
    else _d.copy(player.forward);
    p.vel.copy(_d).multiplyScalar(speed);
    mgr.ctx.effects.sparks(p.pos, _d, INK.ORANGE, 10, 9);
    mgr.ctx.effects.strokeBurst(p.pos, INK.BLUE, 8, 4, { life: 0.2 });
  }
  _burst(p, point) {
    const ctx = this.mgr.ctx;
    ctx.effects.explosion(point, 2.5, INK.BLACK);
    audio.explosion(point);
    const P = ctx.player;
    const d = P.center.distanceTo(point);
    if (d < 3.5 && P.alive) {
      P.takeDamage(p.dmg * (1 - d / 3.5), point);
      P.knockback(_v.subVectors(P.center, point).normalize(), 6);
    }
    this.mgr.blastEnemies(point, 3.5, p.dmg * 1.5, p.owner);
  }
  update(dt) {
    const mgr = this.mgr,
      ctx = mgr.ctx,
      world = ctx.world;
    const list = this.list;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.prev.copy(p.pos);
      if (p.blast) p.vel.y -= 9 * dt;
      p.pos.addScaledVector(p.vel, dt);
      _d.subVectors(p.pos, p.prev);
      const len = _d.length();
      if (len < 1e-6) {
        list[n++] = p;
        continue;
      }
      _d.divideScalar(len);
      const hw = world.raycast(p.prev, _d, len, SEE_THROUGH);
      if (hw) {
        if (p.blast) this._burst(p, hw.point);
        else {
          ctx.effects.bulletImpact(hw.point, hw.normal, p.ink);
          if (Math.random() < 0.5) audio.bulletImpact(hw.point);
        }
        continue;
      }
      if (!p.deflected) {
        // every peer runs the same projectile; only the local player takes damage from it here,
        // other players just make it disappear on this screen (their own client handles them)
        let consumed = false;
        for (const P of mgr.targets()) {
          if (!P.alive) continue;
          const catchR = Math.max(p.blast ? 0.9 : 0.5, P.isLocal ? P.blockRadius : 0);
          if (!this._segHitsPlayer(p.prev, p.pos, P, catchR)) continue;
          if (P.isLocal) {
            const def = P.tryDeflect(p);
            if (def) {
              if (def.ret) {
                this._deflect(p, P, def.perfect);
                list[n++] = p;
              } else {
                p.deflected = true;
                ctx.effects.strokeBurst(p.pos, INK.RED, 5, 6, { life: 0.18, size: 0.03 });
              }
              consumed = true;
              break;
            }
            if (this._segHitsPlayer(p.prev, p.pos, P, p.blast ? 0.9 : 0.5)) {
              if (p.blast) this._burst(p, p.pos);
              else P.takeDamage(p.dmg, p.origin);
              consumed = true;
              break;
            }
          } else if (this._segHitsPlayer(p.prev, p.pos, P, p.blast ? 0.9 : 0.5)) {
            consumed = true;
            break;
          }
        }
        if (consumed) continue;
      } else {
        const he = mgr.raycast(p.prev, _d, len);
        if (he) {
          if (p.blast) this._burst(p, he.point);
          else
            mgr.damage(he.enemy, p.dmg, {
              point: he.point,
              dir: _d.clone(),
              part: he.part,
              source: 'deflect',
              crit: he.part === 'head',
            });
          continue;
        }
      }
      list[n++] = p;
    }
    list.length = n;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const sp = p.vel.length();
      _v.copy(p.vel).divideScalar(sp);
      _q.setFromUnitVectors(_up, _v);
      _s.set(p.thick, p.blast ? p.thick : clamp(sp * 0.02, 0.35, 0.9), p.thick);
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      const c = this.mesh.instanceColor.array;
      c[i * 3] = p.ink;
      c[i * 3 + 1] = 1;
      c[i * 3 + 2] = 0;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
  _segHitsPlayer(a, b, P, r = 0.5) {
    const cy = P.center;
    _v.subVectors(b, a);
    const l2 = _v.lengthSq();
    if (l2 < 1e-8) return false;
    for (const c of [cy, P.eye]) {
      const t = clamp(_v2.subVectors(c, a).dot(_v) / l2, 0, 1);
      _v3.copy(a).addScaledVector(_v, t);
      if (_v3.distanceToSquared(c) < r * r) return true;
    }
    _v3.copy(cy);
    _v3.y -= 0.55;
    const t = clamp(_v2.subVectors(_v3, a).dot(_v) / l2, 0, 1);
    _v2.copy(a).addScaledVector(_v, t);
    return _v2.distanceToSquared(_v3) < (r - 0.05) * (r - 0.05);
  }
}
