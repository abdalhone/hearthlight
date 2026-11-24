// The bosses' intro scenes (DESIGN §22.3), in the story engine's step format (see
// scripts.js), plus the short lines Lyra says in the world around a boss fight. Each
// intro is 2–4 spoken lines in the right voices; voices are rendered later from
// bossSpokenLines(). Canon: docs/LORE.md. Nothing here says a truth LORE §9 hides:
// Varek is the bandit chief and nothing more to anyone here; the lake hums and nobody
// says why; the ruins' light is gravelight, and that is all Lyra knows of it.
//
// The game registers these into the story director's SCRIPTS at runtime
// (registerBossScripts), so the story test's speaker list stays the story's own.

import { isSpoken } from './scripts.js';

export const BOSS_SPEAKERS = { varek: 'Varek', corran: 'Corran' };

export const BOSS_SCRIPTS = {
  boss_varek: {
    title: 'Varek One-Eye',
    steps: [
      { camera: { to: 'varek', ms: 900 } },
      { say: 'varek', text: "That's far enough. The toll's paid at the fork, not up here." },
      { say: 'lyra', text: 'He winds up before he swings. Watch his shoulders, and move.', when: 'lyra_near' },
      { say: 'lyra', text: 'And nobody dies on this hill. Not even him.', mood: 'angry', when: 'lyra_near' },
      { say: 'varek', text: "Brave. Come on, then. Let's see what Hearthvale sends up a hill." },
    ],
  },

  boss_greyjaw: {
    title: 'Greyjaw',
    steps: [
      { camera: { to: 'greyjaw', ms: 1000 } },
      { narrate: 'The wood goes quiet. Then every wolf in Whisperwood answers one voice.' },
      { say: 'lyra', text: "Greyjaw. Hess has been tracking him since spring. He's why the packs come so close.", mood: 'worried', when: 'lyra_near' },
      { say: 'lyra', text: "When he crouches, he's coming. Step aside, not back.", when: 'lyra_near' },
    ],
  },

  boss_mother: {
    title: 'The Mother of Slimes',
    steps: [
      { camera: { to: 'mother_of_slimes', ms: 900 } },
      { narrate: 'In the deepest rain-pool something vast and pink stirs, and every little slime in the quarry turns to look at you.' },
      { say: 'lyra', text: "That's not a slime. That's a lot of slimes that agreed on something.", mood: 'surprised', when: 'lyra_near' },
      { say: 'lyra', text: 'Hit it hard and it splits. Kill the little ones before it drinks them back.', when: 'lyra_near' },
    ],
  },

  boss_lake: {
    title: "The Lake's Hum",
    steps: [
      { camera: { to: 'lakes_hum', ms: 1100 } },
      { narrate: 'Mirror Lake goes still as glass. Then it hums, low, from somewhere under the boards.' },
      { say: 'corran', text: 'Hm-hmm. Never heard her hum that loud. Mind the edges.', when: 'npc_near:corran' },
      { say: 'lyra', text: "Still water that sits too long stirs. That's the old saying. Nobody said a whole lake.", mood: 'worried', when: 'lyra_near' },
      { say: 'lyra', text: 'It has to come up to hit us. When it does, so do we.', when: 'lyra_near' },
    ],
  },

  boss_warden: {
    title: 'The Bone Warden',
    steps: [
      { camera: { to: 'bone_warden', ms: 1000 } },
      { narrate: 'In the lower hall the cold light gathers into a lantern, and the lantern lifts.' },
      { say: 'lyra', text: 'Gravelight. Every Moot in the Lowmarch forbids it, and here it is, walking.', mood: 'worried', when: 'lyra_near' },
      { say: 'lyra', text: "That lantern, like the statue upstairs. Maren carried a miner's lantern in here. Hers burned yellow.", mood: 'sad', when: 'lyra_near' },
      { say: 'lyra', text: "Its shield won't take a plain cut. Hit it with something heavy, or with light.", when: 'lyra_near' },
    ],
  },
};

// Number the spoken lines the way scripts.js does: '<script>.<nn>'.
for (const [id, script] of Object.entries(BOSS_SCRIPTS)) {
  script.id = id;
  let n = 0;
  for (const st of script.steps) {
    if (!isSpoken(st)) continue;
    if (!st.key) st.key = `${id}.${String(n).padStart(2, '0')}`;
    n++;
  }
}

// Which intro belongs to which boss.
export const BOSS_INTRO = {
  varek: 'boss_varek',
  greyjaw: 'boss_greyjaw',
  mother_of_slimes: 'boss_mother',
  lakes_hum: 'boss_lake',
  bone_warden: 'boss_warden',
};

// Lyra in the world around a fight (bubbles, in her voice).
export const LYRA_BOSS_LINES = {
  join: {
    varek: 'With you. Keep his axe busy and I will keep you standing.',
    greyjaw: 'Back to back. He goes for whoever stands alone.',
    mother_of_slimes: "I'll take the little ones!",
    lakes_hum: 'Stay off the edges!',
    bone_warden: "Fine. Together, then. Don't let it get behind you.",
  },
  decline: {
    varek: "Not him. Not today. I'll hold the gate behind you.",
    greyjaw: "Not tonight. I'll keep the path clear behind you. Shout if you go down.",
    mother_of_slimes: "No. Slimes I can do. That, I can't. I'll be right here.",
    lakes_hum: "I'm not going out on that water. I'll watch from the boards.",
    bone_warden: "No. Not down here, not that. I'll hold the stair. Come back up.",
  },
  win: {
    varek: "Let him go. We're not killers. ...The fire, though. Look at the fire.",
    greyjaw: 'He was old. Hess will want to know.',
    mother_of_slimes: "I'm going to smell like quarry for a week.",
    lakes_hum: "It's quiet. Corran will hate this. Or love it.",
    bone_warden: "It's only bones now. Whatever that lantern was, don't trust it.",
  },
  lost: {
    any: "We'll go back when you can stand. It'll still be there.",
  },
  // When the player takes up a glyph she has feelings about.
  glyph: {
    dark: "Dark. That's gravelight in your hands. Be careful with it. Please.",
    fire: "Fire that doesn't go out. Don't point it at the thatch.",
  },
  daytrack: "Tracks. Big ones. He hunts after dark, not before.",
};

// Every fixed boss line for the voice pipeline: [{ key, speaker, text, script, mood }].
export function bossSpokenLines() {
  const out = [];
  for (const [id, script] of Object.entries(BOSS_SCRIPTS)) {
    for (const st of script.steps) {
      if (!isSpoken(st)) continue;
      out.push({ key: st.key, speaker: st.narrate != null ? 'narrator' : st.say, text: st.narrate != null ? st.narrate : st.text, script: id, mood: st.mood || null });
    }
  }
  return out;
}

// Put the intros where the story director looks for scripts (idempotent).
export function registerBossScripts(scripts) {
  if (!scripts || typeof scripts !== 'object') return 0;
  let n = 0;
  for (const [id, script] of Object.entries(BOSS_SCRIPTS)) {
    if (scripts[id] === script) continue;
    if (!scripts[id]) {
      scripts[id] = script;
      n++;
    }
  }
  return n;
}
