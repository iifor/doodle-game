import { outpostComplete, requireWorld } from './schema.js';

export const QUEST_ORDER = ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'];

/** Player-facing copy only. No lore chapter names. */
export const QUESTS = {
  Q0: {
    brief: '路口那边不安静。清干净再回来补弹药。',
    done: '还行。东边也一样乱。',
    kind: 'outposts',
    need: 1,
  },
  Q1: {
    brief: '多拿回两条街。看见袖章别愣，先开枪。',
    done: '有人在找一样从仓库丢的东西。你要是路过……',
    kind: 'outposts',
    need: 2,
  },
  Q2: {
    brief: '旧仓库有人设卡。进去把里面清掉。',
    done: '地板下面还有味道。先别追。',
    kind: 'warehouse',
  },
  Q3: {
    brief: '里头有个不肯倒的。打跑也行，打倒更好。',
    done: '倒了。墙上字别碰。',
    fled: '它跑了。还会回来。',
    kind: 'boss',
    boss: 'boss',
  },
  Q4: {
    brief: '那边黑得不对。去压一压，别被溅到。',
    done: '未干的账，总要有人写完。',
    kind: 'boss',
    boss: 'inkblot',
  },
  Q5: {
    brief: '桥对面有人。走上面，别走街心。',
    done: '下次还走上面。',
    kind: 'rooftop',
  },
  Q6: {
    brief: '有东西在抹房子。别被它擦到。',
    done: '它还会来。营地多留个人。',
    kind: 'boss',
    boss: 'eraser',
  },
  Q7: {
    brief: '门口那条路昨儿还不是这样。去看看谁在改。',
    done: '别站着。回去补给处说一声。',
    kind: 'outposts',
    need: 1,
  },
  Q8: {
    brief: '那张大页还在。你想怎么处置？',
    done: '行。就这么办。',
    kind: 'ending',
    choices: ['毁掉那张大页', '让粉白的把脏的抹掉', '拖回营地锁起来'],
  },
};

export function defaultQuests() {
  return { active: null, completed: [], flags: {} };
}

export function validateQuests(raw) {
  requireWorld(raw && typeof raw === 'object' && !Array.isArray(raw), '委托存档无效');
  const completed = Array.isArray(raw.completed) ? raw.completed.map(String) : [];
  requireWorld(
    completed.every((id) => QUEST_ORDER.includes(id)) && new Set(completed).size === completed.length,
    '委托完成列表无效',
  );
  const active = raw.active == null ? null : String(raw.active);
  requireWorld(active === null || QUEST_ORDER.includes(active), '当前委托无效');
  requireWorld(
    raw.flags == null || (typeof raw.flags === 'object' && !Array.isArray(raw.flags)),
    '委托标记无效',
  );
  const flags = { ...(raw.flags && typeof raw.flags === 'object' ? raw.flags : {}) };
  if (flags.baseline !== undefined)
    requireWorld(Number.isInteger(flags.baseline) && flags.baseline >= 0, '委托基线无效');
  if (flags.clears !== undefined)
    requireWorld(Number.isInteger(flags.clears) && flags.clears >= 0, '委托进度无效');
  if (flags.choice !== undefined)
    requireWorld(Number.isInteger(flags.choice) && flags.choice >= 0 && flags.choice <= 2, '结局选项无效');
  if (flags.targetChunk !== undefined)
    requireWorld(typeof flags.targetChunk === 'string' && flags.targetChunk.length <= 32, '委托目标无效');
  if (flags.bossFled !== undefined) requireWorld(typeof flags.bossFled === 'boolean', '委托标记无效');
  if (flags.bossSpawned !== undefined) requireWorld(typeof flags.bossSpawned === 'boolean', '委托标记无效');
  if (flags.ending !== undefined)
    requireWorld(['seal', 'erase', 'cage'].includes(flags.ending), '结局标记无效');
  if (flags.roofTouch !== undefined) requireWorld(typeof flags.roofTouch === 'boolean', '委托标记无效');
  return { active, completed, flags };
}

export function outdoorClearCount(progress) {
  return Object.values(progress?.chunks ?? {}).filter((s) => outpostComplete(s)).length;
}

export function nextQuestId(completed) {
  return QUEST_ORDER.find((id) => !completed.includes(id)) ?? null;
}

