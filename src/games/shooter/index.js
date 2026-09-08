import * as THREE from 'three';
import { Multiplayer } from './online/multiplayer.js';
import { InkRenderer } from './render.js';
import { World } from './physics.js';
import { Input } from './input.js';
import { buildLevel } from './level.js';
import { NavGrid } from './nav.js';
import { Effects } from './effects.js';
import { EnemyManager } from './enemies/manager.js';
import { Player } from './player.js';
import { HUD } from './ui/hud.js';
import { audio } from './audio.js';
import { clamp } from './util.js';
import { createFocus } from './systems/focus.js';
import { createPickups } from './systems/pickups.js';
import { createWaves } from './systems/waves.js';
import { createScreens } from './ui/screens.js';
import { createPreferences } from './preferences.js';
import { disposeTree } from '../../shared/resources.js';

// One mounted game owns its listeners, animation frame, scene and audio lifetime.
export function mountShooter(canvas, root, onMenu, touchRoot) {
  if (
    !(canvas instanceof HTMLCanvasElement) ||
    !(root instanceof HTMLElement) ||
    !(touchRoot instanceof HTMLElement)
  ) {
    throw new Error('Shooter requires canvas, HUD and touch roots');
  }
  const app = canvas.parentElement;
  const prefs = createPreferences(localStorage, { touch: matchMedia('(pointer: coarse)').matches });
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let renderer;
  try {
    renderer = new InkRenderer(canvas, signal);
    const world = new World();
    const mapRoot = new THREE.Group();
    renderer.scene.add(mapRoot);
    let arena = false;
    let level = buildLevel(mapRoot, world, prefs.get('map'));
    const nav = new NavGrid(world, level.bounds, 1).build();
    const input = new Input(canvas, signal);
    input.touch.mount(touchRoot, signal);
    const onScreen = (view) => {
      app.dataset.playing = String(view === null);
      if (view) input.touch.setEnabled(false);
      onMenu(view);
    };
    const hud = new HUD(root);
    const effects = new Effects(renderer.scene, world);
    const ctx = {
      scene: renderer.scene,
      camera: renderer.camera,
      renderer,
      world,
      level,
      nav,
      input,
      hud,
      effects,
      audio,
    };
    const game = (ctx.game = {
      state: 'start',
      mode: 'solo',
      menu: false,
      time: 0,
      hitstopT: 0,
      hitstopScale: 1,
      wave: 0,
      score: 0,
      combo: 0,
      comboT: 0,
      kills: 0,
      intermission: 0,
      queue: [],
      spawnT: 0,
      maxAlive: 6,
      deathT: 0,
      katanaStreak: 0,
      boss: null,
      focus: { active: false, t: 0, chain: 0, target: null, dash: null, arm: 0, ready: false },
      hitstop(duration, scale) {
        if (this.mode === 'pvp') return;
        this.hitstopT = Math.max(this.hitstopT, duration);
        this.hitstopScale = scale;
      },
      addScore(points, label) {
        const earned = Math.round(points * (1 + Math.min(this.combo, 9) * 0.25));
        this.score += earned;
        if (label) hud.kill(label, earned);
        hud.setScore(this.score, this.combo);
      },
      onPlayerDeath() {
        input.clear();
        focus.end();
        this.state = this.mode === 'pvp' && this.menu ? 'pause' : 'dying';
        this.deathT = 0;
      },
    });
    const enemies = (ctx.enemies = new EnemyManager(ctx));
    const player = (ctx.player = new Player(ctx));
    input.onCancel = (action) => player.cancelInput(action);
    const focus = createFocus(ctx);
    const pickups = createPickups(ctx);
    const waves = createWaves(ctx, pickups, focus, prefs);
    const screens = createScreens(
      ctx,
      prefs,
      { begin, menu, online: () => pvp.open(), settings: applySettings },
      onScreen,
    );
    const pvp = (ctx.pvp = new Multiplayer(ctx, {
      setArena,
      reset,
      show: onScreen,
      resume: () => begin(),
      exit: menu,
      settings: applySettings,
      prefs,
      pickups,
    }));
    player.onThrow = (data) => pvp.grenade(data);
    player.onFall = () => pvp.fall();
    let running = true,
      disposed = false,
      starting = false,
      frame = 0,
      last = performance.now();

    function setArena(on) {
      if (arena === on) return;
      enemies.clear();
      effects.clear();
      pickups.clear();
      player.clearNades();
      disposeTree(mapRoot);
      renderer.scene.add(mapRoot);
      mapRoot.clear();
      world.clear();
      level = buildLevel(mapRoot, world, 'district', { arena: on });
      ctx.level = level;
      ctx.nav = new NavGrid(world, level.bounds, 1).build();
      arena = on;
    }
    function applySettings() {
      const sensitivity = prefs.get('sensitivity') / 100;
      input.mouseSens = 0.0022 * sensitivity;
      input.padSensX = 3.4 * sensitivity;
      input.padSensY = 2.6 * sensitivity;
      input.touch.sensitivity = (0.004 * prefs.get('touchSensitivity')) / 100;
      input.invertY = prefs.get('invert');
      renderer.setQuality(prefs.get('quality'));
      if (audio.ctx) audio.musicOn(prefs.get('music'));
    }
    function reset() {
      focus.end();
      enemies.clear();
      effects.clear();
      pickups.clear();
      player.maxHp = game.mode === 'pvp' ? 110 : 120;
      player.reset(ctx.level.playerStart);
      enemies.mods.speed = 1;
      enemies.mods.damage = 1;
      Object.assign(game, {
        score: 0,
        kills: 0,
        combo: 0,
        comboT: 0,
        wave: 0,
        intermission: 0,
        queue: [],
        time: 0,
        deathT: 0,
        hitstopT: 0,
        hitstopScale: 1,
        katanaStreak: 0,
        boss: null,
        spawnT: 0,
      });
      hud.reset();
    }
    async function begin(wave) {
      if (starting || !running) return;
      starting = true;
      try {
        if (input.device === 'touch' && canvas.clientWidth <= canvas.clientHeight) {
          const message = '请将手机横屏后再进入战场。';
          if (pvp.enabled) pvp.report(message);
          else screens.error(message);
          return;
        }
        if (!navigator.userActivation.hasBeenActive) {
          const message = '请先点击开始按钮，以启用浏览器音频。';
          if (pvp.enabled) pvp.report(message);
          else screens.error(message);
          return;
        }
        audio.init();
        const locked = input.device !== 'mouse' || (await input.requestLock());
        if (!locked || !running) return;
        await audio.resume();
        if (!running) return;
        if (document.hidden || (input.device === 'touch' && canvas.clientWidth <= canvas.clientHeight)) {
          pause(document.hidden ? '请返回游戏页面后点击继续。' : '请横屏游玩，旋转后点击继续。');
          return;
        }
        if (pvp.enabled) pvp.ready();
        else if (wave !== undefined) {
          reset();
          waves.start(wave);
        }
        game.state = 'play';
        game.menu = false;
        input.clear();
        canvas.focus();
        audio.setTune(ctx.level.key);
        audio.musicOn(prefs.get('music'));
        screens.hide();
        last = performance.now();
      } finally {
        starting = false;
      }
    }
    function pause(message) {
      if (!running) return;
      if (game.state === 'play' || (pvp.inMatch && game.state === 'dying')) {
        game.state = 'pause';
        game.menu = true;
      }
      input.clear();
      audio.reelLoop(false);
      if (pvp.enabled) {
        if (message) pvp.report(message);
        else pvp.render();
        return;
      }
      if (game.state === 'pause') screens.pause(message);
      else if (message) {
        // A denied input request keeps the current screen and the error visible until a new gesture.
        screens.error(message);
      }
    }
    function menu() {
      game.mode = 'solo';
      setArena(false);
      game.state = 'start';
      game.menu = false;
      input.exitLock();
      input.clear();
      reset();
      screens.start();
    }
    input.onLockChange = (locked) => {
      if (!locked && input.device === 'mouse') pause();
    };
    input.onLockError = (error) => {
      console.error('[Pointer lock]', error);
      pause(`鼠标捕获失败：${error.message}。点击“开始游戏”或“继续游戏”重试。`);
    };
    input.onDeviceChange = (device) => {
      app.dataset.input = device;
      app.dataset.mobile = String(device === 'touch' || matchMedia('(pointer: coarse)').matches);
      hud.setDevice(device);
      if (device === 'mouse' && !input.pointerLocked && game.state === 'play')
        pause('请点击“继续游戏”以捕获鼠标。');
      if (device === 'touch' && canvas.clientWidth <= canvas.clientHeight) pause('请横屏游玩。');
    };
    input.onDeviceChange(input.device);
    function resizeViewport() {
      const viewport = window.visualViewport;
      app.style.width = `${viewport ? viewport.width : window.innerWidth}px`;
      app.style.height = `${viewport ? viewport.height : window.innerHeight}px`;
      app.style.left = `${viewport ? viewport.offsetLeft : 0}px`;
      app.style.top = `${viewport ? viewport.offsetTop : 0}px`;
      renderer.resize();
      const portrait = canvas.clientWidth <= canvas.clientHeight;
      app.dataset.portrait = String(portrait);
      if (input.device === 'touch') {
        input.clear();
        if (portrait && (game.state === 'play' || (pvp.inMatch && game.state === 'dying')))
          pause('请横屏游玩，旋转后点击继续。');
      }
    }
    window.addEventListener('resize', resizeViewport, { signal });
    window.visualViewport?.addEventListener('resize', resizeViewport, { signal });
    window.visualViewport?.addEventListener('scroll', resizeViewport, { signal });
    resizeViewport();
    window.addEventListener('blur', () => pause(), { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) pause();
      },
      { signal },
    );
    canvas.addEventListener(
      'webglcontextlost',
      () => {
        throw new Error('WebGL 渲染上下文已丢失，请重新加载游戏。');
      },
      { signal },
    );
    window.addEventListener(
      'pagehide',
      () => {
        if (game.state === 'play') pause();
      },
      { signal },
    );

    function step(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      input.touch.setWeapon(player.weapon.kind, player.weaponIndex);
      input.touch.setEnabled(
        input.device === 'touch' &&
          canvas.clientWidth > canvas.clientHeight &&
          (game.state === 'play' || (pvp.inMatch && game.state === 'dying')),
      );
      input.update(dt);
      if (input.pressed('pause') && (game.state === 'play' || (pvp.inMatch && game.state === 'dying'))) {
        pause();
        input.exitLock();
      } else if (input.usingGamepad && (input.pressed('jump') || input.pressed('confirm'))) {
        if (game.state === 'pause' || game.state === 'pvpReady') void begin();
        else if (game.state === 'start' || game.state === 'dead') void begin(1);
      }
      if (input.pressed('music')) {
        prefs.set('music', !prefs.get('music'));
        audio.init();
        void audio.resume();
        audio.musicOn(prefs.get('music'));
        hud.tip(prefs.get('music') ? '背景音乐已开启' : '背景音乐已关闭', 1.5);
      }
      const playing =
        game.state === 'play' || game.state === 'dying' || (pvp.inMatch && game.state === 'pause');
      let scale = 1;
      if (game.hitstopT > 0) {
        game.hitstopT -= dt;
        scale = game.hitstopScale;
      } else if (game.focus.active) scale = focus.scale;
      const sdt = dt * scale;
      if (game.state === 'play' && !pvp.enabled) focus.update(dt);
      if (playing) {
        game.time += sdt;
        if (game.menu) input.clear();
        player.update(sdt);
        enemies.update(sdt);
        effects.update(sdt);
        pickups.update(sdt);
        if (game.state === 'play' && !pvp.enabled) waves.update(sdt);
        if (game.comboT > 0) {
          game.comboT -= sdt;
          if (game.comboT <= 0) {
            game.combo = 0;
            hud.setScore(game.score, 0);
          }
        }
        if (game.state === 'dying' && !pvp.enabled) {
          game.deathT += dt;
          if (game.deathT > 1.7) {
            game.state = 'dead';
            input.exitLock();
            screens.dead();
          }
        }
      } else if (
        game.state === 'start' ||
        game.state === 'dead' ||
        game.state === 'lobby' ||
        game.state === 'over'
      ) {
        game.time += dt;
        player.idleCam(game.time);
        effects.update(dt);
      }
      if (pvp.enabled) pvp.update(dt);
      for (const animation of ctx.level.animated) animation.update(game.time);
      audio.setListener(player.eye, player.right);
      const weapon = player.weapon;
      if (weapon.isGun) hud.setAmmo(weapon.mag, weapon.reserve, weapon.magSize, weapon.reloading);
      else hud.setKatana();
      hud.setSlots(
        player.weapons.map((w, i) => ({
          name: w.name,
          active: i === player.weaponIndex,
          ammo: w.isGun ? w.mag + '/' + w.reserve : '∞',
          empty: w.isGun && w.mag === 0 && w.reserve === 0,
        })),
      );
      hud.setGrenades(player.grenades);
      hud.setGrappleStamina(player.grapStam);
      hud.setHealth(player.hp, player.maxHp);
      hud.setSpread(weapon.spreadPx);
      hud.update(dt);
      hud.setFocusMeter(
        playing && (weapon.kind === 'katana' || game.katanaStreak > 0 || game.focus.active),
        game.focus.active ? 1 : clamp(game.katanaStreak / focus.chargeKills, 0, 1),
        game.focus.active,
      );
      if (game.boss) {
        if (game.boss.alive) hud.setBoss(game.boss.T.name, game.boss.hp / game.boss.maxHp);
        else {
          hud.setBoss(null, null);
          game.boss = null;
        }
      }
      audio.setIntensity(
        clamp((enemies.alive + game.queue.length) / 12, 0, 1) * (game.intermission > 0 ? 0.25 : 1),
      );
      renderer.render(game.time, {
        hurt: player.hurtFx,
        flash: player.flashFx,
        slow: scale < 1 ? 1 : 0,
        lowHp: player.alive && player.hp < 30 ? 1 - player.hp / 30 : 0,
      });
    }
    function tick() {
      if (!running) return;
      // Sample the same clock used by begin(); a queued RAF timestamp can precede async resume.
      step(performance.now());
      // Schedule only after a successful frame. An exception cannot keep a broken loop alive.
      frame = requestAnimationFrame(tick);
    }
    applySettings();
    hud.setWeapon(player.weapon.name, player.weapon.hint);
    screens.start();
    frame = requestAnimationFrame(tick);
    return {
      stop() {
        if (!running) return;
        running = false;
        cancelAnimationFrame(frame);
        lifetime.abort();
        pvp.dispose();
        input.exitLock();
        input.clear();
        audio.musicOn(false);
        audio.reelLoop(false);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        this.stop();
        enemies.clear();
        effects.clear();
        pickups.dispose();
        player.clearNades();
        hud.dispose();
        disposeTree(renderer.scene);
        renderer.dispose();
        void audio.dispose();
      },
    };
  } catch (error) {
    lifetime.abort();
    if (renderer) {
      disposeTree(renderer.scene);
      renderer.dispose();
    }
    throw error;
  }
}
