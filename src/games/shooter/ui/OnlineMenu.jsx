import { useEffect, useRef, useState } from 'react';
import { Settings } from './Settings.jsx';
import { Controls } from './Controls.jsx';
import { inkCSS, inkName } from '../colors.js';

export function OnlineMenu({ view }) {
  const { stage, room, selfId, busy, error, actions, prefs } = view;
  const [name, setName] = useState('涂鸦玩家');
  const [code, setCode] = useState('');
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
        <h2>自由混战 · 最多 10 人 · 20 杀获胜</h2>
        {stage === 'connect' ? (
          <>
            <label className="online-field">
              玩家昵称
              <input value={name} maxLength={14} disabled={busy} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="online-buttons">
              <button disabled={busy} onClick={() => actions.connect({ name: name.trim() })}>
                创建私人房间
              </button>
              <button disabled={busy} onClick={() => actions.connect({ name: name.trim(), isPublic: true })}>
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
            <table className="online-scores">
              <thead>
                <tr>
                  <th>玩家</th>
                  <th>击杀</th>
                  <th>阵亡</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span style={{ color: inkCSS(p.ink) }}>● {inkName(p.ink)} · </span>
                      {p.name}
                      {p.id === selfId ? '（你）' : ''}
                      {p.id === room.host ? ' · 房主' : ''}
                    </td>
                    <td>{p.kills}</td>
                    <td>{p.deaths}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stage === 'lobby' && <p>至少两名玩家进入战场后开始计时。房主离开会关闭房间。</p>}
            {stage === 'pause' && <p>联机对局仍在继续，菜单不会暂停战场。</p>}
            {stage === 'results' && (
              <p>
                {room.winner ? `${room.players.find((p) => p.id === room.winner).name} 获胜！` : '本局已结束'}
              </p>
            )}
            <div className="online-buttons">
              {stage === 'lobby' && (
                <button disabled={!host} onClick={actions.start}>
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
