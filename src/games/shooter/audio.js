// Procedural WebAudio sound effects (no external assets).
import * as THREE from 'three';
import { clamp, rand } from './util.js';

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.volume = 0.55;
    this.listenerPos = new THREE.Vector3();
    this.listenerRight = new THREE.Vector3(1, 0, 0);
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio is not supported in this browser');
    const ctx = (this.ctx = new AC());
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 5;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume();
  }
  async dispose() {
    this.musicOn(false);
    this.reelLoop(false);
    const context = this.ctx;
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.musicGain = null;
    if (context) await context.close();
  }
  setListener(pos, right) {
    this.listenerPos.copy(pos);
    this.listenerRight.copy(right);
  }
  _out(pos, base = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let vol = base;
    if (pos) {
      const dx = pos.x - this.listenerPos.x,
        dy = pos.y - this.listenerPos.y,
        dz = pos.z - this.listenerPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      vol *= 1 / (1 + dist * 0.09);
      if (dist > 0.5 && ctx.createStereoPanner) {
        const pan = clamp((dx * this.listenerRight.x + dz * this.listenerRight.z) / dist, -1, 1) * 0.75;
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        g.gain.value = vol;
        g.connect(p);
        p.connect(this.master);
        return g;
      }
    }
    g.gain.value = vol;
    g.connect(this.master);
    return g;
  }
  noise({
    dur = 0.1,
    gain = 0.5,
    type = 'lowpass',
    freq = 1000,
    freqEnd = null,
    q = 1,
    attack = 0.002,
    pos = null,
    delay = 0,
    hp = 0,
    at,
  }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = at !== undefined ? at : ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.loopEnd = 2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    let last = f;
    if (hp > 0) {
      const h = ctx.createBiquadFilter();
      h.type = 'highpass';
      h.frequency.value = hp;
      last.connect(h);
      last = h;
    }
    last.connect(env);
    env.connect(this._out(pos));
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }
  tone({
    freq = 440,
    freqEnd = null,
    dur = 0.2,
    gain = 0.3,
    type = 'sine',
    attack = 0.005,
    pos = null,
    delay = 0,
    at,
    out,
  }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = at !== undefined ? at : ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(env);
    env.connect(out || this._out(pos));
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  // ---------- game sounds ----------
  shot() {
    this.noise({ dur: 0.17, gain: 0.7, type: 'bandpass', freq: 1200, freqEnd: 250, q: 0.7 });
    this.noise({ dur: 0.06, gain: 0.45, type: 'highpass', freq: 2800 });
    this.tone({ freq: 160, freqEnd: 40, dur: 0.15, gain: 0.6, type: 'triangle' });
  }
  // another player's gun, heard from where they stand: a bit hotter than a bot's so it cuts through
  remoteShot(kind, pos) {
    if (kind === 'shotgun') {
      this.noise({ dur: 0.32, gain: 1.0, type: 'lowpass', freq: 1600, freqEnd: 150, pos });
      this.tone({ freq: 95, freqEnd: 30, dur: 0.26, gain: 0.7, type: 'triangle', pos });
    } else if (kind === 'sniper') {
      this.noise({ dur: 0.4, gain: 1.0, type: 'bandpass', freq: 750, freqEnd: 120, q: 0.5, pos });
      this.tone({ freq: 420, freqEnd: 50, dur: 0.32, gain: 0.5, type: 'sawtooth', pos });
    } else {
      this.noise({
        dur: 0.16,
        gain: 0.85,
        type: 'bandpass',
        freq: rand(1000, 1500),
        freqEnd: 220,
        q: 0.8,
        pos,
      });
      this.noise({ dur: 0.05, gain: 0.4, type: 'highpass', freq: 2600, pos });
      this.tone({ freq: 200, freqEnd: 50, dur: 0.12, gain: 0.45, type: 'square', pos });
    }
  }
  enemyShot(pos) {
    this.noise({ dur: 0.14, gain: 0.5, type: 'bandpass', freq: rand(900, 1500), freqEnd: 200, q: 0.8, pos });
    this.tone({ freq: 220, freqEnd: 60, dur: 0.1, gain: 0.3, type: 'square', pos });
  }
  shotgun(pos) {
    this.noise({ dur: 0.3, gain: 0.7, type: 'lowpass', freq: 1500, freqEnd: 150, pos });
    this.tone({ freq: 90, freqEnd: 30, dur: 0.25, gain: 0.5, type: 'triangle', pos });
  }
  sniperShot(pos) {
    this.noise({ dur: 0.35, gain: 0.7, type: 'bandpass', freq: 700, freqEnd: 120, q: 0.5, pos });
    this.tone({ freq: 400, freqEnd: 50, dur: 0.3, gain: 0.35, type: 'sawtooth', pos });
  }
  sniperAim(pos) {
    this.tone({ freq: 1800, dur: 0.12, gain: 0.12, type: 'sine', pos });
  }
  empty() {
    this.noise({ dur: 0.03, gain: 0.3, type: 'highpass', freq: 3000 });
  }
  winded() {
    this.tone({ freq: 220, freqEnd: 140, dur: 0.14, gain: 0.1, type: 'triangle' });
  }
  reload() {
    this.noise({ dur: 0.04, gain: 0.35, type: 'highpass', freq: 2500 });
    this.noise({ dur: 0.12, gain: 0.2, type: 'bandpass', freq: 600, q: 2, delay: 0.25 });
    this.noise({ dur: 0.05, gain: 0.4, type: 'highpass', freq: 2000, delay: 0.9 });
    this.tone({ freq: 900, freqEnd: 500, dur: 0.06, gain: 0.15, type: 'square', delay: 1.25 });
  }
  katanaSwing() {
    this.noise({ dur: 0.2, gain: 0.35, type: 'bandpass', freq: 500, freqEnd: 3000, q: 1.5 });
  }
  katanaHit() {
    this.noise({ dur: 0.14, gain: 0.6, type: 'lowpass', freq: 900, freqEnd: 200 });
    this.noise({ dur: 0.1, gain: 0.35, type: 'bandpass', freq: 2500, q: 0.6 });
    this.tone({ freq: 180, freqEnd: 70, dur: 0.12, gain: 0.4, type: 'triangle' });
  }
  parry() {
    for (const f of [2200, 3300, 4700])
      this.tone({ freq: f, freqEnd: f * 0.92, dur: 0.35, gain: 0.16, type: 'sine' });
    this.noise({ dur: 0.05, gain: 0.5, type: 'highpass', freq: 4000 });
  }
  perfectParry() {
    this.parry();
    this.tone({ freq: 880, freqEnd: 1760, dur: 0.25, gain: 0.2, type: 'triangle', delay: 0.03 });
  }
  grappleFire() {
    this.noise({ dur: 0.1, gain: 0.4, type: 'highpass', freq: 1500 });
    this.tone({ freq: 500, freqEnd: 1500, dur: 0.18, gain: 0.18, type: 'sawtooth' });
  }
  grappleHit() {
    this.noise({ dur: 0.04, gain: 0.45, type: 'highpass', freq: 2000 });
    this.tone({ freq: 300, freqEnd: 200, dur: 0.08, gain: 0.25, type: 'square' });
  }
  grappleRelease() {
    this.tone({ freq: 900, freqEnd: 300, dur: 0.12, gain: 0.12, type: 'sawtooth' });
  }
  reelLoop(on) {
    if (!this.ctx) return;
    if (on && !this._reel) {
      const ctx = this.ctx;
      const o = ctx.createBufferSource();
      o.buffer = this.noiseBuf;
      o.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 380;
      f.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(0.05, ctx.currentTime, 0.12);
      o.connect(f);
      f.connect(g);
      g.connect(this.master);
      o.start();
      this._reel = { o, g };
    } else if (!on && this._reel) {
      const r = this._reel;
      this._reel = null;
      r.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      r.o.stop(this.ctx.currentTime + 0.3);
    }
  }
  footstep(speedFrac = 1) {
    this.noise({ dur: 0.07, gain: 0.12 * speedFrac, type: 'lowpass', freq: rand(400, 800) });
  }
  jump() {
    this.tone({ freq: 260, freqEnd: 480, dur: 0.1, gain: 0.1, type: 'triangle' });
    this.noise({ dur: 0.05, gain: 0.1, type: 'lowpass', freq: 600 });
  }
  land(hard = 0.5) {
    this.noise({ dur: 0.14, gain: 0.15 + 0.35 * hard, type: 'lowpass', freq: 350 });
  }
  slide() {
    this.noise({ dur: 0.45, gain: 0.18, type: 'lowpass', freq: 1200, freqEnd: 300 });
  }
  wallJump() {
    this.noise({ dur: 0.08, gain: 0.25, type: 'lowpass', freq: 700 });
    this.tone({ freq: 300, freqEnd: 600, dur: 0.12, gain: 0.12, type: 'triangle' });
  }
  mantle() {
    this.noise({ dur: 0.2, gain: 0.2, type: 'lowpass', freq: 900, freqEnd: 300 });
  }
  dash() {
    this.noise({ dur: 0.25, gain: 0.3, type: 'bandpass', freq: 800, freqEnd: 2500, q: 1 });
  }
  hurt() {
    this.tone({ freq: 200, freqEnd: 90, dur: 0.2, gain: 0.35, type: 'sawtooth' });
    this.noise({ dur: 0.12, gain: 0.3, type: 'lowpass', freq: 500 });
  }
  death() {
    this.tone({ freq: 220, freqEnd: 30, dur: 1.2, gain: 0.4, type: 'sawtooth' });
    this.noise({ dur: 0.8, gain: 0.35, type: 'lowpass', freq: 800, freqEnd: 80 });
  }
  hitEnemy(pos) {
    this.noise({ dur: 0.06, gain: 0.3, type: 'lowpass', freq: 900, pos });
    this.tone({ freq: rand(200, 260), freqEnd: 120, dur: 0.1, gain: 0.15, type: 'square', pos });
  }
  headshot(pos) {
    this.noise({ dur: 0.05, gain: 0.5, type: 'highpass', freq: 3000, pos });
    this.tone({ freq: 1500, freqEnd: 500, dur: 0.09, gain: 0.2, type: 'triangle', pos });
  }
  // a kill: a short two-note ping over a thump, the kind of sound you want to hear again
  kill(strong = false) {
    this.tone({ freq: 880, freqEnd: 880, dur: 0.07, gain: 0.22, type: 'square' });
    this.tone({ freq: 1320, freqEnd: 1320, dur: 0.16, gain: 0.2, type: 'square', delay: 0.07 });
    this.tone({ freq: 140, freqEnd: 50, dur: 0.16, gain: strong ? 0.6 : 0.35, type: 'sine' });
    if (strong) this.tone({ freq: 1760, dur: 0.22, gain: 0.12, type: 'triangle', delay: 0.14 });
  }
  enemyDie(pos) {
    this.tone({ freq: rand(160, 220), freqEnd: 40, dur: 0.4, gain: 0.3, type: 'sawtooth', pos });
    this.noise({ dur: 0.3, gain: 0.4, type: 'lowpass', freq: 600, freqEnd: 100, pos });
    this.noise({ dur: 0.12, gain: 0.3, type: 'bandpass', freq: 1400, q: 1, pos, delay: 0.03 });
  }
  gib(pos) {
    this.noise({ dur: 0.2, gain: 0.45, type: 'lowpass', freq: 500, freqEnd: 120, pos });
    this.noise({ dur: 0.1, gain: 0.3, type: 'bandpass', freq: 2000, q: 0.8, pos, delay: 0.02 });
  }
  splat(pos) {
    this.noise({ dur: 0.08, gain: 0.15, type: 'lowpass', freq: 700, pos });
  }
  spawn(pos) {
    for (let i = 0; i < 5; i++)
      this.noise({
        dur: 0.04,
        gain: 0.25,
        type: 'bandpass',
        freq: rand(2500, 5000),
        q: 2,
        pos,
        delay: i * 0.05,
      });
  }
  lunge(pos) {
    this.tone({ freq: 200, freqEnd: 700, dur: 0.3, gain: 0.25, type: 'sawtooth', pos });
  }
  bulletImpact(pos) {
    this.noise({ dur: 0.05, gain: 0.25, type: 'highpass', freq: 1500, pos });
  }
  ricochet(pos) {
    this.tone({ freq: rand(2000, 3500), freqEnd: 800, dur: 0.15, gain: 0.12, type: 'sine', pos });
  }
  pickup() {
    this.tone({ freq: 700, freqEnd: 1100, dur: 0.1, gain: 0.2, type: 'triangle' });
    this.tone({ freq: 1100, freqEnd: 1500, dur: 0.15, gain: 0.2, type: 'triangle', delay: 0.09 });
  }
  wave() {
    const notes = [440, 554, 659, 880];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.22, gain: 0.18, type: 'triangle', delay: i * 0.11 }));
  }
  waveClear() {
    const notes = [659, 880, 1108, 1318];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.3, gain: 0.16, type: 'triangle', delay: i * 0.13 }));
  }
  tick() {
    this.noise({ dur: 0.02, gain: 0.2, type: 'highpass', freq: 4000 });
  }
  hitstop() {
    this.tone({ freq: 60, dur: 0.1, gain: 0.3, type: 'sine' });
  }
  switchWeapon() {
    this.noise({ dur: 0.05, gain: 0.25, type: 'bandpass', freq: 1800, q: 1.5 });
  }
  heartbeat() {
    this.tone({ freq: 55, dur: 0.15, gain: 0.35, type: 'sine' });
    this.tone({ freq: 50, dur: 0.12, gain: 0.25, type: 'sine', delay: 0.18 });
  }

  // ---------- more weapons / movement ----------
  shotgunFire() {
    this.noise({ dur: 0.32, gain: 0.9, type: 'lowpass', freq: 1800, freqEnd: 120 });
    this.noise({ dur: 0.08, gain: 0.5, type: 'highpass', freq: 2500 });
    this.tone({ freq: 110, freqEnd: 30, dur: 0.28, gain: 0.7, type: 'triangle' });
  }
  revolver() {
    this.noise({ dur: 0.22, gain: 0.85, type: 'bandpass', freq: 900, freqEnd: 180, q: 0.6 });
    this.noise({ dur: 0.05, gain: 0.6, type: 'highpass', freq: 3000 });
    this.tone({ freq: 200, freqEnd: 35, dur: 0.22, gain: 0.7, type: 'sawtooth' });
    this.tone({ freq: 2600, freqEnd: 900, dur: 0.12, gain: 0.12, type: 'sine' });
  }
  sniperFire() {
    this.noise({ dur: 0.45, gain: 0.95, type: 'bandpass', freq: 1400, freqEnd: 90, q: 0.5 });
    this.noise({ dur: 0.07, gain: 0.7, type: 'highpass', freq: 3500 });
    this.tone({ freq: 260, freqEnd: 30, dur: 0.4, gain: 0.8, type: 'sawtooth' });
    this.tone({ freq: 1800, freqEnd: 400, dur: 0.5, gain: 0.16, type: 'sine', delay: 0.05 });
  }
  focusIn() {
    this.tone({ freq: 1200, freqEnd: 420, dur: 0.45, gain: 0.3, type: 'sine' });
    this.noise({ dur: 0.35, gain: 0.2, type: 'bandpass', freq: 2400, freqEnd: 500, q: 1.2 });
  }
  focusSlash() {
    this.noise({ dur: 0.3, gain: 0.55, type: 'bandpass', freq: 600, freqEnd: 4000, q: 1.2 });
    this.tone({ freq: 180, freqEnd: 60, dur: 0.3, gain: 0.55, type: 'triangle' });
    for (const f of [1600, 2400])
      this.tone({ freq: f, freqEnd: f * 0.6, dur: 0.35, gain: 0.14, type: 'sine', delay: 0.04 });
  }
  pump() {
    this.noise({ dur: 0.05, gain: 0.35, type: 'bandpass', freq: 1500, q: 1.5 });
    this.noise({ dur: 0.06, gain: 0.35, type: 'bandpass', freq: 900, q: 1.5, delay: 0.09 });
  }
  shell() {
    this.noise({ dur: 0.04, gain: 0.3, type: 'highpass', freq: 2500 });
    this.tone({ freq: 1400, freqEnd: 900, dur: 0.05, gain: 0.08, type: 'square' });
  }
  cylinder() {
    this.noise({ dur: 0.05, gain: 0.3, type: 'highpass', freq: 2000 });
    this.tone({ freq: 700, freqEnd: 400, dur: 0.12, gain: 0.1, type: 'square', delay: 0.05 });
    this.noise({ dur: 0.06, gain: 0.35, type: 'highpass', freq: 1800, delay: 1.6 });
  }
  explosion(pos) {
    this.noise({ dur: 0.7, gain: 0.9, type: 'lowpass', freq: 900, freqEnd: 60, pos });
    this.tone({ freq: 80, freqEnd: 25, dur: 0.6, gain: 0.7, type: 'triangle', pos });
    this.noise({ dur: 0.15, gain: 0.4, type: 'bandpass', freq: 3000, q: 0.7, pos });
  }
  fuse(pos) {
    this.noise({ dur: 0.12, gain: 0.25, type: 'highpass', freq: 5000, pos });
  }
  flyerDive(pos) {
    this.tone({ freq: 900, freqEnd: 300, dur: 0.35, gain: 0.2, type: 'sawtooth', pos });
    this.noise({ dur: 0.3, gain: 0.15, type: 'bandpass', freq: 2500, freqEnd: 800, q: 1, pos });
  }
  flyerBuzz(pos) {
    this.tone({ freq: rand(380, 460), dur: 0.14, gain: 0.05, type: 'sawtooth', pos });
  }
  stomp(pos) {
    this.noise({ dur: 0.4, gain: 0.8, type: 'lowpass', freq: 400, freqEnd: 60, pos });
    this.tone({ freq: 60, freqEnd: 25, dur: 0.5, gain: 0.7, type: 'sine', pos });
  }
  bossRoar(pos) {
    this.tone({ freq: 90, freqEnd: 60, dur: 0.9, gain: 0.5, type: 'sawtooth', pos });
    this.noise({ dur: 0.8, gain: 0.4, type: 'bandpass', freq: 500, q: 0.8, pos });
  }
  shieldHit(pos) {
    this.tone({ freq: rand(600, 800), freqEnd: 300, dur: 0.12, gain: 0.2, type: 'square', pos });
    this.noise({ dur: 0.05, gain: 0.3, type: 'highpass', freq: 3000, pos });
  }
  airdrop() {
    this.tone({ freq: 660, dur: 0.15, gain: 0.15, type: 'triangle' });
    this.tone({ freq: 880, dur: 0.2, gain: 0.15, type: 'triangle', delay: 0.15 });
  }
  crateLand(pos) {
    this.noise({ dur: 0.3, gain: 0.6, type: 'lowpass', freq: 500, freqEnd: 80, pos });
  }
  // ---------- music: an 8-bit theme, two pulse voices, a triangle bass, an arpeggio and drums ----------
  musicOn(on) {
    if (!this.ctx) return;
    if (on && !this._mus) {
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.05;
      this.musicGain.connect(this.master);
      this._mus = {
        step: 0,
        next: this.ctx.currentTime + 0.1,
        timer: setInterval(() => this._musicTick(), 100),
      };
    } else if (!on && this._mus) {
      clearInterval(this._mus.timer);
      this._mus = null;
      if (this.musicGain) this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
  }
  get musicPlaying() {
    return !!this._mus;
  }
  setIntensity(v) {
    this._intensity = clamp(v, 0, 1);
  }
  setTune(key) {
    if (this._tuneKey === key) return;
    this._tuneKey = key;
    if (this._mus) {
      this._mus.step = 0;
      this._mus.next = this.ctx.currentTime + 0.1;
    }
  }
  _musicTick() {
    if (this._tuneKey === 'mexico') return this._mariachiTick();
    const ctx = this.ctx,
      m = this._mus;
    if (!m) return;
    const I = this._intensity || 0;
    const out = this.musicGain;
    const bpm = 156,
      step = 60 / bpm / 4;
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    // a throttled tab can fall far behind; skip forward rather than replaying every missed note
    if (m.next < ctx.currentTime - 0.8) m.next = ctx.currentTime + 0.05;
    while (m.next < ctx.currentTime + 0.7) {
      const t = m.next,
        i = m.step % SONG.length,
        bar = Math.floor(i / 16),
        s16 = i % 16;
      const sec = SONG.section[bar],
        chord = SONG.chord[bar],
        root = chord[0];
      const firstBar = SONG.firstBar[bar],
        lastBar = SONG.lastBar[bar];
      // lead: a pulse with a slightly detuned twin for width, an optional octave shadow, and a dotted-eighth echo in the airy sections
      const n = SONG.lead[i];
      if (n > 0) {
        const dur = SONG.len[i] * step * 0.9,
          f = midi(n);
        this.tone({ freq: f, dur, gain: 0.1, type: 'square', at: t, out });
        this.tone({ freq: f * 1.004, dur, gain: 0.04, type: 'square', at: t, out });
        if (sec.shadow)
          this.tone({ freq: f * 2, dur: dur * 0.7, gain: sec.shadow, type: 'square', at: t, out });
        if (sec.echo) {
          this.tone({ freq: f, dur: dur * 0.8, gain: 0.035, type: 'square', at: t + step * 3, out });
          this.tone({ freq: f, dur: dur * 0.6, gain: 0.012, type: 'square', at: t + step * 6, out });
        }
      }
      // bass: each section has its own feel; 'drive' and 'pump' walk toward the next chord on the last eighth
      const b = root - 12;
      let nb = SONG.chord[(bar + 1) % SONG.bars][0] - 12;
      if (nb - b > 6) nb -= 12;
      else if (b - nb > 6) nb += 12;
      const approach = nb === b ? b + 7 : nb + (nb > b ? -1 : 1);
      const bass = (note, len, gain = 0.16) =>
        this.tone({ freq: midi(note), dur: step * len, gain, type: 'triangle', at: t, out });
      if (sec.bass === 'bounce') {
        if (s16 % 2 === 0) bass(b + [0, 0, 12, 0, 0, 7, 0, 12][s16 / 2], 1.6);
      } else if (sec.bass === 'drive') {
        if (s16 % 2 === 0)
          bass(s16 === 14 ? approach : s16 === 6 ? b + 12 : s16 === 12 ? b + 7 : b, 1.4, 0.17);
      } else if (sec.bass === 'sparse') {
        if (s16 === 0) bass(b, 6, 0.14);
        else if (s16 === 8) bass(b + 7, 4, 0.12);
      } else if (sec.bass === 'pump') {
        if (s16 === 0 || s16 === 8) bass(b, 2.5);
        else if (s16 === 4) bass(b + 7, 2.5);
        else if (s16 === 12) bass(b + 12, 1.6);
        else if (s16 === 14) bass(approach, 1.4);
      }
      // arpeggio: chord tones on every sixteenth, quiet
      if (sec.arp) {
        const tones = [root, root + chord[1], root + 7, root + 12];
        this.tone({
          freq: midi(tones[s16 % 4] + 12),
          dur: step * 0.8,
          gain: 0.03 + I * 0.02,
          type: 'square',
          at: t,
          out,
        });
      }
      // counter voice: a soft triangle answering on the off-beats
      if (sec.counter && s16 % 4 === 2) {
        const tones = [root + 12, root + chord[1] + 12, root + 19, root + chord[1] + 12];
        this.tone({
          freq: midi(tones[(s16 - 2) / 4]),
          dur: step * 1.5,
          gain: 0.06,
          type: 'triangle',
          at: t,
          out,
        });
      }
      // drums: a splash on each new section, a rising snare fill into the next one, otherwise the section's own groove
      const D = sec.drums;
      if (firstBar && s16 === 0) this._noiseAt(t, 0.4, 0.14, 'highpass', 5000, out);
      if (lastBar && s16 >= 12)
        this._noiseAt(t, 0.08, 0.12 + (s16 - 12) * 0.05, 'bandpass', 1800 + (s16 - 12) * 350, out);
      else {
        const kick =
          D === 'driving'
            ? s16 % 4 === 0
            : D === 'sparse'
              ? s16 === 0
              : s16 === 0 ||
                s16 === 8 ||
                (I > 0.5 && s16 === 10) ||
                (s16 === 14 && D === 'full' && bar % 2 === 1);
        if (kick)
          this.tone({
            freq: 160,
            freqEnd: 45,
            dur: 0.12,
            gain: D === 'sparse' ? 0.3 : 0.45,
            type: 'sine',
            at: t,
            out,
          });
        if (D !== 'sparse' && (s16 === 4 || s16 === 12))
          this._noiseAt(t, 0.11, D === 'light' ? 0.14 : 0.22, 'bandpass', 2200, out);
        const hat =
          D === 'driving'
            ? true
            : D === 'full'
              ? s16 % 2 === 0 || I > 0.4
              : D === 'light'
                ? s16 % 4 === 2
                : s16 === 8;
        if (hat) {
          const open = s16 % 4 === 2;
          this._noiseAt(
            t,
            open ? 0.05 : 0.025,
            (open ? 0.1 : 0.06) * (s16 % 2 ? 0.5 : 1) * (D === 'sparse' ? 0.6 : 1),
            'highpass',
            8000,
            out,
          );
        }
      }
      m.next += step;
      m.step++;
    }
  }
  // Doodle Mexico: a waltz in G, twelve sixteenths a bar; two trumpets in thirds over a guitarrón and strummed chords
  _mariachiTick() {
    const ctx = this.ctx,
      m = this._mus;
    if (!m) return;
    const I = this._intensity || 0;
    const out = this.musicGain;
    const T = MEXICO,
      step = 60 / T.bpm / 4;
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    if (m.next < ctx.currentTime - 0.8) m.next = ctx.currentTime + 0.05;
    while (m.next < ctx.currentTime + 0.7) {
      const t = m.next,
        i = m.step % T.length,
        bar = Math.floor(i / 12),
        sb = i % 12;
      const chord = T.chord[bar],
        root = chord[0];
      const n = T.lead[i];
      if (n > 0) {
        const dur = T.len[i] * step * 0.9;
        this.tone({ freq: midi(n), dur, gain: 0.1, type: 'square', at: t, out });
        this.tone({ freq: midi(thirdBelow(n)), dur: dur * 0.9, gain: 0.055, type: 'square', at: t, out });
        if (T.high[bar])
          this.tone({ freq: midi(n) * 2, dur: dur * 0.6, gain: 0.02, type: 'square', at: t, out });
      }
      if (sb === 0)
        this.tone({ freq: midi(root - 24), dur: step * 3.4, gain: 0.2, type: 'triangle', at: t, out });
      if (sb === 4 || sb === 8)
        for (const iv of [0, chord[1], 7])
          this.tone({ freq: midi(root + iv), dur: step * 1.5, gain: 0.045, type: 'sawtooth', at: t, out });
      if (sb % 2 === 0)
        this._noiseAt(t, sb === 0 ? 0.05 : 0.03, sb === 0 ? 0.13 : 0.07, 'highpass', 6500, out);
      if (I > 0.45 && (sb === 6 || sb === 10)) this._noiseAt(t, 0.07, 0.16, 'bandpass', 1900, out);
      if (bar === T.bars - 1 && sb >= 8)
        this._noiseAt(t, 0.06, 0.1 + (sb - 8) * 0.04, 'bandpass', 1600 + (sb - 8) * 300, out);
      m.next += step;
      m.step++;
    }
  }
  // something made of clay, wood or paper giving way
  smash(pos, big = false) {
    this.noise({
      dur: big ? 0.28 : 0.14,
      gain: big ? 0.7 : 0.45,
      type: 'lowpass',
      freq: big ? 900 : 1600,
      freqEnd: 200,
      pos,
    });
    this.noise({ dur: 0.05, gain: 0.35, type: 'highpass', freq: 3500, pos });
    this.tone({ freq: big ? 120 : 220, freqEnd: 60, dur: 0.12, gain: 0.25, type: 'triangle', pos });
  }
  _noiseAt(t0, dur, gain, type, freq, out) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.loopEnd = 2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(env);
    env.connect(out);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }
}

