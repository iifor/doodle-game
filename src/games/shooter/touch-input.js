const ACTIONS = new Set([
  'move',
  'look',
  'fire',
  'aim',
  'jump',
  'crouch',
  'grapple',
  'grenade',
  'melee',
  'dash',
  'reload',
  'sprint',
  'score',
  'pause',
  'slot1',
  'slot2',
  'slot3',
  'slot4',
]);
const TOGGLES = new Set(['sprint', 'score']);

// Touch owns pointers and pending presses; the game consumes one snapshot per frame.
export class TouchInput {
  constructor({ activate = () => {}, cancel = () => {} } = {}) {
    this.activate = activate;
    this.cancel = cancel;
    this.pointers = new Map();
    this.presses = new Map();
    this.toggles = new Set();
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.enabled = false;
    this.weapon = 'rifle';
    this.sensitivity = 0.004;
  }
  begin(id, action, x, y, center = { x, y, radius: 50 }) {
    if (!ACTIONS.has(action)) throw new Error(`未知触屏动作：${action}`);
    if (
      !this.enabled ||
      this.pointers.has(id) ||
      [...this.pointers.values()].some((p) => p.action === action)
    )
      return false;
    this.activate();
    this.pointers.set(id, { action, x, y, center });
    if (TOGGLES.has(action) || (action === 'aim' && this.weapon !== 'katana')) {
      if (this.toggles.has(action)) this.toggles.delete(action);
      else this.toggles.add(action);
    } else if (!['move', 'look'].includes(action)) {
      this.presses.set(action, (this.presses.get(action) ?? 0) + 1);
    }
    if (action === 'move') this.movePointer(id, x, y);
    this.paint();
    return true;
  }
  movePointer(id, x, y) {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    if (pointer.action === 'move') {
      const dx = (x - pointer.center.x) / pointer.center.radius;
      const dy = (pointer.center.y - y) / pointer.center.radius;
      const length = Math.hypot(dx, dy);
      const strength = Math.max(0, Math.min(1, (length - 0.12) / 0.88));
      this.move.x = strength > 0 ? (dx / length) * strength : 0;
      this.move.y = strength > 0 ? (dy / length) * strength : 0;
      if (this.move.y < 0.1) this.toggles.delete('sprint');
    } else if (pointer.action === 'look' || pointer.action === 'fire') {
      this.look.x -= (x - pointer.x) * this.sensitivity;
      this.look.y -= (y - pointer.y) * this.sensitivity;
    }
    pointer.x = x;
    pointer.y = y;
    this.paint();
  }
  end(id, cancelled = false) {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    this.pointers.delete(id);
    if (pointer.target?.hasPointerCapture(id)) pointer.target.releasePointerCapture(id);
    if (pointer.action === 'move') {
      this.move.x = this.move.y = 0;
      this.toggles.delete('sprint');
    }
    if (cancelled) {
      this.presses.delete(pointer.action);
      this.toggles.delete(pointer.action);
      this.cancel(pointer.action);
    }
    this.paint();
  }
  sample() {
    const state = Object.fromEntries([...this.toggles].map((action) => [action, true]));
    for (const { action } of this.pointers.values()) {
      if (
        !['move', 'look', 'pause'].includes(action) &&
        !TOGGLES.has(action) &&
        !(action === 'aim' && this.weapon !== 'katana')
      )
        state[action] = true;
    }
    const pressed = new Set();
    for (const [action, count] of this.presses) {
      state[action] = true;
      pressed.add(action);
      if (count > 1) this.presses.set(action, count - 1);
      else this.presses.delete(action);
    }
    const result = { state, pressed, move: { ...this.move }, look: { ...this.look } };
    this.look.x = this.look.y = 0;
    return result;
  }
  clear() {
    const pointers = [...this.pointers];
    this.pointers.clear();
    for (const [id, pointer] of pointers) {
      if (pointer.target?.hasPointerCapture(id)) pointer.target.releasePointerCapture(id);
    }
    this.presses.clear();
    this.toggles.clear();
    this.move.x = this.move.y = this.look.x = this.look.y = 0;
    this.cancel();
    this.paint();
  }
  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clear();
  }
  setWeapon(kind, index) {
    if (this.weapon === kind && this.weaponIndex === index) return;
    this.weapon = kind;
    this.weaponIndex = index;
    this.toggles.delete('aim');
    this.presses.delete('aim');
    for (const [id, pointer] of this.pointers) if (pointer.action === 'aim') this.end(id, true);
    if (this.root) {
      for (const [action, label] of [
        ['aim', kind === 'katana' ? '格挡' : '瞄准'],
        ['fire', kind === 'katana' ? '挥刀' : '射击'],
      ]) {
        const button = this.root.querySelector(`[data-touch="${action}"]`);
        button.textContent = label;
        button.setAttribute('aria-label', label);
      }
    }
    this.paint();
  }
  paint() {
    if (!this.root) return;
    this.root.style.setProperty('--stick-x', `${this.move.x * 30}px`);
    this.root.style.setProperty('--stick-y', `${-this.move.y * 30}px`);
    for (const button of this.root.querySelectorAll('button[data-touch]')) {
      const action = button.dataset.touch;
      const active =
        this.toggles.has(action) ||
        [...this.pointers.values()].some((p) => p.action === action) ||
        action === `slot${this.weaponIndex + 1}`;
      button.classList.toggle('active', active);
      if (TOGGLES.has(action) || action === 'aim' || action.startsWith('slot'))
        button.setAttribute('aria-pressed', String(active));
    }
  }
  mount(root, signal) {
    this.root = root;
    const listen = (event, handler) => root.addEventListener(event, handler, { signal });
    listen('pointerdown', (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      const target = e.target.closest('[data-touch]');
      if (!target || !this.enabled) return;
      const bounds = target.getBoundingClientRect();
      if (
        !this.begin(e.pointerId, target.dataset.touch, e.clientX, e.clientY, {
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
          radius: bounds.width / 2,
        })
      )
        return;
      e.preventDefault();
      this.pointers.get(e.pointerId).target = target;
      target.setPointerCapture(e.pointerId);
    });
    listen('pointermove', (e) => this.movePointer(e.pointerId, e.clientX, e.clientY));
    listen('pointerup', (e) => this.end(e.pointerId));
    listen('pointercancel', (e) => this.end(e.pointerId, true));
    listen('lostpointercapture', (e) => this.end(e.pointerId, true));
    // Keyboard activation remains usable for accessibility without synthesizing held pointers.
    listen('click', (e) => {
      if (e.detail !== 0 || !this.enabled) return;
      const action = e.target.closest('button[data-touch]')?.dataset.touch;
      if (action && this.begin('keyboard', action, 0, 0)) this.end('keyboard');
    });
    signal.addEventListener(
      'abort',
      () => {
        this.clear();
        this.root = null;
      },
      { once: true },
    );
    this.paint();
  }
}
