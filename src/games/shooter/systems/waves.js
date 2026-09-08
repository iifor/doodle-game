import * as THREE from 'three';
import { BOSSES, TYPES } from '../enemies/types.js';
import { choose, clamp } from '../util.js';

export function createWaves(ctx, pickups, focus, prefs) {
  const { game, enemies, player, hud, audio, world } = ctx;
  const ROSTER = [
    { t: 'grunt', from: 1, w: 10 },
    { t: 'rusher', from: 2, w: 6 },
    { t: 'bomber', from: 3, w: 3 },
    { t: 'sniper', from: 3, w: 4 },
    { t: 'flyer', from: 4, w: 4 },
    { t: 'heavy', from: 5, w: 4 },
    { t: 'shield', from: 6, w: 4 },
  ];
  const MODIFIERS = [
    {
      name: '',
      apply: () => {
        enemies.mods.speed = 1;
        enemies.mods.damage = 1;
      },
    },
    {
      name: '亢奋 · 敌人移动更快',
      apply: () => {
        enemies.mods.speed = 1.35;
        enemies.mods.damage = 0.85;
      },
    },
    {
      name: '浓墨 · 敌人伤害更高',
      apply: () => {
        enemies.mods.speed = 0.9;
        enemies.mods.damage = 1.4;
      },
    },
    {
      name: '蜂拥 · 敌人更多，单次攻击较弱',
      swarm: true,
      apply: () => {
        enemies.mods.speed = 1.15;
        enemies.mods.damage = 0.9;
      },
    },
  ];
  const tips = () => [
    `按住 <b>${hud.key('grapple')}</b> 拉近钩索 · 摆荡时再点按一次松开`,
    `按住 <b>${hud.key('block')}</b> 格挡，可将部分子弹反弹给敌人`,
    '空中击杀得分更高 · 保持腾空',
    `按 <b>${hud.key('grenade')}</b> 投掷手雷 · 拾取补给可补充`,
    `在空中再次按 <b>${hud.key('jump')}</b> 可二段跳`,
  ];
  const bossFor = (n) => BOSSES[(Math.floor(n / 5) - 1) % BOSSES.length];
  const enemyName = (type) => TYPES[type].name;
  function startWave(n) {
    if (!Number.isSafeInteger(n) || n < 1 || n > 10000) throw new RangeError(`Invalid wave: ${n}`);
    game.wave = n;
    game.queue = [];
    game.spawnT = 2;
    game.intermission = 0;
    game.boss = null;
    hud.setBoss(null, null);
    const boss = n > 0 && n % 5 === 0;
    const allowed = boss || n < 4 ? 1 : n < 6 ? 3 : MODIFIERS.length;
    const mod = MODIFIERS[Math.floor(Math.random() * allowed)];
    mod.apply();
    enemies.mods.damage *= 1.2;
    hud.setModifier(mod.name);
    const swarm = mod.swarm === true;
    // the crowd on screen and the wave size both keep growing with the wave number
    game.maxAlive = Math.min(
      4 + Math.floor(n * 0.9) + (swarm ? 3 : 0),
      (swarm ? 22 : 18) + Math.floor(n / 3),
    );
    let count = Math.round(Math.min(5 + n * 2.0, 32 + n) * (swarm ? 1.35 : 1));
    if (boss) {
      count = 7 + n;
      game.maxAlive += 2 + Math.floor(n / 5);
      game.queue.push(bossFor(n));
    }
    const pool = ROSTER.filter((r) => n >= r.from).map((r) => ({
      t: r.t,
      w: r.w * Math.min(1, 0.3 + 0.25 * (n - r.from)),
    }));
    const total = pool.reduce((a, r) => a + r.w, 0);
    for (let i = 0; i < count; i++) {
      let r = Math.random() * total,
        t = pool[0].t;
      for (const c of pool) {
        r -= c.w;
        if (r <= 0) {
          t = c.t;
          break;
        }
      }
      game.queue.push(t);
    }
    if (boss) {
      hud.message('第 ' + n + ' 波', enemyName(bossFor(n)) + ' 即将登场', 3);
      audio.bossRoar(player.center);
    } else
      hud.message(
        '第 ' + n + ' 波',
        n === 1
          ? '它们正从纸页中爬出来'
          : mod.name ||
              choose([
                '让墨水火力全开',
                '继续涂鸦，继续战斗',
                '保持腾空，灵活移动',
                '用钩索荡起来',
                '把子弹还给它们',
              ]),
        2.6,
      );
    audio.wave();
    if (n <= tips().length) hud.tip(tips()[n - 1], 7);
    player.grenades = Math.min(player.maxGrenades, player.grenades + 1);
    for (let i = 0; i < 7; i++) pickups.spawn(i < 5 ? 'ammo' : 'health', choose(ctx.level.pickups));
    if (n >= 5 && n % 5 === 0 && n > prefs.get('checkpoint')) {
      prefs.set('checkpoint', n);
      hud.kill('检查点已解锁 · 第 ' + n + ' 波', 0);
    }
  }
  function pickSpawn(type) {
    const spots = type === 'sniper' ? ctx.level.snipers : ctx.level.spawns;
    const pp = player.body.pos;
    if (type === 'flyer') {
      const a = Math.random() * Math.PI * 2,
        r = 22 + Math.random() * 10;
      return new THREE.Vector3(
        clamp(pp.x + Math.cos(a) * r, ctx.level.bounds.minX + 4, ctx.level.bounds.maxX - 4),
        pp.y + 12 + Math.random() * 6,
        clamp(pp.z + Math.sin(a) * r, ctx.level.bounds.minZ + 4, ctx.level.bounds.maxZ - 4),
      );
    }
    if (BOSSES.includes(type)) {
      const fits = (sp) =>
        !world.overlapsAABB(
          { x: sp.x - 1.1, y: sp.y + 0.1, z: sp.z - 1.1 },
          { x: sp.x + 1.1, y: sp.y + 5.2, z: sp.z + 1.1 },
        );
      const open = spots.filter((sp) => fits(sp));
      const far = open.filter((sp) => sp.distanceTo(pp) > 20);
      if (far.length) return choose(far).clone();
      if (open.length) return choose(open).clone();
      for (let i = 0; i < 200; i++) {
        const a = Math.random() * Math.PI * 2,
          r = 22 + Math.random() * 18;
        const c = new THREE.Vector3(
          clamp(pp.x + Math.cos(a) * r, -44, 44),
          0,
          clamp(pp.z + Math.sin(a) * r, -44, 44),
        );
        c.y = world.groundBelow(c.x, 30, c.z, 40);
        if (c.y > -3 && fits(c)) return c;
      }
      throw new Error(`No valid spawn for boss ${type} on ${ctx.level.key}`);
    }
    let cands = spots.filter((s) => {
      const d = s.distanceTo(pp);
      return d > 14 && d < 48;
    });
    if (cands.length < 2) cands = spots.filter((s) => s.distanceTo(pp) > 14);
    const hidden = cands.filter(
      (s) => !world.hasLineOfSight(player.eye, new THREE.Vector3(s.x, s.y + 1.2, s.z)),
    );
    return choose(hidden.length ? hidden : cands.length ? cands : spots).clone();
  }
  function updateWaves(dt) {
    if (game.intermission > 0) {
      game.intermission -= dt;
      hud.setTimer('下一波将在 ' + Math.ceil(game.intermission) + ' 秒后开始');
      if (game.intermission <= 0) {
        hud.setTimer('');
        startWave(game.wave + 1);
      }
      return;
    }
    if (game.queue.length && enemies.alive < game.maxAlive) {
      game.spawnT -= dt;
      if (game.spawnT <= 0) {
        game.spawnT = Math.max(0.7, 2.9 - game.wave * 0.13);
        const t = game.queue.shift();
        const e = enemies.spawn(t, pickSpawn(t));
        if (e.T.boss) {
          const mul = 1 + 0.35 * Math.floor((game.wave - 5) / 15);
          e.hp = e.maxHp = Math.round(e.T.hp * mul);
        }
      }
    }
    if (!game.queue.length && enemies.alive === 0) {
      game.intermission = 8;
      hud.message('第 ' + game.wave + ' 波已清除', '稍作休息 · 得分 +' + 200 * game.wave, 2.5);
      game.addScore(200 * game.wave, null);
      audio.waveClear();
      player.hp = Math.min(player.maxHp, player.hp + 40);
    }
    hud.setWave(game.wave, enemies.alive + game.queue.length);
  }
  enemies.onKill = (e, info, over) => {
    game.kills++;
    game.combo++;
    game.comboT = 3.5;
    let label = e.T.name,
      pts = e.T.score;
    if (info.crit) {
      label = '爆头';
      pts += 60;
    }
    if (info.source === 'katana') {
      label = over ? '斩碎' : '斩杀';
      pts += 50;
    }
    if (info.source === 'focus') {
      label = '处决';
      pts += 150;
    }
    if (info.source === 'katana' || info.source === 'focus') {
      game.katanaStreak++;
      player.weapons[player.katanaIndex].addBlood(0.42);
      if (game.katanaStreak >= focus.chargeKills) focus.enter();
    } else if (info.source !== 'blast') game.katanaStreak = 0;
    if (info.source === 'deflect') {
      label = '反弹击杀';
      pts += 120;
    }
    if (info.source === 'fall') label = '坠落纸外';
    else if (!player.body.onGround && info.source !== 'deflect') {
      label += ' · 空中击杀';
      pts += 40;
    }
    game.addScore(pts, label);
    audio.kill(!!info.crit || e.T.boss);
    const r = Math.random();
    if (r < 0.5) pickups.spawn('ammo', e.body.pos);
    else if (r < 0.62) pickups.spawn('health', e.body.pos);
  };
  enemies.onBoss = (e) => {
    if (!e.alive) {
      hud.setBoss(null, null);
      game.boss = null;
    } else {
      game.boss = e;
      hud.setBoss(e.T.name, e.hp / e.maxHp);
    }
  };

  return { start: startWave, update: updateWaves };
}
