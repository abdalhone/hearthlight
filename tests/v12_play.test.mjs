// Version 12, played (the independent verifier who plays the joined game on three screens):
// what playing found wrong at the seam of the stat points and round 14b, each pinned by a
// test that failed before its fix. DESIGN §39.13.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame } from './murder_world.mjs';
import { installProgression } from '../src/progression/index.js';
import { partyPlugin } from '../src/core/party.js';
import { formatStat } from '../src/core/stats.js';

function statsWorld({ hour = 12 } = {}) {
  const g = makeGame({ hour });
  installProgression(g);
  g.bus.emit('game_start', { loaded: false });
  if (!g.party) g.plugins.register(partyPlugin);
  return g;
}

function points(g, pts, { level = 1 } = {}) {
  const P = g.player;
  const pr = g.progression;
  if (level > 1) {
    P.level = level;
    g.stats.refresh(P);
  }
  if (Object.values(pts).some((n) => n > pr.earned())) pr.startFree();
  for (const [id, n] of Object.entries(pts)) assert.ok(pr.spend(id, n).ok, `spend ${n} ${id}`);
  g.stats.refresh(P);
  P.hp = P.maxHp;
  return P;
}

// The Character sheet shows weave power, mana regen, cast speed and cooldowns as a % ("369%");
// their tooltips gave the parts as bare multipliers ("Base: +1", "Level: +0.49", "Points:
// +2.2"), which a player cannot add up to the number on the sheet. Each part now reads in the
// same %, and they add up to it; a percentage on top is "% of it", a share, as on a chance.
test('a stat the sheet shows as a % gives its parts in % too, adding up to the number shown', async () => {
  const { statTip } = await import('../src/ui/character_view.js');
  for (const pts of [{ weave: 30 }, { weave: 999, focus: 999 }]) {
    const g = statsWorld();
    const P = points(g, pts, { level: 15 });
    const S = g.stats;
    for (const id of ['spellPower']) {
      const tip = statTip(S, P, id);
      const parts = S.breakdown(P, id).filter((b) => b.add);
      assert.ok(parts.length >= 2, `${id} has parts: ${tip}`);
      let sum = 0;
      for (const b of parts) {
        const line = tip.split('\n').find((l) => l.startsWith(`${b.label}:`));
        assert.ok(line, `a line for ${b.label} in\n${tip}`);
        const m = line.match(/^[^:]+: \+?(-?\d+)%/);
        assert.ok(m, `"${line}" gives its part of the ${formatStat(id, S.get(P, id))} shown in % (${id})`);
        sum += Number(m[1]);
      }
      const shown = Math.round(S.get(P, id) * 100);
      const raw = parts.reduce((t, b) => t + b.add, 0);
      if (!S.breakdown(P, id).some((b) => b.pct || b.mul !== 1) && raw <= 50) assert.ok(Math.abs(sum - shown) <= parts.length, `${id}: the parts (${sum}%) add up to the ${shown}% shown\n${tip}`);
    }
    // Focus's mana regen is a share of the 100% it starts from: said so.
    if (pts.focus) assert.match(statTip(S, P, 'manaRegen'), /Base: \+100%\nPoints: \+\d+% of it\n.*share of 100%/, statTip(S, P, 'manaRegen'));
    // A share on top of it reads as a share ("% of it"), never as more of the same %.
    S.addModifier(P, { id: 'surge', source: 'surge', label: 'Surge: weave power', kind: 'buff', pct: { spellPower: 0.12 }, t: 30 });
    const tip = statTip(S, P, 'spellPower');
    assert.match(tip, /Surge: weave power: \+12% of it/, tip);
    assert.match(tip, /share of \d+%/, tip);
  }
});
