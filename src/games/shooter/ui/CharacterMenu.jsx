import { useState } from 'react';
import {
  CLASSES,
  STATS,
  SLOTS,
  EQUIPMENT,
  newCharacter,
  profileOf,
  levelOf,
  parseCharacterBackup,
} from '../character.js';

export function CharacterMenu({ store, onDone, onTrial }) {
  const [character, setCharacter] = useState(() => store.read());
  const [role, setRole] = useState('blade');
  const [name, setName] = useState('涂鸦旅人');
  const [count, setCount] = useState(1);
  const [error, setError] = useState('');
  const [backup, setBackup] = useState(null);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState('');
  const run = (fn) => {
    try {
      setCharacter(fn());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };
  const exportBackup = () => {
    try {
      const url = URL.createObjectURL(new Blob([store.exportBackup()], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `涂鸦角色-${character.name}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('已发起备份下载；文件包含角色成长、装备与奖励记录，不包含世界地图。');
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };
  const chooseBackup = async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    setBackup(null);
    if (!file) return;
    setReading(true);
    setError('');
    setNotice('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('备份文件不能超过 10 MB');
      const text = await file.text(),
        saved = parseCharacterBackup(text);
      setBackup({ text, saved });
    } catch (e) {
      setError(e.message);
    } finally {
      setReading(false);
    }
  };
  const c = character ?? newCharacter(role);
  const profile = profileOf(c),
    profession = CLASSES[c.role];
  return (
    <div
      className="screen show shooter-menu"
      role="dialog"
      aria-modal="true"
      aria-labelledby="character-title"
    >
      <div className="panel character-panel">
        <h1 id="character-title">{character ? `${c.name} · ${profession.name}` : '创建角色'}</h1>
        {!character && (
          <>
            <p>每个浏览器只保留一个角色；创建后职业永久固定。可先进入训练场试用。</p>
            <label>
              名字 <input maxLength={14} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="mainbtns">
              {Object.entries(CLASSES).map(([id, value]) => (
                <button key={id} aria-pressed={role === id} onClick={() => setRole(id)}>
                  {value.name}
                </button>
              ))}
            </div>
          </>
        )}
        <p>
          {profession.skills.join(' / ')} · 被动：{profession.passive}
        </p>
        <p>
          等级 {levelOf(c)}/10 · 经验 {c.xp} · 可用属性点 {c.points} · 保底进度 {c.pity}/20
        </p>
        <p>F / G：技能一 / 二 · 跑跳、滑铲、钩索通用 · PVP 完整继承以下属性</p>
        {character && (
          <label>
            本次投入{' '}
            <input
              type="number"
              min="1"
              step="1"
              max={Math.max(1, c.points)}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
        )}
        <div className="character-stats">
          {Object.entries(STATS).map(([key, label]) => (
            <div key={key}>
              <span>
                {label} <strong>{profile.stats[key]}</strong>
              </span>
              {character && (
                <button
                  disabled={!Number.isSafeInteger(count) || count < 1 || count > c.points}
                  onClick={() => run(() => store.allocate(key, count))}
                >
                  +{count}
                </button>
              )}
            </div>
          ))}
        </div>
        {c.role === 'gunner' && (
          <p>
            技能强度提高专注伤害与闪避护盾；当前战术护盾 {((40 * profile.stats.skill) / 100).toFixed(1)}，持续
            4 秒。
          </p>
        )}
        <p>
          防护减伤 {((profile.stats.armor / (profile.stats.health + profile.stats.armor)) * 100).toFixed(1)}%
          · 每属性点 +1 · 暂不支持洗点
        </p>
        {character &&
          Object.entries(SLOTS).map(([slot, label]) => (
            <label className="character-equipment" key={slot}>
              {label}
              <select value={c.equipment[slot]} onChange={(e) => run(() => store.equip(e.target.value))}>
                {c.inventory
                  .filter((id) => EQUIPMENT[id].slot === slot)
                  .map((id) => {
                    const item = EQUIPMENT[id];
                    return (
                      <option key={id} value={id} disabled={item.level > levelOf(c)}>
                        {item.name} · {STATS[item.stat]} +{item.value} · Lv.{item.level}
                        {item.effect ? ` · ${item.effect}` : ''}
                      </option>
                    );
                  })}
              </select>
            </label>
          ))}
        <p>任务、首次地标、精英挑战可获成长；5% 获得属性点，第 20 次必得。训练与 PVP 不发成长奖励。</p>
        <details>
          <summary>角色备份与恢复</summary>
          <p>角色只保存在当前浏览器。备份包含属性、装备、保底与领取记录；世界地图需要单独备份。</p>
          {character && <button onClick={exportBackup}>下载角色备份</button>}
          <label className="character-equipment">
            选择角色备份
            <input type="file" accept=".json,application/json" disabled={reading} onChange={chooseBackup} />
          </label>
          {reading && <p role="status">正在读取备份…</p>}
          {backup && (
            <div>
              <p>
                待恢复：{backup.saved.name} · {CLASSES[backup.saved.role].name} · Lv.{levelOf(backup.saved)} ·
                可用属性点 {backup.saved.points} · 已领取 {Object.keys(backup.saved.receipts).length} 项奖励。
              </p>
              <p>确认后将恢复此角色状态；已有角色只能恢复同一角色，较旧进度会被拒绝。</p>
              <button
                onClick={() =>
                  run(() => {
                    const restored = store.restoreBackup(backup.text);
                    setBackup(null);
                    setNotice('角色已恢复并保存。');
                    return restored;
                  })
                }
              >
                确认恢复角色
              </button>
              <button onClick={() => setBackup(null)}>取消恢复</button>
            </div>
          )}
        </details>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="mainbtns">
          {character ? (
            <>
              <button className="start" onClick={onDone}>
                保存搭配并返回
              </button>
              <button onClick={() => onTrial(c.role, true)}>试用本职业全部装备</button>
            </>
          ) : (
            <>
              <button className="start" onClick={() => run(() => store.create(role, name))}>
                创建 · 固定职业
              </button>
              <button onClick={() => onTrial(role)}>试用 {profession.name}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
