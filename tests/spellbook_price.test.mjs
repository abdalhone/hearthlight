// A price chosen in the Spellbook must reach the weave slot (DESIGN §25). r14a verify: the
// Spellbook showed "Doomed Arcane Bolt · 1 / 1" but Weaving.setSlot cleaned the weave
// without its prices, so the slot (and every cast) carried none: the Last Stand, like every
// price, could never be taken up by a player.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Weaving } from '../src/ui/weaving.js';
import { cleanWeave } from '../src/ui/weave_meta.js';

function world() {
  const saved = [];
  const g = {
    bus: { on() {}, emit() {} },
    magic: {
      slots: [null, null, null, null],
      essenceSlots: 2,
      twistSlots: 2,
      priceSlots: 1,
      setSlot(i, w) {
        saved[i] = w;
        this.slots[i] = w;
        return { ok: true };
      },
    },
  };
  return { g, saved };
}

test('the Spellbook keeps the price on the weave it saves (the Last Stand reaches the slot)', () => {
  const { g, saved } = world();
  const w = new Weaving(g);
  const r = w.setSlot(0, { id: 'spark', shape: 'bolt', essences: ['raw'], twists: [], prices: ['laststand'] });
  assert.equal(r.ok, true);
  assert.deepEqual(saved[0].prices, ['laststand'], 'the price is saved with the weave');
});

test('a weave with no price still saves cleanly; junk prices are dropped', () => {
  const { g, saved } = world();
  const w = new Weaving(g);
  w.setSlot(1, { shape: 'bolt', essences: ['fire'], twists: [] });
  assert.equal(saved[1].prices, undefined);
  assert.deepEqual(cleanWeave({ shape: 'bolt', prices: ['berserk', '', 3, 'berserk'] }).prices, ['berserk']);
});
