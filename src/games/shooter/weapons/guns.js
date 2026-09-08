import * as THREE from 'three';
import { makeInkMaterial, INK } from '../render.js';
import { SEE_THROUGH } from '../physics.js';
import { rand, clamp, damp, TAU } from '../util.js';
import { audio } from '../audio.js';
import { ViewModel, bx, cyl, sph, frame, hand, makeFlash } from './model.js';
const _v = new THREE.Vector3(),
  _v2 = new THREE.Vector3();
export const GUNS = {
  rifle: {
    name: '步枪',
    hint: '全自动射击 · 将红点对准敌人',
    kind: 'rifle',
    magSize: 35,
    reserve: 175,
    maxReserve: 350,
    interval: 1 / 11,
    damage: 24,
    headMul: 2.6,
    pellets: 1,
    spread: 0.016,
    adsSpread: 0.0034,
    spreadKick: 0.009,
    spreadMax: 0.075,
    adsFov: 58,
    sight: [0, 0.12, -0.05, 0.3],
    camKick: [0.009, 0.0034],
    modelKick: [0.25, 0.3, 2.4, -3.2, 0.9, 1.2],
    fovKick: 1.2,
    reloadDur: 1.45,
    reloadType: 'mag',
    auto: true,
    falloff: null,
    tracer: 0.02,
    flashScale: 1,
    sound: 'shot',
    shell: [0.02, INK.ORANGE],
    moveSpread: 0.0012,
  },
  shotgun: {
    name: '霰弹枪',
    hint: '泵动装填 · 近距离火力强劲',
    kind: 'shotgun',
    magSize: 6,
    reserve: 36,
    maxReserve: 72,
    interval: 0.78,
    damage: 19,
    headMul: 1.8,
    pellets: 10,
    spread: 0.062,
    adsSpread: 0.034,
    spreadKick: 0,
    spreadMax: 0.1,
    adsFov: 68,
    sight: [0, 0.095, -1.0, 0.52],
    camKick: [0.05, 0.012],
    modelKick: [0.4, 0.6, 5, -9, 2, 3],
    fovKick: 4,
    reloadDur: 0.45,
    reloadType: 'shells',
    auto: false,
    falloff: [11, 32, 0.22],
    tracer: 0.014,
    flashScale: 1.9,
    sound: 'shotgunFire',
    shell: [0.035, INK.RED],
    moveSpread: 0.0006,
    cycleDur: 0.45,
  },
  sniper: {
    name: '狙击枪',
    hint: '栓动狙击 · 一枪擦除敌人',
    kind: 'sniper',
    scope: true,
    magSize: 5,
    reserve: 25,
    maxReserve: 50,
    interval: 0.2,
    damage: 150,
    headMul: 3,
    pellets: 1,
    spread: 0.075,
    adsSpread: 0.0004,
    spreadKick: 0.05,
    spreadMax: 0.14,
    adsFov: 20,
    sight: [0, 0.135, 0, 0.42],
    camKick: [0.055, 0.008],
    modelKick: [0.25, 0.8, 4.5, -11, 1.2, 2],
    fovKick: 4.5,
    reloadDur: 2.1,
    reloadType: 'mag',
    auto: false,
    falloff: null,
    tracer: 0.03,
    flashScale: 1.7,
    sound: 'sniperFire',
    shell: [0.03, INK.ORANGE],
    moveSpread: 0.004,
    cycleDur: 0.85,
  },
};

