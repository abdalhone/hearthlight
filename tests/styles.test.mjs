// The stylesheet must be whole. A merge once left `=======` lines and an
// unclosed rule in src/styles.css; the browser then dropped the cutscene's
// root rule and folded ~1,300 lines (Spellbook, menu, Settings) into one
// selector, and the phone UI fell apart. These checks catch that at test time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'src', 'styles.css'), 'utf8');

test('styles.css: no merge-conflict markers', () => {
  const bad = css
    .split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /^(<<<<<<<|=======|>>>>>>>)/.test(l));
  assert.deepEqual(bad, [], `conflict markers at lines ${bad.map((b) => b[0]).join(', ')}`);
});

/** Strip comments and strings, then walk braces; return the top-level rule preludes. */
function topLevel(src) {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  let depth = 0;
  let buf = '';
  const preludes = [];
  for (const ch of s) {
    if (ch === '{') {
      if (depth === 0) preludes.push(buf.trim());
      depth++;
      buf = '';
    } else if (ch === '}') {
      depth--;
      assert.ok(depth >= 0, 'a closing brace with no rule open');
      buf = '';
    } else if (ch === ';' && depth === 0) {
      buf = '';
    } else {
      buf += ch;
    }
  }
  assert.equal(depth, 0, 'unbalanced braces: a rule is never closed');
  return preludes;
}

test('styles.css: braces balance and key rules stay top-level', () => {
  const tops = topLevel(css);
  for (const sel of ['.cs-root', '.sb-tab', '.set-main', '.set-label', '.life-case', '.menu-item', '.hud']) {
    assert.ok(
      tops.some((p) => p.split(',').map((x) => x.trim()).includes(sel)),
      `${sel} is not a top-level rule (swallowed by an unclosed rule?)`
    );
  }
});

test('styles.css: no declaration sits directly inside a nested-looking rule', () => {
  // A plain rule (not @media/@supports/@keyframes/@container/@layer) must not
  // contain another `selector {` — that is the shape an unclosed rule leaves.
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  let buf = '';
  let line = 1;
  const problems = [];
  for (const ch of s) {
    if (ch === '\n') line++;
    if (ch === '{') {
      const prelude = buf.trim();
      const parent = stack[stack.length - 1];
      if (parent && !parent.startsWith('@')) problems.push(`line ${line}: "${prelude.slice(0, 40)}" nested in "${parent.slice(0, 40)}"`);
      stack.push(parent && parent.startsWith('@keyframes') ? '@frame' : prelude);
      buf = '';
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else if (ch === ';') {
      buf = '';
    } else buf += ch;
  }
  assert.deepEqual(problems.slice(0, 5), []);
});

test('styles.css: every declaration is "property: value" (no spliced tails)', () => {
  // A merge once left `.set-label {` holding the tail of another rule's
  // box-shadow ("2px 0 0 0 var(--bc), …") — valid braces, broken rule.
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(s))) {
    const prelude = m[1].trim();
    if (/^(from|to|\d+%)/.test(prelude.split('\n').pop().trim())) continue; // keyframe steps are fine too
    for (const decl of m[2].split(';')) {
      const d = decl.trim();
      if (!d) continue;
      if (!/^(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:/.test(d)) bad.push(`${prelude.split('\n').pop().slice(0, 40)} → ${d.slice(0, 40)}`);
    }
  }
  assert.deepEqual(bad.slice(0, 5), []);
});
