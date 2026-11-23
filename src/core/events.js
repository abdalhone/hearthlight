// A tiny synchronous event bus. Payload shapes for every event type are listed
// in DESIGN.md ("Event bus"). Listeners must never throw; errors are caught and
// logged so one bad listener cannot stop the game loop.

export class EventBus {
  constructor() {
    this.listeners = new Map(); // type -> Set<fn>
    this.any = new Set(); // fn(type, payload)
    this.recent = []; // last N events, for debugging and perception catch-up
    this.maxRecent = 200;
  }

  on(type, fn) {
    if (type === '*') {
      this.any.add(fn);
      return () => this.any.delete(fn);
    }
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  once(type, fn) {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  emit(type, payload = {}) {
    this.recent.push({ type, payload });
    if (this.recent.length > this.maxRecent) this.recent.shift();
    const set = this.listeners.get(type);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[bus] listener for "${type}" failed`, err);
        }
      }
    }
    for (const fn of [...this.any]) {
      try {
        fn(type, payload);
      } catch (err) {
        console.error(`[bus] wildcard listener failed on "${type}"`, err);
      }
    }
  }

  clear() {
    this.listeners.clear();
    this.any.clear();
    this.recent.length = 0;
  }
}