// ---------- the theme: seven eight-bar sections (~86s) on a sixteenth grid; 0 is a rest ----------
const N = (...pairs) => {
  const notes = [],
    lens = [];
  for (let k = 0; k < pairs.length; k += 2) {
    notes.push(pairs[k]);
    lens.push(pairs[k + 1]);
    for (let j = 1; j < pairs[k + 1]; j++) {
      notes.push(0);
      lens.push(0);
    }
  }
  return { notes, lens };
};
const C = [60, 4],
  G = [55, 4],
  Am = [57, 3],
  F = [53, 4],
  Em = [52, 3]; // [root, third] for the arpeggio and counter voice
const HOOK = [
  N(76, 2, 79, 2, 84, 3, 0, 1, 79, 2, 76, 2, 0, 4), // C: the leap, then a breath
  N(74, 3, 79, 3, 83, 2, 81, 2, 79, 4, 0, 2), // G: swung answer
  N(81, 2, 84, 2, 88, 4, 86, 2, 84, 2, 81, 4), // Am: the lift
  N(77, 2, 81, 2, 84, 2, 81, 2, 79, 2, 77, 2, 76, 2, 74, 2), // F: tumbling back down
];
const TAIL_A = [
  N(72, 2, 76, 2, 79, 4, 0, 2, 84, 4, 0, 2), // C
  N(83, 2, 81, 2, 79, 2, 74, 4, 0, 2, 79, 2, 81, 2), // G
  N(81, 3, 77, 3, 84, 3, 81, 3, 79, 4), // F: three-against-four
  N(79, 4, 77, 2, 76, 2, 74, 4, 0, 4), // G: walks back to the top
];
const TAIL_B = [
  N(76, 2, 79, 2, 84, 2, 88, 6, 0, 4), // C: reaches higher
  N(86, 2, 83, 2, 79, 4, 0, 2, 81, 2, 83, 4), // G
  N(84, 2, 81, 2, 77, 4, 81, 2, 84, 2, 86, 4), // F
  N(83, 3, 0, 1, 79, 3, 0, 1, 74, 4, 0, 4), // G: stabs, then hands off
];
const BRIDGE = [
  N(69, 2, 69, 2, 72, 2, 76, 4, 0, 2, 69, 4), // Am: low and punchy
  N(65, 2, 65, 2, 69, 2, 72, 4, 0, 2, 74, 2, 72, 2), // F
  N(76, 2, 76, 2, 74, 2, 72, 4, 0, 2, 67, 4), // C
  N(71, 2, 74, 2, 79, 4, 0, 2, 77, 2, 76, 2, 74, 2), // G
  N(69, 2, 69, 2, 72, 2, 76, 4, 0, 2, 81, 4), // Am: same call, higher answer
  N(77, 3, 0, 1, 77, 2, 81, 2, 84, 8), // F: opens up
  N(83, 2, 81, 2, 79, 4, 74, 4, 79, 4), // G
  N(83, 2, 86, 6, 0, 8), // G: one long note, then silence into the breakdown
];
const BREAK = [
  N(81, 8, 84, 8),
  N(83, 8, 86, 8),
  N(79, 8, 76, 8),
  N(81, 12, 0, 4), // F G Em Am: long floating notes
  N(77, 4, 81, 4, 84, 8),
  N(79, 4, 83, 4, 86, 8),
  N(88, 8, 86, 4, 84, 4),
  N(79, 4, 0, 12), // F G C C: climbs, then drops out for the fill
];
const CHORUS = [
  N(84, 3, 86, 1, 88, 4, 0, 2, 79, 6), // C: bright, dotted
  N(83, 3, 79, 1, 76, 4, 0, 2, 83, 6), // Em
  N(81, 3, 84, 1, 81, 4, 0, 2, 77, 6), // F
  N(79, 2, 81, 2, 83, 4, 86, 4, 0, 4), // G: climbs
  N(84, 3, 86, 1, 88, 4, 0, 2, 86, 3, 84, 3), // C
  N(83, 3, 79, 1, 76, 4, 0, 2, 83, 3, 84, 3), // Em
  N(81, 2, 84, 2, 81, 2, 77, 4, 0, 2, 81, 4), // F
  N(79, 4, 83, 2, 86, 2, 79, 4, 0, 4), // G: back to the hook
];
const PROG_A = [C, G, Am, F, C, G, F, G],
  PROG_B = [Am, F, C, G, Am, F, G, G],
  PROG_C = [F, G, Em, Am, F, G, C, C],
  PROG_D = [C, Em, F, G, C, Em, F, G];
