// Interface size with a mouse (r13 C5; the author: "on pc i feel that the hud is a little
// small"): bigger by default on a computer, three sizes, phones untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uiZoom, UI_SIZES } from '../src/ui/ui_scale.js';
import { SETTINGS_LAYOUT, SETTING_ROWS, EXTRA_SETTING_KEYS } from '../src/ui/settings_panel.js';

test('the desktop HUD is larger by default, and Small / Normal / Large grow in order', () => {
  const n = uiZoom(undefined, 1280, 720);
  assert.ok(n >= 1.15, `normal at 1280×720 is bigger than before (${n})`);
  assert.equal(uiZoom('normal', 1280, 720), n, 'unset is Normal');
  const s = uiZoom('small', 1280, 720);
  const l = uiZoom('large', 1280, 720);
  assert.ok(s < n && n < l, `${s} < ${n} < ${l}`);
  assert.equal(s, 1, 'Small is the old size at 1280×720');
  assert.ok(l >= 1.4, `Large is clearly larger (${l})`);
});

test('the HUD keeps its share of a big monitor, shrinks on a small window, and touch is never zoomed', () => {
  assert.ok(uiZoom('normal', 1920, 1080) > uiZoom('normal', 1280, 720), 'a big monitor grows it');
  assert.ok(uiZoom('normal', 1920, 1080) <= UI_SIZES.normal * 1.35 + 1e-9);
  assert.ok(uiZoom('normal', 1024, 600) < uiZoom('normal', 1280, 720), 'a small window shrinks it');
  assert.ok(uiZoom('large', 800, 900) * 290 <= 800 * 0.36 + 1, 'the left column never takes over a narrow window');
  for (const size of ['small', 'normal', 'large']) for (const [w, h] of [[844, 390], [390, 844], [1280, 720]]) assert.equal(uiZoom(size, w, h, true), 1, `touch ${size} ${w}×${h}`);
});

test('Settings → Display → Screen holds Interface size once, as a three-way choice', () => {
  const screen = SETTINGS_LAYOUT.display.find((g) => g.id === 'screen');
  assert.ok(screen.keys.includes('uiSize'));
  const all = Object.values(SETTINGS_LAYOUT).flat().flatMap((g) => g.keys);
  assert.equal(all.filter((k) => k === 'uiSize').length, 1);
  const row = SETTING_ROWS.uiSize;
  assert.equal(row.label, 'Interface size');
  assert.deepEqual(row.options.map((o) => o[1]), ['Small', 'Normal', 'Large']);
  assert.equal(row.fallback, 'normal');
  assert.ok(EXTRA_SETTING_KEYS.includes('uiSize'), 'unset means Normal');
});
