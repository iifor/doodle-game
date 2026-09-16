import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createCharacterStore,
  newCharacter,
  profileOf,
  levelOf,
  armorDamage,
  validateProfile,
  WEAPON_IDS,
} from '../src/games/shooter/character.js';
import { Room } from '../src/games/shooter/online/room.js';
import { RemotePlayer } from '../src/games/shooter/online/remote-player.js';
import { Multiplayer } from '../src/games/shooter/online/multiplayer.js';
import { INK } from '../src/games/shooter/render.js';
import { shoot, slash, advanceGrenade } from '../src/games/shooter/online/combat.js';
import { GUNS } from '../src/games/shooter/weapons/guns.js';
import { WEAPONS } from '../src/games/shooter/online/protocol.js';
import { Match } from '../src/games/shooter/online/match.js';
import { validateRoom } from '../src/games/shooter/online/protocol.js';
import { World } from '../src/games/shooter/physics.js';
import { Player } from '../src/games/shooter/player.js';
import { Effects } from '../src/games/shooter/effects.js';
import { EnemyManager } from '../src/games/shooter/enemies/manager.js';
import {
  castAbility,
  launchShell,
  bladeRecovering,
  absorbBarrier,
  skillMove,
  tickAbilities,
  resetAbilities,
  weaponPower,
} from '../src/games/shooter/abilities.js';
import { progressionEvents, canRestorePower } from '../src/games/shooter/exploration/progression.js';
import { validateProgress } from '../src/games/shooter/exploration/schema.js';
import { Exploration } from '../src/games/shooter/exploration/session.js';
import { disposeTree } from '../src/shared/resources.js';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};
test('one permanent class, unlimited points, persisted pity and once-only rewards survive reload and failed writes', () => {
  const storage = memory(),
    store = createCharacterStore(storage);
  store.create('blade', '刀客');
  assert.throws(() => store.create('mage'), /不可更改/);
  for (let i = 0; i < 19; i++)
    assert.equal(store.reward({ id: `world-a:${i}`, type: 'landmark' }, () => 0.8).point, false);
  const reloaded = createCharacterStore(storage);
  assert.equal(reloaded.read().pity, 19);
  assert.equal(reloaded.reward({ id: 'world-a:19', type: 'quest' }, () => 0.8).point, true);
  assert.equal(
    reloaded.reward({ id: 'world-a:19', type: 'quest' }, () => {
      throw Error('must not reroll');
    }),
    null,
  );
  assert.equal(reloaded.read().pity, 0);
  reloaded.allocate('armor');
  assert.equal(reloaded.read().points, 0);
  assert.throws(() => reloaded.allocate('weapon'), /不足/);
  for (let i = 20; i < 65; i++) reloaded.reward({ id: `world-a:${i}`, type: 'elite' }, () => 0);
  assert.equal(levelOf(reloaded.read()), 10);
  assert.equal(reloaded.read().points, 45);
  const before = reloaded.read();
  reloaded.allocate('weapon', 45);
  assert.equal(profileOf(reloaded.read()).stats.weapon, profileOf(before).stats.weapon + 45);
  assert.equal(armorDamage(100, { stats: { armor: 100 } }), 50);
  const saved = reloaded.read();
  storage.setItem = () => {
    throw Error('disk full');
  };
  assert.throws(() => reloaded.reward({ id: 'new-world:1', type: 'elite' }), /disk full/);
  assert.deepEqual(reloaded.read(), saved);
});

test('equipment gates by class and level; derived profiles reject invalid numbers', () => {
  const store = createCharacterStore(memory());
  store.create('mage');
  assert.throws(() => store.equip('blade-weapon-0'));
  store.reward({ id: 'w:quest', type: 'quest' }, () => 0.7);
  assert.throws(() => store.equip('mage-weapon-1'), /未解锁/);
  store.reward({ id: 'w:elite', type: 'elite' }, () => 0.7);
  store.equip('mage-weapon-1');
  assert.equal(profileOf(store.read()).stats.weapon, 112);
  const bad = profileOf(store.read());
  bad.weapon = 'rifle';
  assert.throws(() => validateProfile(bad));
  bad.weapon = 'staff';
  bad.stats.health = Infinity;
  assert.throws(() => validateProfile(bad));
});

function matchRoles(a = 'gunner', b = 'blade') {
  const world = new World();
  world.addBox(new THREE.Vector3(-80, -1, -80), new THREE.Vector3(80, 0, 80));
  world.finalize();
  const events = [];
  const match = new Match({
    host: 'a',
    code: 'ABC23',
    isPublic: false,
    world,
    spawns: Array.from({ length: 10 }, (_, i) => new THREE.Vector3(i * 3, 0, 15)),
    pickupSpots: [new THREE.Vector3(20, 0, 20)],
    emit: (e) => events.push(e),
  });
  match.add('a', '甲', profileOf(newCharacter(a)));
  match.add('b', '乙', profileOf(newCharacter(b)));
  match.start();
  const send = (id, type, other = {}) => {
    const p = match.players.get(id);
    return match.apply(id, { type, ...other, life: p.life, round: match.round, seq: p.seq + 1 });
  };
  send('a', 'ready');
  send('b', 'ready');
  match.tick(2);
  for (const [id, z, yaw] of [
    ['a', 10, 0],
    ['b', 0, Math.PI],
  ]) {
    const p = match.players.get(id);
    send(id, 'state', { snap: [0, 0, z, yaw, 0, WEAPON_IDS.indexOf(p.profile.weapon), 64, p.hp, 0, 0, 0] });
  }
  return { match, send, events, a: match.players.get('a'), b: match.players.get('b') };
}

