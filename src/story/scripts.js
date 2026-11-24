// The story's scenes as data (DESIGN §20). Each script is { title, steps: [...] } and every
// step is one of:
//   { panel: id, pan?, hold? }            a painted panel (crossfades from the last one)
//   { narrate: text }                     the narrator (key, text)
//   { say: speaker, text, mood?, young? } a line with portrait and name (key, text)
//   { camera: { to, dx?, dy?, ms? } }     an in-world camera move (to: entity/object/place id or {x,y})
//   { actor: id, walkTo?|place?|face?|emote?|anim?, dx?, dy?, speed?, thenFace? }
//   { fade: 'in'|'out', ms?, color? }     { wait: ms }   { sound: id }   { music: cue }
//   { title, sub?, ms? }                  a title card
//   { world: 'begin', panel? } … { world: 'end' }  steps on the live map; replays show the panel
//   { call: name }                        a director hook (set the stage, place the actors)
//   { end: true }                         stop here
// Any step may carry `when`: 'lyra_near' | 'npc_near:<id>' — it plays only if that holds.
//
// Every spoken step has a stable `key` (script id + its number among the spoken lines,
// e.g. 'prologue.07'), assigned below unless written in. The voice pipeline renders clips
// from spokenLines(); the player asks game.voice.play({ speaker, text, key }).
//
// Canon: docs/LORE.md. No line here may say a truth LORE §9 marks hidden (tests check it).

export const SPEAKERS = {
  narrator: '',
  lyra: 'Lyra',
  hess: 'Hess',
  hobb: 'Hobb',
  wenna: 'Wenna',
  maren: 'Maren',
  aveline: 'Sister Aveline',
};

