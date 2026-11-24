// The one place where a spoken line becomes a clip key (DESIGN.md §21). The build-time
// collector (scripts/voice/collect.mjs) and the runtime (src/audio/voice.js) both use
// these functions, so a line said in the game finds the clip rendered for it.
//
// key = `${speaker}-${hash(speaker + '\n' + normalizeLine(text))}`, e.g. "bram-1x0k3f9qa2"

// Text as it is compared: what is read aloud, case and typography folded away, so a
// curly apostrophe, a long dash or an ellipsis character never makes a line miss its clip.
export function normalizeLine(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/\*[^*]{1,80}\*/g, ' ') // stage directions are not spoken
    .replace(/[\u2018\u2019\u02BC`\u00B4]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'.,!?;:\- ]+/gu, ' ') // quotes, symbols, emoji, music notes
    .replace(/\s+/g, ' ')
    .replace(/ ([.,!?;:])/g, '$1')
    .trim();
}

// Speaker ids are short lowercase words: 'lyra', 'narrator', 'bram', 'bandit'.
export function normalizeSpeaker(id) {
  return String(id ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '')
    .slice(0, 24);
}

// cyrb53: a fast 53-bit string hash with good spread; plenty for a few thousand lines.
export function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function lineKey(speaker, text) {
  const s = normalizeSpeaker(speaker);
  const t = normalizeLine(text);
  if (!s || !t) return null;
  return `${s}-${hash53(`${s}\n${t}`).toString(36)}`;
}

// A line worth a clip: fixed text, no template slots, something to say.
export function isFixedLine(text) {
  const s = String(text ?? '');
  if (!s.trim()) return false;
  if (/\{[#\w]+\}|\[[^\]]*\|[^\]]*\]|\$\{/.test(s)) return false;
  return /\p{L}/u.test(normalizeLine(s));
}

// Which cast voice an entity speaks with. Lyra is 'lyra' whatever the player named
// her; villagers use their profile id; bandits share one voice and their chief has his own.
const SPECIES_VOICE = { bandit: 'bandit', bandit_archer: 'bandit', bandit_chief: 'varek' };

export function speakerIdOf(entity, game) {
  if (entity == null) return null;
  if (typeof entity === 'string') return normalizeSpeaker(entity);
  if (game && entity === game.companion) return 'lyra';
  if (entity.isCompanion || entity.type === 'companion') return 'lyra';
  if (entity.species && SPECIES_VOICE[entity.species]) return SPECIES_VOICE[entity.species];
  const id = entity.profile?.id ?? entity.voiceId ?? (entity.species ? null : entity.id);
  return id ? normalizeSpeaker(id) : null;
}

// Sentences, punctuation kept ("Fine. Attack mode!" -> ["Fine.", "Attack mode!"]).
export function sentencesOf(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  return (s.match(/[^.!?…]+(?:[.!?…]+["'’”)]*|$)/g) || [s]).map((x) => x.trim()).filter(Boolean);
}

// A line made of several recorded lines (an acknowledgement, then her reason, then a
// remark) is spoken as those clips in a row: the fewest consecutive runs of sentences
// that each have a clip. Returns their keys, or null when any part has none.
export function clipSegments(speaker, text, hasKey, maxSentences = 12) {
  const parts = sentencesOf(text);
  const n = parts.length;
  if (n < 2 || n > maxSentences) return null;
  const best = new Array(n + 1).fill(null);
  best[0] = [];
  for (let i = 1; i <= n; i++) {
    for (let j = 0; j < i; j++) {
      if (!best[j]) continue;
      const key = lineKey(speaker, parts.slice(j, i).join(' '));
      if (key && hasKey(key) && (!best[i] || best[j].length + 1 < best[i].length)) best[i] = [...best[j], key];
    }
  }
  return best[n] && best[n].length > 1 ? best[n] : null;
}
