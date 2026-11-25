# Working on Hearthlight

Before you call any change done, walk **docs/IMPACT.md** (what a change can ripple across:
player builds, terrain and floors, places, characters, states, devices, day/night and
weather, Claude online or offline, saves and permadeath, story branches). In your commit
message or report, say which axes the change touches and what you did for each, or why an
axis does not apply. When you add a new value to an axis (a class, a floor, a place, a kind
of character), teach every system in its row about it, and keep IMPACT.md current.

Also:
- `DESIGN.md` is the contract between modules; `docs/LORE.md` is the canon. Keep both in
  step with what you build.
- The author plays on a phone (upright and sideways) and on a computer: check all three.
- The vale keeps its tile coordinates (0..159 by 0..119): saves and missions refer to
  objects by position. The wider world lies around it (`src/world/wilds*.js`).
- No `alert()` or `confirm()`; every panel closable; Lyra lives for herself.
