import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, makeBody } from '../src/games/shooter/physics.js';
import { NavGrid } from '../src/games/shooter/nav.js';
import { buildLevel, LEVELS } from '../src/games/shooter/level.js';
import { Player } from '../src/games/shooter/player.js';
import { EnemyManager } from '../src/games/shooter/enemies/manager.js';
import { TYPES } from '../src/games/shooter/enemies/types.js';
import { Effects } from '../src/games/shooter/effects.js';
import { createWaves } from '../src/games/shooter/systems/waves.js';
import { createPreferences, STORAGE_PREFIX } from '../src/games/shooter/preferences.js';
import { disposeTree } from '../src/shared/resources.js';
import { choose } from '../src/games/shooter/util.js';

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
  };
}

test('preferences reject corruption and write errors without overwriting saved data', () => {
  const storage = memoryStorage();
  const prefs = createPreferences(storage);
  assert.equal(prefs.get('sensitivity'), 100);
  prefs.set('sensitivity', 150);
  assert.equal(createPreferences(storage).get('sensitivity'), 150);
  for (const value of [null, '100', -1, 251, NaN]) assert.throws(() => prefs.set('sensitivity', value));
  assert.throws(() => prefs.set('checkpoint', 6));
  assert.throws(() => prefs.set('map', 'missing'));
  storage.setItem(STORAGE_PREFIX + 'best', '{broken');
  assert.throws(() => createPreferences(storage), SyntaxError);
  assert.equal(storage.getItem(STORAGE_PREFIX + 'best'), '{broken');
  storage.setItem(STORAGE_PREFIX + 'best', 'null');
  assert.throws(() => createPreferences(storage), /Invalid saved preference/);
  storage.setItem = () => {
    throw new Error('quota exceeded');
  };
  assert.throws(() => prefs.set('sensitivity', 200), /quota exceeded/);
  assert.equal(prefs.get('sensitivity'), 150);
});

test('collision blocks fast movement, lands on floor and preserves line of sight', () => {
  const world = new World();
  world.addBox(new THREE.Vector3(-20, -1, -20), new THREE.Vector3(20, 0, 20));
  world.addBox(new THREE.Vector3(2, 0, -4), new THREE.Vector3(2.1, 8, 4));
  world.finalize();
  const body = makeBody(new THREE.Vector3(0, 1, 0), 0.35, 1.75);
  body.vel.set(500, 0, 0);
  world.moveBody(body, 0.05);
  assert.ok(body.pos.x <= 1.651, `tunneled through wall: ${body.pos.x}`);
  body.vel.set(0, -22, 0);
  world.moveBody(body, 0.05);
  assert.ok(body.onGround);
  assert.ok(Math.abs(body.pos.y) < 0.001);
  assert.equal(world.raycast(new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 0, 0), 10).dist, 2);
  assert.equal(world.hasLineOfSight(new THREE.Vector3(0, 2, 0), new THREE.Vector3(4, 2, 0)), false);
  assert.throws(() => world.moveBody(body, NaN), /timestep/);
  body.vel.set(Number.MAX_VALUE, 0, 0);
  assert.throws(() => world.moveBody(body, 0.01), /substep budget/);
  body.pos.x = NaN;
  assert.throws(() => world.moveBody(body, 0.01), /Non-finite/);
  assert.throws(() => new World(0));
  assert.throws(() => choose([]));
});

test('navigation rebuild does not duplicate nodes and finds a walkable path', () => {
  const world = new World();
  world.addBox(new THREE.Vector3(-5, -1, -5), new THREE.Vector3(5, 0, 5));
  world.finalize();
  const nav = new NavGrid(world, { minX: -4, maxX: 4, minZ: -4, maxZ: 4 }).build();
  const count = nav.nodes.length;
  nav.build();
  assert.equal(nav.nodes.length, count);
  const path = nav.findPath(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 0, 3));
  assert.ok(path.complete);
  assert.ok(path.length > 1);
});

// Real world, effects, weapons and enemies; only browser HUD/audio output is excluded.
function context() {
  const scene = new THREE.Scene();
  const world = new World();
  const level = buildLevel(scene, world, 'district');
  const hud = {
    key: (action) => action,
    setWeapon() {},
    setCrosshairMode() {},
    grappleTarget() {},
    setBoss() {},
    setModifier() {},
    message() {},
    tip() {},
    kill() {},
    setTimer() {},
    setWave() {},
    hitmarker() {},
    damageFrom() {},
  };
  const game = {
    mode: 'solo',
    wave: 0,
    queue: [],
    score: 0,
    kills: 0,
    combo: 0,
    katanaStreak: 0,
    hitstop() {},
    addScore(points) {
      this.score += points;
    },
    onPlayerDeath() {},
  };
  const ctx = {
    scene,
    world,
    level,
    hud,
    game,
    camera: new THREE.PerspectiveCamera(),
    input: { rumble() {} },
    audio: { wave() {}, bossRoar() {}, waveClear() {}, kill() {} },
  };
  ctx.effects = new Effects(scene, world);
  ctx.enemies = new EnemyManager(ctx);
  ctx.player = new Player(ctx);
  return ctx;
}

