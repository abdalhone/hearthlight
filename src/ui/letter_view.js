// A letter, read (round 14b T-5): Lyra's, when she left you. A paper panel, closable with
// its ✕ (44 px, the panel's own) or Esc; the words are in game.flags.lyra_letter.

import { h } from './dom.js';
import { makePanel } from './modal.js';

const LETTERS = {
  lyra_letter: (g) => ({ title: "Lyra's letter", flag: g?.flags?.lyra_letter || null }),
};

export function letterOf(game, itemId = 'lyra_letter') {
  const def = LETTERS[itemId];
  if (!def) return null;
  const { title, flag } = def(game);
  const text = String(flag?.text || '').trim();
  if (!text) return { title, paragraphs: ['The page is blank. Whatever she meant to write, she did not.'], day: null };
  return { title, paragraphs: text.split(/\n+/).map((p) => p.trim()).filter(Boolean), day: flag.day ?? null };
}

export function buildLetterPanel(game, itemId = 'lyra_letter') {
  const L = letterOf(game, itemId);
  if (!L) return null;
  const panel = makePanel({ id: 'letter', title: L.title, subtitle: L.day ? `Day ${L.day}` : '', iconName: 'scroll', cls: 'panel-small panel-letter' });
  const paper = h('div', { class: 'letter-paper' });
  for (const p of L.paragraphs) paper.append(h('p', { class: /^—/.test(p) ? 'letter-sign' : 'letter-line', text: p }));
  panel.body.append(paper);
  return panel;
}
