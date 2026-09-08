import * as THREE from 'three';
import { makeInkMaterial, INK } from '../render.js';
import { clamp, damp, Spring3, TAU } from '../util.js';
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export function bx(w, h, d, x, y, z, mat, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function cyl(r, h, x, y, z, mat, parent, axis = 'z', seg = 8) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  else if (axis === 'x') g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function sph(r, x, y, z, mat, parent, seg = 8) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function star(n = 7, r1 = 0.16, r2 = 0.06) {
  const s = new THREE.Shape();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU,
      r = i % 2 === 0 ? r1 : r2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return new THREE.ShapeGeometry(s);
}
export function frame(w, h, t, d, x, y, z, mat, parent) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  bx(w, t, d, 0, h / 2, 0, mat, g);
  bx(w, t, d, 0, -h / 2, 0, mat, g);
  bx(t, h, d, -w / 2, 0, 0, mat, g);
  bx(t, h, d, w / 2, 0, 0, mat, g);
  return g;
}
// doodle fist + forearm heading back toward the shoulder
export function hand(mat, x, y, z, parent, dir = [0.4, -0.5, 1], len = 0.42) {
  sph(0.062, x, y, z, mat, parent);
  const d = new THREE.Vector3(...dir).normalize();
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, len, 7), mat);
  arm.position.set(x + (d.x * len) / 2, y + (d.y * len) / 2, z + (d.z * len) / 2);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  parent.add(arm);
  return arm;
}
export function makeFlash(parent, x, y, z, scale) {
  const fm = makeInkMaterial({ ink: INK.ORANGE, fill: true, side: THREE.DoubleSide });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(star(7, 0.16, 0.06), fm));
  const s2 = new THREE.Mesh(star(5, 0.11, 0.04), fm);
  s2.rotation.y = Math.PI / 2;
  g.add(s2);
  const s3 = new THREE.Mesh(star(5, 0.1, 0.04), fm);
  s3.rotation.x = Math.PI / 2;
  g.add(s3);
  g.position.set(x, y, z);
  g.scale.setScalar(scale);
  g.visible = false;
  parent.add(g);
  return g;
}

export class ViewModel {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.scale = 0.46;
    this.root.scale.setScalar(this.scale);
    this.root.visible = false;
    this.basePos = new THREE.Vector3(0.2, -0.17, -0.36);
    this.baseRot = new THREE.Vector3(0, 0, 0);
    this.aimPos = new THREE.Vector3(0, -0.13, -0.3);
    this.adsFov = 60;
    this.isGun = false;
    this.recoil = new Spring3(260, 18);
    this.recoilRot = new Spring3(220, 16);
    this.swayPos = new THREE.Vector3();
    this.swayRot = new THREE.Vector3();
    this.aimAmt = 0;
    this.sprintAmt = 0;
    this.equipT = 0;
  }
  setSight(x, y, z, dist) {
    this.aimPos.set(-x * this.scale, -y * this.scale, -z * this.scale - dist);
  }
  reset() {
    this.aimAmt = 0;
    this.sprintAmt = 0;
    this.equipT = 0;
    this.recoil.value.set(0, 0, 0);
    this.recoil.vel.set(0, 0, 0);
    this.recoil.target.set(0, 0, 0);
    this.recoilRot.value.set(0, 0, 0);
    this.recoilRot.vel.set(0, 0, 0);
    this.recoilRot.target.set(0, 0, 0);
    this.swayPos.set(0, 0, 0);
    this.swayRot.set(0, 0, 0);
  }
  equip() {
    this.equipT = 0;
    this.root.visible = true;
  }
  unequip() {
    this.root.visible = false;
  }
  animate(dt, st) {
    const lx = clamp(st.lookDelta.x, -0.12, 0.12),
      ly = clamp(st.lookDelta.y, -0.12, 0.12);
    this.aimAmt = damp(this.aimAmt, st.aim ? 1 : 0, 14, dt);
    const ia = 1 - this.aimAmt;
    this.swayPos.x = damp(this.swayPos.x, lx * 0.5 * (0.3 + 0.7 * ia), 10, dt);
    this.swayPos.y = damp(this.swayPos.y, ly * 0.35 * (0.3 + 0.7 * ia), 10, dt);
    this.swayRot.y = damp(this.swayRot.y, lx * 1.4 * ia, 10, dt);
    this.swayRot.x = damp(this.swayRot.x, ly * 0.9 * ia, 10, dt);
    this.swayRot.z = damp(this.swayRot.z, (-lx * 1.8 - st.strafe * 0.06) * ia, 8, dt);
    const bobX = Math.sin(st.bobPhase) * 0.013 * st.bobAmt * (0.15 + 0.85 * ia),
      bobY = Math.abs(Math.cos(st.bobPhase)) * 0.013 * st.bobAmt * (0.15 + 0.85 * ia);
    this.sprintAmt = damp(this.sprintAmt, st.sprinting && !st.aim ? 1 : 0, 8, dt);
    this.recoil.update(dt);
    this.recoilRot.update(dt);
    this.equipT = Math.min(1, this.equipT + dt * 3.2);
    const eq = 1 - easeOut(this.equipT);
    const p = this.root.position,
      r = this.root.rotation;
    const rk = this.recoil.value,
      rr = this.recoilRot.value;
    const ads = this.aimAmt;
    p.copy(this.basePos).lerp(this.aimPos, ads);
    p.x += this.swayPos.x + bobX + rk.x * (0.3 + 0.7 * ia) + this.sprintAmt * 0.06;
    p.y +=
      this.swayPos.y +
      bobY +
      rk.y * (0.3 + 0.7 * ia) -
      eq * 0.32 -
      st.landDip * 0.35 * ia -
      this.sprintAmt * 0.09;
    p.z += rk.z + this.sprintAmt * 0.05;
    r.set(
      this.baseRot.x * ia + this.swayRot.x + rr.x - eq * 0.9 + this.sprintAmt * 0.4 + st.landDip * 0.5 * ia,
      this.baseRot.y * ia + this.swayRot.y + rr.y * (0.4 + 0.6 * ia) - this.sprintAmt * 0.55,
      this.baseRot.z * ia +
        this.swayRot.z +
        rr.z * (0.3 + 0.7 * ia) +
        this.sprintAmt * 0.18 +
        st.slideTilt * 0.4 * ia,
    );
    // once you are properly behind a scope, the gun itself would just block the sight picture
    if (this.scope) this.root.visible = this.aimAmt < 0.8;
    this.update(dt, st);
  }
}