test('district loads all required spawn collections and rejects an unknown map', () => {
  const ctx = context();
  assert.deepEqual(
    LEVELS.map((level) => level.key),
    ['district'],
  );
  for (const key of ['spawns', 'snipers', 'pickups', 'rings']) assert.ok(ctx.level[key].length > 0, key);
  assert.equal(ctx.world.overlapsBody(ctx.player.body), false);
  assert.throws(() => buildLevel(ctx.scene, ctx.world, 'typo'), /Unknown map/);
  disposeTree(ctx.scene);
});

test('wave composition, boss rotation, checkpoint and intermission work together', (t) => {
  const ctx = context();
  const prefs = createPreferences(memoryStorage());
  let pickupCount = 0;
  const waves = createWaves(
    ctx,
    {
      spawn() {
        pickupCount++;
      },
    },
    { chargeKills: 3, enter() {} },
    prefs,
  );
  assert.throws(() => waves.start(0), /Invalid wave/);
  waves.start(1);
  assert.equal(ctx.game.queue.length, 7);
  assert.ok(ctx.game.queue.every((type) => type === 'grunt'));
  assert.equal(pickupCount, 7);
  for (const [wave, boss] of [
    [5, 'boss'],
    [10, 'eraser'],
    [15, 'inkblot'],
    [20, 'boss'],
  ]) {
    waves.start(wave);
    assert.equal(ctx.game.queue[0], boss);
    ctx.game.spawnT = 0;
    waves.update(0.01);
    assert.equal(ctx.enemies.enemies.at(-1).type, boss);
    ctx.enemies.clear();
    ctx.effects.clear();
  }
  assert.equal(prefs.get('checkpoint'), 20);
  waves.start(1);
  ctx.game.queue.length = 0;
  waves.update(0.01);
  assert.equal(ctx.game.intermission, 8);
  assert.equal(ctx.game.score, 200);
  waves.update(8);
  assert.equal(ctx.game.wave, 2);
  // Display-name translation must not change the swarm's gameplay rules.
  t.mock.method(Math, 'random', () => 0.99);
  waves.start(6);
  assert.equal(ctx.game.queue.length, 23);
  assert.equal(ctx.game.maxAlive, 12);
  disposeTree(ctx.scene);
});

test('new run resets reloads, pump, katana guard, recoil, grenade and grapple state', () => {
  const ctx = context();
  const player = ctx.player;
  const rifle = player.weapons[0],
    shotgun = player.weapons[1],
    katana = player.weapons[3];
  rifle.mag = 0;
  rifle.reloading = true;
  rifle.autoReloadT = 0.25;
  shotgun.needPump = true;
  shotgun.pumpT = 1;
  katana.slashT = 1;
  katana.blocking = true;
  katana.cooldown = 2;
  katana.bloodLevel = 1;
  player.returnT = 0.5;
  player.nadeCd = 1;
  player.recoilPitch.kick(5);
  player.switchTo(3, true);
  player.reset(ctx.level.playerStart);
  assert.equal(player.weaponIndex, 0);
  assert.equal(rifle.mag, rifle.magSize);
  assert.equal(rifle.reloading, false);
  assert.equal(rifle.autoReloadT, 0);
  assert.equal(shotgun.needPump, false);
  assert.equal(shotgun.pumpT, 0);
  assert.equal(katana.slashT, 0);
  assert.equal(katana.blocking, false);
  assert.equal(katana.cooldown, 0);
  assert.equal(player.returnT, 0);
  assert.equal(player.nadeCd, 0);
  assert.equal(player.recoilPitch.vel, 0);
  assert.throws(() => player.switchTo(10), /Invalid weapon/);
  assert.throws(() => player.takeDamage(NaN), /Invalid player damage/);
  disposeTree(ctx.scene);
});

test('all enemy types spawn; a kill is counted once; expired bodies leave the index', () => {
  const ctx = context();
  const enemies = ctx.enemies;
  for (const type of Object.keys(TYPES)) {
    const enemy = enemies.spawn(type, ctx.level.spawns[0]);
    assert.ok(Number.isFinite(enemy.hp));
    assert.ok(enemy.root.children.length > 0);
  }
  enemies.clear();
  ctx.effects.clear();
  const enemy = enemies.spawn('grunt', ctx.level.spawns[0]);
  const info = {
    source: 'rifle',
    dir: new THREE.Vector3(0, 0, -1),
    point: enemy.body.pos.clone(),
    part: 'torso',
  };
  assert.throws(() => enemies.damage(enemy, NaN, info), /Invalid enemy damage/);
  enemies.kill(enemy, info);
  enemies.kill(enemy, info);
  assert.equal(enemies.alive, 0);
  enemy.deadT = 10;
  enemies.update(0.01);
  assert.equal(enemies.byId.size, 0);
  assert.throws(() => enemies.spawn('typo', new THREE.Vector3()), /Unknown enemy/);
  ctx.effects.clear();
  assert.equal(ctx.effects.gibsAlive, 0);
  disposeTree(ctx.scene);
});

test('resource teardown disposes shared geometry and material once per tree', () => {
  const root = new THREE.Group(),
    geometry = new THREE.BoxGeometry(),
    material = new THREE.MeshBasicMaterial();
  let geometryCount = 0,
    materialCount = 0;
  geometry.addEventListener('dispose', () => geometryCount++);
  material.addEventListener('dispose', () => materialCount++);
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  disposeTree(root);
  assert.equal(geometryCount, 1);
  assert.equal(materialCount, 1);
});
