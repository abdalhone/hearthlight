// The memorial and Past lives (DESIGN §27). When the stranger dies with no kept flame, the
// story ends here: how it happened, Lyra's last diary entry about them, and what the
// village says. The title screen keeps every ended life under Past lives.

import { h, button } from './dom.js';
import { makePanel } from './modal.js';
import { readPastLives } from '../survival/past_lives.js';

function dateLabel(ms) {
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

const STYLE_ID = 'sv-styles';

const CSS = `
.sv-layer { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
.sv-fallen { position: absolute; left: 50%; bottom: calc(18% + var(--sa-b, 0px)); transform: translateX(-50%);
  width: min(360px, calc(100vw - 32px)); display: flex; flex-direction: column; align-items: center; gap: 6px;
  text-align: center; font-family: var(--font-body, system-ui, sans-serif); color: var(--parch, #f4ead7);
  text-shadow: 0 1px 0 #000, 0 0 8px rgba(0,0,0,.8); transition: opacity .6s ease; }
.sv-fallen[hidden] { display: none; }
.sv-ecg { width: 220px; height: 40px; display: block; }
.sv-status { margin: 0; font-family: var(--font-display, system-ui); font-size: var(--fs-l, 19px); letter-spacing: .04em; color: #ff8b80; }
.sv-sub { margin: 0; font-size: var(--fs-s, 14px); color: var(--parch-2, #e0d4bd); min-height: 1.2em; }
.sv-flame { margin: 0; font-size: var(--fs-xs, 12px); color: var(--parch-dim, #b9ad99); }
.sv-flame.is-lit { color: var(--ember-hot, #ffe08a); }
.sv-flame.is-out { color: #e39a93; }
.sv-call { pointer-events: auto; margin-top: 4px; min-width: 200px; min-height: 52px; font-family: var(--font-display, system-ui);
  font-size: var(--fs-m, 16px); color: #fff4ea; background: #8f2633; border: 0; cursor: pointer;
  box-shadow: 0 -2px 0 #3a0b12, 0 2px 0 #3a0b12, -2px 0 0 #3a0b12, 2px 0 0 #3a0b12, inset 0 2px 0 rgba(255,255,255,.18);
  display: inline-flex; align-items: center; justify-content: center; gap: 10px; padding: 0 18px; touch-action: manipulation; }
.sv-call:hover { background: #a52e3c; }
.sv-call:active { transform: translateY(1px); }
.sv-call[disabled] { background: #5b2530; color: #d8b9b6; cursor: default; }
.sv-call kbd { font-family: var(--font-display, system-ui); font-size: 12px; padding: 1px 6px; background: rgba(0,0,0,.3); }
.ui.is-touch .sv-call kbd { display: none; }
.sv-hint { margin: 0; font-size: var(--fs-xs, 12px); color: var(--parch-faint, #877d6e); }
.sv-curtain { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  pointer-events: none; opacity: 0; transition: opacity 1.4s ease; background: transparent; }
.sv-curtain.is-on { opacity: 1; }
.sv-curtain.is-under { z-index: 6; }
.sv-curtain.is-dark { background: #050309; pointer-events: auto; }
.sv-curtain[hidden] { display: none; }
.sv-words { max-width: min(560px, calc(100vw - 48px)); text-align: center; display: flex; flex-direction: column; gap: 14px; }
.sv-words p { margin: 0; font-family: var(--font-body, system-ui); font-size: clamp(16px, 2.4vw, 22px); line-height: 1.45;
  color: var(--parch-2, #e0d4bd); opacity: 0; transform: translateY(6px); transition: opacity 1.6s ease, transform 1.6s ease; }
.sv-words p.is-on { opacity: 1; transform: none; }
.sv-words p.sv-gold { color: var(--ember-hot, #ffe08a); text-shadow: 0 0 18px rgba(255,176,71,.55); }
.sv-words p.sv-big { font-family: var(--font-display, system-ui); font-size: clamp(22px, 4vw, 34px); color: var(--parch, #f4ead7); }
.panel-memorial .panel-body { display: flex; flex-direction: column; gap: 14px; }
.sv-mem-cause { margin: 0; color: var(--parch-2, #e0d4bd); font-size: var(--fs-m, 16px); }
.sv-mem-h { margin: 6px 0 0; font-family: var(--font-display, system-ui); font-size: var(--fs-s, 14px); letter-spacing: .06em; color: var(--ember, #ffb047); text-transform: uppercase; }
.sv-mem-says { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sv-mem-says li { margin: 0; font-size: var(--fs-s, 14px); line-height: 1.4; color: var(--parch-2, #e0d4bd); }
.sv-mem-says b { color: var(--parch, #f4ead7); font-weight: 600; }
.sv-mem-note { margin: 0; font-size: var(--fs-xs, 12px); color: var(--parch-faint, #877d6e); }
.sv-lives { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.sv-life { display: flex; align-items: center; gap: 12px; justify-content: space-between; padding: 10px 12px; background: rgba(10, 9, 25, .5); }
.sv-life-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sv-life-name { font-family: var(--font-display, system-ui); color: var(--parch, #f4ead7); }
.sv-life-meta { font-size: var(--fs-xs, 12px); color: var(--parch-dim, #b9ad99); }
@media (max-height: 430px) { .sv-fallen { bottom: calc(8% + var(--sa-b, 0px)); gap: 3px; } .sv-ecg { height: 30px; } .sv-call { min-height: 46px; } }
@media (prefers-reduced-motion: reduce) { .sv-words p, .sv-curtain { transition-duration: .01s; } }
`;

// The survival screens' own styles (the fall, the curtain, the memorial), injected once.
export function ensureSurvivalStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.append(st);
}


