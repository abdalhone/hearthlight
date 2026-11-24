import { lyraTone } from './lines.js';

// The memorial (DESIGN §27): when the stranger dies with no kept flame, the story ends with
// Lyra's last diary entry about them and what the village says. Composed locally from the
// state of the world, so it is there whatever mind Lyra runs on.

const PLAYER_ID = 'player';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function firstSentence(text, max = 140) {
  const t = String(text || '').trim();
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}


export function placeName(game, x, y) {
  const loc = safe(() => game.locations?.at?.(x, y));
  return loc?.name || 'the wilds';
}

// "in Whisperwood", "on King's Road", "at Fennick's Herbs".
export function placePhrase(game, x, y) {
  const loc = safe(() => game.locations?.at?.(x, y));
  if (!loc) return 'in the wilds';
  if (loc.kind === 'road' || loc.kind === 'lane') return `on ${loc.name}`;
  if (loc.kind === 'building' || loc.kind === 'home') return `at ${loc.name}`;
  return `in ${loc.name}`;
}

// How it happened, in a few words.
export function causePhrase(game, rec) {
  const P = rec?.actor;
  const where = rec?.where || (P ? placePhrase(game, P.x, P.y) : 'in the wilds');
  const night = !!safe(() => game.clock?.isNight ?? (game.clock?.phase === 'night'), false);
  if (rec?.cause === 'berserk') return `Their heart gave out after the berserk fury, ${where}.`;
  if (rec?.carrierName) return `They died on ${rec.carrierName}'s shoulders, on the way to Mira's.`;
  if (rec?.wet) return `They went down in the cold water ${where} and did not come up again.`;
  const alone = !rec?.anyoneCame;
  return `They bled out ${where}${night ? ', at night' : ''}${alone ? ', alone' : ''}.`;
}

// Her best memory of them: the most important thing they did together in play (not the
// story she was born knowing), short enough to quote whole.
function bestMemory(mind, now = Infinity) {
  const all = safe(() => mind?.memory?.all?.(), []) || [];
  const list = all
    .filter((m) => m && Array.isArray(m.about) && m.about.includes(PLAYER_ID) && m.type !== 'reflection' && !m.pinned && (m.day ?? 1) > 0 && !(m.t > now - 180))
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  for (const m of list) {
    const s = firstSentence(m.text, 400);
    if (s.length <= 140 && !s.endsWith('…')) return s;
  }
  return '';
}

// The name the village knows them by: their own, once they have one.
export function strangerName(game) {
  const n = String(game?.player?.name || game?.settings?.playerName || '').trim();
  return n && n !== 'Traveler' ? n : null;
}

// Lyra's last diary entry about the stranger.
export function lyraLastEntry(game, rec) {
  const lyra = game?.companion;
  const P = strangerName(game) || 'The stranger';
  const Pm = strangerName(game) || 'the stranger';
  const where = rec?.where || placePhrase(game, game?.player?.x ?? 0, game?.player?.y ?? 0);
  const days = game?.clock?.day ?? 1;
  const tone = lyra ? lyraTone(lyra) : 'steady';
  const mem = lyra ? bestMemory(lyra.mind, game?.clock?.t ?? Infinity) : '';
  const came = !!rec?.lyraCame;
  const parts = [];
  if (tone === 'warm') {
    parts.push(came ? `I got to ${Pm} and it wasn't enough. I had them, and then I didn't.` : `${P} died today ${where}, and I wasn't there.`);
    if (mem) parts.push(`I keep thinking about it: ${mem}`);
    parts.push(`We had ${days} ${days === 1 ? 'day' : 'days'}. It should have been more.`);
    parts.push('No flame was kept in their name. I should have made them go to Aveline. I should have made them.');
    parts.push("Da lit the far lamp tonight without being asked. I can't write any more.");
  } else if (tone === 'steady') {
    parts.push(`${P} died today, ${where}.${came ? ' I was there at the end. It was not enough.' : ' I was too far away.'}`);
    if (mem) parts.push(`I remember this: ${mem}`);
    parts.push(`${days === 1 ? 'One day' : `${days} days`} since they woke in the Wayhouse. I'll light a candle at the chapel tomorrow, though no flame was kept for them.`);
    parts.push('Keep your own wick, little lamp. Sleep. I can’t.');
  } else if (tone === 'guarded') {
    parts.push(`${P} is dead.${came ? ' I ran to them. I don’t know why I’m surprised I did.' : ''}`);
    parts.push("I hadn't forgiven them, and now I never have to decide. I'm angry about that, of all things.");
    if (mem) parts.push(`I keep coming back to it: ${mem}`);
    parts.push('Aveline will say words. I will stand at the back.');
  } else {
    parts.push(`The stranger died today ${where}.`);
    parts.push(came ? "I'd cut them out of my life, and I still ran when I heard. I carried what was left of them as far as I could." : "I'd cut them out of my life. I heard too late, and I'm not sure I would have been quicker.");
    parts.push("I don't know what that says about me. Mam says it says I'm an Ambrel.");
  }
  return { text: parts.join(' '), tone };
}

