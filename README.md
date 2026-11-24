# Hearthlight

A pixel-art adventure for the browser — on your phone, your computer, anywhere — about a
traveler, a village called Hearthvale, and **Lyra**: a companion with a mind of her own.

Lyra is an arcane ranger who came to Hearthvale looking for her missing mentor. She fights
beside you, works with you, talks with the villagers, and remembers everything that happens.
She has a soul (a history, values, fears and dreams), feelings and needs that change through
the day, opinions about every person she meets, goals of her own, and a diary she writes each
night. Her mind can be powered by Claude, or by a built-in offline mind when no AI is available.

## Playing

- **On claude.ai** (recommended): open the published Artifact link. Lyra thinks with Claude
  through your own claude.ai account. The first time she needs to think, claude.ai asks you to
  allow it; replies use your Claude usage. She can also speak aloud (Settings → Voice) and hear
  you through the microphone button in the chat, where your browser supports it.
- **Anywhere else**: open `dist/index.html` from a build, or host the `dist/` folder on any
  static host (GitHub Pages, Netlify, your own server). Lyra uses her offline mind there, or
  Claude through your own Anthropic API key (Settings → Lyra's mind → API key). The key is
  stored only in that browser's local storage and sent only to Anthropic.

### Controls

| | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move | WASD / arrows | left stick | left-side joystick |
| Attack / work | J or Space | A | ⚔ button |
| Dodge roll | K or Shift | B | ↺ button |
| Interact | E | X | ✋ button |
| Talk to Lyra | T or Enter | Y | 💬 button |
| Lyra's mind | Tab or M | | 🧠 button |
| Inventory | I | | 🎒 button |
| Pause | Esc | Start | ☰ button |
| Orders: follow, stay, attack mode, defend, passive | 1 2 3 4 5 | | command bar |

### Talking to Lyra

Type (or say) anything. Some things she understands even offline:

- Orders that stay in force until you change them: *"follow me"*, *"wait here"*,
  *"attack mode"* (she fights every creature that isn't a friend — no asking first),
  *"defend me"*, *"stop fighting"*, *"guard the farm"*, *"patrol the village"*,
  *"do whatever you want"*.
- Work: *"chop 5 wood"*, *"go fishing"*, *"gather herbs and bring them to me"*,
  *"mine some ore"*, *"cook the fish"*, *"pick that up"*, *"stop working"*.
- People: *"go talk to Elda"*, *"ask Aveline about Maren"*, *"what do you think of Bram?"*,
  *"Bram is my friend"*, *"the bandits are our enemies"*.
- Her: *"how are you feeling?"*, *"what do you remember about the lake?"*,
  *"remember that Pip loves cats"*, *"what do you want?"*, *"tell me about Maren"*.

With Claude she understands everything else too, and answers as herself.

### Lyra's mind

Open it with Tab, M, or the 🧠 button. It is where she keeps her information:

- **Now** — her mood, emotions, needs, current thoughts and orders.
- **People** — everyone she knows: how close she is to them, what she thinks of them in her
  own words, and what she has learned about them. Mark people as friends or enemies here.
- **Memories** — everything she remembers, by day and importance (searchable).
- **Diary** — what she wrote each night.
- **Goals** — what she wants, from you and for herself.
- **Soul** — who she is. You can edit it, and restore the original.
- **Data** — export her whole mind as a file, import it again, or start her fresh.

### Saving

The game saves on its own (every minute, when you sleep, and when you leave the page) in this
browser. On claude.ai it also keeps your save in your claude.ai account, so Lyra remembers you
on your phone and your computer.

## Developing

Requirements: Node.js 20 or newer.

```sh
npm install
npm run dev        # http://localhost:5173/ — the ES-module source, reload to see changes
npm run build      # dist/index.html (standalone) and dist/artifact.html (claude.ai Artifact)
npm test           # unit tests (node:test)
npm run smoke      # build + headless browser smoke test
node scripts/playtest.mjs   # longer scripted playtest with screenshots in screenshots/
```

No runtime dependencies and no external assets: every sprite is drawn by code at start-up
and every sound is synthesized.

### How it fits together

`DESIGN.md` is the full design and the contract between modules. In short:

- `src/core` — the game loop, events, clock, input, audio, saving, settings.
- `src/world` — tiles, the map, world objects (doors, trees, chests, beds…), pathfinding, and
  the hand-made world.
- `src/entities` — the player, Lyra, villagers, creatures, combat, items.
- `src/render` — the renderer, lighting, particles, speech bubbles, weather.
- `src/ai/mind` — Lyra's soul, emotions, needs, memory and relationships.
- `src/ai/behavior` — how she moves, fights, follows orders and does jobs.
- `src/ai/brain` — how she understands you and answers: the offline mind and the Claude paths.
- `src/ai/plugins` — her abilities, as plugins.
- `src/ui` — everything on screen that isn't the world.

### Writing a plugin

Everything Lyra can do is an **action** registered by a **plugin**. Any brain — the offline
mind, Claude, the command bar, or Lyra's own free will — changes what she does only by running
actions. A plugin can also react to events, keep its own saved state, teach the offline mind
new phrases, and give Claude extra context.

```js
// src/ai/plugins/stargazing_plugin.js
export const stargazingPlugin = {
  id: 'stargazing',
  name: 'Stargazing',
  actions: {
    stargaze: {
      description: 'Lie back and look at the stars with the player (night only).',
      params: {},
      run(args, ctx) {
        if (!ctx.game.clock.isNight) return { ok: false, message: "No stars yet. Ask me again tonight." };
        ctx.behavior.emote('sit');
        ctx.mind.feel('joy', 0.4, 'stargazing');
        ctx.mind.remember('We lay in the grass and named the stars.', { importance: 6, about: ['player'] });
        return { ok: true, message: 'Look — the Lantern is rising.' };
      },
    },
  },
  intents: [
    {
      id: 'stargazing.ask',
      patterns: [/\b(let'?s )?(look at|watch|see) the stars\b/i],
      command: true,
      actions: () => [{ name: 'stargaze', args: {} }],
      answer: (m, ctx, results) => results[0]?.message || null,
    },
  ],
  promptContext(ctx) {
    return ctx.game.clock.isNight ? 'The sky is clear enough for stargazing (action: stargaze).' : '';
  },
};
```

Then add it to `BUILTIN_PLUGINS` in `src/ai/plugins/index.js`.
