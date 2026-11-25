// The "Lyra saw that" toast reads `<label>: "<her words>"`. Her words must say more than the
// label does: forcing the Reeds' chest once showed `Stole: "Stole."` (r14a verify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEEDS } from '../src/ai/mind/autonomy_data.js';
import { deedLabel } from '../src/ui/lyra_view.js';

const bare = (s) => String(s || '').toLowerCase().replace(/[^a-z]+/g, '');

test("every deed's words say more than its label (no 'Stole: \"Stole.\"')", () => {
  for (const [id, d] of Object.entries(DEEDS)) {
    assert.ok(d.text && d.text.trim().length > 0, `${id} has words`);
    assert.notEqual(bare(d.text), bare(deedLabel(id)), `${id}: the words repeat the label`);
  }
});
