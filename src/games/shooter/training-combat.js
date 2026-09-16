import { armorDamage } from './character.js';
import { encodeLocal } from './online/remote-player.js';
import { advanceGrenade } from './online/combat.js';
import { resetAbilities, tickAbilities } from './abilities.js';

export function trainingCombat(ctx) {
  const actor = {
    id: 'training-player',
    profile: ctx.profile,
    active: true,
    hp: ctx.player.hp,
    snap: encodeLocal(ctx.player, ctx.player.weaponIndex),
  };
  resetAbilities(actor);
  const arena = {
    actor,
    time: ctx.game.time,
    world: ctx.world,
    grenades: [],
    fields: [],
    get targets() {
      return [
        actor,
        ...ctx.enemies.enemies
          .filter((e) => e.alive)
          .map((e) => ({
            id: e.id,
            enemy: e,
            active: true,
            hp: e.hp,
            snap: [...e.body.pos.toArray(), e.yaw, 0, 0, 64, e.hp, 0, 0, 0],
            get slowUntil() {
              return e.slowUntil ?? 0;
            },
            set slowUntil(v) {
              e.slowUntil = v;
            },
          })),
      ];
    },
    damage(target, amount) {
      if (target.id === actor.id) {
        ctx.player.takeDamage(amount);
        return;
      }
      ctx.enemies.damage(target.enemy, armorDamage(amount, target.profile), {
        point: target.enemy.center.clone(),
        dir: ctx.player.forward.clone(),
        source: 'skill',
        part: 'torso',
        crit: false,
      });
    },
    emit(e) {
      if (e.type === 'shell-burst') ctx.player.burstShell(e);
      else if (e.type === 'grenade') ctx.player.throwGrenade(e);
      else ctx.player.showAbility(e);
    },
    update(dt) {
      Object.assign(actor, {
        profile: ctx.profile,
        hp: ctx.player.hp,
        active: ctx.player.alive,
        snap: encodeLocal(ctx.player, ctx.player.weaponIndex),
      });
      arena.time = ctx.game.time;
      arena.world = ctx.world;
      tickAbilities(arena, dt);
      arena.grenades = arena.grenades.filter((g) => !advanceGrenade(arena, g, dt));
    },
  };
  return arena;
}