test('PVP inherits full health/power/armor, locks class weapons, and host enforces skill cooldown and respawn', () => {
  const { match, send, a, b } = matchRoles();
  assert.equal(b.hp, 140);
  const original = a.profile;
  original.stats.weapon = 200;
  send('a', 'shot', { kind: 'rifle', origin: [0, 1.15, 10], dirs: [[0, 0, -1]] });
  assert.ok(Math.abs(b.hp - (140 - (40 * 140) / 150)) < 0.001);
  assert.throws(() => send('a', 'melee'), /拔刀/);
  assert.throws(
    () => send('a', 'shot', { kind: 'sniper', origin: [0, 1.6, 10], dirs: [[0, 0, -1]] }),
    /武器/,
  );
  assert.equal(send('a', 'skill', { index: 0 }), true);
  assert.equal(send('a', 'skill', { index: 0 }), false);
  assert.equal(a.focusUntil, 6);
  const state = match.snapshot();
  validateRoom(state);
  assert.equal(state.players[0].profile.stats.weapon, 200);
  match.damage(b, 10000, 'a');
  match.tick(2);
  match.tick(0.5);
  assert.equal(b.hp, 140);
  assert.deepEqual(b.skillAt, [-100, -100]);
});

test('all active skills execute, cannon charges before launch, and mage energy/field slow are authoritative', () => {
  for (const role of ['blade', 'gunner', 'cannon', 'mage']) {
    const { match, send, a, events } = matchRoles(role, 'gunner');
    assert.equal(send('a', 'skill', { index: 0 }), true);
    if (role === 'cannon') {
      assert.equal(match.grenades.length, 0);
      match.tick(0.81);
      assert.equal(match.grenades.length, 1);
    }
    if (role === 'mage') {
      assert.equal(a.energy, 70);
      assert.equal(match.fields.length, 1);
    }
    if (role === 'blade') {
      assert.equal(send('a', 'skill', { index: 1 }), false);
      match.tick(0.46);
    }
    assert.equal(send('a', 'skill', { index: 1 }), true);
    assert.ok(events.filter((e) => e.type === 'ability').length >= 2);
    assert.equal(castAbility(match, a, 5), false);
  }
  const { match, send, a, b } = matchRoles('mage', 'gunner');
  b.snap[2] = -8;
  send('a', 'skill', { index: 0 });
  match.tick(0.1);
  assert.ok(b.hp < 110);
  assert.ok(b.slowUntil > match.time);
  assert.ok(a.energy > 80);
});

test('skill movement sweeps the complete body and cannot blink through a thin wall', () => {
  const { match, a } = matchRoles('mage');
  match.world.addBox(new THREE.Vector3(-4, 0, 7), new THREE.Vector3(4, 8, 7.1));
  match.world.finalize();
  const pos = skillMove(match.world, a, new THREE.Vector3(0, 0, -1), 6);
  assert.ok(pos[2] >= 7.4499 && pos[2] < 10, JSON.stringify(pos));
});

test('supply power requires a cleared nearby station; persisted events have stable cross-world/run identities', () => {
  const block = { x: 1, z: 0, layout: { landmark: [64, 64], outpost: { center: [64, 64] } } },
    pos = { cx: 1, cz: 0, x: 64, y: 0, z: 64 };
  const state = { defeated: [0, 1, 2, 3], rewarded: true, powered: true };
  assert.equal(canRestorePower(block, { ...state, powered: false }, pos), true);
  assert.equal(canRestorePower(block, { ...state, powered: false, rewarded: false }, pos), false);
  assert.equal(canRestorePower(block, { ...state, powered: false }, { ...pos, x: 80 }), false);
  assert.deepEqual(validateProgress(state), state);
  assert.throws(() => validateProgress({ ...state, rewarded: false }));
  const a = progressionEvents({ id: 'world-a' }, block, state, pos);
  assert.deepEqual(
    a.map((e) => e.type),
    ['landmark', 'elite', 'quest'],
  );
  assert.notEqual(a[0].id, progressionEvents({ id: 'world-b' }, block, state, pos)[0].id);
  assert.equal(progressionEvents({ id: 'a' }, block, state, { ...pos, y: 300 }).length, 0);
});