const SECTIONS = [
  { bars: [...HOOK, ...TAIL_A], chords: PROG_A, bass: 'bounce', drums: 'full', arp: true },
  { bars: [...HOOK, ...TAIL_B], chords: PROG_A, bass: 'bounce', drums: 'full', arp: true, shadow: 0.02 },
  { bars: BRIDGE, chords: PROG_B, bass: 'drive', drums: 'driving' },
  { bars: BREAK, chords: PROG_C, bass: 'sparse', drums: 'sparse', echo: true },
  { bars: CHORUS, chords: PROG_D, bass: 'pump', drums: 'full', counter: true, shadow: 0.02 },
  { bars: [...HOOK, ...TAIL_A], chords: PROG_A, bass: 'bounce', drums: 'full', arp: true, shadow: 0.045 },
  { bars: CHORUS, chords: PROG_D, bass: 'pump', drums: 'driving', arp: true, counter: true, shadow: 0.03 },
];
const SONG = { lead: [], len: [], chord: [], section: [], firstBar: [], lastBar: [] };
for (const s of SECTIONS)
  s.bars.forEach((b, k) => {
    SONG.lead.push(...b.notes);
    SONG.len.push(...b.lens);
    SONG.chord.push(s.chords[k]);
    SONG.section.push(s);
    SONG.firstBar.push(k === 0);
    SONG.lastBar.push(k === s.bars.length - 1);
  });
