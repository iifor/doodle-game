import test from 'node:test';
import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { TouchInput } from '../src/games/shooter/touch-input.js';
import { Input } from '../src/games/shooter/input.js';
import { Player } from '../src/games/shooter/player.js';
import { createPreferences, STORAGE_PREFIX } from '../src/games/shooter/preferences.js';

function enabled(options) {
  const touch = new TouchInput(options);
  touch.setEnabled(true);
  return touch;
}

test('three pointers independently move, aim and fire; stick has a radial deadzone and speed cap', () => {
  const touch = enabled();
  touch.begin(1, 'move', 50, 50, { x: 50, y: 50, radius: 50 });
  touch.movePointer(1, 53, 52);
  assert.deepEqual(touch.sample().move, { x: 0, y: 0 });
  touch.movePointer(1, 150, -50);
  touch.begin(2, 'look', 300, 100);
  touch.movePointer(2, 330, 90);
  touch.begin(3, 'fire', 600, 200);
  touch.movePointer(3, 610, 200);
  let frame = touch.sample();
  assert.ok(Math.abs(Math.hypot(frame.move.x, frame.move.y) - 1) < 1e-12);
  assert.equal(frame.look.x, -0.16);
  assert.equal(frame.look.y, 0.04);
  assert.equal(frame.state.fire, true);
  touch.end(2);
  frame = touch.sample();
  assert.deepEqual(frame.look, { x: 0, y: 0 });
  assert.equal(frame.state.fire, true);
  assert.ok(frame.move.x > 0);
  touch.end(3);
  touch.end(1);
  frame = touch.sample();
  assert.equal(frame.state.fire, undefined);
  assert.deepEqual(frame.move, { x: 0, y: 0 });
});

test('short taps survive between frames, repeated jump presses and all weapon slots are delivered', () => {
  const touch = enabled();
  for (let id = 0; id < 2; id++) {
    touch.begin(id, 'jump', 0, 0);
    touch.end(id);
  }
  assert.ok(touch.sample().pressed.has('jump'));
  assert.ok(touch.sample().pressed.has('jump'));
  assert.ok(!touch.sample().pressed.has('jump'));
  for (const action of [
    'slot1',
    'slot2',
    'slot3',
    'slot4',
    'grapple',
    'melee',
    'dash',
    'crouch',
    'reload',
    'pause',
    'grenade',
    'fire',
  ]) {
    touch.begin(1, action, 0, 0);
    touch.end(1);
    assert.ok(touch.sample().pressed.has(action), action);
    assert.equal(touch.sample().state[action], undefined, action);
  }
  assert.throws(() => touch.begin(1, 'unknown', 0, 0), /未知触屏动作/);
});

test('gun aim toggles, katana blocks only while held, sprint clears when forward movement ends', () => {
  const touch = enabled();
  const tap = (action) => {
    touch.begin(1, action, 0, 0);
    touch.end(1);
  };
  tap('aim');
  assert.equal(touch.sample().state.aim, true);
  tap('aim');
  assert.equal(touch.sample().state.aim, undefined);
  tap('aim');
  touch.setWeapon('katana', 3);
  assert.equal(touch.sample().state.aim, undefined);
  touch.begin(2, 'aim', 0, 0);
  assert.equal(touch.sample().state.aim, true);
  touch.end(2);
  assert.equal(touch.sample().state.aim, undefined);
  touch.begin(2, 'move', 50, 0, { x: 50, y: 50, radius: 50 });
  tap('sprint');
  assert.equal(touch.sample().state.sprint, true);
  touch.movePointer(2, 50, 60);
  assert.equal(touch.sample().state.sprint, undefined);
  tap('score');
  assert.equal(touch.sample().state.score, true);
  tap('score');
  assert.equal(touch.sample().state.score, undefined);
});

test('cancel and lifecycle clear discard pending releases and charged grenades without throwing', () => {
  const player = { _nadeHeld: true, nadeCharge: 0.8, sprintToggle: true, jumpBuffer: 0.1, sliding: true };
  const touch = enabled({ cancel: (action) => Player.prototype.cancelInput.call(player, action) });
  touch.begin(1, 'grenade', 0, 0);
  touch.begin(2, 'fire', 0, 0);
  touch.end(1, true);
  assert.equal(player._nadeHeld, false);
  assert.equal(player.nadeCharge, 0);
  assert.equal(touch.sample().state.grenade, undefined);
  assert.equal(touch.sample().state.fire, true);
  touch.setEnabled(false);
  assert.deepEqual(touch.sample().state, {});
  assert.equal(player.sprintToggle, false);
  assert.equal(player.sliding, false);
  assert.equal(touch.begin(3, 'jump', 0, 0), false);
});

