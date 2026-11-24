// Text -> phonemes -> tokens for Kokoro, exactly as kokoro-onnx 0.6.1 does it at build
// time (scripts/voice/voicelib.py), so Lyra's live voice and her rendered clips say a
// line the same way. Pure: the espeak-ng phonemizer is passed in (the browser worker
// uses the `phonemizer` WebAssembly package; tests use the same package under node).

// Kokoro v1.0's vocabulary (kokoro_onnx/config.json): phoneme character -> token id.
export const VOCAB = Object.freeze({
  ";":1, ":":2, ",":3, ".":4, "!":5, "?":6, "—":9, "…":10, "\"":11, "(":12, ")":13, "“":14, "”":15,
  " ":16, "̃":17, "ʣ":18, "ʥ":19, "ʦ":20, "ʨ":21, "ᵝ":22, "ꭧ":23, "A":24, "I":25, "O":31, "Q":33,
  "S":35, "T":36, "W":39, "Y":41, "ᵊ":42, "a":43, "b":44, "c":45, "d":46, "e":47, "f":48, "h":50,
  "i":51, "j":52, "k":53, "l":54, "m":55, "n":56, "o":57, "p":58, "q":59, "r":60, "s":61, "t":62,
  "u":63, "v":64, "w":65, "x":66, "y":67, "z":68, "ɑ":69, "ɐ":70, "ɒ":71, "æ":72, "β":75, "ɔ":76,
  "ɕ":77, "ç":78, "ɖ":80, "ð":81, "ʤ":82, "ə":83, "ɚ":85, "ɛ":86, "ɜ":87, "ɟ":90, "ɡ":92, "ɥ":99,
  "ɨ":101, "ɪ":102, "ʝ":103, "ɯ":110, "ɰ":111, "ŋ":112, "ɳ":113, "ɲ":114, "ɴ":115, "ø":116, "ɸ":118,
  "θ":119, "œ":120, "ɹ":123, "ɾ":125, "ɻ":126, "ʁ":128, "ɽ":129, "ʂ":130, "ʃ":131, "ʈ":132, "ʧ":133,
  "ʊ":135, "ʋ":136, "ʌ":138, "ɣ":139, "ɤ":140, "χ":142, "ʎ":143, "ʒ":147, "ʔ":148, "ˈ":156, "ˌ":157,
  "ː":158, "ʰ":162, "ʲ":164, "↓":169, "→":171, "↗":172, "↘":173, "ᵻ":177,
});

export const MAX_TOKENS = 510;

// Interjections espeak-ng would spell out letter by letter, spoken as sounds instead
// (the same LEXICON as voicelib.py).
const LEXICON = [
  [/^h+u?m+p+h+$/i, 'hˈʌmf'],
  [/^h+m+$/i, 'hˈmː'],
  [/^m+-h+m+$/i, 'mˌhˈm'],
  [/^m+h+$/i, 'mˈmh'],
  [/^m{2,}$/i, 'ˈmmm'],
  [/^tch$/i, 'tʃ'],
  [/^sh{2,}$/i, 'ʃːː'],
  [/^pff+t$/i, 'pfːt'],
];
const WORD = /[A-Za-z]+(?:-[A-Za-z]+)*/g;

