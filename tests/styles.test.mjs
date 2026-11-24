// The stylesheet stays whole (r8 audits, P0: a merge left `=======` lines and an unclosed
// rule in src/styles.css; the browser dropped .cs-root and swallowed ~1,300 lines under
// .sb-tab, so no cutscene could be tapped and the Spellbook could not scroll). Fails on
// any conflict marker, on braces that do not balance, and when the rules a tappable
// cutscene needs are not top-level rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_FILES = ['src/styles.css'];

// The stylesheet with comments and strings blanked out (kept the same length, so line
// numbers still match), for brace counting.
function codeOnly(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += css.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1;
      out += ' '.repeat(Math.min(j + 1, css.length) - i);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Top-level selectors (depth 0 when their block opens), in order.
function topLevelSelectors(code) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '{') {
      if (depth === 0) out.push(code.slice(start, i).trim());
      depth++;
      start = i + 1;
    } else if (c === '}') {
      depth--;
      start = i + 1;
    } else if (c === ';' && depth === 0) start = i + 1;
  }
  return out;
}

for (const rel of CSS_FILES) {
  const css = readFileSync(path.join(root, rel), 'utf8');

  test(`${rel}: no merge-conflict markers`, () => {
    const bad = [];
    css.split('\n').forEach((line, i) => {
      if (/^(<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)(\s|$)/.test(line)) bad.push(`${i + 1}: ${line.slice(0, 60)}`);
    });
    assert.deepEqual(bad, [], `conflict markers left in ${rel}`);
  });

  test(`${rel}: braces balance, and no rule closes before it opens`, () => {
    const code = codeOnly(css);
    let depth = 0;
    let line = 1;
    let firstNegative = 0;
    const open = []; // line of each still-open brace
    for (const c of code) {
      if (c === '\n') line++;
      else if (c === '{') {
        depth++;
        open.push(line);
      } else if (c === '}') {
        depth--;
        open.pop();
        if (depth < 0 && !firstNegative) firstNegative = line;
      }
    }
    assert.equal(firstNegative, 0, `a stray '}' at line ${firstNegative}`);
    assert.equal(depth, 0, `${depth} unclosed '{' (the outermost opened at line ${open[0]})`);
  });

  test(`${rel}: a cutscene's root is a real top-level rule that covers the screen and takes taps`, () => {
    const code = codeOnly(css);
    const tops = topLevelSelectors(code);
    const rule = tops.findIndex((s) => s.split(',').some((x) => x.trim() === '.cs-root'));
    assert.ok(rule >= 0, '.cs-root is not a top-level rule');
    // Its declarations: position, inset/size and pointer events.
    const m = /(^|[},;\s])\.cs-root\s*\{([^}]*)\}/m.exec(code);
    assert.ok(m, '.cs-root has no block of its own');
    const body = m[2];
    assert.match(body, /position\s*:\s*(absolute|fixed)/, '.cs-root must be positioned over the game');
    assert.match(body, /pointer-events\s*:\s*auto/, '.cs-root must take taps');
    // The rules after the Spellbook tabs are top level too (they were swallowed under .sb-tab).
    const sb = tops.findIndex((s) => /(^|,)\s*\.sb-tab\s*$/.test(s));
    if (sb >= 0) assert.ok(tops.length - sb > 20, `only ${tops.length - sb - 1} top-level rules after .sb-tab`);
  });
}
