import * as THREE from 'three';
import { PLOTS, buildingAt, doorPosition, entryPosition, sceneOf, validateWorldLayout } from './region.js';
import { keyOf, checksum, requireWorld, validAddress } from './schema.js';
import { enterableBuildings, dynamicScene, houseEntry, validateHouseBlock } from './interiors.js';

export class BuildingScenes {
  constructor(session) {
    this.s = session;
    this.jobs = new Map();
    this.failed = new Map();
    this.known = new Set();
    this.serial = 0;
    this.requestSerial = 0;
    this.hint = '';
    this.dynamic = session.info.schemaVersion === 1;
  }
  scene(p) {
    return sceneOf(p, this.s.info);
  }
  atSupply(p) {
    return (
      p.sceneId === 'outdoor' &&
      p.pos.cx === 0 &&
      p.pos.cz === 0 &&
      Math.hypot(p.pos.x - 68, p.pos.z - 68, p.pos.y) <= 6
    );
  }
  near(p, range = 6) {
    if (!p) return null;
    if (this.dynamic) {
      const block = this.s.chunks.loaded.get(keyOf(p.pos.cx, p.pos.cz))?.block;
      const id = dynamicScene(p.pos);
      const interior = this.s.chunks.loaded.get(id)?.block;
      return enterableBuildings(block)
        .filter((b) => id === 'outdoor' || b.id === id)
        .map((building) => {
          const point =
            id === 'outdoor'
              ? building.door
              : interior && houseEntry(interior.layout, interior.x, interior.z);
          return {
            building,
            point,
            distance: point ? Math.hypot(p.pos.x - point.x, p.pos.z - point.z, p.pos.y - point.y) : Infinity,
          };
        })
        .filter((b) => b.distance <= Math.min(range, 2.8))
        .sort((a, b) => a.distance - b.distance)[0];
    }
    const inside = buildingAt(p.pos.cx, p.pos.cz);
    const candidates = inside ? [inside] : PLOTS.filter((b) => b.cx === p.pos.cx && b.cz === p.pos.cz);
    return candidates
      .map((b) => {
        const point = inside ? entryPosition(b) : doorPosition(b);
        return { building: b, point, distance: Math.hypot(p.pos.x - point.x, p.pos.z - point.z, p.pos.y) };
      })
      .filter((b) => b.distance <= range)
      .sort((a, b) => a.distance - b.distance)[0];
  }
  ensure(b, priority) {
    if (this.jobs.has(b.id)) {
      if (priority) return this.s.api.call(`/${this.s.info.id}/building/${b.id}`, 'POST', { priority: true });
      return this.jobs.get(b.id);
    }
    const s = this.s;
    const promise = s.api
      .call(`/${s.info.id}/building/${b.id}`, 'POST', { priority })
      .then((block) => {
        this.known.add(b.id);
        this.failed.delete(b.id);
        if (!this.dynamic) s.manifest.add(keyOf(block.x, block.z));
        return block;
      })
      .catch((error) => {
        this.failed.set(b.id, error.message);
        s.report(`${b.title}：${error.message}`);
        throw error;
      })
      .finally(() => this.jobs.delete(b.id));
    this.jobs.set(b.id, promise);
    return promise;
  }
  request(reset = false, confirmEnding = false) {
    const s = this.s;
    if (s.isHost) Object.assign(s.players.get(s.selfId), s.packLocal());
    const p = s.players.get(s.selfId);
    if (!p?.active || p.hp <= 0) return;
    if (this.dynamic && this.waitingUntil) {
      this.waitingUntil = 0;
      if (s.isHost) p.transition = null;
      else s.packets.post(s.net.connections.keys().next().value, 'scene-cancel', { epoch: p.epoch });
      return;
    }
    if (this.dynamic && !reset && this.near(p)) this.waitingUntil = Date.now() + 150000;
    const payload = { epoch: p.epoch, reset, seq: ++this.requestSerial, confirmEnding };
    if (this.dynamic) this.waitingSeq = payload.seq;
    if (s.isHost)
      void this.interact(p, payload)
        .catch((e) => s.report(e.message))
        .finally(() => {
          if (!this.dynamic || this.waitingSeq === payload.seq) this.waitingUntil = 0;
        });
    else {
      const host = s.net.connections.keys().next().value;
      s.packets.post(host, 'state', s.packLocal());
      s.packets.post(host, 'interact', payload);
    }
  }
  async interact(p, data) {
    const s = this.s;
    requireWorld(Number.isSafeInteger(data.seq) && data.seq > 0, '交互序号无效');
    if (!p.active || p.hp <= 0 || p.epoch !== data.epoch || data.seq <= (p.interactionSeq ?? 0)) return;
    p.interactionSeq = data.seq;
    const portal = this.near(p);
    if (!portal) {
      if (!data.reset && this.atSupply(p)) {
        const confirm = !!data.confirmEnding;
        if (s.isHost) s.talkCamp(confirm);
        if (!confirm && Date.now() - (p.supplyAt ?? 0) >= 10000) {
          p.supplyAt = Date.now();
          p.reward++;
          p.grenades = Math.min(5, p.grenades + 1);
        }
      }
      return;
    }
    const b = portal.building;
    if (this.dynamic && data.reset) return;
    if (data.reset) {
      requireWorld(sceneOf(p.pos) === 'outdoor' && b.templateId === 'warehouse', '请在仓库门外重置挑战');
      requireWorld(
        !this.resetting &&
          ![...s.players.values()].some((a) => a.sceneId === b.id || a.transition?.buildingId === b.id) &&
          !s.saving &&
          !s.unsaved.length &&
          !s.pendingKills.size,
        '仓库仍有人进入、战斗或等待保存',
      );
      requireWorld(
        ![...s.grenades, ...s.ctx.enemies.projectiles.list, ...s.ctx.player.nades].some(
          (g) => sceneOf(s.chunks.address(g.pos)) === b.id,
        ),
        '请等待仓库内投射物结束',
      );
      requireWorld(s.manifest.has(keyOf(b.sceneX, b.sceneZ)), '请等待仓库室内准备完成后重置');
      const runId = s.progress.runs[b.id]?.runId ?? 1;
      this.resetting = true;
      try {
        await s.save(
          () =>
            s.progress.runs[b.id]?.runId === runId + 1
              ? {}
              : { run: { buildingId: b.id, runId, reset: true } },
          () => {
            for (const e of [...s.ctx.enemies.enemies]) if (e.sceneId === b.id) s.removeEnemy(e);
            s.ctx.hud.tip('仓库挑战已重置 · 建筑布局保持不变', 3);
          },
        );
      } finally {
        this.resetting = false;
      }
      return;
    }
    if (p.transition || this.resetting) return;
    requireWorld(!s.saving && !s.unsaved.length, '请等待保存完成或重试保存，再进入建筑');
    let target = this.dynamic ? b.door : p.sceneId === 'outdoor' ? entryPosition(b) : doorPosition(b);
    const pending = {
      id: ++this.serial,
      epoch: p.epoch + 1,
      source: { ...p.pos },
      target,
      buildingId: b.id,
      requestSeq: data.seq,
      expires: Date.now() + 150000,
    };
    p.transition = pending;
    try {
      const entering = p.sceneId === 'outdoor';
      const block = !entering
        ? await s.api.call(`/${s.info.id}/chunk/${keyOf(target.cx, target.cz)}`)
        : await this.ensure(b, true);
      if (this.dynamic && entering) {
        await validateHouseBlock(block);
        requireWorld(block.layout.buildingId === b.id, '目标建筑不匹配');
        target = houseEntry(block.layout, block.x, block.z);
        pending.target = target;
      }
      if (!this.valid(p, pending)) {
        if (p.transition === pending) p.transition = null;
        if (this.dynamic && p.id !== s.selfId)
          s.packets.post(p.id, 'scene-error', {
            seq: data.seq,
            message: '已取消进入，完成的室内已缓存；靠近门后可再次进入',
            epoch: p.epoch,
          });
        return;
      }
      await s.chunks.add(block);
      const state = s.stateFor(keyOf(block.x, block.z));
      if (p.id === s.selfId) {
        p.loaded.add(keyOf(block.x, block.z));
        this.commit(p, pending);
      } else {
        p.sent.set(keyOf(block.x, block.z), block.checksum);
        s.packets.post(p.id, 'scene-prepare', {
          id: pending.id,
          epoch: pending.epoch,
          seq: data.seq,
          block,
          state,
          target,
        });
      }
    } catch (error) {
      if (p.transition === pending) p.transition = null;
      if (this.dynamic && p.id !== s.selfId)
        s.packets.post(p.id, 'scene-error', {
          message: error.message.slice(0, 300),
          epoch: p.epoch,
          seq: data.seq,
        });
      throw error;
    }
  }
  valid(p, pending) {
    return (
      !this.s.disposed &&
      this.s.players.get(p.id) === p &&
      p.transition === pending &&
      p.active &&
      p.hp > 0 &&
      Date.now() < pending.expires &&
      p.epoch + 1 === pending.epoch &&
      p.sceneId === this.scene(pending.source) &&
      this.s.chunks.position(p.pos).distanceTo(this.s.chunks.position(pending.source)) < 6
    );
  }
  commit(p, pending) {
    if (!this.valid(p, pending)) {
      if (p.transition === pending) p.transition = null;
      return;
    }
    p.pos = pending.target;
    p.sceneId = this.scene(p.pos);
    p.epoch = pending.epoch;
    p.transition = null;
    p.velocity = [0, 0, 0];
    p.hook = null;
    p.at = performance.now();
    p.yaw = p.sceneId === 'outdoor' ? 0 : Math.PI;
    p.pitch = 0;
    if (p.id === this.s.selfId) this.place(p);
    else this.s.packets.post(p.id, 'scene-commit', { id: pending.id, epoch: p.epoch, target: p.pos });
  }
  place(p) {
    const s = this.s,
      player = s.ctx.player;
    player.detachGrapple(false);
    player.clearNades();
    player.cancelInput();
    player.body.pos.copy(s.chunks.position(p.pos));
    player.body.vel.set(0, 0, 0);
    player.body.onGround = false;
    player.sliding = false;
    player.dashLock = false;
    player.yaw = p.sceneId === 'outdoor' ? 0 : Math.PI;
    player.pitch = 0;
    player.eye.copy(player.body.pos).add(new THREE.Vector3(0, player.eyeH, 0));
    player.center.copy(player.body.pos).add(new THREE.Vector3(0, 0.9, 0));
    player.camera.position.copy(player.eye);
    player._updateCamera(0);
    s.ctx.effects.clear();
    this.prepared = null;
    this.waitingUntil = 0;
    s.chunks.visible(player.body.pos);
  }
  async receive(type, data, from) {
    const s = this.s;
    if (s.isHost) {
      const p = s.players.get(from);
      if (type === 'scene-cancel' && this.dynamic) {
        if (p.epoch === data.epoch) p.transition = null;
      } else if (type === 'interact') {
        void this.interact(p, data).catch((e) => {
          s.report(e.message);
          if (this.dynamic)
            s.packets.post(p.id, 'scene-error', {
              message: e.message.slice(0, 300),
              epoch: p.epoch,
              seq: data.seq,
            });
        });
      } else if (type === 'scene-loaded') {
        const pending = p.transition;
        if (!pending || data.id !== pending.id || data.epoch !== pending.epoch) return;
        const key = keyOf(pending.target.cx, pending.target.cz);
        requireWorld(p.sent.get(key) === data.checksum, '室内加载校验失败');
        p.loaded.add(key);
        this.commit(p, pending);
      } else throw new Error('访客不能决定场景切换');
      return;
    }
    if (type === 'scene-error' && this.dynamic) {
      if (data.epoch === s.players.get(s.selfId).epoch && data.seq === this.waitingSeq) {
        this.waitingUntil = 0;
        this.prepared = null;
        s.report(String(data.message).slice(0, 300));
      }
    } else if (type === 'scene-prepare') {
      const p = s.players.get(s.selfId),
        block = data.block;
      if (this.dynamic && (!this.waitingUntil || data.seq !== this.waitingSeq)) return;
      if (!Number.isSafeInteger(data.id) || data.epoch !== p.epoch + 1) return;
      validAddress(data.target);
      requireWorld(block.x === data.target.cx && block.z === data.target.cz, '目标场景不匹配');
      if (block.layout.interiorVersion) {
        requireWorld(this.dynamic, '世界室内版本不匹配');
        await validateHouseBlock(block);
        requireWorld(this.scene(data.target) === block.layout.sceneId, '目标室内不匹配');
      }
      const layout = block.layout.interiorVersion
        ? block.layout
        : validateWorldLayout(block.layout, s.info, block.x, block.z);
      requireWorld((await checksum(layout)) === block.checksum, '室内地图校验失败');
      await s.chunks.add(block);
      s.setState(keyOf(block.x, block.z), data.state);
      this.prepared = { id: data.id, epoch: data.epoch, target: data.target, expires: Date.now() + 15000 };
      s.packets.post(from, 'scene-loaded', { id: data.id, epoch: data.epoch, checksum: block.checksum });
    } else if (type === 'scene-commit') {
      if (!this.prepared || data.id !== this.prepared.id || data.epoch !== this.prepared.epoch) return;
      requireWorld(
        JSON.stringify(data.target) === JSON.stringify(this.prepared.target),
        '场景确认目标不匹配',
      );
      const p = s.players.get(s.selfId);
      Object.assign(p, { pos: data.target, sceneId: this.scene(data.target), epoch: data.epoch });
      this.place(p);
    } else throw new Error('场景消息无效');
  }
  tick() {
    const s = this.s;
    if (this.prepared && Date.now() > this.prepared.expires) this.prepared = null;
    if (!s.started) return;
    if (this.dynamic) {
      for (const p of s.players.values())
        if (p.transition && !this.valid(p, p.transition)) {
          if (s.isHost && p.id !== s.selfId)
            s.packets.post(p.id, 'scene-error', {
              message: '进入已取消，请靠近门重试',
              epoch: p.epoch,
              seq: p.transition.requestSeq,
            });
          p.transition = null;
        }
      const self = s.players.get(s.selfId),
        near = this.near(self);
      const busy = Date.now() < (this.waitingUntil ?? 0) && (!s.isHost || !!self?.transition);
      if (!busy) this.waitingUntil = 0;
      this.hint = near
        ? `${near.building.title} · E ${self.sceneId === 'outdoor' ? '进入' : '返回街道'}`
        : this.atSupply(self)
          ? 'E 营地补给 · 听委托'
          : '';
      if (this.failed.has(near?.building.id)) this.hint += '\n上次生成失败 · E 重试';
      if (s.loading) {
        s.loading.hidden = !busy;
        s.loadingText.textContent =
          self?.sceneId === 'outdoor' ? '正在准备房间、窗户与楼梯…' : '正在返回街道…';
      }
      if (busy) this.hint = '正在打开建筑 · E 取消进入 · 移开可取消；已完成的生成仍会保存';
      if (s.ctx.game.state === 'play') {
        if (s.ctx.input.pressed('interact')) this.request();
        if (s.ctx.input.pressed('talk') && this.atSupply(self)) this.request(false, true);
      }
      return;
    }
    for (const p of s.players.values()) {
      if (p.transition && !this.valid(p, p.transition)) p.transition = null;
      if (!s.isHost || !p.active || p.hp <= 0 || p.sceneId !== 'outdoor') continue;
      const near = this.near(p, 22);
      if (!near || s.progress.generationPaused) continue;
      const b = near.building;
      if (this.known.has(b.id) || this.jobs.has(b.id) || this.failed.has(b.id)) continue;
      void this.ensure(b, false).catch(() => {});
    }
    const self = s.players.get(s.selfId),
      near = this.near(self);
    this.hint = near
      ? `${near.building.title} · E ${self.sceneId === 'outdoor' ? '进入' : '返回街道'}${near.building.templateId === 'warehouse' && self.sceneId === 'outdoor' ? ' · N 重置挑战' : ''}`
      : this.atSupply(self)
        ? 'E 营地补给 · 听委托 · T 确认处置'
        : '';
    if (self.transition || this.jobs.size || this.prepared) this.hint += '\n正在准备室内，可继续探索街道…';
    if (s.ctx.game.state === 'play') {
      if (s.ctx.input.pressed('interact')) this.request();
      if (s.ctx.input.pressed('talk') && this.atSupply(self)) this.request(false, true);
      if (s.ctx.input.pressed('resetRun')) this.request(true);
    }
  }
}
