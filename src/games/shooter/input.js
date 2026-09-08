// Unified keyboard/mouse + gamepad (PS5 DualSense / standard mapping) input.
import { clamp } from './util.js';

const KEYMAP = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  ControlLeft: 'crouch',
  KeyC: 'crouch',
  KeyR: 'reload',
  KeyQ: 'grapple',
  KeyE: 'grapple',
  KeyF: 'melee',
  KeyV: 'melee',
  Digit1: 'slot1',
  Digit2: 'slot2',
  Digit3: 'slot3',
  Digit4: 'slot4',
  Digit5: 'slot5',
  Escape: 'pause',
  KeyP: 'pause',
  Enter: 'confirm',
  KeyG: 'grenade',
  KeyX: 'dash',
  AltLeft: 'dash',
  KeyM: 'music',
  KeyT: 'talk',
  Tab: 'score',
};
const MOUSEMAP = { 0: 'fire', 2: 'aim', 1: 'grapple', 3: 'grapple', 4: 'melee' };
// Standard gamepad mapping (DualSense): 0 cross,1 circle,2 square,3 triangle,4 L1,5 R1,6 L2,7 R2,8 create,9 options,10 L3,11 R3,12-15 dpad
const PADMAP = {
  0: 'jump',
  1: 'crouch',
  2: 'reload',
  3: 'nextWeapon',
  4: 'grapple',
  5: 'melee',
  6: 'aim',
  7: 'fire',
  9: 'pause',
  10: 'sprint',
  11: 'grenade',
  12: 'grenade',
  13: 'slot5',
  14: 'prevWeapon',
  15: 'nextWeapon',
  8: 'score',
  17: 'confirm',
};

export class Input {
  constructor(canvas, signal) {
    this.canvas = canvas;
    this.state = {};
    this.prev = {};
    this.frameState = {};
    this.keys = {};
    this.mouseBtns = {};
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.mx = 0;
    this.my = 0;
    this.wheel = 0;
    this.mouseSens = 0.0022;
    this.padSensX = 3.4;
    this.padSensY = 2.6;
    this.usingGamepad = false;
    this.gamepadIndex = -1;
    this.padHoldTime = 0;
    this.pointerLocked = false;
    this.anyInput = false;
    this.lastPadButtons = [];
    this.onLockChange = null;
    this.onAnyInput = null;
    this.lastActive = performance.now();
    this.invertY = false;
    this.onDeviceChange = null;

    this.keyCodes = new Set();
    this.padState = {};
    this.padPrev = {};
    const listen = (target, event, callback, options = {}) =>
      target.addEventListener(event, callback, { ...options, signal });
    const isControl = (target) =>
      target instanceof Element &&
      !!target.closest('input, select, textarea, button, summary, [contenteditable]');
    listen(window, 'keydown', (e) => {
      if (e.repeat || isControl(e.target)) return;
      if (KEYMAP[e.code]) this.keyCodes.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.useMouse();
    });
    listen(window, 'keyup', (e) => this.keyCodes.delete(e.code));
    listen(window, 'blur', () => this.clear());
    listen(document, 'visibilitychange', () => {
      if (document.hidden) this.clear();
    });
    listen(document, 'mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mx += clamp(e.movementX, -400, 400);
      this.my += clamp(e.movementY, -400, 400);
      this.useMouse();
    });
    listen(document, 'mousedown', (e) => {
      if (!this.pointerLocked) return;
      const action = MOUSEMAP[e.button];
      if (action) this.mouseBtns[action] = true;
      this.useMouse();
      if ([1, 3, 4].includes(e.button)) e.preventDefault();
    });
    listen(document, 'mouseup', (e) => {
      const action = MOUSEMAP[e.button];
      if (action) this.mouseBtns[action] = false;
    });
    listen(canvas, 'contextmenu', (e) => e.preventDefault());
    listen(
      document,
      'wheel',
      (e) => {
        if (this.pointerLocked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    listen(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      this.clear();
      if (this.onLockChange) this.onLockChange(this.pointerLocked);
    });
    listen(window, 'gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
  }
  useMouse() {
    if (this.usingGamepad && this.onDeviceChange) this.onDeviceChange(false);
    this.usingGamepad = false;
    this.anyInput = true;
    this.lastActive = performance.now();
  }
  clear() {
    this.keyCodes.clear();
    this.keys = {};
    this.mouseBtns = {};
    this.state = {};
    this.prev = {};
    this.padState = {};
    this.padPrev = {};
    this.mx = 0;
    this.my = 0;
    this.wheel = 0;
    this.move.x = this.move.y = this.look.x = this.look.y = 0;
  }
  async requestLock() {
    if (this.pointerLocked) return true;
    try {
      await this.canvas.requestPointerLock();
      if (document.pointerLockElement !== this.canvas) throw new Error('Browser did not capture the mouse');
      this.pointerLocked = true;
      return true;
    } catch (error) {
      if (!this.onLockError) throw error;
      this.onLockError(error);
      return false;
    }
  }
  exitLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  _getPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.gamepadIndex >= 0 && pads[this.gamepadIndex]) return pads[this.gamepadIndex];
    for (const p of pads)
      if (p && p.connected) {
        this.gamepadIndex = p.index;
        return p;
      }
    return null;
  }