export class Gun extends ViewModel {
  constructor(ctx, type) {
    super(ctx);
    Object.assign(this, GUNS[type]);
    this.isGun = true;
    this.mag = this.magSize;
    this.autoReloadT = 0;
    this.fireT = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.spreadCur = this.spread;
    this.flashT = 0;
    this.pumpT = 0;
    this.racked = false;
    this.needPump = false;
    this.mat = makeInkMaterial({ ink: INK.BLUE });
    this.dark = makeInkMaterial({ ink: INK.BLACK });
    this.red = makeInkMaterial({ ink: INK.RED, fill: true });
    this.build();
    this.setSight(...this.sight);
  }
  reset() {
    super.reset();
    this.mag = this.magSize;
    this.reserve = this.startReserve;
    this.reloading = false;
    this.fireT = 0;
    this.reloadT = 0;
    this.autoReloadT = 0;
    this.flashT = 0;
    this.flash.visible = false;
    this.pumpT = 0;
    this.pumped = false;
    this.needPump = false;
    this.racked = false;
    this.spreadCur = this.spread;
    if (this.magMesh) {
      this.magMesh.position.y = this.magY;
      this.magMesh.rotation.z = 0;
    }
    if (this.foreEnd) this.foreEnd.position.z = this.foreEndZ;
    if (this.boltH) {
      this.boltH.position.z = this.boltZ;
      this.boltH.rotation.z = 0;
    }
    if (this.handL) this.handL.position.copy(this.handLPos);
  }
  get spreadPx() {
    return 5 + this.spreadCur * 900;
  }
  addAmmo(n) {
    this.reserve = Math.min(this.reserve + n, this.maxReserve);
  }
  startReload() {
    if (this.reloading || this.mag >= this.magSize || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = 0;
    this.racked = false;
    if (this.reloadType === 'shells') audio.shell();
    else if (this.reloadType === 'cylinder') audio.cylinder();
    else audio.reload();
  }
  update(dt, st) {
    if (this.autoReloadT > 0) {
      this.autoReloadT -= dt;
      if (this.autoReloadT <= 0 && this.mag === 0 && !st.blockFire) this.startReload();
    }
    this.fireT -= dt;
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    // moving and flying bloom the shot; aiming down the sights steadies most of that, the scope nearly all of it
    const base = st.aim ? this.adsSpread : this.spread;
    let moveAdd =
      Math.min(st.speed, 24) * this.moveSpread + (st.grounded ? 0 : 0.01) + (st.sliding ? 0.008 : 0);
    if (st.aim) moveAdd *= this.scope ? 0.03 : 0.3;
    this.spreadCur = damp(this.spreadCur, base + moveAdd, 7, dt);
    const p = this.root.position,
      r = this.root.rotation;
    if (this.pumpT > 0) {
      this.pumpT -= dt;
      const t = 1 - this.pumpT / this.cycleDur;
      const s = Math.sin(Math.min(1, t * 1.15) * Math.PI);
      if (this.foreEnd) this.foreEnd.position.z = this.foreEndZ + s * 0.16;
      if (this.boltH) {
        this.boltH.position.z = this.boltZ + s * 0.2;
        this.boltH.rotation.z = -s * 1.1;
      }
      r.x += s * 0.12;
      r.z += s * 0.15;
      p.y -= s * 0.02;
      if (t > 0.45 && !this.pumped) {
        this.pumped = true;
        audio.pump();
        this._ejectShell();
        this.recoilRot.kick(-1.5, 0, 1);
      }
      if (this.pumpT <= 0) {
        this.pumped = false;
        this.needPump = false;
        if (this.foreEnd) this.foreEnd.position.z = this.foreEndZ;
        if (this.boltH) {
          this.boltH.position.z = this.boltZ;
          this.boltH.rotation.z = 0;
        }
      }
    }
    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadType === 'mag') {
        const t = this.reloadT / this.reloadDur;
        const tilt =
          Math.sin((clamp(t / 0.22, 0, 1) * Math.PI) / 2) *
          (t < 0.82 ? 1 : clamp(1 - (t - 0.82) / 0.18, 0, 1));
        r.x += -0.3 * tilt;
        r.z += 0.5 * tilt;
        r.y += 0.25 * tilt;
        p.y -= 0.07 * tilt;
        p.x += 0.03 * tilt;
        const mt = clamp((t - 0.18) / 0.5, 0, 1);
        this.magMesh.position.y = this.magY - Math.sin(mt * Math.PI) * 0.3;
        this.magMesh.rotation.z = Math.sin(mt * Math.PI) * 0.6;
        if (t > 0.86 && !this.racked) {
          this.racked = true;
          this.recoilRot.kick(-2.5, 0, 0);
          this.recoil.kick(0, 0, 0.6);
        }
        if (this.reloadT >= this.reloadDur) {
          const take = Math.min(this.magSize - this.mag, this.reserve);
          this.mag += take;
          this.reserve -= take;
          this.reloading = false;
        }
        return;
      }
      // shells: one at a time, can be interrupted by firing
      const s = Math.sin(Math.min(1, this.reloadT / this.reloadDur) * Math.PI);
      r.z += 0.35 * s;
      r.x += 0.15 * s;
      p.y -= 0.04 * s;
      if (this.handL)
        this.handL.position.set(
          this.handLPos.x + 0.1 * s,
          this.handLPos.y - 0.12 * s,
          this.handLPos.z + 0.55 * s,
        );
      if (this.reloadT >= this.reloadDur) {
        this.mag++;
        this.reserve--;
        this.reloadT = 0;
        if (this.mag >= this.magSize || this.reserve <= 0) {
          this.reloading = false;
          if (this.handL) this.handL.position.copy(this.handLPos);
          if (this.needPump) this.pumpT = this.cycleDur;
        } else audio.shell();
      }
    }
    if (
      st.reloadPressed &&
      this.mag < this.magSize &&
      this.reserve > 0 &&
      !this.reloading &&
      this.pumpT <= 0
    ) {
      this.startReload();
      return;
    }
    const wantFire = this.auto ? st.fire : st.firePressed;
    if (wantFire && this.fireT <= 0 && this.pumpT <= 0 && !st.blockFire) {
      if (this.mag <= 0) {
        if (st.firePressed) {
          audio.empty();
          this.startReload();
        }
      } else {
        if (this.reloading) {
          this.reloading = false;
          if (this.handL) this.handL.position.copy(this.handLPos);
        }
        this.fire(st);
      }
    }
  }
  fire(st) {
    const ctx = this.ctx,
      P = ctx.player;
    this.fireT = this.interval;
    this.mag--;
    const spreadNow = this.spreadCur;
    this.spreadCur = Math.min(this.spreadCur + this.spreadKick, this.spreadMax);
    let hits = 0;
    const directions = Array.from({ length: this.pellets }, () => P.aimDir(spreadNow).clone());
    for (const direction of directions) if (this.fireRay(P.eye, direction)) hits++;
    ctx.pvp?.shot(this.kind, P.eye, directions);
    // fx
    this.flash.visible = true;
    this.flashT = 0.045;
    this.flash.rotation.z = rand(0, TAU);
    this.flash.scale.setScalar(this.flashScale * rand(0.8, 1.4));
    this.muzzle.getWorldPosition(_v);
    _v2.copy(P.forward);
    ctx.effects.strokeBurst(_v, INK.ORANGE, 4 + this.pellets, 6 * this.flashScale, {
      life: 0.08,
      size: 0.03,
      gravity: 0,
      drag: 8,
    });
    ctx.effects.smoke(_v, _v2, this.kind === 'shotgun' ? 5 : 2);
    if (this.shell && this.reloadType !== 'shells') this._ejectShell();
    if (this.cycleDur) {
      this.pumpT = this.cycleDur + 0.12;
      this.pumped = false;
      if (this.reloadType === 'shells') this.needPump = true;
    }
    const k = this.modelKick;
    this.recoil.kick(rand(-k[0], k[0]), rand(k[1] * 0.4, k[1]), k[2]);
    this.recoilRot.kick(k[3], rand(-k[4], k[4]), rand(-k[5], k[5]));
    P.recoil(
      this.camKick[0] * (st.aim ? 0.7 : 1) + rand(0, this.camKick[0] * 0.3),
      rand(-this.camKick[1], this.camKick[1]),
    );
    P.kickFov(this.fovKick);
    audio[this.sound]();
    ctx.input.rumble(0.15 + this.fovKick * 0.08, 0.5, 40 + this.fovKick * 15);
    ctx.effects.shakeAmt += 0.02 + this.fovKick * 0.02;
    if (hits > 0 && this.kind === 'shotgun') ctx.game.hitstop(0.03, 0.3);
    if (this.mag === 0 && this.reloadType === 'mag') this.autoReloadT = 0.25;
  }
  fireRay(origin, dir) {
    const ctx = this.ctx;
    const hitE = ctx.enemies.raycast(origin, dir, 300),
      hitW = ctx.world.raycast(origin, dir, 300, SEE_THROUGH);
    let end,
      hit = false;
    // other players in a versus match are targets too; the closest thing along the ray wins
    const hitP = ctx.pvp?.raycast(origin, dir, hitW ? hitW.dist : 300);
    if (hitP) {
      end = hitP.point;
      hit = true;
      ctx.hud.hitmarker(false, hitP.part === 'head');
    } else if (hitW && hitW.box.data.breakable && (!hitE || hitW.dist < hitE.dist)) {
      end = hitW.point;
      ctx.breakHit(hitW.box.data.breakable, this.damage, hitW.point, dir);
      hit = true;
    } else if (hitE && (!hitW || hitE.dist < hitW.dist)) {
      end = hitE.point;
      const crit = hitE.part === 'head';
      let d = this.damage * (crit ? this.headMul : 1);
      if (this.falloff)
        d *= clamp(
          1 - (hitE.dist - this.falloff[0]) / (this.falloff[1] - this.falloff[0]),
          this.falloff[2],
          1,
        );
      if (!ctx.exploration)
        ctx.enemies.damage(hitE.enemy, d, {
          point: hitE.point,
          dir,
          part: hitE.part,
          source: this.kind,
          crit,
        });
      hit = true;
    } else if (hitW) {
      end = hitW.point;
      ctx.effects.bulletImpact(hitW.point, hitW.normal, INK.BLUE);
      if (Math.random() < 0.25) audio.ricochet(hitW.point);
    } else end = origin.clone().addScaledVector(dir, 300);
    this.muzzle.getWorldPosition(_v);
    ctx.effects.tracer(_v, end, INK.BLUE, this.tracer, 0.05);
    return hit;
  }
  _ejectShell(spread = 1) {
    if (!this.shell) return;
    const P = this.ctx.player;
    this.ejectPt.getWorldPosition(_v);
    _v2
      .copy(P.right)
      .multiplyScalar(rand(1.5, 2.5) * spread)
      .addScaledVector(P.forward, rand(-0.5, 0.5));
    _v2.y += rand(1.5, 2.8);
    this.ctx.effects.shell(_v, _v2, this.shell[1], this.shell[0]);
  }
}

