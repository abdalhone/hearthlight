// Settings (DESIGN.md §14). Every field goes through game.setSetting so other
// modules hear `settings_changed`. The API key is stored only in this browser.

import { h, button, clear, setText } from './dom.js';
import { makePanel } from './modal.js';
import { saveApiKey, loadApiKey, DEFAULT_SETTINGS } from '../core/settings.js';
import { CONTROLS_SUMMARY } from './content.js';

const BRAIN_CHOICES = [
  ['auto', 'Automatic', 'Claude on claude.ai when available, then your API key, else her offline mind.'],
  ['claude', 'Claude via claude.ai', 'Only when the game runs on claude.ai; otherwise her offline mind.'],
  ['apikey', 'Claude via your API key', 'For copies of the game you host yourself.'],
  ['local', 'Offline mind', 'Her built-in mind. No network, instant replies.'],
];

const VOICES = [
  ['airy', 'Airy'],
  ['buttery', 'Buttery'],
  ['glassy', 'Glassy'],
  ['rounded', 'Rounded'],
];

// The brain's last error code, as something a player can act on.
const PROBLEMS = {
  auth: 'your API key was not accepted',
  rate_limited: 'too many requests just now; she answers on her own for a while',
  connection: 'Claude could not be reached from here',
  invalid_request: 'the request was turned down; check the model name',
  session_expired: 'your claude.ai session expired; sign in again',
  refused: 'Claude declined one message',
  invalid_json: 'one reply came back garbled',
  upstream_error: 'Claude had a problem; she answered on her own',
  not_granted: 'Claude is not allowed in this view',
  sampling_disabled: 'Claude is switched off for this view',
  not_declared: 'Claude is not available in this view',
  not_available: 'Claude is not available in this view',
  capability_disabled: 'Claude is switched off for this view',
  capability_removed: 'Claude is no longer available in this view',
  cancelled: '',
};

