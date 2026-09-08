import { useState } from 'react';

export function Settings({ prefs, onChange }) {
  const [values, setValues] = useState(() => ({
    sensitivity: prefs.get('sensitivity'),
    invert: prefs.get('invert'),
    music: prefs.get('music'),
    touchSensitivity: prefs.get('touchSensitivity'),
    quality: prefs.get('quality'),
  }));
  function change(key, value) {
    prefs.set(key, value);
    onChange();
    setValues((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <div className="settings">
      <label>
        鼠标 / 手柄灵敏度{' '}
        <input
          type="range"
          min="25"
          max="250"
          step="5"
          value={values.sensitivity}
          onChange={(event) => change('sensitivity', Number(event.target.value))}
        />
        <b>{values.sensitivity}%</b>
      </label>
      <label>
        触屏灵敏度
        <input
          type="range"
          min="25"
          max="250"
          step="5"
          value={values.touchSensitivity}
          onChange={(event) => change('touchSensitivity', Number(event.target.value))}
        />
        <b>{values.touchSensitivity}%</b>
      </label>
      <label>
        画质
        <select value={values.quality} onChange={(event) => change('quality', event.target.value)}>
          <option value="smooth">流畅</option>
          <option value="standard">标准</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={values.invert}
          onChange={(event) => change('invert', event.target.checked)}
        />{' '}
        反转垂直视角
      </label>
      <label>
        <input
          type="checkbox"
          checked={values.music}
          onChange={(event) => change('music', event.target.checked)}
        />{' '}
        背景音乐 <span className="k">(M)</span>
      </label>
    </div>
  );
}
