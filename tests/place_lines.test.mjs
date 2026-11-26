// verify_a's L2 ("Lyra enters the chapel far from you: no place line to you") counts her
// place lines for the chapel. It once counted every line with "Flame" in it, and failed on
// "Stray! Flame's lit?", her da's greeting given to the stray cat by the chapel door.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINES } from '../src/ai/brain/lines.js';
import { CHAPEL_PLACE_LINE } from '../scripts/place_lines.mjs';

const text = (l) => (typeof l === 'string' ? l : l.t);

test('every chapel place line is one the check counts', () => {
  assert.ok(LINES.place_chapel.length >= 1);
  for (const l of LINES.place_chapel) assert.match(text(l), CHAPEL_PLACE_LINE, text(l));
  for (const key of ['place_new', 'place_return']) {
    for (const l of LINES[key] || []) {
      const said = text(l).replaceAll('{place}', 'the Chapel of the Hearth').replaceAll('{desc}', 'Quiet.');
      assert.match(said, CHAPEL_PLACE_LINE, said);
    }
  }
});

test("her da's greeting to the cat is not a place line", () => {
  for (const s of ["Stray! Flame's lit?", "Star. Flame's lit?", "Content. Flame's lit, as Da says."]) assert.doesNotMatch(s, CHAPEL_PLACE_LINE, s);
});