// phonemizer's default marks; ',' and '.' between digits are decimals, not marks.
const MARKS_RE = /(\s*(?:[;:!?¡¿—…"«»“”(){}[\]]|(?<![0-9])[,.]|[,.](?![0-9]))+\s*)+/g;

// What is read aloud (voicelib.tts_text): no stage directions, notes or emoji.
export function speechText(text) {
  return String(text ?? '')
    .replace(/\*[^*]{1,80}\*/g, ' ')
    .replace(/♪/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const keep = (s) => [...s].filter((c) => VOCAB[c] !== undefined).join('');

// One piece of text through phonemizer's punctuation handling: the chunks between marks
// are phonemized alone and the marks put back (phonemizer.punctuation.preserve/restore).
async function phonemizePiece(text, espeak, lang) {
  const t = text.trim();
  let out = '';
  let cursor = 0;
  for (const m of t.matchAll(MARKS_RE)) {
    const chunk = t.slice(cursor, m.index);
    if (chunk.trim()) out += (await espeak(chunk, lang)).join(' ').trim();
    out += m[0];
    cursor = m.index + m[0].length;
  }
  const rest = t.slice(cursor);
  if (rest.trim()) out += (await espeak(rest, lang)).join(' ').trim();
  return keep(espeakDrift(out)).trim();
}

// The phonemizer package carries a newer espeak-ng than kokoro-onnx's build-time one; its
// one systematic difference in English is "or" as oːɹ. Folded back so both agree.
function espeakDrift(s) {
  return s.replace(/oːɹ/g, 'ɔːɹ');
}

// Text -> Kokoro phonemes. `espeak(text, lang) -> Promise<string[]>` (phonemizer.js).
export async function phonemize(text, espeak, lang = 'en-us') {
  const s = speechText(text);
  const pieces = [];
  let last = 0;
  for (const m of s.matchAll(WORD)) {
    const hit = LEXICON.find(([rx]) => rx.test(m[0]));
    if (!hit) continue;
    const before = s.slice(last, m.index);
    if (before.trim()) pieces.push(await phonemizePiece(before, espeak, lang));
    pieces.push(hit[1]);
    last = m.index + m[0].length;
  }
  const rest = s.slice(last);
  if (rest.trim()) pieces.push(await phonemizePiece(rest, espeak, lang));
  let out = '';
  for (const p of pieces.map((x) => x.trim()).filter(Boolean)) out += !out || '.,!?;:…—'.includes(p[0]) ? p : ` ${p}`;
  return out.split(/\s+/).join(' ').trim();
}

export function tokenize(phonemes) {
  const out = [];
  for (const c of phonemes) {
    const id = VOCAB[c];
    if (id !== undefined) out.push(id);
  }
  return out;
}

// Sentences to synthesize one by one, so the first plays while the next is made. Very
// short sentences ride with the next one (Kokoro sounds rushed on two-word inputs); a
// long one is cut at a comma or a space so it stays within the model's context.
export function splitSentences(text, { minWords = 3, maxChars = 220 } = {}) {
  const s = speechText(text);
  if (!s) return [];
  const raw = s.match(/[^.!?…]+(?:[.!?…]+["'”)\]]*|$)/g) || [s];
  const out = [];
  let carry = '';
  for (const part of raw.map((x) => x.trim()).filter(Boolean)) {
    const joined = carry ? `${carry} ${part}` : part;
    if (joined.split(/\s+/).length < minWords) {
      carry = joined;
      continue;
    }
    carry = '';
    out.push(...cutLong(joined, maxChars));
  }
  if (carry) {
    if (out.length && out[out.length - 1].length + carry.length < maxChars) out[out.length - 1] += ` ${carry}`;
    else out.push(carry);
  }
  return out;
}

function cutLong(s, max) {
  if (s.length <= max) return [s];
  const at = Math.max(s.lastIndexOf(', ', max), s.lastIndexOf('; ', max), s.lastIndexOf(' — ', max));
  const cut = at > max * 0.4 ? at + 1 : s.lastIndexOf(' ', max);
  if (cut <= 0) return [s.slice(0, max), ...cutLong(s.slice(max), max)];
  return [s.slice(0, cut).trim(), ...cutLong(s.slice(cut).trim(), max)];
}

// The style vector for n tokens: Kokoro keeps one per length (row n - 1).
export function styleFor(styles, n, dim = 256) {
  const rows = Math.floor(styles.length / dim);
  const row = Math.max(0, Math.min(rows - 1, n - 1));
  return styles.subarray(row * dim, (row + 1) * dim);
}
