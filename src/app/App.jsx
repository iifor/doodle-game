import { createElement, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountShooter } from '../games/shooter/index.js';
import { WorldMenu } from '../games/shooter/ui/WorldMenu.jsx';
import { OnlineMenu } from '../games/shooter/ui/OnlineMenu.jsx';
import { ShooterMenu } from '../games/shooter/ui/ShooterMenu.jsx';
import { CharacterMenu } from '../games/shooter/ui/CharacterMenu.jsx';
import { createCharacterStore, newCharacter, profileOf, EQUIPMENT } from '../games/shooter/character.js';
import { TouchControls } from '../games/shooter/ui/TouchControls.jsx';

function App({ sessionRef, onReady }) {
  const canvas = useRef(null),
    hud = useRef(null),
    touch = useRef(null);
  const [menu, setMenu] = useState(null);
  const [store] = useState(() => createCharacterStore(localStorage));
  const [characterOpen, setCharacterOpen] = useState(() => !store.read());
  const characterOpenRef = useRef(characterOpen);
  characterOpenRef.current = characterOpen;
  const [character, setCharacter] = useState(() => store.read());
  const [trial, setTrial] = useState(false);
  const [revision, setRevision] = useState(0);
  const [explore, setExplore] = useState(false);
  useEffect(() => {
    const session = mountShooter(canvas.current, hud.current, setMenu, touch.current, {
      explore,
      canBegin: () => !characterOpenRef.current,
      characterStore: store,
      profile: trial ? profileOf(character) : store.read() ? profileOf(store.read()) : null,
      trialCharacter: trial ? character : null,
      onTrialEquip: (id) =>
        setCharacter((c) => ({ ...c, equipment: { ...c.equipment, [EQUIPMENT[id].slot]: id } })),
      trial,
      onCharacter: () => setCharacterOpen(true),
      onExplore: () => {
        if (!trial && store.read()) setExplore(true);
        else setCharacterOpen(true);
      },
      onHome: () => setExplore(false),
    });
    sessionRef.current = session;
    onReady();
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, [sessionRef, onReady, explore, character, store, trial, revision]);
  return (
    <>
      <canvas ref={canvas} id="c" aria-label="涂鸦世界游戏画面" tabIndex={0} />
      <div ref={hud} id="hud" />
      <TouchControls rootRef={touch} />
      <div className="rotate-notice" role="status">
        请横屏游玩 · 旋转后点击继续
      </div>
      {characterOpen && (
        <CharacterMenu
          store={store}
          onDone={() => {
            setCharacter(store.read());
            setTrial(false);
            setRevision((r) => r + 1);
            setCharacterOpen(false);
          }}
          onTrial={(role, equipment = false) => {
            const c = newCharacter(role);
            if (equipment) {
              c.xp = 900;
              c.inventory = Object.values(EQUIPMENT)
                .filter((e) => e.role === role)
                .map((e) => e.id);
              for (const slot of Object.keys(c.equipment)) c.equipment[slot] = `${role}-${slot}-2`;
            }
            setCharacter(c);
            setTrial(true);
            setExplore(false);
            setCharacterOpen(false);
          }}
        />
      )}
      {!characterOpen &&
        menu &&
        (menu.kind === 'world' ? (
          <WorldMenu view={menu} />
        ) : menu.kind === 'online' ? (
          <OnlineMenu view={menu} />
        ) : (
          <ShooterMenu key={menu.kind} view={menu} />
        ))}
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
