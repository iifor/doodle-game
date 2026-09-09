import 'lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css';
import '../games/shooter/shooter.css';
import './shell.css';
import '../games/shooter/ui/mobile.css';

const status = document.getElementById('app-status');
const listeners = new AbortController();
let session;
let failed = false;

function fatal(reason) {
  if (failed) return;
  failed = true;
  console.error('[涂鸦世界] Fatal error', reason);
  status.replaceChildren();
  status.hidden = false;
  status.setAttribute('role', 'alert');
  const title = document.createElement('h1');
  title.textContent = '游戏已停止';
  const message = document.createElement('pre');
  message.textContent = reason instanceof Error ? reason.message : String(reason);
  const note = document.createElement('p');
  note.textContent = '错误已保留在控制台。请修正原因后重新加载；不会自动重置存档或切换玩法。';
  const reload = document.createElement('button');
  reload.textContent = '重新加载';
  reload.addEventListener('click', () => location.reload(), { signal: listeners.signal });
  status.append(title, message, note, reload);
  reload.focus();
  if (session) session.stop();
}

window.addEventListener('error', (event) => fatal(event.error ?? event.message), {
  signal: listeners.signal,
});
window.addEventListener('unhandledrejection', (event) => fatal(event.reason), { signal: listeners.signal });

try {
  const { mountApplication } = await import('./App.jsx');
  if (!failed) {
    session = mountApplication(document.getElementById('app'), fatal, () => {
      status.hidden = true;
    });
  }
} catch (error) {
  fatal(error);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    listeners.abort();
    if (session) session.dispose();
  });
}
