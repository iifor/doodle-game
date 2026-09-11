import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldStore } from '../server/world-store.js';
import {
  QUESTS,
  QUEST_ORDER,
  defaultQuests,
  validateQuests,
  startQuest,
  onClear,
  onBossKill,
  onCampInteract,
  questBrief,
  outdoorClearCount,
} from '../src/games/shooter/exploration/quests.js';

test('quest copy stays free of storyline meta words', () => {
  const banned = /故事|主线|篇章|设定|折页社|涂改派|空白|溢墨|墨核/;
  for (const id of QUEST_ORDER) {
    const q = QUESTS[id];
    assert.ok(!banned.test(q.brief), id);
    assert.ok(!banned.test(q.done), id);
    for (const line of q.choices ?? []) assert.ok(!banned.test(line), id);
  }
});

test('validateQuests rejects bad active ids', () => {
  assert.throws(() => validateQuests({ active: 'QX', completed: [], flags: {} }));
  assert.deepEqual(validateQuests(defaultQuests()), defaultQuests());
});

test('Q0 then Q1 advance from outdoor clears', () => {
  let progress = { chunks: {} };
  let quests = startQuest(defaultQuests(), 'Q0', progress);
  assert.equal(quests.active, 'Q0');
  assert.match(questBrief(quests), /路口那边/);

  progress = {
    chunks: { '1,0': { defeated: [0, 1, 2, 3], rewarded: true } },
  };
  let result = onClear(quests, progress);
  assert.equal(result.quests.active, 'Q1');
  assert.ok(result.quests.completed.includes('Q0'));
  assert.ok(result.tip);

  quests = result.quests;
  progress = {
    chunks: {
      '1,0': { defeated: [0, 1, 2, 3], rewarded: true },
      '0,1': { defeated: [0, 1, 2, 3], rewarded: true },
    },
  };
  result = onClear(quests, progress);
  assert.equal(result.quests.active, 'Q1');
  assert.equal(outdoorClearCount(progress) - quests.flags.baseline, 1);

  progress.chunks['1,1'] = { defeated: [0, 1, 2, 3], rewarded: true };
  result = onClear(quests, progress);
  assert.equal(result.quests.active, 'Q2');
  assert.ok(result.quests.completed.includes('Q1'));
});

test('Q2 completes on warehouse clear', () => {
  const quests = startQuest({ active: null, completed: ['Q0', 'Q1'], flags: {} }, 'Q2', {
    chunks: {},
    runs: {},
  });
  const result = onClear(
    quests,
    { chunks: {}, runs: { w: { runId: 1, defeated: [0, 1, 2, 3], rewarded: true } } },
    {
      warehouse: true,
    },
  );
  assert.equal(result.quests.active, 'Q3');
  assert.ok(result.quests.completed.includes('Q2'));
});

test('Q3 flees once then completes on kill', () => {
  let quests = startQuest({ active: null, completed: ['Q0', 'Q1', 'Q2'], flags: {} }, 'Q3', {
    chunks: {},
  });
  let result = onBossKill(quests, { chunks: {} }, true);
  assert.equal(result.quests.active, 'Q3');
  assert.equal(result.quests.flags.bossFled, true);
  assert.match(result.tip, /跑了/);
  result = onBossKill(result.quests, { chunks: {} }, false);
  assert.equal(result.quests.active, 'Q4');
});

test('camp interact starts next quest and confirms Q8 ending', () => {
  let result = onCampInteract(defaultQuests(), { chunks: {} });
  assert.equal(result.quests.active, 'Q0');

  result = onCampInteract(
    { active: 'Q8', completed: QUEST_ORDER.slice(0, 8), flags: { choice: 1 } },
    { chunks: {} },
    { confirmEnding: true },
  );
  assert.equal(result.quests.active, null);
  assert.equal(result.quests.flags.ending, 'erase');
  assert.ok(result.quests.completed.includes('Q8'));
});

test('world store persists quests patch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'doodle-quests-'));
  const store = new WorldStore(dir, () => {
    throw new Error('no generate');
  });
  try {
    const info = await store.create('委托测试', 1, false);
    store.claim(info.id, 'host');
    const p0 = await store.progress(info.id);
    assert.deepEqual(p0.quests, defaultQuests());
    const next = startQuest(defaultQuests(), 'Q0', p0);
    const p1 = await store.update(info.id, 'host', { revision: p0.revision, quests: next });
    assert.equal(p1.quests.active, 'Q0');
    assert.equal((await store.progress(info.id)).quests.active, 'Q0');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
