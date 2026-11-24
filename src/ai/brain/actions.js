// The one door through which anything changes what Lyra does. Plugins register
// actions; the local brain, Claude, the HUD command bar and Lyra's own autonomy all
// call ActionRegistry.run(). Every action takes the same flat argument shape so a
// language model can fill it reliably:
//
//   { target: string|null, value: string|null, amount: number|null }
//
// Each action documents what target/value/amount mean for it (see DESIGN.md,
// "Action catalogue"). run() returns { ok: boolean, message: string }.

export function normalizeArgs(args) {
  const a = args && typeof args === 'object' ? args : {};
  const str = (v) => (v == null || v === '' ? null : String(v).slice(0, 400));
  let amount = a.amount;
  if (typeof amount === 'string') amount = parseFloat(amount);
  if (!Number.isFinite(amount)) amount = null;
  return { target: str(a.target), value: str(a.value), amount };
}

export class ActionRegistry {
  constructor(game) {
    this.game = game;
    this.defs = new Map(); // name -> { name, description, params, run, plugin }
    this.history = []; // last actions, newest last: { name, args, source, ok, message, t }
  }

  register(name, def, pluginId = 'core') {
    if (!def || typeof def.run !== 'function') throw new Error(`action ${name} needs run()`);
    this.defs.set(name, {
      name,
      description: def.description || '',
      params: def.params || {},
      run: def.run,
      plugin: pluginId,
      hidden: !!def.hidden, // hidden actions are not offered to Claude
      ungated: !!def.ungated, // true for things that are not requests of her (e.g. remember, express)
    });
  }

  has(name) {
    return this.defs.has(name);
  }

  get(name) {
    return this.defs.get(name) || null;
  }

  list({ includeHidden = false } = {}) {
    return [...this.defs.values()].filter((d) => includeHidden || !d.hidden);
  }

  names() {
    return this.list().map((d) => d.name);
  }

  // Lyra decides for herself. Anything the PLAYER asks of her (source 'player') passes
  // this gate first; the mind installs it (see DESIGN.md §16). gate(name, args, source) ->
  // null to allow, or a verdict { decision, reasons, message, condition, counter }.
  setConsentGate(fn) {
    this.consentGate = typeof fn === 'function' ? fn : null;
  }

  // source: 'player'  - the player asked (HUD, hotkeys, or a command parsed from their message): gated
  //         'claude'  - Lyra's own decision, reached through Claude: not gated
  //         'self'    - Lyra's own autonomy (her plans, fear, self-preservation): not gated
  //         'local'   - internal/offline effects that are not requests: not gated
  run(name, args = {}, source = 'local') {
    const def = this.defs.get(name);
    const norm = normalizeArgs(args);
    let result;
    let verdict = null;
    if (def && source === 'player' && this.consentGate && !def.ungated) {
      try {
        verdict = this.consentGate(name, norm, source) || null;
      } catch (err) {
        console.error('[actions] consent gate failed', err);
        verdict = null;
      }
    }
    if (!def) {
      result = { ok: false, message: `I don't know how to "${name}".` };
    } else if (verdict && verdict.decision !== 'accept' && verdict.decision !== 'accept_conditional') {
      result = { ok: false, refused: true, verdict, message: verdict.message || '' };
    } else {
      try {
        const ctx = this.game.plugins.ctx;
        result = def.run(norm, ctx) || { ok: true, message: '' };
        if (typeof result !== 'object') result = { ok: !!result, message: '' };
      } catch (err) {
        console.error(`[actions] ${name} failed`, err);
        result = { ok: false, message: `Something went wrong doing "${name}".` };
      }
    }
    if (verdict && result.verdict === undefined) result.verdict = verdict;
    const entry = {
      name,
      args: norm,
      source,
      ok: !!result.ok,
      refused: !!result.refused,
      decision: verdict?.decision || null,
      message: result.message || '',
      t: this.game.clock?.t ?? 0,
    };
    this.history.push(entry);
    if (this.history.length > 60) this.history.shift();
    this.game.bus.emit('companion_action', entry);
    return result;
  }

  // Run a list of {name, args} in order; returns results.
  runAll(list, source = 'local') {
    const out = [];
    for (const item of list || []) {
      if (!item || !item.name) continue;
      out.push({ name: item.name, ...this.run(item.name, item.args || item, source) });
    }
    return out;
  }

  // The catalogue text Claude reads: one action per line.
  catalogText() {
    const lines = [];
    for (const d of this.list()) {
      const p = Object.entries(d.params || {})
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');
      lines.push(`- ${d.name}: ${d.description}${p ? ` (${p})` : ''}`);
    }
    return lines.join('\n');
  }
}