export function questBrief(quests) {
  if (!quests?.active) return '';
  const def = QUESTS[quests.active];
  if (!def) return '';
  if (quests.active === 'Q8') {
    const i = quests.flags.choice ?? 0;
    return `${def.brief} · ${def.choices[i]}（E 换选项 · T 确认）`;
  }
  if (def.kind === 'outposts' && quests.flags.baseline !== undefined) {
    const have = Math.max(0, (quests.flags.clears ?? quests.flags.baseline) - quests.flags.baseline);
    return `${def.brief}（${Math.min(have, def.need)}/${def.need}）`;
  }
  return def.brief;
}

export function startQuest(quests, id, progress) {
  const next = { active: id, completed: [...quests.completed], flags: { ...quests.flags } };
  const def = QUESTS[id];
  if (def.kind === 'outposts') {
    next.flags.baseline = outdoorClearCount(progress);
    next.flags.clears = next.flags.baseline;
  }
  if (def.kind === 'boss') {
    delete next.flags.bossFled;
    delete next.flags.bossSpawned;
  }
  if (def.kind === 'rooftop') next.flags.roofTouch = false;
  if (id === 'Q8') next.flags.choice = next.flags.choice ?? 0;
  return next;
}

function finishAndOffer(quests, progress, tip) {
  const id = quests.active;
  const completed = quests.completed.includes(id) ? [...quests.completed] : [...quests.completed, id];
  const base = { active: null, completed, flags: { ...quests.flags } };
  for (const k of ['baseline', 'clears', 'bossSpawned', 'bossFled', 'roofTouch', 'targetChunk'])
    delete base.flags[k];
  const following = nextQuestId(completed);
  if (!following) return { quests: base, tip, autoStart: null };
  return { quests: startQuest(base, following, progress), tip, autoStart: following };
}

/** Outpost, warehouse, or rooftop clear. */
export function onClear(quests, progress, { warehouse = false, rooftop = false } = {}) {
  if (!quests?.active) return { quests, tip: null, autoStart: null };
  const def = QUESTS[quests.active];
  if (!def) return { quests, tip: null, autoStart: null };

  if (def.kind === 'outposts') {
    const clears = outdoorClearCount(progress);
    const next = { ...quests, flags: { ...quests.flags, clears } };
    if (clears - (next.flags.baseline ?? 0) < def.need) return { quests: next, tip: null, autoStart: null };
    return finishAndOffer(next, progress, def.done);
  }
  if (def.kind === 'warehouse' && warehouse) return finishAndOffer(quests, progress, def.done);
  if (def.kind === 'rooftop' && rooftop) return finishAndOffer(quests, progress, def.done);
  return { quests, tip: null, autoStart: null };
}

export function onBossKill(quests, progress, fled = false) {
  if (!quests?.active) return { quests, tip: null, autoStart: null };
  const def = QUESTS[quests.active];
  if (def?.kind !== 'boss') return { quests, tip: null, autoStart: null };
  if (fled) {
    return {
      quests: { ...quests, flags: { ...quests.flags, bossFled: true, bossSpawned: false } },
      tip: def.fled ?? '它跑了。',
      autoStart: null,
    };
  }
  return finishAndOffer(quests, progress, def.done);
}

/** Camp supply / talk. Starts the next open quest, cycles Q8, or confirms ending with T. */
export function onCampInteract(quests, progress, { confirmEnding = false } = {}) {
  const q = validateQuests(quests ?? defaultQuests());

  if (!q.active) {
    const id = nextQuestId(q.completed);
    if (!id) return { quests: q, tip: q.flags.ending ? '营地还安静。' : null, autoStart: null };
    return { quests: startQuest(q, id, progress), tip: QUESTS[id].brief, autoStart: id };
  }

  if (q.active === 'Q8') {
    if (confirmEnding) {
      const endings = ['seal', 'erase', 'cage'];
      const choice = q.flags.choice ?? 0;
      return finishAndOffer(
        { ...q, flags: { ...q.flags, ending: endings[choice] } },
        progress,
        `${QUESTS.Q8.choices[choice]}。${QUESTS.Q8.done}`,
      );
    }
    const choice = ((q.flags.choice ?? 0) + 1) % 3;
    return {
      quests: { ...q, flags: { ...q.flags, choice } },
      tip: `${QUESTS.Q8.choices[choice]}（T 确认）`,
      autoStart: null,
    };
  }

  return { quests: q, tip: QUESTS[q.active].brief, autoStart: null };
}
