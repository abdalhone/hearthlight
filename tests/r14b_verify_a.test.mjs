// Round 14b, independent verifier A: what playing the author's items on three screens found,
// each pinned by a test that failed before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
const filesUnder = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesUnder(p) : p.endsWith('.js') ? [p] : [];
  });

// Item 27 on a phone: the stick held in one thumb and a weave dragged to aim with the other is
// a two-finger touch. A touchmove that is no longer cancelable (the browser has begun its own
// gesture) must not be cancelled: Chrome logs an intervention error for every such move.
test('two-finger touch: no touchmove listener cancels an uncancelable move', () => {
  const bad = [];
  for (const f of filesUnder(SRC)) {
    const src = readFileSync(f, 'utf8');
    const re = /addEventListener\(\s*'touchmove'[\s\S]{0,240}?preventDefault\(\)/g;
    for (const m of src.matchAll(re)) if (!/cancelable/.test(m[0])) bad.push(`${f.slice(SRC.length)}: ${m[0].replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  assert.deepEqual(bad, []);
});

// Item 27 (and 5) on a computer: a notice the toast stack places over the play field (clear of
// the HUD, the bubbles and the player, but not of a wolf) must not eat the click meant for the
// world: the left button is the sword and the right button casts, wherever they land. A tap
// on a phone still puts a notice away.
test('with a mouse, a notice over the field lets the sword and the cast through', () => {
  const css = [readFileSync(join(SRC, 'styles.css'), 'utf8'), ...readdirSync(join(SRC, 'styles')).map((f) => readFileSync(join(SRC, 'styles', f), 'utf8'))].join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/pointer-events\s*:\s*auto/.test(m[2])) continue;
    for (const sel of m[1].split(',').map((x) => x.trim()))
      if (/\.toast(?![-\w])/.test(sel) && !/\.is-touch/.test(sel)) bad.push(sel);
  }
  assert.deepEqual(bad, [], 'a notice is clickable only on a touch screen');
  assert.match(css, /\.is-touch \.toast\s*\{[^}]*pointer-events:\s*auto/, 'on a phone a tap still puts one away');
});
