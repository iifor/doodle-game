import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Match } from '../src/games/shooter/online/match.js';
import {
  validateAction,
  validateRoom,
  validateSnap,
  validateName,
  validateCode,
  validateFrame,
} from '../src/games/shooter/online/protocol.js';
import { RemotePlayer } from '../src/games/shooter/online/remote-player.js';
import { World, makeBody } from '../src/games/shooter/physics.js';
import { buildLevel } from '../src/games/shooter/level.js';
import { disposeTree } from '../src/shared/resources.js';

function arena() {
  const world = new World();
  world.addBox(new THREE.Vector3(-80, -1, -80), new THREE.Vector3(80, 0, 80));
  world.finalize();
  const events = [];
  const match = new Match({
    host: 'host',
    code: 'ABC23',
    isPublic: false,
    world,
    spawns: Array.from({ length: 15 }, (_, i) => new THREE.Vector3(i * 3, 0, 20)),
    pickupSpots: [new THREE.Vector3(0, 0, 10)],
    emit: (e) => events.push(e),
  });
  match.add('host', '房主');
  match.add('guest', '朋友');
  match.start();
  const command = (id, type, data = {}) => {
    const p = match.players.get(id);
    return match.apply(id, { round: match.round, life: p.life, seq: p.seq + 1, type, ...data });
  };
  command('host', 'ready');
  command('guest', 'ready');
  match.tick(2);
  command('host', 'state', { snap: [0, 0, 10, 0, 0, 0, 80, 110, 0, 0, 0] });
  command('guest', 'state', { snap: [0, 0, 0, Math.PI, 0, 0, 80, 110, 0, 0, 0] });
  return { match, command, events };
}

test('network boundaries reject malformed, oversized, version-mismatched and non-finite input', () => {
  validateName('<img src=x>'); // Allowed text is rendered as text, not HTML.
  for (const name of ['', 'a'.repeat(15), '玩家\n', '\u200b']) assert.throws(() => validateName(name));
  for (const code of ['', '../../', 'abc23', 'PUB16']) assert.throws(() => validateCode(code));
  validateCode('ABC23');
  validateCode('PUB15');
  assert.throws(() => validateFrame({ v: 2, type: 'room' }));
  assert.throws(() => validateFrame({ v: 1, type: 'room', data: 'x'.repeat(17000) }));
  assert.throws(() => validateSnap([0, 0, 0, 0, 0, 99, 64, 110, 0, 0, 0]));
  assert.throws(() => validateSnap([NaN, 0, 0, 0, 0, 0, 64, 110, 0, 0, 0]));
  assert.throws(() =>
    validateAction({
      round: 1,
      life: 1,
      seq: 1,
      type: 'shot',
      kind: 'rifle',
      origin: [0, 0, 0],
      dirs: [[0, 0, -2]],
    }),
  );
  assert.throws(() => validateAction({ round: 1, life: 1, seq: 1, type: 'setScore', kills: 20 }));
});

test('arena spawns are distinct, unobstructed and rebuilt separately from solo', () => {
  const root = new THREE.Group(),
    world = new World();
  const level = buildLevel(root, world, 'district', { arena: true });
  assert.ok(level.arenaSpawns.length >= 10);
  assert.equal(new Set(level.arenaSpawns.map((s) => s.toArray().join(','))).size, level.arenaSpawns.length);
  for (const spot of level.arenaSpawns)
    assert.equal(world.overlapsBody(makeBody(spot.clone(), 0.35, 1.75)), false, spot.toArray().join(','));
  disposeTree(root);
  world.clear();
  const solo = buildLevel(root, world, 'district');
  assert.equal(solo.arenaSpawns.length, 0);
  disposeTree(root);
});

test('host resolves bullets against walls and owns health, kill count and respawn epochs', () => {
  const { match, command } = arena();
  const guest = match.players.get('guest');
  command('guest', 'state', { snap: [0, 0, 0, 0, 0, 0, 80, 0, 0, 0, 0] });
  assert.equal(guest.hp, 110);
  match.world.addBox(new THREE.Vector3(-2, 0, 4), new THREE.Vector3(2, 4, 5));
  match.world.finalize();
  const shot = { kind: 'sniper', origin: [0, 1.6, 10], dirs: [[0, 0, -1]] };
  command('host', 'shot', shot);
  assert.equal(guest.hp, 110);
  match.world.boxes.pop();
  match.world.finalize();
  match.tick(1);
  const stale = { round: match.round, life: guest.life, seq: guest.seq + 1, type: 'state', snap: guest.snap };
  command('host', 'shot', shot);
  assert.equal(guest.hp, 0);
  assert.equal(guest.deaths, 1);
  assert.equal(match.players.get('host').kills, 1);
  match.damage(guest, 100, 'host');
  assert.equal(guest.deaths, 1);
  const life = guest.life;
  match.tick(2);
  match.tick(0.5);
  assert.equal(guest.life, life + 1);
  assert.equal(guest.hp, 110);
  assert.equal(match.apply('guest', stale), false);
  assert.equal(guest.hp, 110);
  match.damage(guest, 200, 'host');
  assert.equal(guest.hp, 110, 'spawn protection');
  validateRoom(match.snapshot());
  assert.equal(match.snapshot().time, match.time, 'late joiners share the host scene clock');
});