// What a villager says about them, by how they felt about the stranger.
const SAYS = {
  aveline: () => 'No flame was kept for them. I would have kept one, if they had asked. Peace on you, child.',
  mira: (b) => (b === 'high' ? 'I had the cot ready. I always have the cot ready. Sorry. I — sorry.' : b === 'mid' ? 'I wish they had come to me sooner.' : 'I would have patched them up all the same.'),
  rowan: (b) => (b === 'high' ? 'A good blade, and better company. The watch will remember them.' : b === 'mid' ? 'Another name for the chapel wall.' : 'Trouble, from the day they came. Still. Nobody deserves the dark.'),
  elda: (b) => (b === 'high' ? "I'll set a place for them at the Kettle tonight anyway." : b === 'mid' ? 'Poor lamb. Poor lamb.' : "Well. The Kettle's quieter."),
  pip: (b) => (b === 'high' ? 'They said they would show me the sword thing. They PROMISED.' : b === 'mid' ? 'Are they really not coming back?' : "I didn't like them much. I still don't want them dead."),
  hess: (b) => (b === 'high' ? 'I carried them down a mountain once. I would have done it again.' : b === 'mid' ? 'The wilds take who they take.' : 'I told her they were trouble.'),
  hobb: (b) => (b === 'high' ? "I'll light the far lamp for them tonight." : b === 'mid' ? 'Another lamp out.' : '…'),
  bram: (b) => (b === 'high' ? 'I was making them a better blade. I will finish it anyway.' : b === 'mid' ? 'A shame. A real shame.' : 'Hm.'),
  garrick: (b) => (b === 'high' ? 'Best customer I had. I mean that, for once.' : b === 'mid' ? 'They owed me for a lantern. Never mind.' : 'Bad luck follows some folk.'),
  wenna: (b) => (b === 'high' ? 'They let me touch their face, the first day. Warm. So warm.' : 'Poor soul. Poor soul.'),
};

function band(op) {
  return op >= 60 ? 'high' : op >= 30 ? 'mid' : 'low';
}

export function villageSays(game, rec, max = 5) {
  const out = [];
  const ents = safe(() => game.entities?.all?.(), []) || [];
  const byId = new Map(ents.filter((e) => e?.profile).map((e) => [e.id, e]));
  const saved = new Set(rec?.savedIds || []);
  // Those they saved first: it is the thing the village will say longest.
  for (const id of saved) {
    const e = byId.get(id);
    if (!e || out.length >= max) continue;
    out.push({ id, name: e.name, text: 'They carried me to Mira’s once, when I was down. I never got to repay it.' });
  }
  for (const id of ['aveline', 'mira', 'rowan', 'elda', 'pip', 'hess', 'hobb', 'bram', 'garrick', 'wenna']) {
    if (out.length >= max) break;
    if (saved.has(id)) continue;
    const e = byId.get(id);
    if (!e) continue;
    const b = band(Number(e.opinionOfPlayer ?? 40));
    out.push({ id, name: e.name, text: SAYS[id](b) });
  }
  return out;
}

export function composeMemorial(game, rec = {}) {
  const P = game?.player;
  const name = strangerName(game) || 'the stranger from the mountain';
  const day = game?.clock?.day ?? 1;
  const lyra = lyraLastEntry(game, rec);
  return {
    id: `life_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    name,
    companion: game?.companion?.name || game?.settings?.companionName || 'Lyra',
    day,
    when: safe(() => game.clock?.fullString?.(), '') || `Day ${day}`,
    diedAt: Date.now(),
    place: rec.place || (P ? placeName(game, P.x, P.y) : 'the wilds'),
    where: rec.where || (P ? placePhrase(game, P.x, P.y) : 'in the wilds'),
    cause: causePhrase(game, rec),
    level: P?.level ?? 1,
    saved: (rec.savedIds || []).length,
    lyra,
    village: villageSays(game, rec),
  };
}
