// Settings (DESIGN.md §14, §24): five tabs (Game, Controls, Sound & voices, Minds
// (Claude), Display), every option exactly once, each with a short plain label and a
// one-line note. Every field goes through game.setSetting so other modules hear
// `settings_changed`. The API key is stored only in this browser. Save and Quit live in
// the menu, the list of keys and buttons in How to play (Controls links there).

import { h, button, clear, setText, icon } from './dom.js';
import { makePanel } from './modal.js';
import { saveApiKey, loadApiKey, DEFAULT_SETTINGS } from '../core/settings.js';

export const SETTINGS_TABS = [
  { id: 'game', label: 'Game', icon: 'flag' },
  { id: 'controls', label: 'Controls', icon: 'hand' },
  { id: 'sound', label: 'Sound & voices', icon: 'mic' },
  { id: 'minds', label: 'Minds (Claude)', icon: 'mind' },
  { id: 'display', label: 'Display', icon: 'sun' },
];

// Where every setting lives: tab → groups → keys. Each key appears exactly once.
export const SETTINGS_LAYOUT = {
  game: [
    { id: 'names', title: 'Names', keys: ['playerName', 'companionName'] },
    { id: 'journey', title: 'Your journey', keys: ['deathMode', 'cloudSave'] },
  ],
  controls: [
    { id: 'touch', title: 'Touch', keys: ['touchScale', 'leftHanded', 'touchBuzz'] },
    { id: 'mouse', title: 'Mouse', keys: ['aimGuides'], howTo: true },
  ],
  sound: [
    { id: 'volume', title: 'Volume', keys: ['musicVol', 'sfxVol'] },
    { id: 'voices', title: 'Voices in the cutscenes', note: 'The story scenes are spoken. Everywhere else, words are text.', keys: ['voices', 'voiceVol'] },
  ],
  minds: [
    { id: 'lyra', title: "Lyra's mind", keys: ['brain', 'modelTier'] },
    { id: 'apikey', title: 'Your own API key', keys: ['apiModel'] },
    { id: 'village', title: 'Villagers', keys: ['villageAi'] },
  ],
  display: [
    { id: 'screen', title: 'Screen', keys: ['zoom', 'reduceMotion', 'showFps'] },
    { id: 'words', title: 'Words', keys: ['textSpeed', 'showThoughts'] },
  ],
};

// Settings the touch and aim controls keep outside DEFAULT_SETTINGS (unset = default).
export const EXTRA_SETTING_KEYS = ['touchScale', 'leftHanded', 'touchBuzz', 'aimGuides'];

// Every key the panel shows, in order, with its tab: [{ key, tab, group }].
export function settingKeysInLayout() {
  const out = [];
  for (const t of SETTINGS_TABS) for (const g of SETTINGS_LAYOUT[t.id] || []) for (const key of g.keys) out.push({ key, tab: t.id, group: g.id });
  return out;
}

const BRAIN_CHOICES = [
  ['auto', 'Automatic', 'Claude on claude.ai when available, then your API key, else her offline mind.'],
  ['claude', 'Claude via claude.ai', 'Only when the game runs on claude.ai; otherwise her offline mind.'],
  ['apikey', 'Claude via your API key', 'For copies of the game you host yourself.'],
  ['local', 'Offline mind', 'Her built-in mind. No network, instant replies.'],
];

