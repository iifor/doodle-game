export function createScreens(ctx, prefs, actions, onScreen) {
  const { hud, game } = ctx;
  let kind = 'start';
  function show(next, error = '') {
    kind = next;
    hud.setGameplayVisible(false);
    onScreen({ kind, error, wave: game.wave, score: game.score, kills: game.kills, prefs, actions });
  }
  return {
    start() {
      show('start');
    },
    pause(error) {
      show('pause', error);
    },
    error(error) {
      show(kind, error);
    },
    dead() {
      if (game.score > prefs.get('best')) prefs.set('best', game.score);
      show('dead');
    },
    hide() {
      onScreen(null);
      hud.setGameplayVisible(true);
    },
  };
}
