import {
  MAX_PLAYERS,
  ROOM_PREFIX,
  VERSION,
  validateCode,
  validateName,
  validateFrame,
  requireValue,
} from './protocol.js';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(5)), (n) => alphabet[n % alphabet.length]).join('');
const TIMEOUT = 15000;

// Reliable star topology. A sender's identity always comes from its DataConnection.
export class Transport {
  constructor({ onJoin, onLeave, onMessage, onError, peerOptions = {}, prefix = ROOM_PREFIX }) {
    Object.assign(this, { onJoin, onLeave, onMessage, onError, peerOptions, prefix });
    this.connections = new Map();
    this.pending = new Set();
    this.generation = 0;
    this.peer = null;
    this.connected = false;
  }
  async open({ name, code, isPublic = false }) {
    this.close();
    const generation = this.generation;
    validateName(name);
    if (code !== undefined) validateCode(code);
    this.isHost = code === undefined;
    this.isPublic = isPublic;
    try {
      const { Peer } = await import('peerjs');
      if (generation !== this.generation) throw new Error('连接操作已取消');
      if (this.isHost) {
        const codes = isPublic ? Array.from({ length: 16 }, (_, i) => `PUB${i}`) : [randomCode()];
        for (const candidate of codes) {
          try {
            await this.createPeer(Peer, this.prefix + candidate, generation);
            this.code = candidate;
            break;
          } catch (error) {
            if (!isPublic || error.type !== 'unavailable-id' || candidate === 'PUB15') throw error;
          }
        }
        this.connected = true;
        this.peer.on('connection', (conn) => this.accept(conn));
      } else {
        this.code = code;
        await this.createPeer(Peer, undefined, generation);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => fail(new Error('房间连接超时，请检查房间码和双方网络。')), TIMEOUT);
          const fail = (error) => {
            clearTimeout(timer);
            this.rejectJoin = null;
            reject(error);
          };
          this.rejectJoin = fail;
          const conn = this.peer.connect(this.prefix + code, {
            reliable: true,
            serialization: 'json',
            metadata: { v: VERSION, name },
          });
          this.pending.add(conn);
          conn.on('data', (message) => {
            if (this.connected) return;
            try {
              validateFrame(message);
              if (message.type === 'refused') throw new Error(String(message.reason));
              requireValue(message.type === 'welcome', '没有收到房主确认');
              this.pending.delete(conn);
              this.connections.set(conn.peer, { conn, last: Date.now(), count: 0, since: Date.now() });
              this.connected = true;
              clearTimeout(timer);
              this.rejectJoin = null;
              resolve();
            } catch (error) {
              fail(error);
            }
          });
          this.wire(conn);
        });
      }
      if (generation !== this.generation) throw new Error('连接操作已取消');
      this.heartbeat = setInterval(() => {
        const now = Date.now();
        for (const [id, entry] of this.connections) {
          if (now - entry.last > 30000) {
            this.drop(id, new Error('连接超时，超过 30 秒未收到回应'));
            continue;
          }
          this.sendTo(id, { type: 'ping' });
        }
      }, 2000);
      return this.code;
    } catch (error) {
      if (generation === this.generation) this.close();
      throw error;
    }
  }
  createPeer(Peer, id, generation) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(id, { debug: 0, ...this.peerOptions });
      this.peer = peer;
      let opened = false;
      const fail = (error) => {
        clearTimeout(timer);
        this.rejectOpen = null;
        if (!opened) {
          peer.destroy();
          reject(error);
        } else this.fail(error);
      };
      this.rejectOpen = fail;
      const timer = setTimeout(() => fail(new Error('信令服务器连接超时')), TIMEOUT);
      peer.on('open', () => {
        if (generation !== this.generation) {
          peer.destroy();
          reject(new Error('连接操作已取消'));
          return;
        }
        opened = true;
        clearTimeout(timer);
        this.rejectOpen = null;
        this.id = peer.id;
        resolve();
      });
      peer.on('error', (error) => {
        if (generation !== this.generation) return;
        if (this.rejectJoin) this.rejectJoin(error);
        else fail(error);
      });
      peer.on('disconnected', () => {
        if (opened && generation === this.generation)
          this.fail(new Error('信令服务已断开，房间已关闭。请重新连接。'));
      });
    });
  }
  accept(conn) {
    if (this.pending.size >= MAX_PLAYERS * 2) {
      conn.close();
      this.onError(new Error('待连接人数过多，已拒绝新连接'));
      return;
    }
    this.pending.add(conn);
    const timer = setTimeout(() => {
      this.pending.delete(conn);
      conn.close();
    }, TIMEOUT);
    conn.on('close', () => {
      clearTimeout(timer);
      this.pending.delete(conn);
    });
    conn.on('open', () => {
      clearTimeout(timer);
      this.pending.delete(conn);
      try {
        requireValue(conn.metadata?.v === VERSION, '客户端版本不兼容');
        validateName(conn.metadata.name);
        requireValue(this.connections.size < MAX_PLAYERS - 1, '房间已满（最多 10 人）');
        requireValue(!this.connections.has(conn.peer), '重复连接');
        this.connections.set(conn.peer, { conn, last: Date.now(), count: 0, since: Date.now() });
        this.wire(conn);
        this.sendTo(conn.peer, { type: 'welcome' });
        this.onJoin(conn.peer, conn.metadata.name);
      } catch (error) {
        conn.send({ v: VERSION, type: 'refused', reason: error.message });
        // Allow the refusal to enter the reliable channel before closing it.
        const closing = setTimeout(() => conn.close(), 300);
        conn.on('close', () => clearTimeout(closing));
        this.onError(error);
      }
    });
    conn.on('error', (error) => {
      clearTimeout(timer);
      this.pending.delete(conn);
      this.onError(error);
      conn.close();
    });
  }
  wire(conn) {
    conn.on('data', (message) => {
      const entry = this.connections.get(conn.peer);
      if (!entry || message?.type === 'welcome') return;
      try {
        validateFrame(message);
        const now = Date.now();
        entry.last = now;
        if (now - entry.since >= 1000) {
          entry.count = 0;
          entry.since = now;
        }
        requireValue(++entry.count <= 180, '发送消息过快');
        if (message.type === 'ping') {
          this.sendTo(conn.peer, { type: 'pong' });
          return;
        }
        if (message.type === 'pong') return;
        this.onMessage(message, conn.peer);
      } catch (error) {
        this.drop(conn.peer, error);
      }
    });
    conn.on('close', () => {
      if (this.rejectJoin) this.rejectJoin(new Error('房间在加入时关闭了连接'));
      this.drop(conn.peer, new Error('玩家连接已断开'));
    });
    conn.on('error', (error) => {
      if (this.rejectJoin) this.rejectJoin(error);
      this.drop(conn.peer, error);
    });
  }
  sendTo(id, data) {
    const entry = this.connections.get(id);
    requireValue(entry?.conn.open, '连接不可用，无法发送消息');
    entry.conn.send({ ...data, v: VERSION });
  }
  broadcast(data) {
    for (const id of this.connections.keys()) this.sendTo(id, data);
  }
  sendHost(data) {
    requireValue(!this.isHost && this.connected, '尚未连接房主');
    this.sendTo(this.prefix + this.code, data);
  }
  drop(id, reason) {
    const entry = this.connections.get(id);
    if (!entry) return;
    this.connections.delete(id);
    entry.conn.close();
    if (this.isHost) {
      this.onLeave(id);
      this.onError(reason);
    } else this.fail(new Error(`与房主的连接已断开，房间已关闭。${reason.message}`, { cause: reason }));
  }
  fail(error) {
    this.close();
    this.onError(error);
  }
  close() {
    this.generation++;
    clearInterval(this.heartbeat);
    const cancelOpen = this.rejectOpen,
      cancelJoin = this.rejectJoin;
    this.rejectOpen = this.rejectJoin = null;
    this.connected = false;
    const connections = [...this.connections.values()].map((entry) => entry.conn);
    this.connections.clear();
    for (const conn of [...connections, ...this.pending]) conn.close();
    this.pending.clear();
    if (cancelOpen) cancelOpen(new Error('连接操作已取消'));
    if (cancelJoin) cancelJoin(new Error('连接操作已取消'));
    if (this.peer) this.peer.destroy();
    this.peer = null;
  }
}
