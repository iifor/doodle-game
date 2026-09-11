import { BuildingScenes } from './scenes.js';
import { dynamicScene } from './interiors.js';
import { PLOTS, outdoors, buildingAt, doorPosition, sceneOf, validateWorldLayout } from './region.js';
import * as THREE from 'three';
import { Transport } from '../online/transport.js';
import { RemotePlayer, encodeLocal } from '../online/remote-player.js';
import { validateName } from '../online/protocol.js';
import { INK, setFill } from '../render.js';
import { SEE_THROUGH, makeBody } from '../physics.js';
import { disposeTree } from '../../../shared/resources.js';
import { damp } from '../util.js';
import { Chunks } from './chunks.js';
import {
  SIZE,
  SCHEMA,
  GENERATOR,
  ENEMY_TYPES,
  ENCOUNTER_TYPES,
  MAX_ENCOUNTER_ENEMIES,
  outpostComplete,
  hash,
  coordinates,
  keyOf,
  validAddress,
  validateProgress,
  checksum,
  requireWorld,
} from './schema.js';
import { GUNS } from '../weapons/guns.js';
import { TYPES } from '../enemies/types.js';
import { allocateInk, inkCSS } from '../colors.js';
import { WorldAPI, Packets, validateActor } from './network.js';
import {
  QUESTS,
  defaultQuests,
  validateQuests,
  questBrief,
  onClear,
  onBossKill,
  onCampInteract,
  startQuest,
} from './quests.js';

const nearby = (a, b, radius = 1) => Math.abs(a.cx - b.cx) <= radius && Math.abs(a.cz - b.cz) <= radius;
const freshProgress = () => ({ defeated: [], rewarded: false });
const actorData = (p) => ({
  id: p.id,
  name: p.name,
  ink: p.ink,
  pos: p.pos,
  yaw: p.yaw,
  pitch: p.pitch,
  weapon: p.weapon,
  flags: p.flags,
  velocity: p.velocity,
  hook: p.hook,
  hp: p.hp,
  life: p.life,
  active: p.active,
  reward: p.reward,
  respawnTarget: p.respawnTarget ?? null,
  sceneId: p.sceneId,
  epoch: p.epoch,
});