// The plain rows: kind, label, one-line note, options. `on`: a toggle that is on until
// turned off (unset = on). The radio lists (brain, villageAi) and the API model are built
// by their own methods.
export const SETTING_ROWS = {
  playerName: { kind: 'text', label: 'Your name', note: 'What the people of Hearthvale call you.', max: 20 },
  companionName: { kind: 'text', label: 'Her name', note: 'The name your companion answers to.', max: 20 },
  deathMode: {
    kind: 'select',
    label: 'When you die',
    note: 'Ends: with no rescue and no flame kept for you at the chapel, this save closes for good. Home: you lose a little coin.',
    options: [
      ['final', 'Your story ends'],
      ['home', 'Wake at home'],
    ],
  },
  cloudSave: { kind: 'toggle', label: 'Copy in my claude.ai account', note: 'Your journey follows you to your other devices.' },
  touchScale: {
    kind: 'select',
    label: 'Button size',
    note: 'The buttons on a phone or tablet.',
    options: [
      [0.9, 'Smaller'],
      [1, 'Normal'],
      [1.15, 'Larger'],
    ],
    fallback: 1,
  },
  leftHanded: { kind: 'toggle', label: 'Left-handed', note: 'Move with your right thumb, fight with your left.' },
  touchBuzz: { kind: 'toggle', on: true, label: 'Buzz', note: 'A small vibration when you press a button, where the phone allows it.' },
  aimGuides: { kind: 'toggle', on: true, label: 'Aim guide', note: 'Shows where a weave will go, under the mouse.' },
  musicVol: { kind: 'range', label: 'Music' },
  sfxVol: { kind: 'range', label: 'Effects' },
  voices: { kind: 'toggle', label: 'Spoken scenes', note: 'The narrator, Lyra and the others speak their lines.' },
  voiceVol: { kind: 'range', label: 'Voice volume' },
  modelTier: {
    kind: 'select',
    label: 'On claude.ai',
    note: 'Deeper thought answers more slowly.',
    options: [
      ['quick', 'Quick replies'],
      ['default', 'Deeper thought'],
    ],
  },
  zoom: {
    kind: 'select',
    label: 'Zoom',
    note: 'How close the camera is.',
    options: [
      [0.75, 'Far'],
      [1, 'Normal'],
      [1.25, 'Close'],
      [1.5, 'Closest'],
    ],
  },
  reduceMotion: { kind: 'toggle', label: 'Reduce motion', note: 'Less shaking, flashing and drifting.' },
  showFps: { kind: 'toggle', label: 'Frame rate', note: 'Frames per second, in a corner.' },
  textSpeed: {
    kind: 'select',
    label: 'Text speed',
    note: 'How fast words appear in speech bubbles.',
    options: [
      [0.6, 'Slow'],
      [1, 'Normal'],
      [1.6, 'Fast'],
      [3, 'Instant-ish'],
    ],
  },
  showThoughts: { kind: 'toggle', label: 'Thought bubbles', note: 'What she is thinking, above her head.' },
};

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

let rowSeq = 0;

