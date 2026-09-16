import { CLASSES } from '../character.js';
import { useEffect, useRef, useState } from 'react';
import { Settings } from './Settings.jsx';
import { Controls } from './Controls.jsx';
import { inkCSS, inkName, INK } from '../colors.js';

export function OnlineMenu({ view }) {
  const { stage, room, selfId, busy, error, actions, prefs } = view;
  const [name, setName] = useState('涂鸦玩家');
  const [code, setCode] = useState('');
  const [teamsEnabled, setTeamsEnabled] = useState(false);
  const [npcsEnabled, setNpcsEnabled] = useState(false);
  const first = useRef(null);
  useEffect(() => {
    first.current.focus({ preventScroll: true });
  }, [stage]);
  const host = room?.host === selfId;
  const title = {
    connect: '联机对战',
    lobby: '联机房间',
    ready: '对局已开始',
    pause: '对战菜单',
    results: '对局结束',
  }[stage];
  const sorted = room ? [...room.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths) : [];
  return (
    <div className="screen show shooter-menu" role="dialog" aria-modal="true" aria-labelledby="online-title">
      <div className="panel online-panel">
        <h1 id="online-title" ref={first} tabIndex={-1}>
          {title}
        </h1>
        <h2>
          {(room?.teamsEnabled ?? teamsEnabled)
            ? '红蓝组队 · 全队 20 杀获胜 · 无友伤'
            : '自由混战 · 20 杀获胜'}{' '}
          · 最多 10 人
        </h2>
        <p>本地角色完整继承 · 朋友互信 · 本局属性与装备固定</p>
        {stage === 'connect' ? (
          <>
            <label className="online-field">
              玩家昵称
              <input value={name} maxLength={14} disabled={busy} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <input
                type="checkbox"
                checked={npcsEnabled}
                disabled={busy}
                onChange={(e) => setNpcsEnabled(e.target.checked)}
              />
              创建房间时生成 NPC 小怪（默认关闭）
            </label>
            <label>
              <input
                type="checkbox"
                checked={teamsEnabled}
                disabled={busy}
                onChange={(e) => setTeamsEnabled(e.target.checked)}
              />
              创建组队房间（自动分队，房主可调整）
            </label>
            <div className="online-buttons">
              <button
                disabled={busy}
                onClick={() => actions.connect({ name: name.trim(), npcsEnabled, teamsEnabled })}
              >
                创建私人房间
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  actions.connect({ name: name.trim(), isPublic: true, npcsEnabled, teamsEnabled })
                }
              >
                创建公开房间
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void actions.connect({ name: name.trim(), code: code.trim().toUpperCase() });
              }}
            >
              <label className="online-field">
                房间码
                <input
                  value={code}
                  maxLength={5}
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={busy}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="例如 ABC23"
                />
              </label>
              <button disabled={busy || !code.trim()} type="submit">
                加入房间
              </button>
            </form>
            <details>
              <summary>加入公开房间</summary>
              <p>选择朋友创建的公开房间编号；连接失败会显示具体原因。</p>
              <div className="public-slots">
                {Array.from({ length: 16 }, (_, i) => (
                  <button
                    key={i}
                    disabled={busy}
                    onClick={() => actions.connect({ name: name.trim(), code: `PUB${i}` })}
                  >
                    PUB{i}
                  </button>
                ))}
              </div>
            </details>
            <p>将房间码和游戏网址发给朋友，双方打开同一版本游戏。</p>
            <button onClick={actions.exit}>{busy ? '取消连接并返回' : '返回主菜单'}</button>
          </>
        ) : (
          <>
            <p className="room-code">
              房间码 <strong>{room.code}</strong> · {room.public ? '公开' : '私人'} · {room.players.length}/10
              人
            </p>
            <p>地图：涂鸦街区竞技场 · 时限 10 分钟</p>
            <label>
              <input
                type="checkbox"
                checked={room.npcsEnabled ?? false}
                disabled={!host || stage !== 'lobby'}
                onChange={(e) => actions.configureNpcs(e.target.checked)}
              />
              生成 NPC 小怪 · 随机 8–16 秒刷新，最多 4 只（不计入对战击杀）
            </label>
            <label>
              <input
                type="checkbox"
                checked={room.teamsEnabled}
                disabled={!host || stage !== 'lobby'}
                onChange={(e) => actions.configureTeams(e.target.checked)}
              />
              红蓝组队 · 无友伤 · 房主调整队伍
            </label>
            {room.teamsEnabled && (
              <p>
                红队 {room.teamScores[0]} : {room.teamScores[1]} 蓝队 · 助攻：击杀前 8 秒内造成伤害
              </p>
            )}
            <table className="online-scores">
              <thead>
                <tr>
                  <th>玩家</th>
                  {room.teamsEnabled && <th>队伍</th>}
                  <th>击杀</th>
                  <th>助攻</th>
                  <th>阵亡</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span style={{ color: inkCSS(p.team ? (p.team === 1 ? INK.RED : INK.BLUE) : p.ink) }}>
                        ● {p.team ? (p.team === 1 ? '红队' : '蓝队') : inkName(p.ink)} ·{' '}
                      </span>
                      {p.name}
                      {p.id === selfId ? '（你）' : ''}
                      {p.id === room.host ? ' · 房主' : ''}
                      {p.profile && (
                        <small>
                          {' '}
                          · {CLASSES[p.profile.role].name} Lv.{p.profile.level} · 生命{' '}
                          {p.profile.stats.health}
                        </small>
                      )}
                    </td>
                    {room.teamsEnabled && (
                      <td>
                        <select
                          aria-label={`${p.name}的队伍`}
                          value={p.team}
                          disabled={!host || stage !== 'lobby'}
                          onChange={(e) => actions.setTeam(p.id, Number(e.target.value))}
                        >
                          <option value={1}>红队</option>
                          <option value={2}>蓝队</option>
                        </select>
                      </td>
                    )}
                    <td>{p.kills}</td>
                    <td>{p.assists}</td>
                    <td>{p.deaths}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stage === 'lobby' && (
              <p>组队时双方至少各一人才能开局；至少两名玩家进入战场后开始计时。房主离开会关闭房间。</p>
            )}
            {stage === 'pause' && <p>联机对局仍在继续，菜单不会暂停战场。</p>}
            {stage === 'results' && (
              <p>
                {room.teamsEnabled
                  ? room.winnerTeam
                    ? `${room.winnerTeam === 1 ? '红队' : '蓝队'}获胜！`
                    : '平局'
                  : room.winner
                    ? `${room.players.find((p) => p.id === room.winner).name} 获胜！`
                    : '本局已结束'}
              </p>
            )}
            <div className="online-buttons">
              {stage === 'lobby' && (
                <button
                  disabled={
                    !host ||
                    (room.teamsEnabled && ![1, 2].every((team) => room.players.some((p) => p.team === team)))
                  }
                  onClick={actions.start}
                >
                  {host ? '开始对局' : '等待房主开始'}
                </button>
              )}
              {(stage === 'ready' || stage === 'pause') && (
                <button onClick={actions.resume}>{stage === 'ready' ? '进入战场' : '继续战斗'}</button>
              )}
              {stage === 'results' && (
                <button disabled={!host} onClick={actions.back}>
                  {host ? '返回房间' : '等待房主返回房间'}
                </button>
              )}
              <button onClick={actions.exit}>离开房间</button>
            </div>
            {(stage === 'pause' || stage === 'lobby') && (
              <>
                <Controls />
                <Settings prefs={prefs} onChange={actions.settings} />
              </>
            )}
          </>
        )}
        {busy && <p role="status">正在连接，请稍候…</p>}
        {error && (
          <p role="alert" className="online-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
