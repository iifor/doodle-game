import * as THREE from 'three';
import { makeInkMaterial, INK } from '../render.js';
import { rand } from '../util.js';
import { disposeTree } from '../../../shared/resources.js';

export function createPickups(ctx) {
  const { scene, world, player, hud, effects, audio, game } = ctx;
  const _v = new THREE.Vector3();
  ctx.breakHit = (br, dmg, point, dir) => {
    if (!br.alive) return;
    br.hp -= dmg;
    if (br.hp <= 0) breakProp(br, dir);
    else {
      effects.strokeBurst(point, br.ink, 5, 4, { life: 0.2, size: 0.03 });
      audio.shieldHit(point);
    }
  };
  ctx.breakablesInArc = (pos, dir, range, cosHalf) =>
    ctx.level.breakables.filter((br) => {
      if (!br.alive) return false;
      _v.subVectors(br.pos, pos);
      const d = _v.length();
      return d < range + 0.5 && (d < 0.4 || _v.divideScalar(d).dot(dir) > cosHalf);
    });
  ctx.blastBreakables = (c, R) => {
    for (const br of ctx.level.breakables)
      if (br.alive && br.pos.distanceTo(c) < R * 0.9) breakProp(br, br.pos.clone().sub(c).normalize());
  };
  function breakProp(br, dir) {
    if (!br.alive) return;
    br.alive = false;
    world.removeBox(br.box);
    const g = br.group,
      pos = br.pos;
    const d =
      dir && dir.lengthSq() > 0.01
        ? dir.clone().normalize()
        : new THREE.Vector3(rand(-1, 1), 1, rand(-1, 1)).normalize();
    g.updateMatrixWorld(true);
    for (const child of [...g.children]) {
      child.updateWorldMatrix(true, false);
      scene.attach(child);
      const v = d.clone().multiplyScalar(rand(2, 6));
      v.x += rand(-3, 3);
      v.z += rand(-3, 3);
      v.y += rand(2.5, 6.5);
      effects.debris(child, child.position, v, new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), {
        radius: 0.14,
        blood: false,
        life: rand(6, 9),
      });
    }
    scene.remove(g);
    const up = new THREE.Vector3(0, 1, 0);
    if (br.kind === 'pinata') {
      for (const ink of [INK.PINK, INK.ORANGE, INK.GREEN])
        effects.strokeBurst(pos, ink, 16, 7, { life: 0.7, size: 0.05 });
      effects.explosion(pos, 2.5, INK.PINK);
      for (let i = 0; i < 2; i++)
        spawnPickup('health', pos.clone().add(new THREE.Vector3(rand(-1.2, 1.2), 0, rand(-1.2, 1.2))));
      if (game.mode === 'solo') game.addScore(25, '彩罐奖励');
    } else if (br.kind === 'cactus') {
      effects.blood(pos, d, 1.4, { ink: INK.GREEN });
      effects.bloodPool(new THREE.Vector3(pos.x, 0, pos.z), 1.1, INK.GREEN);
    } else {
      effects.strokeBurst(pos, br.ink, 12, 5, { life: 0.35, size: 0.04 });
      effects.smoke(pos, up, 3);
    }
    audio.smash(pos, br.kind === 'barrel' || br.kind === 'crate' || br.kind === 'cactus');
  }
  const pickups = [];
  let pickupId = 1;
  const pmat = {
    ammo: makeInkMaterial({ ink: INK.BLUE }),
    health: makeInkMaterial({ ink: INK.GREEN }),
    cap: makeInkMaterial({ ink: INK.BLACK }),
    shell: makeInkMaterial({ ink: INK.ORANGE }),
  };
  function makePickup(kind) {
    const g = new THREE.Group();
    if (kind === 'ammo') {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.5, 10), pmat.ammo));
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8), pmat.cap);
      c.position.y = 0.33;
      g.add(c);
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.02), pmat.cap);
      l.position.set(0, 0, 0.24);
      g.add(l);
    } else if (ctx.level.key === 'mexico') {
      const sh = new THREE.CylinderGeometry(0.42, 0.42, 0.22, 12, 1, false, 0, Math.PI);
      sh.rotateZ(Math.PI / 2);
      sh.rotateX(-Math.PI / 2);
      g.add(new THREE.Mesh(sh, pmat.shell));
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.2), pmat.health);
      f.position.y = 0.02;
      g.add(f);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 0.14), pmat.cap);
      m.position.y = 0.1;
      g.add(m);
    } else {
      g.add(
        new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.2), pmat.health),
        new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), pmat.health),
      );
    }
    return g;
  }
  function spawnPickup(kind, pos, id = null) {
    const m = makePickup(kind);
    m.position.copy(pos);
    m.position.y += 0.6;
    scene.add(m);
    const p = { id: id ?? pickupId++, kind, mesh: m, base: m.position.y, t: rand(0, 6), life: 45 };
    pickups.push(p);
    return p;
  }
  function removePickup(p) {
    disposeTree(p.mesh, false);
    const i = pickups.indexOf(p);
    if (i >= 0) pickups.splice(i, 1);
  }
  function collectPickup(p) {
    if (p.kind === 'ammo') {
      player.addAmmoAll(0.4);
      player.grenades = Math.min(player.maxGrenades, player.grenades + 1);
      hud.kill('补充弹药 · 手雷 +1', 0);
    } else {
      player.hp = Math.min(player.maxHp, player.hp + 35);
      hud.kill(ctx.level.key === 'mexico' ? '塔可 · 生命 +35' : '生命 +35', 0);
    }
    audio.pickup();
    effects.strokeBurst(p.mesh.position, p.kind === 'ammo' ? INK.BLUE : INK.GREEN, 12, 4, { life: 0.3 });
  }
  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.t += dt;
      p.mesh.position.y = p.base + Math.sin(p.t * 2.5) * 0.12;
      p.mesh.rotation.y += dt * 1.8;
      if (player.alive && p.mesh.position.distanceTo(player.center) < 1.5) {
        if (ctx.pvp?.enabled) {
          p.requestT = (p.requestT ?? 0) - dt;
          if (p.requestT <= 0) {
            ctx.pvp.take(p.id);
            p.requestT = 0.5;
          }
          continue;
        }
        collectPickup(p);
        removePickup(p);
        continue;
      }
      if (!ctx.pvp?.enabled) p.life -= dt;
      if (p.life <= 0) removePickup(p);
    }
  }

  return {
    syncOnline(items) {
      for (const p of [...pickups]) if (!items.some((item) => item.id === p.id)) removePickup(p);
      for (const item of items)
        if (!pickups.some((p) => p.id === item.id))
          spawnPickup('ammo', new THREE.Vector3().fromArray(item.pos), item.id);
    },
    spawn: spawnPickup,
    update: updatePickups,
    clear() {
      for (const p of [...pickups]) removePickup(p);
    },
    dispose() {
      this.clear();
      for (const m of Object.values(pmat)) m.dispose();
    },
  };
}
