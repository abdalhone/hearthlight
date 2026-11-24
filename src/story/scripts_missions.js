// Story scenes for the Weave and its missions (DESIGN §20, §22.3), in the same step
// format as scripts.js. triggers.js registers MISSION_SCENES; the scripts join SCRIPTS
// here, with stable voice keys ('first_weave.00', ...). Canon: docs/LORE.md §13. No line
// says a truth LORE §9 keeps hidden (tests/story.test.mjs and tests/missions.test.mjs).

import { SCRIPTS, isSpoken } from './scripts.js';

export const MISSION_SCRIPTS = {
  // The first time Lyra sees the stranger weave (LORE §13: she notices first).
  first_weave: {
    title: 'Raw light',
    steps: [
      { bed: 'drone', level: 0.6 },
      { camera: { to: 'lyra', ms: 700 } },
      { actor: 'lyra', face: 'player' },
      { actor: 'lyra', emote: '!' },
      { say: 'lyra', text: 'Wait. Wait. What was that?', mood: 'surprised' },
      { narrate: 'Light gathers between your hands out of nothing: no flame, no breath spent. For a heartbeat there are marks in it, sharp little shapes, there and gone.', cues: [{ word: 'Light', sfx: 'weave' }, { word: 'marks', sfx: 'shimmer', volume: 0.6 }] },
      { say: 'lyra', text: "That isn't a spark. I make sparks. I know what they cost me, every one.", mood: 'surprised' },
      { say: 'lyra', text: 'Those marks. Maren used to copy marks like that off the ruins wall by candlelight. Lanternwright letters.', mood: 'worried' },
      { say: 'lyra', text: 'Wicks and ashes. Right. Breathe, Lyra.' },
      { say: 'lyra', text: 'Do that again. Slowly. Not at me.', mood: 'happy' },
    ],
  },

  // The family flames stand up when the stranger weaves before the altar.
  flames_rise: {
    title: 'The flames stand up',
    steps: [
      { bed: 'chapel' },
      { panel: 'chapel_candles', pan: 'none' },
      { narrate: 'You open your hand before the altar, and the light comes.', cues: [{ word: 'light', sfx: 'flash', volume: 0.5, flash: '#ffe9b8' }] },
      { narrate: 'Thirty-eight flames stand up tall, every one, and bend toward you like flowers to a window.', cues: [{ word: 'stand', sfx: ['candle_lean', 'ignite'], volume: 0.8 }] },
      { say: 'aveline', text: 'There. I sat eighty-one nights wondering what they would do. Now I know, and I understand it less.', when: 'npc_near:aveline' },
      { say: 'lyra', text: "They've never done that for me. Not once. I'm not jealous. I'm a little jealous.", mood: 'surprised', when: 'lyra_near' },
    ],
  },
};

// Number every spoken step, as scripts.js does for its own.
for (const [id, script] of Object.entries(MISSION_SCRIPTS)) {
  script.id = id;
  let n = 0;
  for (const st of script.steps) {
    if (!isSpoken(st)) continue;
    if (!st.key) st.key = `${id}.${String(n).padStart(2, '0')}`;
    n++;
  }
  if (!SCRIPTS[id]) SCRIPTS[id] = script;
}

// When each scene plays (see triggers.js for the context `c`).
export const MISSION_SCENES = [
  {
    id: 'first_weave',
    lyra: 'required',
    check: (c) => {
      const w = c.game.missions?.lyraWatch;
      const ms = c.game.missions;
      return !!w?.firstSeen && Number.isFinite(w.firstSeenAt) && ms.playT - w.firstSeenAt < 20 && c.calm();
    },
    unlock: ['lumencraft', 'clues'],
  },
  {
    id: 'flames_rise',
    lyra: 'optional',
    check: (c) => c.game.missions?.status?.('leaning_flames') === 'ready' && c.inPlace('chapel'),
    memory: { text: 'The stranger wove light before the altar and every family flame stood up tall and leaned to them. They have never done that for me.', importance: 6, about: ['player', 'aveline'], emotion: 'surprise', onlyIfNear: true },
    unlock: ['flames_lean', 'family_flames'],
  },
];
