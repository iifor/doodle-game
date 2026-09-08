import * as THREE from 'three';
import { Room } from './room.js';
import { RemotePlayer, encodeLocal } from './remote-player.js';
import { INK } from '../render.js';
import { rayPlayer } from './combat.js';

export class Multiplayer {
  constructor(ctx, { setArena, reset, show, resume, exit, settings, prefs, pickups }) {
    Object.assign(this, { ctx, setArena, reset, show, resume, exit, settings, prefs, pickups });
    this.remotes = new Map();
    this.syncTime = 0;
    this.error = '';
    this.busy = false;
    this.generation = 0;
    this.round = 0;
    this.life = 0;
    this.supplies = 0;
    this.room = new Room({
      arena: () => ({ world: ctx.world, spawns: ctx.level.arenaSpawns, pickupSpots: ctx.level.pickups }),
      onChange: (state) => this.apply(state),
      onEvent: (event) => this.event(event),
      onError: (error) => {
        console.error('[联机]', error);
        this.error = `联机失败：${error.message}`;
        if (!this.room.active) {
          ctx.game.state = 'lobby';
          ctx.input.exitLock();
          ctx.input.clear();
          this.clearRemotes();
          this.pickups.clear();
          this.round = this.life = this.supplies = 0;
          ctx.hud.setOnlineScores([], null);
        }
        this.render();
      },
    });
  }
  get enabled() {
    return this.ctx.game.mode === 'pvp';
  }
  get inMatch() {
    return this.enabled && this.room.state?.phase === 'match';
  }
  open() {
    this.ctx.game.mode = 'pvp';
    this.ctx.game.state = 'lobby';
    this.setArena(true);
    this.reset();
    this.render();
  }
  async connect(options) {
    if (this.busy) return;
    const generation = ++this.generation;
    this.busy = true;
    this.error = '';
    this.render();
    try {
      await this.room.connect(options);
    } catch (error) {
      if (generation === this.generation) {
        console.error('[联机]', error);
        this.error = `联机失败：${error.message}`;
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.render();
      }
    }
  }
  render() {
    if (!this.enabled) return;
    const { game, hud } = this.ctx,
      room = this.room.state;
    if (room?.phase === 'match' && ['play', 'dying'].includes(game.state)) return;
    const stage = !room
      ? 'connect'
      : room.phase === 'lobby'
        ? 'lobby'
        : room.phase === 'over'
          ? 'results'
          : game.state === 'pause'
            ? 'pause'
            : 'ready';
    hud.setGameplayVisible(false);
    this.show({
      kind: 'online',
      stage,
      room,
      selfId: this.room.net.id,
      busy: this.busy,
      error: this.error,
      prefs: this.prefs,
      actions: {
        connect: (options) => this.connect(options),
        start: () => this.room.start(),
        back: () => this.room.back(),
        resume: this.resume,
        exit: () => this.leave(),
        settings: this.settings,
      },
    });
  }
  report(message) {
    this.error = message;
    this.render();
  }
  apply(state) {
    const { game, player, hud, input } = this.ctx;
    for (const [id, r] of this.remotes)
      if (!state.players.some((p) => p.id === id)) {
        hud.kill(`${r.name} 离开了房间`, 0);
        r.dispose();
        this.remotes.delete(id);
      }
    for (const p of state.players) {
      if (p.id === this.room.net.id) continue;
      let r = this.remotes.get(p.id);
      if (!r) {
        r = new RemotePlayer(this.ctx, p.id, p.name, 0, p.ink ?? INK.RED);
        this.remotes.set(p.id, r);
      }
      r.push(p.snap, performance.now() / 1000);
    }
    const self = state.players.find((p) => p.id === this.room.net.id);
    if (state.phase === 'match') {
      if (this.round !== state.round) {
        this.reset();
        this.round = state.round;
        this.life = 0;
        this.supplies = 0;
        game.state = 'pvpReady';
        game.menu = true;
        input.exitLock();
        input.clear();
      }
      if (this.life !== self.life) {
        const wasDying = game.state === 'dying';
        player.maxHp = 110;
        player.reset(new THREE.Vector3().fromArray(self.snap));
        player.yaw = self.snap[3];
        player.pitch = self.snap[4];
        this.life = self.life;
        if (wasDying) {
          game.state = game.menu ? 'pause' : 'play';
          hud.message('', '', 0);
        }
      }
      if (self.hp < player.hp) player.takeDamage(player.hp - self.hp, null);
      else player.hp = self.hp;
      if (self.supplies > this.supplies) {
        for (let i = this.supplies; i < self.supplies; i++) {
          player.addAmmoAll(0.4);
          player.grenades = Math.min(player.maxGrenades, player.grenades + 1);
        }
        hud.kill('补充弹药 · 手雷 +1', 0);
        this.supplies = self.supplies;
      }
      this.pickups.syncOnline(state.pickups);
      const seconds = Math.ceil(state.left);
      hud.setTimer(`剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      if (self.hp <= 0) hud.message('你被擦除了', `${self.respawn.toFixed(1)} 秒后重新加入战斗`, 0.2);
      else if (self.shield > 0) hud.setModifier(`出生保护 ${self.shield.toFixed(1)} 秒 · 攻击后结束`);
      else hud.setModifier('');
    } else {
      if (game.state !== (state.phase === 'over' ? 'over' : 'lobby')) {
        input.exitLock();
        input.clear();
      }
      game.state = state.phase === 'over' ? 'over' : 'lobby';
    }
    hud.setOnlineScores(state.players, this.room.net.id);
    this.render();
  }
  ready() {
    this.error = '';
    this.room.action('ready');
  }
  update(dt) {
    if (this.room.state)
      this.ctx.game.time = this.room.state.time + (performance.now() - this.room.receivedAt) / 1000;
    for (const r of this.remotes.values()) r.update(dt, performance.now() / 1000);
    if (!this.inMatch) return;
    this.syncTime -= dt;
    if (
      this.syncTime <= 0 &&
      this.ctx.player.alive &&
      this.room.state.players.find((p) => p.id === this.room.net.id).active
    ) {
      this.syncTime = 0.05;
      this.room.action('state', { snap: encodeLocal(this.ctx.player, this.ctx.player.weaponIndex) });
    }
    this.ctx.hud.el.board.hidden = !this.ctx.input.down('score');
  }
  shot(kind, origin, dirs) {
    if (this.inMatch)
      this.room.action('shot', { kind, origin: origin.toArray(), dirs: dirs.map((d) => d.toArray()) });
  }
  melee() {
    if (this.inMatch) this.room.action('melee');
  }
  grenade(data) {
    if (this.inMatch) this.room.action('grenade', data);
  }
  fall() {
    if (this.inMatch) this.room.action('fall');
  }
  take(id) {
    if (this.inMatch) this.room.action('take', { id });
  }
  raycast(origin, dir, max) {
    if (!this.inMatch) return null;
    return rayPlayer(this.room.state.players, origin, dir, max, this.room.net.id);
  }
  event(e) {
    const { player, effects, audio, hud } = this.ctx;
    if (e.type === 'shot' && e.id !== this.room.net.id) {
      const origin = new THREE.Vector3().fromArray(e.origin);
      for (const end of e.ends)
        effects.tracer(origin, new THREE.Vector3().fromArray(end), INK.RED, 0.02, 0.08);
      audio.remoteShot(e.kind, origin);
    } else if (e.type === 'grenade' && e.id !== this.room.net.id) player.throwGrenade(e);
    else if (e.type === 'parry') {
      if (e.id === this.room.net.id) hud.tip('成功弹反', 1);
    } else if (e.type === 'death') {
      const roster = this.room.state.players,
        victim = roster.find((p) => p.id === e.id),
        killer = roster.find((p) => p.id === e.by);
      if (victim && killer) hud.kill(`${killer.name} 击败了 ${victim.name}`, 0);
      if (e.by === this.room.net.id && e.id !== e.by) audio.kill(true);
    }
  }
  clearRemotes() {
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
  }
  leave() {
    this.generation++;
    this.busy = false;
    this.room.leave();
    this.clearRemotes();
    this.round = this.life = this.supplies = 0;
    this.ctx.hud.setOnlineScores([], null);
    this.error = '';
    this.exit();
  }
  dispose() {
    this.generation++;
    this.room.leave();
    this.clearRemotes();
  }
}
