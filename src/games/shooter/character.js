export const CLASSES = {
  blade: {
    name: '刀客',
    weapon: 'katana',
    base: [140, 100, 100, 10],
    growth: [8, 3, 2, 2],
    skills: ['突进斩', '刀气'],
    passive: '精准格挡强化下一次斩击',
  },
  gunner: {
    name: '枪手',
    weapon: 'rifle',
    base: [110, 100, 100, 0],
    growth: [5, 5, 2, 1],
    skills: ['专注射击', '战术闪避'],
    passive: '爆头使下一次装填加快 30%',
  },
  cannon: {
    name: '炮手',
    weapon: 'cannon',
    base: [150, 100, 100, 15],
    growth: [9, 3, 2, 2],
    skills: ['蓄力炮击', '震荡弹'],
    passive: '自身爆炸伤害降低 60%',
  },
  mage: {
    name: '战斗法师',
    weapon: 'staff',
    base: [100, 100, 100, 0],
    growth: [4, 2, 6, 1],
    skills: ['墨能法阵', '闪现'],
    passive: '技能命中返还 10 墨能（间隔 2 秒）',
  },
};
export const STATS = { health: '生命', weapon: '武器强度', skill: '技能强度', armor: '防护值' };
export const SLOTS = { weapon: '职业武器', armor: '护具', device: '职业装置' };
export const WEAPON_IDS = ['rifle', 'shotgun', 'sniper', 'katana', 'cannon', 'staff'];
const quality = ['普通', '精良', '稀有'];
export const EQUIPMENT = Object.fromEntries(
  Object.entries(CLASSES).flatMap(([role, c]) =>
    Object.keys(SLOTS).flatMap((slot) =>
      [0, 1, 2].map((tier) => {
        const id = `${role}-${slot}-${tier}`;
        return [
          id,
          {
            id,
            role,
            slot,
            level: [1, 3, 6][tier],
            name: `${quality[tier]}${slot === 'weapon' ? { katana: '武士刀', rifle: '步枪', cannon: '榴弹炮', staff: '墨能法杖' }[c.weapon] : slot === 'armor' ? '护甲' : '职业核心'}`,
            stat: slot === 'weapon' ? 'weapon' : slot === 'armor' ? 'armor' : 'skill',
            value: [0, 8, 18][tier],
            kind: slot === 'weapon' ? c.weapon : null,
            effect:
              slot === 'device' && tier === 2
                ? role === 'gunner'
                  ? '专注延长 2 秒，冷却增加 2 秒'
                  : '技能一伤害 +20%，冷却增加 2 秒'
                : '',
          },
        ];
      }),
    ),
  ),
);
for (const tier of [0, 1, 2]) {
  const id = `gunner-sniper-${tier}`;
  EQUIPMENT[id] = {
    ...EQUIPMENT[`gunner-weapon-${tier}`],
    id,
    name: `${quality[tier]}狙击枪`,
    kind: 'sniper',
  };
}
const KEY = 'doodle-character-v1';
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const natural = (n) => Number.isSafeInteger(n) && n >= 0;
export function newCharacter(role, name = '涂鸦旅人') {
  check(Object.hasOwn(CLASSES, role), '职业无效');
  check(
    typeof name === 'string' &&
      name.trim().length > 0 &&
      name.trim().length <= 14 &&
      !/[\p{Cc}\p{Cf}]/u.test(name),
    '名字须为 1–14 个可见字符',
  );
  const equipment = Object.fromEntries(Object.keys(SLOTS).map((s) => [s, `${role}-${s}-0`]));
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: name.trim(),
    role,
    xp: 0,
    points: 0,
    pity: 0,
    allocated: { health: 0, weapon: 0, skill: 0, armor: 0 },
    equipment,
    inventory: [...Object.values(equipment), ...(role === 'gunner' ? ['gunner-sniper-0'] : [])],
    receipts: {},
  };
}
export const levelOf = (c) => Math.min(10, 1 + Math.floor(c.xp / 100));
export function validateCharacter(c) {
  check(
    c &&
      c.version === 1 &&
      typeof c.id === 'string' &&
      c.id.length <= 100 &&
      typeof c.name === 'string' &&
      c.name.length <= 14 &&
      Object.hasOwn(CLASSES, c.role),
    '角色存档无效，请保留原存档排查',
  );
  check(natural(c.xp) && natural(c.points) && natural(c.pity) && c.pity < 20, '成长数值无效');
  for (const key of Object.keys(STATS)) check(natural(c.allocated?.[key]), '属性点无效');
  check(
    Array.isArray(c.inventory) &&
      c.inventory.length <= Object.keys(EQUIPMENT).length &&
      c.inventory.every((id) => EQUIPMENT[id]?.role === c.role),
    '背包装备无效',
  );
  for (const slot of Object.keys(SLOTS)) {
    const item = EQUIPMENT[c.equipment?.[slot]];
    check(item?.slot === slot && c.inventory.includes(item.id) && item.level <= levelOf(c), '穿戴装备无效');
  }
  check(c.receipts && typeof c.receipts === 'object' && !Array.isArray(c.receipts), '奖励记录无效');
  for (const [id, receipt] of Object.entries(c.receipts))
    check(
      id.length > 0 &&
        id.length <= 240 &&
        receipt &&
        [25, 60, 150].includes(receipt.xp) &&
        typeof receipt.point === 'boolean' &&
        (receipt.loot === null || EQUIPMENT[receipt.loot]?.role === c.role),
      '奖励记录无效',
    );
  return c;
}
export function parseCharacterBackup(text) {
  check(typeof text === 'string' && text.length <= 10 * 1024 * 1024, '备份文件过大或无效');
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('备份不是有效的 JSON 文件');
  }
  check(backup?.format === 'doodle-character-backup' && backup.version === 1, '角色备份格式或版本不兼容');
  profileOf(backup.character);
  return backup.character;
}
export function profileOf(c) {
  validateCharacter(c);
  const role = CLASSES[c.role],
    level = levelOf(c);
  const stats = Object.fromEntries(
    Object.keys(STATS).map((s, i) => [s, role.base[i] + (level - 1) * role.growth[i] + c.allocated[s]]),
  );
  for (const id of Object.values(c.equipment)) {
    const item = EQUIPMENT[id];
    stats[item.stat] += item.value;
  }
  const profile = {
    role: c.role,
    level,
    stats,
    weapon: EQUIPMENT[c.equipment.weapon].kind,
    empowered: c.equipment.device.endsWith('-2'),
  };
  return validateProfile(profile);
}
export function validateProfile(p) {
  check(
    p &&
      Object.hasOwn(CLASSES, p.role) &&
      Number.isInteger(p.level) &&
      p.level >= 1 &&
      p.level <= 10 &&
      typeof p.empowered === 'boolean',
    '角色战斗配置无效',
  );
  check(
    [CLASSES[p.role].weapon, ...(p.role === 'gunner' ? ['sniper'] : [])].includes(p.weapon),
    '武器不属于该职业',
  );
  for (const key of Object.keys(STATS))
    check(Number.isSafeInteger(p.stats?.[key]) && p.stats[key] >= (key === 'armor' ? 0 : 1), '战斗属性无效');
  return p;
}
// Defense adds effective health rather than multiplying unlimited health investment.
export const armorDamage = (amount, profile) => {
  const health = profile?.stats.health ?? 100;
  return amount * (health / (health + (profile?.stats.armor ?? 0)));
};
export const power = (profile, skill = false) => (profile?.stats[skill ? 'skill' : 'weapon'] ?? 100) / 100;
export function createCharacterStore(storage) {
  const read = () => {
    const raw = storage.getItem(KEY);
    return raw ? validateCharacter(JSON.parse(raw)) : null;
  };
  // ponytail: one JSON document for a friends-only prototype; move receipts to IndexedDB if save size becomes material.
  const write = (c) => {
    profileOf(c);
    storage.setItem(KEY, JSON.stringify(c));
    return c;
  };
  return {
    read,
    exportBackup() {
      const character = read();
      check(character, '请先创建角色');
      return JSON.stringify({ format: 'doodle-character-backup', version: 1, character }, null, 2);
    },
    restoreBackup(text) {
      const restored = parseCharacterBackup(text),
        current = read();
      if (current) {
        check(
          restored.id === current.id && restored.role === current.role,
          '只能恢复当前角色的备份；职业不可更改',
        );
        check(
          restored.xp >= current.xp &&
            Object.keys(STATS).every((key) => restored.allocated[key] >= current.allocated[key]) &&
            restored.points + Object.values(restored.allocated).reduce((a, b) => a + b, 0) >=
              current.points + Object.values(current.allocated).reduce((a, b) => a + b, 0) &&
            current.inventory.every((id) => restored.inventory.includes(id)) &&
            Object.entries(current.receipts).every(([id, r]) => {
              const other = restored.receipts[id];
              return (
                Object.hasOwn(restored.receipts, id) &&
                other.xp === r.xp &&
                other.point === r.point &&
                other.loot === r.loot
              );
            }),
          '备份早于当前成长或奖励记录不一致，已保留当前角色',
        );
      }
      return write(restored);
    },
    create(role, name) {
      check(!read(), '已有角色，职业不可更改');
      return write(newCharacter(role, name));
    },
    allocate(stat, count = 1) {
      const c = read();
      check(
        c && Object.hasOwn(STATS, stat) && natural(count) && count > 0 && count <= c.points,
        '可用属性点不足',
      );
      c.points -= count;
      c.allocated[stat] += count;
      profileOf(c);
      return write(c);
    },
    equip(id) {
      const c = read(),
        item = EQUIPMENT[id];
      check(c && c.inventory.includes(id) && item.level <= levelOf(c), '装备尚未解锁');
      c.equipment[item.slot] = id;
      return write(c);
    },
    reward(event, random = Math.random) {
      check(
        event &&
          typeof event.id === 'string' &&
          event.id.length > 0 &&
          event.id.length <= 240 &&
          ['landmark', 'elite', 'quest'].includes(event.type),
        '奖励事件无效',
      );
      const c = read();
      check(c, '请先创建角色');
      if (Object.hasOwn(c.receipts, event.id)) return null;
      const roll = random();
      check(Number.isFinite(roll) && roll >= 0 && roll < 1, '奖励随机数无效');
      const point = c.pity === 19 || roll < 0.05;
      c.points += point ? 1 : 0;
      c.pity = point ? 0 : c.pity + 1;
      const xp = { landmark: 25, elite: 60, quest: 150 }[event.type];
      c.xp += xp;
      const loot =
        event.type === 'quest'
          ? `${c.role}-${c.role === 'gunner' && roll < 0.5 ? 'sniper' : 'weapon'}-${levelOf(c) >= 6 ? 2 : 1}`
          : event.type === 'elite'
            ? `${c.role}-${roll < 0.5 ? 'armor' : 'device'}-${levelOf(c) >= 6 ? 2 : 1}`
            : null;
      if (loot && !c.inventory.includes(loot)) c.inventory.push(loot);
      const receipt = { xp, point, loot };
      c.receipts[event.id] = receipt;
      write(c);
      return receipt;
    },
  };
}

export function validateCombatState(p) {
  if (p.chargedAt !== undefined && p.chargedAt !== null)
    check(
      Number.isFinite(p.chargedAt) && p.chargedAt >= 0 && p.chargedAt <= Number.MAX_SAFE_INTEGER,
      '蓄力状态无效',
    );
  if (p.energy !== undefined)
    check(Number.isFinite(p.energy) && p.energy >= 0 && p.energy <= 100, '墨能状态无效');
  if (p.skillAt !== undefined)
    check(
      Array.isArray(p.skillAt) &&
        p.skillAt.length === 2 &&
        p.skillAt.every((n) => Number.isFinite(n) && n >= -100 && n <= Number.MAX_SAFE_INTEGER),
      '技能冷却无效',
    );
  for (const key of ['slowUntil', 'focusUntil', 'barrierUntil', 'barrier'])
    if (p[key] !== undefined)
      check(Number.isFinite(p[key]) && p[key] >= 0 && p[key] <= Number.MAX_SAFE_INTEGER, '技能效果无效');
}