export class SettingsPanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.panel = null;
    this.tab = 'game';
  }

  isOpen() {
    return !!this.panel && this.ui.stack.includes(this.panel);
  }

  open(tab) {
    if (tab && SETTINGS_TABS.some((t) => t.id === tab)) this.tab = tab;
    if (this.isOpen()) {
      this.showTab(this.tab);
      return;
    }
    const panel = makePanel({ id: 'settings', title: 'Settings', subtitle: 'Changes apply right away', iconName: 'gear', cls: 'panel-settings' });
    panel.pauses = this.game.state === 'playing';
    this.panel = panel;
    panel.onClose = () => {
      this.panel = null;
      this.statusEl = null;
    };
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
        this.refreshDeps();
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
    const g = this.game;
    safe(() => g.brain?.init?.());
    // 'Always' needs Claude (claude.ai or a key); it falls back when neither is there.
    const pid = safe(() => g.brain?.providers?.currentId?.(), null);
    if (g.settings?.villageAi === 'always' && pid !== 'api' && pid !== 'claude.ai') g.setSetting('villageAi', 'player');
    if (this.villageAiEl?.isConnected) this.villageAiEl.replaceWith(this.villageAiRow());
    this.refreshDeps();
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
  }

  refreshStatus() {
    if (!this.statusEl) return;
    const st = safe(() => this.game.brain?.status?.()) || {};
    const problem = problemWords(st.lastError);
    setText(this.statusEl, `Right now: ${st.label || 'her offline mind'}${st.busy ? ' (thinking…)' : ''}${problem ? `. Last problem: ${problem}.` : ''}`);
    this.statusEl.dataset.provider = st.provider || 'local';
  }

  // What is not available here, and why: [disabled, why] for a key, or null.
  blocked(key) {
    const g = this.game;
    const s = g.settings || {};
    const rt = g.runtime;
    switch (key) {
      case 'cloudSave':
        return rt?.db && rt?.user ? null : 'Only when you play on claude.ai.';
      case 'modelTier':
        return s.brain === 'apikey' || s.brain === 'local' ? 'Used when her mind is Claude on claude.ai.' : null;
      case 'voiceVol':
        return s.voices === false ? 'Turn on spoken scenes first.' : null;
      case 'deathMode':
        return safe(() => g.survival?.isFallen?.(g.player), false) ? 'Not while you lie bleeding. Ask again once you are on your feet.' : null;
      default:
        return null;
    }
  }

  // Rows whose availability follows another setting, updated in place (focus stays put).
  refreshDeps() {
    if (!this.panel) return;
    for (const row of this.panel.body.querySelectorAll('.set-row[data-setting]')) {
      const key = row.dataset.setting;
      const def = SETTING_ROWS[key];
      if (!def) continue;
      const why = this.blocked(key);
      const ctl = row.querySelector('input, select');
      if (ctl) ctl.disabled = !!why;
      row.classList.toggle('is-disabled', !!why);
      const note = row.querySelector('.set-note');
      if (note) setText(note, why || this.noteFor(key));
    }
  }

  noteFor(key) {
    const def = SETTING_ROWS[key];
    if (!def) return '';
    return def.note || '';
  }

  name() {
    return this.game.settings?.companionName || 'Lyra';
  }

  render() {
    const body = this.panel.body;
    const keepScroll = {};
    for (const pane of body.querySelectorAll('.set-pane')) keepScroll[pane.dataset.tab] = pane.scrollTop;
    clear(body);
    body.classList.add('settings-body');
    this.tabButtons = {};
    this.panes = {};
    const tabs = h('div', { class: 'tabs settings-tabs', role: 'tablist', 'aria-label': 'Settings' });
    const panes = h('div', { class: 'set-panes' });
    for (const t of SETTINGS_TABS) {
      const b = h('button', { type: 'button', class: 'tab set-tab', role: 'tab', id: `set-tab-${t.id}`, 'data-tab': t.id, 'aria-controls': `set-pane-${t.id}`, 'aria-selected': 'false', tabindex: '-1' }, icon(t.icon, 'set-tab-ico'), h('span', { class: 'set-tab-label', text: t.label }));
      b.addEventListener('click', () => this.showTab(t.id, true));
      b.addEventListener('keydown', (e) => this.tabKey(e, t.id));
      this.tabButtons[t.id] = b;
      tabs.append(b);
      const pane = h('div', { class: 'set-pane', role: 'tabpanel', id: `set-pane-${t.id}`, 'data-tab': t.id, 'aria-labelledby': `set-tab-${t.id}`, hidden: true });
      const groups = h('div', { class: 'set-groups' });
      for (const g of SETTINGS_LAYOUT[t.id]) groups.append(this.groupEl(g));
      pane.append(groups);
      this.panes[t.id] = pane;
      panes.append(pane);
    }
    body.append(tabs, panes);
    this.showTab(this.tab);
    for (const [id, top] of Object.entries(keepScroll)) if (this.panes[id]) this.panes[id].scrollTop = top;
    this.refreshDeps();
    this.refreshStatus();
  }

  showTab(id, focus = false) {
    if (!this.panes?.[id]) return;
    this.tab = id;
    for (const [tid, b] of Object.entries(this.tabButtons)) {
      const on = tid === id;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('active', on);
      this.panes[tid].hidden = !on;
    }
    if (focus) this.tabButtons[id].focus();
  }

  // Left and right walk the tabs, Home and End jump to the ends (the tablist pattern).
  tabKey(e, id) {
    const i = SETTINGS_TABS.findIndex((t) => t.id === id);
    const n = SETTINGS_TABS.length;
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % n;
    else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.showTab(SETTINGS_TABS[j].id, true);
  }

  groupEl(g) {
    const sec = h('section', { class: `set-group set-group-${g.id}` }, h('h3', { class: 'set-group-title', text: g.title }));
    if (g.note) sec.append(h('p', { class: 'set-group-note', text: g.note }));
    if (g.id === 'lyra') {
      this.statusEl = h('p', { class: 'brain-status', role: 'status' });
      sec.append(this.statusEl);
    }
    for (const key of g.keys) sec.append(this.rowFor(key));
    if (g.howTo) sec.append(this.howToRow());
    return sec;
  }

  rowFor(key) {
    if (key === 'brain') return this.brainRow();
    if (key === 'villageAi') return this.villageAiRow();
    if (key === 'apiModel') return this.apiKeyBlock();
    const def = SETTING_ROWS[key];
    if (!def) return h('div', { class: 'set-row', 'data-setting': key, text: key });
    const label = def.label;
    if (def.kind === 'toggle') return this.toggleRow(label, key, def.on);
    if (def.kind === 'range') return this.rangeRow(label, key);
    if (def.kind === 'select') return this.selectRow(label, key, def.options, def.fallback ?? def.options[0][0]);
    return this.textRow(label, key, def.max);
  }

  // One row: the label and its one-line note on the left, the control on the right.
  row(key, kind, label, control) {
    const id = `set-${key}-${++rowSeq}`;
    control.id = id;
    const note = h('span', { class: 'set-note', text: this.noteFor(key) });
    return h('div', { class: `set-row set-${kind}`, 'data-setting': key }, h('label', { class: 'set-main', for: id }, h('span', { class: 'set-label', text: label }), note), h('span', { class: 'set-ctl' }, control));
  }

  toggleRow(label, key, onByDefault = false) {
    const s = this.game.settings;
    const input = h('input', { type: 'checkbox', class: 'switch', checked: onByDefault ? s[key] !== false : !!s[key] });
    input.addEventListener('change', () => this.set(key, input.checked));
    return this.row(key, 'toggle', label, input);
  }

  rangeRow(label, key) {
    const s = this.game.settings;
    const v = Math.round((Number(s[key] ?? DEFAULT_SETTINGS[key]) || 0) * 100);
    const out = h('output', { class: 'num', text: `${v}%` });
    const input = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(v) });
    input.addEventListener('input', () => {
      out.textContent = `${input.value}%`;
      this.set(key, Number(input.value) / 100);
    });
    input.addEventListener('change', () => this.game.audio?.play('ui_click'));
    const r = this.row(key, 'range', label, input);
    r.querySelector('.set-ctl').append(out);
    return r;
  }

  selectRow(label, key, options, fallback = options[0]?.[0]) {
    const s = this.game.settings;
    const sel = h('select', { class: 'field' });
    const cur = s[key] ?? fallback;
    for (const [v, text] of options) {
      const o = h('option', { value: String(v), text });
      if (String(cur) === String(v)) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => {
      const raw = sel.value;
      const num = Number(raw);
      this.set(key, typeof options[0][0] === 'number' && Number.isFinite(num) ? num : raw);
    });
    return this.row(key, 'select', label, sel);
  }

  textRow(label, key, max = 24) {
    const s = this.game.settings;
    const input = h('input', { type: 'text', class: 'field', maxlength: String(max), value: s[key] || '', autocomplete: 'off', spellcheck: 'false' });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
    });
    input.addEventListener('change', () => {
      const v = input.value.trim().slice(0, max);
      if (!v) {
        input.value = s[key] || '';
        return;
      }
      this.set(key, v);
      if (key === 'companionName') this.refreshDeps();
    });
    return this.row(key, 'text', label, input);
  }

  // Which mind drives Lyra (a radio list; the status line sits above it).
  brainRow() {
    const s = this.game.settings;
    const choices = h('div', { class: 'choice-list set-row set-radio', 'data-setting': 'brain', role: 'radiogroup', 'aria-label': `Which mind drives ${this.name()}` });
    for (const [id, label, note] of BRAIN_CHOICES) {
      const input = h('input', { type: 'radio', name: 'brain', value: id, checked: s.brain === id });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        this.set('brain', id);
        const det = this.panel?.body.querySelector('.api-key');
        if (det && id === 'apikey') det.open = true;
      });
      choices.append(h('label', { class: 'choice' }, input, h('span', { class: 'choice-text' }, h('span', { class: 'choice-label', text: label }), h('span', { class: 'choice-note', text: note }))));
    }
    return choices;
  }

  // The key (stored only in this browser, never a setting or a save) and its model.
  apiKeyBlock() {
    const g = this.game;
    const s = g.settings;
    const keyField = h('input', { type: 'password', class: 'field mono', autocomplete: 'off', spellcheck: 'false', placeholder: g.apiKey ? '•••••••• saved in this browser' : 'sk-ant-…', 'aria-label': 'Anthropic API key' });
    const keyStatus = h('span', { class: 'set-note key-status', text: g.apiKey || loadApiKey() ? 'A key is saved in this browser.' : 'No key saved.' });
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
    const clearKey = button('Forget', {
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
    const modelField = h('input', { type: 'text', class: 'field mono', value: s.apiModel || '', spellcheck: 'false', autocomplete: 'off' });
    modelField.addEventListener('keydown', (e) => e.stopPropagation());
    modelField.addEventListener('change', () => this.set('apiModel', modelField.value.trim() || DEFAULT_SETTINGS.apiModel));
    const model = this.row('apiModel', 'text', 'Model', modelField);
    setText(model.querySelector('.set-note'), 'The Claude model your key uses.');
    return h(
      'details',
      { class: 'api-key', open: s.brain === 'apikey' },
      h('summary', { text: 'Use your own key' }),
      h('p', { class: 'warning', text: 'Kept only in this browser, never in a save, and sent only to Anthropic when she thinks. Do not save a key on a shared computer. Keys do not work inside claude.ai.' }),
      h('div', { class: 'key-row' }, keyField, saveKey, clearKey),
      keyStatus,
      model,
    );
  }

  // 'player' (default): villagers reach Claude only when you talk to them or listen in.
  // 'always': also in the background when something in their day goes wrong (DESIGN §28),
  // through claude.ai or a key; with a key, ambient talk near you as well (§19.3).
  villageAiRow() {
    const g = this.game;
    const s = g.settings;
    const current = s.villageAi === 'always' ? 'always' : 'player';
    const pid = safe(() => g.brain?.providers?.currentId?.(), null);
    const apiReady = pid === 'api' || (!!g.apiKey && s.brain === 'apikey');
    const claudeReady = apiReady || pid === 'claude.ai';
    const choices = h('div', { class: 'choice-list set-row set-radio', 'data-setting': 'villageAi', role: 'radiogroup', 'aria-label': 'When villagers think with Claude' });
    const always = !claudeReady
      ? 'Needs Claude: play on claude.ai, or set "Her mind" to your own API key.'
      : `Also in the background, when something in their day goes wrong (someone missing, a shop shut): Claude works out what they do next, a few villagers per call, at most one call every 30 seconds.${apiReady ? ' Villagers near you also talk among themselves with Claude, at most once every 45 seconds. Uses your API key.' : ' Uses your claude.ai account.'} Their own reasoning takes over whenever Claude is busy or unavailable.`;
    const opts = [
      ['player', 'When you talk to them', 'Only when you say something to someone or listen in. Everything else, including how they deal with a bad day, comes from their own reasoning.'],
      ['always', 'Always', always],
    ];
    for (const [id, label, note] of opts) {
      const disabled = id === 'always' && !claudeReady;
      const input = h('input', { type: 'radio', name: 'villageAi', value: id, checked: current === id, disabled });
      input.addEventListener('change', () => {
        if (input.checked) this.set('villageAi', id);
      });
      choices.append(h('label', { class: `choice${disabled ? ' is-disabled' : ''}` }, input, h('span', { class: 'choice-text' }, h('span', { class: 'choice-label', text: label }), h('span', { class: 'choice-note', text: note }))));
    }
    this.villageAiEl = choices;
    return choices;
  }

  // The keys and buttons themselves are in How to play, for each device.
  howToRow() {
    const b = button('How to play', { icon: 'hand', cls: 'btn-small', onClick: () => this.ui.title?.openHowTo?.('controls') });
    return h('div', { class: 'set-row set-link' }, h('span', { class: 'set-main' }, h('span', { class: 'set-label', text: 'Keys and buttons' }), h('span', { class: 'set-note', text: 'Every control for touch, keyboard and gamepad.' })), h('span', { class: 'set-ctl' }, b));
  }
}
