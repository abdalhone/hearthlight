// The two ways Lyra's mind can reach Claude, behind one interface:
//
//   provider.complete({ rules, task, schema, tier, signal }) -> parsed JSON (any shape)
//   provider.available() -> bool
//
// Every failure becomes a BrainError with a stable `code`, so the brain decides what
// to do from the code alone (DESIGN §13). Neither provider ever retries by itself.

import { DEFAULT_SETTINGS } from '../../core/settings.js';
import { extractJson } from './claude_brain.js';

export const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.39.0/+esm';

export const PROVIDER_LABELS = {
  'claude.ai': 'Claude (claude.ai)',
  api: 'Claude (your API key)',
  local: "Lyra's own instincts (offline)",
};

// sample codes that mean "this view can never use Claude": hide it for the visit.
export const PERMANENT_CODES = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'not_available']);

export class BrainError extends Error {
  constructor(code, message = '', { text = null, status = null } = {}) {
    super(message || code);
    this.name = 'BrainError';
    this.code = code || 'upstream_error';
    this.text = text;
    this.status = status;
  }

  get permanent() {
    return PERMANENT_CODES.has(this.code);
  }
}

const KNOWN_SAMPLE_CODES = new Set([
  'invalid_request', 'prompt_too_large', 'images_unavailable', 'tools_unavailable', 'image_rejected', 'cancelled', 'not_granted',
  'session_expired', 'sampling_disabled', 'not_declared', 'rate_limited', 'refused', 'empty_completion', 'invalid_json',
  'upstream_error', 'capability_disabled', 'capability_removed', 'transform_error', 'queue_overflow',
]);

// A rejected sample call is a plain {code, message, text?} object, never an Error.
export function toBrainError(e) {
  if (e instanceof BrainError) return e;
  const code = e && typeof e === 'object' && typeof e.code === 'string' ? e.code : null;
  const known = code && KNOWN_SAMPLE_CODES.has(code) ? code : 'upstream_error';
  return new BrainError(known, (e && e.message) || String(e || 'unknown error'), { text: typeof e?.text === 'string' ? e.text : null });
}

// ------------------------------------------------------------- claude.ai

export class ClaudeAiProvider {
  constructor(runtime) {
    this.runtime = runtime;
    this.id = 'claude.ai';
    this.label = PROVIDER_LABELS['claude.ai'];
    this.disabled = false;
    this.toolsOff = false; // the view rejected page tools once: plain calls from now on
    this._limits = undefined; // sample.limits() result, resolved once per view
    this._limitsFor = null;
  }

  available() {
    return !this.disabled && !!this.runtime?.sample;
  }

  // Can this view run page tools (DESIGN §17.3)? Cheap and local; asks the viewer nothing.
  async toolLimit() {
    const sample = this.runtime?.sample;
    if (!sample || this.toolsOff || typeof sample.limits !== 'function') return 0;
    if (this._limitsFor !== sample) {
      this._limitsFor = sample;
      this._limits = undefined;
    }
    if (this._limits === undefined) {
      try {
        this._limits = (await sample.limits()) || null;
      } catch {
        this._limits = null;
      }
    }
    const t = this._limits?.tools;
    if (!t) return 0;
    return Number.isFinite(t.maxCount) ? Math.max(0, t.maxCount) : 3;
  }

  // No system prompt on claude.ai: the stable rules go first in the one prompt string.
  // tools: SampleTool[] (read-only page functions) or null.
  async complete({ rules, task, tier = 'quick', signal, tools = null } = {}) {
    const sample = this.runtime?.sample;
    if (!sample) throw new BrainError('not_available', 'sample capability is not available');
    const prompt = `${rules}\n\n${task}`;
    const options = { modelTier: tier === 'default' || tier === 'complex' ? tier : 'quick', cache: false };
    if (signal) options.signal = signal;
    const withTools = Array.isArray(tools) && tools.length && !this.toolsOff;
    if (withTools) options.tools = tools;
    try {
      return await this._call(sample, prompt, options);
    } catch (e) {
      const err = toBrainError(e);
      if (err.code === 'tools_unavailable' && withTools) {
        // Hide the tools for this view and answer this one message without them (once).
        this.toolsOff = true;
        delete options.tools;
        try {
          return await this._call(sample, prompt, options);
        } catch (e2) {
          const err2 = toBrainError(e2);
          if (err2.permanent) this.disable();
          throw err2;
        }
      }
      if (err.permanent) this.disable();
      throw err;
    }
  }

