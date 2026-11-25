// Access to claude.ai artifact runtime capabilities, null-safe everywhere.
//
// When the game is published as a claude.ai Artifact, `window.claude.use(name)`
// resolves capability namespaces:
//   sample    - ask Claude (Lyra's mind)            -> Claude.sample(input, options)
//   dictation - the player's speech as text          -> start(), stop(), onPartial, onFinal, onState
//   db        - cloud save under data/users/<id>/    -> doc(path).get()/set()
//   user      - who is playing (an opaque id)        -> id()
//   downloads - offer a file to save                 -> save({filename, data})
// Anywhere else (a self-hosted copy, a local file) there is no window.claude and
// every capability is null: the game must work without them.

const NAMES = ['sample', 'dictation', 'db', 'user', 'downloads'];

export class ClaudeRuntime {
  constructor() {
    this.hostPresent = typeof window !== 'undefined' && !!window.claude && typeof window.claude.use === 'function';
    this.caps = Object.fromEntries(NAMES.map((n) => [n, null]));
    this.disabled = new Set(); // capabilities switched off for this visit (see disable)
    this.resolved = false;
    this.listeners = new Set();
    this.ready = this.hostPresent ? this._init() : Promise.resolve(this);
    if (!this.hostPresent) this.resolved = true;
  }

  async _init() {
    await Promise.all(
      NAMES.map(async (name) => {
        let cap = null;
        try {
          cap = (await window.claude.use(name)) || null;
        } catch {
          cap = null;
        }
        // A capability disabled while it was still resolving stays off.
        this.caps[name] = this.disabled.has(name) ? null : cap;
        this._notify(name);
      }),
    );
    this.resolved = true;
    this._notify('*');
    return this;
  }

  // Called with (name) whenever a capability finishes resolving, and with '*' at the end.
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notify(name) {
    for (const fn of this.listeners) {
      try {
        fn(name);
      } catch (err) {
        console.error('[runtime] listener failed', err);
      }
    }
  }

  has(name) {
    return !!this.caps[name];
  }

  get sample() {
    return this.caps.sample;
  }
  get dictation() {
    return this.caps.dictation;
  }
  get db() {
    return this.caps.db;
  }
  get user() {
    return this.caps.user;
  }
  get downloads() {
    return this.caps.downloads;
  }

  // Mark a capability unusable for the rest of this visit (e.g. sample -> not_granted).
  disable(name) {
    this.disabled.add(name);
    this.caps[name] = null;
    this._notify(name);
  }

  isDisabled(name) {
    return this.disabled.has(name);
  }
}
