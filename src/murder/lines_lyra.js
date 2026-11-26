// What her people say of Lyra once she is dead (round 14b, V-7). T owns murder/lines.js;
// these are blood's own keys, read by grief.decorateDialogue when the one mourned is Lyra.
// Plain words, no threat to anyone: grief.

export const LYRA_GRIEF = Object.freeze({
  hobb: ["The far lamps are mine again. I'd give my eyes to be beaten to them one more night.", "She lit her first lamp at seven. I held the ladder. Who holds it now.", 'Star. My Star. The lane is very dark.'],
  wenna: ["The bees know. They've gone quiet. They always knew her before I did.", "Don't. Don't say her name to me today.", "I told her not to stay anywhere for our sake. She stayed anyway. She stayed."],
  sabeth: ["Hobb took me under his flame, and she shared hers with me without a word. I don't know how to be in that house now.", 'She used to bring me honey cakes and pretend they were left over.'],
  mira: ["I patched her up a hundred times. Every scrape. I never once thought I'd have nothing to patch.", "There's nothing on my shelves for this."],
  elda: ["Her room's still made up. I can't bring myself to strip the bed."],
  aveline: ["Her family's flame burns lower. I keep it. I'll keep it."],
});

export function lyraGriefLine(id, rng = Math.random) {
  const list = LYRA_GRIEF[id];
  if (!list?.length) return null;
  return list[Math.floor((typeof rng === 'function' ? rng() : Math.random()) * list.length) % list.length];
}