  async _call(sample, prompt, options) {
    if (typeof sample.json === 'function') return await sample.json(prompt, options);
    const res = await sample(prompt, options);
    const data = extractJson(res?.text);
    if (data == null) throw new BrainError('invalid_json', 'reply was not JSON', { text: res?.text ?? '' });
    return data;
  }

  disable() {
    if (this.disabled) return;
    this.disabled = true;
    try {
      this.runtime?.disable?.('sample');
    } catch {
      /* ignore */
    }
  }
}

// --------------------------------------------------------------- API key

// Never let the key appear in anything we log or show.
export function scrub(text, key) {
  let s = String(text ?? '');
  if (key && key.length > 6) s = s.split(key).join('[key]');
  return s.replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, '[key]');
}

export function classifyApiError(e, SDK, key = '') {
  if (e instanceof BrainError) return e;
  const is = (cls) => typeof cls === 'function' && e instanceof cls;
  const status = Number.isFinite(e?.status) ? e.status : null;
  const msg = scrub(e?.message || String(e), key);
  if (e?.name === 'AbortError' || is(SDK?.APIUserAbortError)) return new BrainError('cancelled', msg, { status });
  if (is(SDK?.AuthenticationError) || status === 401) return new BrainError('auth', 'The API key was rejected.', { status });
  if (is(SDK?.PermissionDeniedError) || status === 403) return new BrainError('auth', 'The API key is not allowed to use this model.', { status });
  if (is(SDK?.RateLimitError) || status === 429) return new BrainError('rate_limited', msg, { status });
  if (is(SDK?.APIConnectionError) || (!status && /fetch|network|connect|timed? ?out/i.test(msg))) return new BrainError('connection', msg, { status });
  if (is(SDK?.NotFoundError) || status === 404) return new BrainError('invalid_request', 'That model name was not found.', { status });
  if (is(SDK?.BadRequestError) || status === 400) return new BrainError('invalid_request', msg, { status });
  if (is(SDK?.APIError) || status) return new BrainError('upstream_error', msg, { status });
  return new BrainError('upstream_error', msg, { status });
}

// esbuild leaves import() of a variable alone, so the SDK is fetched at run time only.
function defaultLoadSdk(url) {
  return import(/* @vite-ignore */ url);
}

export class ApiKeyProvider {
  constructor(game, { loadSdk = defaultLoadSdk } = {}) {
    this.game = game;
    this.id = 'api';
    this.label = PROVIDER_LABELS.api;
    this.loadSdk = loadSdk;
    this._sdkPromise = null;
    this._sdk = null;
    this._client = null;
    this._clientKey = null;
    this.rejectedKey = null; // a key the API refused; unusable until it changes
  }

  key() {
    return String(this.game?.apiKey || '').trim();
  }

  available() {
    const k = this.key();
    if (!k || k === this.rejectedKey) return false;
    // A claude.ai-hosted page has no outbound network.
    if (this.game?.runtime?.hostPresent) return false;
    return true;
  }

  // Page tools are a claude.ai capability; this path sends the pre-selected context only.
  async toolLimit() {
    return 0;
  }

  model() {
    return String(this.game?.settings?.apiModel || DEFAULT_SETTINGS.apiModel).trim() || DEFAULT_SETTINGS.apiModel;
  }

  // -> { Anthropic, errors } with the SDK's typed error classes (static on the class
  // in current releases, named exports in others).
  async sdk() {
    if (this._sdk) return this._sdk;
    if (!this._sdkPromise) {
      const url = SDK_URL;
      this._sdkPromise = Promise.resolve()
        .then(() => this.loadSdk(url))
        .catch((err) => {
          this._sdkPromise = null;
          throw new BrainError('connection', `Could not load the Claude library (${scrub(err?.message || err)})`);
        });
    }
    const mod = await this._sdkPromise;
    const Anthropic = typeof mod?.default === 'function' ? mod.default : typeof mod?.Anthropic === 'function' ? mod.Anthropic : typeof mod === 'function' ? mod : null;
    if (!Anthropic) {
      this._sdkPromise = null;
      throw new BrainError('connection', 'The Claude library did not load correctly.');
    }
    const errors = {};
    for (const n of ['APIError', 'APIUserAbortError', 'APIConnectionError', 'AuthenticationError', 'PermissionDeniedError', 'RateLimitError', 'NotFoundError', 'BadRequestError']) {
      errors[n] = Anthropic[n] || mod?.[n] || null;
    }
    this._sdk = { Anthropic, errors };
    return this._sdk;
  }

