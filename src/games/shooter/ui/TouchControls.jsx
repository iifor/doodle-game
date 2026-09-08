const button = (action, label) => (
  <button key={action} type="button" data-touch={action} aria-label={label}>
    {label}
  </button>
);

export function TouchControls({ rootRef }) {
  return (
    <div ref={rootRef} className="touch-controls" aria-label="触屏战斗操作">
      <div className="touch-look" data-touch="look" aria-label="滑动调整视角" />
      <div className="touch-movement">
        <div className="touch-tools">
          {button('grapple', '钩索')}
          {button('melee', '拔刀')}
          {button('dash', '冲刺斩')}
        </div>
        <div className="touch-stick" data-touch="move" aria-label="移动摇杆">
          <i />
          <span>移动</span>
        </div>
        <div className="touch-sprint">{button('sprint', '疾跑')}</div>
      </div>
      <div className="touch-system">
        {button('score', '计分板')}
        {button('pause', '菜单')}
      </div>
      <div className="touch-weapons">
        {['步枪', '霰弹', '狙击', '武士刀'].map((label, i) => button(`slot${i + 1}`, label))}
      </div>
      <div className="touch-actions">
        {button('aim', '瞄准')}
        {button('fire', '射击')}
        {button('jump', '跳跃')}
        {button('reload', '装弹')}
        {button('grenade', '手雷')}
        {button('crouch', '滑铲')}
      </div>
    </div>
  );
}
