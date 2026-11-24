// Menu entries for the story (DESIGN.md §20): replay the Prologue, and open The Book of
// Halcyre. The story module (game.story, the codex) comes from its own branch, so each
// entry shows only when this build has what it needs; the calls are feature-detected
// and a failure is reported in a toast, never thrown into the menu.

function fn(obj, name) {
  return obj && typeof obj[name] === 'function' ? obj[name].bind(obj) : null;
}

// How to replay the prologue in this build, or null.
export function prologueAction(game) {
  const s = game?.story;
  const direct = fn(s, 'playPrologue') || fn(s, 'replayPrologue');
  if (direct) return () => direct();
  const play = fn(s, 'play') || fn(game?.cutscenes, 'play') || fn(game?.cutscene, 'play');
  if (play) return () => play('prologue');
  return null;
}

// How to open The Book of Halcyre in this build, or null.
export function bookAction(game, ui) {
  const open =
    fn(ui?.codex, 'open') ||
    fn(game?.codex, 'open') ||
    fn(game?.story?.codex, 'open') ||
    fn(game?.story, 'openBook') ||
    fn(game?.story, 'openCodex') ||
    fn(ui, 'openCodex') ||
    fn(ui, 'openBook');
  return open ? () => open() : null;
}

// [{ id, label, icon, hint, run }] for what this build offers.
export function storyEntries(game, ui) {
  const out = [];
  const pro = prologueAction(game);
  if (pro) out.push({ id: 'prologue', label: 'Prologue', icon: 'flame', hint: 'Watch how it began', run: pro });
  const book = bookAction(game, ui);
  if (book) out.push({ id: 'book', label: 'The Book of Halcyre', icon: 'book', hint: 'The world, its people and the story so far', run: book });
  return out;
}

// Run an entry; a story module that fails says so instead of breaking the menu.
export async function runEntry(entry, ui) {
  try {
    await entry.run();
  } catch (err) {
    console.warn(`[ui] ${entry.id} failed`, err);
    ui?.toast?.(entry.id === 'book' ? 'The book will not open right now.' : 'The prologue will not play right now.', 'warn');
  }
}