export const SCRIPTS = {
  prologue: {
    title: 'Prologue: The Lit Hall',
    steps: [
      { music: 'prologue' },
      { panel: 'halcyre', pan: 'none' },
      { narrate: 'Long ago, the world was a lit hall. Its makers, the Lanternwrights, called it Halcyre.' },
      { narrate: 'They held its wild magic still with one great working: the Song.' },
      { narrate: 'Then the Song broke. Nobody alive knows why. The lamps went out, one by one.' },
      { panel: 'the_drift' },
      { narrate: 'The magic spilled. Now it moves over the open land like weather, and people call it the Drift.' },
      { narrate: 'Glimmer, that turns the lamps blue. The grey, that makes a village forget itself. Hollow wind. Brightfall.' },
      { panel: 'warded_villages' },
      { narrate: 'So people live inside wards: small villages gathered round the old stones that still hum. Every village is a lamp in a large, dark room.' },
      { panel: 'hearthvale_dusk' },
      { narrate: 'This is Hearthvale. A kettle-fire that has never once gone out, and a singing stone at the bottom of the well: the Wellstone.' },
      { narrate: 'Every household keeps one flame on the chapel altar, and the flames hold the ward up.' },
      { music: 'swell' },
      { panel: 'brightfall' },
      { narrate: 'Twenty-five winters ago, for eleven still nights, light fell on the valley like snow.' },
      { narrate: 'By midsummer, old Hobb the lamplighter and Wenna the beekeeper, long past hope of children, had a daughter. They named her for a star: Lyra.' },
      { narrate: 'The old women counted on their fingers, and said nothing out loud.' },
      { music: 'memory' },
      { panel: 'maren_ruins' },
      { narrate: "Maren Ashgrove, the village's wardwright, taught her magic for thirteen years." },
      { narrate: "Three months ago, on Lyra's birthday, Maren went over the wall of the Sunken Ruins with a lantern and a rope, and did not come back." },
      { music: 'cold' },
      { panel: 'the_climb', pan: 'up' },
      { narrate: 'Maren\u2019s notes called the stone ring on the Hollowcrown \u201cthe other end\u201d. Lyra paid Hess the wardrunner to take her up.' },
      { say: 'lyra', text: 'If she went anywhere, she went up there.', mood: 'angry' },
      { say: 'hess', text: 'Mm. Then we climb.' },
      { panel: 'crown_ring' },
      { narrate: 'At dawn they reached the Crown Ring: nine broken stones in the snow.' },
      { narrate: 'In the middle, the snow had melted in a perfect circle. No footprints in. None out.' },
      { narrate: 'And in it lay someone. Warm. Breathing. A sword beside them.' },
      { say: 'hess', text: 'Lyra.' },
      { say: 'hess', text: "Lyra. It isn't her." },
      { say: 'lyra', text: 'I know. \u2026I know.', mood: 'sad' },
      { say: 'hess', text: 'We bind their hands. Loosely.' },
      { say: 'lyra', text: "Loosely. We're not leaving a living person up here." },
      { music: 'swell' },
      { narrate: 'It was you.' },
      { panel: 'carry_down', pan: 'left' },
      { narrate: "They carried you down on a litter made of Lyra's cloak. When you passed the well, the Wellstone hummed for the whole square to hear." },
      { music: 'memory' },
      { panel: 'long_sleep' },
      { narrate: 'You slept in the chapel for eighty-one nights. Six days ago you woke, remembering nothing.' },
      { narrate: "Two days ago, on the King's Road, wolves came at dusk. You stood beside her." },
      { fade: 'out', ms: 1200 },
      { world: 'begin', panel: 'wayhouse_morning' },
      { call: 'wake' },
      { camera: { to: 'home_bed', dx: 10, dy: 4, ms: 0 } },
      { fade: 'in', ms: 1400 },
      { actor: 'lyra', face: 'player' },
      { say: 'lyra', text: "Morning. Still breathing? Good. I'd hate to have carried you down a mountain for nothing.", mood: 'happy' },
      { say: 'lyra', text: "In case the mountain took this too: I'm Lyra Ambrel. This is the Wayhouse, in Hearthvale." },
      { actor: 'lyra', emote: 'note' },
      { say: 'lyra', text: 'I hold your key. That\u2019s the hearthwatch: I look in, I sleep in the spare bed when I feel like it, and the Moot pays me.' },
      { say: 'lyra', text: "Nobody's obliged to keep one. I took yours because I wanted to." },
      { say: 'lyra', text: "Now. Breakfast at the Kettle, and you tell me if anything's come back. Even something small.", mood: 'happy' },
      { world: 'end' },
    ],
  },

  meet_ambrels: {
    title: 'Hobb and Wenna',
    steps: [
      { camera: { to: 'wenna', ms: 900 } },
      { actor: 'wenna', face: 'player' },
      { actor: 'hobb', face: 'player' },
      { say: 'wenna', text: "Who's that? Come here, let me hear you." },
      { say: 'lyra', text: "Mam. It's the one off the mountain. You asked to meet them.", when: 'lyra_near' },
      { say: 'wenna', text: "I did. My eyes are no use past my own hand, so you'll have to bend down. Hold still." },
      { actor: 'wenna', walkTo: 'player', dy: -6, speed: 16, thenFace: 'player' },
      { narrate: 'Her hands are cool and dry, and smell of beeswax. She reads your face the way she reads her hives: slowly, and missing nothing.' },
      { say: 'wenna', text: "Hm. Young. Tired. Not a liar's jaw." },
      { say: 'wenna', text: "The mountain gives and the mountain takes, and it never gives for nothing. Mind you're worth what it took." },
      { say: 'hobb', text: "Well now. Look who's up and walking." },
      { say: 'hobb', text: "Everyone found deserves a lamp. I hung one by your door. Mind the cat doesn't sit in it." },
      { say: 'lyra', text: 'Da. Your spectacles are on your head.', mood: 'happy', when: 'lyra_near' },
      { say: 'hobb', text: 'Are they? Well now. So they are.' },
      { say: 'wenna', text: 'Bring them to supper, Lyra Ambrel. I want to hear them eat.', when: 'lyra_near' },
    ],
  },

  chapel_candles: {
    title: 'The family flames',
    steps: [
      { panel: 'chapel_candles', pan: 'none' },
      { narrate: 'Thirty-eight flames burn on the altar: one for every household under the ward.' },
      { narrate: 'As you come near, every one of them leans toward you, the way a flower leans to a window.' },
      { say: 'aveline', text: 'They do that. They did it every night you slept here, child.', when: 'npc_near:aveline' },
      { say: 'aveline', text: 'A question someone has sent us. I have not found the answer. I have stopped minding.', when: 'npc_near:aveline' },
      { say: 'lyra', text: "Don't look at me. I don't know why either. I've asked them.", mood: 'surprised', when: 'lyra_near' },
    ],
  },

  night_of_lamps: {
    title: 'The night of the lamps',
    steps: [
      { camera: { to: 'lyra', ms: 800 } },
      { actor: 'lyra', face: 'player' },
      { say: 'lyra', text: "You keep watching my hands when I light a lamp. Want to know how it started? It's a short one.", mood: 'happy' },
      { music: 'memory' },
      { panel: 'night_of_lamps', pan: 'none' },
      { say: 'lyra', text: 'Longwatch night. I was eleven. A hollow wind came down off the Crownfells and blew out every lamp on the square at once.' },
      { say: 'lyra', text: 'It knocked Da off his ladder onto the ice.', mood: 'worried' },
      { say: 'lyra', text: 'I was so frightened, and so angry, and so cold, that I lit them. All of them. At the same moment. In violet.' },
      { say: 'lyra', text: "One burst. Da sat up on the ice and said, ‘Well now.’", mood: 'happy' },
      { say: 'lyra', text: 'And Maren came out of the Kettle in her nightgown, looked at the lamps, looked at me, and said—' },
      { say: 'maren', text: 'Well. There goes my quiet old age.' },
      { say: 'lyra', text: "She took me on the next morning. I've been cold ever since. Worth it.", mood: 'happy' },
    ],
  },

  weeping_cut: {
    title: 'The Weeping Cut',
    steps: [
      { camera: { to: 'lyra', ms: 800 } },
      { actor: 'lyra', face: 'up' },
      { say: 'lyra', text: "See the iron in the north face? Bram's stakes. The Moot sealed it five years ago. Because of me.", mood: 'sad' },
      { music: 'cold' },
      { panel: 'weeping_cut' },
      { say: 'lyra', text: 'Davin wanted coin for the Saltmere road-guard. The crystals in the Cut were the quickest coin in the valley. He asked me to come. A mage would make it safe.' },
      { say: 'lyra', text: 'I could feel it stirring. I said no. He asked again. And again. Sweetly. He talked about the sea.' },
      { say: 'lyra', text: "So I said yes. Not because I'd changed my mind. Because I didn't want to be the one who made his life small." },
      { say: 'lyra', text: 'It woke around us. Slimes out of the walls. Something with too many bones. I cast until I guttered.', mood: 'worried' },
      { say: 'lyra', text: 'Davin ran. For help, he said. Bryn dragged me out on her back, and in the last passage the stone came down on her leg.' },
      { say: 'lyra', text: "I lent warmth into it for three nights. It wasn't enough. She walks with a stick now, in Saltmere. She forgave me years ago.", mood: 'sad' },
      { say: 'lyra', text: "Maren didn't shout. She said:" },
      { say: 'maren', text: "You spent your judgment like a coin you didn't have. Never again go where you've already said no. For anyone. Not for him. Not for me." },
      { say: 'lyra', text: "So when I say no, that's why. It isn't about you. It's about the coin." },
    ],
  },

  maren_aveline: {
    title: "Maren's thread: what Aveline saw",
    steps: [
      { camera: { to: 'aveline', ms: 900 } },
      { actor: 'aveline', face: 'player' },
      { say: 'lyra', text: 'Sister. Tell them what you saw. At midsummer.', when: 'lyra_near' },
      { say: 'aveline', text: 'I saw her go, child. Dusk, on the longest day. Her grey cloak, a lantern, a coil of rope over her shoulder.' },
      { music: 'memory' },
      { panel: 'maren_ruins' },
      { say: 'aveline', text: 'She walked down the road toward the marsh as if she were late for supper. I called after her.' },
      { say: 'aveline', text: 'She raised her hand. She did not turn around.' },
      { say: 'aveline', text: 'The blue lights began that night. I have prayed for her every dusk since. Prayer is mostly waiting, and waiting I can do.' },
      { say: 'lyra', text: "She paid a month ahead at the Kettle. She bought turnips, for a long walk. People who mean to die don't buy turnips.", mood: 'angry', when: 'lyra_near' },
    ],
  },

  maren_gate: {
    title: "Maren's thread: the gate",
    steps: [
      { camera: { to: 'ruins_gate', ms: 1200 } },
      { say: 'lyra', text: 'This is as close as the Moot lets anyone come. Sealed by order of the chapel, a hundred and ten years ago.' },
      { say: 'lyra', text: "She didn't use the gate. She went over the low stretch of wall on the marsh side. It slumped into the marsh the same night." },
      { say: 'lyra', text: "I climbed the high wall once, alone, on Hess's rope. Something with no skin got hold of my boot.", mood: 'worried' },
      { say: 'lyra', text: "I'm not going in again without the key. A gate's a way out you can run through. A rope isn't." },
      { say: 'lyra', text: 'The bandits have the key. So that is where it starts, if it starts.' },
    ],
  },

  maren_journal: {
    title: "Maren's thread: the journal",
    steps: [
      { music: 'memory' },
      { panel: 'maren_ruins', pan: 'none' },
      { say: 'lyra', text: '‘If someone comes out, I hope whoever it is is kind.’', mood: 'sad' },
      { say: 'lyra', text: "That's her hand. She wrote it before she went through." },
      { say: 'lyra', text: 'Someone did come out. At the other end. Lying warm in the snow, with a sword.', mood: 'surprised' },
      { say: 'lyra', text: "…Well. You'd better be kind, then.", mood: 'happy' },
    ],
  },
};

