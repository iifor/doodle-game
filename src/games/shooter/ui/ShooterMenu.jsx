import { CLASSES, EQUIPMENT, SLOTS, STATS } from '../character.js';
import { useEffect, useRef, useState } from 'react';
import { Settings } from './Settings.jsx';
import { Controls } from './Controls.jsx';

function Checkpoints({ unlocked, onContinue }) {
  const [wave, setWave] = useState(5);
  if (!unlocked) return null;
  return (
    <div className="checkpoints">
      <label>
        检查点{' '}
        <select value={wave} onChange={(event) => setWave(Number(event.target.value))}>
          {Array.from({ length: unlocked / 5 }, (_, i) => (i + 1) * 5).map((n) => (
            <option key={n} value={n}>
              第 {n} 波
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => onContinue(wave)}>从检查点继续</button>
    </div>
  );
}

export function ShooterMenu({ view }) {
  const { kind, wave, score, kills, error, prefs, actions } = view;
  const firstButton = useRef(null);
  useEffect(() => {
    firstButton.current.focus({ preventScroll: true });
  }, [kind]);
  return (
    <div className="screen show shooter-menu" role="dialog" aria-modal="true" aria-labelledby="menu-title">
      <div className="panel">
        <h1 id="menu-title">{kind === 'start' ? '涂鸦世界' : kind === 'pause' ? '已暂停' : '你被擦除了'}</h1>
        {kind === 'start' ? (
          <h2>纸上涂鸦 · 开放世界</h2>
        ) : (
          <h2>
            第 {wave} 波 · 得分 {score}
            {kind === 'dead' && ` · 击败 ${kills} 名敌人`}
          </h2>
        )}
        {view.profile && (
          <p>
            {CLASSES[view.profile.role].name} · Lv.{view.profile.level} · 生命 {view.profile.stats.health} ·
            武器 {view.profile.stats.weapon} · 技能 {view.profile.stats.skill} · 防护{' '}
            {view.profile.stats.armor}
            {view.trialCharacter ? ' · 临时试用，不保存成长' : ' · 训练不发成长奖励'}
          </p>
        )}
        {kind === 'start' &&
          view.trialCharacter &&
          Object.entries(SLOTS).map(([slot, label]) => (
            <label className="character-equipment" key={slot}>
              {label}
              <select
                value={view.trialCharacter.equipment[slot]}
                onChange={(e) => actions.trialEquip(e.target.value)}
              >
                {view.trialCharacter.inventory
                  .filter((id) => EQUIPMENT[id].slot === slot)
                  .map((id) => (
                    <option key={id} value={id}>
                      {EQUIPMENT[id].name} · {STATS[EQUIPMENT[id].stat]} +{EQUIPMENT[id].value}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        <div className="mainbtns">
          {kind === 'start' ? (
            <>
              <button className="start" ref={firstButton} onClick={actions.explore}>
                开始开放世界<i>自由探索 · 合作战斗</i>
              </button>
              <button onClick={actions.character}>角色与装备</button>
              <button onClick={actions.online}>联机对战</button>
              <button className="solo" onClick={() => actions.begin(1)}>
                个人训练场
              </button>
            </>
          ) : (
            <>
              <button
                className="start"
                ref={firstButton}
                onClick={() => actions.begin(kind === 'pause' ? undefined : 1)}
              >
                {kind === 'pause' ? '继续游戏' : '再画一局'}
              </button>
              <button onClick={actions.menu}>返回主菜单</button>
            </>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        {kind !== 'dead' && (
          <>
            <Controls />
            <Settings prefs={prefs} onChange={actions.settings} />
          </>
        )}
        {kind !== 'pause' && <Checkpoints unlocked={prefs.get('checkpoint')} onContinue={actions.begin} />}
        <div className="beststat">最高得分： {prefs.get('best')}</div>
      </div>
    </div>
  );
}