export function buildMemorial(ui, m, { final = false } = {}) {
  const days = m.day ?? 1;
  const panel = makePanel({
    id: 'memorial',
    title: `In memory of ${m.name}`,
    subtitle: `${days} ${days === 1 ? 'day' : 'days'} in Hearthvale${m.diedAt ? ` · ${dateLabel(m.diedAt)}` : ''}`,
    iconName: 'flame',
    cls: 'panel-wide panel-memorial',
    closeLabel: final ? 'Return to the title' : 'Close',
  });
  panel.pauses = true;
  panel.body.append(h('p', { class: 'sv-mem-cause', text: m.cause || 'They died.' }));
  const lyraName = m.companion || 'Lyra';
  panel.body.append(h('h3', { class: 'sv-mem-h', text: `${lyraName}'s diary, that night` }));
  const page = h('article', { class: 'diary-page' });
  for (const para of String(m.lyra?.text || '').split(/\n{2,}/)) if (para.trim()) page.append(h('p', { text: para.trim() }));
  page.append(h('p', { class: 'diary-sign', text: `— ${lyraName}` }));
  panel.body.append(page);
  if (m.village?.length) {
    panel.body.append(h('h3', { class: 'sv-mem-h', text: 'What the village says' }));
    const ul = h('ul', { class: 'sv-mem-says' });
    for (const v of m.village) ul.append(h('li', null, h('b', { text: `${v.name}: ` }), `“${v.text}”`));
    panel.body.append(ul);
  }
  if (m.saved > 0) panel.body.append(h('p', { class: 'sv-mem-note', text: `They carried or revived ${m.saved} ${m.saved === 1 ? 'person' : 'people'} who would otherwise have lain there.` }));
  if (final) panel.body.append(h('p', { class: 'sv-mem-note', text: 'This story has ended. Its save is closed for good and rests under Past lives on the title screen. A new game begins a new life.' }));
  const done = () => {
    if (final) {
      try {
        location.reload();
      } catch {
        /* nothing to reload in tests */
      }
    } else ui.closeModal(panel);
  };
  panel.foot.append(button(final ? 'Return to the title' : 'Close', { cls: 'btn-ember', onClick: done }));
  if (final) {
    // There is no going back into a closed life: closing the panel is leaving it.
    panel.onClose = () => done();
  }
  return panel;
}

export function openMemorial(ui, m, opts = {}) {
  if (!ui || !m) return null;
  ensureSurvivalStyles();
  const panel = buildMemorial(ui, m, opts);
  ui.openModal(panel);
  return panel;
}

export function openPastLives(ui) {
  ensureSurvivalStyles();
  const lives = readPastLives();
  const panel = makePanel({ id: 'past-lives', title: 'Past lives', subtitle: lives.length ? 'Stories that ended' : 'None yet', iconName: 'scroll', cls: 'panel-small' });
  if (!lives.length) panel.body.append(h('p', { class: 'muted', text: 'No life has ended yet. Keep it that way.' }));
  const ul = h('ul', { class: 'sv-lives' });
  for (const m of lives) {
    const read = button('Read', { cls: 'btn-small', onClick: () => openMemorial(ui, m, { final: false }) });
    ul.append(
      h(
        'li',
        { class: 'sv-life' },
        h('div', { class: 'sv-life-text' }, h('span', { class: 'sv-life-name', text: m.name }), h('span', { class: 'sv-life-meta', text: `Day ${m.day ?? 1} · ${m.place || 'the wilds'}${m.diedAt ? ` · ${dateLabel(m.diedAt)}` : ''}` })),
        read,
      ),
    );
  }
  if (lives.length) panel.body.append(ul);
  panel.foot.append(button('Close', { cls: 'btn-ember', onClick: () => ui.closeModal(panel) }));
  ui.openModal(panel);
  return panel;
}
