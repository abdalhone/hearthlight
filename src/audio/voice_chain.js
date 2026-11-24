// Which voice speaks one of Lyra's lines (DESIGN.md §21). Pure and DOM-free so it is
// tested directly. A pre-rendered clip always wins. Without one, the order is:
//   1. live Kokoro in the browser   (opt-in setting `kokoroLive`, once it runs here)
//   2. claude.ai's voice            (the `tts` capability, where the page has it)
//   3. the browser's own voice      (only if the player enabled `browserVoice`)
//   4. silence                      (the words stay on screen)
// The caller tries each method in turn and moves on when one fails.

export const VOICE_SETTINGS = Object.freeze({
  voices: true, // characters speak their recorded lines
  voiceVol: 0.85,
  voiceLyra: true,
  voiceVillagers: true,
  voiceNarrator: true,
  kokoroLive: false, // Kokoro in the browser for everything she says (about 90 MB once)
  browserVoice: false, // the browser's speech voice when nothing better can speak
});

export const GROUP_SETTING = Object.freeze({ lyra: 'voiceLyra', villagers: 'voiceVillagers', narrator: 'voiceNarrator' });

export function groupOf(speaker) {
  const s = String(speaker || '');
  if (s === 'narrator') return 'narrator';
  if (s === 'lyra' || s.startsWith('lyra_')) return 'lyra';
  return 'villagers';
}

function on(settings, key) {
  const v = settings?.[key];
  return v === undefined ? VOICE_SETTINGS[key] !== false : v !== false;
}

// Is this speaker's group allowed to make a sound at all?
export function groupEnabled(settings, speaker) {
  if (!on(settings, 'voices')) return false;
  const vol = Number(settings?.voiceVol ?? VOICE_SETTINGS.voiceVol);
  if (!(vol > 0)) return false;
  return on(settings, GROUP_SETTING[groupOf(speaker)]);
}

// The methods to try for one of Lyra's lines, best first.
//   kind     'say' (a reply to the player) | 'bark' | 'shout' | 'whisper' | 'cutscene'
//   hasClip  a pre-rendered clip exists for this exact line
//   kokoro   { enabled, supported, failed }  the live engine's state
//   tts      true when claude.ai's voice is offered here
//   synth    true when the browser has speechSynthesis
export function lyraVoiceChain({ settings = {}, kind = 'say', hasClip = false, kokoro = {}, tts = false, synth = false } = {}) {
  if (!groupEnabled(settings, 'lyra')) return [];
  if (hasClip) return ['clip'];
  const out = [];
  if (settings.kokoroLive && kokoro.supported !== false && !kokoro.failed) out.push('kokoro');
  // Another voice for a passing bark would not sound like her recorded lines: only her
  // replies to the player fall back to a voice that is not her own.
  const reply = kind === 'say' || kind === 'reply' || kind === 'cutscene';
  if (reply && settings.voice && tts) out.push('tts');
  if (reply && settings.browserVoice && synth) out.push('browser');
  return out;
}
