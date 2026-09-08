import { Transport } from './transport.js';
import { Match } from './match.js';
import { validateRoom, requireValue, vector, WEAPONS } from './protocol.js';

function peerOptions() {
  const host = import.meta.env.VITE_PEER_HOST;
  if (!host) return {};
  const port = Number(import.meta.env.VITE_PEER_PORT);
  requireValue(Number.isInteger(port) && port > 0 && port <= 65535, 'VITE_PEER_PORT 配置无效');
  requireValue(
    ['true', 'false'].includes(import.meta.env.VITE_PEER_SECURE),
    'VITE_PEER_SECURE 须为 true 或 false',
  );
  return { host, port, secure: import.meta.env.VITE_PEER_SECURE === 'true', path: '/peerjs' };
}

export class Room {
  constructor({ arena, onChange, onEvent, onError }) {
    Object.assign(this, { arena, onChange, onEvent, onError });
    this.state = null;
    this.model = null;
    this.seq = 0;
    this.net = new Transport({
      peerOptions: peerOptions(),
      onJoin: (id, name) => {
        this.model.add(id, name);
        this.publish();
      },
      onLeave: (id) => {
        this.model.remove(id);
        this.publish();
      },
      onMessage: (frame, from) => this.receive(frame, from),
      onError: (error) => {
        if (!this.net.connected) {
          this.stopClock();
          this.state = null;
          this.model = null;
        }
        onError(error);
      },
    });
  }
  get active() {
    return this.net.connected;
  }
  async connect(options) {
    await this.net.open(options);
    try {
      if (this.net.isHost) {
        const arena = this.arena();
        this.model = new Match({
          host: this.net.id,
          code: this.net.code,
          isPublic: this.net.isPublic,
          ...arena,
          emit: (event) => {
            this.net.broadcast({ type: 'event', event });
            this.onEvent(event);
          },
        });
        this.model.add(this.net.id, options.name);
        this.publish();
        let last = performance.now();
        this.clock = setInterval(() => {
          try {
            const now = performance.now();
            this.model.tick((now - last) / 1000);
            last = now;
            this.publish();
          } catch (error) {
            this.leave();
            this.onError(error);
          }
        }, 100);
      }
      return this.net.code;
    } catch (error) {
      this.leave();
      throw error;
    }
  }
  receive(frame, from) {
    if (this.net.isHost) {
      requireValue(frame.type === 'action', '访客不能发送房主消息');
      this.model.apply(from, frame.action);
      return;
    }
    requireValue(from === this.net.connections.keys().next().value, '消息并非来自房主');
    if (frame.type === 'room') this.apply(frame.room);
    else if (frame.type === 'event') {
      const e = frame.event;
      requireValue(e && this.state?.players.some((p) => p.id === e.id), '事件玩家不存在');
      if (e.type === 'shot')
        requireValue(
          Object.hasOwn(WEAPONS, e.kind) &&
            vector(e.origin, 110) &&
            Array.isArray(e.ends) &&
            e.ends.length === WEAPONS[e.kind].pellets &&
            e.ends.every((v) => vector(v, 450)),
          '弹道事件无效',
        );
      else if (e.type === 'grenade') requireValue(vector(e.pos, 110) && vector(e.vel, 70), '手雷事件无效');
      else if (e.type === 'death')
        requireValue(
          this.state.players.some((p) => p.id === e.by),
          '击杀者不存在',
        );
      else requireValue(e.type === 'parry', '未知战斗事件');
      this.onEvent(e);
    } else throw new Error('联机协议错误：未知房主消息');
  }
  apply(state) {
    validateRoom(state);
    requireValue(
      state.host === (this.net.isHost ? this.net.id : this.net.connections.keys().next().value),
      '房主身份不匹配',
    );
    requireValue(
      state.players.some((p) => p.id === this.net.id),
      '房间没有当前玩家',
    );
    if (this.state && state.revision <= this.state.revision) return;
    this.state = state;
    this.receivedAt = performance.now();
    this.onChange(state);
  }
  publish() {
    const state = this.model.snapshot();
    this.net.broadcast({ type: 'room', room: state });
    this.apply(state);
  }
  start() {
    requireValue(this.net.isHost && this.model, '仅房主可开始对局');
    this.model.start();
    this.publish();
  }
  back() {
    requireValue(this.net.isHost && this.model, '仅房主可返回房间');
    this.model.lobby();
    this.publish();
  }
  action(type, data = {}) {
    requireValue(this.state?.phase === 'match', '当前不在对局中');
    const self = this.state.players.find((p) => p.id === this.net.id);
    const action = { ...data, type, round: this.state.round, life: self.life, seq: ++this.seq };
    if (this.net.isHost) this.model.apply(this.net.id, action);
    else this.net.sendHost({ type: 'action', action });
  }
  stopClock() {
    clearInterval(this.clock);
    this.clock = null;
  }
  leave() {
    this.stopClock();
    this.net.close();
    this.state = this.model = null;
    this.seq = 0;
  }
}
