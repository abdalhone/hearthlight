// Lyra's plugin system. A plugin bundles one area of her abilities: state it keeps,
// events it reacts to, actions any brain (local or Claude) may call, local
// language intents, and context it adds to Claude's prompt. See DESIGN.md
// ("Plugins") for the full interface, and README.md for how to write one.
//
// Plugin shape (every member optional except id):
// {
//   id: 'relationships',
//   name: 'Relationships',
//   description: 'one line for the UI',
//   install(ctx)                       // once, after Lyra and her mind exist
//   onEvent(type, payload, ctx)        // every bus event
//   update(dt, ctx)                    // every simulation step (keep it cheap)
//   actions: { name: { description, params: {target, value, amount}, run(args, ctx) } }
//   intents: [{ id, patterns: [RegExp], action: 'name' | (match, text, ctx) => [{name, args}] , reply? }]
//   promptContext(ctx, query) -> string // a short section for Claude's prompt (or '')
//   serialize(ctx) -> json ; deserialize(data, ctx)
// }

export class PluginRegistry {
  constructor(game) {
    this.game = game;
    this.plugins = [];
    this.byId = new Map();
    this.installed = false;
    this._offBus = null;
  }

  // Context object handed to every plugin hook.
  get ctx() {
    const g = this.game;
    const companion = g.companion || null;
    return {
      game: g,
      bus: g.bus,
      companion,
      mind: companion?.mind || null,
      behavior: companion?.behavior || null,
      player: g.player || null,
      actions: g.actions,
      plugins: this,
    };
  }

  register(plugin) {
    if (!plugin?.id) throw new Error('plugin needs an id');
    if (this.byId.has(plugin.id)) return this.byId.get(plugin.id);
    this.plugins.push(plugin);
    this.byId.set(plugin.id, plugin);
    if (plugin.actions) {
      for (const [name, def] of Object.entries(plugin.actions)) this.game.actions.register(name, def, plugin.id);
    }
    if (this.installed) this._install(plugin);
    return plugin;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  all() {
    return this.plugins;
  }

  // Called by the game once Lyra (and her mind and behavior) exist.
  installAll() {
    this.installed = true;
    for (const p of this.plugins) this._install(p);
    this._offBus?.();
    this._offBus = this.game.bus.on('*', (type, payload) => this.onEvent(type, payload));
  }

  _install(p) {
    try {
      p.install?.(this.ctx);
    } catch (err) {
      console.error(`[plugins] install failed: ${p.id}`, err);
    }
  }

  onEvent(type, payload) {
    if (!this.installed) return;
    const ctx = this.ctx;
    for (const p of this.plugins) {
      if (!p.onEvent) continue;
      try {
        p.onEvent(type, payload, ctx);
      } catch (err) {
        console.error(`[plugins] ${p.id}.onEvent(${type}) failed`, err);
      }
    }
  }

  update(dt) {
    if (!this.installed) return;
    const ctx = this.ctx;
    for (const p of this.plugins) {
      if (!p.update) continue;
      try {
        p.update(dt, ctx);
      } catch (err) {
        console.error(`[plugins] ${p.id}.update failed`, err);
      }
    }
  }

  // All local-language intents, in registration order.
  intents() {
    const out = [];
    for (const p of this.plugins) for (const it of p.intents || []) out.push({ ...it, plugin: p.id });
    return out;
  }

  // Prompt sections for Claude: [{ id, title, text }].
  promptSections(query = '') {
    const ctx = this.ctx;
    const out = [];
    for (const p of this.plugins) {
      if (!p.promptContext) continue;
      try {
        const text = p.promptContext(ctx, query);
        if (text && String(text).trim()) out.push({ id: p.id, title: p.name || p.id, text: String(text).trim() });
      } catch (err) {
        console.error(`[plugins] ${p.id}.promptContext failed`, err);
      }
    }
    return out;
  }

  serialize() {
    const ctx = this.ctx;
    const out = {};
    for (const p of this.plugins) {
      if (!p.serialize) continue;
      try {
        out[p.id] = p.serialize(ctx);
      } catch (err) {
        console.error(`[plugins] ${p.id}.serialize failed`, err);
      }
    }
    return out;
  }

  deserialize(data) {
    if (!data) return;
    const ctx = this.ctx;
    for (const p of this.plugins) {
      if (!p.deserialize || data[p.id] === undefined) continue;
      try {
        p.deserialize(data[p.id], ctx);
      } catch (err) {
        console.error(`[plugins] ${p.id}.deserialize failed`, err);
      }
    }
  }
}