  update(dt) {
    // rotate button states
    this.prev = this.state;
    this.state = {};
    const s = this.state;
    for (const code of this.keyCodes) s[KEYMAP[code]] = true;
    for (const k in this.mouseBtns) if (this.mouseBtns[k]) s[k] = true;
    if (this.wheel > 0) s.nextWeapon = true;
    else if (this.wheel < 0) s.prevWeapon = true;
    this.wheel = 0;

    // movement from keys
    let mx = (s.right ? 1 : 0) - (s.left ? 1 : 0);
    let my = (s.forward ? 1 : 0) - (s.back ? 1 : 0);
    // look from mouse
    let lx = -this.mx * this.mouseSens,
      ly = -this.my * this.mouseSens;
    this.mx = 0;
    this.my = 0;

    const pad = this._getPad();
    const padS = {};
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
      const ax = dz(pad.axes[0] || 0),
        ay = dz(pad.axes[1] || 0),
        rx = dz(pad.axes[2] || 0),
        ry = dz(pad.axes[3] || 0);
      let padActive = false;
      if (Math.abs(ax) > 0 || Math.abs(ay) > 0) {
        mx = ax;
        my = -ay;
        padActive = true;
      }
      if (Math.abs(rx) > 0 || Math.abs(ry) > 0) {
        padActive = true;
        const mag = Math.hypot(rx, ry);
        if (mag > 0.94) this.padHoldTime += dt;
        else this.padHoldTime = 0;
        const accel = 1 + clamp((this.padHoldTime - 0.25) / 0.6, 0, 1) * 0.9;
        const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.8);
        lx += -curve(rx) * this.padSensX * accel * dt;
        ly += -curve(ry) * this.padSensY * accel * dt;
      } else this.padHoldTime = 0;
      for (const idx in PADMAP) {
        const b = pad.buttons[idx];
        if (!b) continue;
        const pressed = b.pressed || b.value > 0.35;
        if (pressed) {
          s[PADMAP[idx]] = true;
          padS[PADMAP[idx]] = true;
          padActive = true;
        }
      }
      if (padActive) {
        if (!this.usingGamepad && this.onDeviceChange) this.onDeviceChange(true);
        this.usingGamepad = true;
        this.anyInput = true;
        this.lastActive = performance.now();
      }
      this._pad = pad;
    } else {
      this._pad = null;
      if (this.usingGamepad) {
        this.usingGamepad = false;
        if (this.onDeviceChange) this.onDeviceChange(false);
      }
    }
    this.padPrev = this.padState;
    this.padState = padS;

    const ml = Math.hypot(mx, my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }
    this.move.x = mx;
    this.move.y = my;
    this.look.x = lx;
    this.look.y = this.invertY ? -ly : ly;
  }

  down(a) {
    return !!this.state[a];
  }
  get idleSeconds() {
    return (performance.now() - this.lastActive) / 1000;
  }
  pressed(a) {
    return (!!this.state[a] && !this.prev[a]) || (!!this.padState[a] && !this.padPrev[a]);
  }
  released(a) {
    return !this.state[a] && !!this.prev[a];
  }
  consume(a) {
    this.state[a] = false;
  }
  anyPressed() {
    for (const k in this.state) if (this.state[k] && !this.prev[k]) return true;
    return false;
  }

  rumble(strong = 0.5, weak = 0.5, ms = 80) {
    const pad = this._pad;
    if (!pad) return;
    const act = pad.vibrationActuator || (pad.hapticActuators && pad.hapticActuators[0]);
    if (!act || !act.playEffect) return;
    void act.playEffect('dual-rumble', {
      duration: ms,
      strongMagnitude: clamp(strong, 0, 1),
      weakMagnitude: clamp(weak, 0, 1),
    });
  }
}