export class Rifle extends Gun {
  constructor(ctx) {
    super(ctx, 'rifle');
  }
  build() {
    const g = this.root,
      mat = this.mat,
      dark = this.dark;
    bx(0.09, 0.12, 0.5, 0, 0, 0, mat, g);
    bx(0.075, 0.085, 0.36, 0, 0, -0.42, mat, g);
    cyl(0.018, 0.42, 0, 0.02, -0.75, dark, g);
    this.magMesh = bx(0.06, 0.2, 0.1, 0, -0.16, -0.06, mat, g);
    this.magMesh.rotation.x = 0.15;
    this.magY = -0.16;
    bx(0.07, 0.11, 0.3, 0, -0.01, 0.4, mat, g);
    const grip = bx(0.05, 0.14, 0.06, 0, -0.13, 0.12, mat, g);
    grip.rotation.x = 0.3;
    // the sight: a single small floating dot, nothing else in the picture
    frame(0.075, 0.07, 0.012, 0.03, 0, 0.12, -0.05, mat, g);
    bx(0.03, 0.018, 0.05, 0, 0.062, -0.05, dark, g);
    sph(0.0012, 0, 0.12, -0.05, this.red, g, 5);
    hand(mat, 0.02, -0.15, 0.13, g, [0.5, -0.6, 1]);
    this.handL = hand(mat, -0.05, -0.08, -0.4, g, [-0.35, -0.9, 0.9]);
    this.handLPos = this.handL.position.clone();
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.02, -0.98);
    g.add(this.muzzle);
    this.ejectPt = new THREE.Object3D();
    this.ejectPt.position.set(0.06, 0.02, 0.02);
    g.add(this.ejectPt);
    this.flash = makeFlash(g, 0, 0.02, -0.98, 1);
  }
}
export class Shotgun extends Gun {
  constructor(ctx) {
    super(ctx, 'shotgun');
    this.basePos.set(0.2, -0.19, -0.34);
  }
  build() {
    const g = this.root,
      mat = this.mat,
      dark = this.dark;
    bx(0.09, 0.13, 0.42, 0, 0, 0.05, mat, g);
    cyl(0.021, 0.92, 0, 0.05, -0.62, dark, g);
    cyl(0.019, 0.72, 0, -0.02, -0.5, mat, g);
    this.foreEnd = bx(0.078, 0.085, 0.27, 0, 0.01, -0.46, mat, g);
    this.foreEndZ = -0.46;
    const stock = bx(0.07, 0.12, 0.34, 0, -0.04, 0.42, mat, g);
    stock.rotation.x = 0.08;
    const grip = bx(0.05, 0.13, 0.06, 0, -0.13, 0.16, mat, g);
    grip.rotation.x = 0.35;
    sph(0.013, 0, 0.095, -1.0, this.red, g, 6);
    bx(0.03, 0.025, 0.02, 0, 0.085, -0.02, dark, g);
    hand(mat, 0.02, -0.16, 0.17, g, [0.5, -0.6, 1]);
    this.handL = hand(mat, -0.04, -0.06, -0.45, g, [-0.35, -0.9, 0.9]);
    this.handLPos = this.handL.position.clone();
    this.handL.userData.foreEnd = true;
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.05, -1.09);
    g.add(this.muzzle);
    this.ejectPt = new THREE.Object3D();
    this.ejectPt.position.set(0.06, 0.03, 0.05);
    g.add(this.ejectPt);
    this.flash = makeFlash(g, 0, 0.05, -1.09, 1);
  }
}
export class Sniper extends Gun {
  constructor(ctx) {
    super(ctx, 'sniper');
    this.basePos.set(0.21, -0.19, -0.36);
  }
  build() {
    const g = this.root,
      mat = this.mat,
      dark = this.dark;
    bx(0.085, 0.115, 0.6, 0, 0, 0.05, mat, g);
    cyl(0.024, 1.25, 0, 0.02, -0.92, dark, g);
    cyl(0.032, 0.16, 0, 0.02, -1.5, dark, g);
    this.magMesh = bx(0.055, 0.16, 0.14, 0, -0.14, -0.06, mat, g);
    this.magY = -0.14;
    const stock = bx(0.075, 0.13, 0.44, 0, -0.02, 0.5, mat, g);
    stock.rotation.x = 0.04;
    bx(0.05, 0.14, 0.07, 0, -0.13, 0.2, mat, g).rotation.x = 0.3;
    bx(0.06, 0.05, 0.16, 0, 0.07, 0.42, mat, g);
    // scope: tube, rings, and a red cross the ADS view lines up with
    cyl(0.052, 0.56, 0, 0.135, -0.1, mat, g);
    cyl(0.066, 0.07, 0, 0.135, -0.36, mat, g);
    cyl(0.062, 0.07, 0, 0.135, 0.14, mat, g);
    for (const z of [-0.24, 0.02]) {
      bx(0.03, 0.09, 0.035, 0, 0.085, z, dark, g);
    }
    const cross = new THREE.Group();
    cross.position.set(0, 0.135, -0.38);
    g.add(cross);
    bx(0.09, 0.006, 0.004, 0, 0, 0, this.red, cross);
    bx(0.006, 0.09, 0.004, 0, 0, 0, this.red, cross);
    // bolt handle on the right, worked after every shot
    this.boltH = bx(0.026, 0.026, 0.16, 0.07, 0.05, 0.16, dark, g);
    this.boltZ = 0.16;
    sph(0.032, 0.07, 0.05, 0.24, dark, g, 6);
    // bipod
    const bl = bx(0.02, 0.26, 0.02, -0.07, -0.13, -0.78, dark, g);
    bl.rotation.z = 0.35;
    const br = bx(0.02, 0.26, 0.02, 0.07, -0.13, -0.78, dark, g);
    br.rotation.z = -0.35;
    hand(mat, 0.02, -0.16, 0.24, g, [0.5, -0.6, 1]);
    this.handL = hand(mat, -0.05, -0.09, -0.5, g, [-0.35, -0.9, 0.9]);
    this.handLPos = this.handL.position.clone();
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.02, -1.6);
    g.add(this.muzzle);
    this.ejectPt = new THREE.Object3D();
    this.ejectPt.position.set(0.06, 0.04, 0.06);
    g.add(this.ejectPt);
    this.flash = makeFlash(g, 0, 0.02, -1.6, 1);
  }
}
