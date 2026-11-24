# Hearthlight

A pixel-art adventure for the browser — on your phone, your computer, anywhere — about a
stranger, a warded village called Hearthvale, and **Lyra**: a companion with a mind of her own.

You were found lying in a melted circle of snow on the Hollowcrown, the mountain above the
village. Lyra Ambrel, the lamplighter's daughter, and Hess the huntress carried you down. You
slept eighty-one days. When you woke, Lyra took the hearthwatch over you, for reasons of her
own: the stipend, a second blade for the Sunken Ruins, and whatever ties you to Maren, the
teacher who walked into those ruins and never came back.

Lyra lives for herself. She travels with you because she chooses to, while it is good for
her, and she weighs everything you ask. She has a soul (a history, values, fears and dreams),
feelings and needs that change through the day, opinions about everyone she meets, a life of
her own in the village, and a diary she writes each night. Her mind can be powered by Claude,
or by a built-in offline mind when no AI is available.

## Playing

- **On claude.ai** (recommended): open the published Artifact link. Lyra thinks with Claude
  through your own claude.ai account. The first time she needs to think, claude.ai asks you to
  allow it; replies use your Claude usage. She can also speak aloud (Settings → Voice) and hear
  you through the microphone button in the chat, where your browser supports it.
- **Anywhere else**: open `dist/index.html` from a build, or host the `dist/` folder on any
  static host (GitHub Pages, Netlify, your own server). Lyra uses her offline mind there, or
  Claude through your own Anthropic API key (Settings → Lyra's mind → API key). The key is
  stored only in that browser's local storage and sent only to Anthropic.

The pause menu (and the title screen) also has the **Prologue**, to watch how it all began
again, and **The Book of Halcyre**, where the world, its people and the story so far are
written down as you learn them.

### Controls

| | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move | WASD / arrows | left stick | touch and drag on the left half |
| Attack / work | J or Space | A | sword button (bottom right) |
| Dodge roll | K or Shift | B | swirl button |
| Interact, talk to a villager | E | X | hand button |
| Listen in | L | | tap "Listen in" |
| Talk to Lyra | T or Enter | Y | Talk button, or the speech-bubble icon at the top |
| Lyra's mind | Tab or M | | spark icon at the top, or tap her card |
| Inventory | I | | bag icon at the top |
| Pause | Esc | Start | pause icon at the top |
| Ask Lyra: follow, wait, fight, defend, hold back, jobs | 1 2 3 4 5, the bar at the bottom | | the violet spark button opens the ring |

**On a phone** the screen stays mostly world. Your card is one slim row (health, coins,
level). Lyra's card folds down to her portrait with her mood on its corner: tap it to unfold
it (her health, what she is doing, and where she stands with you), tap it again to open her
mind, and use the little tab on its edge to fold it away. The quest line is one short row
under the icons; tap it to read all of it.

### Hearthvale: eighteen people with their own lives

About a hundred and fifty people live in Hearthvale, and eighteen of them are yours to know: old Hobb the lamplighter and Wenna the beekeeper (Lyra's
parents), Elda at the Ember Kettle, Bram the smith and his apprentice Tilly, Pip, Captain Rowan
and young Wys of the watch, Mira the herbalist, Tobias and Tansy on the farm, Sister Aveline at
the chapel, Garrick the merchant, Hess the huntress, Sabeth the dyer, Alder the Reeve and Petra
the old midwife, and Corran the fisherman. They work, eat at the Kettle, sleep in their own
beds, like and dislike each other, gossip, and remember what you do.

- **Talk to anyone.** Walk up to a villager and press E (or tap the hand). Besides the usual
  options, type anything into **"Say something…"** (or use the microphone, where it is
  offered): ask how they are, what they think of someone, what they know about Maren — or
  thank them, or insult them. They answer in their own voice, from what they know and how
  they feel about you, and they remember it.
- **Listen in.** When two villagers are talking near you, a small **"Listen in"** prompt
  appears. Press L or tap it, and their conversation plays out in speech bubbles.
- **While you slept.** In the morning, beside Lyra's diary, a few lines tell you what went on
  in the village overnight: who talked, what rumor spread, who fell out.
- **Her village protects her.** Hearthvale is Lyra's home, and she never leaves it. If she is
  hurt or afraid she shouts for help and runs to her people, and they come: the watch, Hess,
  her parents, Mira. Word gets around.
- **Villagers think with Claude** (Settings → Lyra's mind): by default villagers use Claude
  only when you talk to them or listen in. With your own API key you can let them use it for
  conversations around you too.

### Talking to Lyra

Type (or say) anything. Some things she understands even offline:

- Requests that stay in force until you change them: *"follow me"*, *"wait here"*,
  *"attack mode"* (she fights every creature that isn't a friend — no asking first),
  *"defend me"*, *"stop fighting"*, *"guard the farm"*, *"patrol the village"*,
  *"do whatever you want"*.
- Work: *"chop 5 wood"*, *"go fishing"*, *"gather herbs and bring them to me"*,
  *"mine some ore"*, *"cook the fish"*, *"pick that up"*, *"stop working"*.
- People: *"go talk to Elda"*, *"ask Aveline about Maren"*, *"what do you think of Bram?"*,
  *"Bram is my friend"*, *"the bandits are our enemies"*.
- Her: *"how are you feeling?"*, *"what do you remember about the wolves?"*,
  *"remember that Pip loves cats"*, *"what do you want?"*, *"tell me about Maren"*.

With Claude she understands everything else too, and answers as herself. Every request is
one she weighs: she may say yes, yes on her terms, or no, with her reason.

### Lyra's mind

Open it with Tab, M, the spark icon, or her card. It is where she keeps her information:

- **Now** — her mood, emotions, needs, current thoughts and what she is doing.
- **You & her** — where she stands with you: trust, fear, what she has seen you do, and her
  **worth-it judgment** in plain words: what traveling with you gives her, what it costs her,
  and how the two weigh up. She stays while it is worth it to her; small wrongs she can
  afford, she lets go.
- **People** — everyone in the village: who she is close to, how she feels about each of
  them in her own words, what she knows about them, how the village feels about *you*, and
  the latest talk and rumors ("Lyra and Mira talked about Rowan").
- **Memories** and **Knowledge** — everything she remembers and knows, searchable. She edits
  her own memory the way people do: she corrects, reframes, lets small things fade, and
  sometimes changes her mind. An edited entry carries an *edited* mark; open it to see what
  she used to remember and why she changed it.
- **Her life**, **Diary**, **Goals** — her life before you, what she wrote each night, what
  she wants for herself.
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
node scripts/ui3_check.mjs  # browser checks for the village UI and the phone HUD (after a build)
```

No runtime dependencies and no external assets: every sprite is drawn by code at start-up
and every sound is synthesized.

### How it fits together

`DESIGN.md` is the full design and the contract between modules. In short:

- `src/core` — the game loop, events, clock, input, audio, saving, settings.
- `src/world` — tiles, the map, world objects (doors, trees, chests, beds…), pathfinding, and
  the hand-made world.
- `src/entities` — the player, Lyra, villagers, creatures, combat, items.
- `src/render` — the renderer, lighting (deep blue nights, warm lamps and windows), particles,
  speech bubbles, weather.
- `src/ai/mind` — Lyra's soul, emotions, needs, memory and relationships.
- `src/ai/social` — the village's own social life: bonds, conversations, gossip, and talking
  to anyone.
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
