// A body on the ground: two choices, finger-sized (round 14b, item 9; DESIGN §35.3).
// "Search" opens their pockets (murder/loot.js), "Lift" lifts them (murder.js). Never the
// browser's confirm; the panel closes with its 44 px close control or Esc.

import { h, button } from './dom.js';
import { makePanel } from './modal.js';

export function openBodyChoice(game, { title, text, choices = [] }) {
  const ui = game?.ui;
  if (!ui?.openModal || !choices.length) return false;
  const panel = makePanel({ id: 'body', title, iconName: 'scroll', cls: 'panel-small panel-body-choice' });
  panel.body.append(h('p', { class: 'confirm-text body-choice-text', text }));
  let done = false;
  for (const c of choices) {
    const b = button(c.label, { cls: `${c.cls || 'btn-ghost'} body-choice-btn` });
    b.dataset.choice = c.id;
    b.addEventListener('click', () => {
      if (done) return;
      done = true;
      ui.closeModal(panel, true);
      try {
        c.run();
      } catch (err) {
        console.warn('[body] choice failed', err);
      }
    });
    panel.foot.append(b);
  }
  ui.openModal(panel);
  return panel;
}
