// Lyra and the Weave (DESIGN §22.3, LORE §13): she notices what the stranger weaves,
// comments on each new essence the first time she sees it (warm curiosity, and worry
// about dark, which feels to her like the ruins' gravelight), and remembers it. She
// speaks only when she is near, awake, with the player and not in a fight.

import { nonRaw, weaveOf } from './tracker.js';

const SIGHT = 170;

// Her first words on seeing each essence in the stranger's hands.
export const ESSENCE_LINES = {
  light: ['Light. Now you\'re poaching on my trade.', "That's lamp-light. Mine costs me warmth. Yours costs you... what, exactly?"],
  iron: ['Iron in it. It rings. Bram would grunt at that, and mean it kindly.'],
  nature: ['Green. It smells like Mira\'s shop. Like summer in a jar.'],
  song: ['That hums. Like the well does. Don\'t look at me like that, the well hums.'],
  frost: ['Cold. Off the lake, I\'d bet. I don\'t like it, and I like that I don\'t like it.'],
  storm: ['Glimmer, crackling in your hands. The dogs are going to howl at you now.'],
  earth: ['Stone. Heavy. You throw it like it weighs nothing. It doesn\'t weigh nothing.'],
  fire: ['Fire that doesn\'t go out. Keep it off the thatch, please. All the thatch.'],
  wind: ['Wind off the Crownfells. I\'ve been cold in that wind. You\'re holding it.'],
  water: ['Water. Moving. I\'ll stand over here, thanks. Nowhere near it.'],
  poison: ['That\'s what the slime-pools leave on a blade. Careful where it lands.'],
  dark: [
    "That one's cold. It feels like the ruins at night. Gravelight. Where did you get it?",
    "I don't like that one. It isn't yours. It feels borrowed, and the ruins want things back.",
  ],
};

// A few shapes she has something to say about the first time.
export const SHAPE_LINES = {
  beam: ['You held it. You just... held it.'],
  nova: ['A ring. The Stillring is a ring too. Mine stops people. Yours does not.'],
  summon: ['It has a tail. Pip is going to name it. You know that.'],
  wall: ['Here, and not past here. Maren would have liked you.'],
  rune: ['A mark that waits. Ward-chalk with teeth.'],
  rain: ['Brightfall. Out of your hands. Wicks and ashes.'],
  bind: ["That's mine. The Stillring. ...Yours is brighter. I'm not jealous. I'm a little jealous."],
  ward: ['A ward round you, like a cloak. Maren drew them round villages. You draw them round people.'],
};

// DESIGN §22.5: the Stillring closed on her, or on one of her people, is an attack, and
// she says so (combat and her autonomy weigh the blow itself); a ward raised round her
// when she is in danger is care, and she says that too.
export const BIND_LINES = {
  lyra: ['You put the Stillring on me. On me.', "That's for stopping people who mean harm. What did I ever mean you?"],
  parent: ["Let go of them. That's my family.", 'Not them. Never them. Let them go.'],
  villager: ["Let them go. That's not what it's for.", "That ring is for stopping harm, not for doing it. Let them go."],
};
export const WARD_LINES = {
  danger: ['...For me? It hums. Thank you.', "Oh. That's warm. Thank you. Now hit something."],
  calm: ["You don't have to shield me. ...It's nice, though.", "I'm not made of glass. But thank you."],
};
const PARENTS = new Set(['hobb', 'wenna']);

export class LyraWatch {
  constructor(game, missions) {
    this.game = game;
    this.missions = missions;
    this.reset();
  }

  reset() {
    this.seenEssences = [];
    this.seenShapes = [];
    this.firstSeen = false;
    this.weaves = 0;
  }

  lyra() {
    return this.game.companion || null;
  }

  // Can she see the player right now, and is she free to speak about it?
  sees() {
    const g = this.game;
    const l = this.lyra();
    const p = g.player;
    if (!l || !p || l.removed || l.downed || l.state === 'sleep') return false;
    const cs = l.mind?.companionship || 'together';
    if (cs === 'gone' || g.flags?.lyra_gone) return false;
    return Math.hypot(l.x - p.x, l.y - p.y) <= SIGHT;
  }

  onEvent(type, p) {
    if (type === 'spell_cast' && p && (p.caster === this.game.player || p.caster?.id === 'player')) this.onWeave(p);
    else if (type === 'magic_unlocked' && p?.kind === 'essence') this.onUnlock(p);
    else if (type === 'bind' && p && this.isPlayer(p.source)) this.onBind(p);
    else if (type === 'ward' && p && this.isPlayer(p.caster)) this.onWard(p);
  }

  isPlayer(a) {
    return !!a && (a === this.game.player || a.id === 'player');
  }