test('one pickup is awarded once; duplicate packets cannot grant extra supplies', () => {
  const { match, command } = arena();
  match.pickups = [{ id: 1, pos: [0, 0, 10] }];
  const p = match.players.get('host');
  const request = { round: match.round, life: p.life, seq: p.seq + 1, type: 'take', id: 1 };
  assert.equal(match.apply('host', request), true);
  assert.equal(p.supplies, 1);
  assert.equal(match.apply('host', request), false);
  assert.equal(command('host', 'take', { id: 1 }), false);
  assert.equal(p.supplies, 1);
});

test('round end, late join, capacity and departure have consistent authority', () => {
  const { match, command } = arena();
  for (let i = 0; i < 8; i++) match.add(`p${i}`, `玩家${i}`);
  assert.throws(() => match.add('overflow', '多余玩家'));
  assert.equal(match.players.get('p0').active, false);
  match.remove('p0');
  match.add('late', '后来者');
  assert.equal(match.players.get('late').kills, 0);
  const host = match.players.get('host'),
    guest = match.players.get('guest');
  host.kills = 19;
  match.damage(guest, 150, 'host');
  assert.equal(match.phase, 'over');
  assert.equal(match.winner, 'host');
  assert.equal(command('host', 'shot', { kind: 'rifle', origin: [0, 1.6, 10], dirs: [[0, 0, -1]] }), false);
  match.lobby();
  match.start();
  assert.equal(host.kills, 0);
  assert.equal(match.left, 600);
  assert.equal(host.active, false);
  command('host', 'ready');
  command('guest', 'ready');
  match.left = 0.05;
  match.tick(0.1);
  assert.equal(match.phase, 'over');
  validateRoom(match.snapshot());
});

test('melee guard and grenade damage run on the host rather than client health claims', () => {
  const { match, command, events } = arena();
  const guest = match.players.get('guest');
  command('host', 'state', { snap: [0, 0, 2, 0, 0, 3, 80, 110, 0, 0, 0] });
  command('guest', 'state', { snap: [0, 0, 0, Math.PI, 0, 3, 80 | 4 | 256, 110, 0, 0, 0] });
  command('host', 'melee');
  assert.equal(guest.hp, 110);
  assert.equal(events.at(-1).type, 'parry');
  match.tick(0.3);
  command('guest', 'state', { snap: [0, 0, 0, 0, 0, 0, 80, 110, 0, 0, 0] });
  command('host', 'melee');
  assert.equal(guest.hp, 55);
  command('host', 'grenade', { pos: [0, 0.2, 1], vel: [0, 0, 0] });
  match.tick(1.8);
  assert.equal(guest.hp, 0);
});

test('remote avatars reject invalid weapons and release old weapon geometry', () => {
  const scene = new THREE.Scene();
  const remote = new RemotePlayer({ scene, player: { eye: new THREE.Vector3() } }, 'peer', '朋友', 0, 1);
  const snap = [0, 0, 0, 0, 0, 0, 80, 110, 0, 0, 0];
  remote.push(snap, 1);
  remote.update(0.016, 1);
  assert.equal(remote.root.visible, true);
  assert.throws(() => remote.setWeapon(4));
  let disposed = 0;
  remote.J.gun.traverse((o) => {
    if (o.geometry) o.geometry.addEventListener('dispose', () => disposed++);
  });
  remote.setWeapon(3);
  assert.ok(disposed > 0);
  remote.dispose();
  assert.equal(scene.children.length, 0);
});

test('transport authenticates connection identity and closes protocol violators', async () => {
  const { EventEmitter } = await import('node:events');
  const { Transport } = await import('../src/games/shooter/online/transport.js');
  const received = [],
    errors = [],
    left = [];
  const transport = new Transport({
    onJoin() {},
    onLeave: (id) => left.push(id),
    onMessage: (data, from) => received.push(from),
    onError: (error) => errors.push(error),
  });
  transport.isHost = true;
  transport.connected = true;
  const conn = new EventEmitter();
  conn.peer = 'actual-peer';
  conn.open = true;
  conn.close = () => {
    conn.open = false;
    conn.emit('close');
  };
  conn.send = () => {};
  transport.connections.set(conn.peer, { conn, last: Date.now(), count: 0, since: Date.now() });
  transport.wire(conn);
  conn.emit('data', { v: 1, type: 'action', from: 'forged-host' });
  assert.deepEqual(received, ['actual-peer']);
  conn.emit('data', { v: 999, type: 'action' });
  assert.equal(conn.open, false);
  assert.equal(transport.connections.size, 0);
  assert.deepEqual(left, ['actual-peer']);
  assert.equal(errors.length, 1);
  transport.close();
});

test('cancel during signaling rejects the pending operation and destroys the peer', async () => {
  const { EventEmitter } = await import('node:events');
  const { Transport } = await import('../src/games/shooter/online/transport.js');
  class Peer extends EventEmitter {
    destroy() {
      this.destroyed = true;
    }
  }
  const transport = new Transport({ onError() {} });
  const pending = transport.createPeer(Peer, 'peer', transport.generation);
  const peer = transport.peer;
  transport.close();
  await assert.rejects(pending, /取消/);
  assert.equal(peer.destroyed, true);
  assert.equal(transport.peer, null);
  peer.emit('open');
  assert.equal(transport.connected, false);
});
