import { useState } from 'react';
import { CLASSES, STATS, SLOTS, EQUIPMENT, newCharacter, profileOf, levelOf } from '../character.js';

export function CharacterMenu({ store, onDone, onTrial }) {
  const [character, setCharacter] = useState(() => store.read());
  const [role, setRole] = useState('blade');
  const [name, setName] = useState('涂鸦旅人');
  const [count, setCount] = useState(1);
  const [error, setError] = useState('');
  const run = (fn) => {
    try {
      setCharacter(fn());
      setError('');
    } catch (e) {
      setError(e.message);
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
