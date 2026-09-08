import * as THREE from 'three';
import { INK } from '../render.js';
import { clamp } from '../util.js';

export function createFocus(ctx) {
  const { game, player, enemies, world, hud, input, effects, audio, renderer } = ctx;
  const FOCUS_TIME = 2.6,
    FOCUS_SCALE = 0.26,
    FOCUS_RANGE = 24,
    FOCUS_MAX_CHAIN = 2,
    FOCUS_ARM = 0.18,
    DASH_SPEED = 46,
    KATANA_CHARGE_KILLS = 3;
  const _fv = new THREE.Vector3();
  function focusCandidate() {
    let best = null,
      bestScore = -1;
    for (const e of enemies.enemies) {
      if (!e.alive || e.state === 'spawn') continue;
      _fv.subVectors(e.center, player.eye);
      const d = _fv.length();
      if (d > FOCUS_RANGE || d < 0.5) continue;
      const aim = _fv.divideScalar(d).dot(player.forward);
      if (aim < 0.4) continue;
      if (!world.hasLineOfSight(player.eye, e.center)) continue;
      const score = aim * 3 - d / FOCUS_RANGE;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }
  function enterFocus() {
    if (game.focus.chain >= FOCUS_MAX_CHAIN || !focusCandidate()) return;
    const fresh = !game.focus.active;
    game.focus.active = true;
    game.focus.t = FOCUS_TIME;
    game.focus.chain++;
    game.focus.arm = FOCUS_ARM;
    game.focus.ready = false;
    if (fresh) {
      audio.focusIn();
      hud.tip(`<b>冲刺斩就绪</b> · 按住 ${hud.key('focus')} 发动冲刺斩`, 2.2);
    }
  }
  function endFocus() {
    if (!game.focus.active && !game.focus.dash) return;
    game.focus.active = false;
    game.focus.target = null;
    game.focus.chain = 0;
    game.focus.dash = null;
    game.katanaStreak = 0;
    player.dashLock = false;
    hud.setFocusMark(null);
  }
  function startFocusDash(target) {
    game.focus.dash = { target, t: 0, trail: player.center.clone(), lastTrail: 0 };
    player.dashLock = true;
    player.body.vel.set(0, 0, 0);
    audio.dash();
    player.kickFov(5);
    input.rumble(0.5, 0.4, 120);
    hud.setFocusMark(null);
  }
  function marchBody(b, nx, nz, dist) {
    let moved = 0;
    for (let step = Math.min(0.22, dist); moved + 1e-4 < dist;) {
      const s2 = Math.min(step, dist - moved);
      b.pos.x += nx * s2;
      b.pos.z += nz * s2;
      if (world.overlapsBody(b)) {
        b.pos.y += 0.65;
        if (world.overlapsBody(b)) {
          b.pos.y -= 0.65;
          b.pos.x -= nx * s2;
          b.pos.z -= nz * s2;
          return moved;
        }
      }
      moved += s2;
    }
    return moved;
  }
  function updateFocusDash(dt) {
    const d = game.focus.dash;
    if (!d) return true;
    const target = d.target;
    d.t += dt;
    if (!target.alive || d.t > 1.2) {
      endDash(false);
      return true;
    }
    const b = player.body;
    const dx = target.body.pos.x - b.pos.x,
      dz = target.body.pos.z - b.pos.z;
    const flat = Math.hypot(dx, dz);
    const nx = dx / (flat || 1),
      nz = dz / (flat || 1);
    player.yaw = Math.atan2(-dx, -dz);
    _fv.subVectors(target.center, player.eye);
    player.pitch = clamp(Math.atan2(_fv.y, Math.hypot(_fv.x, _fv.z)), -1.2, 1.2);
    const want = Math.max(0, flat - 1.1);
    const moved = marchBody(b, nx, nz, Math.min(DASH_SPEED * dt, want));
    const aimY = target.body.pos.y + (target.T.flying ? 0.2 : 0);
    const dy = aimY - b.pos.y;
    if (Math.abs(dy) > 0.05) {
      const y = b.pos.y;
      b.pos.y += clamp(dy, -DASH_SPEED * dt, DASH_SPEED * dt);
      if (world.overlapsBody(b)) {
        b.pos.y = y;
        d.stuckY = (d.stuckY || 0) + dt;
      } else d.stuckY = 0;
    }
    d.lastTrail += dt;
    if (d.lastTrail > 0.02) {
      d.lastTrail = 0;
      effects.tracer(d.trail, player.center, INK.BLUE, 0.045, 0.28);
      d.trail.copy(player.center);
      effects.strokeBurst(player.center, INK.BLUE, 2, 5, { life: 0.22, size: 0.03 });
    }
    const reach = Math.hypot(flat, Math.max(0, Math.abs(dy) - 0.6));
    if (reach <= 1.5) {
      focusExecute(target);
      return true;
    }
    if (moved < 1e-4 && want > 0.05 && (d.stuckY || 0) > 0.08) {
      endDash(true);
      return true;
    }
    return false;
  }
  function endDash(blocked) {
    player.dashLock = false;
    game.focus.dash = null;
    player.body.vel.set(0, 0, 0);
    if (blocked) {
      player.weapons[player.katanaIndex].startSlash(player._weaponState(false, false, 0));
      audio.katanaSwing();
      hud.tip('冲刺受阻 · 未能到达目标', 1.2);
    }
  }
  function focusExecute(target) {
    player.dashLock = false;
    game.focus.dash = null;
    player.body.vel.set(0, 0, 0);
    player.weapons[player.katanaIndex].startSlash(player._weaponState(false, false, 0));
    _fv.subVectors(target.center, player.eye);
    const dir = _fv.clone().normalize();
    const chainBefore = game.focus.chain;
    enemies.damage(target, 100000, {
      point: target.center.clone(),
      dir,
      part: 'head',
      source: 'focus',
      crit: true,
    });
    audio.focusSlash();
    game.hitstop(0.1, 0.08);
    effects.shakeAmt += 0.35;
    input.rumble(0.9, 0.7, 140);
    player.kickFov(6);
    player.hp = Math.min(player.maxHp, player.hp + 6);
    if (game.focus.chain === chainBefore) game.focus.t = Math.min(game.focus.t, 0.35);
    game.focus.target = null;
    hud.setFocusMark(null);
  }
  function updateFocus(dt) {
    const f = game.focus;
    if (!f.active) return;
    if (f.dash) {
      updateFocusDash(dt);
      return;
    }
    f.t -= dt;
    f.arm -= dt;
    if (f.t <= 0 || !player.alive) {
      endFocus();
      return;
    }
    const combo = (input.down('aim') && input.down('fire')) || input.down('dash');
    if (!combo) f.ready = true;
    const target = focusCandidate();
    f.target = target;
    if (!target) {
      hud.setFocusMark(null);
      return;
    }
    _fv.copy(target.center).project(renderer.camera);
    if (_fv.z < 1)
      hud.setFocusMark((_fv.x * 0.5 + 0.5) * window.innerWidth, (-_fv.y * 0.5 + 0.5) * window.innerHeight);
    else hud.setFocusMark(null);
    if (combo && f.ready && f.arm <= 0) {
      input.consume('fire');
      startFocusDash(target);
    }
  }

  return {
    enter: enterFocus,
    end: endFocus,
    update: updateFocus,
    scale: FOCUS_SCALE,
    chargeKills: KATANA_CHARGE_KILLS,
  };
}
