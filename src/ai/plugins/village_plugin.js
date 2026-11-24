import { Village } from '../social/village.js';

// Village plugin (social, DESIGN §19.3): creates game.village, Hearthvale's social life,
// and feeds it the bus, the clock and the save. Lyra's prompt gets one compact line of the
// village news she has heard.

export const villagePlugin = {
  id: 'village',
  name: 'Village',
  description: 'Hearthvale talks: bonds between the eighteen, their conversations, gossip about the player, and what the village thinks of them.',

  install(ctx) {
    const g = ctx.game;
    if (!g) return;
    if (!g.village) g.village = new Village(g);
    if (this._pending !== undefined) {
      g.village.deserialize(this._pending);
      this._pending = undefined;
    }
  },

  onEvent(type, payload, ctx) {
    ctx.game?.village?.onEvent(type, payload);
  },

  update(dt, ctx) {
    ctx.game?.village?.update(dt);
  },

  promptContext(ctx) {
    return ctx.game?.village?.promptContext?.() || '';
  },

  serialize(ctx) {
    return ctx.game?.village?.serialize?.() ?? null;
  },

  deserialize(data, ctx) {
    if (ctx.game?.village) ctx.game.village.deserialize(data);
    else this._pending = data;
  },
};