// Real weapon models and frame update, no browser/audio dependencies.
function gameContext(role) {
  const scene = new THREE.Scene(),
    world = new World();
  world.addBox(new THREE.Vector3(-50, -1, -50), new THREE.Vector3(50, 0, 50));
  world.finalize();
  const pressed = new Set();
  const hud = new Proxy(
    { roleStatus: {}, root: {}, key: (k) => k },
    { get: (target, key) => target[key] ?? (() => {}) },
  );
  const ctx = {
    scene,
    world,
    profile: profileOf(newCharacter(role)),
    camera: new THREE.PerspectiveCamera(),
    level: { playerStart: new THREE.Vector3(0, 0, 10), rings: [], grappleMovers: [], animated: [] },
    game: {
      state: 'play',
      mode: 'solo',
      time: 0,
      focus: {},
      hitstop() {},
      addScore() {},
      onPlayerDeath() {},
    },
    hud,
    input: {
      look: { x: 0, y: 0 },
      move: { x: 0, y: 0 },
      pressed: (k) => pressed.has(k),
      down: () => false,
      rumble() {},
    },
  };
  ctx.effects = new Effects(scene, world);
  ctx.enemies = new EnemyManager(ctx);
  ctx.player = new Player(ctx);
  ctx.player.configure(ctx.profile);
  ctx.player.reset(ctx.level.playerStart);
  ctx.player._updateCamera(0);
  return { ctx, pressed };
}
test('each profession survives live player frames, weapons and skills in training with no progression writes', () => {
  for (const role of ['blade', 'gunner', 'cannon', 'mage']) {
    const { ctx, pressed } = gameContext(role),
      p = ctx.player;
    try {
      p.switchTo(role === 'blade' ? 0 : 3);
      assert.equal(p.weapon.kind, ctx.profile.weapon);
      for (let i = 0; i < 100; i++) {
        ctx.game.time += 0.02;
        pressed.clear();
        if (i === 2) pressed.add('melee');
        if (i === 30) pressed.add('grenade');
        p.update(0.02);
      }
      assert.ok(p.hp > 0);
      assert.ok(Number.isFinite(p.body.pos.x));
      if (p.weapon.isGun) {
        p.weapon.fire({ aim: false });
        p.weapon.startReload();
        for (let i = 0; i < 160; i++) {
          ctx.game.time += 0.02;
          p.update(0.02);
        }
      }
      assert.equal(p.maxHp, ctx.profile.stats.health);
    } finally {
      ctx.enemies.clear();
      p.clearNades();
      ctx.effects.clear();
      disposeTree(ctx.scene);
    }
  }
});

test('world host uses the same profile for damage and skill execution as training/PVP', () => {
  const { ctx } = gameContext('mage'),
    p = {
      id: 'host',
      name: '法师',
      pos: { cx: 0, cz: 0, x: 0, y: 0, z: 10 },
      yaw: 0,
      pitch: 0,
      weapon: 5,
      flags: 64,
      velocity: [0, 0, 0],
      hp: 100,
      active: true,
      life: 1,
      seq: 0,
      profile: ctx.profile,
      energy: 100,
      skillAt: [-100, -100],
    };
  const s = Object.create(Exploration.prototype);
  Object.assign(s, {
    ctx,
    players: new Map([['host', p]]),
    selfId: 'host',
    isHost: true,
    started: true,
    grenades: [],
    chunks: {
      position: (v) => new THREE.Vector3(v.x, v.y, v.z),
      address: (v) => ({ cx: 0, cz: 0, x: v.x, y: v.y, z: v.z }),
    },
  });
  ctx.exploration = s;
  ctx.pvp = s;
  try {
    s.action('host', { action: 'skill', index: 0, seq: 1, life: 1 });
    assert.equal(p.energy, 70);
    assert.equal(p.fields.length, 1);
    s.action('host', { action: 'skill', index: 0, seq: 2, life: 1 });
    assert.equal(p.energy, 70);
    p.profile.stats.armor = 100;
    s.damagePlayer('host', 40);
    assert.equal(p.hp, 80);
    assert.equal(ctx.player.hp, 80);
    p.profile = profileOf(newCharacter('gunner'));
    p.profile.stats.armor = 900;
    p.profile.stats.skill = 200;
    p.weapon = 0;
    p.hp = ctx.player.hp = 110;
    ctx.profile = p.profile;
    ctx.player.configure(p.profile);
    resetAbilities(p);
    s.action('host', { action: 'skill', index: 1, seq: 3, life: 1 });
    assert.equal(p.barrier, 80);
    s.damagePlayer('host', 100);
    assert.equal(p.barrier, 0);
    assert.ok(Math.abs(p.hp - (110 - armorDamage(20, p.profile))) < 1e-8);
    assert.equal(ctx.player.hp, p.hp, 'world host applies barrier and armor once');
  } finally {
    ctx.effects.clear();
    disposeTree(ctx.scene);
  }
});

