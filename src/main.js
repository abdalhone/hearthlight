import { Game } from './core/game.js';

function showFatal(root, err) {
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = `Hearthlight could not start: ${err?.message || err}. Try reloading the page.`;
  root.appendChild(box);
}

function start() {
  const root = document.getElementById('app');
  if (!root) return;
  let game;
  try {
    game = new Game(root);
  } catch (err) {
    console.error(err);
    showFatal(root, err);
    return;
  }
  game.boot().catch((err) => {
    console.error(err);
    showFatal(root, err);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
