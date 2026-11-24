// The one place where a spoken line becomes a clip key (DESIGN.md §21). The build-time
// collector (scripts/voice/collect.mjs) and the runtime (src/audio/voice.js) both use
// these functions, so a cutscene line finds the clip rendered for it, and a line whose
// words changed (or that says another name for Lyra) simply has none.
//
// key = `${speaker}-${hash(speaker + '\n' + normalizeLine(text))}`, e.g. "hess-1x0k3f9qa2"

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