  async client() {
    const key = this.key();
    if (!key) throw new BrainError('auth', 'No API key is set.');
    const { Anthropic, errors } = await this.sdk();
    if (!this._client || this._clientKey !== key) {
      this._client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
      this._clientKey = key;
    }
    return { client: this._client, SDK: errors };
  }

  async complete({ rules, task, schema, signal, maxTokens = 2048 } = {}) {
    const key = this.key();
    const { client, SDK } = await this.client();
    // Use the standard messages API with a tool so the response is always valid JSON
    // regardless of model tier or beta access – no beta headers needed.
    const tool = schema
      ? { name: 'reply', description: 'Structured reply', input_schema: schema }
      : { name: 'reply', description: 'Structured reply', input_schema: { type: 'object' } };
    let resp;
    try {
      resp = await client.messages.create(
        {
          model: this.model(),
          max_tokens: maxTokens,
          system: rules,
          messages: [{ role: 'user', content: task }],
          tools: [tool],
          tool_choice: { type: 'tool', name: 'reply' },
        },
        signal ? { signal } : undefined,
      );
    } catch (e) {
      // "model output must contain either output text or tool calls … cannot both be empty"
      // is a transient API-side constraint; fall through to plain-text mode instead of failing.
      const isEmptyOutput = e && typeof e.message === 'string' && /output.*empty|cannot both be empty/i.test(e.message);
      if (!isEmptyOutput) {
        const err = classifyApiError(e, SDK, key);
        if (err.code === 'auth') this.rejectedKey = key;
        throw err;
      }
      // Retry without forced tool_choice so the model can produce a text response.
      try {
        resp = await client.messages.create(
          { model: this.model(), max_tokens: maxTokens, system: rules, messages: [{ role: 'user', content: task }] },
          signal ? { signal } : undefined,
        );
      } catch (e2) {
        const err2 = classifyApiError(e2, SDK, key);
        if (err2.code === 'auth') this.rejectedKey = key;
        throw err2;
      }
    }
    if (resp?.stop_reason === 'refusal') throw new BrainError('refused', 'declined');
    // Prefer tool_use block (parsed JSON already); fall back to text + extractJson.
    const toolBlock = Array.isArray(resp?.content)
      ? resp.content.find((b) => b && b.type === 'tool_use' && b.name === 'reply')
      : null;
    if (toolBlock?.input != null) return toolBlock.input;
    const textBlock = Array.isArray(resp?.content) ? resp.content.find((b) => b && b.type === 'text') : null;
    const text = textBlock?.text ?? '';
    if (!text.trim()) throw new BrainError('empty_completion', 'no text in reply');
    try {
      return JSON.parse(text);
    } catch {
      const data = extractJson(text);
      if (data != null) return data;
      throw new BrainError('invalid_json', 'reply was not JSON', { text });
    }
  }
}

// ------------------------------------------------------------- selection

const PREFS = {
  auto: 'auto',
  claude: 'claude',
  'claude.ai': 'claude',
  sample: 'claude',
  apikey: 'apikey',
  api: 'apikey',
  key: 'apikey',
  local: 'local',
  offline: 'local',
};

// Which provider id serves a preference, given what is available right now.
export function chooseProvider(pref, { claudeAi = false, api = false } = {}) {
  const p = PREFS[String(pref || 'auto').toLowerCase()] || 'auto';
  if (p === 'local') return 'local';
  if (p === 'claude') return claudeAi ? 'claude.ai' : 'local';
  if (p === 'apikey') return api ? 'api' : 'local';
  if (claudeAi) return 'claude.ai';
  if (api) return 'api';
  return 'local';
}

export class ProviderSet {
  constructor(game, opts = {}) {
    this.game = game;
    this.claudeAi = new ClaudeAiProvider(game?.runtime);
    this.api = new ApiKeyProvider(game, opts);
  }

  currentId() {
    return chooseProvider(this.game?.settings?.brain, { claudeAi: this.claudeAi.available(), api: this.api.available() });
  }

  current() {
    const id = this.currentId();
    return id === 'claude.ai' ? this.claudeAi : id === 'api' ? this.api : null;
  }

  label(id = this.currentId()) {
    return PROVIDER_LABELS[id] || PROVIDER_LABELS.local;
  }
}
