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
        <div className="mainbtns">
          {kind === 'start' ? (
            <>
              <button className="start" ref={firstButton} onClick={actions.explore}>
                开始开放世界<i>自由探索 · 合作战斗</i>
              </button>
              <button onClick={actions.online}>联机对战</button>
              <button className="solo" onClick={() => actions.begin(1)}>
                单人模式
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
