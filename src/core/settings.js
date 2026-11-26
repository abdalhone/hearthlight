import { SETTINGS_KEY, APIKEY_KEY } from './constants.js';

// Player-facing settings. Stored in localStorage (a per-viewer convenience).
// The API key is kept under its own key and never written into save files.
export const DEFAULT_SETTINGS = Object.freeze({
  // Which mind drives Lyra's conversation:
  //  'auto'   - Claude through claude.ai when the page runs there, else Claude via API key if set, else local
  //  'claude' - Claude through claude.ai only (falls back to local if unavailable)
  //  'apikey' - Claude through the player's own Anthropic API key (self-hosted copies only)
  //  'local'  - the built-in offline mind, no AI service at all
  brain: 'auto',
  modelTier: 'quick', // claude.ai tier: 'quick' (fast) or 'default' (deeper, slower)
  apiModel: 'claude-opus-5-5', // model used with an API key
  // Voices are heard only in the cutscenes (DESIGN.md §21, src/audio/voice.js); everyone
  // else's words, Lyra's replies included, are text.
  voices: true,
  voiceVol: 0.85,
  musicVol: 0.45,
  sfxVol: 0.7,
  textSpeed: 1, // speech-bubble typing speed multiplier
  showThoughts: true, // show Lyra's thought bubbles in the world
  zoom: 1, // 0.75 | 1 | 1.25 | 1.5 (bigger = closer)
  companionName: 'Lyra',
  playerName: 'Traveler',
  cloudSave: true, // also keep the save on claude.ai when available
  reduceMotion: false,
  showFps: false,
  villageAi: 'player', // 'player': Claude speaks for villagers only when the player acts; 'always': also thinks for villagers with a problem in the background (claude.ai or key, DESIGN §28) and ambient talk (API key only)
  // When I die (DESIGN §27): 'final' — the story ends unless a kept flame burns at the chapel
  // (the save closes and moves to Past lives); 'home' — wake at home, a little poorer.
  deathMode: 'final',
  // The finishing blow's scene (round 14b, DESIGN §35.4): 'full' | 'brief' | 'off' (the same
  // outcome, no scene). Reduce motion plays it brief.
  finishers: 'full',
});

export function loadSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
  } catch {
    stored = {};
  }
  return { ...DEFAULT_SETTINGS, ...migrateSettings(stored) };
}

// Settings saved before voices became cutscene-only (DESIGN §21): there, "Spoken lines" and
// the voice volume also governed villagers' and Lyra's voices, so a player who turned
// those off would now get silent cutscenes. Their old choice no longer means the same
// thing: voices come back on once, and the old keys go. A choice made after this stays.
const LEGACY_VOICE_KEYS = ['voiceLyra', 'voiceVillagers', 'voiceNarrator', 'kokoroLive', 'browserVoice', 'voiceName', 'voice'];
export function migrateSettings(stored) {
  if (!stored || typeof stored !== 'object') return {};
  if (!LEGACY_VOICE_KEYS.some((k) => k in stored)) return stored;
  const out = { ...stored };
  for (const k of LEGACY_VOICE_KEYS) delete out[k];
  out.voices = true;
  out.voiceVol = Number(stored.voiceVol) > 0.05 ? Number(stored.voiceVol) : DEFAULT_SETTINGS.voiceVol;
  saveSettings(out);
  return out;
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage blocked: settings last for this visit only */
  }
}

export function loadApiKey() {
  try {
    return localStorage.getItem(APIKEY_KEY) || '';
  } catch {
    return '';
  }
}

export function saveApiKey(key) {
  try {
    if (key) localStorage.setItem(APIKEY_KEY, key);
    else localStorage.removeItem(APIKEY_KEY);
  } catch {
    /* ignore */
  }
}