SONG.bars = SONG.chord.length;
SONG.length = SONG.bars * 16;
// ---------- Doodle Mexico: sixteen bars of waltz in G, twelve sixteenths a bar ----------
const Gm = [67, 4],
  D7 = [62, 4],
  Cm = [60, 4],
  Em7 = [64, 3],
  Am7 = [69, 3];
const MEX_BARS = [
  N(74, 2, 79, 2, 83, 2, 86, 4, 83, 2),
  N(84, 2, 83, 2, 81, 2, 78, 4, 81, 2), // G: the call · D7
  N(79, 2, 83, 2, 86, 2, 91, 4, 86, 2),
  N(83, 4, 79, 4, 74, 4), // G: to the top · and down
  N(76, 2, 79, 2, 84, 2, 88, 4, 84, 2),
  N(86, 2, 83, 2, 79, 2, 83, 4, 86, 2), // C · G
  N(81, 2, 84, 2, 78, 2, 81, 4, 84, 2),
  N(83, 2, 81, 2, 79, 8), // D7 · G: hold
  N(79, 4, 83, 4, 86, 4),
  N(88, 2, 86, 2, 83, 2, 79, 4, 0, 2), // G · Em: the second verse sings higher
  N(84, 2, 88, 2, 91, 4, 88, 2, 84, 2),
  N(86, 4, 83, 4, 79, 4), // C · G
  N(81, 2, 84, 2, 88, 2, 86, 4, 84, 2),
  N(83, 2, 86, 2, 91, 4, 88, 2, 86, 2), // Am · D7
  N(84, 2, 83, 2, 81, 2, 79, 4, 78, 2),
  N(79, 6, 0, 2, 74, 4), // C D7 · G: the grito lands
];
const MEXICO = {
  lead: MEX_BARS.flatMap((b) => b.notes),
  len: MEX_BARS.flatMap((b) => b.lens),
  bpm: 150,
  chord: [Gm, D7, Gm, Gm, Cm, Gm, D7, Gm, Gm, Em7, Cm, Gm, Am7, D7, Cm, Gm],
  high: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
};
MEXICO.bars = MEXICO.chord.length;
MEXICO.length = MEXICO.bars * 12;
// the harmony trumpet sits a diatonic third under the lead (G major)
const G_SCALE = [7, 9, 11, 0, 2, 4, 6];
function thirdBelow(n) {
  const pc = ((n % 12) + 12) % 12;
  let k = G_SCALE.indexOf(pc);
  if (k < 0) return n - 4;
  k = (k + 5) % 7;
  let m = n - 1;
  while (((m % 12) + 12) % 12 !== G_SCALE[k]) m--;
  return m;
}
export const audio = new Sfx();
