// Hearthvale's gossip (DESIGN §19.3, §19.7). A rumor is a clause a villager can drop into
// "Heard {rumor}." — written with placeholders so each teller says it their own way:
// {stranger} is the player as the teller names them, {lyra} is Lyra, {v} the victim.
// Rumors spread one listener at a time, and each retelling may grow a little.
//
// { id, about, kind, text (as the village tells it, ready to show), tpl (the clause with
//   placeholders), you, valence -1..1, severity 0..1, source, victim, t, day,
//   heardBy: [ids], versions: { id: tpl as that person heard it } }

import { rnd, thirdName, fill } from './lines.js';

const CAP = 40;

// What each notable event becomes. `you` is the same news said to the player's face.
export const RUMOR_KINDS = {
  downed_lyra: { text: '{stranger} knocked {lyra} senseless', you: 'you knocked Lyra senseless', valence: -1, severity: 1, victim: 'lyra' },
  hit_lyra: { text: '{stranger} struck {lyra} with a blade', you: 'you struck Lyra', valence: -0.85, severity: 0.85, victim: 'lyra' },
  abandoned_downed: { text: '{stranger} left {lyra} lying hurt in the dirt', you: 'you left Lyra lying hurt', valence: -0.7, severity: 0.7, victim: 'lyra' },
  downed_villager: { text: '{stranger} beat {v} senseless', you: 'you beat {v} senseless', valence: -1, severity: 0.95 },
  attacked_villager: { text: '{stranger} struck {v}', you: 'you struck {v}', valence: -0.75, severity: 0.7 },
  attacked_guard: { text: '{stranger} drew a blade on the watch', you: 'you drew on the watch', valence: -0.6, severity: 0.6 },
  stole: { text: '{stranger} has light fingers', you: 'you have light fingers', valence: -0.45, severity: 0.4 },
  killed_harmless: { text: '{stranger} kills harmless beasts for the fun of it', you: 'you kill harmless beasts for fun', valence: -0.25, severity: 0.2 },
  protected_lyra: { text: '{stranger} stood over {lyra} in a fight', you: 'you stood over Lyra in a fight', valence: 0.5, severity: 0.4, victim: 'lyra' },
  revived_lyra: { text: '{stranger} got {lyra} back on her feet when she went down', you: 'you got Lyra back on her feet', valence: 0.55, severity: 0.45, victim: 'lyra' },
  rescued: { text: '{stranger} pulled a {beast} off {v}', you: 'you pulled a {beast} off {v}', valence: 0.75, severity: 0.6 },
  helped_up: { text: '{stranger} helped {v} up when they were down', you: 'you helped {v} up', valence: 0.5, severity: 0.35 },
  gift: { text: '{stranger} brought {v} a present', you: 'you brought {v} a present', valence: 0.3, severity: 0.15 },
  kindness: { text: '{stranger} has a kind streak', you: 'you have a kind streak', valence: 0.3, severity: 0.2 },
  maren_asking: { text: '{stranger} has been asking after Maren', you: "you've been asking after Maren", valence: 0.1, severity: 0.2 },
  ruins_key: { text: '{stranger} has the key to the ruins gate', you: 'you have the ruins key', valence: 0.15, severity: 0.5 },
  lyra_left: { text: "{lyra} isn't travelling with {stranger} any more", you: "Lyra's not travelling with you any more", valence: -0.25, severity: 0.5, about: 'lyra' },
  lyra_gone: { text: "{lyra} won't have {stranger} near her now", you: "Lyra won't have you near her", valence: -0.6, severity: 0.8, about: 'lyra' },
  lyra_kettle: { text: "{lyra}'s taken her old room at the Kettle again", you: "Lyra's back in her old room at the Kettle", valence: -0.1, severity: 0.3, about: 'lyra' },
  lyra_back: { text: "{lyra}'s back on the road with {stranger}", you: "Lyra's back on the road with you", valence: 0.25, severity: 0.3, about: 'lyra' },
  threat: { text: '{stranger} threatened {v}', you: 'you threatened {v}', valence: -0.55, severity: 0.55 },
  apology: { text: '{stranger} said sorry to {v}, and meant it, by the look of it', you: 'you said sorry to {v}', valence: 0.3, severity: 0.25 },
  // Errands and the missing (DESIGN §28, village_life): news about villagers, not the player.
  asking_after: { text: 'nobody can find {v}', you: 'nobody can find {v}', valence: -0.2, severity: 0.45, about: 'village' },
  missing: { text: '{v} has gone missing, and nobody knows why', you: '{v} has gone missing', valence: -0.35, severity: 0.8, about: 'village' },
  found_safe: { text: '{v} has turned up safe', you: '{v} has turned up safe', valence: 0.35, severity: 0.6, about: 'village' },
  found_dead: { text: '{v} was found dead', you: '{v} was found dead', valence: -1, severity: 1, about: 'village' },
  lied_about: { text: '{stranger} lied about {v}', you: 'you lied about {v}', valence: -0.5, severity: 0.55 },
};

