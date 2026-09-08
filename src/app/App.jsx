import { createElement, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountShooter } from '../games/shooter/index.js';
import { OnlineMenu } from '../games/shooter/ui/OnlineMenu.jsx';
import { ShooterMenu } from '../games/shooter/ui/ShooterMenu.jsx';
import { TouchControls } from '../games/shooter/ui/TouchControls.jsx';

function App({ sessionRef, onReady }) {
  const canvas = useRef(null),
    hud = useRef(null),
    touch = useRef(null);
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    const session = mountShooter(canvas.current, hud.current, setMenu, touch.current);
    sessionRef.current = session;
    onReady();
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, [sessionRef, onReady]);
  return (
    <>
      <canvas ref={canvas} id="c" aria-label="涂鸦街区游戏画面" tabIndex={0} />
      <div ref={hud} id="hud" />
      <TouchControls rootRef={touch} />
      <div className="rotate-notice" role="status">
        请横屏游玩 · 旋转后点击继续
      </div>
      {menu &&
        (menu.kind === 'online' ? <OnlineMenu view={menu} /> : <ShooterMenu key={menu.kind} view={menu} />)}
    </>
  );
}

export function mountApplication(element, onError, onReady) {
  const sessionRef = { current: null };
  const root = createRoot(element, { onUncaughtError: onError });
  root.render(createElement(App, { sessionRef, onReady }));
  return {
    stop() {
      if (sessionRef.current) sessionRef.current.stop();
    },
    dispose() {
      root.unmount();
    },
  };
}
