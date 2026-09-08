import * as THREE from 'three';
import {
  MAX_PLAYERS,
  MAX_HP,
  MATCH_SECONDS,
  TARGET_KILLS,
  requireValue,
  validateName,
  validateAction,
  WEAPONS,
} from './protocol.js';
import { eyeOf, shoot, slash, advanceGrenade } from './combat.js';

// Host-owned life, score, round clock and pickup arbitration. Position/aim remain client-owned.
export class Match {
  constructor({ host, code, isPublic, world, spawns, pickupSpots, emit }) {
    requireValue(spawns.length >= MAX_PLAYERS, '地图没有足够的竞技出生点');
    Object.assign(this, { host, code, public: isPublic, world, spawns, pickupSpots, emit });
    this.players = new Map();
    this.phase = 'lobby';
    this.round = 0;
    this.revision = 0;
    this.left = MATCH_SECONDS;
    this.winner = null;
    this.pickups = [];
    this.grenades = [];
    this.nextPickup = 1;
    this.pickupTime = 0;
    this.time = 0;
  }
  add(id, name) {
    requireValue(!this.players.has(id) && this.players.size < MAX_PLAYERS, '重复玩家或房间已满');
    validateName(name);
    const p = {
      id,
      name,
      kills: 0,
      deaths: 0,
      life: 1,
      hp: MAX_HP,
      active: false,
      shield: 2,
      respawn: 0,
      supplies: 0,
      seq: 0,
      shotAt: -10,
      meleeAt: -10,
      grenadeAt: -10,
      grenadeCount: 3,
      hurtAt: -10,
      snap: [0, 0, 0, 0, 0, 0, 64, MAX_HP, 0, 0, 0],
    };
    this.players.set(id, p);
    this.spawn(p);
    return p;
  }
  remove(id) {
    this.players.delete(id);
    this.grenades = this.grenades.filter((g) => g.owner !== id);
    if (this.winner === id) this.winner = null;
  }
  spawn(p) {
    const others = [...this.players.values()].filter((other) => other.id !== p.id && other.hp > 0);
    const ranked = this.spawns.map((spot, i) => ({
      spot,
      i,
      distance: others.reduce(
        (min, other) => Math.min(min, spot.distanceTo(new THREE.Vector3().fromArray(other.snap))),
        Infinity,
      ),
    }));
    ranked.sort((a, b) => b.distance - a.distance || a.i - b.i);
    const s = ranked[0].spot;
    p.snap = [s.x, s.y, s.z, 0, 0, 0, 64, MAX_HP, 0, 0, 0];
    p.hp = MAX_HP;
    p.shield = 2;
    p.respawn = 0;
    p.hurtAt = this.time;
    p.grenadeCount = 3;
  }
  start() {
    requireValue(this.phase !== 'match', '对局已经开始');
    this.round++;
    this.phase = 'match';
    this.left = MATCH_SECONDS;
    this.winner = null;
    this.pickups = [];
    this.grenades = [];
    this.pickupTime = 0;
    for (const p of this.players.values()) {
      p.kills = p.deaths = p.supplies = p.seq = 0;
      p.life++;
      p.active = false;
      this.spawn(p);
    }
  }
  lobby() {
    this.phase = 'lobby';
    this.winner = null;
    this.grenades = [];
    this.pickups = [];
    for (const p of this.players.values()) p.active = false;
  }
  apply(id, raw) {
    const a = validateAction(raw),
      p = this.players.get(id);
    requireValue(p, '发送者不在房间中');
    // Late packets from a previous life/round are expected on a live connection.
    if (this.phase !== 'match' || a.round < this.round || a.life < p.life || a.seq <= p.seq) return false;
    requireValue(a.round === this.round && a.life === p.life, '未来的对局或生命序号');
    p.seq = a.seq;
    if (a.type === 'ready') {
      p.active = true;
      return true;
    }
    if (!p.active || p.hp <= 0) return false;
    if (a.type === 'state') {
      p.snap = [...a.snap];
      p.snap[7] = p.hp;
      return true;
    }
    if (a.type === 'shot') {
      requireValue(new THREE.Vector3().fromArray(a.origin).distanceTo(eyeOf(p)) < 8, '射击起点偏离玩家');
      if (this.time - p.shotAt < WEAPONS[a.kind].interval * 0.8) return false;
      p.shotAt = this.time;
      p.shield = 0;
      shoot(this, p, a);
    } else if (a.type === 'melee') {
      if (this.time - p.meleeAt < 0.22) return false;
      p.meleeAt = this.time;
      p.shield = 0;
      slash(this, p);
    } else if (a.type === 'grenade') {
      requireValue(new THREE.Vector3().fromArray(a.pos).distanceTo(eyeOf(p)) < 8, '手雷起点偏离玩家');
      if (this.time - p.grenadeAt < 0.5 || p.grenadeCount <= 0) return false;
      p.grenadeAt = this.time;
      p.grenadeCount--;
      p.shield = 0;
      this.grenades.push({
        owner: id,
        pos: new THREE.Vector3().fromArray(a.pos),
        vel: new THREE.Vector3().fromArray(a.vel),
        fuse: 1.7,
      });
      this.emit({ type: 'grenade', id, pos: a.pos, vel: a.vel });
    } else if (a.type === 'fall') {
      p.kills = Math.max(0, p.kills - 1);
      p.life++;
      this.spawn(p);
    } else if (a.type === 'take') {
      const item = this.pickups.find((v) => v.id === a.id);
      if (
        !item ||
        new THREE.Vector3().fromArray(item.pos).distanceTo(new THREE.Vector3().fromArray(p.snap)) > 3
      )
        return false;
      this.pickups.splice(this.pickups.indexOf(item), 1);
      p.supplies++;
      p.grenadeCount = Math.min(5, p.grenadeCount + 1);
    }
    return true;
  }
  damage(target, amount, by) {
    requireValue(Number.isFinite(amount) && amount >= 0, '伤害不是有效数值');
    if (!target.active || target.hp <= 0 || target.shield > 0 || this.phase !== 'match') return;
    target.hp = Math.max(0, target.hp - amount);
    target.hurtAt = this.time;
    if (target.hp > 0) return;
    target.deaths++;
    target.respawn = 2.5;
    if (by !== target.id && this.players.has(by)) this.players.get(by).kills++;
    this.emit({ type: 'death', id: target.id, by });
    if (by !== target.id && this.players.get(by)?.kills >= TARGET_KILLS) this.finish(by);
  }
  finish(winner) {
    this.phase = 'over';
    this.winner = winner;
    this.grenades = [];
  }
  tick(dt) {
    requireValue(Number.isFinite(dt) && dt >= 0 && dt <= 2, '房主模拟停顿过久，请重新创建房间');
    this.time += dt;
    if (this.phase !== 'match') return;
    if ([...this.players.values()].filter((p) => p.active).length >= 2)
      this.left = Math.max(0, this.left - dt);
    for (const p of this.players.values()) {
      if (!p.active) continue;
      p.shield = Math.max(0, p.shield - dt);
      if (p.hp <= 0) {
        p.respawn = Math.max(0, p.respawn - dt);
        if (p.respawn === 0) {
          p.life++;
          this.spawn(p);
        }
      } else if (this.time - p.hurtAt > 4 && !(p.snap[6] & 128) && Math.hypot(p.snap[8], p.snap[10]) < 7)
        p.hp = Math.min(MAX_HP, p.hp + dt * 14);
    }
    this.grenades = this.grenades.filter((g) => !advanceGrenade(this, g, dt));
    this.pickupTime -= dt;
    if (this.pickupTime <= 0 && this.pickups.length < 12) {
      this.pickupTime = 5;
      const spot = this.pickupSpots[Math.floor(Math.random() * this.pickupSpots.length)];
      this.pickups.push({ id: this.nextPickup++, pos: spot.toArray() });
    }
    if (this.left === 0) {
      const ranked = [...this.players.values()].sort(
        (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id.localeCompare(b.id),
      );
      this.finish(ranked[0].id);
    }
  }
  snapshot() {
    return {
      code: this.code,
      host: this.host,
      public: this.public,
      round: this.round,
      revision: ++this.revision,
      phase: this.phase,
      left: this.left,
      time: this.time,
      winner: this.winner,
      pickups: this.pickups.map((p) => ({ ...p })),
      players: [...this.players.values()].map((p) => {
        const snap = [...p.snap];
        snap[7] = Math.ceil(p.hp);
        snap[6] = (snap[6] & ~64 & ~2048) | (p.hp > 0 ? 64 : 0) | (!p.active ? 2048 : 0);
        return {
          id: p.id,
          name: p.name,
          kills: p.kills,
          deaths: p.deaths,
          life: p.life,
          hp: p.hp,
          active: p.active,
          shield: p.shield,
          respawn: p.respawn,
          supplies: p.supplies,
          snap,
        };
      }),
    };
  }
}