// ---------------------------------------------------------------- keys and helpers

export function isSpoken(st) {
  return !!st && (st.narrate != null || st.say != null);
}

// Number every spoken step: '<script>.<nn>'. Keys stay stable when non-spoken steps
// (panels, camera moves, music) are added or moved.
for (const [id, script] of Object.entries(SCRIPTS)) {
  script.id = id;
  let n = 0;
  for (const st of script.steps) {
    if (!isSpoken(st)) continue;
    if (!st.key) st.key = `${id}.${String(n).padStart(2, '0')}`;
    n++;
  }
}

export function stepKey(scriptId, index, st) {
  return st?.key || `${scriptId}.${index}`;
}

export function speakerName(speaker, game) {
  if (!speaker || speaker === 'narrator') return '';
  if (speaker === 'lyra') return game?.settings?.companionName || 'Lyra';
  if (SPEAKERS[speaker]) return SPEAKERS[speaker];
  const e = game?.entities?.get?.(speaker);
  if (e?.name) return String(e.name).split(' ')[0];
  return speaker.charAt(0).toUpperCase() + speaker.slice(1);
}

// How long a line stays up when nothing voices it (ms).
export function readingMs(text, narration = false) {
  const n = String(text || '').length;
  return Math.round((1300 + n * 48) * (narration ? 1.08 : 1));
}