test('all class ability packets pass both PVP and exploration guest validation', async () => {
  for (const role of ['blade', 'gunner', 'cannon', 'mage']) {
    const { match, a, send, events } = matchRoles(role);
    send('a', 'skill', { index: 0 });
    if (role === 'blade') match.tick(0.46);
    send('a', 'skill', { index: 1 });
    const accepted = [];
    const guest = {
      net: { isHost: false, connections: new Map([['a', {}]]) },
      state: match.snapshot(),
      onEvent: (e) => accepted.push(e),
    };
    const worldGuest = {
      net: guest.net,
      players: new Map([['a', a]]),
      selfId: 'b',
      ctx: { player: { showAbility: (e) => accepted.push(e) } },
      chunks: { position: (v) => new THREE.Vector3(v.x, v.y, v.z) },
    };
    for (const event of events.filter((e) => e.type === 'ability')) {
      Room.prototype.receive.call(guest, { type: 'event', event }, 'a');
      const packet = { ...event };
      for (const key of ['origin', 'end', 'move'])
        if (packet[key])
          packet[key] = { cx: 0, cz: 0, x: packet[key][0] + 50, y: packet[key][1], z: packet[key][2] + 50 };
      await Exploration.prototype.receive.call(worldGuest, 'ability', packet, 'a');
    }
    assert.equal(accepted.length, 4, role);
    assert.throws(
      () =>
        Room.prototype.receive.call(
          guest,
          { type: 'event', event: { ...events.find((e) => e.type === 'ability'), role: 'invalid' } },
          'a',
        ),
      /技能事件/,
    );
  }
});

test('focused sniper leaves equally equipped targets alive on body hits; skills improve both gunner weapons', () => {
  const profiles = {};
  for (const role of ['blade', 'gunner', 'cannon', 'mage']) {
    const c = newCharacter(role);
    c.xp = 900;
    for (const slot of Object.keys(c.equipment)) {
      const id = `${role}-${slot}-2`;
      c.inventory.push(id);
      c.equipment[slot] = id;
    }
    profiles[role] = profileOf(c);
  }
  const p = { profile: profiles.gunner, focusUntil: 10 };
  for (const weapon of ['rifle', 'sniper']) {
    p.profile.weapon = weapon;
    const before = weaponPower(p, 0);
    p.profile.stats.skill += 100;
    assert.ok(weaponPower(p, 0) > before);
    p.profile.stats.skill -= 100;
    assert.equal(GUNS[weapon].damage, WEAPONS[weapon].damage);
  }
  const body = WEAPONS.sniper.damage * weaponPower(p, 0);
  for (const profile of Object.values(profiles)) {
    assert.ok(armorDamage(body, profile) < profile.stats.health, profile.role);
    assert.ok(armorDamage(body * WEAPONS.sniper.head, profile) > profile.stats.health, profile.role);
  }
  // Equal total investment in health and armor adds equal effective health, even at late-game scales.
  for (const points of [100, 10000, 1000000]) {
    const profile = { stats: { health: 100 + points / 2, armor: points / 2 } };
    assert.ok(Math.abs(profile.stats.health / armorDamage(1, profile) - (100 + points)) < 0.000001);
  }
});

test('holding blade guard takes chip damage; only precise guards reflect and rapid follow-up shots punish recovery', () => {
  const { match, a, b } = matchRoles();
  b.snap[6] |= 4;
  const shot = { kind: 'rifle', origin: [0, 1.15, 10], dirs: [[0, 0, -1]] };
  shoot(match, a, shot);
  const afterGuard = b.hp;
  assert.ok(afterGuard < 140 && afterGuard > 130);
  assert.equal(a.hp, 110);
  match.time += 0.05;
  shoot(match, a, shot);
  assert.ok(afterGuard - b.hp > 15);
  match.time += 0.2;
  b.snap[6] |= 256;
  const before = b.hp;
  shoot(match, a, shot);
  assert.equal(b.hp, before);
  assert.ok(a.hp < 110);
  assert.equal(b.counter, true);
});

test('area skills hit the aimed nearby enemy, stop at cover, and blade waves cannot hit behind offset cover', () => {
  for (const role of ['cannon', 'mage']) {
    const { match, a, b } = matchRoles(role, 'gunner');
    b.snap[2] = 2;
    castAbility(match, a, role === 'mage' ? 0 : 1);
    tickAbilities(match, 0);
    assert.ok(b.hp < 110, role);
    assert.ok(b.slowUntil > match.time);
  }
  const { match, a, b } = matchRoles('blade', 'gunner');
  b.snap[0] = 1;
  match.world.addBox(new THREE.Vector3(0.4, 0, 4), new THREE.Vector3(1.5, 3, 6));
  match.world.finalize();
  castAbility(match, a, 1);
  assert.equal(b.hp, 110);
  const covered = matchRoles('mage', 'gunner');
  covered.match.world.addBox(new THREE.Vector3(-3, 0, 4), new THREE.Vector3(3, 4, 5));
  covered.match.world.finalize();
  castAbility(covered.match, covered.a, 0);
  tickAbilities(covered.match, 0);
  assert.equal(covered.b.hp, 110);
});

