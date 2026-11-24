// A text field's microphone: the runtime's dictation (claude.ai) typed into one field.
// The capability is shared by every field that offers a mic (the chat, a villager's
// dialog), so whoever starts listening owns the words until it stops (`ui.dictOwner`).

import { toggleClass } from './dom.js';

export class FieldDictation {
  constructor(ui, { field, mic, owner, idleTitle = 'Speak', onEnd = null }) {
    this.ui = ui;
    this.field = field;
    this.mic = mic;
    this.owner = owner;
    this.idleTitle = idleTitle;
    this.onEnd = onEnd;
    this.dict = null;
    this.offs = [];
    this.state = 'idle';
    this.committed = '';
    this.partial = '';
    this.mic.hidden = true;
    this.mic.title = idleTitle;
    this.mic.addEventListener('click', () => this.toggle());
    // Typing while listening: what is in the field becomes the committed text.
    this.field.addEventListener('input', () => {
      if (this.state !== 'idle' && this.mine()) {
        this.committed = this.field.value;
        this.partial = '';
      }
    });
  }

  mine() {
    return this.ui.dictOwner === this.owner;
  }

  attach(dict) {
    if (this.dict === dict) return;
    this.detach();
    this.dict = dict || null;
    this.mic.hidden = !this.dict;
    if (!this.dict) return;
    try {
      this.offs.push(
        this.dict.onPartial((e) => {
          if (!this.mine()) return;
          this.partial = e?.text || '';
          this.show();
        }),
      );
      this.offs.push(
        this.dict.onFinal((e) => {
          if (!this.mine()) return;
          let t = e?.text || '';
          if (!this.committed) t = t.replace(/^\s+/, '');
          this.committed += t;
          this.partial = '';
          this.show();
        }),
      );
      this.offs.push(
        this.dict.onState((e) => {
          if (!this.mine()) return;
          this.state = e?.state || 'idle';
          toggleClass(this.mic, 'listening', this.state === 'listening' || this.state === 'starting');
          this.mic.title = this.state === 'idle' ? this.idleTitle : 'Stop listening';
          if (this.state === 'idle') {
            this.partial = '';
            this.show();
            this.ui.dictOwner = null;
            this.ended(e?.reason);
          }
        }),
      );
    } catch (err) {
      console.warn('[dictation] setup failed', err);
      this.mic.hidden = true;
    }
  }

  detach() {
    if (this.state !== 'idle' && this.mine()) this.stop();
    for (const off of this.offs) {
      try {
        off?.();
      } catch {
        /* ignore */
      }
    }
    this.offs = [];
    this.dict = null;
    this.state = 'idle';
    toggleClass(this.mic, 'listening', false);
  }

  show() {
    const sep = this.committed && this.partial && !/^\s/.test(this.partial) && !/\s$/.test(this.committed) ? ' ' : '';
    this.field.value = this.committed + sep + this.partial;
    toggleClass(this.field, 'provisional', !!this.partial);
  }

  active() {
    return this.state !== 'idle' && this.mine();
  }

  // Must run synchronously inside the click: start() needs the user's gesture.
  toggle() {
    const d = this.dict;
    if (!d) return;
    let on = false;
    try {
      on = d.active() && this.mine();
    } catch {
      on = this.active();
    }
    if (on) {
      this.stop();
      return;
    }
    this.ui.dictOwner = this.owner;
    this.committed = this.field.value;
    this.partial = '';
    let p;
    try {
      p = d.start();
    } catch (err) {
      this.failed(err);
      return;
    }
    Promise.resolve(p).then(
      () => {},
      (err) => this.failed(err),
    );
  }

  stop() {
    try {
      Promise.resolve(this.dict?.stop()).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  // Call after sending: the next words start a fresh line.
  reset() {
    if (this.active()) this.stop();
    this.committed = '';
    this.partial = '';
  }

  failed(err) {
    if (this.mine()) this.ui.dictOwner = null;
    const code = err?.code || 'upstream_error';
    const ui = this.ui;
    if (code === 'unavailable') {
      this.mic.hidden = true;
      ui.toast('Speaking is not available here. Typing still works.', 'info');
    } else if (code === 'not_granted') ui.toast('The microphone is off for this game. You can allow it in the page permissions.', 'warn');
    else if (code === 'rate_limited') ui.toast('The microphone is busy. Try again in a moment.', 'info');
    else if (code === 'no_gesture') ui.toast('Tap the microphone again to start speaking.', 'info');
    else if (code !== 'stopped' && code !== 'dismissed') ui.toast('Listening failed. Try again, or type instead.', 'warn');
  }

  ended(reason) {
    if (reason === 'unavailable') {
      this.mic.hidden = true;
      this.ui.toast('Speaking is not available here. Typing still works.', 'info');
    } else if (reason === 'time_limit') this.ui.toast('Listening stopped after a long while. Tap the mic to continue.', 'info');
    else if (reason === 'upstream_error') this.ui.toast('The microphone stopped unexpectedly.', 'warn');
    this.onEnd?.(reason);
  }
}
