import { useEffect, useRef, useState } from 'react';
import { Settings } from './Settings.jsx';
import { Controls } from './Controls.jsx';
import './world.css';
import { inkCSS, inkName } from '../colors.js';
import { WORLD_STORY, CHAPTER_STEPS } from '../exploration/chapter.js';

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
        <h2>重燃街区 · 合作探索 · 角色成长</h2>
        {stage === 'connect' && <p>{WORLD_STORY}</p>}
        {view.chapter && (
          <div className="world-chapter" role="status">
            <strong>{view.chapter.complete ? '第一章完成 · 重燃街区' : '第一章 · 重燃街区'}</strong>
            <ol>
              {CHAPTER_STEPS.map((step, i) => (
                <li key={step.key}>
                  {view.chapter.power[i] ? '已通电' : '待修复'} · {step.name}（{step.key}）
                </li>
              ))}
            </ol>
            <p>
              {view.chapter.complete
                ? '区域能源已恢复，补给站与住宅已开放。可保存退出、返回主菜单调整搭配，或继续自由探索。'
                : '先修复三个外围街区，再恢复核心供电站。清理敌人后，在橙色标记处按 E。'}
            </p>
          </div>
        )}
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
                创建世界 · 开始第一章
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
                    {world.name} {world.schemaVersion === 1 ? '（持续探索）' : '（旧版小区域）'}
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
            <p>第一章包含四个目标街区，从营地东侧开始，最终恢复核心供电站。完成后可继续探索。</p>
            <p>
              AI
              随探索生成新的街区、建筑与敌人据点，没有固定地图尽头。世界保存到房主电脑，朋友可用房间码加入。
            </p>
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
            <p>
              {players.map((p) => (
                <span key={p.id} style={{ marginRight: '1em' }}>
                  <span style={{ color: inkCSS(p.ink) }}>● {inkName(p.ink)}</span> · {p.name}
                </span>
              ))}
            </p>
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
                {info?.schemaVersion === 2
                  ? '户外据点永久安全，仓库可在门外重置'
                  : '继续前进，发现新的街区与敌人据点'}
              </p>
            )}
            <details>
              <summary>世界背景与玩法</summary>
              <p>{WORLD_STORY}</p>
              <p>
                探索地标 → 清理街区 → 在供电站按 E 恢复供电 → 获得成长与装备、开放住宅和补给站。绿标处按 E
                补给。成长已自动保存，返回主菜单可加点换装，下次进入模式生效。
              </p>
              {info?.schemaVersion === 1 && (
                <p>
                  寻找橙色住宅门，靠近按 E 进入。首次生成室内并保存，重访读取缓存；在室内入口按 E 返回街道。
                </p>
              )}
              <Controls exploration />
            </details>
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
