# Third-party code

## pixelfx (MIT)

- **What:** code-made pixel-art effects by patch-gg, commit `5294518`.
- **Where:** `src/vendor/pixelfx/` — `core/*.js` and only the effect files the game plays
  (`fx/impacts`, `fx/status`, `fx/spawn`, `fx/holy`, `fx/pickups`, `fx/shadow`, each with its `_lib.js`),
  in the original layout so their imports resolve.
- **License:** `src/vendor/pixelfx/LICENSE` (MIT, Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez).
- **Notices:** `src/vendor/pixelfx/NOTICE.md`, kept as shipped:
  - Hugo Duprez's Sprite Fusion pixel art VFX (MIT): `core/sim.js` and the effects that say so at the top of
    their file.
  - Hollow Crown by rehan-remade (MIT): `core/act.js`. The game does not use the acts or the stock actor.
  - The Patch Pixel font in pixelfx's `gallery/fonts` is not MIT. It is **not** included here: none of
    `gallery/`, `docs/`, `tools/` or `records/` was copied.
- **Changes:** Hearthlight is seen from above (3/4), pixelfx is drawn for a side view. Every effect file we
  changed says so at its top ("Hearthlight top-down variant (changed from pixelfx 5294518, MIT)") with what
  changed and why: rings and pools lie on the floor as 0.6–0.75 ellipses, debris and sparks scatter over the
  floor in x and y and hop up the screen (`core/sim.js` gained a per-particle floor, `fy`/`fv`), aimed effects
  take the game's aim, statuses wrap our own sprites, and a `size`/`calm` option fits them to 12×20 px
  characters and reduced motion. The MIT license headers and credits are kept.
- **Ours, drawn with pixelfx's painter:** the top-down butterfly and bat (`src/render/pixel_fx_critters.js`)
  and the host (`src/render/pixel_fx*.js`).