test('mage must manage energy without hits; passive rewards hits and field damage is independent of tick size', () => {
  const { match, a, b } = matchRoles('mage');
  b.active = false;
  let blocked = 0;
  for (let t = 0; t < 2000; t++) {
    match.time = t / 10;
    tickAbilities(match, 0.1);
    for (let i = 0; i < 2; i++)
      if (match.time - a.skillAt[i] >= [10, 7][i] && !castAbility(match, a, i)) blocked++;
  }
  assert.ok(blocked > 0);
  function fieldDamage(dt) {
    const p = { id: 'mage', profile: profileOf(newCharacter('mage')), active: true, hp: 100 };
    resetAbilities(p);
    p.energy = 0;
    const enemy = { id: 'enemy', active: true, hp: 1000, snap: [0, 0, 0, 0, 0, 0, 0] };
    let damage = 0;
    const arena = {
      time: 0,
      targets: [p, enemy],
      world: { hasLineOfSight: () => true },
      fields: [{ owner: p.id, pos: new THREE.Vector3(0, 1, 0), until: 4, tickAt: 0, damage: 18 }],
      damage: (_t, n) => {
        damage += n;
      },
    };
    tickAbilities(arena, 0);
    for (let i = 1; i <= Math.ceil(4 / dt); i++) {
      arena.time = i * dt;
      tickAbilities(arena, dt);
    }
    assert.ok(p.energy > 4 * 4);
    return damage;
  }
  assert.equal(fieldDamage(0.016), 144);
  assert.equal(fieldDamage(0.1), 144);
  assert.equal(fieldDamage(0.8), 144);
});

test('slow constrains airborne dash momentum and ordinary PVE guards take chip damage', () => {
  const { ctx, pressed } = gameContext('blade');
  try {
    const p = ctx.player;
    p.body.pos.y = 8;
    p.body.onGround = false;
    p.slowUntil = 5;
    p.body.vel.set(20, 0, 0);
    pressed.add('dash');
    ctx.game.time = 1;
    p.update(0.02);
    assert.ok(Math.hypot(p.body.vel.x, p.body.vel.z) <= 10.6 * 0.55 + 0.001);
    p.weapon.blocking = true;
    p.weapon.blockT = 1;
    const before = p.hp;
    const result = p.tryDeflect({
      vel: p.forward.clone().negate(),
      dmg: 20,
      pos: p.eye.clone(),
      origin: p.eye.clone(),
    });
    assert.equal(result.ret, false);
    assert.ok(p.hp < before);
    p.blockCd = 0;
    assert.equal(p.tryDeflect({ blast: true, vel: p.forward.clone().negate(), dmg: 20 }), false);
  } finally {
    ctx.enemies.clear();
    ctx.effects.clear();
    disposeTree(ctx.scene);
  }
});

test('teams protect allies from bullets, melee, explosions and area slows; assists and wins belong to the team', () => {
  const { match, a, b, send } = matchRoles('mage', 'gunner');
  match.lobby();
  match.configureTeams(true);
  const ally = match.add('ally', '队友', profileOf(newCharacter('blade')));
  assert.equal(ally.team, a.team);
  assert.notEqual(a.team, b.team);
  match.start();
  for (const p of [a, b, ally]) {
    p.active = true;
    p.shield = 0;
    p.snap.splice(0, 3, 0, 0, p === a ? 10 : p === ally ? 8 : 2);
  }
  const allyHp = ally.hp;
  shoot(match, a, { kind: 'staff', origin: [0, 1.15, 10], dirs: [[0, 0, -1]] });
  assert.equal(ally.hp, allyHp);
  assert.ok(b.hp < 110);
  slash(match, a);
  assert.equal(ally.hp, allyHp);
  ally.snap.splice(0, 3, 1, 0, 2);
  castAbility(match, a, 0);
  tickAbilities(match, 0);
  assert.equal(ally.slowUntil, 0);
  advanceGrenade(
    match,
    { owner: a.id, pos: new THREE.Vector3(0, 1, 8), vel: new THREE.Vector3(), fuse: 0, damage: 30 },
    0.01,
  );
  assert.equal(ally.hp, allyHp);
  match.damage(ally, 99999, a.id);
  assert.equal(ally.hp, allyHp);
  match.damage(b, 1, ally.id);
  match.damage(b, 99999, a.id);
  assert.equal(ally.assists, 1);
  assert.equal(a.kills, 1);
  assert.deepEqual(match.teamScores, [1, 0]);
  match.damage(b, 99999, a.id);
  assert.deepEqual(match.teamScores, [1, 0]);
  validateRoom(match.snapshot());
  assert.throws(() => match.setTeam('ally', 2));
  match.spawn(b);
  b.active = true;
  b.shield = 0;
  match.teamScores[0] = 19;
  match.damage(b, 99999, a.id);
  assert.equal(match.winnerTeam, 1);
  assert.equal(match.winner, null);
  assert.equal(match.phase, 'over');
  validateRoom(match.snapshot());
  match.lobby();
  match.configureTeams(false);
  validateRoom(match.snapshot());
  match.configureTeams(true);
  match.setTeam('ally', 2);
  assert.equal(ally.team, 2);
  match.start();
  assert.equal(ally.assists, 0);
  assert.deepEqual(match.teamScores, [0, 0]);
  send('a', 'ready');
  send('b', 'ready');
  match.left = 0;
  match.tick(0);
  assert.equal(match.winnerTeam, null, 'equal team scores draw');
  match.lobby();
  match.configureTeams(false);
  match.start();
  assert.equal(a.team, 0);
  validateRoom(match.snapshot());
});