// Retellings grow. Each rule: a pattern on the clause and what it may become.
const GROWTH = [
  [/\bstruck \{lyra\} with a blade\b/, ['went at {lyra} with a blade', 'cut {lyra}']],
  [/\bstruck \{v\}/, ['laid into {v}', 'went for {v}']],
  [/\bknocked \{lyra\} senseless\b/, ['near killed {lyra}', 'beat {lyra} black and blue']],
  [/\bbeat \{v\} senseless\b/, ['near killed {v}', 'beat {v} half to death']],
  [/\bpulled a \{beast\} off\b/, ['pulled a great big {beast} off', 'fought a {beast} off']],
  [/\bstood over \{lyra\} in a fight\b/, ['fought off a whole pack for {lyra}', 'saved {lyra} in a fight']],
  [/\bgot \{lyra\} back on her feet when she went down\b/, ['carried {lyra} out of a fight', "saved {lyra}'s life"]],
  [/\bbrought \{v\} a present\b/, ['is courting {v} with presents', 'brought {v} something lovely']],
  [/\bhas light fingers\b/, ['is a thief', 'robs people blind']],
  [/\bhas a kind streak\b/, ['has a heart of gold', 'is kinder than they look']],
  [/\bhas been asking after Maren\b/, ['is hunting for Maren', 'knows something about Maren']],
  [/\bisn't travelling with \{stranger\} any more\b/, ['has had it with {stranger}', 'walked out on {stranger}']],
  [/\bhelped \{v\} up when they were down\b/, ['carried {v} home', 'saved {v}']],
  [/\bhas gone missing, and nobody knows why\b/, ['has vanished clean away', 'has gone missing, and nobody can say where']],
];

export function distort(text, rng) {
  const rules = GROWTH.filter(([re]) => re.test(text));
  if (!rules.length) return text;
  const [re, outs] = rules[Math.floor(rnd(rng) * rules.length)];
  return text.replace(re, outs[Math.floor(rnd(rng) * outs.length)]);
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Rumors {
  constructor() {
    this.list = [];
    this.seq = 0;
  }

  get(id) {
    return this.list.find((r) => r.id === id) || null;
  }

  // Add news (or freshen the same news from today). Returns the rumor.
  add({ kind, about = 'player', text = null, you = null, valence = null, severity = null, source = 'village', victim = null, beast = null, t = 0, day = 1, heardBy = [], saw = [] }) {
    const def = RUMOR_KINDS[kind] || {};
    const same = this.list.find((r) => r.kind === kind && r.victim === (victim || def.victim || null) && r.day === day && kind in RUMOR_KINDS);
    if (same) {
      for (const id of heardBy) if (id && !same.heardBy.includes(id)) same.heardBy.push(id);
      for (const id of saw) if (id && !same.saw.includes(id)) same.saw.push(id);
      same.t = t;
      return same;
    }
    const tpl = String(text || def.text || '').slice(0, 200);
    const r = {
      id: `r${++this.seq}`,
      about: def.about || about,
      kind: kind || 'news',
      tpl,
      text: '',
      you: String(you || def.you || '').slice(0, 200) || null,
      valence: clamp(Number(valence ?? def.valence ?? 0) || 0, -1, 1),
      severity: clamp(Number(severity ?? def.severity ?? 0.3) || 0, 0, 1),
      source,
      victim: victim || def.victim || null,
      beast: beast || null,
      t,
      day,
      heardBy: [...new Set(heardBy.filter(Boolean))],
      saw: [...new Set(saw.filter(Boolean))], // eyewitnesses
      versions: {},
    };
    if (!r.tpl) return null;
    r.text = fillClause(r.tpl, 'narrator', r, 'the stranger') || r.tpl.replace(/\{\w+\}/g, 'someone');
    this.list.push(r);
    this.trim();
    return r;
  }

  trim() {
    if (this.list.length <= CAP) return;
    // Old, mild news goes first; grave news lingers.
    this.list.sort((a, b) => b.severity * 2 + b.t / 9000 - (a.severity * 2 + a.t / 9000));
    this.list.length = CAP;
    this.list.sort((a, b) => a.t - b.t);
  }

  knows(rumor, id) {
    return !!rumor && rumor.heardBy.includes(id);
  }

  carriedBy(id) {
    return this.list.filter((r) => r.heardBy.includes(id));
  }

  // News the teller could pass to the listener, most telling first.
  tellable(tellerId, listenerId, nowT = 0) {
    const out = [];
    for (const r of this.list) {
      if (!r.heardBy.includes(tellerId) || r.heardBy.includes(listenerId)) continue;
      if (r.victim === listenerId) continue; // nobody tells you what happened to you
      if (tellerId === 'lyra' && r.about === 'lyra') continue; // she doesn't gossip about her own choices
      if (r.about === 'village' && r.victim && !this.current(r, tellerId, listenerId)) continue;
      const age = Math.max(0, nowT - r.t) / 900; // days
      const score = r.severity * 2 + Math.abs(r.valence) - age * 0.6;
      if (score <= -0.5) continue;
      out.push([score, r]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out.map((x) => x[1]);
  }

  // News about a villager (missing, found…) is worth passing on only while it is the latest
  // about them, never by the person it is about, and good news only to those who heard
  // the bad ("Garrick's turned up" means nothing to someone who never knew he was lost).
  current(r, tellerId, listenerId) {
    if (r.victim === tellerId) return false;
    let heardTrouble = r.kind !== 'found_safe';
    for (const o of this.list) {
      if (o === r || o.about !== 'village' || o.victim !== r.victim) continue;
      if (o.t > r.t) return false;
      if (!heardTrouble && o.kind !== 'found_safe' && o.heardBy.includes(listenerId)) heardTrouble = true;
    }
    return heardTrouble;
  }

  // The teller's own version of the clause (still with placeholders).
  versionOf(rumor, id) {
    return rumor.versions[id] || rumor.tpl;
  }

  // The listener hears it from the teller; the story may grow on the way.
  hear(rumor, listenerId, tellerId, rng) {
    if (!rumor || !listenerId) return null;
    const told = this.versionOf(rumor, tellerId);
    let heard = told;
    const grown = told !== rumor.tpl;
    if (!grown && rnd(rng) < 0.3) heard = distort(told, rng);
    if (heard !== rumor.tpl) rumor.versions[listenerId] = heard;
    if (!rumor.heardBy.includes(listenerId)) rumor.heardBy.push(listenerId);
    return heard;
  }

  // The clause in a speaker's mouth.
  render(rumor, speakerId, { stranger = 'the stranger', version = null } = {}) {
    const clause = version || this.versionOf(rumor, speakerId);
    return fillClause(clause, speakerId, rumor, stranger);
  }

  // Said to the player: "you struck Bram".
  renderYou(rumor, speakerId) {
    if (!rumor.you) return null;
    return fillClause(rumor.you, speakerId, rumor, 'you');
  }

  // Fresh, grave news about the player that a villager carries.
  freshAgainstPlayer(id, nowT, days = 2) {
    let best = null;
    for (const r of this.list) {
      if (r.valence >= 0 || !r.heardBy.includes(id)) continue;
      if (r.about !== 'player' && r.kind !== 'lyra_gone') continue;
      if (nowT - r.t > days * 900) continue;
      if (!best || r.severity > best.severity || (r.severity === best.severity && r.t > best.t)) best = r;
    }
    return best;
  }

  serialize() {
    return {
      seq: this.seq,
      list: this.list.map((r) => {
        const o = { id: r.id, about: r.about, kind: r.kind, tpl: r.tpl, text: r.text, valence: r.valence, severity: r.severity, source: r.source, t: Math.round(r.t), day: r.day, heardBy: r.heardBy };
        if (r.you) o.you = r.you;
        if (r.victim) o.victim = r.victim;
        if (r.beast) o.beast = r.beast;
        if (Object.keys(r.versions).length) o.versions = r.versions;
        if (r.saw?.length) o.saw = r.saw;
        return o;
      }),
    };
  }

  deserialize(d) {
    this.list = [];
    if (!d || !Array.isArray(d.list)) return;
    this.seq = Number.isFinite(d.seq) ? d.seq : 0;
    for (const r of d.list) {
      if (!r || typeof r !== 'object') continue;
      const tpl = typeof r.tpl === 'string' && r.tpl ? r.tpl : typeof r.text === 'string' ? r.text : '';
      if (!tpl) continue;
      this.list.push({
        id: String(r.id || `r${++this.seq}`),
        about: r.about || 'player',
        kind: String(r.kind || 'news'),
        tpl: tpl.slice(0, 200),
        text: typeof r.text === 'string' && r.text ? r.text.slice(0, 220) : tpl.replace(/\{\w+\}/g, 'someone'),
        you: typeof r.you === 'string' ? r.you.slice(0, 200) : null,
        valence: clamp(Number(r.valence) || 0, -1, 1),
        severity: clamp(Number(r.severity) || 0, 0, 1),
        source: r.source || 'village',
        victim: r.victim || null,
        beast: r.beast || null,
        t: Number(r.t) || 0,
        day: Number(r.day) || 1,
        heardBy: Array.isArray(r.heardBy) ? r.heardBy.filter((x) => typeof x === 'string').slice(0, 24) : [],
        saw: Array.isArray(r.saw) ? r.saw.filter((x) => typeof x === 'string').slice(0, 24) : [],
        versions: r.versions && typeof r.versions === 'object' ? Object.fromEntries(Object.entries(r.versions).filter(([k, v]) => typeof v === 'string').slice(0, 24)) : {},
      });
    }
    this.trim();
  }
}

// Lyra telling what happened to her, in her own words.
const LYRA_SAYS = {
  revived_lyra: '{stranger} got me back on my feet when I went down',
  hit_lyra: '{stranger} struck me with a blade',
  downed_lyra: '{stranger} knocked me senseless',
  abandoned_downed: '{stranger} left me lying hurt in the dirt',
  protected_lyra: '{stranger} stood over me in a fight',
};

function fillClause(clause, speakerId, rumor, stranger) {
  if (speakerId === 'lyra' && LYRA_SAYS[rumor.kind] && clause !== rumor.you) clause = LYRA_SAYS[rumor.kind];
  const vars = {
    stranger,
    lyra: speakerId === 'lyra' ? 'me' : thirdName(speakerId, 'lyra'),
    v: rumor.victim ? (rumor.victim === speakerId ? 'me' : thirdName(speakerId, rumor.victim)) : 'someone',
    beast: rumor.beast || 'wolf',
  };
  let s = String(clause).replace(/\{(stranger|lyra|v|beast)\}/g, (m, k) => vars[k]);
  // Keep the clause lower-case: it is dropped into the middle of a sentence.
  if (/^[A-Z][a-z]/.test(s) && !/^(Lyra|Star|Hobb|Wenna|Elda|Bram|Pip|Rowan|Mira|Tobias|Aveline|Garrick|Hess|Sabeth|Alder|Petra|Tilly|Tansy|Corran|Wys|Maren|Mister|Gran|Da|Mother|Ottilie|I)\b/.test(s)) s = s.charAt(0).toLowerCase() + s.slice(1);
  return fill(s, {}) ? s : null;
}