  // The stranger closed a Stillring on her, or on one of her people.
  onBind(p) {
    const l = this.lyra();
    const t = p.target;
    if (!l || !t) return;
    const now = this.missions?.playT ?? 0;
    const mind = l.mind;
    if (t === l) {
      if (now - (this.boundAt ?? -99) < 20) return;
      this.boundAt = now;
      this.comment(BIND_LINES.lyra);
      safe(() => mind?.appraise?.('betrayal', 1.2, 'the stranger closed the Stillring on me'));
      safe(() =>
        mind?.remember?.('The stranger closed the Stillring on me. Maren\'s working, the one I taught them, on me.', {
          importance: 8,
          about: ['player'],
          tags: ['binding_light', 'betrayal', 'weave'],
          emotion: 'anger',
          gist: 'the stranger bound me',
        }),
      );
      return;
    }
    const villager = !!(t.profile || this.game.combat?.isLawful?.(t));
    if (!villager || !this.sees()) return;
    if (now - (this.boundVillagerAt ?? -99) < 15) return;
    this.boundVillagerAt = now;
    const id = t.id || t.profile?.id;
    this.comment(PARENTS.has(id) ? BIND_LINES.parent : BIND_LINES.villager);
    safe(() =>
      mind?.remember?.(`The stranger closed the Stillring on ${t.name || 'one of ours'}.`, {
        importance: PARENTS.has(id) ? 8 : 6,
        about: ['player', id].filter(Boolean),
        tags: ['binding_light', 'weave'],
        emotion: 'anger',
      }),
    );
  }

  // The stranger raised a ward round her: care when she is in danger.
  onWard(p) {
    const l = this.lyra();
    if (!l || p.bearer !== l || !this.sees()) return;
    const now = this.missions?.playT ?? 0;
    if (now - (this.wardedAt ?? -99) < 90) return;
    this.wardedAt = now;
    const mind = l.mind;
    const threats = safe(() => mind?.perception?.threats ?? 0, 0) || 0;
    const hurt = l.maxHp > 0 && l.hp / l.maxHp < 0.7;
    const danger = threats > 0 || hurt;
    this.comment(danger ? WARD_LINES.danger : WARD_LINES.calm);
    if (danger) safe(() => mind?.autonomy?.recordDeed?.('protected_lyra', { text: 'Raised a ward round me when I was in danger.' }));
    else safe(() => mind?.remember?.('The stranger raised a ward round me, for no reason but to. It hummed.', { importance: 3, about: ['player'], tags: ['weave', 'ward'], emotion: 'joy' }));
  }

  onWeave(p) {
    if (!this.sees()) return;
    this.weaves++;
    const w = weaveOf(p);
    const mind = this.lyra()?.mind;
    if (!this.firstSeen) {
      this.firstSeen = true;
      this.firstSeenAt = this.missions?.playT ?? 0;
      safe(() => mind?.appraise?.('novelty', 1.3, 'the stranger weaving light'));
      safe(() =>
        mind?.remember?.('The stranger made light out of the empty air: no warmth spent, no breath, just their hands pulling it tight like thread. Nobody can do that. Nobody I know.', {
          importance: 8,
          about: ['player'],
          tags: ['weave', 'magic', 'first_weave'],
          emotion: 'surprise',
          gist: 'the first time I saw the stranger weave',
        }),
      );
      safe(() => mind?.learn?.(this.playerName(), 'They can weave: make light out of the air with marks in it, like Lanternwright glyphs. Not lumencraft.', { kind: 'fact', source: 'observed', about: ['player'] }));
      return; // the first time is the story scene's moment, not a quip's
    }
    for (const e of nonRaw(w.essences)) {
      if (this.seenEssences.includes(e)) continue;
      this.seenEssences.push(e);
      this.comment(ESSENCE_LINES[e], e);
      this.rememberEssence(e);
      return;
    }
    if (w.shape && !this.seenShapes.includes(w.shape)) {
      this.seenShapes.push(w.shape);
      if (SHAPE_LINES[w.shape]) this.comment(SHAPE_LINES[w.shape]);
    }
  }

  // A boss shard or a mission reward: she hears about it if she's there.
  onUnlock(p) {
    if (p.id !== 'dark' || !this.sees()) return;
    if (this.seenEssences.includes('dark')) return;
    this.seenEssences.push('dark');
    this.comment(ESSENCE_LINES.dark, 'dark');
    this.rememberEssence('dark');
  }

  comment(lines, essence = null) {
    if (!lines?.length) return;
    const rng = this.game.rng;
    const i = Math.floor((rng?.next ? rng.next() : Math.random()) * lines.length);
    const line = lines[Math.min(lines.length - 1, i)];
    this.missions?.lyraLine?.(line, { delay: essence === 'dark' ? 0.3 : 0.8 });
  }

  rememberEssence(e) {
    const mind = this.lyra()?.mind;
    if (!mind) return;
    const dark = e === 'dark';
    safe(() =>
      mind.remember?.(
        dark ? 'The stranger wove something dark and cold. It felt like the gravelight in the ruins. I told them I did not like it. I still do not.' : `The stranger wove ${e} for the first time where I could see it.`,
        { importance: dark ? 7 : 4, about: ['player'], tags: ['weave', 'magic', `essence_${e}`], emotion: dark ? 'fear' : 'joy' },
      ),
    );
    if (dark) safe(() => mind.appraise?.('threat', 0.35, 'gravelight in the stranger\'s hands'));
    else safe(() => mind.appraise?.('novelty', 0.4, `a weave of ${e}`));
  }

  playerName() {
    return this.game.settings?.playerName || 'the stranger';
  }

  serialize() {
    return { e: this.seenEssences.slice(), s: this.seenShapes.slice(), f: this.firstSeen, n: this.weaves };
  }

  deserialize(d) {
    this.reset();
    if (!d) return;
    this.seenEssences = Array.isArray(d.e) ? d.e.slice(0, 20) : [];
    this.seenShapes = Array.isArray(d.s) ? d.s.slice(0, 20) : [];
    this.firstSeen = !!d.f;
    this.weaves = Number(d.n) || 0;
  }
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}