export function problemWords(code) {
  if (!code) return '';
  if (Object.prototype.hasOwnProperty.call(PROBLEMS, code)) return PROBLEMS[code];
  return String(code).replace(/_/g, ' ');
}

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export class SettingsPanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.panel = null;
  }

  isOpen() {
    return !!this.panel && this.ui.stack.includes(this.panel);
  }

  open() {
    if (this.isOpen()) return;
    const panel = makePanel({ id: 'settings', title: 'Settings', subtitle: 'Changes apply right away', iconName: 'gear', cls: 'panel-wide' });
    panel.pauses = this.game.state === 'playing';
    this.panel = panel;
    panel.onClose = () => (this.panel = null);
    this.ui.openModal(panel);
    this.render();
  }

  close() {
    if (this.isOpen()) this.ui.closeModal(this.panel);
  }

  set(key, value) {
    const g = this.game;
    g.setSetting(key, value);
    switch (key) {
      case 'musicVol':
      case 'sfxVol':
        g.audio?.applyVolumes?.();
        break;
      case 'voiceVol':
        g.voice?.applyVolume?.();
        break;
      case 'voices':
        if (!value) g.voice?.stop?.();
        break;
      case 'zoom':
        safe(() => g.renderer?.resize?.());
        break;
      case 'reduceMotion':
        this.ui.applyMotion();
        break;
      case 'playerName':
        if (g.player) g.player.name = value;
        break;
      case 'companionName':
        if (g.companion) g.companion.name = value;
        break;
      case 'brain':
      case 'modelTier':
      case 'apiModel':
        this.reinitBrain();
        break;
      case 'cloudSave':
        if (value) g.save?.save?.('manual');
        break;
      default:
    }
  }

  reinitBrain() {
    safe(() => this.game.brain?.init?.());
    this.refreshStatus();
    this.ui.title?.refreshMindLine?.();
  }

  // The status line follows the brain while the panel is open (busy, errors, provider).
  update(dt) {
    if (!this.isOpen()) return;
    this.statusT = (this.statusT || 0) + dt;
    if (this.statusT < 0.5) return;
    this.statusT = 0;
    this.refreshStatus();
    const live = this.game.brain?.voice?.live;
    if (this.liveEl && live) setText(this.liveEl, live.statusText());
  }

  refreshStatus() {
    if (!this.statusEl) return;
    const st = safe(() => this.game.brain?.status?.()) || {};
    const problem = problemWords(st.lastError);
    setText(this.statusEl, `Her mind right now: ${st.label || 'her offline mind'}${st.busy ? ' (thinking…)' : ''}${problem ? `. Last problem: ${problem}.` : ''}`);
    this.statusEl.dataset.provider = st.provider || 'local';
  }

  render() {
    const g = this.game;
    const s = g.settings;
    const rt = g.runtime;
    const body = this.panel.body;
    clear(body);
    body.classList.add('settings-body');

    // --- Lyra's mind ---
    const mindSec = h('section', { class: 'box' }, h('h3', { text: "Lyra's mind" }));
    this.statusEl = h('p', { class: 'brain-status', role: 'status' });
    mindSec.append(this.statusEl);
    const choices = h('div', { class: 'choice-list', role: 'radiogroup', 'aria-label': 'Which mind drives Lyra' });
    for (const [id, label, note] of BRAIN_CHOICES) {
      const input = h('input', { type: 'radio', name: 'brain', value: id, checked: s.brain === id });
      input.addEventListener('change', () => {
        if (input.checked) {
          this.set('brain', id);
          this.render();
        }
      });
      choices.append(h('label', { class: 'choice' }, input, h('span', { class: 'choice-text' }, h('span', { class: 'choice-label', text: label }), h('span', { class: 'choice-note', text: note }))));
    }
    mindSec.append(choices);

    if (rt?.sample || s.brain === 'claude' || s.brain === 'auto') {
      mindSec.append(this.selectRow('Claude on claude.ai', 'modelTier', [
        ['quick', 'Quick replies'],
        ['default', 'Deeper thought (slower)'],
      ]));
    }

    // API key
    const keyField = h('input', { type: 'password', class: 'field mono', autocomplete: 'off', spellcheck: 'false', placeholder: g.apiKey ? '•••••••• saved in this browser' : 'sk-ant-…', 'aria-label': 'Anthropic API key' });
    const keyStatus = h('span', { class: 'muted small', text: g.apiKey || loadApiKey() ? 'A key is saved in this browser.' : 'No key saved.' });
    const saveKey = button('Save key', {
      cls: 'btn-ember btn-small',
      onClick: () => {
        const v = keyField.value.trim();
        if (!v) return;
        saveApiKey(v);
        g.apiKey = v;
        // The key itself never goes on the bus; listeners only learn that it changed.
        g.bus?.emit('settings_changed', { key: 'apiKey', value: true });
        keyField.value = '';
        keyField.placeholder = '•••••••• saved in this browser';
        setText(keyStatus, 'Key saved in this browser.');
        this.reinitBrain();
        this.ui.toast('API key saved in this browser only.', 'good');
      },
    });
    const clearKey = button('Forget key', {
      cls: 'btn-ghost btn-small',
      onClick: () => {
        saveApiKey('');
        g.apiKey = '';
        g.bus?.emit('settings_changed', { key: 'apiKey', value: false });
        keyField.value = '';
        keyField.placeholder = 'sk-ant-…';
        setText(keyStatus, 'No key saved.');
        this.reinitBrain();
      },
    });
    keyField.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') saveKey.click();
    });
    const modelField = h('input', { type: 'text', class: 'field mono', value: s.apiModel || '', spellcheck: 'false', 'aria-label': 'Model for your API key' });
    modelField.addEventListener('change', () => this.set('apiModel', modelField.value.trim() || DEFAULT_SETTINGS.apiModel));
    mindSec.append(
      h(
        'details',
        { class: 'api-key', open: s.brain === 'apikey' },
        h('summary', { text: 'Your own API key' }),
        h('p', { class: 'warning', text: 'Your key is stored only in this browser, on this device. It is never put in save files or sent anywhere except directly to Anthropic when Lyra thinks. Anyone using this browser profile could read it: do not save a key on a shared computer. Keys do not work inside claude.ai, which blocks outside connections.' }),
        h('div', { class: 'key-row' }, keyField, saveKey, clearKey),
        keyStatus,
        h('label', { class: 'form-row' }, h('span', { class: 'form-label', text: 'Model' }), modelField),
      ),
    );

    // --- Voices (DESIGN.md §21) ---
    const voiceSec = h('section', { class: 'box' }, h('h3', { text: 'Voices' }));
    voiceSec.append(
      this.toggleRow('Characters speak their lines', 'voices'),
      this.rangeRow('Voice volume', 'voiceVol'),
      this.toggleRow('Lyra', 'voiceLyra'),
      this.toggleRow('Villagers', 'voiceVillagers'),
      this.toggleRow('Narrator', 'voiceNarrator'),
      h('p', { class: 'muted small', text: 'Lines without a recording (her replies from Claude, made-up lines) can still be spoken:' }),
    );
    const live = g.brain?.voice?.live;
    this.liveEl = null;
    if (live?.available?.()) {
      voiceSec.append(this.toggleRow('Kokoro voice for everything she says — downloads about 90 MB once', 'kokoroLive'));
      this.liveEl = h('p', { class: 'muted small voice-live-status', role: 'status', text: live.statusText() });
      voiceSec.append(this.liveEl);
    }
    voiceSec.append(this.toggleRow(rt?.tts ? "Read her other replies in Claude's voice" : 'Read her other replies aloud', 'voice'));
    if (rt?.tts) voiceSec.append(this.selectRow("Claude's voice", 'voiceName', VOICES));
    voiceSec.append(this.toggleRow("Use the browser's voice when nothing else can", 'browserVoice'));

    // --- Sound ---
    const soundSec = h('section', { class: 'box' }, h('h3', { text: 'Sound' }));
    soundSec.append(this.rangeRow('Music', 'musicVol'), this.rangeRow('Effects', 'sfxVol'));

    // --- Display ---
    const dispSec = h('section', { class: 'box' }, h('h3', { text: 'Display' }));
    dispSec.append(
      this.selectRow('Zoom', 'zoom', [
        [0.75, 'Far'],
        [1, 'Normal'],
        [1.25, 'Close'],
        [1.5, 'Closest'],
      ]),
      this.selectRow('Speech speed', 'textSpeed', [
        [0.6, 'Slow'],
        [1, 'Normal'],
        [1.6, 'Fast'],
        [3, 'Instant-ish'],
      ]),
      this.toggleRow("Show Lyra's thought bubbles", 'showThoughts'),
      this.toggleRow('Reduce motion', 'reduceMotion'),
      this.toggleRow('Show frames per second', 'showFps'),
    );

    // --- Names ---
    const nameSec = h('section', { class: 'box' }, h('h3', { text: 'Names' }));
    nameSec.append(this.textRow('Your name', 'playerName', 20), this.textRow("Your companion's name", 'companionName', 20));

    // --- Saving ---
    const saveSec = h('section', { class: 'box' }, h('h3', { text: 'Saving' }));
    if (rt?.db && rt?.user) saveSec.append(this.toggleRow('Also keep my save in my claude.ai account', 'cloudSave'));
    else saveSec.append(h('p', { class: 'muted small', text: 'Your game saves in this browser. When played on claude.ai, it can also keep a copy in your account.' }));
    if (g.state === 'playing') saveSec.append(h('div', { class: 'data-actions' }, button('Save now', { cls: 'btn-small', onClick: () => g.save?.save?.('manual') })));

    // --- Controls ---
    const ctrlSec = h('section', { class: 'box' }, h('h3', { text: 'Controls' }));
    const dl = h('dl', { class: 'controls' });
    for (const [k, v] of CONTROLS_SUMMARY) dl.append(h('div', { class: 'control' }, h('dt', null, h('kbd', { class: 'keycap', text: k })), h('dd', { text: v })));
    ctrlSec.append(dl, h('p', { class: 'muted small', text: 'Gamepad: A attack · B dodge · X interact · Y talk · Start pause. Touch: drag on the left half to move; buttons on the right.' }));

    body.append(h('div', { class: 'settings-grid' }, mindSec, h('div', { class: 'settings-col' }, voiceSec, soundSec, dispSec), h('div', { class: 'settings-col' }, nameSec, saveSec, ctrlSec)));

    this.panel.foot.replaceChildren();
    if (g.state === 'playing') this.panel.foot.append(button('Quit to title', { cls: 'btn-danger btn-small', onClick: () => this.ui.quitToTitle() }));
    this.panel.foot.append(button('Done', { cls: 'btn-ember', onClick: () => this.close() }));
    this.refreshStatus();
  }

  toggleRow(label, key) {
    const s = this.game.settings;
    const input = h('input', { type: 'checkbox', class: 'switch', checked: !!s[key] });
    input.addEventListener('change', () => this.set(key, input.checked));
    return h('label', { class: 'form-row toggle-row' }, h('span', { class: 'form-label', text: label }), input);
  }

  rangeRow(label, key) {
    const s = this.game.settings;
    const v = Math.round((Number(s[key]) || 0) * 100);
    const out = h('output', { class: 'num', text: `${v}%` });
    const input = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(v), 'aria-label': label });
    input.addEventListener('input', () => {
      out.textContent = `${input.value}%`;
      this.set(key, Number(input.value) / 100);
    });
    input.addEventListener('change', () => this.game.audio?.play('ui_click'));
    return h('label', { class: 'form-row range-row' }, h('span', { class: 'form-label', text: label }), input, out);
  }

  selectRow(label, key, options) {
    const s = this.game.settings;
    const sel = h('select', { class: 'field', 'aria-label': label });
    for (const [v, text] of options) {
      const o = h('option', { value: String(v), text });
      if (String(s[key]) === String(v)) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => {
      const raw = sel.value;
      const num = Number(raw);
      this.set(key, typeof options[0][0] === 'number' && Number.isFinite(num) ? num : raw);
    });
    return h('label', { class: 'form-row' }, h('span', { class: 'form-label', text: label }), sel);
  }

  textRow(label, key, max = 24) {
    const s = this.game.settings;
    const input = h('input', { type: 'text', class: 'field', maxlength: String(max), value: s[key] || '' });
    input.addEventListener('keydown', (e) => e.stopPropagation());
    input.addEventListener('change', () => {
      const v = input.value.trim().slice(0, max);
      if (!v) {
        input.value = s[key] || '';
        return;
      }
      this.set(key, v);
    });
    return h('label', { class: 'form-row' }, h('span', { class: 'form-label', text: label }), input);
  }
}
