import { validateProfile, armorDamage, WEAPON_IDS } from '../character.js';
import {
  castAbility,
  tickAbilities,
  launchShell,
  resetAbilities,
  bladeRecovering,
  absorbBarrier,
} from '../abilities.js';
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
import { eyeOf, shoot, slash, advanceGrenade, allied } from './combat.js';
import { tickNpcs, npcDelay } from './npcs.js';
import { allocateInk } from '../colors.js';

// Host-owned life, score, round clock and pickup arbitration. Position/aim remain client-owned.
export class Match {
  constructor({
    host,
    code,
    isPublic,
    world,
    spawns,
    pickupSpots,
    emit,
    nav,
    npcsEnabled = false,
    teamsEnabled = false,
  }) {
    requireValue(spawns.length >= MAX_PLAYERS, '地图没有足够的竞技出生点');
    Object.assign(this, { host, code, public: isPublic, world, spawns, pickupSpots, emit });
    requireValue(typeof npcsEnabled === 'boolean', 'NPC 配置无效');
    Object.assign(this, { nav, npcsEnabled });
    requireValue(typeof teamsEnabled === 'boolean', '队伍配置无效');
    this.teamsEnabled = teamsEnabled;
    this.teamScores = [0, 0];
    this.winnerTeam = null;
    this.fields = [];
    this.npcs = [];
    this.npcTime = npcDelay();
    this.nextNpc = 1;
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
  get targets() {
    return [...this.players.values(), ...this.npcs];
  }
  configureNpcs(enabled) {
    requireValue(this.phase === 'lobby' && typeof enabled === 'boolean', '只能在房间中配置 NPC');
    this.npcsEnabled = enabled;
  }
  configureTeams(enabled) {
    requireValue(this.phase === 'lobby' && typeof enabled === 'boolean', '只能在房间中配置队伍');
    this.teamsEnabled = enabled;
    this.teamScores = [0, 0];
    this.winnerTeam = null;
    let i = 0;
    for (const p of this.players.values()) p.team = enabled ? 1 + (i++ % 2) : 0;
  }
  setTeam(id, team) {
    requireValue(
      this.phase === 'lobby' && this.teamsEnabled && [1, 2].includes(team) && this.players.has(id),
      '队伍选择无效',
    );
    this.players.get(id).team = team;
  }
  add(id, name, profile) {
    if (profile) validateProfile(profile);
    requireValue(!this.players.has(id) && this.players.size < MAX_PLAYERS, '重复玩家或房间已满');
    validateName(name);
    const p = {
      id,
      name,
      profile: profile ? structuredClone(profile) : undefined,
      ink: allocateInk(this.players.values()),
      team: this.teamsEnabled
        ? [...this.players.values()].filter((p) => p.team === 1).length <=
          [...this.players.values()].filter((p) => p.team === 2).length
          ? 1
          : 2
        : 0,
      assists: 0,
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
    this.fields = this.fields.filter((f) => f.owner !== id);
    for (const p of this.players.values()) p.contributors.delete(id);
    this.grenades = this.grenades.filter((g) => g.owner !== id);
    if (this.winner === id) this.winner = null;
  }
  spawn(p) {
    p.contributors = new Map();
    this.fields = this.fields.filter((f) => f.owner !== p.id);
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
    p.hp = p.profile?.stats.health ?? MAX_HP;
    p.snap = [s.x, s.y, s.z, 0, 0, p.profile ? WEAPON_IDS.indexOf(p.profile.weapon) : 0, 64, p.hp, 0, 0, 0];
    resetAbilities(p);
    p.shield = 2;
    p.respawn = 0;
    p.hurtAt = this.time;
    p.grenadeCount = 3;
  }
  start() {
    requireValue(this.phase !== 'match', '对局已经开始');
    requireValue(
      !this.teamsEnabled || [1, 2].every((team) => [...this.players.values()].some((p) => p.team === team)),
      '双方队伍至少各一人',
    );
    this.teamScores = [0, 0];
    this.winnerTeam = null;
    this.fields = [];
    this.npcs = [];
    this.npcTime = npcDelay();
    this.round++;
    this.phase = 'match';
    this.left = MATCH_SECONDS;
    this.winner = null;
    this.pickups = [];
    this.grenades = [];
    this.pickupTime = 0;
    for (const p of this.players.values()) {
      p.kills = p.assists = p.deaths = p.supplies = p.seq = 0;
      p.life++;
      p.active = false;
      this.spawn(p);
    }
  }
  lobby() {
    this.winnerTeam = null;
    this.phase = 'lobby';
    this.fields = [];
    this.npcs = [];
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
      requireValue(!p.profile || WEAPON_IDS[a.snap[5]] === p.profile.weapon, '本局武器已锁定');
      p.snap = [...a.snap];
      p.snap[7] = p.hp;
      return true;
    }
    if (a.type === 'skill') return castAbility(this, p, a.index);
    if (a.type === 'shot') {
      requireValue(!p.profile || a.kind === p.profile.weapon, '职业不能使用该武器');
      requireValue(new THREE.Vector3().fromArray(a.origin).distanceTo(eyeOf(p)) < 8, '射击起点偏离玩家');
      if (this.time - p.shotAt < WEAPONS[a.kind].interval * 0.8) return false;
      p.shotAt = this.time;
      p.shield = 0;
      if (a.kind === 'cannon') launchShell(this, p);
      else shoot(this, p, a);
    } else if (a.type === 'melee') {
      requireValue(!p.profile || p.profile.role === 'blade', '职业不能拔刀');
      if (bladeRecovering(p, this.time) || this.time - p.meleeAt < (p.profile ? 0.33 : 0.22)) return false;
      p.meleeAt = this.time;
      p.shield = 0;
      slash(this, p);
    } else if (a.type === 'grenade') {
      requireValue(!p.profile, '职业角色使用职业技能');
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
      if (p.team) this.teamScores[p.team - 1] = Math.max(0, this.teamScores[p.team - 1] - 1);
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
    const attacker = this.players.get(by);
    if (
      !amount ||
      !target.active ||
      target.hp <= 0 ||
      target.shield > 0 ||
      this.phase !== 'match' ||
      (target.id !== by && allied(attacker, target))
    )
      return false;
    target.hp = Math.max(
      0,
      target.hp - armorDamage(absorbBarrier(target, amount, this.time), target.profile),
    );
    if (this.npcs.includes(target)) return;
    target.hurtAt = this.time;
    if (attacker && attacker.id !== target.id) target.contributors.set(by, this.time);
    if (target.hp > 0) return;
    target.deaths++;
    target.respawn = 2.5;
    if (by !== target.id && attacker) {
      attacker.kills++;
      if (attacker.team) this.teamScores[attacker.team - 1]++;
      for (const [id, at] of target.contributors) {
        const helper = this.players.get(id);
        if (id !== by && this.time - at <= 8 && allied(attacker, helper)) helper.assists++;
      }
    }
    this.emit({ type: 'death', id: target.id, by });
    if (attacker && by !== target.id) {
      if (this.teamsEnabled && this.teamScores[attacker.team - 1] >= TARGET_KILLS)
        this.finish(null, attacker.team);
      else if (!this.teamsEnabled && attacker.kills >= TARGET_KILLS) this.finish(by);
    }
  }
  finish(winner, team = null) {
    this.winnerTeam = team;
    this.phase = 'over';
    this.fields = [];
    this.npcs = [];
    this.winner = winner;
    this.grenades = [];
  }
  tick(dt) {
    requireValue(Number.isFinite(dt) && dt >= 0 && dt <= 2, '房主模拟停顿过久，请重新创建房间');
    this.time += dt;
    if (this.phase !== 'match') return;
    const active = [...this.players.values()].filter((p) => p.active);
    if (this.teamsEnabled ? [1, 2].every((team) => active.some((p) => p.team === team)) : active.length >= 2)
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
        p.hp = Math.min(p.profile?.stats.health ?? MAX_HP, p.hp + armorDamage(dt * 14, p.profile));
    }
    tickAbilities(this, dt);
    tickNpcs(this, dt);
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
      if (this.teamsEnabled)
        this.finish(
          null,
          this.teamScores[0] === this.teamScores[1] ? null : this.teamScores[0] > this.teamScores[1] ? 1 : 2,
        );
      else this.finish(ranked[0].id);
    }
  }
  snapshot() {
    return {
      teamsEnabled: this.teamsEnabled,
      teamScores: [...this.teamScores],
      winnerTeam: this.winnerTeam,
      npcsEnabled: this.npcsEnabled,
      npcs: this.npcs
        .filter((n) => n.hp > 0)
        .map((n) => ({
          id: n.id,
          name: n.name,
          hp: n.hp,
          active: true,
          snap: [...n.snap.slice(0, 7), n.hp, ...n.snap.slice(8)],
        })),
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
          profile: p.profile,
          energy: p.energy,
          skillAt: p.skillAt,
          focusUntil: p.focusUntil,
          barrier: p.barrier,
          barrierUntil: p.barrierUntil,
          chargedAt: p.chargedAt,
          slowUntil: p.slowUntil,
          ink: p.ink,
          team: p.team,
          assists: p.assists,
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
