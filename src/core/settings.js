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
  voice: false, // Lyra reads aloud the replies that have no recorded line (claude.ai's voice)
  voiceName: 'airy', // claude.ai voice: buttery | airy | glassy | rounded
  // Recorded voices (DESIGN.md §21, src/audio/voice.js)
  voices: true, // characters speak their recorded lines
  voiceVol: 0.85,
  voiceLyra: true,
  voiceVillagers: true,
  voiceNarrator: true,
  kokoroLive: false, // Kokoro in this browser for everything Lyra says (downloads about 90 MB once)
  browserVoice: false, // the browser's own voice when nothing better can speak
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
});

export function loadSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
  } catch {
    stored = {};
  }
  return { ...DEFAULT_SETTINGS, ...stored };
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
