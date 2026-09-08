import { useState } from 'react';

export function Settings({ prefs, onChange }) {
  const [values, setValues] = useState(() => ({
    sensitivity: prefs.get('sensitivity'),
    invert: prefs.get('invert'),
    music: prefs.get('music'),
  }));
  function change(key, value) {
    prefs.set(key, value);
    onChange();
    setValues((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <div className="settings">
      <label>
        视角灵敏度{' '}
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