// Every fixed line of the story, for the voice pipeline: [{ key, speaker, text, script }].
export function spokenLines() {
  const out = [];
  for (const [id, script] of Object.entries(SCRIPTS)) {
    for (const st of script.steps) {
      if (!isSpoken(st)) continue;
      out.push({ key: st.key, speaker: st.narrate != null ? 'narrator' : st.say, text: st.narrate != null ? st.narrate : st.text, script: id, mood: st.mood || null });
    }
  }
  return out;
}

// Validation used by the tests: every step is one of the known kinds, with what it needs.
const STEP_KINDS = ['panel', 'narrate', 'say', 'camera', 'actor', 'fade', 'wait', 'sound', 'music', 'title', 'world', 'call', 'end'];

export function validateStep(st, panels = null) {
  if (!st || typeof st !== 'object') return 'not an object';
  const kinds = STEP_KINDS.filter((k) => st[k] != null);
  if (!kinds.length) return 'no step kind';
  if (st.say != null && (typeof st.text !== 'string' || !st.text.trim())) return 'say without text';
  if (st.narrate != null && (typeof st.narrate !== 'string' || !st.narrate.trim())) return 'empty narration';
  if (isSpoken(st) && !st.key) return 'spoken step without key';
  if (st.panel && panels && !panels[st.panel]) return `unknown panel ${st.panel}`;
  if (st.fade && !['in', 'out'].includes(st.fade)) return 'fade must be in or out';
  if (st.world && !['begin', 'end'].includes(st.world)) return 'world must be begin or end';
  if (st.camera && (typeof st.camera !== 'object' || st.camera.to == null)) return 'camera without a target';
  if (st.wait != null && !(Number(st.wait) >= 0)) return 'bad wait';
  if (st.when && !/^(lyra_near|npc_near:[a-z_]+)$/.test(st.when)) return `unknown condition ${st.when}`;
  return null;
}
