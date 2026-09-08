const keyboard = [
  ['WASD / 鼠标 / Shift', '移动 · 转动视角 · 冲刺'],
  ['鼠标左键 / 右键', '射击或挥刀 · 瞄准或格挡'],
  ['空格', '跳跃 · 二段跳 · 蹬墙跳'],
  ['C / Ctrl', '地面滑铲 · 空中冲刺'],
  ['Q / E', '钩索：点按摆荡，长按拉近'],
  ['F / R / M', '快速拔刀斩 · 装弹 · 音乐开关'],
  ['G', '投掷手雷 · 长按蓄力投得更远'],
  ['同时按鼠标左右键 / X', '能量条亮起时发动冲刺斩'],
  ['1–4 / 滚轮', '步枪 · 霰弹枪 · 狙击枪 · 武士刀'],
  ['Esc', '暂停 / 对战菜单'],
  ['Tab', '联机计分板'],
];
const gamepad = [
  ['左摇杆 / 右摇杆 / L3', '移动 · 转动视角 · 冲刺'],
  ['R2 / L2', '射击或挥刀 · 瞄准或格挡'],
  ['✕ / ○', '跳跃 · 滑铲或空中冲刺'],
  ['L1', '钩索：长按拉近，按 ✕ 弹射'],
  ['L2 + R2', '能量条亮起时发动冲刺斩'],
  ['R1 / □ / △', '快速挥刀 · 装弹 · 切换武器'],
  ['R3 / 方向键上', '投掷手雷 · 长按蓄力投得更远'],
  ['Options', '暂停 / 对战菜单'],
  ['Create', '联机计分板'],
];

export function Controls() {
  return (
    <details>
      <summary>玩法与操作说明</summary>
      <div className="cols">
        {[
          ['键盘与鼠标', keyboard],
          ['PS5 手柄', gamepad],
        ].map(([title, rows]) => (
          <div key={title}>
            <div className="colhead">{title}</div>
            {rows.map(([key, description]) => (
              <div key={key}>
                <b>{key}</b> {description}
              </div>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
