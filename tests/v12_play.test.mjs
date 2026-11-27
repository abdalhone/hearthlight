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

// Played at 999 Might: one blow downs Lyra, the held finisher kills her three seconds later,
// and then her autonomy, still ticking for the dead, read "she got up on her own" (she was no
// longer downed: she was dead) and cut ties: the toast "Lyra has cut you off. She is home with
// her own people now", her farewell in the flags, a letter from a dead woman. A dead Lyra's
// mind decides nothing (as her body, brain and behavior already did nothing).
test('Lyra knocked out and killed at once: her mind does not then cut ties from beyond the grave', async () => {
  const { step } = await import('./murder_world.mjs');
  const g = statsWorld({ hour: 8 });
  const P = points(g, { might: 999 }, { level: 15 });
  const L = g.companion;
  P.x = 97 * 16;
  P.y = 103 * 16;
  L.x = P.x + 16;
  L.y = P.y;
  const changes = [];
  g.bus.on('companionship_changed', (p) => changes.push({ state: p.state, dead: !!g.murder.isDead('lyra') }));
  g.combat.damage(P, L, P.atk, { kind: 'melee', exact: true, crit: false });
  assert.ok(L.downed && !L.dead, 'one blow downs her');
  step(g, 1);
  g.flags.finisherWarned = g.flags.finisherWarnedLyra = true;
  assert.ok(g.murder.strike(P, L), 'the held blow falls');
  assert.ok(g.murder.isDead('lyra'));
  for (let i = 0; i < 60; i++) step(g, 0.5);
  const after = changes.filter((c) => c.dead);
  assert.deepEqual(after, [], `nothing of hers changes once she is dead: ${JSON.stringify(changes)}`);
  assert.ok(!g.flags.lyra_gone && !g.flags.lyra_farewell, `no farewell from the dead: ${JSON.stringify(g.flags.lyra_farewell || g.flags.lyra_gone || null)}`);
});

// The Spellbook's price words, read beside the sheet at level 12: Oath said "+30% strength,
// weave power, armor and crit chance" while crit went 33% → 43% (not 63%), and Glass "+50%
// weave power" while 149% became 224% (not 199%). A price's share of a number you build reads
// as the gear's words do (§39.8, stats.pctWords): "of your …", and speed "of your normal pace".
test('a price that adds a share of a number you build says what it is a share of', async () => {
  const { PRICES } = await import('../src/magic/prices.js');
  const { pctWords } = await import('../src/core/stats.js');
  // Oath's shares come from its live provider (while whoever walks with you is near).
  const g = statsWorld();
  const P = g.player;
  g.prices.state.oath = { t: 45 };
  g.companion.x = P.x + 10;
  g.companion.y = P.y;
  const oath = (g.prices.provide(P) || []).find((m) => m.id === 'price:oath:gain');
  assert.ok(oath?.pct, 'the oath gives while she is near');
  let read = 0;
  for (const [id, d] of Object.entries(PRICES)) {
    const pct = id === 'oath' ? oath.pct : d.gain?.pct || {};
    for (const [k, v] of Object.entries(pct)) {
      const w = pctWords(k, v);
      if (!/ of your /.test(w) && !/\(of your normal pace\)/.test(w)) continue; // a plain ×1 multiplier
      const n = `${Math.round(v * 100)}%`;
      if (!d.gainText.includes(n)) continue; // said in words ("faster", "twice as strong")
      read++;
      assert.match(d.gainText, k === 'speed' ? /\+\d+% speed \(of your normal pace\)/ : /% of your /, `${id}: "${d.gainText}" says what its ${n} (${k}) is a share of, as "${w}"`);
    }
  }
  assert.ok(read >= 7, `the words of Berserk, Glass and Oath were read (${read})`);
});