export class Exploration {
  constructor(ctx, { show, resume, reset, prefs, settings, pickups, mapRoot, exit }) {
    Object.assign(this, { ctx, show, resume, reset, prefs, settings, pickups, mapRoot, exit });
    ctx.exploration = this;
    ctx.game.mode = 'explore';
    ctx.hud.root.classList.add('exploration');
    this.api = new WorldAPI();
    this.players = new Map();
    this.remotes = new Map();
    this.requests = new Map();
    this.failed = new Map();
    this.manifest = new Set();
    this.chunks = null;
    this.info = null;
    this.progress = null;
    this.isHost = false;
    this.selfId = 'host';
    this.stage = 'connect';
    this.error = '';
    this.busy = false;
    this.started = false;
    this.disposed = false;
    this.generation = 0;
    this.seq = 0;
    this.tickT = 0;
    this.saves = Promise.resolve();
    this.unsaved = [];
    this.pendingKills = new Map();
    this.saving = 0;
    this.inbox = Promise.resolve();
    this.snapshotRevision = 0;
    this.acceptedRevision = 0;
    this.worlds = [];
    this.grenades = [];
    this.snapshotT = 0;
    this.entered = false;
    const host = import.meta.env.VITE_PEER_HOST;
    const peerOptions = host
      ? {
          host,
          port: Number(import.meta.env.VITE_PEER_PORT),
          secure: import.meta.env.VITE_PEER_SECURE === 'true',
          path: '/peerjs',
        }
      : {};
    this.net = new Transport({
      prefix: 'doodle-world-v2-',
      peerOptions,
      onJoin: (id, name) => this.addGuest(id, name),
      onLeave: (id) => {
        this.players.delete(id);
        this.removeRemote(id);
      },
      onMessage: (frame, from) => this.packets.accept(frame, from),
      onError: (error) => {
        this.report(error.message);
        if (!this.net.connected && !this.isHost) {
          this.started = false;
          this.ctx.input.exitLock();
          this.ctx.game.state = 'worldMenu';
          this.stage = 'disconnected';
          this.render();
        }
      },
    });
    this.packets = new Packets(
      (id, frame) => this.net.sendTo(id, frame),
      (type, data, from) => {
        this.inbox = this.inbox
          .then(() => this.receive(type, data, from))
          .catch((error) => {
            this.report(error.message);
            if (this.net.connections.has(from)) this.net.drop(from, error);
          });
      },
    );
    ctx.enemies.onKill = (enemy) => this.killed(enemy);
    this.overlay = document.createElement('div');
    this.overlay.className = 'world-hud';
    this.overlay.hidden = true;
    this.label = document.createElement('div');
    this.label.setAttribute('role', 'status');
    this.map = document.createElement('canvas');
    this.map.width = 150;
    this.map.height = 150;
    this.map.setAttribute('aria-label', '附近已探索区域地图，绿色表示安全据点');
    this.overlay.append(this.label, this.map);
    this.loading = document.createElement('div');
    this.loading.className = 'world-interior-loading';
    this.loading.hidden = true;
    this.loading.setAttribute('role', 'status');
    const spinner = document.createElement('span');
    spinner.className = 'world-interior-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    this.loadingText = document.createElement('strong');
    const note = document.createElement('small');
    note.textContent = '首次由 AI 设计并保存，重访读取缓存 · E 取消';
    this.loading.append(spinner, this.loadingText, note);
    this.overlay.append(this.loading);
  }
  get enabled() {
    return true;
  }
  get inMatch() {
    return this.started;
  }
  async open() {
    this.ctx.game.state = 'worldMenu';
    this.render();
    try {
      this.worlds = await this.api.call();
    } catch (error) {
      this.error = `${error.message}。加入朋友的世界不需要本机生成服务。`;
    }
    if (!this.disposed) this.render();
  }
  report(message) {
    this.error = message;
    this.render();
  }
  render() {
    if (this.disposed) return;
    this.updateHUD();
    if (this.started && ['play', 'dying'].includes(this.ctx.game.state)) return;
    this.ctx.hud.setGameplayVisible(false);
    this.show({
      kind: 'world',
      stage: this.stage,
      info: this.info,
      worlds: this.worlds,
      host: this.isHost,
      roomCode: this.net.connected ? this.net.code : null,
      players: [...this.players.values()].map(actorData),
      error: this.error,
      busy: this.busy,
      canEnter:
        !!this.chunks?.loaded.has(
          keyOf(this.players.get(this.selfId)?.pos.cx, this.players.get(this.selfId)?.pos.cz),
        ) &&
        (!this.isHost ||
          this.info?.schemaVersion === 2 ||
          [...this.chunks.loaded.values()].some((c) => c.block.layout.buildings.length > 0)),
      saving: this.saving,
      unsaved: this.unsaved.length,
      pausedGeneration: this.progress?.generationPaused ?? false,
      generated: [...this.manifest].filter(
        (k) => this.info?.schemaVersion !== 2 || outdoors(...k.split(',').map(Number)),
      ).length,
      prefs: this.prefs,
      actions: {
        create: (name, playerName) => this.host(null, name, playerName),
        load: (id, playerName) => this.host(id, null, playerName),
        join: (code, name) => this.join(code, name),
        invite: () => this.invite(),
        resume: this.resume,
        exit: () => this.leave(),
        settings: this.settings,
        generation: () => this.save(() => ({ generationPaused: !this.progress.generationPaused })),
        retry: () => this.retry(),
      },
    });
  }
  attach(info) {
    requireWorld(
      info && [SCHEMA, 2].includes(info.schemaVersion) && info.generatorVersion === GENERATOR,
      '世界版本不兼容',
    );
    this.info = info;
    this.ctx.enemies.clear();
    this.ctx.effects.clear();
    this.pickups.clear();
    this.ctx.player.clearNades();
    disposeTree(this.mapRoot);
    this.ctx.world.clear();
    this.ctx.level = {
      key: 'district',
      playerStart: new THREE.Vector3(64, 0, 64),
      bounds: { minX: 0, maxX: SIZE, minZ: 0, maxZ: SIZE },
      rings: [],
      spawns: [],
      snipers: [],
      pickups: [],
      animated: [],
      grappleMovers: [],
      breakables: [],
    };
    this.chunks = new Chunks(this.ctx);
    this.scenes = new BuildingScenes(this);
    this.reset();
    this.ctx.player.maxHp = 110;
    this.ctx.player.hp = 110;
    this.ctx.player.yaw = info.schemaVersion === 2 ? 0.6 : 0;
    this.ctx.player._updateCamera(0);
    this.stage = 'ready';
    this.ctx.game.state = 'worldReady';
  }
  newActor(id, name, pos) {
    validateName(name);
    return {
      id,
      name,
      ink: allocateInk(this.players?.values() ?? []),
      pos,
      yaw: 0,
      pitch: 0,
      weapon: 0,
      flags: 64,
      velocity: [0, 0, 0],
      hook: null,
      hp: 110,
      life: 1,
      sceneId: this.scenes ? 'outdoor' : undefined,
      epoch: 0,
      active: false,
      reward: 0,
      hurtAt: 0,
      respawnAt: null,
      loaded: new Set(),
      sent: new Map(),
      seq: 0,
      at: performance.now(),
      shotAt: -10,
      meleeAt: -10,
      grenadeAt: -10,
      grenades: 3,
    };
  }
  async host(id, name, playerName) {
    if (this.busy || this.info) return;
    const generation = ++this.generation;
    this.busy = true;
    this.error = '';
    this.render();
    try {
      validateName(playerName);
      const info = id
        ? { id }
        : await this.api.call('', 'POST', { name, schemaVersion: 1, aiGenerated: true });
      const data = await this.api.call(`/${info.id}/lease`, 'POST');
      if (this.disposed || generation !== this.generation) {
        await this.api.call(`/${info.id}/lease`, 'DELETE');
        return;
      }
      this.isHost = true;
      this.selfId = 'host';
      this.progress = data.progress;
      this.manifest = new Set(data.manifest);
      this.attach(data.info);
      this.players.set(this.selfId, this.newActor(this.selfId, playerName, this.progress.safePosition));
      this.heartbeat = setInterval(() => {
        void this.api.call(`/${this.info.id}/lease`, 'POST', { renew: true }).catch((e) => {
          this.started = false;
          clearInterval(this.heartbeat);
          this.net.close();
          this.ctx.game.state = 'worldMenu';
          this.ctx.input.exitLock();
          this.stage = 'disconnected';
          this.report(`房主会话失效：${e.message}`);
        });
      }, 10000);
      await this.load(0, 0);
      const p = this.progress.safePosition;
      await this.load(p.cx, p.cz);
      if (this.disposed) return;
      this.chunks.origin = [p.cx, p.cz];
      this.chunks.rebuild();
      this.ctx.player.reset(this.chunks.position(p));
      this.ctx.player.yaw = this.scenes ? 0.6 : 0;
      this.ctx.player._updateCamera(0);
      this.ctx.level.playerStart.copy(this.chunks.position(p));
      await this.loadNeighborhood(p);
      // Prepare visible, populated land before entering, including old empty-camp saves.
      if (this.info.schemaVersion === 1 && !this.progress.generationPaused)
        await Promise.all(
          [
            [0, -1],
            [1, 0],
          ].map(([dx, dz]) => {
            const x = p.cx + dx,
              z = p.cz + dz;
            return this.load(x, z, !this.manifest.has(keyOf(x, z)));
          }),
        );
    } catch (error) {
      this.report(error.message);
    } finally {
      this.busy = false;
      if (!this.disposed) this.render();
    }
  }
  async invite() {
    if (this.busy || this.net.connected || !this.isHost) return;
    this.busy = true;
    this.error = '';
    this.render();
    try {
      await this.net.open({ name: this.players.get(this.selfId).name });
    } catch (error) {
      this.report(error.message);
    } finally {
      this.busy = false;
      this.render();
    }
  }
  async join(code, name) {
    if (this.busy || this.info) return;
    this.busy = true;
    this.error = '';
    this.render();
    try {
      await this.net.open({ code, name });
      this.selfId = this.net.id;
    } catch (error) {
      this.report(error.message);
    } finally {
      this.busy = false;
      this.render();
    }
  }
  addGuest(id, name) {
    requireWorld(this.isHost && this.info, '房主尚未打开世界');
    const record = this.newActor(id, name, { cx: 0, cz: 0, x: 64, y: 0, z: 64 });
    this.players.set(id, record);
    this.packets.post(id, 'world', {
      info: this.info,
      selfId: id,
      host: actorData(this.players.get(this.selfId)),
      self: actorData(record),
      generationPaused: this.progress.generationPaused,
    });
    void this.sendChunk(id, 0, 0).catch((e) => this.report(e.message));
    this.render();
  }
  async sendChunk(id, x, z) {
    const p = this.players.get(id),
      key = coordinates(x, z);
    if (!p || p.sent.has(key)) return;
    p.sent.set(key, null);
    try {
      const item = this.chunks.loaded.get(key);
      const block = item?.block ?? (await this.api.call(`/${this.info.id}/chunk/${key}`));
      if (!this.players.has(id) || !this.net.connections.has(id)) return;
      p.sent.set(key, block.checksum);
      this.packets.post(id, 'chunk', {
        block,
        progress: this.stateFor(key),
        respawn: p.respawnTarget ?? null,
      });
    } catch (error) {
      p.sent.delete(key);
      throw error;
    }
  }
  async receive(type, data, from) {
    if (this.disposed) return;
    if (this.isHost) {
      const p = this.players.get(from);
      requireWorld(p, '世界中没有该玩家');
      if (this.scenes && ['interact', 'scene-loaded', 'scene-cancel'].includes(type)) {
        await this.scenes.receive(type, data, from);
        return;
      }
      if (type === 'state') this.acceptState(p, data);
      else if (type === 'loaded') {
        const key = coordinates(data.x, data.z);
        if (!p.sent.has(key)) return; // A late acknowledgement can follow an unload.
        requireWorld(p.sent.get(key) === data.checksum, '区块加载确认无效');
        p.loaded.add(key);
      } else if (type === 'unloaded') {
        const key = coordinates(data.x, data.z);
        p.loaded.delete(key);
        p.sent.delete(key);
      } else if (type === 'need') {
        coordinates(data.x, data.z);
        requireWorld(nearby(p.pos, { cx: data.x, cz: data.z }), '只能请求玩家附近区域');
        requireWorld(this.manifest.has(keyOf(data.x, data.z)), '访客不能直接请求生成未知地图');
        await this.sendChunk(from, data.x, data.z);
      } else if (type === 'ready') {
        requireWorld(p.loaded.has(keyOf(p.pos.cx, p.pos.cz)), '出生区域尚未加载');
        p.active = true;
        if (!this.started) {
          this.started = true;
          this.stage = 'pause';
          this.ctx.game.state = 'pause';
          this.ctx.game.menu = true;
          this.render();
        }
      } else if (type === 'action') this.action(from, data);
      else throw new Error('不允许访客发送该世界消息');
      return;
    }
    requireWorld(from === this.net.connections.keys().next().value, '世界消息并非来自房主');
    if (this.scenes && ['scene-prepare', 'scene-commit', 'scene-error'].includes(type)) {
      await this.scenes.receive(type, data, from);
      return;
    }
    if (type === 'world') {
      requireWorld(!this.info && data.selfId === this.net.id, '世界握手无效');
      this.selfId = data.selfId;
      this.attach(data.info);
      this.progress = { chunks: {}, runs: {}, generationPaused: data.generationPaused };
      for (const p of [data.self, data.host]) {
        validateActor(p, this.info);
        this.players.set(p.id, p);
      }
      this.render();
    } else if (type === 'chunk') {
      requireWorld(this.info, '尚未收到世界信息');
      const b = data.block;
      if (data.respawn) this.players.get(this.selfId).respawnTarget = validAddress(data.respawn);
      const layout = validateWorldLayout(b.layout, this.info, b.x, b.z);
      requireWorld((await checksum(layout)) === b.checksum, '收到的地图校验失败');
      this.manifest.add(keyOf(b.x, b.z));
      this.setState(keyOf(b.x, b.z), data.progress);
      await this.chunks.add(b);
      this.packets.post(from, 'loaded', { x: b.x, z: b.z, checksum: b.checksum });
      this.requests.delete(keyOf(b.x, b.z));
      this.render();
    } else if (type === 'snapshot') this.applySnapshot(data);
    else if (type === 'grenade') {
      validAddress(data.pos);
      this.ctx.player.throwGrenade({ pos: this.chunks.position(data.pos).toArray(), vel: data.vel });
    } else throw new Error('未知世界消息');
  }
  packLocal() {
    const p = this.ctx.player,
      s = encodeLocal(p, p.weaponIndex),
      old = this.players.get(this.selfId);
    return {
      ...actorData(old),
      pos: this.chunks.address(p.body.pos),
      yaw: s[3],
      pitch: s[4],
      weapon: s[5],
      flags: s[6],
      velocity: s.slice(8, 11),
      hook: s.length === 14 ? this.chunks.address(new THREE.Vector3(...s.slice(11))) : null,
    };
  }
  acceptState(p, state) {
    validateActor(state, this.info);
    requireWorld(state.id === p.id, '玩家身份不匹配');
    if (this.scenes && state.epoch !== p.epoch) return;
    if (this.scenes)
      requireWorld(
        state.sceneId === p.sceneId && sceneOf(state.pos, this.info) === p.sceneId,
        '玩家不能自行跨场景',
      );
    if (state.life < p.life) return;
    requireWorld(state.life === p.life, '玩家生命序号不匹配');
    if (!p.active || p.hp <= 0) return;
    const pos = this.chunks.position(state.pos),
      old = this.chunks.position(p.pos);
    const dt = Math.min(1, Math.max(0.05, (performance.now() - p.at) / 1000));
    requireWorld(pos.distanceTo(old) <= 120 * dt + 5, '玩家移动距离无效');
    requireWorld(p.loaded.has(keyOf(state.pos.cx, state.pos.cz)), '玩家进入了未确认加载的区域');
    const displacement = pos.clone().sub(old),
      distance = displacement.length();
    if (distance > 0.01) {
      const body = makeBody(old, 0.35, state.flags & 1 ? 1.05 : 1.75);
      body.vel.copy(displacement).divideScalar(dt);
      body.noSnap = true;
      for (let i = 0, steps = Math.ceil(dt / 0.05); i < steps; i++) this.ctx.world.moveBody(body, dt / steps);
      requireWorld(body.pos.distanceTo(pos) < 1.2, '玩家穿过了障碍物或未生成区域');
    }
    if (state.flags & 4 && !(p.flags & 4)) p.blockSince = this.ctx.game.time;
    Object.assign(p, {
      pos: state.pos,
      yaw: state.yaw,
      pitch: state.pitch,
      flags: state.flags,
      weapon: state.weapon,
      velocity: state.velocity,
      hook: state.hook,
      at: performance.now(),
    });
    this.remote(p, 0);
  }
  ready() {
    requireWorld(this.info && this.chunks?.loaded.size, '请先创建或加入世界并等待营地加载');
    this.started = true;
    this.stage = 'pause';
    if (this.isHost) this.players.get(this.selfId).active = true;
    else this.packets.post(this.net.connections.keys().next().value, 'ready', {});
    this.overlay.hidden = false;
    if (!this.overlay.parentElement) this.ctx.input.canvas?.parentElement?.append(this.overlay);
    if (this.isHost) this.bootstrapQuests();
  }
  questsState() {
    if (!this.progress) return defaultQuests();
    if (!this.progress.quests) this.progress.quests = defaultQuests();
    return this.progress.quests;
  }
  commitQuests(result) {
    if (!result?.quests || !this.isHost) return;
    const tip = result.tip;
    const next = validateQuests(result.quests);
    const changed = JSON.stringify(this.progress.quests ?? null) !== JSON.stringify(next);
    if (changed) this.progress.quests = next;
    if (changed && this.info?.id && this.api) {
      void this.save(
        () => ({ quests: next }),
        () => {
          if (tip) this.ctx.hud.tip(tip, 5);
        },
      );
    } else if (tip) this.ctx.hud.tip(tip, 5);
  }
  bootstrapQuests() {
    const q = this.questsState();
    if (q.active || q.completed.length) return;
    this.commitQuests({ quests: startQuest(q, 'Q0', this.progress), tip: QUESTS.Q0.brief });
  }
  talkCamp(confirmEnding = false) {
    if (!this.isHost) return;
    this.commitQuests(onCampInteract(this.questsState(), this.progress, { confirmEnding }));
  }
  advanceQuestAfterClear(warehouse) {
    const q = this.questsState();
    const rooftop = q.active === 'Q5' && (q.flags.roofTouch || (this.ctx.player.body?.pos.y ?? 0) > 5);
    let result;
    if (q.active === 'Q2' && (warehouse || this.info?.schemaVersion === 1))
      result = onClear(q, this.progress, { warehouse: true });
    else if (q.active === 'Q5') result = onClear(q, this.progress, { rooftop });
    else result = onClear(q, this.progress, { warehouse });
    this.commitQuests(result);
  }
  spawnQuestBoss() {
    if (!this.isHost || !this.chunks) return;
    const q = this.questsState();
    const def = QUESTS[q.active];
    if (def?.kind !== 'boss' || q.flags.bossSpawned) return;
    const self = this.players.get(this.selfId);
    if (!self?.active || self.hp <= 0 || self.sceneId !== 'outdoor') return;
    const key = keyOf(self.pos.cx, self.pos.cz);
    if (key === '0,0') return;
    const item = this.chunks.loaded.get(key);
    if (!item?.block.layout.outpost) return;
    const id = `quest:${q.active}`;
    if (this.ctx.enemies.byId.has(id)) return;
    const [x, z] = item.block.layout.outpost.center;
    const e = this.ctx.enemies.spawn(
      def.boss,
      this.chunks.position({ cx: item.x, cz: item.z, x, y: 0, z }),
      id,
    );
    e.chunk = key;
    e.sceneId = 'outdoor';
    e.questBoss = true;
    q.flags.bossSpawned = true;
    q.flags.targetChunk = key;
    this.commitQuests({
      quests: validateQuests({ ...q, flags: { ...q.flags } }),
    });
  }
  tickQuestBoss() {
    const q = this.questsState();
    const boss = [...this.ctx.enemies.byId.values()].find((e) => e.questBoss && e.alive);
    if (boss) this.ctx.hud.setBoss(boss.T.name, boss.hp / boss.maxHp);
    else if (QUESTS[q.active]?.kind === 'boss') this.ctx.hud.setBoss(null, null);
    if (q.active === 'Q5' && (this.ctx.player.body?.pos.y ?? 0) > 5) q.flags.roofTouch = true;
    if (q.active !== 'Q3' || q.flags.bossFled) return;
    const e = this.ctx.enemies.byId.get('quest:Q3');
    if (!e?.alive || e.hp > e.maxHp * 0.45) return;
    e.questFlee = true;
    this.ctx.enemies.kill(e, { source: 'quest-flee', dir: new THREE.Vector3(0, 1, 0) });
  }
  async load(x, z, generate = false) {
    const key = coordinates(x, z);
    if (this.chunks.loaded.has(key)) return this.chunks.loaded.get(key);
    if (this.requests.has(key)) return this.requests.get(key);
    const generation = this.generation;
    const promise = (async () => {
      const block = await this.api.call(`/${this.info.id}/chunk/${key}`, generate ? 'POST' : 'GET');
      if (this.disposed || generation !== this.generation) return;
      await this.chunks.add(block);
      this.manifest.add(key);
      this.failed.delete(key);
      const p = this.players.get(this.selfId);
      if (p) p.loaded.add(key);
      return this.chunks.loaded.get(key);
    })()
      .catch((error) => {
        this.failed.set(key, error.message);
        this.report(`区域 ${key}：${error.message}`);
      })
      .finally(() => this.requests.delete(key));
    this.requests.set(key, promise);
    return promise;
  }
  async loadNeighborhood(p) {
    for (let x = p.cx - 1; x <= p.cx + 1; x++)
      for (let z = p.cz - 1; z <= p.cz + 1; z++) {
        const key = keyOf(x, z);
        if (this.manifest.has(key)) await this.load(x, z);
      }
  }
  frontier(p) {
    if (!p.active || (this.scenes && p.sceneId !== 'outdoor')) return;
    const delta = [];
    // Start at the centre, not only after pressing into an unloaded edge. Load
    // cardinals before diagonals so every new request has a persisted neighbour.
    for (const d of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ])
      delta.push(d);
    if (this.info?.schemaVersion !== 2) delta.push([-1, -1], [1, -1], [-1, 1], [1, 1]);
    delta.sort(
      (a, b) =>
        Math.hypot((a[0] + 0.5) * SIZE - p.pos.x, (a[1] + 0.5) * SIZE - p.pos.z) -
        Math.hypot((b[0] + 0.5) * SIZE - p.pos.x, (b[1] + 0.5) * SIZE - p.pos.z),
    );
    for (const [dx, dz] of delta) {
      const x = p.pos.cx + dx,
        z = p.pos.cz + dz,
        key = keyOf(x, z);
      if (this.info?.schemaVersion === 2 && !outdoors(x, z)) continue;
      if (this.failed.has(key) || this.requests.has(key) || this.chunks.loaded.has(key)) continue;
      if (
        !this.manifest.has(key) &&
        ![
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([ox, oz]) => this.manifest.has(keyOf(x + ox, z + oz)))
      )
        continue;
      if (!this.manifest.has(key) && (this.progress.generationPaused || this.requests.size >= 4)) continue;
      void this.load(x, z, !this.manifest.has(key))
        .then(() => {
          if (p.id !== this.selfId && this.chunks.loaded.has(key)) return this.sendChunk(p.id, x, z);
        })
        .catch((e) => this.report(e.message));
    }
  }
  sameLocalScene(position) {
    return sceneOf(this.chunks.address(position), this.info) === this.players.get(this.selfId)?.sceneId;
  }
  targets(position) {
    return [...this.players.values()]
      .filter(
        (p) =>
          p.active &&
          p.hp > 0 &&
          (!this.scenes || !position || p.sceneId === sceneOf(this.chunks.address(position), this.info)),
      )
      .map((p) => (p.id === this.selfId ? this.ctx.player : this.remotes.get(p.id)))
      .filter(Boolean);
  }
  pickTarget(e) {
    const candidates = this.targets().filter(
      (p) => keyOf(this.chunks.address(p.body.pos).cx, this.chunks.address(p.body.pos).cz) === e.chunk,
    );
    candidates.sort(
      (a, b) => a.body.pos.distanceToSquared(e.body.pos) - b.body.pos.distanceToSquared(e.body.pos),
    );
    return candidates[0] ?? { alive: false, body: e.body, center: e.center };
  }
  remote(p, dt) {
    if (p.id === this.selfId) return;
    let r = this.remotes.get(p.id);
    if (!r) {
      r = new RemotePlayer(this.ctx, p.id, p.name, 0, p.ink ?? INK.GREEN);
      r.onDamage = (_target, amount, from) => this.damagePlayer(p.id, amount, from);
      r.tryDeflect = (projectile) => {
        const player = this.players.get(p.id),
          time = this.ctx.game.time;
        if (!this.isHost || !player || !(player.flags & 4) || (player.blockUntil ?? 0) > time) return false;
        if (projectile.vel.clone().normalize().negate().dot(r.forward) < 0.55) return false;
        player.blockUntil = time + 0.19;
        const perfect = time - (player.blockSince ?? -1) < 0.26;
        return { ret: perfect || Math.random() < 0.35, perfect };
      };
      this.remotes.set(p.id, r);
    }
    const pos = this.chunks.position(p.pos),
      flags = (p.flags & ~64 & ~128) | (p.hp > 0 ? 64 : 0) | (p.hook ? 128 : 0);
    const snap = [...pos.toArray(), p.yaw, p.pitch, p.weapon, flags, Math.ceil(p.hp), ...p.velocity];
    if (p.hook) snap.push(...this.chunks.position(p.hook).toArray());
    if (r.lastState !== p || r.lastStateAt !== p.at || r.hp !== Math.ceil(p.hp)) {
      r.push(snap, performance.now() / 1000);
      r.lastState = p;
      r.lastStateAt = p.at;
    }
    r.update(dt, performance.now() / 1000);
    if (this.isHost) {
      // Enemy hits use the accepted position; interpolation only controls drawing.
      r.body.pos.copy(pos);
      r.center.copy(pos).add(new THREE.Vector3(0, p.flags & 1 ? 0.52 : 0.9, 0));
      r.eye.copy(pos).add(new THREE.Vector3(0, p.flags & 1 ? 0.88 : 1.6, 0));
    }
    r.root.visible =
      p.active &&
      nearby(p.pos, this.chunks.address(this.ctx.player.body.pos)) &&
      (!this.scenes || p.sceneId === this.players.get(this.selfId)?.sceneId);
    if (!r.root.visible) {
      r.rope.visible = false;
      r.hook.visible = false;
    }
  }
  removeRemote(id) {
    this.remotes.get(id)?.dispose();
    this.remotes.delete(id);
  }
  stateFor(key, progress = this.progress) {
    const b = this.info?.schemaVersion === 2 && buildingAt(...key.split(',').map(Number));
    return b
      ? (progress?.runs?.[b.id] ?? { ...freshProgress(), runId: 1 })
      : (progress?.chunks?.[key] ?? {
          ...freshProgress(),
          ...(this.chunks?.loaded.get(key)?.block.layout.outpost?.encounterVersion === 1
            ? { total: this.chunks.loaded.get(key).block.layout.outpost.spawns.length }
            : {}),
        });
  }
  setState(key, state) {
    const b = this.info?.schemaVersion === 2 && buildingAt(...key.split(',').map(Number));
    const total = this.chunks?.loaded.get(key)?.block.layout.outpost?.spawns.length;
    const valid = validateProgress(state, total ?? state?.total ?? 4);
    if (b) {
      requireWorld(Number.isSafeInteger(state.runId) && state.runId > 0, '挑战轮次无效');
      this.progress.runs[b.id] = { ...valid, runId: state.runId };
    } else this.progress.chunks[key] = valid;
  }
  spawnOutposts() {
    for (const item of this.chunks.loaded.values()) {
      if (
        !item.block.layout.outpost ||
        ![...this.players.values()].some(
          (p) =>
            p.active &&
            p.hp > 0 &&
            (!this.scenes || p.sceneId === (item.block.layout.sceneId ?? 'outdoor')) &&
            (item.block.layout.outpost.encounterVersion === 1 ||
              (keyOf(p.pos.cx, p.pos.cz) === item.key &&
                Math.hypot(
                  p.pos.x - item.block.layout.outpost.center[0],
                  p.pos.z - item.block.layout.outpost.center[1],
                ) < 48)),
        )
      )
        continue;
      const defeated = new Set([
        ...(this.stateFor(item.key).defeated ?? []),
        ...(this.pendingKills.get(item.key) ?? []),
      ]);
      const outpost = item.block.layout.outpost;
      const staggered = outpost.encounterVersion === 1;
      const now = this.ctx.game?.time ?? 0;
      for (let index = 0; index < outpost.spawns.length; index++) {
        const run = this.stateFor(item.key).runId;
        const id = `${item.key}:${run ?? 0}:${index}`;
        if (defeated.has(index) || this.ctx.enemies.byId.has(id)) continue;
        const [x, z] = outpost.spawns[index];
        if (staggered) {
          const roll = hash(`${this.info.seed}:${item.key}:${index}:arrival`);
          const distances = [...this.players.values()]
            .filter((p) => p.active && p.hp > 0 && (!this.scenes || p.sceneId === 'outdoor'))
            .map((p) =>
              Math.hypot(
                (p.pos.cx - item.x) * SIZE + p.pos.x - x,
                p.pos.y,
                (p.pos.cz - item.z) * SIZE + p.pos.z - z,
              ),
            );
          // Per-enemy proximity and staggered arrivals avoid a whole squad popping
          // into view at the chunk centre, or appearing on top of a player.
          if (!distances.some((d) => d <= 42 + (roll % 19)) || distances.some((d) => d < 10)) continue;
          item.spawnAt ??= new Map();
          if (!item.spawnAt.has(index)) item.spawnAt.set(index, now + 0.4 + (roll % 3600) / 1000);
          if (now < item.spawnAt.get(index) || now < (item.nextSpawnAt ?? 0)) continue;
          item.nextSpawnAt = now + 0.8 + (roll % 1400) / 1000;
        }
        const e = this.ctx.enemies.spawn(
          outpost.types?.[index] ?? ENEMY_TYPES[index],
          this.chunks.position({ cx: item.x, cz: item.z, x, y: 0, z }),
          id,
        );
        e.chunk = item.key;
        e.sceneId = item.block.layout.sceneId ?? 'outdoor';
        e.runId = run;
        e.spawnIndex = index;
      }
    }
  }
  killed(enemy) {
    if (!this.isHost) return;
    if (enemy.questBoss) {
      const fled = !!enemy.questFlee && !this.questsState().flags.bossFled;
      this.commitQuests(onBossKill(this.questsState(), this.progress, fled));
      this.ctx.hud.setBoss(null, null);
      return;
    }
    if (!enemy.chunk) return;
    if (enemy.runId && this.stateFor(enemy.chunk).runId !== enemy.runId) return;
    const pending = this.pendingKills.get(enemy.chunk) ?? new Set();
    pending.add(enemy.spawnIndex);
    this.pendingKills.set(enemy.chunk, pending);
    const key = enemy.chunk;
    const total =
      this.chunks?.loaded.get(key)?.block.layout.outpost?.spawns.length ?? this.stateFor(key).total ?? 4;
    void this.save(
      () => {
        const defeated = [
          ...new Set([...(this.stateFor(key).defeated ?? []), ...(this.pendingKills.get(key) ?? [])]),
        ];
        const b = this.info?.schemaVersion === 2 && buildingAt(...key.split(',').map(Number));
        return b
          ? { run: { buildingId: b.id, runId: enemy.runId, defeated, rewarded: defeated.length === 4 } }
          : {
              chunk: key.split(',').map(Number),
              state: { defeated, rewarded: defeated.length === total, ...(total !== 4 ? { total } : {}) },
            };
      },
      (old, current) => {
        const pending = this.pendingKills.get(key);
        if (pending) for (const id of this.stateFor(key, current).defeated) pending.delete(id);
        if (pending?.size === 0) this.pendingKills.delete(key);
        if (!this.stateFor(key, old).rewarded && this.stateFor(key, current).rewarded) {
          for (const p of this.players.values())
            if ((!this.scenes || (p.active && p.hp > 0)) && keyOf(p.pos.cx, p.pos.cz) === key) {
              p.reward++;
              p.grenades = Math.min(5, p.grenades + 1);
            }
          this.ctx.hud.tip(
            enemy.runId ? '仓库挑战完成并保存 · 奖励已领取' : '据点已清理并保存 · 安全复活点已解锁',
            4,
          );
          this.advanceQuestAfterClear(!!enemy.runId);
        }
      },
    );
  }
  save(makePatch, after) {
    if (!this.isHost || !this.info) return Promise.resolve();
    this.saving++;
    const job = async () => {
      const old = this.progress;
      try {
        const write = () =>
          this.api.call(`/${this.info.id}/progress`, 'POST', {
            ...makePatch(),
            revision: this.progress.revision,
          });
        let current;
        try {
          current = await write();
        } catch (error) {
          if (!error.message.includes('存档版本冲突')) throw error;
          this.progress = await this.api.call(`/${this.info.id}/progress`);
          current = await write();
        }
        this.progress = current;
        after?.(old, current);
      } catch (error) {
        this.unsaved.push({ makePatch, after });
        this.report(`未保存：${error.message}`);
      } finally {
        this.saving--;
        this.render();
      }
    };
    this.saves = this.saves.then(job);
    return this.saves;
  }
  retry() {
    if (!this.isHost) return;
    this.error = '';
    this.scenes?.failed.clear();
    const failed = [...this.failed.keys()];
    this.failed.clear();
    for (const key of failed) {
      const [x, z] = key.split(',').map(Number);
      if ([...this.players.values()].some((p) => nearby(p.pos, { cx: x, cz: z })))
        void this.load(x, z, !this.manifest.has(key));
    }
    const jobs = this.unsaved.splice(0);
    for (const { makePatch, after } of jobs) void this.save(makePatch, after);
    this.render();
  }
  damagePlayer(id, amount, from) {
    if (!this.isHost) return;
    requireWorld(Number.isFinite(amount) && amount >= 0, '伤害无效');
    const p = this.players.get(id);
    if (!p?.active || p.hp <= 0 || (p.shieldUntil ?? 0) > this.ctx.game.time) return;
    p.hp = Math.max(0, p.hp - amount);
    p.hurtAt = this.ctx.game.time;
    if (id === this.selfId) {
      this.applyingDamage = true;
      try {
        this.ctx.player.takeDamage(amount, from);
      } finally {
        this.applyingDamage = false;
      }
    }
    if (p.hp === 0) p.respawnAt = this.ctx.game.time + 2.5;
  }
  nearestSafe(pos) {
    const b = this.info?.schemaVersion === 2 && buildingAt(pos.cx, pos.cz);
    if (b) pos = doorPosition(b);
    let result = { cx: 0, cz: 0, x: 64, y: 0, z: 64 },
      best = Infinity;
    for (const candidate of [
      result,
      ...Object.values(this.progress.chunks)
        .filter((p) => outpostComplete(p) && p.safePosition)
        .map((p) => p.safePosition),
    ]) {
      const distance = this.chunks.position(candidate).distanceToSquared(this.chunks.position(pos));
      if (distance < best) {
        best = distance;
        result = candidate;
      }
    }
    return result;
  }
  respawn(p) {
    if (p.respawning) return;
    p.respawning = true;
    const point = this.nearestSafe(p.pos);
    p.respawnTarget = point;
    if (this.failed.has(keyOf(point.cx, point.cz))) {
      p.respawning = false;
      return;
    }
    void this.load(point.cx, point.cz)
      .then(async (loaded) => {
        if (this.disposed) return;
        if (!loaded) {
          p.respawning = false;
          return;
        }
        if (p.id !== this.selfId && !p.loaded.has(keyOf(point.cx, point.cz))) {
          await this.sendChunk(p.id, point.cx, point.cz);
          p.respawning = false;
          return;
        }
        Object.assign(p, {
          pos: point,
          sceneId: this.scenes ? 'outdoor' : undefined,
          epoch: (p.epoch ?? 0) + 1,
          transition: null,
          hp: 110,
          life: p.life + 1,
          seq: 0,
          grenades: 3,
          respawnAt: null,
          respawning: false,
          respawnTarget: null,
          shieldUntil: this.ctx.game.time + 2,
          at: performance.now(),
        });
        if (p.id === this.selfId) {
          this.ctx.player.reset(this.chunks.position(point));
          if (this.ctx.game.state === 'dying') this.ctx.game.state = this.ctx.game.menu ? 'pause' : 'play';
        }
      })
      .catch((e) => {
        p.respawning = false;
        this.report(e.message);
      });
  }
  sendAction(action, data = {}) {
    if (!this.started || !this.ctx.player.alive) return;
    const record = this.players.get(this.selfId);
    const payload = {
      action,
      ...data,
      seq: ++this.seq,
      life: record.life,
      epoch: record.epoch,
      sceneId: record.sceneId,
    };
    if (this.isHost) {
      Object.assign(record, this.packLocal());
      this.action(this.selfId, payload);
    } else {
      this.packets.post(this.net.connections.keys().next().value, 'state', this.packLocal());
      this.packets.post(this.net.connections.keys().next().value, 'action', payload);
    }
  }
  shot(kind, origin, dirs) {
    this.sendAction('shot', {
      kind,
      origin: this.chunks.address(origin),
      dirs: dirs.map((d) => d.toArray()),
    });
  }
  melee() {
    this.sendAction('melee');
  }
  grenade(data) {
    this.sendAction('grenade', { pos: this.chunks.address(new THREE.Vector3(...data.pos)), vel: data.vel });
  }
  fall() {
    if (this.isHost) this.damagePlayer(this.selfId, 110);
    else this.sendAction('fall');
  }
  take() {
    /* World supplies are awarded only by saved outpost completion. */
  }
  raycast() {
    return null;
  }
  action(id, a) {
    const p = this.players.get(id),
      time = this.ctx.game.time;
    if (this.scenes && (a?.epoch !== p.epoch || a.sceneId !== p.sceneId)) return;
    requireWorld(a && Number.isSafeInteger(a.seq) && a.seq > 0 && Number.isInteger(a.life), '战斗序号无效');
    if (!p.active || p.hp <= 0 || a.life < p.life || a.seq <= p.seq) return;
    requireWorld(a.life === p.life, '战斗生命序号无效');
    p.seq = a.seq;
    const eye = this.chunks.position(p.pos);
    eye.y += p.flags & 1 ? 0.88 : 1.6;
    const forward = new THREE.Vector3(
      -Math.sin(p.yaw) * Math.cos(p.pitch),
      Math.sin(p.pitch),
      -Math.cos(p.yaw) * Math.cos(p.pitch),
    );
    if (a.action === 'shot') {
      const weapon = Object.hasOwn(GUNS, a.kind) && GUNS[a.kind];
      requireWorld(weapon && ['rifle', 'shotgun', 'sniper'][p.weapon] === a.kind, '射击武器无效');
      validAddress(a.origin);
      requireWorld(Array.isArray(a.dirs) && a.dirs.length === weapon.pellets, '弹道数量无效');
      const origin = this.chunks.position(a.origin);
      requireWorld(origin.distanceTo(eye) < 5, '射击起点无效');
      for (const dir of a.dirs)
        requireWorld(
          Array.isArray(dir) &&
            dir.length === 3 &&
            dir.every(Number.isFinite) &&
            Math.abs(Math.hypot(...dir) - 1) < 0.01,
          '射击方向无效',
        );
      if (time - p.shotAt < Math.max(weapon.interval, weapon.cycleDur ?? 0) * 0.8) return;
      p.shotAt = time;
      for (const values of a.dirs) {
        const dir = new THREE.Vector3(...values),
          wall = this.ctx.world.raycast(origin, dir, 300, SEE_THROUGH);
        const hit = this.ctx.enemies.raycast(origin, dir, wall ? wall.dist : 300);
        if (hit && (!this.scenes || hit.enemy.sceneId === p.sceneId)) {
          let damage = weapon.damage * (hit.part === 'head' ? weapon.headMul : 1);
          if (weapon.falloff)
            damage *= Math.max(
              weapon.falloff[2],
              Math.min(1, 1 - (hit.dist - weapon.falloff[0]) / (weapon.falloff[1] - weapon.falloff[0])),
            );
          this.ctx.enemies.damage(hit.enemy, damage, {
            point: hit.point,
            dir,
            part: hit.part,
            source: a.kind,
            crit: hit.part === 'head',
          });
        }
      }
    } else if (a.action === 'melee') {
      if (time - p.meleeAt < 0.3) return;
      p.meleeAt = time;
      for (const hit of this.ctx.enemies.inArc(eye, forward, 3, Math.cos(0.95))) {
        if (this.scenes && hit.enemy.sceneId !== p.sceneId) continue;
        if (!this.ctx.world.hasLineOfSight(eye, hit.enemy.center, SEE_THROUGH)) continue;
        this.ctx.enemies.damage(hit.enemy, 75, {
          point: hit.enemy.center,
          dir: forward,
          part: 'torso',
          source: 'katana',
          crit: false,
        });
      }
    } else if (a.action === 'grenade') {
      validAddress(a.pos);
      const pos = this.chunks.position(a.pos);
      requireWorld(
        pos.distanceTo(eye) < 5 &&
          Array.isArray(a.vel) &&
          a.vel.length === 3 &&
          a.vel.every((v) => Number.isFinite(v) && Math.abs(v) <= 70),
        '手雷无效',
      );
      if (time - p.grenadeAt < 0.5 || p.grenades <= 0) return;
      p.grenadeAt = time;
      p.grenades--;
      this.grenades.push({ owner: id, sceneId: p.sceneId, pos, vel: new THREE.Vector3(...a.vel), fuse: 1.7 });
      for (const [otherId, other] of this.players)
        if (otherId !== this.selfId && otherId !== id && nearby(other.pos, p.pos))
          this.packets.post(otherId, 'grenade', { pos: a.pos, vel: a.vel });
      if (id !== this.selfId && (!this.scenes || p.sceneId === this.players.get(this.selfId).sceneId))
        this.ctx.player.throwGrenade({ pos: pos.toArray(), vel: a.vel });
    } else if (a.action === 'yank') {
      requireWorld(typeof a.enemy === 'string' && a.enemy.length < 50, '钩索目标无效');
      const enemy = this.ctx.enemies.byId.get(a.enemy);
      if (!enemy?.alive || (this.scenes && enemy.sceneId !== p.sceneId) || time - (p.yankAt ?? -10) < 0.8)
        return;
      if (enemy.center.distanceTo(eye) > 50 || !this.ctx.world.hasLineOfSight(eye, enemy.center, SEE_THROUGH))
        return;
      p.yankAt = time;
      this.ctx.enemies.yank(enemy, eye, true);
    } else if (a.action === 'fall') this.damagePlayer(id, 110);
    else throw new Error('未知战斗动作');
  }
  updateGrenades(dt) {
    for (const g of this.grenades) {
      g.fuse -= dt;
      g.vel.y -= 22 * dt;
      const delta = g.vel.clone().multiplyScalar(dt),
        length = delta.length();
      const hit =
        length > 0 ? this.ctx.world.raycast(g.pos, delta.divideScalar(length), length + 0.16) : null;
      if (hit) {
        g.pos.copy(hit.point).addScaledVector(hit.normal, 0.16);
        const vn = g.vel.dot(hit.normal);
        if (vn < 0) g.vel.addScaledVector(hit.normal, -1.45 * vn).multiplyScalar(0.55);
      } else g.pos.addScaledVector(g.vel, dt);
      if (g.fuse <= 0) {
        for (const e of this.ctx.enemies.enemies) {
          const distance = e.center.distanceTo(g.pos);
          if (
            e.alive &&
            (!this.scenes || e.sceneId === g.sceneId) &&
            distance < 6.4 &&
            this.ctx.world.hasLineOfSight(g.pos, e.center, SEE_THROUGH)
          )
            this.ctx.enemies.damage(e, 120 * (1 - (distance / 6.4) * 0.6), {
              point: e.center,
              dir: e.center.clone().sub(g.pos).normalize(),
              source: 'blast',
              part: 'torso',
            });
        }
      }
    }
    this.grenades = this.grenades.filter((g) => g.fuse > 0);
  }
  snapshot(id) {
    const p = this.players.get(id);
    const relevant = (pos) =>
      nearby(p.pos, this.chunks.address(pos)) &&
      (!this.scenes || sceneOf(this.chunks.address(pos), this.info) === p.sceneId);
    const enemies = this.ctx.enemies.enemies
      .filter((e) => e.alive && relevant(e.body.pos))
      .map((e) => ({
        id: e.id,
        type: e.type,
        chunk: e.chunk,
        runId: e.runId,
        sceneId: e.sceneId,
        pos: this.chunks.address(e.body.pos),
        yaw: e.yaw,
        hp: e.hp,
      }));
    const bullets = this.ctx.enemies.projectiles.list
      .filter((b) => relevant(b.pos))
      .slice(0, 64)
      .map((b) => ({
        id: b.id,
        pos: this.chunks.address(b.pos),
        vel: b.vel.toArray(),
        life: b.life,
        ink: b.ink,
      }));
    const chunks = [...this.chunks.loaded.values()]
      .filter((c) => !c.block.layout.interiorVersion && nearby(p.pos, { cx: c.x, cz: c.z }))
      .map((c) => ({ key: c.key, state: this.stateFor(c.key) }));
    return {
      revision: ++this.snapshotRevision,
      sceneId: p.sceneId,
      epoch: p.epoch,
      players: [...this.players.values()].map(actorData),
      enemies,
      bullets,
      chunks,
      generationPaused: this.progress.generationPaused,
      generating: [...this.requests.keys()].some((key) => {
        const [cx, cz] = key.split(',').map(Number);
        return nearby(p.pos, { cx, cz });
      }),
      saving: this.saving > 0,
      unsaved: this.unsaved.length > 0,
      error: this.error.slice(0, 500),
    };
  }
  applySnapshot(s) {
    requireWorld(
      this.info &&
        Number.isSafeInteger(s.revision) &&
        Array.isArray(s.players) &&
        s.players.length <= 10 &&
        Array.isArray(s.enemies) &&
        s.enemies.length <= MAX_ENCOUNTER_ENEMIES * 9 &&
        Array.isArray(s.bullets) &&
        s.bullets.length <= 64 &&
        Array.isArray(s.chunks) &&
        s.chunks.length <= 9,
      '世界状态无效',
    );
    if (s.revision <= this.acceptedRevision) return;
    this.acceptedRevision = s.revision;
    for (const p of s.players) {
      validateActor(p, this.info);
      if (p.respawnTarget) validAddress(p.respawnTarget);
      requireWorld(
        Number.isFinite(p.hp) &&
          p.hp >= 0 &&
          p.hp <= 110 &&
          Number.isSafeInteger(p.life) &&
          p.life > 0 &&
          Number.isSafeInteger(p.reward) &&
          p.reward >= 0,
        '玩家生命或奖励无效',
      );
    }
    const self = s.players.find((p) => p.id === this.selfId);
    requireWorld(self, '世界缺少当前玩家');
    if (
      this.scenes &&
      self.life === this.players.get(this.selfId).life &&
      self.epoch !== this.players.get(this.selfId).epoch
    )
      return;
    this.appliedLife ??= this.players.get(this.selfId).life;
    this.players = new Map(s.players.map((p) => [p.id, p]));
    this.progress.generationPaused = s.generationPaused;
    requireWorld(typeof s.error === 'string' && s.error.length <= 500, '生成状态无效');
    this.error = s.error;
    this.hostStatus = { generating: !!s.generating, saving: !!s.saving, unsaved: !!s.unsaved };
    for (const c of s.chunks) {
      const pair = c.key.split(',').map(Number);
      requireWorld(pair.length === 2 && coordinates(...pair) === c.key, '区块标识无效');
      this.manifest.add(c.key);
      this.setState(c.key, c.state);
      if (!this.chunks.loaded.has(c.key) && !this.requests.has(c.key)) {
        const [x, z] = c.key.split(',').map(Number);
        this.requests.set(c.key, true);
        this.packets.post(this.net.connections.keys().next().value, 'need', { x, z });
      }
    }
    if (this.appliedLife !== self.life && this.chunks.loaded.has(keyOf(self.pos.cx, self.pos.cz))) {
      this.appliedLife = self.life;
      this.ctx.player.reset(this.chunks.position(self.pos));
      this.seq = 0;
      if (this.ctx.game.state === 'dying') this.ctx.game.state = this.ctx.game.menu ? 'pause' : 'play';
    }
    this.applyHealth(self);
    const present = new Set();
    for (const v of s.enemies) {
      if (this.scenes)
        requireWorld(
          v.sceneId === self.sceneId && sceneOf(v.pos, this.info) === self.sceneId,
          '敌人场景不匹配',
        );
      if (this.scenes && v.runId && this.stateFor(v.chunk).runId !== v.runId) continue;
      validAddress(v.pos);
      requireWorld(
        typeof v.id === 'string' &&
          ENCOUNTER_TYPES.includes(v.type) &&
          Number.isFinite(v.hp) &&
          v.hp > 0 &&
          v.hp <= TYPES[v.type].hp &&
          Number.isFinite(v.yaw),
        '敌人状态无效',
      );
      if (!this.chunks.loaded.has(keyOf(v.pos.cx, v.pos.cz))) continue;
      present.add(v.id);
      let e = this.ctx.enemies.byId.get(v.id);
      if (!e) e = this.ctx.enemies.spawn(v.type, this.chunks.position(v.pos), v.id);
      // Guests only see HP in the snapshot; a drop is the cue to play a local hit react.
      if (e.alive && v.hp < e.hp - 0.01) {
        e.flinch = Math.max(e.flinch, 1);
        e.flashT = 0.1;
        if (!e.flashOn) {
          setFill(e.mat, true);
          e.flashOn = true;
        }
        e.hitBack = 0.7;
        e.hitSide = (Math.random() - 0.5) * 1.2;
        e.hitTwist = e.hitSide * 0.5;
      }
      e.body.vel.copy(this.chunks.position(v.pos).sub(e.body.pos)).multiplyScalar(5);
      e.body.pos.copy(this.chunks.position(v.pos));
      e.yaw = v.yaw;
      e.hp = v.hp;
      e.chunk = v.chunk;
      e.sceneId = this.scenes ? sceneOf(v.pos, this.info) : 'outdoor';
      e.root.scale.setScalar(e.T.scale);
      e.state = 'hunt';
    }
    for (const e of [...this.ctx.enemies.enemies]) if (!present.has(e.id)) this.removeEnemy(e);
    this.ctx.enemies.projectiles.clear();
    for (const b of s.bullets) {
      validAddress(b.pos);
      requireWorld(
        Array.isArray(b.vel) &&
          b.vel.length === 3 &&
          b.vel.every((n) => Number.isFinite(n) && Math.abs(n) < 200) &&
          Number.isFinite(b.life) &&
          b.life > 0 &&
          b.life <= 4 &&
          Number.isFinite(b.ink),
        '敌人弹道无效',
      );
      const velocity = new THREE.Vector3(...b.vel),
        speed = velocity.length();
      if (speed > 0) {
        const bullet = this.ctx.enemies.projectiles.fire(
          this.chunks.position(b.pos),
          velocity.divideScalar(speed),
          speed,
          0,
          null,
          b.ink,
          0.045,
          0,
          b.id,
        );
        bullet.life = b.life;
      }
    }
    for (const id of this.remotes.keys()) if (!this.players.has(id)) this.removeRemote(id);
    this.render();
  }
  applyHealth(self) {
    const player = this.ctx.player;
    if (self.hp < player.hp) {
      this.applyingDamage = true;
      try {
        player.takeDamage(player.hp - self.hp, null);
      } finally {
        this.applyingDamage = false;
      }
    } else player.hp = self.hp;
    if (self.reward > (this.localReward ?? 0)) {
      player.addAmmoAll(0.4);
      player.grenades = Math.min(5, player.grenades + 1);
      this.localReward = self.reward;
    }
  }
  animateEnemies(dt) {
    for (const e of this.ctx.enemies.enemies) {
      e.t += dt;
      if (e.flashT > 0) {
        e.flashT -= dt;
        if (e.flashT <= 0 && e.flashOn) {
          setFill(e.mat, false);
          e.flashOn = false;
        }
      }
      e.flinch = damp(e.flinch, 0, 6.5, dt);
      e.root.position.copy(e.body.pos);
      e.root.rotation.y = e.yaw;
      this.ctx.enemies._animate(e, dt, this.ctx.player.center);
      this.ctx.enemies._syncHit(e);
    }
    this.ctx.enemies.projectiles.update(dt);
  }
  removeEnemy(e) {
    this.ctx.enemies._removeLaser(e);
    if (!e.rootDetached) disposeTree(e.root);
    this.ctx.enemies.byId.delete(e.id);
    const i = this.ctx.enemies.enemies.indexOf(e);
    if (i >= 0) this.ctx.enemies.enemies.splice(i, 1);
    if (e.alive) this.ctx.enemies.alive--;
  }
  maintain() {
    const actors = this.isHost ? [...this.players.values()] : [this.players.get(this.selfId)];
    const needed = new Set();
    for (const p of actors) {
      if (this.info?.schemaVersion === 1) {
        needed.add(dynamicScene(p.pos));
        if (p.transition) needed.add(dynamicScene(p.transition.target));
      }
      if (p.transition) needed.add(keyOf(p.transition.target.cx, p.transition.target.cz));
      if (p.respawnTarget) needed.add(keyOf(p.respawnTarget.cx, p.respawnTarget.cz));
      for (let x = p.pos.cx - 1; x <= p.pos.cx + 1; x++)
        for (let z = p.pos.cz - 1; z <= p.pos.cz + 1; z++) {
          const key = keyOf(x, z);
          needed.add(key);
          if (
            this.isHost &&
            this.manifest.has(key) &&
            !this.chunks.loaded.has(key) &&
            !this.requests.has(key) &&
            !this.failed.has(key)
          )
            void this.load(x, z);
          if (this.isHost && p.id !== this.selfId && this.chunks.loaded.has(key) && !p.sent.has(key))
            void this.sendChunk(p.id, x, z).catch((e) => this.report(e.message));
        }
      if (this.isHost) this.frontier(p);
    }
    for (const projectile of [
      ...this.grenades,
      ...this.ctx.enemies.projectiles.list,
      ...this.ctx.player.nades,
    ]) {
      const p = this.chunks.address(projectile.pos);
      needed.add(keyOf(p.cx, p.cz));
    }
    if (this.scenes?.prepared)
      needed.add(keyOf(this.scenes.prepared.target.cx, this.scenes.prepared.target.cz));
    if (this.info?.schemaVersion === 1 && this.scenes?.prepared)
      needed.add(dynamicScene(this.scenes.prepared.target));
    for (const key of this.pendingKills?.keys() ?? []) needed.add(key);
    let changed = false;
    for (const [key] of this.chunks.loaded) {
      if (needed.has(key) || this.saving || this.unsaved?.length) continue;
      for (const e of [...this.ctx.enemies.enemies]) if (e.chunk === key) this.removeEnemy(e);
      this.chunks.remove(key);
      if (!this.isHost && this.net.connected && !key.startsWith('house_')) {
        const [x, z] = key.split(',').map(Number);
        this.packets.post(this.net.connections.keys().next().value, 'unloaded', { x, z });
      }
      changed = true;
      for (const p of this.players.values()) {
        p.loaded?.delete(key);
        p.sent?.delete(key);
      }
    }
    if (changed) this.chunks.rebuild();
  }
  update(dt) {
    if (!this.info || !this.chunks || this.disposed) return;
    if (this.started) {
      const self = this.players.get(this.selfId);
      if (self && self.hp > 0 && this.ctx.player.body.pos.y >= -20) {
        const packed = this.packLocal();
        if (this.isHost) Object.assign(self, packed);
      }
      const oldOrigin = [...this.chunks.origin];
      this.chunks.rebase(this.ctx.player.body.pos, [this.ctx.player, ...this.remotes.values()]);
      const shift = new THREE.Vector3(
        (this.chunks.origin[0] - oldOrigin[0]) * SIZE,
        0,
        (this.chunks.origin[1] - oldOrigin[1]) * SIZE,
      );
      for (const g of this.grenades) g.pos.sub(shift);
      if (this.isHost) {
        this.spawnOutposts();
        this.spawnQuestBoss();
        this.tickQuestBoss();
        this.updateGrenades(dt);
        for (const p of this.players.values()) {
          if (p.respawnAt !== null && p.respawnAt <= this.ctx.game.time) this.respawn(p);
          if (p.hp > 0 && this.ctx.game.time - p.hurtAt > 4.5) p.hp = Math.min(110, p.hp + 11 * dt);
          if (p.id !== this.selfId) this.remote(p, dt);
        }
        for (const e of this.ctx.enemies.enemies) {
          const item = this.chunks.loaded.get(e.chunk);
          if (!item) continue;
          const min = item.root.position;
          e.body.pos.x = Math.max(min.x + 1, Math.min(min.x + SIZE - 1, e.body.pos.x));
          e.body.pos.z = Math.max(min.z + 1, Math.min(min.z + SIZE - 1, e.body.pos.z));
          e.root.visible = item.root.visible;
          if (e.laser && !item.root.visible) e.laser.visible = false;
        }
        this.applyHealth(self);
      } else for (const p of this.players.values()) this.remote(p, dt);
      this.snapshotT -= dt;
      if (this.snapshotT <= 0) {
        this.snapshotT = 0.2;
        if (this.isHost)
          for (const id of this.net.connections.keys()) this.packets.post(id, 'snapshot', this.snapshot(id));
        else if (this.net.connected && this.ctx.player.alive)
          this.packets.post(this.net.connections.keys().next().value, 'state', this.packLocal());
      }
    }
    this.scenes?.tick();
    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = 0.5;
      this.maintain();
      this.updateHUD();
    }
    this.chunks.visible(this.ctx.player.body.pos);
  }
  updateHUD() {
    if (!this.info || !this.chunks) return;
    const p = this.chunks.address(this.ctx.player.body.pos),
      key = keyOf(p.cx, p.cz),
      item =
        this.chunks.loaded.get(this.info.schemaVersion === 1 ? dynamicScene(p) : key) ??
        this.chunks.loaded.get(key);
    const state = this.stateFor(key);
    const brief = questBrief(this.questsState());
    this.label.textContent = `${item?.block.layout.name ?? '探索边界'} · ${item?.block.layout.interior ? `室内${item.block.layout.outpost ? ` · 第 ${state.runId} 轮` : ''}` : key}\n${key === '0,0' ? '安全营地' : item?.block.layout.interior && !item.block.layout.outpost ? '安全建筑' : outpostComplete(state) ? '据点已清理' : `据点 ${state?.defeated.length ?? 0}/${item?.block.layout.outpost?.spawns.length ?? state?.total ?? 4}`} · ${this.unsaved.length || this.hostStatus?.unsaved ? '未保存，请打开菜单重试' : this.saving || this.hostStatus?.saving ? '正在保存' : '已保存'}${this.requests.size || this.hostStatus?.generating ? '\n前方区域正在绘制…' : ''}${this.error ? `\n${this.error}` : ''}${this.scenes?.hint ? `\n${this.scenes.hint}` : ''}${brief ? `\n委托 · ${brief}` : ''}`;
    const c = this.map.getContext('2d');
    if (this.info.schemaVersion === 2) {
      c.fillStyle = '#fffdf2';
      c.fillRect(0, 0, 150, 150);
      for (let x = 0; x < 2; x++)
        for (let z = 0; z < 2; z++) {
          const k = keyOf(x, z),
            known = this.manifest.has(k);
          c.fillStyle = !known
            ? '#e3e1d9'
            : k === '0,0' || outpostComplete(this.progress.chunks[k])
              ? '#c4dbc0'
              : '#cad8e8';
          c.fillRect(5 + x * 70, 5 + z * 70, 68, 68);
          if (!known) continue;
          c.strokeStyle = '#fffdf2';
          c.lineWidth = 4;
          c.beginPath();
          c.moveTo(5 + x * 70, 40 + z * 70);
          c.lineTo(73 + x * 70, 40 + z * 70);
          c.moveTo(40 + x * 70, 5 + z * 70);
          c.lineTo(40 + x * 70, 73 + z * 70);
          c.stroke();
        }
      for (const b of PLOTS)
        if (this.manifest.has(keyOf(b.cx, b.cz))) {
          c.fillStyle = b.templateId === 'warehouse' ? '#ba6d38' : '#5874a6';
          c.fillRect(5 + (b.cx + b.x / 128) * 70 - 3, 5 + (b.cz + b.z / 128) * 70 - 3, 6, 6);
        }
      for (const a of this.players.values()) {
        const b = buildingAt(a.pos.cx, a.pos.cz),
          location = b ? doorPosition(b) : a.pos;
        c.fillStyle = inkCSS(a.ink);
        c.beginPath();
        c.arc(
          5 + (location.cx + location.x / 128) * 70,
          5 + (location.cz + location.z / 128) * 70,
          3,
          0,
          Math.PI * 2,
        );
        c.fill();
      }
      return;
    }
    c.clearRect(0, 0, 150, 150);
    c.fillStyle = '#fffdf2';
    c.fillRect(0, 0, 150, 150);
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++) {
        const k = keyOf(p.cx + dx, p.cz + dz);
        c.strokeStyle = '#b8c1d0';
        c.strokeRect(5 + (dx + 3) * 20, 5 + (dz + 3) * 20, 18, 18);
        if (!this.manifest.has(k)) continue;
        c.fillStyle = k === '0,0' || outpostComplete(this.progress.chunks[k]) ? '#8cba88' : '#b5c8e4';
        c.fillRect(5 + (dx + 3) * 20, 5 + (dz + 3) * 20, 18, 18);
      }
    for (const a of this.players.values())
      if (nearby(a.pos, p, 3)) {
        c.fillStyle = inkCSS(a.ink);
        c.beginPath();
        c.arc(
          5 + (a.pos.cx - p.cx + 3 + a.pos.x / 128) * 20,
          5 + (a.pos.cz - p.cz + 3 + a.pos.z / 128) * 20,
          3,
          0,
          Math.PI * 2,
        );
        c.fill();
      }
  }
  async leave() {
    if (this.busy || this.saving) return;
    if (this.isHost && this.info && this.stage !== 'disconnected') {
      await this.save(() => ({ safePosition: this.nearestSafe(this.players.get(this.selfId).pos) }));
      if (this.unsaved.length) {
        this.report('世界仍有未保存进度，请重试保存后退出。');
        return;
      }
      await this.api.call(`/${this.info.id}/lease`, 'DELETE').catch((e) => this.report(e.message));
    }
    this.dispose();
    this.exit();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    clearInterval(this.heartbeat);
    this.net.close();
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.chunks?.dispose();
    this.overlay.remove();
    this.ctx.hud.root.classList.remove('exploration');
  }
}