test('DOM binding releases capture and removes listeners on abort', () => {
  const signal = new AbortController();
  const root = new EventTarget();
  root.style = { setProperty() {} };
  root.querySelectorAll = () => [];
  const captures = new Set();
  const target = {
    dataset: { touch: 'fire' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 64, height: 64 }),
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id),
    closest: () => target,
  };
  const down = () => {
    const event = new Event('pointerdown', { cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    Object.assign(event, { pointerId: 1, pointerType: 'touch', clientX: 30, clientY: 30 });
    root.dispatchEvent(event);
  };
  const touch = enabled();
  touch.mount(root, signal.signal);
  down();
  assert.ok(captures.has(1));
  assert.equal(touch.sample().state.fire, true);
  signal.abort();
  assert.equal(captures.size, 0);
  assert.equal(touch.root, null);
  down();
  assert.deepEqual(touch.sample().state, {});
});

test('device transitions clear held touch, keyboard and pad input, and listeners clean up', (t) => {
  let pads = [];
  const win = new EventTarget();
  const doc = new EventTarget();
  const canvas = new EventTarget();
  const environment = {
    window: win,
    document: doc,
    navigator: { getGamepads: () => pads },
    matchMedia: () => ({ matches: true }),
    Element: class {},
  };
  for (const [key, value] of Object.entries(environment)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => (original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]));
  }
  const lifetime = new AbortController();
  setMaxListeners(0, lifetime.signal);
  const input = new Input(canvas, lifetime.signal);
  const devices = [];
  input.onDeviceChange = (d) => devices.push(d);
  input.touch.setEnabled(true);
  input.touch.begin(1, 'fire', 0, 0);
  input.touch.end(1);
  input.update(1 / 60);
  assert.ok(input.pressed('fire'));
  input.update(1 / 60);
  assert.ok(!input.down('fire'));
  input.touch.begin(2, 'fire', 0, 0);
  const key = new Event('keydown');
  Object.assign(key, { code: 'KeyW', repeat: false });
  win.dispatchEvent(key);
  input.update(1 / 60);
  assert.equal(input.device, 'mouse');
  assert.equal(input.move.y, 1);
  assert.ok(!input.down('fire'));
  pads = [{ connected: true, index: 0, axes: [0.5, 0, 0, 0], buttons: [{ pressed: true, value: 1 }] }];
  input.update(1 / 60);
  assert.ok(input.usingGamepad);
  assert.ok(input.pressed('jump'));
  assert.equal(input.keyCodes.size, 0);
  pads = [];
  input.update(1 / 60);
  assert.equal(input.device, 'touch');
  assert.deepEqual(input.move, { x: 0, y: 0 });
  assert.deepEqual(devices, ['mouse', 'gamepad', 'touch']);
  lifetime.abort();
  input.clear();
  win.dispatchEvent(key);
  input.update(1 / 60);
  assert.equal(input.keyCodes.size, 0);
});

test('mobile defaults do not reset existing preferences or overwrite invalid new keys', () => {
  const values = new Map([[STORAGE_PREFIX + 'best', '123']]);
  const storage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
  };
  const mobile = createPreferences(storage, { touch: true });
  assert.equal(mobile.get('quality'), 'smooth');
  assert.equal(mobile.get('best'), 123);
  assert.equal(createPreferences(storage).get('quality'), 'standard');
  mobile.set('quality', 'standard');
  assert.equal(createPreferences(storage, { touch: true }).get('quality'), 'standard');
  assert.throws(() => mobile.set('touchSensitivity', 0));
  assert.throws(() => mobile.set('quality', 'ultra'));
  storage.setItem(STORAGE_PREFIX + 'touchSensitivity', 'null');
  assert.throws(() => createPreferences(storage, { touch: true }), /Invalid saved preference/);
  assert.equal(storage.getItem(STORAGE_PREFIX + 'touchSensitivity'), 'null');
});