test('team protocol validates membership and scores, and a missing opponent pauses the round clock', () => {
  const { match, a, b } = matchRoles();
  match.lobby();
  match.configureTeams(true);
  match.start();
  a.active = true;
  match.tick(1);
  assert.equal(match.left, 600);
  b.active = true;
  match.tick(1);
  assert.equal(match.left, 599);
  const state = match.snapshot();
  for (const mutate of [
    (s) => {
      s.players[0].team = 3;
    },
    (s) => {
      s.players[0].assists = -1;
    },
    (s) => {
      s.teamScores = [0, NaN];
    },
    (s) => {
      s.teamsEnabled = 'true';
    },
    (s) => {
      s.winnerTeam = 0;
    },
  ]) {
    const invalid = structuredClone(state);
    mutate(invalid);
    assert.throws(() => validateRoom(invalid));
  }
});

test('health and armor investments recover equal effective health in PVP and training', () => {
  for (const points of [100, 900, 10000]) {
    const { match, a, b } = matchRoles('mage', 'mage');
    for (const [p, stat] of [
      [a, 'health'],
      [b, 'armor'],
    ]) {
      const c = newCharacter('mage');
      c.allocated[stat] = points;
      p.profile = profileOf(c);
      p.hp = p.profile.stats.health / 2;
      p.hurtAt = -100;
    }
    const before = [a.hp, b.hp];
    match.tick(1);
    for (const [i, p] of [a, b].entries())
      assert.ok(Math.abs((p.hp - before[i]) / armorDamage(1, p.profile) - 14) < 1e-8);
  }
  const { ctx } = gameContext('mage');
  try {
    ctx.profile.stats.armor = 900;
    ctx.player.hp = 50;
    ctx.player.lastDamageT = 10;
    ctx.game.time = 1;
    for (let i = 0; i < 5; i++) ctx.player.update(0.02);
    assert.ok(Math.abs(ctx.player.hp - 50.11) < 1e-8);
  } finally {
    ctx.effects.clear();
    disposeTree(ctx.scene);
  }
});

test('blade skills and attacks have a shared response window and rejected attempts do not consume cooldowns', () => {
  const { match, send, a, b } = matchRoles('blade', 'cannon');
  b.snap[2] = 4;
  send('a', 'skill', { index: 0 });
  const hp = b.hp;
  assert.equal(send('a', 'skill', { index: 1 }), false);
  assert.equal(send('a', 'melee'), false);
  assert.equal(a.skillAt[1], -100);
  assert.equal(b.hp, hp);
  match.time += 0.44;
  assert.equal(send('a', 'skill', { index: 1 }), false);
  match.time += 0.02;
  assert.equal(send('a', 'skill', { index: 1 }), true);
  assert.equal(send('a', 'melee'), false);
  match.time += 0.46;
  assert.equal(send('a', 'melee'), true);
  // A fresh skill cannot cancel an attack's recovery either.
  a.skillAt = [-100, -100];
  assert.equal(send('a', 'skill', { index: 0 }), false);
  match.time += 0.34;
  assert.equal(send('a', 'skill', { index: 0 }), true);
  const { ctx } = gameContext('blade');
  try {
    ctx.player.skill(0);
    assert.equal(bladeRecovering(ctx.player, ctx.game.time), true);
    assert.equal(ctx.player._weaponState(false, false, 0).blockFire, true);
    ctx.player.skill(1);
    assert.equal(ctx.player.skillTimes[1], -100);
  } finally {
    ctx.effects.clear();
    disposeTree(ctx.scene);
  }
});

test('gunner tactical barrier scales with skill, absorbs before armor, expires, syncs and resets on respawn', () => {
  const { match, a, b, send } = matchRoles('gunner', 'mage');
  a.profile.stats.skill = 200;
  a.profile.stats.armor = 900;
  send('a', 'skill', { index: 1 });
  assert.equal(a.barrier, 80);
  const hp = a.hp;
  match.damage(a, 50, b.id);
  assert.equal(a.hp, hp);
  assert.equal(a.barrier, 30);
  match.damage(a, 50, b.id);
  assert.equal(a.barrier, 0);
  assert.ok(Math.abs(a.hp - (hp - armorDamage(20, a.profile))) < 1e-8);
  const state = match.snapshot();
  validateRoom(state);
  assert.equal(state.players[0].barrierUntil, 6);
  const invalid = structuredClone(state);
  invalid.players[0].barrier = -1;
  assert.throws(() => validateRoom(invalid));
  a.skillAt[1] = -100;
  send('a', 'skill', { index: 1 });
  match.time += 4;
  const before = a.hp;
  match.damage(a, 10, b.id);
  assert.ok(Math.abs(before - a.hp - armorDamage(10, a.profile)) < 1e-8);
  assert.equal(a.barrier, 0);
  a.barrier = 80;
  match.spawn(a);
  assert.equal(a.barrier, 0);
  assert.equal(a.barrierUntil, 0);
  const { ctx } = gameContext('gunner');
  try {
    ctx.player.skill(1);
    const before = ctx.player.hp;
    ctx.player.takeDamage(50);
    assert.equal(ctx.player.hp, before - 10);
    assert.equal(ctx.player.training.actor.barrier, 0);
  } finally {
    ctx.effects.clear();
    disposeTree(ctx.scene);
  }
});

