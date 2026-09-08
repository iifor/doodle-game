import { useEffect, useRef, useState } from 'react';
import { Settings } from './Settings.jsx';
import { Controls } from './Controls.jsx';
import './world.css';

export function WorldMenu({ view }) {
  const {
    stage,
    info,
    worlds,
    host,
    roomCode,
    players,
    busy,
    canEnter,
    error,
    actions,
    prefs,
    generated,
    pausedGeneration,
    saving,
    unsaved,
  } = view;
  const [name, setName] = useState('涂鸦玩家'),
    [worldName, setWorldName] = useState('我的涂鸦城镇'),
    [code, setCode] = useState('');
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [stage]);
  return (
    <div className="screen show shooter-menu" role="dialog" aria-modal="true" aria-labelledby="world-title">
      <div className="panel online-panel world-panel">
        <h1 id="world-title" ref={heading} tabIndex={-1}>
          {info?.name ?? '开放世界'}
        </h1>
        <h2>边走边画 · 探索城镇 · 合作清理据点</h2>
        {info?.region && (
          <p>
            {info.region.name} · {info.region.background}
          </p>
        )}
        {stage === 'connect' ? (
          <>
            <label className="online-field">
              玩家昵称
              <input maxLength={14} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void actions.create(worldName.trim(), name.trim());
              }}
            >
              <label className="online-field">
                新世界名称
                <input
                  maxLength={40}
                  value={worldName}
                  disabled={busy}
                  onChange={(e) => setWorldName(e.target.value)}
                />
              </label>
              <button className="start" disabled={busy || !worldName.trim() || !name.trim()}>
                创建世界
              </button>
            </form>
            {worlds.length > 0 && (
              <div className="world-saves">
                <h3>继续世界</h3>
                {worlds.map((world) => (
                  <button
                    key={world.id}
                    disabled={busy || !name.trim()}
                    onClick={() => actions.load(world.id, name.trim())}
                  >
                    {world.name} {world.schemaVersion === 1 ? '（旧版世界）' : '（小区域）'}
                    <small>{new Date(world.createdAt).toLocaleDateString('zh-CN')}</small>
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void actions.join(code.trim().toUpperCase(), name.trim());
              }}
            >
              <label className="online-field">
                朋友的房间码
                <input
                  maxLength={5}
                  value={code}
                  disabled={busy}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="例如 ABC23"
                  autoCapitalize="characters"
                />
              </label>
              <button disabled={busy || !code.trim() || !name.trim()}>加入朋友</button>
            </form>
            <p>小区域含七栋可进入建筑，AI 基于模板设计变化并保存到房主电脑。朋友只需房间码和同版本游戏。</p>
          </>
        ) : (
          <>
            <p>
              {host ? '房主的持久世界' : '朋友的世界'} · 已探索 {generated} 个区域 · {players.length}/10 人
            </p>
            {roomCode && (
              <p className="room-code">
                邀请朋友：<strong>{roomCode}</strong>
              </p>
            )}
            <p>{players.map((p) => p.name).join(' · ')}</p>
            <div className="online-buttons">
              {stage !== 'disconnected' && (
                <button className="start" disabled={busy || !canEnter} onClick={actions.resume}>
                  {stage === 'ready' ? '进入城镇' : '继续探索'}
                </button>
              )}
              {host && !roomCode && (
                <button disabled={busy} onClick={actions.invite}>
                  邀请朋友
                </button>
              )}
              {host && (
                <button disabled={saving > 0} onClick={actions.generation}>
                  {pausedGeneration ? '恢复生成新区域' : '暂停生成新区域'}
                </button>
              )}
            </div>
            {host && (
              <p>
                {saving ? '正在保存…' : unsaved ? '有未保存进度' : '探索进度已保存'} ·
                户外据点永久安全，仓库可在门外重置
              </p>
            )}
            <Controls exploration />
            <Settings prefs={prefs} onChange={actions.settings} desktop />
          </>
        )}
        {error && (
          <p role="alert" className="online-error">
            {error}
          </p>
        )}
        {host && (error || unsaved > 0) && (
          <button disabled={saving > 0} onClick={actions.retry}>
            重试生成／保存
          </button>
        )}
        {busy && <p role="status">正在准备，请稍候…</p>}
        <button disabled={busy || saving > 0} onClick={actions.exit}>
          {info && host ? '保存并退出' : '返回主菜单'}
        </button>
      </div>
    </div>
  );
}
