import { sceneOf } from './region.js';
import { requireWorld, validAddress } from './schema.js';
import { validCharacterInk } from '../colors.js';

export function validateActor(p, info) {
  requireWorld(
    p && typeof p.id === 'string' && p.id.length <= 100 && typeof p.name === 'string' && p.name.length <= 14,
    '玩家身份无效',
  );
  validAddress(p.pos);
  requireWorld(p.ink === undefined || validCharacterInk(p.ink), '玩家颜色无效');
  if (p.sceneId !== undefined)
    requireWorld(
      p.sceneId === sceneOf(p.pos, info) && Number.isSafeInteger(p.epoch) && p.epoch >= 0,
      '玩家场景无效',
    );
  requireWorld(
    Number.isFinite(p.yaw) &&
      Math.abs(p.yaw) <= 1e7 &&
      Number.isFinite(p.pitch) &&
      Math.abs(p.pitch) <= 1.6 &&
      Number.isInteger(p.weapon) &&
      p.weapon >= 0 &&
      p.weapon <= 3 &&
      Number.isInteger(p.flags) &&
      p.flags >= 0 &&
      p.flags <= 4095,
    '玩家朝向或武器无效',
  );
  requireWorld(
    Array.isArray(p.velocity) &&
      p.velocity.length === 3 &&
      p.velocity.every((v) => Number.isFinite(v) && Math.abs(v) <= 60),
    '玩家速度无效',
  );
  if (p.hook) validAddress(p.hook);
  return p;
}
export class Packets {
  constructor(send, deliver) {
    this.send = send;
    this.deliver = deliver;
    this.pending = new Map();
    this.serial = 0;
  }
  post(id, type, data) {
    const text = JSON.stringify({ type, data });
    requireWorld(text.length <= 65536, '世界消息过大');
    const total = Math.ceil(text.length / 2048),
      serial = ++this.serial;
    for (let i = 0; i < total; i++)
      this.send(id, {
        type: 'world-part',
        serial,
        total,
        index: i,
        text: text.slice(i * 2048, (i + 1) * 2048),
      });
  }
  accept(frame, from) {
    requireWorld(
      frame.type === 'world-part' &&
        Number.isSafeInteger(frame.serial) &&
        frame.serial > 0 &&
        Number.isInteger(frame.total) &&
        frame.total > 0 &&
        frame.total <= 32 &&
        Number.isInteger(frame.index) &&
        frame.index >= 0 &&
        frame.index < frame.total &&
        typeof frame.text === 'string' &&
        frame.text.length <= 2048,
      '世界分片无效',
    );
    const now = Date.now();
    for (const [key, value] of this.pending) if (now - value.time > 10000) this.pending.delete(key);
    const key = `${from}:${frame.serial}`;
    let item = this.pending.get(key);
    if (!item) {
      requireWorld(this.pending.size < 40, '待组装世界消息过多');
      item = { total: frame.total, parts: new Map(), time: now };
      this.pending.set(key, item);
    }
    requireWorld(item.total === frame.total && !item.parts.has(frame.index), '重复或不一致的世界分片');
    item.parts.set(frame.index, frame.text);
    if (item.parts.size !== item.total) return;
    this.pending.delete(key);
    const decoded = JSON.parse(Array.from({ length: item.total }, (_, i) => item.parts.get(i)).join(''));
    requireWorld(decoded && typeof decoded.type === 'string', '世界消息类型无效');
    this.deliver(decoded.type, decoded.data, from);
  }
}
export class WorldAPI {
  constructor() {
    this.token = null;
  }
  async call(path = '', method = 'GET', body) {
    if (!this.token) {
      const response = await fetch('/api/worlds/session', {
        method: 'POST',
        headers: { 'X-World-Request': '1' },
      });
      requireWorld(response.ok, '请从本机开放世界服务打开游戏（npm run world）');
      const session = await response.json();
      requireWorld(typeof session.token === 'string', '请从本机开放世界服务打开游戏（npm run world）');
      this.token = session.token;
    }
    const response = await fetch(`/api/worlds${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-World-Session': this.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    requireWorld(response.ok, data.error || `世界服务错误 ${response.status}`);
    return data;
  }
}