test('cannon hits aimed targets at 8/12/18 meters and charged shots land before shock slow expires', () => {
  for (const distance of [8, 12, 18]) {
    const { match, a, b, events } = matchRoles('cannon', 'gunner');
    b.snap[2] = 10 - distance;
    launchShell(match, a);
    for (let i = 0; i < 60 && match.grenades.length; i++) match.tick(0.02);
    assert.ok(b.hp < 110, `normal shot at ${distance}m`);
    assert.equal(events.filter((e) => e.type === 'shell-burst').length, 1);
    assert.equal(match.grenades.length, 0);
    const burst = events.find((e) => e.type === 'shell-burst');
    assert.equal(burst.shellId, events.find((e) => e.type === 'grenade').shellId);
    const accepted = [];
    const guest = {
      net: { isHost: false, connections: new Map([['a', {}]]) },
      state: match.snapshot(),
      onEvent: (e) => accepted.push(e),
    };
    for (const event of events.filter((e) => ['grenade', 'shell-burst'].includes(e.type)))
      Room.prototype.receive.call(guest, { type: 'event', event }, 'a');
    assert.equal(accepted.length, 2);
  }
  const { match, a, b, events } = matchRoles('cannon', 'cannon');
  b.snap[2] = -8;
  castAbility(match, a, 0);
  castAbility(match, a, 1);
  const until = b.slowUntil;
  while (!events.some((e) => e.type === 'shell-burst') && match.time < until + 1) match.tick(0.02);
  assert.ok(events.some((e) => e.type === 'shell-burst'));
  assert.ok(match.time < until, 'charged shot fits the 2s control window');
});

test('cannon collision respects walls, allies and long simulation frames; visual shells disappear at authoritative impact', () => {
  const { match, a, b, events } = matchRoles('cannon', 'gunner');
  a.team = b.team = 1;
  b.snap[2] = 7;
  const enemy = match.add('enemy', '敌方', profileOf(newCharacter('gunner')));
  enemy.team = 2;
  enemy.active = true;
  enemy.shield = 0;
  enemy.snap.splice(0, 3, 0, 0, 0);
  launchShell(match, a);
  match.tick(1);
  assert.equal(b.hp, 110);
  assert.ok(enemy.hp < 110);
  const { ctx } = gameContext('cannon');
  try {
    ctx.player.throwGrenade(events.find((e) => e.type === 'grenade'));
    assert.equal(ctx.player.nades.length, 1);
    ctx.player.burstShell(events.find((e) => e.type === 'shell-burst'));
    assert.equal(ctx.player.nades.length, 0);
  } finally {
    ctx.effects.clear();
    disposeTree(ctx.scene);
  }
  const wallCase = matchRoles('cannon', 'gunner');
  wallCase.match.world.addBox(new THREE.Vector3(-5, 0, 5), new THREE.Vector3(5, 5, 6));
  wallCase.match.world.finalize();
  launchShell(wallCase.match, wallCase.a);
  wallCase.match.tick(1);
  assert.equal(wallCase.b.hp, 110);
  assert.equal(wallCase.events.filter((e) => e.type === 'shell-burst').length, 1);
  const charged = matchRoles('cannon', 'gunner');
  castAbility(charged.match, charged.a, 0);
  charged.match.tick(0.81);
  assert.equal(
    charged.match.grenades.length,
    1,
    'newly launched shell cannot move through the preceding charge time',
  );
  assert.equal(charged.b.hp, 110);
  charged.match.tick(0.5);
  assert.ok(charged.b.hp < 110);
});

test('exploration guests accept cannon impact packets and reject malformed shell identities', async () => {
  const accepted = [];
  const guest = {
    net: { connections: new Map([['host', {}]]) },
    ctx: { player: { throwGrenade: (e) => accepted.push(e), burstShell: (e) => accepted.push(e) } },
    chunks: { position: (v) => new THREE.Vector3(v.x, v.y, v.z) },
  };
  const packet = {
    id: 'host',
    shellId: crypto.randomUUID(),
    pos: { cx: 0, cz: 0, x: 50, y: 1, z: 50 },
    vel: [0, 1, -25],
  };
  await Exploration.prototype.receive.call(guest, 'grenade', packet, 'host');
  await Exploration.prototype.receive.call(guest, 'shell-burst', packet, 'host');
  assert.equal(accepted.length, 2);
  assert.equal(accepted[0].shellId, accepted[1].shellId);
  await assert.rejects(
    Exploration.prototype.receive.call(guest, 'shell-burst', { ...packet, shellId: '' }, 'host'),
  );
  const p = { barrier: 80, barrierUntil: 2 };
  assert.equal(absorbBarrier(p, 100, 1), 20);
});

