export const VERSION = 1;
export const MAX_PLAYERS = 10;
export const TARGET_KILLS = 20;
export const MATCH_SECONDS = 600;
export const MAX_HP = 110;
export const ROOM_PREFIX = 'doodle-game-v1-';
export const WEAPONS = {
  rifle: { damage: 19, head: 1.8, pellets: 1, interval: 1 / 11 },
  shotgun: { damage: 16, head: 1.6, pellets: 10, interval: 0.78 },
  sniper: { damage: 150, head: 1.5, pellets: 1, interval: 0.85 },
};
export function requireValue(ok, message) {
  if (!ok) throw new Error(`联机协议错误：${message}`);
}
export const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const finite = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
export const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(v) && v >= min && v <= max;
export const vector = (v, bound = 350) =>
  Array.isArray(v) && v.length === 3 && v.every((n) => finite(n, -bound, bound));
export function validateName(name) {
  requireValue(
    typeof name === 'string' &&
      name.trim() === name &&
      name.length >= 1 &&
      name.length <= 14 &&
      !/[\p{Cc}\p{Cf}]/u.test(name),
    '昵称须为 1–14 个可见字符',
  );
  return name;
}
export function validateCode(code) {
  requireValue(
    typeof code === 'string' && /^(?:[A-HJ-NP-Z2-9]{5}|PUB(?:[0-9]|1[0-5]))$/.test(code),
    '房间码格式不正确',
  );
  return code;
}
export function validateSnap(s) {
  requireValue(
    Array.isArray(s) && [11, 14].includes(s.length) && s.every(Number.isFinite),
    '玩家状态格式不正确',
  );
  requireValue(
    s.slice(0, 3).every((n) => finite(n, -100, 100)),
    '玩家坐标越界',
  );
  requireValue(
    finite(s[3], -1e7, 1e7) &&
      finite(s[4], -1.6, 1.6) &&
      integer(s[5], 0, 3) &&
      integer(s[6], 0, 4095) &&
      finite(s[7], 0, MAX_HP),
    '玩家状态字段不正确',
  );
  requireValue(
    s.slice(8, 11).every((n) => finite(n, -60, 60)),
    '玩家速度越界',
  );
  requireValue(!!(s[6] & 128) === (s.length === 14), '钩索状态长度不一致');
  if (s.length === 14)
    requireValue(
      s.slice(11).every((n) => finite(n, -150, 150)),
      '钩索坐标越界',
    );
}
export function validateAction(a) {
  requireValue(object(a) && integer(a.round, 1) && integer(a.life, 1) && integer(a.seq, 1), '动作序号不正确');
  switch (a.type) {
    case 'state':
      validateSnap(a.snap);
      break;
    case 'shot': {
      requireValue(Object.hasOwn(WEAPONS, a.kind), '未知武器');
      requireValue(
        vector(a.origin, 110) && Array.isArray(a.dirs) && a.dirs.length === WEAPONS[a.kind].pellets,
        '射击数据不正确',
      );
      for (const d of a.dirs)
        requireValue(vector(d, 1) && Math.abs(Math.hypot(...d) - 1) < 0.01, '射线方向须归一化');
      break;
    }
    case 'grenade':
      requireValue(vector(a.pos, 110) && vector(a.vel, 70), '手雷数据不正确');
      break;
    case 'take':
      requireValue(integer(a.id, 1), '补给编号不正确');
      break;
    case 'ready':
    case 'melee':
    case 'fall':
      break;
    default:
      throw new Error(`联机协议错误：未知动作 ${a.type}`);
  }
  return a;
}
export function validateFrame(frame) {
  requireValue(
    object(frame) && frame.v === VERSION && typeof frame.type === 'string',
    '协议版本或消息类型不匹配',
  );
  requireValue(JSON.stringify(frame).length <= 16384, '消息过大');
  return frame;
}
export function validateRoom(s) {
  requireValue(
    object(s) &&
      integer(s.round) &&
      integer(s.revision) &&
      ['lobby', 'match', 'over'].includes(s.phase) &&
      finite(s.left, 0, MATCH_SECONDS) &&
      finite(s.time, 0, 1e9),
    '房间状态不正确',
  );
  validateCode(s.code);
  requireValue(
    typeof s.host === 'string' &&
      typeof s.public === 'boolean' &&
      Array.isArray(s.players) &&
      s.players.length >= 1 &&
      s.players.length <= MAX_PLAYERS,
    '房间人数不正确',
  );
  const ids = new Set();
  for (const p of s.players) {
    requireValue(
      object(p) && typeof p.id === 'string' && p.id.length <= 100 && !ids.has(p.id),
      '玩家身份重复或无效',
    );
    ids.add(p.id);
    validateName(p.name);
    validateSnap(p.snap);
    requireValue(
      integer(p.kills) &&
        integer(p.deaths) &&
        integer(p.life, 1) &&
        finite(p.hp, 0, MAX_HP) &&
        typeof p.active === 'boolean' &&
        finite(p.shield, 0, 2) &&
        finite(p.respawn, 0, 2.5) &&
        integer(p.supplies),
      '玩家计分或生命不正确',
    );
  }
  requireValue(ids.has(s.host) && (s.winner === null || ids.has(s.winner)), '房主或胜者不在房间中');
  requireValue(Array.isArray(s.pickups) && s.pickups.length <= 20, '补给数量越界');
  const pickupIds = new Set();
  for (const p of s.pickups) {
    requireValue(object(p) && integer(p.id, 1) && !pickupIds.has(p.id) && vector(p.pos, 100), '补给无效');
    pickupIds.add(p.id);
  }
  return s;
}