test('shells and grenades stop at fuse expiry across frame rates, hitches and zero-length frames', () => {
  for (const shell of [false, true]) {
    for (const dt of [0.02, 0.1, 0.5, 2]) {
      const world = new World();
      world.finalize();
      const events = [],
        arena = { time: 0, world, targets: [], emit: (e) => events.push(e) };
      const grenade = {
        pos: new THREE.Vector3(0, 100, 0),
        vel: new THREE.Vector3(0, 1, -25),
        fuse: 1.2,
        ...(shell ? { shellId: crypto.randomUUID(), bornAt: 0 } : {}),
      };
      assert.equal(advanceGrenade(arena, grenade, 0), false);
      let burst = false;
      for (let i = 0; i < Math.ceil(1.2 / dt); i++) {
        arena.time += dt;
        burst = advanceGrenade(arena, grenade, dt);
        if (burst) break;
      }
      assert.equal(burst, true, `${shell ? 'shell' : 'grenade'} expires at ${dt}s steps`);
      assert.ok(Math.abs(grenade.pos.z + 30) < 1e-8, `range at ${dt}s steps`);
      assert.ok(Number.isFinite(grenade.pos.y));
      assert.equal(events.length, shell ? 1 : 0);
    }
  }
});

test('remote combat cues follow host deadlines, absorbed shields, canceled charges and death', () => {
  const ctx = { scene: new THREE.Scene() },
    remote = new RemotePlayer(ctx, 'a', '甲', 1, INK.RED);
  try {
    for (const [role, field, duration] of [
      ['gunner', 'barrierEffect', 4],
      ['cannon', 'chargeEffect', 0.8],
      ['blade', 'recoveryEffect', 0.45],
    ]) {
      const { match, a } = matchRoles(role);
      castAbility(match, a, role === 'gunner' ? 1 : 0);
      const state = match.snapshot(),
        p = state.players.find((p) => p.id === a.id);
      validateRoom(state);
      remote.push(p.snap, 500, p, state.time);
      remote.update(0, 500);
      assert.equal(remote[field].visible, true, role);
      remote.update(0.01, 500 + duration + 0.01);
      assert.equal(remote[field].visible, false, `${role} expires without another packet`);
      remote.push(p.snap, 501, p, state.time);
      remote.update(0, 501);
      const dead = [...p.snap];
      dead[6] &= ~64;
      dead[7] = 0;
      remote.push(dead, 501, p, state.time);
      remote.update(0, 501);
      assert.equal(remote[field].visible, false, `${role} hidden on death`);
      remote.push(p.snap, 502, { ...p, barrier: 0, chargedAt: null, skillAt: [-100, -100] }, state.time);
      remote.update(0, 502);
      assert.equal(remote[field].visible, false, `${role} cleared by authoritative state`);
      p.chargedAt = Infinity;
      assert.throws(() => validateRoom(state), /蓄力状态无效/);
    }
  } finally {
    remote.dispose();
  }
  assert.equal(ctx.scene.children.length, 0);
});

test('PVP ability effects distinguish own, allied and hostile casts in teams and free-for-all', () => {
  const effects = [];
  const player = {
    ctx: { effects: { tracer: (...args) => effects.push(args) } },
    showAbility: Player.prototype.showAbility,
  };
  const roster = [
    { id: 'self', team: 1 },
    { id: 'friend', team: 1 },
    { id: 'enemy', team: 2 },
  ];
  const multiplayer = { ctx: { player }, room: { net: { id: 'self' }, state: { players: roster } } };
  for (const role of ['mage', 'cannon']) {
    for (const [id, ink] of [
      ['self', INK.BLUE],
      ['friend', INK.BLUE],
      ['enemy', INK.RED],
    ]) {
      effects.length = 0;
      Multiplayer.prototype.event.call(multiplayer, {
        type: 'ability',
        id,
        role,
        index: role === 'mage' ? 0 : 1,
        origin: [0, 1, 0],
        end: [0, 1, -10],
      });
      assert.equal(effects.length, 25);
      assert.ok(
        effects.every((e) => e[2] === ink),
        `${role} ${id}`,
      );
    }
  }
  roster.forEach((p) => {
    p.team = 0;
  });
  effects.length = 0;
  Multiplayer.prototype.event.call(multiplayer, {
    type: 'ability',
    id: 'friend',
    role: 'mage',
    index: 0,
    origin: [0, 1, 0],
    end: [0, 1, -10],
  });
  assert.ok(
    effects.every((e) => e[2] === INK.RED),
    'other players are hostile in free-for-all',
  );
});
